---
checked-commit: b94bbea2d99f0d0ebee1ce0b6d5e24e2c9adf9d3
checked-date: 2026-10-06
evidence: [src/main/engine/guard.ts:1-80, src/main/webPolicy.ts:1-65, src/main/workspace.ts:1-22, src/main/actions.ts:1-70, src/main/engine/scrubShell.ts, test/runs-policy.test.ts, test/forum-policy.test.ts]
summary: Read-only agents, the single write door, the audit log, test workspaces, the sandbox and the paired-phone policy
stages: [development, review, qa]
roles: [developer, tech-lead, qa]
---

# Safety model

Agents are read-only. Anything with an effect outside the app (a comment, a label, a push, a
merge-request update, a note in the plan) becomes a **proposed action** showing the exact
command; it runs only after the person confirms it, and every executed action is recorded in
an audit log. A workspace can be marked as a **test** workspace, in which every external
effect is refused.

## Read-only tools

The tools an agent has are `Read`, `Grep`, `Glob`, an allowlisted `Bash`, `Skill`, a
read-only sub-agent, and the MCP tools the person allows. No `Edit`, no `Write`, no web fetch
or search. The open engine enforces the same policy with the same hooks. Shell commands are
matched against strict patterns (one command, no `;`, `&&` or pipes beyond `head`); the open
engine runs commands with no shell at all.

## Secret files are out of reach

`.env` files, keys, the SSH folder, `.mcp.json`, anything named like a secret or a credential
is blocked before reading and while searching (`secretPath` in `src/main/agents.ts`, applied
by `Grep`/`Glob` too), and tool results are redacted. The credential store
(`rules/key-store.md`) never returns a value except to a child process or an HTTP header.

## The single write door

`src/main/actions.ts` is the one place external effects are stored and executed. A module
describes a write (`planWrite`), the proposal is validated against a per-provider shape before
it is stored and again before it runs, and the executor is imported only by
`src/main/vcs/runtime.ts`. Two variations use the same door: a group of writes that wait for
one yes, and an autonomous agent's write (`runVcsAuto`), which skips the yes but keeps the
same validation, the same test-workspace refusal and the same audit log. The runner reaches
the door only through `src/main/runner/door.ts`. Read `rules/code-hosts.md`.

## Audit log

Every executed action is appended to `auditoria.jsonl` in the workspace, with the body and
without the token. An autonomous agent's write records the agent in `by` and the body hash in
`bodyHash`.

## Test workspaces

A "test" mark keeps every effect on the machine. `externalRefusal` in `src/main/workspace.ts`
returns the refusal for a write that leaves the machine, or null when allowed; the same
refusal applies whether the write was started by hand or by an autonomous agent.

## The sandbox

An agent that runs commands may get a sandbox, built for each stage and ended with it (Linux
with bubblewrap; macOS and Windows offer only `none` and the allowlist, because no equivalent
is within a desktop app's reach). The worktree is writable (an agent that only reads gets a
throwaway copy, and nothing it does reaches the branch); the rest of the system is read-only
and nothing else of the system is present: no home folder, no `/run`, no `/var`, so no key,
token, agent socket or container socket. `.git` is read-only with its `config` replaced and
`hooks` emptied; the environment is built from scratch; there is no network except the
sandbox's own loopback (and, with the registry key, HTTPS only to the hosts the app's proxy
lists). There are limits per command (time, data memory, file size) and per stage
(processes, total command time). The sandbox ends **before** the app commits the stage's
changes.

An agent set to `shell: host` runs any command on this computer, as the person, outside any
sandbox; every command waits for the person's permission first ("Allow once", "Allow until
the stage ends", "Do not allow"), and the stage's clocks stand still meanwhile. Only the
computer sets `host`: a paired browser cannot raise an agent to it, and a cycle template never
brings it.

## The paired phone (PWA)

Off by default and bound to loopback. Pairing uses a short-lived one-time code shown on the
desktop; sessions are device-bound, expire, and failed attempts are rate-limited.
`src/main/webPolicy.ts` decides what a browser session may call:

- `DESKTOP_ONLY` covers the terminal, the clipboard, the login items, local file deletion,
  native notifications, the shell commands a conflict resolution runs, the workspace test
  flag and deletion, every `update:*` channel, the VCS probe and the sandbox probe.
- `EXTERNAL_EFFECT` (`actions:approve`, `runs:command`, `runs:startRelease`) needs the
  external-effects switch. Approving a proposal from the phone is off unless the person turns
  it on.
- The voice setup channels (`voice:check`, `-install`, `-test`, `-uninstall`, `-enable`) and
  the wizard are desktop-only.
- `forum:*` is open, because those channels touch only the workspace's own thread files.
- `runs:*` are all open except `runs:command` and `runs:startRelease` (behind the
  external-effects switch); none of them lets a browser name a program or a folder.

Tests pin these lists: `test/runs-policy.test.ts`, `test/forum-policy.test.ts`,
`test/updates-policy.test.ts` and `test/web-server.test.ts`.

## Updates

The update feed is HTTPS only, the downloaded AppImage's sha512 is checked, there is no
downgrade, and the install happens only on the person's decision (`rules/updates.md`).
