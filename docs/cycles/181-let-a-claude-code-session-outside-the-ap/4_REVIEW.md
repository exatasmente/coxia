# Review of the local state server

## What was reviewed

The branch's code commit against 1_SPEC.md, 2_PLAN.md and the repository's own rules. Every claim below was checked by reading the changed files and the modules they import, and by running the gates: `npx tsc --noEmit`, a full `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` and `node scripts/public-audit.mjs`. Gate outputs are kept as evidence (ev-2).

## What holds

- The behavior matches the spec and the plan: a separate stdio server run by plain node (new main build entry), one workspace per instance named by `CERIMONIAS_MCP_WORKSPACE` and resolved against the registry with `CERIMONIAS_DATA_DIR`, the default-off opt-in in the workspace config (schema 24, migration `v23ToV24`), the six reads under `coxia_state_*`, answers rebuilt per call, prose masked with `redact`, board text with `redactDoc`, machine paths shrunk, another workspace never answered, and exactly one refusal text naming the problem for a missing, invalid, unknown or opted-out workspace. The planned deviations from D6/D7 (commands never saved with a run are named in the answer's note; procedures reads the real #179 store without its steps) and D9 (real absolute path in the entry, shrunk form on the display line only) are as the plan and the handoff describe.
- The merge write into a project's `.mcp.json` is merge-only, refuses a same-name entry with a different program and never writes anything on opt-out; only a target folder the view offers is accepted; the write is the person's confirmed action.
- The new `mcpstate:*` channels are denied to web access in webPolicy.ts, so the panel never appears in a paired browser; no tool in the server writes anything.
- Tests use fakes and temp fixtures only; isolation, masking (planted token, header, email, opaque string, home folder), freshness, refusals and merge cases are all covered by the new test files.
- `npm run i18n:lint` and `node scripts/public-audit.mjs` pass: nothing of the company, person, host, real issue number or secret kind is in the tree.

## Blockers

1. **`npx tsc --noEmit` fails (five errors).** `src/main/mcp-state/module.ts` imports `'./env'` and `'./workspaceConfig'`, but `HOME`/`WORKSPACE_ID` and `getConfig`/`updateConfig` live at `src/main/env.ts` and `src/main/workspaceConfig.ts`, so the modules cannot be resolved (the implicit-any and unknown-type errors on its lines 49 and 58 follow from that); `src/main/mcp-state/entry.ts` line 36 narrows `there` to `object`, which lacks the index signature `sameEntry` needs; and `McpStateSection.tsx` line 130 calls `t()` in `McpStateSection` where only `McpStatePanel` binds `useT()`. The typecheck is red, so the change is not done by the repository's own gate.
2. **The full suite fails on an existing test the version bump had to update.** `test/config-migrations.test.ts` still pins `CONFIG_SCHEMA_VERSION` at 23 and refuses 24 as "a newer app"; the migration to 24 was made, but this test was not updated.
3. **The ui catalogs fail the sorted-keys test.** The new `ui.settings.mcp.*` keys were appended after `ui.workspaces.use` instead of sorted among the settings keys, in both `ui-settings.en.json` and `ui-settings.pt-BR.json`, so `test/ui-i18n.test.ts` fails twice.
4. **One untranslated string.** `McpStateSection.tsx` line 37's CSS border literal is flagged by the i18n lint; the repository's pattern is an `// i18n-ignore:` comment for such literals.
5. **The web policy change has no test.** Every other area with desktop-only channels has a policy test pinning them; `mcpstate:` pins none. The rendered-empty guard exists in the settings test, but the channel-level denial is untested.

## Not blocking (suggestions)

- `cli.ts` comment typo: "Stdio us broken".
- `tools.ts` duplicates the default data root as a literal (`~/.local/share/cerimonias`) instead of importing `DATA_ROOT`/`HOME` from `../env.ts`, which is electron-free; the same value can drift, and the electron-free scan of the build test never runs on `env.ts` either way.
- `server.ts`'s header comment says the workspace "resolves here, once" while the same comment and the code re-resolve per tool call.
- The new `main.mcpstate.*` keys were appended at the ends of both main catalogs, out of sorted order; the ui catalogs are the tested ones, so this follows a pre-existing unsorted pattern and is a clean-up only.

## Not verified

- A real Claude Code session picking the server entry up (the issue's criterion 2), the packaged/asar and Windows behavior of the entry — stays person-verified, as the plan already assigned.
- The built `out/main/mcp-state.js` artifact itself: the electron-freeness of the CLI's direct and transitive imports was checked by reading (no `electron` import in any of the modules the tools layer pulls, and the build test scans the mcp-state folder), but `electron-vite build` was not run, so the actual bundle was not inspected.
- The theme-audit's 14 literal-color findings sit in files this change does not touch (api.ts, HandoffCard.tsx, LiveScreen.tsx, frames.ts, screenApi.ts and companions); whether they predate this branch or another landed with it on the same line was not traced, and they are not this change's.
- The browser suites' failures were confirmed to be this environment's missing `@playwright/mcp` module, not behavior of this change.

## Verdict

Changes: fix the typecheck errors, update the schema-version pin, sort the ui catalog keys and mark the CSS literal, and add the mcp-state policy test. Once those land, re-review needs only those points; everything accepted here stands.
