# 176 Record the agent's screen only while it is in use, instead of the whole stage

- Endereço: https://github.com/exatasmente/coxia/issues/176
- Estado: open
- Rótulos: bug, coxia
- Autor: exatasmente

## Descrição

## The problem

The screen recording of a QA stage (#157) runs from the moment the stage's virtual display opens until the stage ends. The recorder only takes a frame when the screen changed, but the time in between is kept, as the spec of #157 asked ("an idle stretch plays as a still picture"). A real QA stage gave an 18-minute video, most of it a black screen: the display was up long before the agent opened any window, and between its uses of the screen.

## What you would like to happen

- **The recording starts when the screen is first in use**: when a window appears on it, not when the display opens. A stage whose agent never opens a window keeps no recording, and says so the way it says a recording was not kept.
- **An empty screen is not recorded**: while nothing is on it (the bare root window), no frame is fed.
- **Idle stretches are shortened**: a gap between two fed frames longer than a few seconds plays as a short pause (about 1 s), and the player shows the real time of each part (a mark or a time label at each cut), so the video is about what happened and the timeline still tells when.
- The marks of the person's use of the screen stay right after the cuts.

## Notes

- A fix of #157, for the open release.
- How "a window appears" is detected is the plan's (the X connection the app already has can ask the server for the root's children, or the frame can be compared with the empty root).

