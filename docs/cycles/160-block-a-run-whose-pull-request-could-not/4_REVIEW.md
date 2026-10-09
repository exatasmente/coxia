# Review: the run the host refused to open stops where the person can act, and the review waits once

## What was checked this round

Only the blockers of the previous rounds and the standing gates; nothing already
accepted is reopened. Checked in the worktree, by reading the changed files and by
running the gates.

Confirmed resolved from the earlier rounds:

- The wait guard in `enter()` is now scoped to `pr-merged` waits and only fires when the run's own description record is `refused`; a draft or a `proposed` record still lets the stage wait, and the runner records a linked pull request (`ensurePr`) before the final `stageDone`. The existing waiting flows are no longer touched by it.
- All previously missing and unsorted catalog keys exist in both languages, including `main.runs.stage.prBlocked` / `prBaseGone` / `prRetry`, `run.stage.noPullRequest`, `ui.cycle.action.retryPr`, `ui.cycle.error.prOpenFailed` and the once-per-round wording of `runner.review.waiting`; `runner.pr.failed` carries `{branch}`. `i18n:lint` passes.
- `runs:retryPr` is in `EXTERNAL_EFFECT` in `webPolicy.ts` and pinned by the policy list in `test/runs-policy.test.ts`, which passes.
- The draft file `src/shared/i18n/tmp-del.json` no longer exists.
- The CHANGELOG `Unreleased` entry is there, with neutral terminology (`{crLong}`, no other host's wording); the host-terms check passes.
- `test/runner-pr-blocked.test.ts` is a real file now: the blocked run in `question`/`pr-retry` with the host's answer and the bases, the retry through the audited door resuming the flow, the refused-record guard closed, the linked pull request recorded before the wait, the recovery of the failed run, and the once-per-round waiting line. All green.

## Blockers this round

1. **`test/runner-flow.test.ts` does not compile**, so `npx tsc --noEmit` and the full suite are red: the new guard test (l.214) is not `async` but awaits (l.217), which breaks the whole file in the transform. The behaviors it should prove (the guard closed, and the recovery into the wait) are therefore not proven by a passing test.
2. **`test/run-web.test.ts:38` fails**: the "no refused button in a browser" check asserts `allow` for every action the run screen offers, and the new `retryPr` action classifies as `external` (a direct host write behind the switch, on purpose). The test models the old policy and needs the `external` exception for `retryPr`, the same way `runs:startRelease` is treated on line 52.
3. **`test/web-server.test.ts:334` fails**: the pinned `EXTERNAL_EFFECT` list does not include `runs:retryPr`, which `webPolicy.ts` now exports — same classification as confirmed on purpose in the security fix of round 2; the pinned list needs it.

Full suite status: 309 of 312 files pass; the three above are the whole red set. `npx tsc --noEmit` is then also red, only from blocker 1. `i18n:lint`, `theme-audit` and `public-audit` are clean.

## Not verified

- The retry screen in a browser (the base-choice buttons in `RunActions.tsx`): not exercised in a browser. The action table and the channel policy are covered by the pure tests, and the blocked state is the run's question, observable through them.

## Verdict

Returned to the implementer for the three red tests above; the code behavior this issue asked for is in place and proven where the suite runs. The next round checks only that the suite is green again with the policy exception written where each pinned list expects it.
