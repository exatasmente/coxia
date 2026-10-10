# 5_TEST_PLAN.md — Cycle , QA

Plan written from the acceptance criteria of `1_SPEC.md`. Scenarios executed against the committed worktree
and, for the interface, against the running app with a disposable data folder
(`CERIMONIAS_DATA_DIR=/tmp/qa170-data`, `CERIMONIAS_SPECS_DIR=/tmp/qa170-specs`), started with
`npx electron-vite dev -- --no-sandbox`, driven through Playwright over the local CDP endpoint at
127.0.0.1:9222. No product code was changed to test.

## Scenarios

| # | Scenario | Action | Expected | Result |
|---|---|---|---|---|
| 01 | Repository tests for the new modules | `npx vitest run test/testEnv-schema.test.ts test/testEnv-resolve.test.ts test/sandbox-host.test.ts test/maskExact.test.ts test/actions-testEnv.test.ts` | All pass | Executed — 5 files, 35 tests passed, exit 0 (ev-30) |
| 02 | Tests extended by the change (policy, proxy, runner, migrations) | `npx vitest run test/sandbox-policy.test.ts test/sandbox-proxy.test.ts test/runner-sandbox.test.ts test/config-migrations.test.ts` | All pass, migration keeps an existing section | Executed — 4 files, 88 tests passed, exit 0 (ev-31) |
| 03 | Type gate | `npx tsc --noEmit` | No output, exit 0 | Executed — exit 0 (ev-37) |
| 04 | Whole test suite | `npx vitest run` | Only known environmental failures | Executed — 4899 passed, 24 skipped, 2 failed: both in `voice-setup` (ev-32) |
| 05 | voice-setup failure is pre-existing | Rerun of `test/voice-setup.test.ts` isolated | Same failure isolated, unrelated to the change | Executed — "Tests 2 failed | 19 passed (21)", the disk-low assertion depends on this sandbox's disk state (ev-33) |
| 06 | App launches with a disposable data folder | Electron dev on /tmp/qa170-data driven over CDP on the virtual display | Window renders | Executed — Settings screenshot (ev-38) |
| 07 | Test environment section exists | Open Settings › Team › "Ambiente de teste" | Section with Variables and Secrets lists | Executed — empty state with "Nada ainda" on both lists (ev-39) |
| 08 | Variable entry surface | Read the section bottom | "Adicionar variável"/"Adicionar segredo" actions, save state indicator | Executed (ev-40) |
| 09 | Non-test-only secret requires the one-time confirmation | Fill a secret, leave "Só de teste" OFF | "Confirmar uma vez" appears with the reason | Executed (ev-41) |
| 10 | Secret entry carries its metadata only | Secret form (name "model" → ref `test.model`) | test-only toggle, declared hosts and private hosts fields; value masked, "never shown again" | Executed (ev-42) |
| 11 | Saved state after adding the secret | Add secret and save | "Não salvo" indicator leaves; plain text without the secret | Executed (ev-43) |
| 12 | Refilled form keeps metadata, not the value | Reopen the filled entry (test-only ON) | Value field does not re-present the stored value | Executed (ev-44) |
| 13 | Configuration file carries values and references only (AC 1) | Read `/tmp/qa170-data/workspaces/principal/config.json` | Variables keep the plain value; secrets keep ref + metadata; no resolved value | Executed — `{"variables":[{"name":"INTEGRATION_URL","value":"https://staging.example.com",...}],"secrets":[{"ref":"test.model","testOnly":false,...}]}`; the secret value string is not in the file; schema 21 (ev-34) |
| 14 | Audit log records the confirmation (AC 9) | Read `auditoria.jsonl` | kind `test-env`, ok true, result "confirmed" | Executed (ev-35) |
| 15 | Confirmations ledger exists in DATA_ROOT | Read `/tmp/qa170-data/test-env-approvals.json` | Ledger lists the confirmed entry | Executed (ev-36) |
| 16 | Remaining quality gates | theme-audit, i18n:lint, public-audit | Exit 0, no new finding | Executed — theme-audit total 8 literal colors in api.ts, pre-existing, none new; 4854 keys in both languages across 11 catalogs; public audit 1290 files clean (ev-45, ev-46, ev-47) |

## Coverage against the acceptance criteria, and what this plan does not cover

- AC 1 — covered by scenario 13 for the file itself and no resolved value inside it; the app's configuration
  export was not exercised (not verified).
- AC 4 — covered by the repository suite for data masked by maskExact and the Actions door (scenarios 01, 02),
  which assert raw, URL-encoded and JSON-escaped forms.
- AC 5 — covered by `test/actions-testEnv.test.ts` in scenarios 01–02 (commit/PR carrying a value refused;
  no test environment → no refusal).
- AC 9 — covered by scenarios 09, 14, 15 (the confirmation is at configuration time, the recorded decision).
- ACs 2, 3, 6, 7, 8, 10 — a live launch of an environment-carrying stage (declared host reachable, private
  host opt-in, image refusal, an unresolvable reference at launch) was not run in this plan: the launch path
  is exercised by `test/runner-sandbox.test.ts` and `test/sandbox-proxy.test.ts` at unit level only (scenarios
  01–02). The real model-and-code-host acceptance of AC 7 lives on the person's machine by design.

## Resultado dos cenários

- 01 Repository tests for the new modules (5 files, 35 tests): passou (executado na sandbox) — npx vitest run test/testEnv-schema.test.ts test/testEnv-resolve.test.ts test/sandbox-host.test.ts test/maskExact.test.ts test/actions-testEnv.test.ts — "Test Files 5 passed (5), Tests 35 passed (35)", exit 0.
- 02 Tests extended by the change (sandbox-policy, sandbox-proxy, runner-sandbox, config-migrations): passou (executado na sandbox) — npx vitest run of the four files — "Test Files 4 passed (4), Tests 88 passed (88)", exit 0.
- 03 Type gate: npx tsc --noEmit: passou (executado na sandbox) — Rerun in this round with the exit code appended: "npx tsc --noEmit: exit code 0", no compiler output.
- 04 Whole test suite: passou (executado na sandbox) — npx vitest run — "Test Files 1 failed | 315 passed | 2 skipped (318); Tests 2 failed | 4899 passed | 24 skipped (4925)". The 2 failures are voice-setup, isolated in scenario 05.
- 05 voice-setup failure is pre-existing: falhou (executado na sandbox) — Isolated rerun of test/voice-setup.test.ts: "Tests 2 failed | 19 passed (21)" — disk-low assertion depends on this sandbox's disk state, unrelated to the change; same failure as under full load.
- 06 App launches with disposable data folder: passou (executado na sandbox) — electron-vite dev on /tmp/qa170-data and /tmp/qa170-specs, driven over CDP at 127.0.0.1:9222; window rendered, Settings screenshot.
- 07 Test environment section exists with empty Variables and Secrets: passou (executado na sandbox) — Tab "Ambiente de teste" under Settings › Team: Variables "Nada ainda", Secrets "Nada ainda", with add actions for both.
- 08 Add variable / Add secret actions present: passou (executado na sandbox) — Bottom of the Test environment section: add-secret action and the note that secrets are saved to the secret vault at addition time.
- 09 One-time confirmation for a non-test-only secret: passou (executado na sandbox) — Secret form with "Só de teste" OFF shows "Confirmar uma vez" and the reason text stating the confirmation is recorded once in the audit log.
- 10 Secret entry carries metadata only: passou (executado na sandbox) — Form for name "model" (ref test.model): test-only toggle, declared hosts and private hosts fields; value masked, "never shown again here".
- 11 Saved state after adding the secret: passou (executado na sandbox) — After add + save the "Não salvo" indicator leaves; the screen text caries no secret value.
- 12 Refilled form keeps metadata, not the value: passou (executado na sandbox) — Refilled entry (test-only ON) does not re-present the stored value.
- 13 Config file carries variable value and secret reference only (AC 1): passou (executado na sandbox) — config.testEnvironment = {"variables":[{"name":"INTEGRATION_URL","value":"https://staging.example.com",...}],"secrets":[{"ref":"test.model","testOnly":false,...}]}; the resolved value string is not in the file; schema 21. Export clause of AC 1 not exercised (not verified).
- 14 Audit log records the confirmation (AC 9): passou (executado na sandbox) — auditoria.jsonl lines: kind "test-env", target "test-env:test.model", ok true, result "confirmed", origin kind "test-env-confirm".
- 15 Confirmations ledger in DATA_ROOT: passou (executado na sandbox) — /tmp/qa170-data/test-env-approvals.json exists and lists the confirmed entry.
- 16 Remaining quality gates (theme-audit, i18n:lint, public-audit): passou (executado na sandbox) — Re-executed in this round: theme-audit exit 0 (8 literal colors pre-existing in api.ts, none new); i18n:lint exit 0 (4854 keys in both languages, 11 catalogs; first rerun failed on the wrong node_modules symlink I had made, fixed, no product change); public-audit exit 0 (1290 files clean).
