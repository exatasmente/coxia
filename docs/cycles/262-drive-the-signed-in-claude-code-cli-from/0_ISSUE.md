# 262 Drive the signed-in Claude Code CLI from the app: sessions, interaction and budget fallback

- Endereço: https://github.com/exatasmente/coxia/issues/262
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

A person who also works in Claude Code has two places where agents run: the Claude Code sessions on the machine and Coxia's own runs and conversations. Coxia cannot see the first, so following and steering them means leaving the app. And when the configured provider refuses a call for budget, every run stops and waits, even when the same person has a Claude Code CLI installed and signed in on that machine.

Part of this already works: a provider of kind `anthropic` saved with no key starts the SDK child with the real `HOME` and no credential, so the CLI uses the login it finds on the machine (checked with the SDK's `accountInfo()`: first-party, subscription account). That path is wanted and stays. What is missing is that nothing names it: the wizard does not offer it, `validate.ts` warns that the key is missing, and the cost of those calls is reported as API cost.

## What should happen

An opt-in feature, **off by default, desktop only**, that drives the `claude` CLI the person installed and signed in to themselves. Coxia never offers a login, never reads, stores or forwards a token, and never opens `~/.claude/.credentials.json`, `~/.claude/sessions/*.key` or `~/.claude/daemon/control.key`.

### 1. Claude Code sessions in the app

- A screen lists the machine's Claude Code sessions: transcripts (what the SDK's `listSessions` returns: title, first prompt, folder, branch, last change), sessions running now, and background sessions (`claude --bg`).
- Opening one shows its conversation and tool activity as it happens, in the same activity view the runs use.
- Transcript text goes through the same redaction as everything else the app shows.

### 2. Full interaction

- **Send a message** to a session: resume it (or fork it when another process holds it open) and stream the answer.
- **Answer permission requests**: when the session asks to use a tool, the request appears as a pending item for the person (like the turn-limit asks), with allow / deny; the session waits. Agents and the persona never answer these.
- **Stop**: interrupt the current turn; end the process only for sessions Coxia started.
- **Start** a new session in a project folder of the workspace.
- Every message sent, permission answered and session stopped is recorded in the audit with a kind of its own, naming the session.

### 3. Autonomous channel

- Coxia's runner and agents can hand a task to a Claude Code session and read its result, through one channel the app owns. The candidates are the Agent Client Protocol (ACP) adapter for Claude Code and the Agent SDK the app already ships (which has `listSessions`, `resume`, `forkSession`, `canUseTool`); the plan picks one and says why.
- A task handed this way follows the same rules as any agent of the run: its permission requests come to the person, and its writes stay inside the run's worktree.
- The `coxia-state` MCP server stays read-only; nothing in this issue gives it writes.

### 4. Signed-in CLI as a fallback on budget

- A provider of kind `anthropic` with no key keeps working as it does today, and is documented as "signed-in Claude Code CLI": the config, the wizard and the warning in `validate.ts` say that it uses the CLI's own login instead of saying a key is missing. It is never turned into a validation error.
- The person picks which roles or agents may fall back to it. When the provider of one of those refuses for budget (`ProviderBudgetError`), the call is retried once on the fallback instead of waiting; everything else keeps waiting as today.
- The fallback's own usage limit is read from the SDK's structured `rate_limit_event` (`five_hour`, `seven_day`, `resetsAt`), not from the message text: when it is reached, the run waits until the reset time and says so.
- Calls through the fallback are reported as subscription usage, never as API cost.

### 5. Remote Control for the sessions Coxia starts

- An option, off by default, to start Coxia's own Claude Code sessions (stages of a run, calls, ceremonies) with Remote Control on, so they show up in claude.ai/code and the Claude mobile app. The plan finds out how a session started through the Agent SDK can open the bridge (the in-session toggle, `remoteControlAtStartup` and `autoUploadSessions` are documented for interactive sessions, and isolated stages run with `settingSources: []`).
- The person chooses where it applies: per agent, or per run, never for every session at once by default. A view-only mirror (no control) is offered as the lighter choice.
- From the screen of item 1, the person can also turn Remote Control on for one session, and resume a session in a terminal with it on; when a stage still holds the session, it is forked instead.
- Remote Control hands whoever opens the session on the phone the session's own tools (editing files, running commands in the worktree), outside Coxia's paired-phone rules, sandbox and approvals. So: the switch exists only on the desktop, a workspace with `test: true` refuses it, each session opened with it is recorded in the audit, and the app says plainly, where the person turns it on, that this bypasses the paired-phone rules.

## Boundaries

- Every channel of this feature is denied to the paired phone from the first day (a denied prefix in `webPolicy.ts`), and its events go only to the desktop window, never through `broadcast`.
- The persona cannot reach it (`EXCLUDED` in the door table).
- A workspace with `test: true` refuses sending, starting and the fallback.
- Nothing from `~/.claude` (session slugs, folders, transcripts) goes into tests or fixtures.

## Acceptance

- With the feature off, no screen, channel or fallback exists, and a keyless `anthropic` provider keeps working as today.
- A keyless `anthropic` provider is shown as "signed-in Claude Code CLI", and its calls are reported as subscription usage, not API cost.
- With it on, the screen lists transcripts, running sessions and background sessions of the machine.
- A message sent from Coxia reaches the session and its answer streams in the app.
- A permission request from the session shows up as a pending item; denying it makes the session continue without the tool.
- Stop interrupts the turn; the audit has one line per message, answer and stop.
- A paired phone gets a refusal on every channel of the feature and receives none of its events.
- A role marked for fallback, whose provider refuses for budget, finishes the stage on the signed-in CLI; a role not marked waits as today.
- Reaching the fallback's usage limit makes the run wait until the reset time shown.
- With the Remote Control option on for an agent, a stage of that agent shows up in claude.ai/code; with it off, no session of Coxia does.
- `docs/configuration.md` describes the mode and what Coxia does and does not touch.

## Alternatives considered

- **Read-only view.** Not enough: steering the sessions from the app is the point.
- **Writes through the `coxia-state` MCP server.** That is the opposite direction (Claude Code reading Coxia) and would put writes behind a server with no approval.
- **`claude mcp serve`.** Exposes Claude Code's tools, not the agent, so it cannot carry a conversation.

## Comentários

(sem comentários)
