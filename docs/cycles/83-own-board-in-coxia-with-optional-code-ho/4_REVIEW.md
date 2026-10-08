# Review: a board of its own in Coxia

Reviewed against the spec (`1_SPEC.md`), the plan (`2_PLAN.md`) and the delivery document (`3_IMPLEMENTATION.md`), on the branch's diff. Read: `src/shared/board.ts`, `src/main/board.ts`, `src/main/board-core.ts`, `src/main/boardSource.ts`, `src/main/cards.ts`, `src/main/index.ts`, `src/main/module.ts`, `src/main/webPolicy.ts`, `src/renderer/src/screens/cycle/BoardScreen.tsx`, `src/renderer/src/screens/cycle/boardApi.ts`, the two catalog pairs, the five new test files. Ran: `npx tsc --noEmit`, `node scripts/public-audit.mjs`, and the five board test files under `npx vitest run`.

## Verdict

**changes** — two blockers. The board's behaviour and its guard are sound and the acceptance criteria this delivery claims (1 to 5) are met by the code and pinned by tests. What is not done is the worktree hygiene and the repository's own gate: a throwaway test file was left behind and it turns the typecheck red.

## Blocking findings

### 1. A throwaway probe test is left in the worktree and turns the typecheck red (`test/__probe__/wiring.test.ts`)

`test/__probe__/wiring.test.ts` is untracked (`git status --porcelain` shows `?? test/__probe__/`), it is not part of the delivery, and it is a scratch harness for the `RangeError` defect the implementation document describes — its own comment says «Hand the module the previous (buggy) wiring the developer describes». It asserts nothing (`expect(true).toBe(true)`), and it fails the repository's own gate:

```
test/__probe__/wiring.test.ts(7,25): error TS2322: Type 'void' is not assignable to type 'boolean'.
test/__probe__/wiring.test.ts(8,143): error TS7006: Parameter 'd' implicitly has an 'any' type.
```

`npx tsc --noEmit` exits 0 in the shell only because the status is swallowed; the compiler prints two errors. CI runs the same command, so the branch is red as it stands. This is a draft left in the product, and the repository rule is explicit: a red gate is not «done». Delete `test/__probe__/` before the branch leaves the worktree.

### 2. `test/board-policy.test.ts` pins a magic count, not behaviour

`test/board-policy.test.ts:35` asserts

```ts
expect([...source.matchAll(/assertExternalWrite\(/g)]).toHaveLength(CHANNELS.length - 1);
```

This is a count of a substring in the file's own text. It passes as long as six call sites exist, whatever they guard, and it would pass if the guard were moved off a mutating handler into a helper, or if a handler lost its guard while another gained a duplicate. The behaviour the spec's rule 3 and criterion 5 ask for is that a test workspace refuses each of the six writes; nothing in this file exercises that. The delivery document says criterion 5 was seen working in a running app, which is good, but the repository's own rule is that a behaviour with no test is a gap, and this test is the only thing pinning the guard. Add a case that drives each handler in a test workspace and expects the refusal, or at least a case that parses the mutating handlers and checks each one calls the guard.

## Suggestions

### A. Rule files the branch left stale (checked-commit headers)

`.coxia/README.md`, `.coxia/roles/{customer-success,developer,product-owner,qa,release-manager,support,tech-lead}.md`, `.coxia/rules/{development-cycles,documentation,overview,releasing,safety-model}.md` and `.coxia/skills/add-a-cycle-template.md` cite code this branch changed (`src/main/index.ts`, `src/main/webPolicy.ts`, `docs/cycles.md`, `docs/runner.md`, `CHANGELOG.md`) and none of them was bumped. Concretely:

- `.coxia/rules/overview.md` and `.coxia/README.md` cite `src/main/index.ts`, which gained `setBoardReady`/`vcsReady` wiring and a new module in `MODULES`.
- `.coxia/rules/safety-model.md` cites `src/main/webPolicy.ts`, which gained the `board:*` classification comment.
- `.coxia/rules/releasing.md` cites `CHANGELOG.md`, which gained an Unreleased entry.
- `.coxia/rules/development-cycles.md`, `.coxia/rules/documentation.md`, `.coxia/skills/add-a-cycle-template.md` and the role files cite `docs/cycles.md` and `docs/runner.md`, both edited here.

None of these is false in substance — the sentences they carry are still true — so this is not blocking. What is stale is the `checked-commit` header: the docs claim to have been checked against a commit they were not. Bump the header on the files whose cited code moved, or record why the file is exempt.

### B. `.coxia/rules/runner.md` is stale in its own way

The plan listed `.coxia/rules/runner.md` as corrected in this change, and it was (the «Starting a run» sentence). But its header was also bumped to `eb6245bf`, which is the commit *before* the documentation commit `b94bbea2`, so the header points at a tree that did not yet carry the edited sentence. Check what commit the header is meant to name and align it.

### C. The history the plan left open for the reviewer

The plan records an open decision: whether the card's history stays embedded in `board.json` or moves to a second append-only file (`historico-cartoes.jsonl`). The delivery keeps it embedded, and nothing in this delivery reads it. That is a defensible call and the plan says so; it is flagged here only so the decision is not lost. No change requested.

## What was verified in this review

- `npx tsc --noEmit`: **red** (two errors in `test/__probe__/wiring.test.ts`).
- `node scripts/public-audit.mjs`: **green** (1224 files).
- `npx vitest run test/board-store.test.ts test/board-cards.test.ts test/board-squads.test.ts test/board-run.test.ts test/board-policy.test.ts`: **green**, 23 tests.
- The five board tests were read line by line against the spec's criteria 1 to 5.

## What was not reviewed

- The two acceptance criteria that need a usable code host (6 and 7) were not exercised: no workspace with a usable integration was opened, here or in the implementation. They remain **not verified** and this review does not claim otherwise; the host is read only as code.
- The screen was not opened in this stage. The implementation document says it was driven (`electron-vite build`, an empty data folder, the repository's Playwright); that claim is taken as the implementation's, not confirmed here.
- The paired browser path was not exercised.
