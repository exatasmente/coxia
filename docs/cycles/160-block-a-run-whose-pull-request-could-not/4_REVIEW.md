# Review: the run the host refused to open stops where it can be acted on, and the review waits once

## What was checked this round

Only the three blockers of review round 3; nothing already accepted is reopened. Checked in the worktree, by reading the changed files and by running the gates.

Confirmed resolved:

- `test/runner-flow.test.ts` compiles. The new guard test no longer awaits inside a non-async callback and imports `flowOf` as a named export (no dynamic import). Since the engineering cycle's `ready` stage ends rather than waits, the test sets its drawn stage to `wait` with `pr-merged`, then proves both behaviors: with the run's `pr` record refused, entering the waiting stage fails the run closed (`failed`, code `pr-open-failed`, no wait, message `run.stage.noPullRequest`); after the pull request is recorded, one `retry` restarts the wait. The file runs green.
- `test/run-web.test.ts` now excepts the `retryPr` action from the paired-browser 'allow' assertion, expecting `external` with the reason beside it (a direct host write behind the same switch as approving a proposal).
- `test/web-server.test.ts`'s pinned `EXTERNAL_EFFECT` list carries the fourth channel, `runs:retryPr`.

## Gates

- `npx tsc --noEmit`: clean (0 errors).
- `npx vitest run`, full suite: 312 of 312 files, 4890 of 4890 tests, all passing, the three above included.
- `npm run i18n:lint`, `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs`: clean.

One unstable sign: a first composed run of seven test files reported one failure out of 100; the same set rerun passed 100/100 and the full suite then passed. Which test it was was not captured; it did not reproduce, so it stays a flake sign, uninvestigated.

## Not verified

- The retry screen in a browser (the base-choice buttons in `RunActions.tsx`): not exercised in a browser this round. The action table, its channel classification and the blocked state are covered by the pure tests and the policy lists; the visual rendering of the base-choice group for a real blocked run is not.

## Verdict

Approved for QA. The suite is green, the acceptance criteria of the spec are covered by passing tests at the levels the plan chose (transitions, service, publisher, policy, renderer action table), and the security classification of the new channel is deliberate and pinned.
