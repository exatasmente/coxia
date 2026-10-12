# 280 List and drive the machine's Claude Code sessions from the app

- Endereço: https://github.com/exatasmente/coxia/issues/280
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

A person who also works in Claude Code has two places where agents run: the Claude Code sessions on the machine and Coxia's runs and conversations. Coxia cannot see the first, so following and steering them means leaving the app.

## What should happen

An opt-in feature, **off by default, desktop only**, that drives the `claude` CLI the person installed and signed in to. Coxia never offers a login, never reads, stores or forwards a token, and never opens `~/.claude/.credentials.json`, `~/.claude/sessions/*.key` or `~/.claude/daemon/control.key`.

### Sessions in the app

- A screen lists the machine's Claude Code sessions: transcripts (what the SDK's `listSessions` returns: title, first prompt, folder, branch, last change), sessions running now, and background sessions (`claude --bg`).
- Opening one shows its conversation and tool activity as it happens, in the same activity view the runs use.
- Transcript text goes through the same redaction as everything else the app shows.

### Interaction

- **Send a message** to a session: resume it (or fork it when another process holds it open) and stream the answer.
- **Answer permission requests**: when the session asks to use a tool, the request appears as a pending item for the person (like the turn-limit asks), with allow / deny; the session waits. Agents and the persona never answer these.
- **Stop**: interrupt the current turn; end the process only for sessions Coxia started.
- **Start** a new session in a project folder of the workspace.
- Every message sent, permission answered and session stopped is recorded in the audit with a kind of its own, naming the session.

## Boundaries

- Every channel of this feature is denied to the paired phone from the first day (a denied prefix in `webPolicy.ts`), and its events go only to the desktop window, never through `broadcast`.
- The persona cannot reach it (`EXCLUDED` in the door table).
- A workspace with `test: true` refuses sending and starting.
- Nothing from `~/.claude` goes into tests or fixtures.

## Acceptance

- With the feature off, no screen or channel exists.
- With it on, the screen lists transcripts, running sessions and background sessions of the machine.
- A message sent from Coxia reaches the session and its answer streams in the app.
- A permission request from the session shows up as a pending item; denying it makes the session continue without the tool.
- Stop interrupts the turn; the audit has one line per message, answer and stop.
- A paired phone gets a refusal on every channel of the feature and receives none of its events.

Split from #262 (deliveries 1 and 2). The budget fallback (delivery 4) shipped in #274.

## Comentários

(sem comentários)
