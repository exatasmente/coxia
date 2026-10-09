# Record the agent's screen only while it is in use: technical plan

A fix of #157 (the live agent screen), for the open release. The issue is `0_ISSUE.md`; the behaviour it changes is the recording of #157 (`../157-let-a-person-watch-an-agent-s-virtual-sc/1_SPEC.md`, rule 16; the plan `2_PLAN.md` there, section 2.3).

A real QA stage gave an 18-minute video, mostly a black screen. Two causes, both in code that exists today:

1. The recording begins at the first look at the screen, which `hub.open` makes at once (`hub.ts`, the `void tick(live)` at the end of `open`): the display is up long before the agent opens a window.
2. Time between two fed frames is kept as it was: the recorder gives each frame its real time on the stage's clock (`recorder.ts`, `offer`: `t = at - start`), and the end of the video is the stage's end (`build`: `stopAt - start`). That was the wording of #157 rule 16 ("an idle stretch plays as a still picture").

No new dependency, no configuration, no schema bump of the config. The run file's `recording` record gains optional fields (section 3).

## 1. What changes, and where

| Piece | Where |
|---|---|
| `inUse()` on the X connection: is a window mapped on the root | `src/main/screen/x11.ts` (two requests, `QueryTree` and `GetWindowAttributes`, with bounded parsing) |
| The hub looks first, feeds only when a window is mapped, and tells "never used" from "could not read" | `src/main/screen/hub.ts` (`tick`, `finish`, the `lost` map) |
| Gap compression and the cuts; the marks converted; `unused` is never reached by the recorder itself | `src/main/screen/recorder.ts` |
| The meaning of `durationMs`, the new `realMs` and `cuts`, the constants, and the two pure mappings between media time and real time | `src/shared/screen.ts` |
| The run file accepts the new fields | `src/shared/runs/schema.ts` (the `recording` object) |
| `unused` as a reason for not keeping | `src/main/evidence/recording.ts` (`NotKept`, `notKeptText`), catalogs `main.*.json` (`main.screen.notKept.unused`) |
| The player shows the cuts: ticks on the strip, the real time while playing | `src/renderer/src/screens/cycle/RecordingPlayer.tsx`, `recording.ts` (`cutBox`), `cycle.css`, catalogs `ui-cycle.*.json` |
| Docs and changelog | `docs/runner.md` (both languages, the live-screen paragraphs), `CHANGELOG.md` under `## [Unreleased]` |

## 2. What the plan decides

### 2.1 Detecting that the screen is in use: ask the server for the root's children

**Decision.** A new method `inUse(): Promise<boolean | null>` on `X11Connection`, over the connection the app already has:

1. `QueryTree` (opcode 15) on the root. The reply's extra data is exactly `n * 4` bytes for `n` children (the count at offset 16 must agree with the length field, or the connection closes as for any reply that is not what was asked for); at most 64 KiB (16384 children) are accepted. The children are in stacking order, bottom to top.
2. `GetWindowAttributes` (opcode 3) for the topmost children, one request each, from the top, at most 64 of them, stopping at the first that is `InputOutput` (class at offset 12) and `Viewable` (map state at offset 26 equal to 2). The reply is exactly 44 bytes (length field 3). An X error (the window went away between the two requests) means "not that one".
3. `true` when one is found, `false` when none is, `null` when the server did not answer (a connection that is gone, or a reply that closed it). It never throws.
4. **More children than are asked about.** When the root has more than 64 children and none of the 64 at the top is viewable, the answer is `true` ("treat as in use"): a window may be among those left out, and a recording that stops for want of a look is worse than one that goes on. A root with 64 or fewer, none viewable, is `false`.
5. **One deadline.** The whole question has `requestMs` (3 s) in total, counted from the time it runs on the queue. Before each `GetWindowAttributes` the deadline is checked; past it the answer is `null`, the queue is free and the connection is kept (a request already sent still has its own `requestMs`, after which the connection is closed as for any request that is not answered).

**Why this and not comparing the frame with the empty root.**

- "A window is mapped" is what the issue says and what a person means by "the screen is in use"; a frame comparison says "the picture is not the one I remembered", and the remembered picture has to come from somewhere. The only candidate is the first frame read, which is wrong whenever the agent opened a window before the first look (the first look is made at once, but the stage's supervisor and the window manager, if any, race with it), and the root's own look is not fixed (a background color or a pattern the agent sets with `xsetroot`).
- The frame is already read about once a second for the recording; a comparison would have to read 4 MB per second for a screen that may stay empty for 15 minutes, only to throw it away. `QueryTree` is 32 bytes and an empty answer costs one round trip. The frame is read only when a window is there, so a stage that never opens one reads no frame for the recording at all.
- The reply is small and parsed with the bounds of the rest of `x11.ts`. The agent can draw on its display (the issue accepts it), so it can map a window of its own to start the recording; that costs it nothing the frames did not already show.

**Known limit.** A window that is mapped but draws nothing (a tiny or blank helper window of a toolkit) counts as use. The first frame it feeds is then a black one, as the screen is; the recording still ends when the real one comes, and the gaps are compressed. Accepted: telling a blank window from a drawn one is the frame comparison again.

### 2.2 When the recording starts and what is fed

The recorder already starts at its first offer (`start = at` when the encoder is opened). The hub changes what it offers:

- `tick` first asks `inUse()`. `false` or `null`: nothing is read for the recording and nothing is offered (the screen is empty, or the display did not answer; a dead display is still `read`'s to notice when a viewer or a later look reads). `true`: the frame is read through the same cache (`read`, 400 ms) and offered as before.
- The first look still happens at once after `open`, but it now ends at the question when no window is mapped: the encoder is not started, so the cost of a stage with no window is a timer and one small request a second.
- The hub keeps `sawWindow` on the live screen (and beside the recorder in the `lost` map): set the first time `inUse()` is `true`.
- `finish`: when the recorder says `no-frame` and no window was ever seen, the outcome is `{ ok: false, reason: 'unused' }`. `no-frame` stays for a window that was seen and whose frame could not be read. The executor's existing path (`keepScreenRecording` -> `notKept`) writes **one** line, `runner.screen.notKept`, with the reason `main.screen.notKept.unused` ("no window was opened on the screen"). It is not an error and does not touch the stage.

### 2.3 Shortening idle gaps: a media clock with cuts

Two clocks: the **real** clock (the stage's) and the **media** clock (the video's). They differ by the time that was cut.

**Rule.** When a frame is about to be fed and the real time since the last fed frame is longer than `RECORDING_IDLE_GAP_MS` (3000 ms), the gap becomes `RECORDING_IDLE_PAUSE_MS` (1000 ms) of media time, and a cut is recorded: `{ atMs, skippedMs }`, with `atMs` the media time at which the pause ends (the time the new frame has) and `skippedMs` the real time that was removed (`gap - 1000`). A gap of exactly 3000 ms or less is kept. The time between the last fed frame and the end of the recording is treated the same way (the recording's tail), so a window that is closed and a stage that goes on for ten minutes does not end as a ten-minute still picture.

- **Only a frame that is fed moves the clock.** The question is asked for an offer that passed the "same picture" and "too soon" checks, and the cut is committed only when the sink took the frame. A picture that stays the same for an hour costs nothing, and the next change after it is the one that closes the gap.
- **The time limit is on the media clock.** `RECORDING_MAX_MS` (60 min) bounds the video, so it is checked against the media time of the frame about to be fed. The old check ("also for a screen that never changes") existed because a still screen kept growing the video; now it does not grow, so the check moves to the fed frame. The size limit is unchanged.
- **Cap on the cuts.** At most `RECORDING_CUTS_MAX` (500) cuts. Past it, gaps are not compressed any more (the video is a still picture for them, as in #157): the mapping stays exact, and the byte and time limits still bound the video.
- **The mapping.** With the cuts sorted, the real time of a media time `m` is `m` plus the `skippedMs` of every cut with `atMs <= m`. The media time of a real time `r` is `r` minus the cuts before it; a real time that falls inside a cut maps to that cut's `atMs`. Both are pure functions in `shared/screen.ts` (`realAtMedia`, `mediaAtReal`), used by the recorder and the player, and tested together.
- **The meta.** `RecordingMeta` gets:
  - `durationMs` — **now the media duration**, the length of the video file (the player's timeline). Before this fix it was the stage's time. Records saved by 0.9.0-beta.4 have no cuts, so for them the two are the same.
  - `realMs?` — the stage's time between the first fed frame and the end of the recording. `realMs = durationMs + sum(skippedMs)`. Both fields are written only when something was cut; without cuts `realMs` is `durationMs`.
  - `cuts?` — the list above, ordered by `atMs`; absent or empty when nothing was cut.
  - `marks` stay in **media** ms from the start, so the strip needs nothing more.
- **The marks (`fromMs` / `toMs`).** The hub still gives the recorder the real interval of the person's input; the recorder converts both ends with `mediaAtReal`. The least width (`RECORDING_MARK_MIN_MS`) is applied in real time, as before, and again in media time when the cut collapsed the interval; an interval that lies inside the recording's real span but was cut away is kept as a mark of that width at the cut (the evidence never loses what the person did); an interval that begins after the end is dropped, as before.
- **The truncation loop** (the file over the ceiling: the end of the video goes) drops the cuts past the new end and recomputes `realMs`.

### 2.4 The player

- The duration line says the video's length and, when there are cuts, the real time: "Length 1:12, real time 18:03".
- A strip **under the marks' strip** with a tick at each cut that is inside the video (`cutBox`, a position in percent like `markBox`). Each tick is a button that seeks to the cut and carries its label ("Here 5:20 of idle time was skipped; real time 7:40").
- A line under the video, updated on `timeupdate`: "Real time 7:41", from `realAtMedia(cuts, currentTime)`. It is shown only when the recording has cuts.
- Style: `var(--amber-solid)`-family tokens already used by `.cy-rec-capped`, or the line tokens; no literal color. Keys in both catalogs: `ui.cycle.rec.durationReal`, `ui.cycle.rec.cuts`, `ui.cycle.rec.cut`, `ui.cycle.rec.realTime`.

## 3. Data

- `RecordingMeta` (`src/shared/screen.ts`): `realMs?: number`, `cuts?: { atMs: number; skippedMs: number }[]` and `startedAfterMs?: number` (the time from the display opening to the first fed frame; the hub gives the recorder `openedAt`, and the player says it). Optional, so a run written by 0.9.0-beta.4 reads as it was.
- The run file's schema (`src/shared/runs/schema.ts`, the `recording` object) lists the new properties, with `maxItems: RECORDING_CUTS_MAX`. The format version of the run file goes from 2 to 3 for a run whose recording holds cuts (`RUN_VERSION` 3, `runVersionOf`: 3 when a `webm` record has a non-empty `cuts` or a `startedAfterMs` — any property the beta.4 and beta.5 schema does not allow —, 2 for a recording with none of them, else 1; since the hub always gives `openedAt`, every new recording is a 3 in practice; the version enum of the schema is `[1, 2, 3]`). **Consequence:** the schema of 0.9.0-beta.4 and beta.5 allows no other property in `recording`, so it would have refused such a run as *invalid* if it were still stamped 2. Stamped 3, those apps say "written by a newer app" (the file is left alone, not lost) and every run without cuts stays readable by them. That matters only to someone who goes back to those pre-releases.
- `RecordingOutcome` gets the reason `'unused'`. `NotKept` includes it.
- No config field, no `defaults.ts`, no migration.

## 4. Tests

| Test | Checks |
|---|---|
| `test/x11-client.test.ts` (new `describe`) against `test/helpers/fakeX.ts`, which learns `QueryTree` (15) and `GetWindowAttributes` (3) from a mutable list of windows | empty root is `false`; a viewable window is `true`; an unmapped window, an unviewable one and an input-only one are `false`; the topmost mapped one is found under unmapped ones; a window that disappears between the two requests is skipped; a reply of the wrong length, a child count that disagrees with the length, and a reply over the cap close the connection and answer `null`; a server that does not answer times out to `null`; it is serialised with `GetImage` |
| `test/helpers/screen.ts` | the fake connection gets `inUse()` and a `windows` switch (default: a window is mapped, so the #157 tests keep their meaning) |
| `test/screen-hub.test.ts` | no frame is read or fed while no window is mapped, and the encoder is not even opened; the video starts at the frame in which the window first appears (ts 0); an empty screen after a window closed feeds nothing; no recording plus `{ ok: false, reason: 'unused' }` when a window never appears, and `no-frame` (not `unused`) when a window was seen and its frame could not be read; the same for a display that died; one line only through the executor |
| `test/screen-recorder.test.ts` | a gap over 3 s becomes 1 s of media and one cut; a gap of exactly 3 s is kept; the tail is compressed the same way; unfed offers move nothing; the time limit is on the media clock (a long still stretch no longer stops the recording, and a long video of changes still does); the cuts are capped and the mapping stays exact past the cap; marks are converted, widened, snapped to a cut and dropped after the end; the truncation loop drops the cuts past the end; `durationMs`/`realMs`/`cuts` in the meta and the `Duration` of the file |
| `test/webm-mux.test.ts` | unchanged (the muxer takes media times); the `Duration` of the file is checked in `screen-recorder.test.ts` |
| `test/screen-recorder.test.ts` (the mapping) | `realAtMedia` and `mediaAtReal` are inverses outside the cuts and agree inside them |
| `test/runner-screen-recording.test.ts` | an `unused` outcome writes exactly one `runner.screen.notKept` line with the new reason, keeps no evidence, and the stage does not fail |
| `test/recording-player-ui.test.ts` | the ticks render at their place with their label; the real time line and the duration with the real time render only when there are cuts; a recording without cuts renders exactly as before; labels in both languages |
| `test/runs-store.test.ts` | the run-file schema accepts the new fields and refuses a malformed cut; the format version of the run file (1, 2, 3; a 4 is `newer`; deleting the recording takes the run back down) |
| `test/live-screen-ui.test.ts` | the viewer says it waits for a window while the screen is bare |
| i18n | the new keys are in both catalogs (`npm run i18n:lint`, which also refuses repeated keys) |

**#157 tests whose expectation was the old behaviour, to be updated** (the list is checked against the real failures when they run):

- `screen-recorder.test.ts`: "is a WebM whose duration is the stage's time, also after a still stretch past the last frame" (10 minutes of still tail is now 1 s); "waits for the frame being handed over" (`durationMs` 5000); the two mark tests that finish 60 s and 10 s after one frame; "stops at the time limit, also on a screen that never changes".
- `screen-hub.test.ts`: "ends as a WebM of the whole stage" (`durationMs: 9500`) and "keeps the recording of a display that died" (`durationMs: 5000`).
- `runner-screen-recording.test.ts`: the `durationMs` that came from a long tail. (`evidence-recording.test.ts` needed no change.)

## 5. Order of the commits

1. This plan (alone).
2. `fix:` the X connection knows when a window is mapped (`inUse`, the fake X server, its tests).
3. `fix:` the recording starts when the screen is first used, and says when it never was (hub, `unused`, catalogs, tests, changelog line).
4. `fix:` shorten the idle gaps of the recording and map the marks (shared types and mappings, recorder, schema, tests).
5. `fix:` show where the idle time was cut in the player (player, `cutBox`, css, catalogs, tests).
6. `fix:` docs of the recording (`docs/runner.md`, both languages).

Each commit keeps the suite green; the changelog line of the visible change goes in the commit of the change (one entry, extended by the later commits).

## 6. Risks

- **A window manager or a panel the agent's image starts.** A mapped window of that kind makes the screen "in use" from the start, which is the old behaviour, no worse. The app starts the stage's Xvfb alone (`display.ts`, `policy.ts` start no window manager), so for the displays the app starts this does not happen; an image the person supplies may differ.
- **A recording that starts late loses the empty frame before the first window.** Wanted.
- **The tail of a stage whose window closed early** now ends 1 s after the last change, not at the stage's end. The player says the real time of the cut, so the timeline still tells when.
- **Seeking on the media clock.** The Cues the muxer writes hold media times; nothing in the file knows of the cuts, only the meta does. A viewer outside the app plays a shorter video, as the issue asks.

## 7. Decision log

| # | Decision | Rejected alternative, and why |
|---|---|---|
| D1 | The screen is "in use" when `QueryTree` on the root shows a viewable `InputOutput` child, checked with `GetWindowAttributes` | **Comparing the frame with the empty root**: the empty root has to be remembered from a first look that may already show a window, depends on the root's background, and reads 4 MB a second for a screen that may be empty for a quarter of an hour (2.1) |
| D2 | The hub asks before it reads; the recorder is unchanged in what it takes to start (its first offer) | **A switch inside the recorder**: it would have to know of windows; the hub already owns the connection |
| D3 | The reason for a stage that never used its screen is a new `unused`, told by the hub from what it saw, through the existing `notKept` line | **Reusing `no-frame`**: it says "no picture could be read", which is false here and hides a real read failure; **an error**: the stage did nothing wrong |
| D4 | **Overrides #157 spec rule 16** ("the time between frames is kept, so an idle stretch plays as a still picture rather than being cut") **by the maintainer's decision of 2026-10-09**: a gap over about 3 s plays as about 1 s, with a record of the cut | **Keeping the still stretch and only starting later**: the 18-minute video also had its long pauses between uses of the screen (the issue) |
| D5 | Threshold 3000 ms (strictly longer), pause 1000 ms | **A lower threshold**: the recorder takes one frame a second, so a normal active stretch has gaps of about 1 s and a window that changes every 2 s must not be cut; **a higher one**: a few seconds of nothing is what the issue calls a stretch |
| D6 | `durationMs` is the **media** duration; `realMs` and `cuts` are new and optional | **Keeping `durationMs` as real time**: the player's strip and the file's `Duration` would disagree; **a required field**: records of beta.4 would stop validating |
| D7 | The cut is `{ atMs, skippedMs }` with `atMs` the media time at which the pause ends | **Real-time stamps in the cut**: the player would convert both ways for every tick; the sum of `skippedMs` already gives real time |
| D8 | The tail of the recording is compressed like a gap | **Leaving it**: a stage that goes on after its window closed ends as a long still picture, the thing the issue complains about |
| D9 | The cuts are capped at 500; past the cap gaps stay as they are | **Dropping the recording or the oldest cuts**: the first loses evidence, the second breaks the mapping |
| D10 | The time limit is checked on the media time of the frame about to be fed | **Checking real time**: a stage with an hour of still window would stop a recording that is a few seconds long |
| D11 | The marks are converted in the recorder, with the least width again in media time, and kept at a cut when the cut collapsed them | **Dropping a collapsed mark**: the evidence would lose the fact that the person used the screen |
| D12 | The player gets ticks and a real-time line, no new control | **A second timeline with real time**: more to read for the same fact |

## 8. State of what was checked

Read from the code of `release/0.9.0` (0.9.0-beta.4, which holds #157): `hub.ts`, `recorder.ts`, `webm.ts`, `x11.ts`, `shared/screen.ts`, `RecordingPlayer.tsx`, the executor's `keepScreenRecording`, the fake X server and the existing tests. Nothing else was run before this plan was written; the real check (a throwaway Xvfb, the real hub and encoder) is done after the code and reported with its numbers.

## 9. Changes made while building

- `realMs` and `cuts` are written only when a cut exists, and `realMs` is always `durationMs` plus the cuts, also for a recording that stopped at a limit (no separate rule for the time limit).
- A mark wholly before the first frame is dropped (there is no video to point to); the plan only said what happens after the end.
- The mapping tests sit in `test/screen-recorder.test.ts`, not in a file of their own.
- The tests of the run file's schema and of its format version are in `test/runs-store.test.ts` (where #157 put its recording tests), not in `evidence-recording.test.ts`, which is unchanged; `webm-mux.test.ts` is unchanged too.
- The review of the first build changed: the run file is format 3 for a recording with `cuts` or `startedAfterMs`; the first look after a bare screen reads afresh (not from the viewer's 400 ms cache); `finish` takes one last look before it calls a screen unused; a root with more than 64 children, none of the 64 at the top drawn, is "in use"; `inUse()` has one deadline; the recorder's clock starts at the first frame the encoder took; `startedAfterMs` is kept and the player says it; the live state is `waiting` while the screen is bare (`recording: 'on' | 'waiting' | 'stopped'`).
- A video that ends at the time limit has no tail cut: it ends exactly at the limit, as in #157.
