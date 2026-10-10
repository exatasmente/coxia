# A run whose pull request the host refused to open stops where the person can see and act, and the review waits aloud once

## Decisions and why

1. **The blocked state is the run's `question` state with a new kind `pr-retry`.**
   The run core already has a state that means "the run cannot go on, the person must act":
   `question` (tone "blocked" on the runs list and on the run screen, via the tone and
   `needsPerson` tables of `src/shared/runs/view.ts`, which map `question` and `failed` to
   blocked). A new `QuestionKind` `'pr-retry'` in `src/shared/runs/types.ts`
   (`QUESTION_KINDS`) reuses that whole surface — blocked badge, thread visibility,
   cancel — and gives the run screen a specific affordance (a base choice) instead of a
   free-text answer box. A `failed` status was rejected: its one action is `retry`, which
   re-runs a stage (an agent run, real cost); a pull-request retry needs no agent run,
   only a fresh host write with a chosen base.
2. **The transition is applied where the failure happens: the runner publish flow, not the
   run core.** By the time the pull request fails, the pushing stage has already ended and
   the flow has advanced (the pull request is opened after `stageDone`, asynchronously,
   through the push action's completion). Rewinding the flow to block the pushing stage in
   place would reimplement send-back logic for no reader benefit. The blocked record
   therefore names the pushing stage and the target branch in its text and history but
   pauses the run where it stands (the current stage's record goes back to `waiting`, like
   `ask()` does); on a successful retry the run resumes exactly there. The thread line and
   the run screen both name the branch the pull request was aiming at, which is what
   identifies the failed stage.
3. **Base-gone is said from evidence, not from parsing the host's prose.** At failure time
   the publisher re-reads the repository's default branch from the host (`getRepo`) and
   flags `baseGone` when the error was a host validation refusal (a `VcsError` of code
   `'invalid'`, any 4xx validation answer) and the run's recorded `baseBranch` differs from
   that default — the recorded base is the open release the run was cut from, so a
   validation refusal aimed at it while the default branch still exists is the reported
   case. The host's own answer text (already secret-scrubbed) is always carried verbatim
   in the reason, so whatever the classification missed is still shown. No prose matching
   on the message.
4. **The wait guard sits in the run core's `enter()` and is provider-free; linked pull
   requests are recorded just before the stage ends.** The guard inside the `wait` branch
   of `enter()` (`transitions.ts`) checks, for a `pr-merged` wait, that
   `run.comments[PR_COMMENT]` is `published` with a numeric `noteId`. To make "linked"
   count, the runner (`service.ts` `settle()`) awaits a new publisher method
   `ensurePr(runId)` right before the stage-completion transition whenever the following
   stage is a `pr-merged` wait and the recorded `pr` comment is not yet published:
   `ensurePr` resolves `prOf()` (the recorded one, else an open one linked to the issue
   through cross-references) and records it when found. Failing closed otherwise: `enter()`
   then stops the run `failed` with a new `RunFailure` code `'pr-open-failed'`. `failed`
   is deliberately used here (not `question`): its screen action is `retry`, and
   re-entering a wait stage costs nothing (no agent) — the person opens the pull request
   by hand, the running sweep records it through `prOf`, and one click on retry starts the
   wait.
5. **A proposed-but-not-approved proposal does not satisfy the guard.** The spec says
   "published by it", and a draft description waiting on a "sim" is not a pull request.
   Consequence accepted: in the non-autonomous flow, the final stage now stops blocked
   (fail closed, with the reason saying the approval waits in Actions) where it used to
   sit in a wait that could never fire if the proposal was never approved. The one-click
   retry and cancel remain. If implementation testing shows this punishes the ordinary
   flow too hard, the fallback (treat a `proposed` `pr` comment whose Actions proposal is
   still pending as satisfying the guard until it is carried out) is a one-line change in
   the guard.
6. **The once-per-round waiting line is persisted on the comment record.** The review
   comment record (`CommentRecord`) gains an optional `waitingSaid?: boolean`, written by a
   small transition (`recordCommentWaiting`, mirroring `recordCommentRefused`). Both
   emission sites in `publish.ts` — `publishReview` (the review path, ~l.755) and
   `deliver()` (the generic comment path, ~l.457, whose waiting line carries the round) —
   check the flag before saying `runner.review.waiting` and set it after saying. A new
   round has its own key (`review-N`), so a new round says exactly once again; the sweep
   (`flush()` → `flushReviews` → `publishReview`) then adds nothing until the pull request
   exists. Memory-only suppression was rejected: the app restarts, and the record is what
   survives.
7. **The retry is a person action and writes directly.** Retrying chooses the base on the
   run screen; that click is the approval, so the retry posts through the door's audited
   direct path (like the autonomous branch of `pullRequest()`), not through a new Actions
   proposal. It reuses the draft description already recorded (`run.comments.pr`); only
   the base changes.
8. **The run's base stays corrected.** A successful retry against a chosen base updates
   `run.baseBranch` in the same transition that clears the question, so later
   re-derivations of the target branch and any later retry start from what is on the host.

## Changes, in order

1. **`src/shared/runs/types.ts`** — add `'pr-retry'` to `QUESTION_KINDS`; optional fields
   on `PendingQuestion`: `bases?: string[]` (candidate bases, recorded base first, default
   branch last, deduplicated), `targetBranch?: string`, `baseGone?: boolean`; add
   `'pr-open-failed'` to `RunFailure['code']`; add `waitingSaid?: boolean` to
   `CommentRecord`. `HISTORY_TYPES` stays as it is (the moves log under
   `question`/`answer`/`failed`, already in the list).
2. **`src/shared/runs/transitions.ts`** — three additions:
   - `prOpenBlocked(run, at)`: valid from `working` (a pull-request failure happens only
     from a working run); sets `status: 'question'`, question
     `{ by: 'app', kind: 'pr-retry', text, bases, targetBranch, baseGone, askedAt, stage }`, marks the current stage's record `waiting`, logs history `question`.
     Returns a public `question` draft (author app, code `'run.stage.prBlocked'`).
   - `prRetryAnswered(run, base, at)`: requires `status: 'question'` and question
     `'pr-retry'`; clears the question, sets `run.baseBranch = base`, restores
     `status: 'working'` and the stage record `running`, logs history `answer`.
   - In `enter()`'s wait branch: when `stage.waitsFor.kind === 'pr-merged'` and the guard
     fails, take the `no-event` branch's shape: `status: 'failed'`, stage record `failed`,
     new `error` code `'pr-open-failed'` with detail naming the base branch, history
     `failed`, message code `'run.stage.noPullRequest'`.
3. **`src/shared/runs/index.ts`** — export the new transitions (`prOpenBlocked`,
   `prRetryAnswered`, `recordCommentWaiting`).
4. **`src/main/runner/publish.ts`** —
   - In `pullRequest()`'s catch blocks (autonomous path ~l.950, outer ~l.963) and in
     `pullRequestOpened()`'s no-id path (~l.971): keep `say(run, 'runner.pr.failed', ...)`
     (now carrying the target branch), read `getRepo()` for the default branch, build the
     bases and the `baseGone` flag (decision 3), and if the run is still `working` apply
     `prOpenBlocked` through `moveRun` (a run already stopped otherwise stays as it is;
     the failure line still lands in the thread).
   - New publisher methods: `retryPr(runId, base)` (needs the `pr-retry` question; a
     refused door answers with the refusal and changes nothing) records
     `prRetryAnswered` and calls `pullRequest(runId)`, which retries against the
     corrected `run.baseBranch`; a new failure re-raises `prOpenBlocked` the same way; a
     success follows `pullRequestOpened` → `flush`, resuming the flow per spec rule 5.
     And `ensurePr(runId)` (resolves and records a linked pull request, returns whether
     one is now known).
   - Once-per-round guard in `publishReview()` and `deliver()`: check `waitingSaid`, say
     only if unset, set it via `recordCommentWaiting` (new transition in
     `transitions.ts`, history `comment`).
   - The `main.forum.code.runner.review.waiting` catalog text is updated in both
     languages to the once-per-round wording.
5. **`src/main/runner/service.ts`** — in `settle()`, before the final `stageDone`
   whenever the following stage's `waitsFor.kind === 'pr-merged'` and the recorded `pr`
   comment is not published: `await ensurePr(runId)` so a linked pull request is recorded
   before the guard sees the run. New api method and `runs:retryPr` handler in
   `src/main/runner/module.ts` (next to `runs:retry`, ~l.209), wired to
   `publisher.retryPr`.
6. **Shared run view and renderer** — `src/shared/runs/view.ts`: add `'retryPr'` to
   `RUN_ACTIONS`; in `runActions()` case `'question'`: for kind `'pr-retry'` return
   `[act('retryPr'), cancel]` (no text box) instead of `act('answer')`.
   `src/renderer/src/screens/cycle/runsApi.ts`: `retryPr: (id, base) =>
   api.invoke<Run>('runs:retryPr', id, base)`.
   `src/renderer/src/screens/cycle/RunActions.tsx`: `ACTION_LABEL.retryPr` →
   `'ui.cycle.action.retryPr'`; for a `pr-retry` question render a base-choice group
   (same shape as `SquadChoice`: one button per base in `run.question.bases`); the
   blocked text (host's answer + target branch + base-gone note when flagged) is shown
   by `Waiting`'s question blockquote; `doIt` case `retryPr` passes the chosen base —
   the payload comes from the clicked button, not the text field.
7. **Catalogs** — `src/shared/i18n/main.en.json` / `main.pt-BR.json`: `runner.pr.failed`
   gains `{branch}`; new keys for the blocked question text (`run.stage.prBlocked`, with
   a variant for base-gone) and `run.stage.noPullRequest`. `ui-cycle.en.json` /
   `ui-cycle.pt-BR.json`: `ui.cycle.action.retryPr`, the base-choice title and hints,
   `ui.cycle.error.prOpenFailed` (guard text). Every string through `t()`, both
   catalogs.

The order matters: types first (the rest compile against them), then transitions (+
index exports), then the publisher (its methods need the transitions), then service and
module (channel), then view/renderer, then catalogs, then tests.

## Tests — one per behavior

| Behavior | File |
|---|---|
| A fake provider whose pull-request creation answers a 422-class failure: after the push, the run is `question`/`pr-retry` with the host's answer and the target branch in the text, the bases list correct, `baseGone` set when the recorded base differs from the default; the thread carries `runner.pr.failed` with the branch; the run tone is blocked (`isRunBlocker`) | `test/runner-pr-blocked.test.ts` (new; fakes from `test/helpers/`, no network) |
| The run never enters the `pr-merged` wait in that state: the transition into the wait stage with no published `pr` comment leaves the run `failed` with code `'pr-open-failed'` and `run.wait` null | `test/runner-pr-blocked.test.ts` (transitions level) |
| The guard holds generally: forcing a `pr-merged` wait entry without a published or linked pull request fails the run instead of starting the wait | `test/runner-flow.test.ts` (new case) |
| A linked pull request (open on the run's branch, found through cross-references by the fake provider) is recorded by `ensurePr` and the wait starts | `test/runner-pr-blocked.test.ts` |
| The guard's `failed` state recovers: the person opens the pull request by hand, `flushReviews` records it, `retry` re-enters the stage and the wait starts | `test/runner-pr-blocked.test.ts` |
| `retryPr(runId, base)` against a fake provider that now accepts: question cleared, `baseBranch` updated, pull request opened (`runner.pr.created`), reviews flush, run resumes (spec rule 5) | `test/runner-pr-blocked.test.ts` |
| Two sweeps over a draft review with no pull request produce exactly one `runner.review.waiting` line; when the provider then reports the pull request, the review is posted and no further waiting line | `test/runner-review.test.ts` (extend) |
| `runActions` for a `pr-retry` question offers `retryPr` + cancel and no `answer` text box | the pure `runActions` tests in `test/runner-flow.test.ts` |
| Catalog completeness, theme tokens, no secrets | standing gates (`theme-audit`, `i18n:lint`, `public-audit`, `npx tsc --noEmit`, `npx vitest run`), run at implementation time (this stage did not run them) |

## Acceptance criteria of the spec this plan does not cover

- None known: all six of `1_SPEC.md` are covered by the table above (criteria 1–4 by the
  blocked-state and retry tests, 2–3 also by the guard tests, 5 by the retry-resume test,
  6 by the review-delivery test). Release runs reach their own `pr-merged` waits through
  the same guard; a release run's failure after the approval follows the same
  `prOpenBlocked` path and the same transitions, covered by the same tests.

## Risks

- **Blocking while the flow has already advanced**: the run pauses with the current stage
  record waiting; the existing state guards of `transitions.ts` keep every other move out
  while the question is open. Mitigation: `prOpenBlocked` reuses the exact `ask()` shape,
  and a unit test asserts `run.stage` is unchanged, the stage record is `waiting`, and a
  second failure while already stopped does not move the run.
- **`prOf` records a linked pull request only when consulted**: without the `ensurePr`
  hook a linked-but-never-consulted branch would be blocked on entering the wait stage.
  Covered by the `settle` hook and its test.
- **The base-gone flag is a heuristic**: the host's own text is always shown, so a missed
  classification never hides anything; only the offer's wording changes. The
  fake-provider test pins the classified case.
- **The strict guard (decision 5) changes the non-autonomous flow at the final stage**:
  flagged as such, with the one-line fallback named if implementation testing shows it
  hurts.
- **Renderer changes touch a shared state-to-actions table**: `runActions` is pure and
  table-tested; the new action is isolated to the new question kind, so every other
  state's actions are unchanged; the new buttons reuse `SquadChoice`'s patterns, so no
  literal colors appear (the theme audit guards this).
