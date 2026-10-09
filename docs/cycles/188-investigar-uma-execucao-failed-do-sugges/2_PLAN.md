# Plan: dispose of the failed batch and clear the pending questions on the existing investigation

## Scope of this plan

The approved spec is operational: no product code changes. This issue only decides
how a batch of 8 `failed` suggest-agent runs and 6 `pending` runs of the week
(07/10/2026, ~14:46:47–48; the same cause: the gate decision had already fallen
before the runs executed; the detailed record lives in the earlier investigation)
is carried out. The plan below is therefore a sequence of tracker actions, not a
sequence of commits.

Verified in this stage:

- The runs data model already carries the states involved: `src/shared/runs/schema.ts`
  defines `pending` (a question with holder, kind, askedAt, stage) and a `failed`
  status that records a cause code (`no-agent`, `stage-failed`, `no-event`,
  `pr-open-failed`), stage and detail, plus `src/shared/runs/transitions.ts` writing
  those records. Nothing there was reported as wrong, so nothing there changes.

## Changes, in order

1. **Register the batch on the investigation issue.** On the tracker, a comment on
   the earlier investigation records the batch: the 8 suggest-agent actions with
   their timestamps, the shared cause line ("the suggestion was no longer waiting")
   and the decision that they are discarded — not an agent defect, cause outside the
   runs (gate decision already fallen). Owner: product-owner + tracker write; no file
   in the product changes.
2. **Resolve the 6 pending runs in block, on the same investigation.** Each of the 6
   pending questions is answered or explicitly closed, under the same gate-fallen
   rationale, so none stays in indefinite hold. Nothing is answered here: they are
   all carried to that one place.
3. **Close this issue pointing to the investigation.** Once (1) and (2) exist on the
   tracker, the issue is closed as resolved by the investigation, with a link.

Order matters: (3) only after (1) and (2), so the accept criterion "the batch and the
pendings have a disposition there" is satisfied before the closure.

## Tests / verification per behavior

No code changes are made, so there are no new tests. Verification is by reading the
tracker after each step:

- A test for step 1: the comment listing the 8 runs exists on the investigation issue.
- A test for step 2: none of the 6 pending questions remains pending on that issue's
  thread; each has an answer or an explicit close.
- A test for step 3: the issue shows state closed with the reference.
- A guard: the worktree stays clean of new product files after the stage — this issue
  must produce no code diff (checked: the worktree is clean).

## Risks and how they are avoided

- **Risk: re-investigating the same cause twice**, diverging between the two places.
  Avoided by rule 2 of the spec: no detailed record here, only the disposition
  reference.
- **Risk: a pending question that actually needs a fresh answer by a person** (it is
  not covered by the gate-fallen rationale). Avoided by treating the 6 in block only
  as a sweep; any question that does not fit the rationale is left open on the
  investigation instead of force-closed.
- **Risk: closing this issue before the work it hands over is registered**, losing
  the trace. Avoided by the ordering above.
- **Risk: the workspace autonomy closes the loop without a person confirming the
  disposition.** The acceptance of this forwarding by the author on the tracker is
  still unverified; the closure step should quote the author's own proposed wording,
  which is already in the record.

## Decisions and reasons

- **No code changes, no migrations, no new tests in the product.** The spec's rules
  and the triage both conclude the cause is outside the agent; the app-side states
  for failed/pending runs are correct as modeled (read in the runs schema this stage).
- **The tracker write is one comment per behavior (batch record; pending sweep;
  closure), not one giant post.** Keeps each register auditable on its own.
- **Discard, not retry, for the 8 failed runs.** Retrying would re-run gates whose
  decision had already fallen; the correct end state is a recorded discard, and any
  state drift these runs left is expected to be reconciled by the normal cycle flow
  rather than by hand-modifying records.

## Acceptance criteria not covered by this plan

- Formal acceptance of the forwarding by the issue author on the tracker remains
  unverified. The plan assumes the disposition is acceptable because it is exactly
  what the author proposed; if the author objects, the fall-back is to split steps 1
  and 2 into separate follow-ups, which changes no artifact here.
