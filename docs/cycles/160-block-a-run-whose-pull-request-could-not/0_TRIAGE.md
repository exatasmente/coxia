# Run keeps waiting for a pull request the host refused to open, and the thread fills up with waiting lines

## Type

Bug. Not a duplicate, not a question.

## Can it be understood and reproduced

Understood as written; confirmed by reading the code (nothing was executed):

- When the pull request cannot be opened, only the thread gets one `runner.pr.failed` line with the host's message. The stage that pushed the branch ends normally; the run moves on to review, QA and the final stage. Confirmed in the pull-request opening path of the runner publish flow.
- The pull request targets the recorded base branch, falling back to the default branch. When the base branch (the open release) no longer exists on the host, the host answers 422 and the creation fails. Matches the reported scenario.
- The final stage starts its `pr-merged` wait through the stage transition, which does not check whether a pull request was published or linked; there is nothing recorded to find, so the wait can never resolve by itself. Confirmed in the transitions file.
- The sweep re-delivers every draft review comment of every run that is not cancelled, and each delivery without a pull request emits the `runner.review.waiting` line — one identical line per sweep per thread, indefinitely. Confirmed in the runner service sweep and review delivery path.
- The recovery path the issue's notes describe (hand-opened pull requests found again through the issue's cross-references) is consistent with the code; not run.

## What is missing

Nothing that only the reporter can answer; the acceptance criteria are concrete. One choice is left to the fix, not the reporter: how the retry-from-the-run-screen picks the base branch (offer the known bases, or re-read the open release) — the acceptance text allows either.

## Related issues

- #133 — same family, named in the issue: a run left waiting without a way out, made visible on the run screen instead of buried in the thread. Not a duplicate.

## Suggested priority

priority:high, as a suggestion only: the failure is silent (a run shown as "waiting" for a pull request that does not exist), it triggers whenever a base branch disappears mid-cycle, threads fill with 150+ identical lines, and recovery today is entirely manual. Product refines priority.
