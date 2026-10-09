# 157 Let a person watch an agent's virtual screen live, in the app and in the paired browser

- Endereço: https://github.com/exatasmente/coxia/issues/157
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

A QA stage with the display switch on gets a virtual screen of its own: an Xvfb inside the sandbox on `:99` (`SUPERVISOR_SH`, `src/main/sandbox/policy.ts`) or, for an agent set to `shell: host`, a separate Xvfb (`src/main/sandbox/display.ts`). The agent opens the app under test there, clicks and takes screenshots, but nobody else can see that screen. While the stage runs, the person learns what happened only from the log and the screenshots the agent chose to keep (#142, #143). They cannot watch it from the desktop or from the paired phone, and they cannot step in when the agent is stuck on a screen.

What exists and could carry this:

- **The screen can be read without connecting to it.** Started with `-fbdir <folder>`, Xvfb keeps its framebuffer in a file there (XWD header, then 32-bit BGRX pixels) that changes with the screen. A quick check with a headed Chromium on a 1280×800 Xvfb showed the file following the window. The sandbox keeps no network; it only needs one more writable folder outside the worktree.
- **The main process can encode a frame** with `nativeImage.createFromBitmap(...).toJPEG()`, with no new dependency.
- **The web access already pushes events** to a paired browser (`/api/events`, server-sent events in `src/main/web.ts`), and the run reads are open to it (`src/main/webPolicy.ts`).

## What you would like to happen

- **"Live screen" on the stage card** of a run, in the desktop app and in the paired browser (PWA), while a stage with a virtual display runs.
- **Watching is open to a paired browser in the same way as the run reads.** The phone gets a smaller image.
- **Frames are read only while someone watches**, at a low rate (about 2 per second), skipping unchanged frames; nobody watching costs nothing. The capture ends with the stage.
- **The screen is kept as evidence of the QA stage:** frames at an interval (or a short clip) saved with the stage's evidence and shown after the stage ends, under a retention rule.
- **The desktop can interact:** clicks and keys from the desktop viewer reach the agent's virtual screen. The paired browser only watches.
- **The QA prompt says to run the browser headed when the display is on**, since a headless browser draws on no screen and there would be nothing to watch.

## Alternatives you considered

- **A VNC server (`x11vnc`) or `ffmpeg -f x11grab`.** Each needs another program, and VNC needs a listener the sandbox does not have.
- **Only the screenshots the agent saves.** These are not live and depend on what the agent chose to keep.
- **The Chrome DevTools screencast of the agent's browser.** It only covers browsers, and the agent owns that browser and its port.

## Notes

- To settle in refinement: how input reaches a screen inside the sandbox (the network is unshared and the X socket lives in the sandbox's own `/tmp`: a helper started by the supervisor, or XTEST through the control folder), whether input from a person is recorded in the run so the evidence does not credit the agent with it, the evidence format and its retention, and the frame size and rate for the phone.
- The agent can write to the screen folder; at worst it fakes its own screen. Whatever shows on the agent's screen reaches a paired browser.
- Only the virtual screens of the stages are covered, never the person's own screen.
- Builds on #142 and #143 (the QA evidence).
