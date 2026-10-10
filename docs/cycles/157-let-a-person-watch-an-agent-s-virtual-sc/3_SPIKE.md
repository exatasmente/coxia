# Let a person watch an agent's virtual screen live: what the spikes showed

Run on 2026-10-08, before any code, on a Linux machine with `Xvfb`, `bwrap` (launched through `aa-exec -p unconfined`, the Ubuntu 24.04 AppArmor profile that lets `bwrap` create a user namespace), the repository's own Electron 44 on a throwaway `Xvfb`, `ffmpeg` and `ffprobe`. Every script was a throwaway outside the tree, pointed at throwaway displays; nothing touched the app's data. Numbers are from one machine and one run, so read them as orders of magnitude, not as limits.

**Result: no fallback was needed.** S1 passed (frames by `GetImage`, not `-fbdir`), S3 passed (WebCodecs VP8, not `MediaRecorder`), S4 found one existing defect that is not this feature's (below). The plan stands as written, with the two numbers it asked the spikes to tune.

## S1. `GetImage` on the real display

An X11 client of about 80 lines, run **from the Electron main process** (not plain Node), against two displays:

- the sandbox display: `Xvfb :99 -screen 0 1280x800x24 -nolisten tcp` inside `bwrap` with `--unshare-net` and a host folder bound over `/tmp/.X11-unix`; the client dialled the socket in that host folder;
- a host display started the way `startHostDisplay` does it (`-displayfd`, no TCP).

| Measure | Sandbox display | Host display |
|---|---|---|
| Connection setup | 9 ms (first), Success, no authorization | 3 ms |
| `QueryExtension "XTEST"` | present, major opcode 132 | present, 132 |
| Root window, size, depth | 1280x800, depth 24 | the same |
| Image byte order, min and max keycode | little-endian, 8 and 255 | the same |
| `GetImage` of the whole root, 12 reads | 46 to 57 ms with the throwaway client, which joined the buffers again at every chunk (one outlier of 99 ms) | 47 to 54 ms, the same client |
| Reply size | 4,096,000 bytes (32 + the data, length field 1,024,000) | the same |
| Pad byte of each pixel | `0` on every pixel | `0` |
| `GetGeometry` before each `GetImage` | adds nothing measurable (round of both: 51 to 56 ms) | 46 to 51 ms |
| `GetKeyboardMapping` | 248 keycodes, 7 keysyms per keycode, `a` is keycode 38 | the same |

Gate of the plan: more than about 100 ms per frame, or a refusal, selects the `-fbdir` fallback. About 50 ms with a client written for the spike, no refusal: **`GetImage` is the frame source and `-fbdir` stays unused.**

**Measured again with the app's own client** (the one of the next commit, which puts a large reply together once instead of at each chunk), from the Electron main process against the host display, geometry request included: **3.5 to 6 ms a frame over 12 reads, with one outlier of 60 ms**; the same code in plain Node, 1 to 5 ms. The 50 ms above was the cost of the spike client's buffering, not of the display, so the frame is far inside the gate.

Other facts found:

- **A resized root.** `xrandr --fb 1000x700` on the host display changed the root: `GetGeometry` then answered 1000x700, a `GetImage` of the old 1280x800 failed with an X error `BadMatch` (8), and a `GetImage` of the new size returned exactly `1000 * 700 * 4` bytes. So geometry is asked before every `GetImage`, as the plan says, and the reply size must equal what the geometry implies. (A plain `Xvfb -screen 0 1280x800x24` only shrinks, never grows; the test shrank it and put it back.)
- **Keys, from the Electron main process, on the host display.** Keysym to keycode through the keymap (columns 0 and 1), checked by reading the events back with `xev`: `a` (keycode 38, no shift), `A` (Shift_L, 38, release, Shift_L), Return (36), Tab (23), Left (113), `8` (17), `*` (Shift_L, 17) all arrived with the right keysym and the right modifier state. `e` with acute accent and the euro sign are **not in the default layout's first two columns**: the keymap lookup finds nothing, which is the "rejected and counted" case of the plan.
- **Pointer and buttons** were verified by the main session in plain Node on 2026-10-08 (the plan's header); the same request layout was used here for the keys.

## S2. `nativeImage` encode

`nativeImage.createFromBitmap` on the raw 1280x800 reply (BGRA order, as Electron on Linux reads a bitmap) of a screen with a gradient header, a table of text rows and coloured cells (a typical app screen), then `resize({ width, quality: 'good' })` and `toJPEG`:

| | Time (steady, after the first) | Bytes |
|---|---|---|
| `createFromBitmap` | 1.3 to 4.2 ms | |
| 1280 wide, quality 75 | about 5 ms | 180,477 |
| 640 wide, quality 60 (resize included) | about 3.6 ms | 42,717 |
| md5 of the 4 MB frame | about 5.5 ms | |

- **The pad byte did not change the JPEG**: the output with the pad byte at `0` and with it set to `0xff` is byte for byte the same on Linux. The fix of the plan (set it to `0xff` in place before hashing) is kept anyway, because it costs 1 to 3 ms and a display server that leaves a stray value in the pad byte would otherwise make a still screen look changed forever. The frame was read back and its colours are right.
- The proposed widths and qualities are comfortable: 180 KB for the desktop frame (240 KB as base64) and 43 KB for the phone frame (57 KB as base64), far under the request body limit. The phone frame at two a second is about 115 KB/s.

## S3. WebCodecs in a hidden window

A hidden `BrowserWindow` (`show: false`, `sandbox: true`, `contextIsolation: true`, `backgroundThrottling: false`, its own in-memory partition, CSP `default-src 'none'; script-src 'unsafe-inline'`), the page loaded with `loadFile` from a plain `.html` and a preload bridging three IPC channels. Main sent each frame as the raw 4 MB buffer.

- `isSecureContext` is **true** for a `loadFile` page. `VideoEncoder` and `VideoFrame` exist.
- `VideoEncoder.isConfigSupported` at 1280x800: **vp8 yes, vp9 yes, h264 no**.
- `new VideoFrame(data, { format: 'BGRX', codedWidth, codedHeight, timestamp })` from the raw reply works; `encode(frame, { keyFrame })` honours the forced keyframe.
- Sending a 4 MB frame to the window by `webContents.send` took 1 to 3 ms in main. Encoding took 3 to 17 ms per frame in the page (the first, 17 ms). The encode queue never held more than one frame.
- A real run of 20 changed frames (a page scrolling its whole content every frame, so the worst case: every pixel row moves), with a still stretch of 6 s in the middle that fed no frame, at `{ codec: 'vp8', bitrate: 250_000, framerate: 1, latencyMode: 'quality' }`:
  - 515,782 bytes in total, about 26 KB a frame (21 KB the first keyframe; 53 to 56 KB the two later keyframes; 13 to 42 KB the rest), 3 keyframes;
  - the timestamps main set (303 ms ... 9801 ms, then 16106 ms ...) came out of the encoder unchanged, so **an idle stretch is a gap between two timestamps**, as the plan relies on;
  - `ffprobe` reads the stream as `vp8` 1280x800 with all 20 frames; `ffmpeg` decodes the last one and the text is legible;
  - at 100 kbit/s the same run is 243 KB (12 KB a frame); at 500 kbit/s, 761 KB (38 KB a frame).
- **Gate of the plan:** the failure of any of these selects `MediaRecorder`. None failed: **`VideoEncoder` is the encoder and `MediaRecorder` stays unused.**

Caps. A page that changes entirely every second costs about 1.5 MB a minute at 250 kbit/s; the real stage changes in parts and has still stretches, so this is an upper bound. With it, 24 MiB lasts about 16 minutes of non-stop full-screen change and far longer in practice; 60 minutes of recorded time stays the other bound. **The caps stay as the plan has them (24 MiB, 60 min, 1 frame per second at most, 250 kbit/s)**; a lower bitrate is available if a recording of the 24 MiB size proves too heavy for a phone.

**Not verified here (it needs the muxer of the recording commit):** the file our own `webm.ts` will write has not been played, because that code does not exist yet. What was checked is the part that does not depend on it: the VP8 stream is valid, and a WebM of the same stream (remuxed by `ffmpeg -c copy`, with `Duration` 25.29 s) loaded in a `<video>` in an Electron window, reported 1280x800 and 25.29 s and **seeked to 12 s**. Playback of VP8 WebM in a phone's browser was **not** tested. Both are for the recording commit and the manual test plan.

## S4. Content security policy

The page was loaded in a real Electron window two ways with the policy of each: by `loadFile` (the desktop, `file://`) with the `<meta>` policy of `src/renderer/index.html` copied as it is; and by a local HTTP server that sends the `Content-Security-Policy` header of `src/main/web.ts` (the paired browser). In each, an `<img>` with a `data:` JPEG, an `<img>` with a `blob:` JPEG, and a `<video>` with a `blob:` WebM that is then seeked.

| | Desktop (`file://` + meta) | Paired browser (header) |
|---|---|---|
| `<img>` with `data:image/jpeg;base64,...` | shows | shows |
| `<img>` with a `blob:` URL | **blocked** (`img-src` violation) | shows |
| `<video>` with a `blob:` WebM, metadata, seek | works (25.29 s, 1280x800, seek to 12 s) | works |

- **`data:` for the live frame and `blob:` for the video are confirmed** (D9). No policy change is needed for this feature.
- **A defect that is not this feature's, found by the check:** the desktop's `<meta>` has `img-src 'self' data:` and no `blob:`, and `Evidence.tsx` builds `blob:` URLs for its images (lines 33, 63 and 172). On the desktop those images are therefore blocked today; only the paired browser shows them. The plan (S4) says this is to be fixed with a separate `fix:` commit, using a `data:` URL for the image pieces (each under 8 MiB). It is not part of the five commits of this phase because it changes the renderer's evidence block, which phase C reworks for the player; **it is handed to phase C as its first `fix:` commit** (or the maintainer may want it earlier, as it stands on its own).

## Key check with the app's own code (commit 5)

Run after the input was written, with the app's real hub, input planner and X client (bundled for plain Node, outside the tree) against a host `Xvfb` with `xev` as the window app and its pointer moved into the window by the same input. Take control on, then one batch: a pointer move, a left click (press and release), `a`, `A`, `*`, Enter, Tab, ArrowLeft, an `e` with acute accent and a wheel notch up. The answer was `delivered: 16, rejected: 2` (the accented letter, down and up: the default layout has no key for it, so it is rejected and counted, as designed), and `xev` read back: `a` (keycode 38, no modifier), `A` (Shift_L pressed first, state 0x1, then released), `*` (Shift_L, keycode 17, state 0x1), Return (36), Tab (23), Left (113), a ButtonPress for the click and the wheel's button. Control off wrote the three lines of the conversation in order (control on, one line for the burst with the start and end in local time, control off).

## What changes in the plan

Nothing in the design. Recorded decisions: frames by `GetImage` (about 50 ms); VP8 by `VideoEncoder` in a hidden window; JPEG 1280/q75 and 640/q60; `data:` for frames and `blob:` for the video; caps unchanged. One fact the plan did not have: the pad byte is `0` and does not change the JPEG, so the alpha fix is a safety for the hash, not for the picture.

## The recording with the app's own code (commit 7)

Run on 2026-10-08, after the recorder was written, on a throwaway `Xvfb` (1280x800x24, no TCP) with the repository's Electron 44. Nothing touched the app's data; the harness was a throwaway outside the tree, the app's code bundled into it unchanged (the hub, the recorder, the muxer, the encoder host and the real hidden encoder window, with its page and its bridge).

A visible window drew on the display (a counter and a table that scrolled once a second for 9 s). The hub opened the display like a `shell: host` stage, a still stretch of 6 s followed, then Take control with a pointer move and a click, then 5 more changes, then `finish`.

- The hidden window started, said it was ready, took the encoder for 1280x800 and returned chunks; `finish` gave a 407,240-byte file, `durationMs` 21,556, one mark of 1 s at 15,047 ms (the person's burst, widened to the minimum of 1 s), and the three conversation lines in order (control on, the burst, control off).
- **`ffprobe`:** `format_name=matroska,webm`, `duration=21.556000`, one stream `vp8` 1280x800, 14 packets. The key frames are at 0 s and 17.4 s: the idle stretch from 8.2 s to 17.4 s fed no frame and is a gap between two times, and the second key frame is the first frame fed after 10 s since the last one, as the recorder forces. **`ffmpeg -i out.webm -f null -` decodes it with no error.** Frames pulled out at 12 s (the still screen, the table scrolled to its row 10) and at 20 s (row 15) show the right picture.
- **In a `<video>` in a throwaway Electron window**, under the desktop's `<meta>` policy (`media-src 'self' blob:`): metadata loaded, `duration` 21.556, `videoWidth x videoHeight` 1280x800, `seekable` the whole 0 to 21.556 s. Seeks to 12 s (inside the idle gap), 20 s, 3 s, 17.5 s, 21.4 s (after the last frame) and 0.5 s all fired `seeked` at the time asked, with a picture drawn each time (non-blank on a canvas); `play()` advanced 2.498 s in 2.5 s of wall time.
- So the muxer's real output, written by the app's own code from the helper window's real encoder, plays and **seeks** in Chromium, which phase A had only shown for an ffmpeg-remuxed file. The layout that does it: the SeekHead (Info, Tracks, Cues by offset), `Duration` as a float64 in ms, one cluster per key frame (and one more after 30 s of delta frames), one cue per key-frame cluster, Cues at the end.
- **Not tested:** a phone's browser. The encoded stream is VP8 in WebM, which every Chromium and Firefox plays; the download link stays the way out.

What the plan had that changed in the code, none of it in the design:

- The page of the encoder is `resources/encoder.html` (shipped as an extra resource, loaded with `loadFile`), not `src/main/screen/encoder.html` with `?asset`: the repository has no `?asset` imports, and `resources/` already ships outside the archive. `isSecureContext` stays true for a file loaded this way (S3).
- The encoder's logic is `encoderHost.ts` (pure, with the window and the channel injected, tested with a fake window) and `encoderWindow.ts` is the thin Electron part, so the file the plan called `encoderWindow.ts` is two.
- The recording's post in the conversation is internal, not public: the tracker comment of a stage is linked to the latest public message of the stage (`markPublished`), which a recording must never become.
