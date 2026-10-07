---
checked-commit: 1a0858c59ed1d4c43e03feb3e709bbefd8441336
checked-date: 2026-10-06
evidence: [package.json, src/main/index.ts, CLAUDE.md, docs/README.md, docs/configuration.md:1-11]
summary: The architecture of the app: the three processes, the module folders, and where data lives
---

# Overview

Coxia is an Electron application. `electron-vite` builds three targets into `out/`:

- **main** (`src/main/`) — the Node process. It owns the window, the tray, the scheduler,
  the agent engines, the runner, the code-host providers, the secrets and the voice sidecar.
- **preload** (`src/preload/`) — the bridge between the window and main.
- **renderer** (`src/renderer/src/`) — the React interface.

Code that does not need Electron lives in `src/shared/` or in a `*-core.ts` next to its
Electron module, so it can be tested without the app. The build, the tests and the audits
are described in `rules/build-and-test.md`.

## Main-process modules

`src/main/index.ts` wires the app: it creates the window and the tray, binds IPC
(`bindIpc`/`handle` in `src/main/rpc.ts`), registers `MODULES`, and starts the scheduler and
the web access. Each channel handler is a thin function that calls into a module.

Important module groups:

| Folder | What it does |
|---|---|
| `src/main/engine/` | The agent engines: the contract, the registry, the shared write guard |
| `src/main/vcs/` | The neutral code-host interface (GitLab, GitHub, Bitbucket) |
| `src/main/runner/` | The agent cycle: worktree, stages, publishing, memory, git, commands |
| `src/main/sandbox/` | The per-stage sandbox for an agent's commands |
| `src/main/conflict*` | Release-conflict resolution, hunk by hunk |
| `src/main/web*.ts` | The paired-phone HTTP server, its policy, auth, push and idempotency |

`src/main/agents.ts` dispatches a call to an engine by role. `src/main/workspaceConfig.ts`
(`rc()`) reads the workspace configuration and must be read at the time of use, never at
module import.

## Renderer

Screens live in `src/renderer/src/screens/`, the setup wizard in
`src/renderer/src/wizard/`. The interface uses theme tokens (CSS custom properties), never a
literal color, and every user-facing string goes through `t()` (`rules/i18n.md`).

## Where data lives

The app's data root is `cerimonias` under the platform's application-data folder. It can be
redirected with `CERIMONIAS_DATA_DIR`; the specs folder with `CERIMONIAS_SPECS_DIR`. Layout:

| What | Where |
|---|---|
| Workspace registry | `<data>/workspaces.json` |
| Workspace configuration | `<data>/workspaces/<id>/config.json` |
| Secrets | `<data>/secrets.json` (mode 0600), shared by every workspace, never exported |
| Browser access | `<data>/web.json` (per machine) |
| Runs | `<data>/workspaces/<id>/runs/<id>.json` |
| Threads | `<data>/workspaces/<id>/forum/<thread>.jsonl` |
| Audit log | `auditoria.jsonl` in the workspace |

A workspace can be marked as a **test** workspace, in which every external effect is
refused (`rules/safety-model.md`).

## The cycle folder

`docs/cycles/<n>-<title>/` in the working tree holds the documents of one run: the issue
record `0_ISSUE.md`, the stage artifacts, and the fixed-name `MEMORY.md`. The runner's rules
are in `rules/runner.md`.
