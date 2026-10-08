# Let a person watch an agent's virtual screen live, in the app and in the paired browser

Gate 1: approved by the maintainer on 2026-10-08, with the answers recorded in "Gate 1 decisions" at the end. Nothing here is built yet; the plan (`2_PLAN.md`) follows.

Marks used below: **decided** is a maintainer decision taken in chat on 2026-10-08; **proposed — confirm at gate 1** is a product choice this spec makes and the maintainer may change; **verified 2026-10-08** is a fact checked on that day, in the code or on a throwaway Xvfb (nothing touched real data).

## What is asked

The issue, in its own words:

> A QA stage with the display switch on gets a virtual screen of its own [...] The agent opens the app under test there, clicks and takes screenshots, but nobody else can see that screen. [...] They cannot watch it from the desktop or from the paired phone, and they cannot step in when the agent is stuck on a screen.

What should happen, quoted:

> - **"Live screen" on the stage card** of a run, in the desktop app and in the paired browser (PWA), while a stage with a virtual display runs.
> - **Watching is open to a paired browser in the same way as the run reads.** The phone gets a smaller image.
> - **Frames are read only while someone watches**, at a low rate (about 2 per second), skipping unchanged frames; nobody watching costs nothing. The capture ends with the stage.
> - **The screen is kept as evidence of the QA stage:** frames at an interval (or a short clip) saved with the stage's evidence and shown after the stage ends, under a retention rule.
> - **The desktop can interact:** clicks and keys from the desktop viewer reach the agent's virtual screen. The paired browser only watches.
> - **The QA prompt says to run the browser headed when the display is on**, since a headless browser draws on no screen and there would be nothing to watch.

Decisions of the maintainer on 2026-10-08, **decided**:

- **A.** A paired browser may watch, opened like the run reads (`runs:*` reads are open to it).
- **B.** The screen is recorded as evidence of the QA stage, with a retention rule.
- **C.** The desktop app can interact; the paired browser only watches.
- **D.** Only the stages' virtual screens are covered (the Xvfb of a QA stage with the display switch on, in the sandbox or for an agent set to `shell: host`), never the person's own screen. Linux only, like Xvfb and bwrap. Nothing appears where there is no virtual display.

## Where things stand today

| Piece | Where it is today | Source |
|---|---|---|
| Sandbox display | The supervisor starts `Xvfb :99 -screen 0 1280x800x24 -nolisten tcp` under the stage's `prlimit` limits; its socket lives in the sandbox's own `/tmp` (a 512 MiB tmpfs); it waits up to 5 s for the socket and prints `ready` or `ready-nodisplay` | `src/main/sandbox/policy.ts:40-41,127-133`, `src/main/sandbox/index.ts:265` |
| Host display (`shell: host`) | A separate detached Xvfb that picks a free number (`-displayfd`), no TCP; ready timeout 5 s; stopped by SIGTERM then SIGKILL as a cleanup of the session | `src/main/sandbox/display.ts:21,29,53-58,67`, `src/main/sandbox/index.ts:296-309` |
| Who asks for a display | Only the stage whose output kind is `qa`, and only when `runner.sandbox.display` is on | `src/main/runner/executor.ts:357-358`, `src/main/sandbox/index.ts:250`, `src/shared/config/types.ts:788` |
| What the session reports | `gui.display` is `on`, `missing`, `failed` or `null`; the host session also reports its screenshots folder | `src/main/sandbox/session.ts:35-44,287`, `src/main/sandbox/host.ts:55-59` |
| Stage folder | `stageDir` with `ctl` (read-only inside), `out`, `home`, all mode 0700; `bwrapArgs` binds them; `session.close()` kills the group, runs the cleanups, then removes the whole folder | `src/main/sandbox/session.ts:136-138,197-215`, `src/main/sandbox/policy.ts:103-104` |
| Closing order | The sandbox is closed in `finally`, after the answer, the repair round and `keepLooked()`; whatever is to be kept is copied out before that | `src/main/runner/executor.ts:904,916` |
| Running a command in the sandbox | `session.exec` goes through a serial queue, spends the stage budget and is reported as the agent's command | `src/main/sandbox/session.ts:250,299-303` |
| Run data | `Run` is saved as a file; `command` is a field added only when the runner hands a run out and never saved | `src/shared/runs/types.ts:384`, `src/main/runner/service.ts:397-400,1075-1076` |
| Events to screens | `emit()` sends to the window and then broadcasts to every paired browser; the SSE route has no per-client topic | `src/main/index.ts:62-65`, `src/main/web.ts:260,373` |
| Binary on the wire | No binary or streaming route. Bytes travel inside the JSON RPC as `{$bytes: base64}`; `runs:evidence` returns an ArrayBuffer. Writes need the `X-Cerimonias` header, an allowed origin and a JSON body | `src/shared/wire.ts:12-35`, `src/main/runner/module.ts:181`, `src/main/web.ts:15` |
| Web policy | Unlisted channels are `allow`. `DESKTOP_ONLY` holds a list, and the patterns `WEB_ADMIN`, `CONFIG_ADMIN`, `VOICE_ADMIN`, `WIZARD`, `DOCS`, `AGENT_ASSIST` deny a whole prefix. No `runs:*` channel is desktop-only, and a test pins that | `src/main/webPolicy.ts:12,22,67,69`, `test/runs-policy.test.ts:10-30,51-54` |
| Evidence | Files under `<dataDir>/evidence/<runId>/`; kinds png, jpeg, gif, webp, pdf, text by content; video and audio are refused; 8 MiB per piece; each kept piece is a run revision plus a forum post | `src/main/evidence/store.ts`, `src/main/evidence/type.ts:56-76`, `src/shared/evidence.ts:28`, `src/main/runner/service.ts:339-360` |
| Evidence retention | None. `dropRunEvidence` exists and nothing calls it. `src/main/retention.ts` sweeps six data groups, none of them a run's evidence; the retention switch and days are one setting for the workspace (`retention: { enabled: false, days: 30 }` by default) | `src/main/evidence/store.ts:137`, `src/main/retention.ts:37`, `src/shared/retention.ts:3`, `src/shared/config/defaults.ts:55` |
| Evidence in the UI | `Evidence.tsx` lists a run's evidence and shows an image through a `blob:` URL | `src/renderer/src/screens/cycle/Evidence.tsx:17-46,138-156`, `RunScreen.tsx:113,185` |
| Stage card | `Row` in `StageTimeline.tsx` (head row with name, type, state) | `src/renderer/src/screens/cycle/StageTimeline.tsx:110-126` |
| QA prompt | `guiRules()` says only that a window app can be started "besides the headless browser" when the display is on; nothing tells the agent to run a browser headed | `src/main/runner/prompt.ts:122-132`, `src/shared/i18n/main.en.json:1473` |
| Image encoding | `nativeImage` is used only for the tray icon; there is no JPEG encoder or scaler; `png.ts` encodes RGBA PNG only | `src/main/index.ts:157`, `src/main/evidence/png.ts` |
| Config | Schema 20 on `release/0.9.0`, last step `v19ToV20` | `src/shared/config/types.ts:5` |
| Renderer CSP | The `<meta>` policy has `img-src 'self' data:` with no `blob:`; the web server's header has `data: blob:` | `src/renderer/index.html:16`, `src/main/web.ts:25` |

What was verified on 2026-10-08, by a throwaway Xvfb and a throwaway bwrap run (not by the app):

- Xvfb started with `-fbdir <dir>` writes `<dir>/Xvfb_screen0`, an XWD file of 4,099,232 bytes at 1280x800x24: header size 160, 256 colormap entries of 12 bytes, 32 bpp BGRX pixels from offset 160 + 256*12, 5120 bytes per line. It follows the screen live (a headed Chromium drawn on it showed up in the file).
- Under the same unshare options as `bwrapArgs` (including `--unshare-net`), with a host folder bound over `/tmp/.X11-unix` and another bound at `/coxia/screen` for `-fbdir`, Xvfb `:99` started inside, the socket `X99` appeared in the host folder and the framebuffer file in the screen folder. A Node process on the host connected to that socket and the X11 connection setup returned Success with no authorization. So the main process can be an X client of the sandboxed display with no program inside the sandbox and the sandbox network still unshared. Xvfb set the bound folder to mode 1777; it sits inside the 0700 stage folder.
- XTEST is present on a plain Xvfb. `xdotool` and `xte` are not on the machine, and the app cannot assume them.
- Xvfb already fails to start with `fileMb` as low as 2 (the XKB keymap compile), and the schema allows `fileMb` from 1 (`src/shared/config/schema.ts:519`).

## What changes for the person

- A run whose current stage has a virtual display shows a **Live screen** button on that stage's card, in the desktop app and in the paired browser. It opens a viewer that shows the agent's virtual screen, refreshing about twice a second while it is open. Closing it stops the reading.
- On the desktop, the viewer has a **Take control** switch. With it on, clicks, scrolls and keys in the viewer act on the agent's screen. With it off (the default), the viewer only watches. A paired browser never shows the switch.
- The person's own screen is never shown, and a stage without a virtual display (no display switch, a missing Xvfb, a display that did not come up, a non-QA stage, another operating system) has no button.
- While the display is on, the app records the screen as evidence of the stage. When the stage ends, the recording is one piece of evidence of that stage, shown in the stage's evidence block, with the intervals in which the person used the screen marked.
- A recording that retention has removed says so in place of the viewer, instead of looking like an error.
- With the display on, the QA agent is told to run its browser headed so that it draws on the screen.

## Rules

### 1. Which stages have a live screen

1. **Same screen as the agent.** The live screen of a stage is the virtual display that stage's session started: the sandbox's `:99` or the host display of a `shell: host` agent. The app adds nothing to the screen and never connects to the person's session. (decided D)
2. **Absent when there is no display.** A session whose `gui.display` is not `on`, a non-QA stage, a documentation run (it gets no command door) and any platform other than Linux have no live screen: no button, no recording, no channel answer.
3. **The renderer learns it from the run.** A run handed out by the runner carries a field saying that its working stage has a live screen. Like `command`, it is filled in when the runner returns the run and is never written to the run file. (proposed — confirm at gate 1; the field name is the plan's)
4. **Ends with the stage.** The stage ending, failing, being cancelled or the app closing ends the live screen: the field goes away, the viewer says the stage ended, and no read of the screen happens afterwards.

### 2. How frames reach the viewer (one path for the desktop and the paired browser)

5. **A read channel under `runs:`.** The viewer asks for the latest frame of a run's live screen through an RPC channel in the `runs:` family, passing the sequence number of the frame it already shows and the width it wants. The answer is one of: no live screen; unchanged since that number; or the new number with the image bytes (JPEG) and its size. The channel is classified like the other run reads, so a paired browser may call it (decided A). (proposed — confirm at gate 1: the channel name and answer shape)
6. **Read and encoded on request only.** A frame is read from the screen and encoded when a viewer asks and the last one is older than a short interval (cached, so two viewers cost one read). With nobody watching there is no read for the viewer. (This does not cover the recording, see rule 14.)
7. **The viewer polls.** The viewer asks about twice a second while it is open and stops when it is closed, hidden or the stage ends. An unchanged screen answers "unchanged" without sending image bytes.
8. **A smaller image for the phone.** The paired browser asks for a smaller width than the desktop. (proposed — confirm at gate 1: about 640 px wide at moderate JPEG quality for the phone and the full 1280x800 for the desktop; see the open questions)
9. **Same door as everything else.** The channel goes through the same RPC path as the other run reads: session cookie, `X-Cerimonias` header, origin check and the web policy. It adds no route and no listener. The cost is base64 on the wire (a third more than the JPEG); at the proposed sizes that is far under the body limit.
10. **No broadcast.** Frames never go through `emit()`, because that sends to every paired browser.
11. **Alternatives rejected.**
    - Frames over server-sent events: the stream has no per-client topic, so "only while someone watches" would not hold and every paired browser would receive every frame.
    - A new GET route that streams MJPEG: a new authenticated surface outside the RPC guard (no `X-Cerimonias` header on a GET), with its own cross-site stance to decide.
    - A VNC server or `ffmpeg -f x11grab`: another program to ship, and VNC needs a listener the sandbox does not have.
    - The browser's own screencast (DevTools): covers only browsers, and the agent owns that browser and its port.
12. **Reading the screen file is distrusted input.** The screen folder of a sandbox stage is writable by the agent. The app opens the framebuffer file without following links, only as a regular file, within a size cap, and treats a header that does not match the expected geometry as "no frame". At worst the agent fakes its own screen, which the issue already accepts.
13. **The picture is shown without a new permission.** The frame reaches the page as an image address the page's content security policy allows (see Risks: the desktop `<meta>` has no `blob:`). The choice between `data:` and `blob:` is made by checking in the real renderer, not by assumption.

### 3. Recording the screen as evidence of the stage

14. **Recording is the one thing that reads without a watcher.** The recording needs frames even when nobody watches, which is the exception to "nobody watching costs nothing". To keep it small: while the display is on, the app reads the screen at a low rate (about one frame per second), feeds the video only when the screen changed, and stops at the stage's end. A frame read for a viewer also counts for the recording and is not read twice. The video is capped in length and size; past the cap the recording stops and says so. (decided at gate 1: video; the rate and the caps are the plan's, set from measured sizes)
15. **One piece of evidence, not one video per frame.** At the end of the stage, before the sandbox removes the stage folder (the same place the app already keeps what the agent looked at, before `session.close()` at `executor.ts:904`), the recording becomes one piece of evidence of that stage: one run revision and one post in the run's conversation, titled so that it says the app recorded it. The app, not the agent, owns it; the agent cannot cite it or delete it. (proposed — confirm at gate 1)
16. **The recording is a video.** (decided at gate 1) A WebM video encoded by the app's own Chromium (the media encoder the renderer already uses for voice recording), so no program is installed or shipped and nothing new is downloaded. The time between frames is kept, so an idle stretch plays as a still picture rather than being cut. The evidence type check accepts a WebM video **only for the app's own recording**; a file the agent saves with `SaveEvidence` that is a video is still refused, as today. The 8 MiB limit of a piece does not fit a video; the recording has its own cap, set in the plan.
17. **The person's interval is marked.** The recording marks the intervals in which the person used the screen, so the evidence never credits the agent with what the person did (rule 22).
18. **The viewer shows it after the stage.** When the stage is over the Live screen button gives way to the recording in the stage's evidence block, played in a video player (the content security policy of both the desktop and the web already allows `media-src 'self' blob:`), with a way to download it like any other piece. The intervals in which the person used the screen show as marks on the player's timeline.
19. **Failure is said, not hidden.** A recording that cannot be kept (no frame was ever read, over the limit, the evidence store refused it) is said in the run's conversation with the reason, as `keepLooked` does for an image it could not keep. It never fails the stage.
20. **Cycle folder.** The existing evidence switch that copies pieces into the cycle folder does not copy a screen recording: it is bulky, and a deliverable is not what it is for. (proposed — confirm at gate 1)

### 4. Interaction (desktop only)

21. **Channel outside the `runs:` family, denied to the web.** The input goes through a separate channel (the plan names it; the prefix is its own), which the web policy denies by a **pattern** that covers the whole prefix, so a channel added later under it is closed from the day it exists. A paired browser that calls it is refused. (decided C; proposed — confirm at gate 1: the prefix and pattern)
22. **Input is the person's, and the record says so.** A burst of input is not an agent command: it is not queued behind the agent's commands, does not spend the stage budget and is not logged as a command of the agent. The run's conversation gets one entry per burst, of the kind "the person used the screen from … to …", and the recording marks the same interval (rule 17). (proposed — confirm at gate 1)
23. **How it reaches the screen.** The main process is an X client of the stage's display and sends XTEST events: pointer move, button press and release (and scroll, as buttons), key press and release. No program is installed, no program runs inside the sandbox, and the sandbox network stays unshared. For a sandbox stage the display's socket is made reachable from the host by binding a host folder in the stage folder over the sandbox's `/tmp/.X11-unix`; for a host display the app connects to the socket the display already has. (verified 2026-10-08 for the sandbox case; the host case is the same protocol on a socket the app already reaches)
24. **Take control is explicit.** Nothing is sent until the person turns "Take control" on, and turning it off, closing the viewer or the stage ending stops it. The viewer shows plainly while it is on. (proposed — confirm at gate 1)
25. **What counts as input.** Pointer position (in the screen's own pixels, mapped from the viewer), left, middle and right buttons, scrolling, printable characters, and the common control keys (Enter, Tab, Escape, Backspace, Delete, arrows, Home, End, Page Up, Page Down) with Shift, Control and Alt. Paste, drag from outside the viewer and file transfer are not covered. (proposed — confirm at gate 1)
26. **Not an external effect.** Nothing leaves the machine and nothing is written to a code host, so this is not a proposal that waits in `actions:approve`. It acts on the stage's own virtual screen, which the agent drives already. Anything the agent's app then does keeps its own limits (the sandbox, or for `shell: host` the host command approval).
27. **A test workspace.** The workspace guard that refuses external writes is not involved, since nothing external is written; the live screen works in a test workspace like the rest of the run.

### 5. The QA prompt

28. **Headed browser when the display is on.** With the display on, the QA agent's prompt says to run the browser headed so that it draws on the virtual screen, in both languages (`prompt.sdd.runner.rules.gui.display`, English and pt-BR). With the display missing or failed, the prompt is unchanged. The stage's goldens that include this key are updated.

### 6. Retention of the recordings

29. **A retention group for screen recordings.** Retention gets a group for screen recordings, swept like the other groups. It uses the workspace's existing retention switch and number of days, so it needs no new setting by itself. Retention is off by default (`enabled: false`), so a recording is kept until retention is turned on or the person deletes it. (proposed — confirm at gate 1; see the open question on the default)
30. **What retention touches.** Only the app's copy of the recording. A recording already copied to a cycle folder or posted to a code host is not touched, because the app never rewrites what it published.
31. **The record stays.** When the file goes, the run keeps the record of the piece marked as removed by retention, and the stage shows that instead of an error.
32. **Nothing else expires.** Other evidence (the agent's screenshots and files) is not swept by this issue.

### 7. What stays the same

33. **Stages without a display** run and look as today.
34. **The agent's screenshots and `SaveEvidence`** work as in #121, #142 and #143. The recording is one more piece, not a replacement.
35. **The display** keeps its size, its limits and its absence of any TCP listener.

## Out of scope

- The person's own screen and any display that is not the one a QA stage started.
- Operating systems other than Linux.
- Audio.
- The headless browser's own screencast (DevTools).
- Several people sending input at once, and any arbitration beyond "only the desktop window can send".
- Remote control from the phone: the paired browser watches only.
- Paste, file transfer and clipboard between the viewer and the screen.
- Video from the agent: `SaveEvidence` keeps refusing video; only the app's own recording is a video.
- Other video formats (mp4 and the rest): the recording is WebM only.
- Retention for evidence other than screen recordings, and wiring `dropRunEvidence` to run removal.
- Fixing a very low `fileMb` that already breaks Xvfb (named in Risks, not changed here).
- A new kind of schedule or notification when a stage opens its screen.

## Acceptance criteria

Verifiable on screen or by test.

1. A unit test of the XWD parser covers: the expected 1280x800x24 file giving the right pixels (BGRX to the image the encoder takes); a header of another size, a wrong pixel format, a truncated file and a file larger than the cap each giving "no frame".
2. A test shows that, with a viewer never opened, the frame reader is not called for the viewer; with one open, it is called at most once per interval whatever the number of viewers; and an unchanged screen answers "unchanged" without bytes.
3. A test shows that capture (viewer and recording) stops when the stage closes, and that no read of the screen file happens after `session.close()`.
4. Policy tests: the frame channel answers `allow` for a paired browser and is listed with the other run reads in `test/runs-policy.test.ts`; the input channel answers `deny` through the pattern, and a made-up channel under the same prefix is denied too.
5. A test shows that input is not queued behind a running agent command, does not spend the stage budget, and is not reported as a command of the agent. It is recorded in the run's conversation as one entry per burst, with the interval.
6. A test of the XTEST client against a fake X server covers the connection setup, a pointer move, a button press and release, a key press and release, and a reply that does not parse (the client closes and reports "not delivered" without throwing).
7. A test shows that the recording is kept as one WebM video, one piece of evidence of the stage, before the stage folder is removed (the file exists when the evidence store copies it), with one run revision and one post, and that a recording that cannot be kept is said in the conversation without failing the stage.
8. A test shows the recording's length and size stay under the caps (and that hitting a cap stops the recording and says so), that the person's intervals are marked, and that the type check accepts the app's WebM recording while `SaveEvidence` still refuses a video from the agent.
9. A retention test shows the group lists and removes only screen recordings, leaves the record marked, and leaves other evidence and any cycle-folder copy alone.
10. A prompt test shows the headed-browser text with the display on, in both languages, and its absence when the display is missing or failed; the sandbox and host tests (`test/sandbox-gui.test.ts`, `test/host-gui.test.ts`) are updated for the new bind and the new display argument.
11. On screen, on a Linux machine with Xvfb: a QA stage with the display on shows Live screen on its card; opening it shows the agent's headed browser, updating; on the desktop, Take control lets a click and a typed key reach the page; in the paired browser the same viewer opens with a smaller image and no Take control; after the stage ends there is one video in the stage's evidence block that plays, with the person's intervals marked.
12. On screen: a stage without a display, a failed display, or a non-QA stage shows no button; the viewer says so when the stage ends while it is open.
13. Every new string is in both catalogs (`npm run i18n:lint` passes); the viewer, the switch, the marks and the recording use theme tokens and `node scripts/theme-audit.mjs` passes; `node scripts/public-audit.mjs` passes.
14. The picture displays in the real desktop renderer and in the paired browser under their content security policies (checked, not assumed).

## Risks

- **Content security policy.** The desktop `<meta>` allows `img-src 'self' data:` and no `blob:`, while `Evidence.tsx` builds `blob:` addresses. Whether those show today was not checked. For the live frame, `data:` works under both policies; the choice is settled by a check in the real renderer, and the same check tells whether the recording can be shown through the existing evidence code.
- **A low `fileMb` breaks Xvfb.** The display runs under the stage's `prlimit --fsize` and its framebuffer file is 4.1 MB; Xvfb already failed to start at 2 MiB. A very low `fileMb` therefore breaks the display, with or without this issue; the stage already goes on without a display and says so. Not changed here.
- **The agent can write the screen folder.** It can fake its own screen. The reader is defensive (rule 12). The recording is as trustworthy as the agent for a sandbox stage; the issue accepts this.
- **The host display's screen folder** sits in a folder readable by any process of the person, and the display is reachable by any local process of that user. On `shell: host` the agent already runs as the person, so the confinement the sandbox gives does not exist there.
- **What shows on the agent's screen reaches a paired browser** and goes into the recording and the conversation. Taking control adds the person's own typing: a password typed into the agent's app would be on the screen and in the recording. The viewer must make the recording and the control state visible while on; whether frames are paused while controlling is an open question.
- **Mmap and tearing.** Xvfb keeps the framebuffer in a memory-mapped file: a read can catch a half-drawn frame, and whether the file's modification time changes on writes was not checked, so "did the screen change" is decided by content, not by `mtime`.
- **The folder bound over `/tmp/.X11-unix`** is created by the app and Xvfb sets it to 1777. It sits inside the 0700 stage folder, so other users cannot reach it; a process of the same user can, as it can reach the stage folder.
- **A malicious window under test** could send crafted X replies to the app's client. The client only parses what it expects, with sizes bounded, and closes on anything else.
- **`nativeImage` runs only in Electron**, not in the Vitest environment: it is injected in the code that uses it, and the tests cover the parser, the cache, the policy and the XTEST client around it.
- **Memory and disk.** Frames are 4.1 MB raw. Reading and encoding happens on request or at the recording interval, never in a loop with nobody asking. The recording is capped in frames and bytes (rule 14).
- **Schema collision.** If configuration is needed, it is schema 21 on top of 20, and an open change that bumps the schema would collide. This spec asks for no setting beyond what the person can already set (the display switch and the retention switch and days); whether recording needs its own switch is a question for the plan.
- **Evidence kept in the app's folder outlives the stage** until retention is turned on. That is how all run evidence works today.

## What this step did not verify

- The app, the real sandbox and the test suite were not run. The spike used a throwaway bwrap and Xvfb outside the app.
- That an XTEST client in Node works from the Electron main process against the sandbox socket, beyond the connection setup that returned Success.
- That a `blob:` image displays under the desktop `<meta>` policy.
- That a host display started with `-fbdir` behaves like the sandbox one (the same Xvfb, so expected).
- The size of a JPEG at the proposed widths and quality, and the size of a recording at the proposed rate; these set the real caps.
- Whether another open change bumps the config schema.

## Open questions

Each with the recommended answer, for the maintainer at gate 1.

1. **Format of the recording.** Options:
   - An animated image (GIF or WebP). The type check already accepts both and the 8 MiB limit applies; it needs an encoder, and GIF is limited to 256 colors, so WebP is better for a screen but needs an encoder the app does not have today.
   - A new "screen recording" kind: a frames folder plus a manifest, shown as a scrubber in the viewer. It keeps the marks and the exact frames and has no encoder, but it touches the evidence kinds, the store, the forum attachment and the code host embed (a code host cannot show it).
   - A contact sheet: one image with frames in a grid. No encoder beyond the PNG one the repository has, shows on a code host, but loses the time order and the marks.
   - **Recommended:** the contact sheet as the posted piece (it shows everywhere and fits the existing kind and limit), plus the frames kept in the app's folder as the scrubber's source, if the plan finds the cost small; otherwise the animated image. The maintainer chooses.
2. **Retention default.** Retention is off by default, with 30 days when on. **Recommended:** recordings join the existing switch and days and add no setting; the group is listed in the retention preview so the person sees its size before turning retention on. A separate shorter default for recordings only if the maintainer wants it.
3. **Frame size and rate for the phone.** **Recommended:** about 640 px wide, JPEG quality around 60, about 2 frames per second, and a lower rate (about 1 per second) when the phone's connection is slow; the desktop gets 1280x800 at quality around 75. To be tuned against measured sizes.
4. **Does Take control pause or warn the agent?** The agent's commands keep running either way. **Recommended:** warn, not pause: the app adds a line in the run's conversation when the person takes control and when it ends (rule 22), and the agent's next result is not changed. Pausing the agent would add a state the runner does not have.
5. **Does the host display (`shell: host`) get interaction too?** The agent there already runs as the person. **Recommended:** yes, the same viewer and the same switch, because the protocol and the person's role are the same, and the screen is the stage's own virtual one, never the person's.
6. **Are frames paused while the person controls the screen?** To lower the chance of recording a typed secret. **Recommended:** no, keep and mark them, and show a clear recording indicator while control is on; a pause would hide what the person did from the evidence.
7. **Is a recording copied to the cycle folder** when `runner.evidence` is `cycle`? **Recommended:** no (rule 20).

## Gate 1 decisions

Answers of the maintainer on 2026-10-08, closing gate 1:

1. **Format of the recording: video** (none of the options listed above). The spec now says a WebM video from the app's own encoder (rules 14, 16, 18); the encoder's placement and the caps are for the plan.
2. **Retention:** as recommended, recordings join the existing switch and days.
3. **Phone frame size and rate:** as recommended.
4. **Take control warns, does not pause** the agent.
5. **`shell: host` gets interaction too**, with the same viewer and switch.
6. **Frames are not paused while the person controls**; they are kept and marked, with a clear recording indicator.
7. **The recording is not copied to the cycle folder.**

## Gate 2 amendments

Approved by the maintainer on 2026-10-08 together with the plan; they override the rules above where they differ.

1. **Frame source.** Frames come from the display server through the same X connection that carries the input (`GetImage`), not from an `-fbdir` file. Rule 12 applies to the X replies instead of a file (bounded parsing, a geometry that does not match is "no frame"), and acceptance criterion 1 tests the `GetImage` reply parser. The `-fbdir` file stays only as the plan's fallback.
2. **The recording is kept whatever the end of the stage.** Rule 15 holds for a stage that failed or was cancelled too, not only for one that reached its answer.
3. **The run format version goes up** when a run holds a recording, so an older app refuses that run as written by a newer app instead of reading it as invalid (see the plan's gate 2 decisions).
