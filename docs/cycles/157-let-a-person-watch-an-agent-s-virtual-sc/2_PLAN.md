# Let a person watch an agent's virtual screen live: technical plan

This plan decides the *how* of what the spec fixed: a **Live screen** button on a running QA stage, a viewer that polls about twice a second in the desktop app and in the paired browser, a **Take control** switch on the desktop only, a WebM recording of the screen kept as one piece of evidence of the stage, a retention group for those recordings, and one sentence in the QA prompt. It does not reopen behavior: the 35 rules, the 14 acceptance criteria and the seven gate 1 decisions are data here. The one place where the plan departs from the wording of the spec is the frame source (section 2.1); it is listed under "Spec amendments" for the maintainer to approve at gate 2.

Everything below comes from reading the code of this tree (`release/0.9.0`, 0.9.0-beta.1, schema 20) and from the two checks the main session ran on 2026-10-08, marked **verified**. Nothing else was run: no test, no `tsc`, not the app.

**Verified 2026-10-08 (main session, outside the app, on a throwaway Xvfb):**

- Under the same unshare options as `bwrapArgs` (including `--unshare-net`), with a host folder bound over `/tmp/.X11-unix`, a dependency-free Node client of about 40 lines on the host connected to the socket file in that folder. Connection setup returned Success with no authorization; the root window came from the setup reply; `QueryExtension "XTEST"` answered present, major opcode 132; `XTestFakeInput` MotionNotify moved the pointer (`QueryPointer` went from (640,400) to (321,456)); ButtonPress 1 set the button mask `0x100` and ButtonRelease 1 cleared it. Layout used: the request is 36 bytes, length field 9, byte 0 major opcode, byte 1 minor 2, byte 4 type, byte 5 detail, bytes 8-11 time 0, bytes 12-15 root, bytes 24-27 rootX and rootY as int16, byte 35 device id 0. `QueryPointer` is opcode 38; its reply has root_x at offset 16, root_y at 18, mask at 24. **Not tested:** key events (keysym to keycode through `GetKeyboardMapping`) and the same client inside the Electron main process instead of plain Node.
- Electron from the repo's `node_modules` on a host Xvfb: a hidden `BrowserWindow` (`show: false`, `backgroundThrottling: false`) with a 1280x800 canvas, `canvas.captureStream(0)` fed by `track.requestFrame()` into a `MediaRecorder` (timeslice 1000, 500 kbit/s). The first supported mime type was `video/webm;codecs=vp9`; the bytes went to the main process over IPC and were written to a 31,518-byte file that starts with the EBML magic. ffprobe read vp9 at 1280x800 and `duration=N/A` (no Duration, no Cues). Of 8 frames requested over about 6.5 s, one gap of 3 s included, **6 were in the file**: frames requested at `start()` or in quick succession were dropped.

## Answers to what the spec left for the plan

| Spec question | Answer | Decision |
|---|---|---|
| Name and shape of the read channel (rule 5) | `runs:screen(run, since, width)`, answer `none` / `same` / `frame` | D5, 2.5 |
| Prefix and pattern of the input channel (rule 21) | `screen:control` and `screen:input`; the pattern `/^screen:/` denies the whole prefix | D6, 2.5 |
| Name of the field that tells the renderer (rule 3) | `Run.screen`, a `LiveScreen`, filled when the runner hands a run out, never saved | D7, 2.6 |
| The caps of the recording (rule 14, 16) | 24 MiB and 60 minutes of recorded time, one frame per second at most, only on change; tuned by the spike | D11, 2.3 |
| Where the encoder lives (rule 16) | A hidden helper window in the main process, WebCodecs `VideoEncoder` (VP8) with a muxer of our own; `MediaRecorder` is the fallback | D3, D4, 2.3 |
| Does recording need its own switch? (Risks) | No. The display switch already decides it; recording follows it | D12, open question 1 |
| `data:` or `blob:` for the live frame (rule 13) | `data:` for frames, `blob:` for the video; both confirmed in the real renderer before the UI commit | D9, 2.8 |
| Is configuration needed? | No. No field, no schema bump, no migration | D13, section 4 |

## Spec amendments to approve at gate 2

1. **Frame source (rule 12, acceptance criterion 1).** The spec was written around reading the framebuffer file of `-fbdir`. The plan reads each frame with the X11 `GetImage` request over the connection that also carries the input. Rule 12 becomes "the reply of the display server is parsed with every size bounded, and a reply that does not match the expected geometry is no frame", and criterion 1 becomes a test of the `GetImage` reply parser (the expected 1280x800x24 reply gives the right pixels; a size other than the root's, a wrong depth, a truncated reply and a reply over the cap each give "no frame") instead of an XWD parser. Everything else in the spec stands. Section 2.1 gives the reasons and the fallback.
2. **The recording is kept in the `finally` of the stage, not only on success (rule 15).** The spec says "at the end of the stage, before the sandbox removes the stage folder". `keepLooked()` runs only when the stage reaches its answer (`src/main/runner/executor.ts:904`); a stage that fails or is cancelled is exactly the one whose recording a person wants. The plan keeps the recording just before `await session?.close()` in the `finally` (`executor.ts:916`), so every end of a stage keeps it. `keepLooked()` does not move.

## 1. What is built

| Piece | Where it lands |
|---|---|
| Shared types and constants: `LiveScreen`, `ScreenFrameAnswer`, `ScreenInput`, `ScreenControlAnswer`, `RecordingMeta`, the caps, `SCREEN_EVENT` | `src/shared/screen.ts` (new); `Run.screen?` next to `command?` in `src/shared/runs/types.ts:384` |
| A dependency-free X11 client: setup, `QueryExtension`, `GetGeometry`, `GetImage`, `GetKeyboardMapping`, `GetInputFocus`, `XTestFakeInput` | `src/main/screen/x11.ts` (new) |
| Input planning: events from the viewer to X requests, keysym table, keymap lookup, shift handling | `src/main/screen/xinput.ts` (new) |
| Frame handling: alpha fix, change hash, JPEG through an injected `nativeImage` | `src/main/screen/frame.ts` (new) |
| The registry of live screens, the frame cache, the control state, the bursts, the recording loop | `src/main/screen/hub.ts` (new) |
| The recorder: change-only feeding, caps, marks, the sink interface | `src/main/screen/recorder.ts` (new) |
| The WebM muxer (pure) | `src/main/screen/webm.ts` (new) |
| The hidden helper window that encodes, and its page and preload | `src/main/screen/encoderWindow.ts`, `src/main/screen/encoder.html`, `src/preload/encoder.ts` (new); a second preload entry in `electron.vite.config.ts` |
| The `screen:*` channels | `src/main/screen/module.ts` (new), one line in `src/main/modules.ts` |
| `runs:screen` and `Run.screen` | `src/main/runner/module.ts` (next to `runs:evidence`, line 181), `src/main/runner/service.ts` (next to `withCommand`, lines 397-400, 1075-1076) |
| The display socket reachable from the app | `src/main/sandbox/policy.ts` (a bind, near lines 103-104), `src/main/sandbox/index.ts` (the folder, near lines 250-251 and 268-269; the host path, near 298-309), `src/main/sandbox/session.ts` and `host.ts` (`SandboxSession.screen`) |
| Open the screen at the start of the stage, keep the recording at its end | `src/main/runner/executor.ts` (`openStageSandbox` at 309-370; `finally` at 909-916; `executeStage` `finally` at 472-475) |
| A WebM kind for the app's own recording | `src/shared/evidence.ts`, `src/main/evidence/recording.ts` (new), `src/main/evidence/store.ts`, `src/main/evidence/handlers.ts:31`, `src/shared/runs/schema.ts:146-165` |
| The post in the run's conversation, authored by the app | `src/main/runner/service.ts:339-360` (`keepEvidence`) |
| Retention group for the recordings | `src/shared/retention.ts`, `src/main/retention.ts`, `src/main/retention-core.ts` (no change expected), `src/shared/runs/transitions.ts` (a transition that marks the record) |
| The web policy | `src/main/webPolicy.ts` (a pattern next to `AGENT_ASSIST`, line 67) |
| The Live screen button and the viewer | `src/renderer/src/screens/cycle/StageTimeline.tsx` (`Row`, lines 110-154), `LiveScreen.tsx` (new), `screenApi.ts` (new), `screenKeys.ts` (new), `cycle.css`, `src/renderer/src/screens/Sheet.tsx` (a switch that leaves the keys to the viewer) |
| The player with the person's intervals marked | `src/renderer/src/screens/cycle/Evidence.tsx`, `RecordingPlayer.tsx` (new), `Thread.tsx:104-106` (the inline attachment) |
| The QA prompt | `src/shared/i18n/main.en.json:1473` and `main.pt-BR.json:1473` (`prompt.sdd.runner.rules.gui.display`) |
| Catalog keys | `src/shared/i18n/ui-cycle.*.json`, `ui-settings.*.json` (retention kind), `main.*.json` |
| CHANGELOG and documentation | `CHANGELOG.md` (`## [Unreleased]`), `docs/runner.md` (the paragraph at line 353) |

## 2. What the plan decides, and with what

### 2.1 The frame source: X11 `GetImage` over the same connection as the input (D1, D2)

**Decision.** The main process opens **one** X connection per live screen, **before the stage's first command**, and keeps it until the stage ends. The same connection answers `GetGeometry`/`GetImage` of the root window for every frame, and carries `XTestFakeInput` for the input. There is no `-fbdir`, no `screen` folder, no change to the `Xvfb` command line (`policy.ts:129`), to `SUPERVISOR_SH`, or to `HOST_DISPLAY_ARGS` (`src/main/sandbox/display.ts:21`).

**Why this and not the framebuffer file.**

- One channel for both directions. The input needs the socket anyway (rule 23, verified). Reading the file as well would add a second source, a second folder to bind, a second place where the agent can write what the app reads, and a second set of limits.
- The agent cannot write the pixels we read. With `-fbdir` the file sits in a folder the sandboxed process can write (the spec's rule 12 and its risk "the agent can write the screen folder"). With `GetImage` the pixels come from the display server, which only the window system draws on; the agent can still draw whatever it wants on its own screen, which the issue accepts.
- No tearing and no question about `mtime`. The framebuffer is a memory-mapped file that Xvfb writes while it is read (spec risk "Mmap and tearing"). A `GetImage` reply is a consistent copy made by the server.
- The host display needs nothing new. For a `shell: host` agent the display is started by `startHostDisplay` with `-displayfd` before the session exists (`src/main/sandbox/index.ts:298-309`); an `-fbdir` there would need a folder made before the display and handed to the session. With `GetImage` the app connects to `/tmp/.X11-unix/X<N>` the display already has.
- The fixed cost is small: a `GetImage` of 1280x800 at depth 24 is 4,096,000 bytes through a unix socket, the same size as the file read it replaces.

**What it costs.** Viewer and input now depend on the single socket bind: if it does not work, there is no live screen at all (with `-fbdir` the frames would have survived). That is acceptable because the stage then says so (`runner.screen.noConnect`, section 2.6) and goes on, as it does for a display that did not come up.

**The socket is the one thing the agent controls, so the connection is made once, early.** In a sandbox stage the folder bound over `/tmp/.X11-unix` is writable from inside. If the app dialled the path after the agent had run, the agent could replace `X99` with a link to some other socket of the person's (their real display, for instance) and the app's client would send pointer and keys to it. The design closes that by order, not by checking: `openStageSandbox` connects right after the session is open and the supervisor has said `ready` (`session.ts` returns only then), when no command of the agent has run; it `lstat`s the path first and refuses anything that is not a socket; and it never dials again (a lost connection ends the live screen). For the host display the same order holds: the connection is made when `startHostDisplay` has reported the display name.

**Bounds of the X client.** The connection order above already keeps the agent from standing behind the socket, but the parsing is bounded anyway, as the spec asks ("a malicious window under test" risk):

- connection setup: the reply is read in full only up to 64 KiB of additional data; vendor length, number of formats and number of screens are checked against it; only the first screen is read;
- any reply is at most 16 MiB; a `GetImage` reply must be exactly the size the geometry implies; a `GetKeyboardMapping` reply at most 64 KiB;
- one request in flight; each has a timeout (3 s; 5 s for `GetImage`); an X *error* packet fails that request only; an event packet is skipped (32 bytes); a packet type or length outside what is expected closes the connection and reports "not delivered" without throwing;
- geometry is asked before every `GetImage` (`GetGeometry` on the root, 14), because a window app can resize an Xvfb that allows it; width and height above 4096 or `width * height * 4` above 16 MiB is "no frame".

**Fallback.** If the spike (section 6, S1) shows `GetImage` too slow on the real display (more than about 100 ms for a full frame) or refused, the frame source falls back to `-fbdir` read with a defensive XWD parser, exactly as the spec wrote it; the hub reads frames through a `grab()` function, so only that function changes. Input still uses the socket.

### 2.2 The X client (D2)

`src/main/screen/x11.ts`, `net` only, no dependency.

- **Connection:** `connectX11(path, deps)` returns `{ root, width, height, depth, bytesPerPixel, keycodes, grab(), fakeInput(events), keymap(), close() }`. `deps.connect` is injected so a test supplies a unix socket server. Byte order is little-endian (`l`); the client refuses a server that answers in another image byte order.
- **Requests:** setup (12 bytes), `QueryExtension "XTEST"` (98), `GetGeometry` (14), `GetImage` (73, format ZPixmap, plane mask all ones), `GetKeyboardMapping` (101), `GetInputFocus` (43, used as a barrier after a batch: its reply arrives after every earlier request has been processed, so an error packet that came before it names a request that failed), and `XTestFakeInput` (minor 2 of the extension; layout as verified above).
- **Pointer:** absolute `MotionNotify` (type 6, detail 0, root = the root window, rootX/rootY in screen pixels); buttons 1-3 press and release; scroll as buttons 4 and 5 (press and release, one pair per notch, at most 5 notches per event).
- **Keys:** `keymap()` reads the whole mapping once per connection (min and max keycode come from the setup reply) and builds `keysym -> { keycode, shift }` from columns 0 and 1. The viewer sends `KeyboardEvent.key` (a name such as `Enter`, or one character); `xinput.ts` maps names to keysyms from a table (Enter `0xff0d`, Tab `0xff09`, Escape `0xff1b`, Backspace `0xff08`, Delete `0xffff`, arrows `0xff51`-`0xff54`, Home `0xff50`, End `0xff57`, Page Up `0xff55`, Page Down `0xff56`, Shift/Control/Alt left `0xffe1`, `0xffe3`, `0xffe9`) and a character to its Latin-1 keysym (the code point) or `0x01000000 + code point`. A character found in column 1 is sent as press Shift, press, release, release Shift. A key the keymap does not have is **rejected and counted**, so the viewer can say it was not delivered, instead of dropping it silently.
- **Not covered by the client:** paste, drag from outside, clipboard (spec rule 25).
- **Where it lives:** `src/main/screen/`; nothing in `src/shared/` or the renderer imports `net`.

### 2.3 Encoding: JPEG for the live view, WebM for the recording (D3, D4, D10, D11)

**Live frames.** The raw reply is BGRX (the pad byte is not alpha). `frame.ts` sets the pad byte to `0xff` in place (one pass over a `Uint32Array`, before hashing, so a stray pad byte never makes a frame "changed"), hashes the 4 MB with `crypto.createHash('md5')` to decide *changed*, and encodes on request with the injected `nativeImage`: `createFromBitmap(buffer, { width, height })`, `.resize({ width, quality: 'good' })`, `.toJPEG(quality)`. The desktop asks for 1280 at quality 75; the phone asks for 640 at quality 60 (gate 1 decision 3). `nativeImage` is a parameter of `createFrameEncoder({ nativeImage })`; `src/main/runner/module.ts` passes the real one, tests pass a fake that records its arguments (`test/helpers/electron.ts` makes `electron` export no API in plain Node). The widths are clamped to 320..1280 in steps of 80 so the encode cache has a bounded number of keys; the cache keeps the last JPEG per width for the current sequence number and nothing else.

**The recording: (b), WebCodecs `VideoEncoder` and a muxer of our own, with (a) as the fallback.** Both were compared against what the main session verified:

| | (a) `canvas.captureStream` + `MediaRecorder` in a hidden window | (b) `VideoEncoder` (VP8) in a hidden window + our muxer |
|---|---|---|
| Works today | **Verified**: produces a WebM, no new dependency | Not verified in this Electron; the spike S3 decides |
| Time of a frame | The recorder stamps it with the wall clock when the frame is drawn; a still screen produces *no* frame unless the last one is re-requested at the rate; frames requested at `start()` or in a burst were dropped (6 of 8, verified) | Explicit timestamp in microseconds per frame, set by main from its own clock; an idle stretch is a gap between two timestamps and a `Duration` that includes it; no frame is dropped silently |
| Duration and seeking | **None**: no `Duration`, no `Cues` (ffprobe says `N/A`, verified). The marks on the timeline need a known duration and a seekable file, so (a) needs a rewrite of the file in main (patch `Duration`, append `Cues` by scanning the clusters): about the same work as a muxer, on a layout we do not control | We write `Duration`, `Cues` (one per keyframe cluster) and every size ourselves; seekable by construction |
| Tested in Vitest | Only the patch step | The muxer is pure Node; the recorder logic runs against a fake sink; only the thin Electron glue is out of reach |
| Real-time dependence | Runs on the helper's clock (a timer in a hidden renderer, throttling to be switched off) | Message-driven: the helper encodes when a frame arrives, so throttling does not matter |
| Cost | A smaller patch in the best case | The muxer (about 200 lines: EBML header, Segment, Info, Tracks, Clusters of `SimpleBlock`s, Cues) and the WebCodecs spike |

**Recommendation: (b).** The two caveats the main session measured on (a) are exactly the two things the spec asks of the recording: the time between frames kept, and marks on a timeline. (b) gives both by construction and keeps the logic testable. **If S3 fails** (no `VideoEncoder` for VP8 in the helper, or `isSecureContext` false for the way the page is loaded, or the output does not play), the plan falls back to (a) plus a main-side rewrite: feed the first frame again after `start()`, re-request the last frame at the recording rate so a still screen advances time, and patch `Duration` and append `Cues` in `webm.ts` (a different function in the same file; the rest of the pipeline does not change, because `recorder.ts` talks to a sink).

**The helper window.**

- One shared hidden `BrowserWindow` for all recordings, created at the first recording and destroyed 30 s after the last one ends; each recording has an id. `show: false`, `backgroundThrottling: false`, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, its own in-memory `partition`, `will-navigate` and window-open denied, every permission request denied, CSP `default-src 'none'; script-src 'unsafe-inline'` on a page that loads nothing.
- The page is a self-contained `encoder.html` imported with `?asset` and loaded with `loadFile`, and a second preload entry `encoder.cjs` (`electron.vite.config.ts:24-26` already names preload outputs `[name].cjs`). The preload exposes three functions through `contextBridge`: `onFrame`, `onFinish`, and `chunk`. Main -> page goes by `webContents.send`; page -> main by `ipcRenderer.send` on a channel that is not in `modules.ts`, so neither the web nor the main window can reach it, and the handler checks `event.sender.id` against the helper's id.
- Per frame main sends `{ rec, ts, width, height, data }` with the raw 4 MB BGRX buffer; the page makes `new VideoFrame(data, { format: 'BGRX', codedWidth, codedHeight, timestamp: ts * 1000 })`, calls `encoder.encode(frame, { keyFrame })` with a forced keyframe every 10 s of media time (so a seek never needs more than 10 s of decode), and closes the frame. If `encoder.encodeQueueSize` is above 4, main drops that frame and keeps the clock (the next change feeds it).
- Encoder configuration to start from, tuned by S3: `{ codec: 'vp8', width: 1280, height: 800, bitrate: 250_000, framerate: 1, latencyMode: 'quality' }`.
- Chunks go back as `{ rec, ts, key, data }` and are held in memory in main (bounded by the cap). `finish(rec)` sends `flush`, waits for the page to say done (10 s timeout), and `webm.ts` builds the file.

**Mime type and container.** VP8 in WebM (`video/webm`, `V_VP8`). The evidence media type is `video/webm`; the player uses `type="video/webm"` on a `blob:` URL. VP8 is chosen over VP9 because it encodes in software at a fraction of the cost and plays everywhere Chromium plays WebM; whether the phone's browser plays VP8 WebM is a risk (8) the manual test covers, and the download link is the way out.

**Caps** (constants in `src/shared/screen.ts`, tuned from the spike's measured sizes):

- `RECORDING_MAX_BYTES = 24 MiB` of encoded video, its own cap; the 8 MiB `EVIDENCE_MAX_BYTES` (`src/shared/evidence.ts:28`) is untouched and still applies to everything else. 24 MiB because the piece travels to a phone as base64 inside a JSON answer (`src/shared/wire.ts:12-35`), a third larger.
- `RECORDING_MAX_MS = 60 min` of recorded time, and at most 1 frame per second.
- Past either cap the recorder stops feeding, the file is finished with what it has, `meta.truncated` is `'size'` or `'time'`, and the thread says so once (`runner.screen.capped`). The stage is never affected.

**The video reaches main and the evidence store as bytes in memory**, not as a file in the stage folder: nothing the recording needs lives in the folder `session.close()` removes, so the "copy before the folder goes" of the spec is satisfied by construction. `putRecording` (2.4) writes it into the evidence store atomically.

### 2.4 Evidence changes (D8)

- **A new kind.** `EVIDENCE_KINDS` gets `'webm'` (`src/shared/evidence.ts:8`), `EVIDENCE_EXT.webm = 'webm'`, `EVIDENCE_KIND_MEDIA.webm = 'video/webm'`. `isEvidenceImage` stays false for it. `KIND_TEXT` in `src/main/evidence/handlers.ts:31` (a `Record` over the kinds) and the run schema enum (`src/shared/runs/schema.ts:157`) follow; `tsc` finds the rest. `freeEvidenceId` (`store.ts:40`) already walks every extension, so ids stay unique.
- **`detectKind` is not touched.** It keeps refusing Matroska/WebM as `video` (`src/main/evidence/type.ts:66`), so `SaveEvidence` from the agent, which goes through `putEvidence`, still refuses a video. The app's own recording goes through a **new** function, `putRecording(dataDir, run, { bytes, stage, by, title, meta, at })` in `src/main/evidence/recording.ts`: it checks the EBML magic and the `webm` DocType in the first 64 bytes, checks `bytes.length <= RECORDING_MAX_BYTES`, writes `ev-N.webm` through the same temp file and rename (mode 0600, flag `wx`) that `putEvidence` uses (`store.ts:84-87`), and returns the record. It is the only caller that can produce `kind: 'webm'`.
- **The record.** `EvidenceRecord` gets two optional fields (section 3): `recording` (the meta) and `removed`.
- **One piece, one revision, one post.** `keepEvidence` (`service.ts:339-360`) is called once: one `moveRun` (one revision) and one forum post. The post is authored by the app, not by an agent, when `record.recording` is set; its attachment carries `media: 'video/webm'`. The title reads "Screen recording of the stage (made by the app)" (`main.evidence.screenRecording`).
- **The agent cannot cite it or delete it.** It is not pushed into `keptIds`/`keptRecords` of the stage, and two filters drop it from what an agent could name: the `known` set at `executor.ts:922` excludes any record with `recording`, and `stageResume` (`executor.ts:175`) does not list it. `ViewImage`, `AnnotateImage` and `SaveEvidence` already refuse a record that is not an image (`isImageRecord`, `store.ts:157`). Deleting is `runs:evidenceDelete`, the person's.
- **The code host.** A recording is never in a cited list, so `uploadsOf` (`store.ts:160`) never reads it, and `isUploadable` (`evidence.ts`) already refuses anything that is not an image. A code-host post does nothing with it, and says nothing about it.
- **The cycle folder.** The copy loop at `executor.ts:973-981` iterates `keptRecords`, which never holds the recording. Nothing to change; a test pins it (gate 1 decision 7).
- **The forum post shows a video.** `EvidenceAttachment` (`Evidence.tsx:159`) opens an image inline and treats anything else as a card. For `video/` media it opens a `<video controls preload="none">` on the blob URL after a click; the marks are shown only in the evidence block's player (2.8).
- **The marks** are stored in `record.recording.marks` (ms from the start of the recording), shown on the player's timeline.

### 2.5 Channels and policy (D5, D6)

| Channel | Arguments | Answer | Policy |
|---|---|---|---|
| `runs:screen` | `run: string`, `since: number` (the sequence number the viewer shows, 0 for none), `width: number` | `{ state: 'none' }`, or `{ state: 'same', seq, control }`, or `{ state: 'frame', seq, width, height, screen: { width, height }, jpeg: Uint8Array, control }` | open (a read of the runs family); listed in `READS` of `test/runs-policy.test.ts:10` |
| `screen:control` | `run: string`, `on: boolean` | `{ ok: boolean, reason?: 'none' }` | denied by the pattern |
| `screen:input` | `run: string`, `events: ScreenInput[]` (at most 64) | `{ ok: boolean, delivered: number, rejected: number, reason?: 'none' \| 'off' }` | denied by the pattern |

- `ScreenInput` is `{ t: 'move', x, y }`, `{ t: 'button', b: 1 | 2 | 3, down }`, `{ t: 'scroll', dy }` and `{ t: 'key', key, down }`, each field type- and range-checked in main (`key` at most 32 characters); an event that fails the check is *rejected*, not an error. `runs:screen` and `screen:*` never throw on state (an unknown run, a stage that ended): they answer `none`, so a viewer that outlives the stage says "the stage ended" instead of failing. Only a malformed argument list is an error.
- **The web policy.** `const SCREEN_INPUT = /^screen:/;` in `src/main/webPolicy.ts` next to `AGENT_ASSIST` (line 67), added to the condition in `webAccess` (line 69). It is a pattern and not a set entry, so a channel added later under `screen:` is closed from the day it exists, and `DESKTOP_ONLY` does not change (the exact list asserted at `test/web-server.test.ts:333` stays valid). The pattern denies with or without the external-effects switch, as `AGENT_ASSIST` does.
- **Where `runs:screen` lives.** In `src/main/runner/module.ts` beside `runs:evidence`, so `test/runs-policy.test.ts:51-54` ("every `ctx.handle('runs:…')` of `module.ts` is classified") passes with the one added name. The input channels live in `src/main/screen/module.ts`, outside the `runs:` family, because that test also asserts that no `runs:*` channel is desktop-only (line 30).
- **Frames never go through `emit()`** (`src/main/index.ts:62-65` broadcasts to every paired browser). The only event the feature emits is `SCREEN_EVENT` (`'runs-screen'`), a payload of `{ run }` with no pixels, fired when a live screen opens or ends, so the run list refreshes at once (it otherwise waits for a forum message, the 20 s timer or a focus, `runsApi.ts:56-100`). A paired browser receiving that small event is harmless.
- **Rate.** Not a limit of the policy: the cache of 2.6 bounds the reads (at most one `GetImage` per 400 ms per live screen however many viewers there are), and `screen:input` accepts at most 64 events per call and 200 per second per run.

### 2.6 Lifecycle: the hub (D7)

`src/main/screen/hub.ts`, created once with `{ enabled: process.platform === 'linux', encoder, sink, now, note }` and exported from `src/main/runner/module.ts`'s wiring as an accessor like `runner()`. On a platform other than Linux `open` returns false and every other method answers `none`.

```
open({ run, stage, socket, kind, note })  -> Promise<boolean>   // connects, registers, starts the recording loop
state(run)                                -> LiveScreen | null  // what Run.screen is
frame(run, since, width)                  -> Promise<ScreenFrameAnswer>
control(run, on)                          -> { ok, reason? }
input(run, events)                        -> Promise<{ ok, delivered, rejected, reason? }>
finish(run)                               -> Promise<RecordingResult | null>  // stops the loops, flushes, idempotent
end(run)                                  -> void                              // drops everything, no recording
```

- **Created.** In `openStageSandbox` (`executor.ts:309-370`), after the session is made and before it is returned: `if (session.screen && session.gui?.display === 'on') await d.screens?.open(...)`. A sandbox session reports `screen = { socket: <stageDir>/x11/X99, kind: 'sandbox' }`, a host session `{ socket: /tmp/.X11-unix/X<N>, kind: 'host' }` (new optional field of `SandboxSession`, set only when the display is on; `gui` is unchanged so no host path reaches the prompt, which receives `session.gui` at `executor.ts:635`). A refused connection appends `runner.screen.noConnect` to the thread (the same `appendGui` path as `noDisplay`, line 365) and the stage goes on without a live screen and without a recording.
- **The field the renderer reads.** `service.ts` gets `withScreen(run)` beside `withCommand` (397-400) and both are applied in `list`/`get` (1075-1076): `{ ...run, screen: hub.state(run.id) }`. Like `command`, it is not in `RUN_SCHEMA` and is never written: the store's `update` reads the file, not the object handed out.
- **The recording loop.** A timer per live screen every 1000 ms: `grab()` through the same cache the viewer uses (a frame less than 500 ms old is reused, so a viewer's frame counts for the recording and is not read twice, rule 14), compare the hash, and feed the recorder only when it changed. The first frame (the empty screen at open) is always fed at timestamp 0. It stops in `finish`/`end`. A `GetImage` that fails twice in a row ends the live screen (the display is gone).
- **No read after close.** `finish` and `end` clear the timer, destroy the socket and delete the entry before they return; `frame` and `input` look the entry up and answer `none` otherwise. A test counts `grab()` calls after `finish` (criterion 3).
- **Where the recording is kept.** In the `finally` at `executor.ts:909-916`, as the first thing before `await session?.close()`: `const rec = await d.screens?.finish(run.id); if (rec) keepRecording(rec)`. `keepRecording` builds the record with `putRecording`, calls `d.keepEvidence(run.id, record)` once, and says anything that went wrong as a system line (`runner.screen.notKept` with the reason: no frame, over the cap, the store refused it); it never throws into the stage. A second `finally` in `executeStage` (`executor.ts:472-475`) calls `d.screens?.end(run.id)` before `session.close()`: the safety net for a stage that fails before `runStage`'s own `try`.
- **The app closing.** `before-quit` calls `hub.endAll()` (best effort, no recording; the stage folders are purged at the next start by `sandbox.purge()`, `src/main/runner/module.ts`).
- **Take control warns, never pauses (gate 1 decision 4).** `control(run, true)` sets the state and appends one system line to the run's thread (`runner.screen.controlOn`); `control(run, false)` (or the viewer closing, or `finish`) releases any key or button still held and appends `runner.screen.controlOff`. Nothing is told to the agent's session and no stage state changes.
- **Bursts (rule 22).** Every accepted input event updates `lastAt`; a burst starts at the first event after control is on or after 3 s of silence, and ends 3 s after its last event, on `control(false)`, or at `finish`. A closed burst becomes (1) one system line in the run's thread, `runner.screen.used`, with the start and end as local times, and (2) one mark `{ fromMs, toMs }` on the recording (ms from its start). The input is sent through the X connection, **not** through `session.exec`: it is not queued behind the agent's commands (the serial queue at `session.ts:299-303`), spends none of the stage budget (`session.ts:260,273`), and is not in `session.log` or `onExec`, so it is never reported as the agent's command. A test asserts all three.
- **Frames are not paused while controlling (gate 1 decision 6):** the recording continues and the interval is marked.

### 2.7 Retention (D14)

- **The group.** `RetentionKind` gets `'screens'` (`src/shared/retention.ts:3`); the label key `main.retention.kind.screens` is "Screen recordings of the stages". The renderer map in `RetentionSection.tsx:12-19` gets `ui.retention.kind.screens` in both `ui-settings` catalogs.
- **Listing.** `src/main/retention.ts` gets `screenRecordingFiles()` beside `attachmentFiles()` (line 73) and adds it to the `files` list in `scan` (line 193). It walks `runStore().list()` for records with `recording` and no `removed`, resolves each file with `evidencePath` and stats it. `keep` is false. The existing rules of `selectRetention` apply unchanged: a file younger than a day (`RECENT_MS`) or inside the days is kept.
- **Removing.** `removeOne` (line 249) gets a branch for the kind, as `anexos` has one: it derives the run id and the evidence id from the path (`<dataDir>/evidence/<runId>/<id>.webm`), re-reads the record from the store, checks it is still a recording of that run, deletes **only that file** with `dropEvidence`, then marks the record `removed: 'retention'` with a new transition `markRecordingRemoved` in `src/shared/runs/transitions.ts` (next to `deleteEvidence`, line 1030) through `moveRun`. Other evidence, the run's other pieces and any copy in a cycle folder or on a code host are not touched (rules 30, 32).
- **The record stays** (rule 31). `evidenceViewOf` passes `removed` through to the view; the player shows "removed by retention" instead of the video, and the inline attachment in the thread shows the same text when the bytes are gone (a new key, not an error).
- **The preview.** `previewRetention` groups by kind and label, so the group shows with its size in the retention preview with no further change. The setting stays the workspace's: `retention: { enabled, days }` (`src/shared/config/defaults.ts:55`), no new field.
- **Failure between the two steps** (file dropped, record not marked): the record shows a recording whose bytes cannot be read; the viewer says "not available" with no mark. Accepted (risk 12).

### 2.8 UI (D9)

- **The button.** In `Row` (`StageTimeline.tsx:110-154`), in the head row after the state (line 124), for the row where `row.current`, `state === 'running'` and `run.screen?.stage === stage.id`. The button label is `ui.cycle.live.open`. It shows on the desktop and on the paired browser; there is nothing to render where `run.screen` is absent.
- **The viewer.** `LiveScreen.tsx`, in a `Sheet` (`src/renderer/src/screens/Sheet.tsx`, `wide`) so the focus trap and backdrop are the app's. The image is an `<img>` whose `src` is a `data:image/jpeg;base64,…` string built from the answer's bytes, so no CSP change is needed: the desktop `<meta>` has `img-src 'self' data:` and no `blob:` (`src/renderer/index.html:16`), the web header `data: blob:` (`src/main/web.ts:25`). The recording's `<video>` uses a `blob:` URL, allowed by `media-src 'self' blob:` in both (index.html:16 and web.ts:27). Whether the existing `blob:` images in `Evidence.tsx` display under the desktop meta is checked in S4 and, if they do not, fixed there (a `data:` URL for images below 8 MiB), as a separate `fix:` commit.
- **Polling.** `setTimeout` chained 500 ms after each answer (never overlapping), stopped on unmount, on `document.hidden` (resumed on `visibilitychange`) and when the answer is `none`. The width asked is 1280 on the desktop and 640 when `isWeb()` or `useIsPhone()` (`src/renderer/src/platform.ts:2`, `useIsPhone.ts`). An answer `same` changes nothing on screen. A request that takes more than 800 ms makes the next wait 1000 ms (the slow connection of gate 1 decision 3).
- **Take control** (desktop only, `!isWeb()`). A `role="switch"` button. While on: a banner in the viewer's head ("You are controlling the agent's screen. This is being recorded."), a tone class from the existing tokens (`--focus` border), and the recording indicator; off: nothing is sent. While on, the viewer takes the keys: it listens to `keydown`/`keyup`, `pointermove`, `pointerdown`/`pointerup`, `wheel` and `contextmenu` on the image with `preventDefault`, maps the pointer to the screen's pixels with `x = round((clientX - rect.left) * screen.width / rect.width)` (clamped), batches events every 50 ms into `screen:input`, and on blur, switch off, close or `none` releases every pressed key and button it knows of. `Sheet` currently handles `Escape` and `Tab` in the capture phase (`Sheet.tsx:37`), which the agent's screen needs too: `Sheet` gets a `captureKeys` prop that leaves the keydown alone while the switch is on. The way back by keyboard is a reserved chord that is not sent (proposed: Ctrl+Alt+Shift+Escape, open question 2); the mouse always works.
- **What the person is told when keys are rejected:** `rejected > 0` in an answer shows one line, "Some keys have no key on this screen", for 3 s.
- **The player.** `RecordingPlayer.tsx`, used by `EvidenceItem` for `kind === 'webm'` (today `open` is offered only for images, `Evidence.tsx:97`): **Open** loads the bytes (`runsApi.evidenceBytes`, as the image does) into a `blob:` URL and shows a `<video controls>`, plus a strip under it with one mark per `recording.marks` entry, positioned at `fromMs / durationMs` with width `(toMs - fromMs) / durationMs`, in a theme token, each a button that seeks (`video.currentTime`). The video is **not** fetched until Open, because the piece is up to 24 MiB. A record with `removed` shows the retention text and no Open.
- **A fix the plan needs.** `useEvidenceList` reads once per `runId` (`Evidence.tsx:117`), and the recording lands when the stage ends, after the list was read. The hook gets a `version` argument (the count of `Object.keys(run.evidence ?? {})`, from `RunScreen.tsx:113`) that refetches when it changes.
- **i18n.** Every string goes through `t()` with the key in both `ui-cycle` catalogs (`ui.cycle.live.*`, `ui.cycle.rec.*`) and the retention label in `ui-settings`; the main-side texts (thread lines, the recording title, `main.retention.kind.screens`) in both `main` catalogs. Keys are written out in full in the screen files for `npm run i18n:lint`. Colors are tokens from `src/renderer/src/styles.css`, never literals (`node scripts/theme-audit.mjs`); contrast of the marks is checked against `--surface`.

### 2.9 The QA prompt (D15)

`prompt.sdd.runner.rules.gui.display` (`main.en.json:1473`, `main.pt-BR.json:1473`) is used only when `gui.display === 'on'` (`prompt.ts:127`). New English text: "A virtual display is up (DISPLAY is set). Run the browser headed (Playwright `headless: false`, or without `--headless`) so that it draws on this display: the person can watch the display while you work, and a headless browser draws on no screen. An Electron or other window app can be started on it too." Portuguese in the same meaning. The words "call" and "chamada" are avoided (the catalogs that need a `.novoice` pair, `docs/i18n.md`). With the display missing or failed (`noDisplay`, line 1474) the prompt does not change. No golden holds the key: `grep -c "rules.gui" test/golden/*.json` is 0 in all six files, and no test asserts the old sentence. Tests: new cases in `test/host-gui.test.ts` (the pattern at lines 300-335, with `fakeSandbox({ gui: { display: 'on', … } })` from `test/helpers/runner.ts:212`) and `test/sandbox-gui.test.ts` assert the headed sentence in both languages with the display on and its absence with `missing` and `failed`; `test/cycle-prompts.test.ts` and `test/host-terms-leak.test.ts` keep covering the catalogs.

### 2.10 Platform

Linux only. `hub.enabled` is `process.platform === 'linux'`; the display, `bwrap` and the X socket exist nowhere else, so on other systems `open` returns false, `Run.screen` is absent, there is no button, no helper window is created and no channel answers anything but `none`.

## 3. Data

All in `src/shared/screen.ts` unless said:

```ts
/** What a run handed out carries while its working stage has a live screen. Never saved. */
export interface LiveScreen {
  stage: string;
  width: number;            // the screen's own pixels, for mapping the pointer
  height: number;
  since: string;            // ISO time the screen opened
  recording: 'on' | 'stopped';   // 'stopped': a cap was reached
  control: boolean;         // someone is controlling it from the desktop
}

export interface RecordingMeta {
  durationMs: number;
  width: number;
  height: number;
  truncated?: 'size' | 'time';
  /** Intervals in which the person used the screen, in ms from the start of the recording. */
  marks: { fromMs: number; toMs: number }[];
}
```

- `Run.screen?: LiveScreen | null` in `src/shared/runs/types.ts`, beside `command?` (line 384), with the same comment: filled by the runner when it hands a run out, never written. It is **not** added to `RUN_SCHEMA`.
- `EvidenceRecord` (`src/shared/evidence.ts` (the `EvidenceRecord` interface)) gets `recording?: RecordingMeta` (present only on the app's own recording; this is how the code tells it from the agent's pieces) and `removed?: 'retention'`. `RUN_SCHEMA`'s `evidenceRecord` (`src/shared/runs/schema.ts:146-165`) lists both as optional, with `marks` capped at 200 entries and the numbers bounded; the kind enum gets `'webm'`.
- **The run format is not bumped** (`RUN_VERSION = 1`, `types.ts:8`): `inCycle` (#143) was added to the same record the same way. The cost is that an app older than this one reads a run file that holds a recording as invalid (`parseRun` refuses the unknown kind, `schema.ts:312-316`); see risk 9 and open question 4.
- `ScreenInput`, `ScreenFrameAnswer`, `ScreenControlAnswer` as in 2.5; `SCREEN_EVENT = 'runs-screen'`; the caps of 2.3.
- Nothing new in the config, the workspace data layout beyond `evidence/<runId>/ev-N.webm` (the folder the evidence store already owns), or any secret. No real person's data in a fixture: the tests use synthetic frames (a gradient) and a fake X server.

## 4. Configuration and migration

**No configuration field is needed and the schema stays at 20.** There is no `v20ToV21`, no change in `src/shared/config/{types,schema,defaults,migrations,validate}.ts`, and nothing in `docs/configuration.md`. The feature follows two settings that already exist: the display switch (`runner.sandbox.display`, `src/shared/config/types.ts:788`) decides whether a QA stage has a screen at all, and therefore a live view and a recording; the workspace's retention switch and days decide whether recordings are swept. Caps, rates, widths and qualities are constants of the code, like `EVIDENCE_MAX_BYTES`. Whether the recording should have a switch of its own is open question 1; the recommendation is no, and if the maintainer says yes it becomes schema 21 on top of 20 with a `v20ToV21` step in `STEPS` (`src/shared/config/migrations.ts:343`, last step `19: v19ToV20`) per `rules/config-schema.md`, and the plan's section 3 and the commit list change by one commit. Because no field is added, the collision check the maintainer has been burned by does not apply here.

## 5. Flow and prompts

**One stage, start to end.**

1. A QA stage with `runner.sandbox.display` on starts. `openStageSandbox` opens the session (`executor.ts:359-361`); the sandbox's supervisor has started Xvfb with its socket in the stage's own `x11` folder, bound over `/tmp/.X11-unix`; `gui.display` is `on`.
2. `openStageSandbox` calls `hub.open`, which `lstat`s the socket, connects, runs the setup, learns the root window, and starts the recording loop. It emits `SCREEN_EVENT`. From the next `runs:list`, the run carries `screen`.
3. The agent runs a headed browser (the prompt says to). Every 1000 ms the loop reads the screen, feeds the recorder when it changed.
4. A person opens **Live screen**. The viewer asks `runs:screen` about twice a second; the hub reads at most once per 400 ms and answers `frame` with a JPEG, or `same`. Closing the viewer stops the asking; nothing else changes.
5. On the desktop the person turns **Take control** on: `screen:control` appends a thread line; events go through `screen:input` to XTEST; each burst becomes a thread line and a mark when it ends.
6. The stage ends (answer, failure, cancel). `finally` calls `hub.finish`: the loops stop, the encoder flushes, `webm.ts` builds the file, `putRecording` stores it as `ev-N.webm`, `keepEvidence` records it (one revision) and posts it (one message), the connection closes; then `session.close()` removes the stage folder. The viewer's next answer is `none`: "the stage ended".
7. The evidence block of the stage lists the recording with **Open**; the player shows the video with the marks. If retention is on and the days have passed, the file goes and the record says it was removed.

**Prompts.** One text changes (2.9). The recording and the live view add no prompt text: the agent is not told it is watched (the point is the person watches; the thread line of the recording is the app's).

## 6. Order of the commits

Every commit is in English, `feat:` or `fix:`, lowercase, imperative, no final period, and carries **no** co-author trailer or tool text (repository rule). Before each: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`. The spec and the gate 1 record are already committed (`c7051789`, `7f578ebe`), so the first commit is the plan alone.

| # | Message | Content | Tests of the commit |
|---|---|---|---|
| 0 | `feat: add the plan of the live agent screen` | **only** `2_PLAN.md` | none |
| 1 | `feat: record what the live screen spike showed` | S1-S4 results as `3_SPIKE.md` in the cycle folder; the throwaway harness stays out of the tree. Decides: `GetImage` or the `-fbdir` fallback, VideoEncoder or MediaRecorder, `data:` for frames, the caps | none |
| 2 | `feat: add a minimal X11 client for the agent screen` | `x11.ts`, `xinput.ts`; no wiring | `x11-client`, `x11-input` against a fake X server |
| 3 | `feat: make the display socket reachable from the app` | the `x11` folder and the bind (sandbox), the display name to socket path (host), `SandboxSession.screen` | `sandbox-policy`, `sandbox-gui`, `host-gui`, `sandbox-session` |
| 4 | `feat: read and encode the agent screen on request` | `frame.ts`, the hub's viewer part, `runs:screen`, `Run.screen`, `withScreen`, `SCREEN_EVENT`, `openStageSandbox` opening it, `finish`/`end` calls without the recording | `screen-frame`, `screen-hub`, `runs-policy`, `runner-screen` |
| 5 | `feat: let the desktop send input to the agent screen` | `screen/module.ts`, `control`, `input`, the bursts and thread lines, the `/^screen:/` pattern | `screen-policy`, `screen-hub` (input), `runner-screen` |
| 6 | `feat: accept the app's own screen recording as evidence` | the `webm` kind, `recording.ts`, the schema, `KIND_TEXT`, the author of the post, the agent-cannot-cite filters | `evidence-recording`, `evidence-type`, `runs-store` |
| 7 | `feat: record the agent screen as a WebM video` | `webm.ts`, `recorder.ts`, `encoderWindow.ts`, the page and preload, the config entry, `finish` and `keepRecording` in the executor, the marks | `webm-mux`, `screen-recorder`, `runner-screen-recording` |
| 8 | `feat: sweep screen recordings with the retention` | the group, `markRecordingRemoved`, the label keys | `screen-retention` |
| 9 | `feat: show the live screen on the stage card` | button, viewer, `screenApi.ts`, `screenKeys.ts`, Take control, `Sheet` `captureKeys`, `cycle.css`, catalogs | `screen-keys`, `ui-i18n`, `team-catalog`-style static markup checks |
| 10 | `feat: play the recording with the person's intervals marked` | `RecordingPlayer.tsx`, `Evidence.tsx`, the thread attachment, the evidence list refresh, catalogs | static markup checks, `ui-i18n` |
| 11 | `feat: tell the QA agent to run its browser headed` | the two catalog lines | `host-gui`, `sandbox-gui` prompt cases |
| 12 | `feat: document the live agent screen` | `CHANGELOG.md` (`## [Unreleased]`), `docs/runner.md` | none |

Commits 2-5 change nothing the person sees (the hub opens a screen and answers channels no UI calls yet); 9 is the first visible change. **Spikes before code.** Commit 1 is where S1-S4 are written down; a result that changes the plan edits this file in the same commit. Commit 5 includes a manual key check on a real Xvfb (the main session has not tested keys): type letters, a shifted letter, Enter, Tab and an arrow into a window app and read them back with `xev`.

**Spikes** (each is a throwaway script outside the tree, results in commit 1):

- **S1. `GetImage` on the real display.** From the Electron main process (not plain Node) against the sandboxed Xvfb through the bound folder, and against a `-displayfd` host Xvfb: the reply layout and the pad byte, the time of a full frame at 1280x800x24, the effect of a `GetGeometry` before it, and a root resized by `xrandr`. Gate: more than about 100 ms per frame, or a refusal, selects the `-fbdir` fallback (2.1).
- **S2. `nativeImage` encode.** `createFromBitmap` on a BGRA buffer with the pad byte set to `0xff` and without it (to confirm the alpha fix matters), `resize` then `toJPEG` at 1280/q75 and 640/q60: time and bytes of a typical screen.
- **S3. WebCodecs in the hidden window.** The page loaded with `loadFile` from an `?asset` build and `isSecureContext`; `VideoEncoder.isConfigSupported` for `vp8` at 1280x800; `new VideoFrame(data, { format: 'BGRX', … })`; encode time and bytes per second at the proposed bitrate over a real browsing session; a keyframe forced every 10 s; the muxed file read by ffprobe (duration, keyframes) and played and **seeked** in a `<video>` in the desktop renderer and in a phone browser. Gate: a failure of any of these selects (a) plus the `Duration` and `Cues` rewrite (2.3).
- **S4. Content security policy.** A `data:` JPEG in an `<img>` and a `blob:` WebM in a `<video>` in the real desktop renderer and in the paired browser; whether the `blob:` images of `Evidence.tsx` show under the desktop meta today (acceptance criterion 14).

## 7. Test plan

Nothing reaches a real model, a real host, the network or the person's data; the fakes are in `test/helpers/` and the tests use `CERIMONIAS_DATA_DIR` pointed at an empty folder. The real-`bwrap` and real-Xvfb cases join the existing `maybeDisplay` group of `test/sandbox-gui.test.ts:274` and skip where `bwrap` or `Xvfb` is missing, as it does.

| File (`test/`) | Cases |
|---|---|
| `x11-client.test.ts` (new) | A fake X server on a unix socket in a temp folder: setup (Success), root window and geometry parsed; `QueryExtension` present and absent; `GetImage` reply of the expected size gives the right BGRX bytes, a size other than the root's, a depth that is not 24, a truncated reply, a length field above the cap and a setup that claims more than 64 KiB each give "no frame"/a refusal; `XTestFakeInput` for a pointer move, a button press and release and a key press and release arrive with the verified layout (36 bytes, length 9, type/detail/root/x/y at their offsets); an error packet names the failed request; a reply that does not parse closes the client and reports "not delivered" without throwing; a request that never answers times out; `lstat` of a non-socket is refused before any connect (criterion 6, criterion 1 as amended) |
| `x11-input.test.ts` (new) | Key names to keysyms; a character to a Latin-1 or `0x01000000 + cp` keysym; keymap columns 0 and 1; a shifted character brackets Shift; an unmapped key is rejected and counted; scroll to buttons 4/5 with the notch cap; coordinates clamped; an event with a wrong type is rejected |
| `screen-frame.test.ts` (new) | Pad byte fixed to `0xff`; the hash ignores the pad byte; `createFrameEncoder` calls the injected `nativeImage` with the right size, resize width and quality; widths clamped to 320..1280 in steps of 80; one JPEG per (sequence, width) |
| `screen-hub.test.ts` (new) | With a fake connection and a fake clock: with no viewer opened, the frame reader is not called for the viewer; with one open, at most one read per 400 ms whatever the number of viewers; an unchanged screen answers `same` without bytes; `frame` after `finish` or `end` answers `none` and the reader is never called again; a failed read twice ends the screen; `state` carries `stage`, size, `control`; non-Linux hub answers `none`; control on and off set the state and append the two thread lines; a burst closes after 3 s of silence, on control off and on `finish`, with one thread line and one mark; held keys are released on control off; input is not queued behind a running `exec`, spends none of the budget and is not in `log` or `onExec` (criterion 5); at most 64 events per call and 200 per second |
| `screen-policy.test.ts` (new, mold `docs-policy.test.ts`) | `screen:control`, `screen:input` and a made-up `screen:anything-new` are `deny` with the switch on and off and not in `EXTERNAL_EFFECT`; `runs:screen` is `allow`; a channel that only has `screen` in its name (`runs:screen`, `myscreen:read`) is not mistaken; every `ctx.handle('screen:…')` of `src/main` is denied |
| `runs-policy.test.ts` (changed) | `runs:screen` added to `READS` (line 10); the "exactly the channels the module serves" case (line 51) passes with it; the case that no `runs:*` is desktop-only still holds |
| `web-server.test.ts` (unchanged) | The `DESKTOP_ONLY` list at line 333 does not change because the pattern is outside the set |
| `sandbox-policy.test.ts` (changed) | With `gui.xvfb` set, `bwrapArgs` has `--bind <stageDir>/x11 /tmp/.X11-unix` after the `/tmp` tmpfs; without it the `--bind` list is exactly the one at line 43; `SUPERVISOR_SH` still has no `-fbdir` |
| `sandbox-gui.test.ts` (changed) | The pure `bwrapArgs` assertions of lines 52-62 stay; a new live case on a real sandbox with the display: the socket `X99` appears in the host folder `<stageDir>/x11`, `session.screen.socket` points at it, and a Node client on the host does the setup and a `GetImage` of the right size (skipped without `bwrap`/`Xvfb`) |
| `host-gui.test.ts` (changed) | `HOST_DISPLAY_ARGS` is unchanged; a host session with the display on reports `screen = { socket: '/tmp/.X11-unix/X<N>', kind: 'host' }` and none otherwise; the new prompt cases (2.9) in both languages |
| `sandbox-session.test.ts` (changed) | `session.screen` absent when the display is not on; `gui` equals what it did (the `toEqual` at `sandbox-gui.test.ts:261` style assertions keep passing) |
| `runner-screen.test.ts` (new, with `fakeSandbox` and a fake hub) | A QA stage with the display on opens the hub before any command and `runs:list` carries `screen`; a stage without a display, with `missing`, with `failed`, a non-QA stage and a documentation run have no `screen`; `noConnect` is said in the thread and the stage goes on; `end` is called when the stage fails before `runStage`; `Run.screen` is never in the saved file |
| `runner-screen-recording.test.ts` (new) | With a fake hub that returns a recording: it is kept before `session.close()` runs (the order is asserted with the fake sandbox's `onClose`), with **one** run revision and **one** post authored by the app, also when the stage fails or is cancelled; a recording that cannot be kept (none, over the cap, the store refused) is said as `runner.screen.notKept` and the stage still completes; the recording is not in `keptEvidence`, not copied with `runner.evidence: 'cycle'`, not citeable by an agent's answer and not in `stageResume`; nothing about it is uploaded to the code host (`runner-evidence-upload` unchanged) |
| `evidence-recording.test.ts` (new) | `putRecording` accepts a WebM with the EBML magic and DocType, refuses other content, a file over `RECORDING_MAX_BYTES`, an empty one; writes `ev-N.webm` atomically with mode 0600 and never over an existing id; the record carries `recording`; `readEvidence`/`evidencePath`/`dropEvidence` work for the kind |
| `evidence-type.test.ts` (existing, unchanged cases) | `detectKind` still answers `video` for WebM and the `SaveEvidence` path still refuses it (criterion 8); a new case: the same bytes pass `putRecording` and fail `putEvidence` |
| `runs-store.test.ts` / `runs-older-files.test.ts` | A run with a recording record round-trips through `parseRun`; `removed: 'retention'` and `marks` bounds; a file without the new fields reads as before |
| `webm-mux.test.ts` (new) | A test-local EBML reader walks the output: header (`webm`, version), one Segment with the right size, Info (`TimecodeScale`, `Duration` = the stop time even after a long idle stretch), Tracks (`V_VP8`, width, height), Clusters starting at keyframes with `SimpleBlock` relative timecodes inside int16, a new cluster after 30 s, Cues with one point per cluster and the right cluster offsets; an empty list is refused; sizes that need 1 to 8 bytes encode right |
| `screen-recorder.test.ts` (new) | With a fake sink and clock: the first frame at 0, then only changed frames, at most one per second; a still screen produces no frame but the duration advances; the marks are recorded; at 24 MiB or 60 min the recorder stops, `truncated` is set and `recording` becomes `stopped`; backpressure drops a frame without moving the clock; `finish` is idempotent and a recording with no frame is `null` (criterion 8) |
| `screen-retention.test.ts` (new, mold `attachments-retention.test.ts`) | `scan` lists only recordings, outside the days; a recording inside the days or younger than a day is kept; apply removes the file, marks the record `removed: 'retention'`, leaves the other evidence, the run's pieces and a cycle-folder copy alone; a file already gone is not a failure; the group shows in `previewRetention` with its size; `retention.enabled` false still removes nothing in the daily job (criterion 9) |
| `screen-keys.test.ts` (new) | The renderer's mapping of a pointer position to screen pixels (letterboxing, clamping), the batching and the release-on-blur set are pure functions tested without a DOM |
| `main-catalogs.test.ts`, `ui-i18n.test.ts`, `team-catalog.test.ts`, `cycle-prompts.test.ts`, `host-terms-leak.test.ts` | New keys in both catalogs; the prompt line renders with no leftover `{…}` and no host words |

**Goldens.** None of the six `test/golden/*-prompts*.json` holds `rules.gui`; none changes.

**What the tests do not cover** (no DOM library in the repository; only static markup): the viewer in motion, the player and its marks on a real timeline, the helper window and WebCodecs, `nativeImage`, the key check on a real display, the phone. They go to the manual test plan (`3_TEST_PLAN.md`): on Linux with Xvfb, a QA stage with the display on and a headed browser, the viewer on the desktop (watch, take control, click and type), the same run in the paired browser at phone width (watch only, no switch), the recording after the stage (plays, seeks, the person's intervals marked), a cancelled stage, a stage with no display, retention with a short setting, and the page under both content security policies (criteria 11-14).

## 8. Risks

| # | Risk | Coverage |
|---|---|---|
| 1 | `GetImage` has not been run here: speed, layout and behavior on a resized root are assumed | S1; the `-fbdir` fallback keeps the hub's `grab()` contract |
| 2 | The connection is the single path for frames and input: if the bind or the connection fails, there is no live screen | said in the thread (`noConnect`), the stage goes on; the fallback gives frames back |
| 3 | The agent replaces the socket before the connection is made, to point the app at the person's real display | the connection is made before any command of the agent, `lstat` first, never redialled (2.1); a test on the order |
| 4 | The XTEST client inside Electron's main process and the key path were not tested; key layouts other than the default one | the setup, pointer and buttons are verified in plain Node; keys get the manual check in commit 5; unmapped keys are rejected and shown |
| 5 | WebCodecs `VideoEncoder` for VP8 and `VideoFrame` from BGRX in the hidden window, and the way the page is loaded, are unverified | S3 with a stated fallback to `MediaRecorder` plus a rewrite |
| 6 | The helper window is a second renderer: memory (tens of MB) while recording and a surface to harden | one shared window, destroyed 30 s after the last recording, sandboxed, no navigation, no permissions, the IPC checks the sender |
| 7 | 4 MB per recorded change over IPC, and 4 MB per read in the hub | one frame per second at most, a bounded queue, a 400 ms cache; sizes measured in S1 and S3 |
| 8 | VP8 WebM may not play in every phone browser; a 24 MiB piece is a 32 MiB JSON answer over the web wire (`MAX_BODY` is only the request limit, `web.ts:15`) | the video is fetched only on Open; the download link works for any player; the cap can come down after S3 |
| 9 | A run file holding a `webm` record or `recording`/`removed` fields is invalid for an app older than this one (`parseRun`, `schema.ts:312-316`) | the same cost `inCycle` had; the run format is not bumped; open question 4 |
| 10 | What is on the agent's screen, and what the person types while controlling, reaches the paired browser, the recording and the conversation; a typed secret would be recorded | the control state and a recording banner are shown while on; frames are not paused (gate 1 decision 6); the person deletes the piece or retention removes it |
| 11 | A low `fileMb` already breaks Xvfb (`policy.ts:129` under `prlimit --fsize`) | not changed; the stage already goes on without a display and says so; `GetImage` adds no file, so this plan does not make it worse |
| 12 | Retention drops the file and fails before marking the record | the viewer says "not available"; the next sweep cannot find the file; accepted |
| 13 | The app closes mid-stage: no recording is kept | stage folders are purged at the next start; the recording is memory-only until the stage ends |
| 14 | The recording loop reads the screen once a second for the whole stage with nobody watching, which is the exception to "nobody watching costs nothing" | spec rule 14; one read per second, only the hash on an unchanged screen, no encode |
| 15 | `Sheet` takes `Escape` and `Tab` while control is on | `captureKeys` prop and a reserved chord (open question 2) |
| 16 | `blob:` images in `Evidence.tsx` may already be blocked under the desktop meta | S4; if so a separate `fix:` |
| 17 | Another open change bumps the config schema | not applicable: this plan adds no field |
| 18 | The pad byte of the X image is assumed not to be alpha | fixed in place to `0xff` before hashing; S2 confirms it matters |
| 19 | `electron` is not importable in Vitest (`test/helpers/electron.ts`) | `nativeImage`, the window and `ipcMain` are injected; the Electron files are thin |
| 20 | A thread line time format helper for main was not checked | the `used` line takes local `HH:MM:SS` from `toLocaleTimeString`; verified in implementation |

## 9. Decision log

| # | Decision | Rejected alternative, and why |
|---|---|---|
| D1 | Frames by X11 `GetImage` over the input's connection (2.1) | **`-fbdir` and an XWD parser** (the spec's wording): a second source, a folder the agent writes, a memory-mapped file read while it changes, a host display that needs a folder before it exists, a separate parser. It stays as the fallback |
| D2 | One connection per live screen, made before the agent's first command, never redialled | **Dial on each read or each input**: the agent could swap the socket for a link to another display in between |
| D3 | Recording by WebCodecs VP8 in a hidden helper window and our own muxer | **`MediaRecorder` on a canvas stream** (verified to work): no `Duration`, no `Cues`, frames dropped at `start()`, a still screen needs a timer re-requesting frames; the marks and the gap between frames cannot be had without a rewrite of its output. It is the fallback. **ffmpeg or any program**: a dependency the app does not ship (spec rule 16) |
| D4 | VP8 in WebM, `video/webm` | **VP9** (what `MediaRecorder` picked first): a costlier software encode for a screen of a few frames per minute; **MP4/H.264**: licensing and the spec says WebM only |
| D5 | `runs:screen(run, since, width)` under `runs:`, answers `none`/`same`/`frame` | **A new GET route or SSE**: outside the RPC guard / no per-client topic (spec rule 11); **a channel per piece (size, frame)**: more round trips |
| D6 | `screen:control` and `screen:input` under `/^screen:/`, a pattern | **`runs:screenInput` in the runs family**: `test/runs-policy.test.ts:30` forbids a desktop-only `runs:*` channel; **entries in `DESKTOP_ONLY`**: a channel added later would be open to the phone |
| D7 | `Run.screen`, a non-persisted field added by `withScreen` beside `withCommand`, plus a small `SCREEN_EVENT` | **A new channel the renderer polls for "is there a screen"**: a second poll; **saving it in the run**: it would outlive the stage and bump revisions |
| D8 | A new `webm` kind kept only through `putRecording`; `detectKind` untouched | **Making `detectKind` accept WebM**: the agent's `SaveEvidence` would keep videos; **a separate store for recordings**: the retention, the player and the post all read the evidence store |
| D9 | `data:` for live frames, `blob:` for the video | **`blob:` for frames**: not allowed by the desktop meta (`index.html:16`) unless it is changed; **loosening the meta**: a wider policy for one image |
| D10 | Raw BGRX frames to the helper, `VideoFrame` from a buffer | **JPEG then decode in the page**: a second lossy step and a decode per frame |
| D11 | 24 MiB, 60 minutes, one frame per second, change-only | **No cap**: a long busy stage would fill the evidence folder and a phone; **the 8 MiB evidence cap**: too small for any video (spec rule 16) |
| D12 | No setting for the recording | **A per-workspace switch**: schema 21 for a choice the display switch already makes; open question 1 |
| D13 | No configuration, no schema bump | **Retention days for recordings only**: the spec says the existing switch and days |
| D14 | Retention removes the file and marks the record `removed: 'retention'` | **Deleting the record too**: the stage would show nothing, not "removed"; **wiring `dropRunEvidence`**: out of scope |
| D15 | The prompt sentence replaces the old one in the existing key | **A new key beside it**: two sentences about the display, one of them wrong about headless |
| D16 | Keep the recording in the `finally` (the stage's every end) | **Only on success next to `keepLooked`**: a failed or cancelled stage loses the very thing a person wants |
| D17 | Input through the X connection, never `session.exec` | **`exec` with a helper program**: queued behind the agent, spends its budget, appears as its command (spec rule 22) |
| D18 | One shared hidden window for all recordings | **A window per recording**: memory for each concurrent QA stage |

## 10. Open questions

For the maintainer at gate 2; each has the recommended answer and none is decided by the plan.

1. **Does the recording need a switch of its own?** The spec leaves it to the plan. **Recommended: no**, it follows the display switch; the person who does not want it turns the display off, deletes the piece, or lets retention remove it. A switch costs schema 21 and a `v20ToV21` step.
2. **The keyboard chord that leaves Take control** (the viewer sends every key to the agent's screen while it is on, including `Escape` and `Tab`). **Recommended: Ctrl+Alt+Shift+Escape**, never sent; the mouse always works.
3. **Are the caps right?** 24 MiB, 60 minutes, one frame per second. **Recommended:** accept as the starting point; the spike sets the final numbers and the commit that fixes them says what was measured.
4. **Should the run file format be bumped for the new evidence kind?** An older app would read such a run as invalid. **Recommended: no**, as `inCycle` did; the repository ships forward only and an app older than 0.9.0 cannot run the config schema 20 either.
5. **Approve the two spec amendments** at the top (the frame source and the recording kept in the stage's `finally`). **Recommended: approve both.**
6. **A frame shown to a paired browser while a person controls from the desktop**: the phone sees the same picture and a "controlled from the computer" mark. **Recommended: yes**, as designed.

## 11. What stays out of this plan

- Anything in the spec's "Out of scope": the person's own screen, other systems, audio, the headless browser's DevTools screencast, several people sending input, input from the phone, paste and file transfer, video from the agent, formats other than WebM, retention for other evidence and wiring `dropRunEvidence`, a very low `fileMb`, notifications when a screen opens.
- Range reads of a recording over the web wire (a long recording is read whole on Open).
- Resuming a recording after the app restarts.
- Changing `Xvfb`'s size, its limits or its absence of any TCP listener (rule 35).
- `npm run dist` (it bundles the SDK).

## 12. Where the plan touches what exists

- Sandbox: `src/main/sandbox/{policy,index,session,host,display}.ts` (a bind, a folder, one new session field; `display.ts` unchanged).
- Runner: `src/main/runner/{executor,service,module}.ts`, `src/shared/runs/{types,schema,transitions}.ts`.
- Evidence: `src/shared/evidence.ts`, `src/main/evidence/{store,handlers,type,recording}.ts` (`type.ts` unchanged).
- Retention: `src/shared/retention.ts`, `src/main/retention.ts`.
- Security: `src/main/webPolicy.ts` (a pattern).
- Renderer: `src/renderer/src/screens/cycle/{StageTimeline,Evidence,Thread,RunScreen,cycle.css}`, `src/renderer/src/screens/Sheet.tsx`, `src/renderer/src/screens/RetentionSection.tsx`.
- Build: `electron.vite.config.ts` (a second preload entry).
- Rules of the repository the plan respects: `agent-read-only`, `external-effects` (nothing leaves the machine, nothing waits in `actions:approve`), `test-workspace`, `paired-phone`, `data-layout`, `config-schema` (no change), `i18n`, `theme`, `public-repo`, `distribution`, and `CONTRIBUTING.md`/`CLAUDE.md`.

## 13. State of what was checked

**Checked by reading this tree** (`release/0.9.0`, 0.9.0-beta.1; commit `7f578ebe` on the branch): the sandbox policy, session, index and host files and the display start (`policy.ts:36-41,95-133`, `session.ts:35-75,136-215,287`, `index.ts:230-309`, `host.ts:55-75`, `display.ts:21`); the executor's open, keep and close paths (`executor.ts:309-370,472-475,668-697,904-923,973-981`); the runner service's `keepEvidence`, `withCommand` and `list`/`get` (`service.ts:339-365,397-400,1075-1076`); the evidence store, type check, shared types and the run schema; the retention scan and removal; `webPolicy.ts` and the two policy tests; the web server's CSP, body limit and idempotency path; the wire format; the renderer's evidence block, stage row, run screen, `Sheet`, `runsApi` and the CSP `<meta>`; the prompt and the catalog lines; the existing test names and helpers they would extend. Every `file:line` above was re-read for this plan; the `display.ts` lines of the audit were wrong (the file has 79 lines; the argument list is at line 21).

**Verified by the main session on 2026-10-08, outside the app:** the two checks at the top of this document.

**Not verified** (the spikes and the manual plan are for these): `GetImage` on a real display and its speed; a key through `GetKeyboardMapping`; the XTEST client inside Electron; `nativeImage` encode times; WebCodecs VP8 and `VideoFrame` from BGRX in a hidden window, the way the page loads, the muxed file's playback and seek on desktop and phone; `data:` and `blob:` under both content security policies; whether the existing `blob:` images show under the desktop meta; the size of a JPEG and of a recording at the proposed settings; that no other open change touches the same files. No test, `tsc` or app run was done for this step. `node scripts/public-audit.mjs` was run on the tree with this document (result in the hand-off).
