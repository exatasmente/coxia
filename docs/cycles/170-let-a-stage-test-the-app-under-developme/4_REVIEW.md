# Fourth review round: the test-environment feature

The committed change was re-read against the specification, the plan and the repository rules, with the thirteen blockers of the previous rounds checked one by one against what the branch now contains. All were treated; every repository gate was run in this round.

## What the previous rounds asked, verified

1. The literal control byte that made `src/main/testEnv.ts` binary is gone: a byte scan finds none, and the file reports as UTF-8 text.
2. `test/testEnv-resolve.test.ts` ends cleanly after its last test; the type check no longer reports syntax errors anywhere.
3. The migration in `src/shared/config/migrations.ts` keeps an existing `testEnvironment` and only fills the section when it is absent.
4. `neutralConfig` in `src/shared/config/defaults.ts` fills the section through `neutralTestEnvironment()`, so the types/schema/defaults consistency holds.
5. The declared-host and private-host lists of both entry kinds are no longer marked with unique items, so the validation module's duplicate-host warning can fire.
6. The prompt sentence in both main catalogs says "a write to the code host that carries it is refused" instead of naming a pull request; the host-terms tests pass.
7. `ui.audit.kind.testEnv` sits in its sorted position in both interface catalogs.
8. The migration tests no longer assume schema version 20 and pass.
9. The schema and Actions-door test files no longer fail for reasons of their own assertions.
10. The Settings Test-environment tab exists (`src/renderer/src/screens/team/TestEnvSection.tsx`): variables, secret references with the availability check, the test-only toggle, the once-per-entry confirmation and revoke, and the group delete; tab, nav and audit row are wired.
11. Exact-value masking now reaches the run file, the stage documents and the artifacts the stage writes, the memory it produces, and the commands recorded in the run file and the conversation, through a per-session masker in `executor.ts`; a stage without entries behaves as before.
12. The planned test extensions exist: sandbox policy (test variables applied last), sandbox proxy (private mark allowed, unmarked refused), sandbox host (`test/sandbox-host.test.ts`, new) and runner sandbox (a work stage receives nothing). The new host test also exposed and fixed a real iteration bug in the fresh data folders.
13. The `Unreleased` section of the changelog describes the feature, and the stray specification copy at the repository root is removed.

## The design as verified

The launcher resolves the environment once per launch; a not-allowed stage or an empty section resolves nothing and keeps today's behavior; the sandbox receives the entries after every other environment decision; the host merges them over the scrubbed environment and starts the app under test against fresh empty data and specs folders; the registry allow-list widens only for a stage that carries entries, with private addresses opt-in per host; the door scans every outgoing write and the pushed branch for the live forms; the confirmation ledger is written with restrictive file permissions in the data folder and every confirm or revoke is audit-logged; the refusals are named in the thread and the log and never thrown.

## Gates, run in this round

- Type check: clean (exit 0).
- Test suite: 318 files / 4925 tests. Under full parallel load, five tests failed — each a timeout or a step-lock contention in `test/conflict-resolve.test.ts` and `test/voice-setup.test.ts`, tests older than this change; both files pass completely when run on their own, so the failures are load contention, not the behavior of the branch.
- Theme audit: passes (the same pre-existing literal-color report in one file; nothing new).
- Localization lint: 4854 keys in both languages, 11 catalogs.
- Public audit: 1290 files, nothing that belongs to a company or a person.

## Verdict

Approved. Every blocker of the previous rounds is treated in the branch, and no new blocking fact appears in the changed code.

## Not verified here

- The real-key acceptance scenario (criterion 7: a real model call and a real read from the code host from a host stage of this app) belongs to a computer with live integrations and is outside the repository's suite.
- The Settings tab and the confirmation flow seen on a live window: no interface session was driven in this review.
- `electron-vite build`: not run locally; CI adds it.
- The per-repository overlay: sequenced after this change by the specification.
