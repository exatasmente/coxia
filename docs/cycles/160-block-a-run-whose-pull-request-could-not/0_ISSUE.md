# 160 Block a run whose pull request could not be opened, and stop the review from saying it waits every sweep

- Endereço: https://github.com/exatasmente/coxia/issues/160
- Estado: open
- Rótulos: bug, coxia
- Autor: exatasmente

## Descrição

## What happens today

Seen in two real runs on 2026-10-08 (the runs of #141 and #143). Both were cut from `release/0.8.0`, which was deleted when the stable 0.8.0 was cut while they were working.

### 1. `ready` waits for a pull request that was never opened

At the end of `implement` the app pushed the branch (`runner.push.pushed`) and then logged `runner.pr.failed` with "gh: Validation Failed (HTTP 422)": `pullRequest()` in `src/main/runner/publish.ts` aims the pull request at `run.baseBranch ?? defaultBranch`, and that base branch no longer existed on the host. The run went on as if nothing had happened: review and QA ran, and the `ready` stage entered its `pr-merged` wait (`src/shared/runs/transitions.ts`, `wait-started`) with `comments.pr.status` still `draft` and no pull request anywhere.

Nothing tells the person: no proposal in Actions, the runs screen shows a run "waiting", and the only trace is one failed line in the thread, hours earlier. The wait can never end by itself (`prState()` finds no recorded pull request and no linked one). The person asked the developer agent in the thread to open it, and the agent rightly answered that it cannot.

### 2. The review says it is waiting, every sweep, for ever

The review comment of each round stays a draft because `deliver()` finds no pull request (`prOf()` is null) and says `runner.review.waiting`. The sweep in `src/main/runner/service.ts` (`flush()`) re-delivers every draft `mr` comment of every run that is not cancelled, so each thread got one "waiting for the pull request, round N" line every 5 minutes, from 05:42 until past 19:00, through rounds 1 to 3, long after the review stage was done and after `ready` had started its wait. More than 150 identical lines per thread, none of them actionable.

## What should happen

1. **A failed pull request is a blocked stage, not a detail in the thread.** When the push went out but the pull request could not be opened, the stage ends blocked with the host's answer and the target branch as the reason, on the run screen and in the list, and `ready` does not start a `pr-merged` wait while `comments.pr` is not published and no linked pull request exists. When the reason is that the base branch is gone, say so and offer a retry against the open release branch or the default branch, from the run screen. Same family as #133.
2. **A review with no pull request to go to is said once.** The thread says "waiting for the pull request" once per round (or once per change of state), and the sweep keeps quiet until the pull request exists; when it appears, the drafts go out as they do today.

## Acceptance

- A run whose pull request creation fails does not enter `ready` as "waiting": it is blocked with the reason, visible on the run screen, in the runs list and in the thread. A test covers a 422 for a base branch that no longer exists.
- The `pr-merged` wait is never started without a published or linked pull request; a test covers it.
- The person can retry the pull request from the run screen, choosing the base, or the app re-reads the open release before retrying.
- A draft review comment with no pull request produces at most one "waiting" line per round, not one per sweep; a test covers it.

## Notes

- Both runs were recovered by hand: `release/0.9.0` merged into the branch, push of `HEAD:cycle/<n>-…`, pull requests #158 and #159 opened by hand with the description the run had drafted. The wait then found them through the issue's cross-references (`linkedMrs`), which is the path that still works.
- `pullRequest()` is in `src/main/runner/publish.ts`; the sweep is `flush()` in `src/main/runner/service.ts`; the wait is started by the stage transition in `src/shared/runs/transitions.ts`.

## Comentários

(sem comentários)
