# Implementation notes: the workspace test environment for stages

Status when this attempt ended: partial. The code below was written but not compiled and not tested in this attempt; every statement is about what was written, not about what was verified.

## What was written

- Shared config: `StageDef.testEnv?: boolean` and `WorkspaceConfig.testEnvironment?: TestEnvironment` in types.ts; migration v20→v21 fills the empty section and defaults no stage field (a stored template keeps left-out = no); `testEnvironment: neutralTestEnvironment()` in neutralConfig; the JSON Schema gained the section (variables: name/value plus optional hosts and privateHosts; secrets: ref/testOnly plus the same host lists; refs validated against SECRET_REF and kept to the `test.` prefix). Validation in validate.ts (from the earlier attempt) now resolves: names against ENV_NAME, refs against SECRET_REF plus the required prefix, hosts against the registry host grammar, privateHosts required to be a subset of hosts, duplicates refused.
- `src/main/testEnv.ts` (new): `stageAllowsTestEnv` (declared field wins; left out reads as `'qa'`), `resolveStageTestEnv` — resolves variables straight into the delivery map, resolves secrets through the store with every failure turned into a named refusal `{ name, reason }` (never a thrown error), computes for each entry the hosts and private hosts, drops a non-test-only secret the ledger has not confirmed, and keeps the couple of confirmed values in `values` for the masker. `createTestEnvLedger` keeps the person's once-per-entry confirmations in a JSON file of mode 0600, outside the configuration and never exported.
- `src/main/maskExact.ts` (new): the plugin-requests precedent as a module — `secretForms` (raw, URL-encoded, JSON-escaped; length ≥ 4; longest first), `stageMasker` (replace with `[secret]`, then `redact` of errorlog-core as the second layer), `maskerFromResolved` and `maskerFor`.
- Sandbox: OpenOptions/HostOpenOptions carry `testEnv: { vars, privateHosts }`; the registry proxy accepts `privateHosts` in ProxyOptions and connects a marked host even when its address is private (a mixed public/private set is still refused whole); the sandbox environment (policy.ts `sandboxEnv`) applies the delivered variables last, over every other decision; the host session (`host.ts`) merges the variables over `scrubbedEnv` — the scrub never drops a test name, no real credential ever rides under one — and creates fresh empty folders for `CERIMONIAS_DATA_DIR`/`CERIMONIAS_SPECS_DIR` inside the session's throwaway folder when a host stage carries the environment (spec rule 9), removed with the session.
- `src/main/runner/executor.ts`, `openStageSandbox`: the stage's run records a command output is reported with the stage masker applied before the existing redact, the same text in the audit log; only a stage that actually receives entries widens the sandbox config to registry mode and unions the declared hosts into the registry allow-list; every resolver refusal is reported with the entry name and reason in the run conversation and the audit log.

## Not done in this change (open, for the next attempt)

- The confirmation ledger is written but not yet wired into the Settings editor; at launch an unconfirmed non-test-only secret is a refusal. The launch-time ask-a-person pause of plan 2.7 was not built.
- The prompt sentence for an environment-carrying stage and its i18n keys in both catalogs.
- The Actions-door scan of commits, pull requests and image attachments for the stage's exact forms.
- The illustrated refusal paths and all test files named in plan section 3, and the Settings editor section.
- Every gate (tsc, vitest, theme-audit, i18n:lint, public-audit): not run in this attempt, so the change is not done by the repository's own rule.

## What was verified

Nothing beyond reading the code: no command was run for this change, so the type soundness, the migration and the tests are all marked not verified.
