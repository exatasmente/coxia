# What the review asked for, done

This pass took the review's two blockers on the board delivery and nothing else. The board
itself was not reopened: the six channels, the merge into the day, the squad-by-label rule and
the screen stay as they were. This document says what changed, what was run, and what is still
only read.

## The throwaway probe test is gone

`test/__probe__/wiring.test.ts` was a scratch harness for the `RangeError` defect of the
previous pass (it logged and asserted nothing) and it made the repository's typecheck gate
print two errors. It was deleted. `git status --porcelain --untracked-files=all` then listed
only the delivery's own files and the deleted probe — no untracked file left in the worktree.

## The guard test now pins the refusal, not a count

`test/board-policy.test.ts` asserted
`expect([...source.matchAll(/assertExternalWrite\(/g)]).toHaveLength(CHANNELS.length - 1)` — a
count of a substring in the file's own text, which passes whatever the six call sites guard.
The test now has two halves:

- **Behaviour.** The file is given its own data root, the workspace is marked as one of test
  through the registry, and the module is registered exactly as the app registers it, with the
  handlers collected. Every write of the spec is then driven through its own channel on the
  card itself (opening, moving, commenting, prioritising, giving to a squad, closing,
  reopening) and each one must throw the guard's refusal — matched against
  `main.workspaces.testRefusal`, read from the catalog, not a hand-typed string. The card is
  read back afterwards and must not have moved, so the refusal cannot be a missing card, an
  unknown column or an unknown squad. A last case turns the test flag off and runs the same
  calls through, proving it is the guard that refuses and not the channel.
- **Shape.** Each write handler's body, sliced from its own `ctx.handle('board:…'` to its
  closing brace, must contain `assertExternalWrite(`. A guard moved off a handler, or a handler
  left without one, fails here — which the count could not see.

## The rule headers the branch had left stale

Fourteen `.coxia` files cited code this branch changed without their `checked-commit` being
bumped, and `.coxia/rules/runner.md` pointed at `eb6245bf`, the commit *before* the one that
carries its edited sentence. All fifteen now name `b94bbea2`, the commit that carries the
documentation edit: `.coxia/README.md`, `.coxia/rules/{development-cycles,documentation,overview,releasing,runner,safety-model}.md`,
`.coxia/roles/{customer-success,developer,product-owner,qa,release-manager,support,tech-lead}.md`
and `.coxia/skills/add-a-cycle-template.md`. Only the header line moved; no rule text was
changed, because none of these rules became false.

## Verified by running

| Command | Result |
|---|---|
| `npx tsc --noEmit` | 0 — the two probe errors are gone |
| `npx vitest run test/board-store.test.ts test/board-cards.test.ts test/board-squads.test.ts test/board-run.test.ts test/board-policy.test.ts` | 5 files, 26 tests, all passed |
| `node scripts/theme-audit.mjs` | 0 |
| `npm run i18n:lint` | 0 — 4616 keys in both languages |
| `node scripts/public-audit.mjs` | 0 — 1224 files |
| `npx vitest run` (whole suite) | 287 files, 4406 tests, all passed, but one file reported as failed |

**The whole-suite line needs reading with care.** The run ended with
`Test Files 1 failed | 286 passed (287)` while `Tests 4406 passed (4406)`: every test passed
and one file's exit was non-zero without a named failing test. A second whole-suite run was
started to read the failure by name and had not finished when the stage's command budget ran
out; its log was not read. The evidence points at `test/runner-chain.test.ts`, which a
concurrent run showed timing out in one of the "a question between agents" cases
(63 s for the file) — a timing failure, not a board failure — but that is an unconfirmed
reading of a single earlier run and is reported as unverified.

**The strengthened test was shown to bite.** With one `assertExternalWrite(` removed from
`board:close` in `src/main/board.ts`, the file failed with 2 of 6 tests red; the source was
restored and `git diff --stat src/main/board.ts` showed no change to it. A green suite is
therefore not the only evidence that the new cases test something.

## What was not verified

- The failure of the whole-suite run was not read to its name; see above. Nothing in this
  delivery was shown to be its cause.
- The screen was not opened again in this pass. The interface was driven in the previous pass
  (`electron-vite build`, an empty data folder, the repository's Playwright) and no code of the
  screen changed here.
- The two acceptance criteria that need a usable code host (with a host connected: the same
  order, the day's photograph, what moved, what is blocked; and a host's card never shown as a
  second record) remain **not verified**: no workspace with a usable integration has been
  opened in any pass.
- The test-workspace refusal is now pinned by a test driving the handlers; it was already seen
  in the running app in the previous pass, and that is the previous pass's evidence, not this
  one's.
