# How the local read-only state server is built

This plan turns 1_SPEC.md into concrete changes. It names every file and function touched, the order they are made in, one test per behavior, the risks and how they are avoided, and the decisions with their reasons. Everything it cites was read in this repository this round (the code paths below); nothing was executed, and the acceptance behaviors themselves are for the implementation stage.

## Decisions, first

**D1. The server is a second build entry, run by `node`, not an Electron process and not an npm package.**
`electron.vite.config.ts` already emits multiple entries in `preload`; the `main` build gains `mcp-state` the same way (`rollupOptions.input`): `out/main/mcp-state.js`, Electron-free, run with plain `node`. The npm package is not touched — CONTRIBUTING.md forbids distributing the Agent SDK, and the server needs none of it. The entry exists for any install whose `out/main` is reachable as a plain folder; when the app runs from inside an asar, Node cannot load code from there, and the Settings offer is hidden (R3).

**D2. The workspace is named by its id, not by a data-folder path.**
The setup entry carries `env: { "CERIMONIAS_MCP_WORKSPACE": "<workspace-id>" }`. The server resolves the id through `workspaces-core.ts` (`readRegistry`, `workspaceDir`): the registry is read-only, so this works with the app closed. Reason: putting the data root's absolute path into `.mcp.json` would write the person's home folders into a file that conventionally lives in the project folder and can be committed; an id is portable and the resolution is the app's own rule (`src/main/env.ts` DATA_ROOT, overridable by `CERIMONIAS_DATA_DIR` — the server honors it, so a machine with a moved data root gets the variable in its entry). Missing variable, an id not in the registry, or an id failing the registry's own id pattern: every tool answers one error that names the problem (spec rule 7), never a read.

**D3. Server naming mirrors the app's toolset names: `coxia_state_*`.**
The app's own toolsets are `runner`, `coxia_evidence`, `coxia_attachment`, `coxia_sandbox`, `coxia_vcs` (src/main/runner/tools.ts, src/main/vcs/engineTool.ts). The new server is `coxia_state` and its tools carry that prefix. Nothing else in scope renames or merges existing toolsets.

**D4. The tool methods are grouped in one new module; the JSON-RPC stdio loop is small and separate.**
`src/main/mcp-state/server.ts` (framing, JSON-RPC dispatch) and `src/main/mcp-state/tools.ts` (each read, shaped and redacted). The read shaping lives in the tools module as pure functions so tests without streams can call them.

**D5. Only Electron-free code may be imported.**
`runs-core.ts`, `board-core.ts`, `forum-core.ts`, `evidence/store.ts`, `errorlog-core.ts`, `shared/i18n.ts` and the shared run types are all electron-free and path-argument-based (each documents this; `runs-core.ts` says it outright, `board-core.ts` likewise; `forum-core.ts` and the activities rendering are verified by the implementation when they are wired). Any module that pulls in `electron` is off limits to the CLI; if a needed shaping turns out to live inside an electron-dependent module, the pure part is extracted into the file the CLI can import.

**D6. A pending command cannot be answered from a file, so the spec's wording on command answers is revised here.**
`src/shared/runs/types.ts` states a command waiting for the person to approve it "is never saved with the run" — it exists only inside the running app. A read that must refresh per call from the files (spec rule 3) cannot see it. The run read therefore answers the pending question (from the run file) and answers "none" for a pending command, with the reason in its description. Acceptance criterion 4 of 1_SPEC.md is taken as amended by this plan: "…or the command" is answered only for what the files declare, which today is the question. This is a plan decision, not a question for the person; the alternative (the app writing pending commands into a state file) is a write-path change outside this phase's read-only scope.

**D7. The procedure read ships as a constant, shape-stable answer until #179 lands.**
`coxia_state_procedures` is registered from day one but answers that the procedure store is not yet available for outside reads (the #179 store is in progress; 1_SPEC.md marks it the one blocked read). When #179 lands its store, this one tool's implementation is replaced; tool names and schemas do not change, so no session needs to re-pick-up anything.

**D8. The `.mcp.json` write is a person's action from Settings, confirmed in place, not a code-host action.**
`src/main/actions.ts` gates writes to the code host; writing the project folder's `.mcp.json` is a local file write the person initiates and confirms in the Settings dialog. The file is never touched on opt-out, and an existing `.mcp.json` is merged (`mcpServers` object merge), not overwritten — the app already reads that file shape (`loadMcpConfigs`, src/main/engine/open/tools/mcp.ts), and the merge refuses to replace an entry of the same name with a different command, answering a non-destructive message instead.

**D9. Machine-local absolute paths stay machine-local.**
The entry's `args` value is `["<install-path>/out/main/mcp-state.js"]` — an absolute path, like any local server entry. The copyable text shown in Settings goes through the existing home-shrinking the app uses for paths it displays (`src/shared/config/paths.ts` `shrinkHome`), so what lands on screen keeps no home-folder leak, and the public audit is not affected because the path is per-machine and never written into repository content, catalogs or tests.

**D10. Answers are masked as the app masks them, per surface.**
Prose surfaces (run summaries, conversation messages, evidence titles/descriptions, activity fronts): `redact` (`src/main/errorlog-core.ts:37`). Board and cycle texts: `redactDoc` (addresses in prose that are not addresses stay). File paths inside answers: `shrinkHome`. Nothing raw is returned; no tool returns a file path beyond what the app's own evidence read shows.

## The changes

### Build layer — new CLI entry
1. `electron.vite.config.ts`
   - `main.build.rollupOptions.input`: add `mcp-state: fileURLToPath(new URL('./src/main/mcp-state/cli.ts', import.meta.url))`, with the output conventions the main build already uses, expecting `out/main/mcp-state.js`.
   - Test: `test/mcp-state-build.test.ts` — asserts the config exposes an `mcp-state` input and that the CLI file imports no `electron` (a static scan of imports).

### Server layer — `src/main/mcp-state/server.ts`
2. `src/main/mcp-state/server.ts` (new):
   - `serve(input, output, tools, env)` — reads `input` as newline-delimited JSON-RPC 2.0 (framing symmetric with what `McpClient` sends, src/main/engine/open/tools/mcp.ts), answers `initialize` (protocol `2024-11-05`, as `McpClient` sends), `tools/list` (each tool's `inputSchema`, JSON-schema objects like the app's own tool types in `src/main/engine/open/tools/types.ts`), `tools/call` (dispatch by name, result as `{ content: [{ type: 'text', text }], isError }` — the shape `McpClient.callTool` parses), and refuses any other method or any write-shaped tool with `isError: true` text. Unknown tool: error, never a fallthrough.
   - The resolve step: read the workspace from the environment (`CERIMONIAS_MCP_WORKSPACE`, `CERIMONIAS_DATA_DIR` as DATA_ROOT override) before any answer; an unresolved workspace makes every remaining call answer the same error text with `t()`.
   - Test: `test/mcp-state-server.test.ts` — `serve` over in-memory duplex streams (no real process): initialize, list, call, unknown method, malformed line ignored (the app-side parser ignores non-message lines; the server does the same), calls before and after environment problems.

### Tool layer — `src/main/mcp-state/tools.ts`
3. `src/main/mcp-state/tools.ts` (new). One function per read, all pure over a workspace data dir:
   - `buildCycles(boardFile)` — `createBoardStore` (`src/main/board-core.ts`) `list()`, shaped to id, title, column, squad, priority, host link (`group/project` and `#123` as the app stores them); `redactDoc` over the text fields. Answers criterion 3: the same cards the app's tracker shows for the workspace, and nothing of another workspace (the file is the workspace's own).
   - `buildRuns(runsDir)` — `createRunStore` (`src/main/runs-core.ts`) `list()`, shaped to `id`, `issue.ref`, current `stage`, `status`, and `question` (the exact pending question, `src/shared/runs/types.ts` PendingQuestion wording) when the run is in `question` status; `redact` over title and question text. Criterion 4, with D6's revision about commands.
   - `buildConversation(forumDir, run)` — open the run's thread via `runThreadId` (`src/shared/forum.ts`) with `createForumStore` (`src/main/forum-core.ts`), answer the messages as the run saw them minus system-authored lines: app-worded messages render through their `code` key with `t()` (the same display-time rendering the app gives the thread), agent and person messages in order; `redact` over each text. Criterion 5, including a planted secret shape coming back masked.
   - `buildEvidence(run)` — `Run.evidence` records plus `evidencePath` (`src/main/evidence/store.ts`) for the stored path, shaped to name, title, description, stage, kind; path through `shrinkHome`, text through `redact`. Criterion 6: the same list the run's stage shows.
   - `buildActivities(dataDir)` — read `<workspace>/memory/activities.json` (`MEMORY_DIR` / `ACTIVITIES_FILE`, `src/main/runner/activities.ts`), render the fronts as prose with `redact`, or answer empty when the file is absent — never inventing state (`t()` for the empty answer). Criterion 7.
   - `buildProcedures()` — the constant refusal of D7, through `t()`.
   - Each tool's answer is built at call time (fresh reads in every function body — criterion 8, no state captured at server start).
   - Tests: `test/mcp-state-tools.test.ts` — fixtures built with the stores' own write surfaces (`test/helpers/` temp dirs):
     - cycles mirror fixture board cards and exclude a second workspace's file;
     - a run in `question` status answers its exact question; a `gate` run answers its status and no question;
     - conversation excludes system-authored lines and masks a planted credential shape, keeps agent order;
     - evidence list equals the records planted on the run, with the stored path shrunk;
     - activities answer matches the memory file's shape, and absence answers the empty message;
     - a call after a fixture file changes answers the change (refresh per call), and a run written by a newer schema answers "not readable", exactly as the run store refuses.
   - Test: `test/mcp-state-redact.test.ts` — the doc/prose mask split (D10) holds: a planted header token, an email, a long opaque string, a home path never cross any answer unmasked; a pinned version in board prose is not falsely masked (`redactDoc`'s documented behavior).

### Config layer — the opt-in
4. `src/shared/config/types.ts`, `defaults.ts`, `schema.ts`
   - New `WorkspaceConfig` field: `mcpState: { enabled: boolean }` (the opt-in; nothing else — the entry is derived, not stored: D2 makes the entry a function of workspace id and install location, so it cannot drift from the workspace it serves).
   - `defaults.ts`: `{ enabled: false }` — off unless the person turns it on (spec rule 6).
5. `src/shared/config/migrations.ts`
   - New step `v23ToV24`: adds `mcpState: { enabled: false }` when absent, schemaVersion 24, `CONFIG_SCHEMA_VERSION = 24` in types.ts. Follows the standing step pattern (`v22ToV23` and its note that a section the person already had must survive untouched).
   - Test: `test/config-mcp-state.test.ts` — a schema-23 document migrates to `enabled: false` and keeps every other section; a document that already carries `mcpState` keeps it.
6. `src/main/index.ts`
   - Workspace switch already refetches config; the toggle resolves from the resumed config. Existing code paths are reused; the new state is only read here.

### Settings — toggle, copyable entry, write offer
7. Renderer Settings panel (the workspaces section of the settings screen — the implementation lands the toggle where workspace settings are edited):
   - A toggle wired to `mcpState.enabled` through the existing workspace-config update flow; off hides the entry offer entirely (criterion 1).
   - On: a read-only, copyable text block with the exact `{ "mcpServers": { "coxia-state": … } }` object (server name from D3, args from D1/D9, env from D2, `CERIMONIAS_DATA_DIR` present only when the machine's data root is not the default DATA_ROOT location), plus one offered write into the project folder's `.mcp.json` (merge rule D8). Strings through `t()`, both catalogs; theme tokens only (`node scripts/theme-audit.mjs` guards it).
   - Test: `test/settings-mcp-state.test.ts` — following the existing settings test harness the implementation extends: off → no entry shown, no write offered; on → entry rendered with the workspace id, and the write offer merges into an existing `.mcp.json` fixture without clobbering a foreign server.
8. `CHANGELOG.md` — a line under `## [Unreleased]`: read-only local state server a terminal session can add over stdio, with the per-workspace opt-in (user-facing).

## Order

1. Config types, defaults, schema, migration (4–5) — everything downstream reads the flag.
2. Tool layer (3) — pure functions, testable without streams.
3. Server layer (2) over the tool layer.
4. Build entry (1) so the CLI exists with its tests.
5. Settings UI (7) and the changelog line (8).

## Tests and what they prove

| Behavior | Test file |
|---|---|
| Framing, methods, error answers | `test/mcp-state-server.test.ts` |
| Each read's shape, isolation, freshness | `test/mcp-state-tools.test.ts` |
| Masking on every surface, never a raw secret | `test/mcp-state-redact.test.ts` |
| Workspace resolution: missing/unknown/valid | same server test's env cases (D2) |
| Migration adds the off default safely | `test/config-mcp-state.test.ts` |
| Toggle and entry copy in Settings | `test/settings-mcp-state.test.ts` |
| CLI imports no electron | `test/mcp-state-build.test.ts` |

The suite runs over in-memory streams and `test/helpers/` fixtures; nothing spawns a real app, a model, a code host or a network. The final-stage gates (tsc, vitest, theme-audit, i18n:lint, public-audit) run as CONTRIBUTING.md prescribes.

## Risks and how they are covered

- **R1. Protocol drift with what Claude Code actually sends.** The framing mirrors what the app itself sends as an MCP client (`McpClient`'s initialize/notifications/initialized and tools calls); a real session's pickup is not verifiable in this repository and stays person-verified.
- **R2. Read code drifting from the app as both sides evolve.** The CLI imports the same modules (`runs-core.ts`, `board-core.ts`, `forum-core.ts`, `evidence/store.ts`, `errorlog-core.ts`) — not copies; the duplicate is only the build artifact. `test/mcp-state-build.test.ts` fails if the CLI module itself grows an electron import; if a module is later made electron-dependent, its electron-free contract is what this change rests on and the module's own tests catch it.
- **R3. Packaged installs cannot spawn a CLI from inside an asar.** Offered only when `out/main/mcp-state.js` is a plain readable file next to the app; else Settings answers the reason instead of an entry. Development and npm-run installs are covered.
- **R4. An outside reader could read state the person thinks is private.** The opt-in is explicit per workspace, default off, and every answer already crosses the app's masking layer; nothing is served before the toggle. The isolation test proves another workspace is never read.
- **R5. `.mcp.json` merge could damage a file the person maintains by hand.** Merge only merges, refuses to replace a different server under the same name, and the person confirms before it is written (D8). The settings test covers merge-not-clobber.
- **R6. Pending commands invisible.** D6 names the gap openly and answers "none" with the reason; no invented state.

## What the plan does not cover (said, per the stage rule)

- Criterion 4's command half (covered for the question, revised for the command — D6).
- Criterion 2's check through a real external session: nothing built in the CLI can assert what an external session lists; this stays person-verified with the Settings entry.
- The exact settings harness file name for the toggle test (the implementation chooses among the existing settings tests rather than the plan inventing one).
- `mcp-state` entry behavior under Windows (path separators, spawn): not designed here; the implementation verifies what the config's own portability tests allow.
