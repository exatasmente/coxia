# Local state server: what was built

## What exists now

- **Per-workspace opt-in (config schema 24).** `mcpState: { enabled: false }` in each workspace's config (types, defaults, schema, migration v23→v24; a choice already stored survives).
- **The server (src/main/mcp-state/).** `tools.ts` holds the six reads as pure functions of the workspace data folder, re-read at every call, masked like the app's own answers (`redact` in prose, `redactDoc` on the board, home paths shrunk): `coxia_state_cycles` (board cards), `coxia_state_runs` (stage, status, exact pending question; a command waiting for approval is named as never visible — it is not saved with a run), `coxia_state_conversation` (run thread without system lines), `coxia_state_evidence` (names, kinds, stored path), `coxia_state_activities`, `coxia_state_procedures` (the #179 store, listed without steps — real, not the constant refusal D7 held open, since that store is Electron-free and landed). `server.ts` frames newline-delimited JSON-RPC 2.0 like the app's own client sends (protocol 2024-11-05), refuses unknown tools with an error answer and unknown methods with -32601; `cli.ts` is the node-run entry (`out/main/mcp-state.js`, new main build input). The workspace resolves from `CERIMONIAS_MCP_WORKSPACE` against the registry with the data root from `CERIMONIAS_DATA_DIR` (default as env.ts) and the workspace's own `mcpState.enabled`; every failure answers the same refusal text on every tool.
- **Settings (McpStateSection under the workspaces section).** Toggle through the workspace config save; when on, a copyable `{"mcpServers":{"coxia-state": ...}}` entry (workspace id by `CERIMONIAS_MCP_WORKSPACE`, `CERIMONIAS_DATA_DIR` only on a moved data root) and a person-confirmed merge write of that entry into a project folder's `.mcp.json` — merges beside the project's other entries, refuses to replace a same-name entry with a different program, and never touches the file on opt-out. One planned deviation: the entry file path stays the real absolute path in the copyable text and written entry (a `~`-shrunk spawn argument would not expand); the shrunk form is used for the display line only.
- **Isolation and safety:** all `mcpstate:` channels are desktop-only (webPolicy denies the whole prefix by pattern, now pinned by a channel-level test); no tool writes anything; nothing is served before the opt-in.

## What was checked with commands

- `npx tsc --noEmit`: green (exit 0) after the review's fixes were made on this attempt — the mcp-state module's imports now resolve from the env and workspace-config modules, the merge entry argument is narrowed to a record with the same-entry check, the write-entry target is stringified behind the known-target guard, and the section component binds its own `t()`.
- The touched and new suites green: `npx vitest run` over config-migrations (schema pin moved to 24, 25 refused), ui-i18n, mcpstate-policy (new), mcp-state-server, mcp-state-tools, mcp-state-redact, mcp-state-build, config-mcp-state, settings-mcp-state — 9 files, 110 tests passed.
- The full `npx vitest run` (all 400 files): only the four browser suites fail (browser-contract, browser-quit, browser-runtime, browser-sites), all on this environment's missing `@playwright/mcp` module and a browser-lifecycle test, the same environmental failure the review recorded; everything else passes (396 files, ~6.6k tests).
- `npm run i18n:lint` green (0 untranslated, 5408 keys in both catalogs): the review's flagged border literal now carries an `i18n-ignore` comment with its reason on the same line.
- `node scripts/theme-audit.mjs` exits 0; its 14 findings sit in cycle screens this change does not touch (same list the review gave).
- `node scripts/public-audit.mjs` green over 1530 files.
- The 19 `ui.settings.mcp.*` keys were moved into sorted position among the settings keys, in both ui catalogs (only reorder: the diff moves 19 lines per catalog, no value changed).

## Not verified here

- A real Claude Code session picking the entry up (person verification), the packaged/asar and Windows behavior of the entry.
- `electron-vite build` was not run, so the built `out/main/mcp-state.js` bundle was not inspected beyond the electron-free scan in the build test.
