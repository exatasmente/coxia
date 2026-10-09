# Implementation notes: the workspace test environment for stages

## What this attempt changed

- Unblocked the branch: the garbled trailing blocks in sandbox/host.ts, sandbox/index.ts and defaults.ts were removed; TEST_ENV_DATA_VARS and OpenOptions.testEnv ({vars, privateHosts}) were added; validate.ts now imports ENV_NAME/SECRET_REF from shared/secrets and defaults.ts the TestEnvironment type. npx tsc --noEmit passes clean after this.
- Masking: the executor builds the stage masker with maskerFromResolved(testEnv.values), so raw, URL-encoded and JSON-escaped occurrences are all covered (review blocker on the old stageMasker(testEnv.values) call).
- Confirmation path: config:testenv-confirm / config:testenv-revoke / config:testenv-confirmations handlers in configModule.ts, backed by the ledger singleton testEnvLedger() in secrets.ts (test-env-approvals.json under the data folder, mode 0600, never exported); every confirm/revoke is recorded in the audit log (new kind 'test-env', label added to the audit screen and both ui catalogs). Decision recorded: confirmation happens at configuration time; an unconfirmed non-test-only secret is a named refusal at launch, not an ask-a-person pause.
- Actions door: assertNoTestEnvLeak in actions.ts scans every write going out (proposals, autonomous writes, approved writes) for the exact forms; the push is scanned with git grep over HEAD; an image upload is refused while any stage carries the environment. The executor registers the stage's forms for the life of its session (registerTestEnvForms/formsOfValues in testEnv.ts) and unregisters on session close.
- Prompt: a stage carrying the environment gets runner.rules.testEnv (both catalogs) telling it about masked values and blocked images (StageInput.testEnv).
- Refusals: a variable with an empty value is reported, not silently skipped; the ledger write uses dirname (Windows-safe); refusal keys main.testEnv.refusal.* in both main catalogs.
- Tests written: maskExact.test.ts, testEnv-resolve.test.ts, testEnv-schema.test.ts, actions-testEnv.test.ts.

## Not done (open, for the next attempt)

- The four new test files still fail on assertion mismatches (toBe vs toStrictEqual, form text expectations); they have not been greened.
- The plan's remaining test extensions (sandbox-proxy privateHosts, sandbox-session, sandbox-host, runner-sandbox) and the migration's filled-section preservation check (the v20ToV21 step currently overwrites an existing section — the test caught it; fix pending).
- CHANGELOG Unreleased section; removal of the stray 1_SPEC.md at the repository root; the Settings editor section; the full gates (tsc passes; vitest, theme-audit, i18n:lint, public-audit not confirmed).

## What was verified

npx tsc --noEmit: clean at the end of this attempt. npx vitest run over the four new files: run, 18 of 31 tests passed; the failures named above are open. Nothing else was exercised.
