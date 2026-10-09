# Implementation: the batch record and the pending sweep go to the investigation, with no code change

## What this stage produced

The approved plan (2_PLAN.md) is a sequence of tracker actions, not a sequence of commits, because the approved spec rules out every product change. This stage followed that decision and produced no code, no tests and no commit. The runs data model keeps the states the issue talks about: `src/shared/runs/schema.ts` defines the `pending` run (a question carried by a holder) and a `failed` status with a recorded cause, and `src/shared/runs/transitions.ts` writes those records; both were read in the planning stage and nothing there was reported as wrong, so nothing there changed.

The repository state was checked in this stage: the only modified file in the worktree is the cycle memory file the app itself maintains. No product file is touched.

## The three planned actions, and what each needs

1. **Register the batch on the investigation (#162).** The comment content is prepared in this stage's comment: the eight suggest-agent actions of 2026-10-07 ~14:46:47–48 (plan-refresher, typecheck, tsc-audit, gatekeeper, feedback-driver, preflight, criterios, verifier) with the shared cause ("the suggestion was no longer waiting") and the discard decision — not an agent defect, because the gate decision had already fallen before the runs executed. Reading the tracker this stage showed the investigation issue is open and carries no discussion comments yet: the detailed record does not exist there and has to be written.
2. **Sweep the six pending runs in block, on the same thread.** Each pending question is answered or explicitly closed under the same gate-fallen rationale; anything that does not fit the rationale stays open on the investigation instead of being force-closed. The identities of the six pendings were not read this stage — they live in the workspace run data, not in the repository — so this stage can neither list nor close them; the prepared comment text carries the disposition under the rationale and asks the person holding them (the issue author) for anything that does not fit.
3. **Close this issue pointing to #162**, only after (1) and (2) exist there. Not executed in this stage, for the same reason below.

## Why the actions were not executed here

The three steps are tracker writes on the investigation thread. The write this stage can post is the stage comment on the issue; the recording on the #162 thread and the issue closure belong to a stage or person with write on that thread. By the plan's own ordering rule, the closure must wait for the two registers, so none of the three is recorded as done. Nothing in the plan depended on code, so no typecheck or test run was meaningful for this stage and none was required: no source file changed (verified by the repository state above).

## What was verified in this stage

- The approved plan and spec agree this is an operational disposal, not a code change (read in this stage).
- The worktree contains no product change; the only modified file is the cycle memory maintained by the app (checked in this stage).
- The investigation issue #162 is open, carries the same scope in its body, and has no comments that would make the batch record or the pending sweep already exist (read in this stage via the tracker).

## What was not verified in this stage

- The execution of the three tracker actions (not performed here).
- The formal acceptance of the disposition by the issue author on the tracker.
- The identity and content of the six pending runs (not in the repository data).

## Acceptance criteria mapping

1. Batch registered on #162 with cause and discard decision — pending; comment content prepared.
2. Six pendings with a disposition on #162 — pending; disposition text prepared; anything outside the rationale stays open there.
3. This issue closed pointing to #162 — pending, ordered after (1) and (2).
4. No product file changed by this issue — satisfied (checked in this stage).

## Next stage handoff

The next stage (tracker-side write) posts the prepared batch record and the pending sweep on the investigation thread, then closes this issue referencing it, quoting the author's own proposed wording already in the record. If the author objects to the disposal, the fallback from the plan is to split the two registers into follow-ups; no artifact changes.
