# Implementation notes: the workspace test environment for stages

## What this attempt changed

The attempt started from the review's thirteen blockers (rounds 2 and 3, none treated by attempt 3) and closed them all; every repository gate is green at the end of it.

- **Unblocking the compile.** The literal NUL byte inside the `formKey` template of `src/main/testEnv.ts` was removed (the file is UTF-8 text again); `TEST_ENV_DATA_VARS` and `OpenOptions.testEnv` exist in `src/main/sandbox/index.ts`; the truncated duplicate tails of `testEnv-resolve.test.ts`, `sandbox/host.ts`, `sandbox/index.ts` and `defaults.ts` are gone. `npx tsc --noEmit` exits clean.
- **The resolver's confirmation rule.** `resolveStageTestEnv` required a ledger entry for every secret, test-only or not; it now confirms only a secret with `testOnly: false` (spec rule 10). A test-only secret is injected straight away.
- **Migration and defaults.** `v20ToV21` preserves a `testEnvironment` the document already carried instead of overwriting it with an empty list; `neutralConfig` fills `testEnvironment: { variables: [], secrets: [] }` through `neutralTestEnvironment()`, so the types/schema/defaults consistency test passes.
- **Validation.** The four host lists lost `uniqueItems: true` (the schema refused duplicates before `validate.ts` could call them a warning); the duplicate-variable-name error is emitted once per duplicate instead of once per list entry; the invalid-name case now reports its own schema path.
- **Prompt wording.** The `prompt.sdd.runner.rules.testEnv` sentence in both catalogs says "a write to the code host that carries it is refused" instead of naming "pull request", so the host-terms tests pass; `ui.audit.kind.testEnv` sits in its sorted place in both UI catalogs.
- **Run file, stage documents, memory and command lists now mask.** The exact masker is carried from `openStageSandbox` to the stage's finish in a per-session `WeakMap` (`sessionMask` in `executor.ts` — per stage, never shared between concurrent runs): the stage's documents, the memory it writes, the commands and outputs recorded in the run file and the QA record, and the conversation's command list all go through it before the pattern-based `redact`. A stage without entries has no masker and behaves exactly as before.
- **A bug found and fixed in the host shell.** `host.ts` iterated `for (const [name] of emptyDataDirs)`, which destructured the first character of each name, so the fresh data-folder variables never applied; it now takes the names directly. The new `test/sandbox-host.test.ts` covers the merge over the scrub, the fresh empty folders under the session's own throwaway folder (any inherited value wiped by the merge), their removal on close, and the untouched behavior of a stage without entries.
- **The Settings editor exists now.** New tab "Test environment" in Settings › Team and cycle: variables (name, value, hosts) and secrets (the value typed goes to the store at once through `config:secret-set`; the configuration keeps only the `test.` ref, the `testOnly` toggle, hosts and privateHosts), availability shown from the store's list (never a resolved value), the group delete of every non-test-only ref, the once-per-entry confirmation and revoke through `config:testenv-*` (each audit-logged). A paired browser sees the tab as read-only.
- **Test extensions.** `test/sandbox-policy.test.ts` (test vars applied last, over the proxy variables), `test/sandbox-proxy.test.ts` (private mark allowed / unmarked refused / not-listed refused regardless), `test/runner-sandbox.test.ts` (a work stage receives nothing and keeps the workspace's network setting; a QA stage receives the entries). `test/config-migrations.test.ts` no longer assumes schema 20.
- **CHANGELOG**: the `[Unreleased]` section carries the feature.

## What was verified, and how

- `npx tsc --noEmit`: exit 0.
- `npx vitest run`: 318 files / 4925 tests, all passing.
- `node scripts/theme-audit.mjs`: passes; the 8 literal-color findings in `api.ts` are the pre-existing report, none new.
- `npm run i18n:lint`: 4854 keys in both languages, 11 catalogs.
- `node scripts/public-audit.mjs`: 1290 files, passes.

## Not verified here

- The interface itself (the Settings tab on a live window, the confirmation card on screen): no browser or Electron session was driven in this attempt; the section is covered by the suite's catalog, sorting and type checks only.
- The real-key acceptance scenario (spec criterion 7: a real model call and a real read from a code host from a host stage of Coxia) — it belongs to a machine with real integrations and is not part of this repository's suite.
- `electron-vite build` (what CI adds to the gates).
- The per-repository overlay: out of this change, as the spec sequences it.
