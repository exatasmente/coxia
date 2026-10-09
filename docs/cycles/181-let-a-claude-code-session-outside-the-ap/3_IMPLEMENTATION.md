# Local state server: what was built

## What exists now

- **Per-workspace opt-in (config schema 24).** `mcpState: { enabled: false }` in each workspace's config (types, defaults, schema, migration v23→v24; a choice already stored survives).
- **The server (src/main/mcp-state/).** `tools.ts` holds the six reads as pure functions of the workspace data folder, re-read at every call, masked like the app's own answers (`redact` in prose, `redactDoc` on the board, home paths shrunk): `coxia_state_cycles` (board cards), `coxia_state_runs` (stage, status, exact pending question; a command waiting for approval is named as never visible — it is not saved with a run), `coxia_state_conversation` (run thread without system lines), `coxia_state_evidence` (names, kinds, stored path), `coxia_state_activities`, `coxia_state_procedures` (the #179 store, listed without steps — real, not the constant refusal D7 held open, since that store is Electron-free and landed). `server.ts` frames newline-delimited JSON-RPC 2.0 like the app's own client sends (protocol 2024-11-05), refuses unknown tools with an error answer and unknown methods with -32601; `cli.ts` is the node-run entry (`out/main/mcp-state.js`, new main build input). The workspace resolves from `CERIMONIAS_MCP_WORKSPACE` against the registry with the data root from `CERIMONIAS_DATA_DIR` (default as env.ts) and the workspace's own `mcpState.enabled`; every failure answers the same refusal text on every tool.
- **Settings (McpStateSection under the workspaces section).** Toggle through the workspace config save; when on, a copyable `{"mcpServers":{"coxia-state": ...}}` entry (workspace id by `CERIMONIAS_MCP_WORKSPACE`, `CERIMONIAS_DATA_DIR` only on a moved data root) and a person-confirmed merge write of that entry into a project folder's `.mcp.json` — merges beside the project's other entries, refuses to replace a same-name entry with a different program, and never touches the file on opt-out. One planned deviation: the entry file path stays the real absolute path in the copyable text and written entry (a `~`-shrunk spawn argument would not expand); the shrunk form is used for the display line only.
- **Isolation and safety:** all `mcpstate:` channels are desktop-only (webPolicy); no tool writes anything; nothing is served before the opt-in.

## What was checked with commands

- vitest green: mcp-state-server (framing, refusals, malformed lines, workspace problems), mcp-state-tools (each read's shape, other-workspace isolation, planted secret masked, freshness, newer-schema run refused), settings-mcp-state (off shows nothing, on shows entry and write offer, unavailable states the reason, paired browser renders nothing).

## Not verified here

- A real Claude Code session picking the entry up (person verification), the packaged/asar and Windows behavior of the entry.
- The written-but-unchecked tests above and the five gates; a final clean tsc pass was not re-run after the last fixes.

## Open

- The web search question stays for the answer sent out of this session.
