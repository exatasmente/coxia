# 282 Start Coxia's Claude Code sessions with Remote Control, off by default

- Endereço: https://github.com/exatasmente/coxia/issues/282
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

The Claude Code sessions Coxia starts (stages of a run, calls, ceremonies) cannot be followed or steered from claude.ai/code or the Claude mobile app.

## What should happen

- An option, off by default, to start Coxia's own Claude Code sessions with Remote Control on, so they show up in claude.ai/code and the Claude mobile app. The plan finds out how a session started through the Agent SDK can open the bridge (the in-session toggle, `remoteControlAtStartup` and `autoUploadSessions` are documented for interactive sessions, and isolated stages run with `settingSources: []`).
- The person chooses where it applies: per agent, or per run, never for every session at once by default. A view-only mirror (no control) is offered as the lighter choice.
- From the sessions screen, the person can also turn Remote Control on for one session, and resume a session in a terminal with it on; when a stage still holds the session, it is forked instead.

## Boundaries

Remote Control hands whoever opens the session on the phone the session's own tools (editing files, running commands in the worktree), outside Coxia's paired-phone rules, sandbox and approvals. So:

- the switch exists only on the desktop;
- a workspace with `test: true` refuses it;
- each session opened with it is recorded in the audit;
- the app says plainly, where the person turns it on, that this bypasses the paired-phone rules;
- the persona cannot turn it on.

## Acceptance

- With the option on for an agent, a stage of that agent shows up in claude.ai/code; with it off, no session of Coxia does.
- The view-only mirror shows the session and accepts no input.
- A workspace with `test: true` refuses the switch, and the paired phone never sees it.
- The audit has one line per session opened with Remote Control.

Split from #262 (delivery 5), the one with the highest risk. Depends on the sessions issue (deliveries 1 and 2).

## Comentários

(sem comentários)
