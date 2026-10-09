# Review of the test-environment change

## Scope

The whole branch diff (13 files, 453 insertions) was read against the spec (the workspace test environment, its delivery, network confinement, masking, confirmation and refusals) and the plan's nine implementation steps and nine test files. The gates were exercised on the branch worktree: `npx tsc --noEmit` was run and fails; the remaining gates (vitest, theme-audit, i18n:lint, public-audit) could not meaningfully run behind a compilation that fails and are marked not run. No interface scenario was exercised: the change under review does not reach a runnable state.

## What checks out (by reading)

- Config surface: schema version 20→21 with a migration step, `testEnvironment` in types, defaults, JSON Schema and validation (names against ENV_NAME, refs against SECRET_REF with the required `test.` prefix, hosts to the registry grammar, privateHosts a subset of hosts, duplicates refused). Matches the plan's step 2.1.
- The delivery design matches the spec: the launcher resolves once per stage, variables and secrets go into the sandbox environment applied last in `sandboxEnv`, the host merges them over `scrubbedEnv`, a host stage carrying entries gets fresh empty data and specs folders inside the session's throwaway folder, and only an entry-carrying stage widens the sandbox to registry mode and unions the declared hosts; `privateHosts` in the proxy is a strict opt-in.
- Refusals from resolution are named, never thrown, and reported to the conversation and the audit log.

## Findings

Each finding carries file, line, severity and reason in the review's findings list (the machine-readable part of this stage's answer). In short:

### Blocking

1. Three files end with garbled, repeated trailing fragments — a duplicated function tail and constant block in the host session, three copies of the sandbox service tail in the sandbox index, and a duplicated return block in the config defaults. The tree does not compile: 65 TypeScript syntax errors.
2. Two identifiers referenced in the sandbox code are never defined: the constant naming the data-folder variables for a host stage, and the `testEnv` field on the options of a sandbox opening (only the host options gained it through a pick).
3. The stage's built masker receives the raw resolved values as if they were the prepared forms, so URL-encoded and JSON-escaped occurrences are not masked — acceptance criterion 4 is only partially met, a security guarantee of the spec.
4. The confirmation ledger can approve and revoke but nothing in the code ever calls approve: a non-test-only secret is silently dropped at every launch with no confirmation screen, no recorded approval and no ask-a-person pause — acceptance criterion 9 unmet.
5. The Actions-door scan that refuses a commit, pull request or image attachment carrying an exact value is not written — acceptance criteria 5 and 6 unmet.
6. The stage-prompt sentence for an environment-carrying stage is not written.
7. None of the nine test files the plan names for this change exist.
8. The new refusal texts are missing from both localization catalogs, so refusals would be shown as raw keys.
9. The Unreleased section of the CHANGELOG is not updated, breaking a repository rule for user-visible changes.
10. A stray copy of the specification document sits at the repository root, outside the cycle folder where all other cycle documents live.

### Suggestions

- The two exported helper functions of the new masking module are dead: nothing builds the masker from references or from a resolved list.
- A ledger write derives its parent folder by searching for the slash separator; on Windows that misses and the write fails. Use the path module.
- A variable entry with an empty value is silently skipped instead of reported with a reason, against the spirit of the refusal-with-a-reason rule.

## Verdict

Changes requested. Since the tree does not compile, every gate is red by construction and the acceptance criteria the change targets are only partially covered. What can be verified by reading matches the spec's design, and a re-run of this review after the blockers are treated only needs to re-check the blockers above and the gates.

## Not reviewed

- The real-key scenario of acceptance criterion 7 (a stage exercising the app under development with real integrations): not verifiable in this review's environment; it belongs to the person's machine, as the plan records.
- The per-repository overlay: sequenced out of this change by the spec.
