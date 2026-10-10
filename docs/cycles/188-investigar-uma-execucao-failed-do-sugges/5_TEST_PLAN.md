# Test plan for the operational disposal of the failed batch

The approved plan (2_PLAN.md) is a sequence of tracker actions, not commits: the spec (1_SPEC.md)
rules out every product change. The scenarios below map the spec's four acceptance criteria
plus the review's correction on the pending count. Nothing of the product is exercised, and no
interface or code is tested; the checks are a worktree inspection and reads of the tracker and
of the runs model. Every executed check in this stage produced its own output, saved as
evidence and cited by its id.

## Scenarios

### Scenario 04 — No product file changed (spec criterion 4) — PASS (executed)

- **Do:** inspect the worktree state and confirm the only modified file is the cycle memory
  the app itself maintains; no product file, no product diff. Also confirm the branch history
  holds only cycle-document commits.
- **Result:** pass. The worktree inspection shows the memory file alone modified, and the
  branch history carries only the triage/refinement/plan/implementation/review cycle-document
  commits. Evidence: ev-1.

### Scenario 05 — The runs model keeps the states the issue talks about (spec out-of-scope rule) — PASS (read)

- **Do:** read the runs schema in the source and confirm the `failed` and `pending` states
  exist as modeled, with recorded causes and holders, and that nothing there is pointed wrong.
- **Result:** pass. The schema defines the pending run (question, holder, stage) and a failed
  status with cause codes; output and transitions support them; nothing changed in this cycle.
  Evidence: ev-2.

### Scenario 06 — The prepared sweep text carries no fixed count of 6 (review finding) — PASS (read)

- **Do:** compare the handoff prepared for the tracker write against the counts said on the
  investigation thread.
- **Result:** pass. The thread read in this stage counts 10 pending cards (six of 07/10:
  worktree-gate, pr-opener, ambient, fechamento, test-runner, checker; four of 09/10:
  review-unifier, re-revisor, despachante, reparo), and the prepared handoff text describes
  the batch by origin and date without the fixed count, recording only the disposition
  reference — the card-by-card decisions belong to the separate cycle already running on that
  thread. Evidence: ev-3.

### Scenario 01 — The batch record exists on the investigation thread (spec criterion 1) — NOT RUN

- **Do:** read the investigation issue thread and look for a comment that records the batch of
  8 failed suggest-agent runs of 07/10 (~14:46:47–48, shared cause "the suggestion was no
  longer waiting") with the discard decision.
- **Expect:** the comment exists, carries the cause and the discard decision, and describes
  the pending batch without the fixed count 6.
- **Why not run:** the thread read in this stage shows no batch record — it carries the
  triage, the spec, the plan and the gates of the separate cycle that now covers the pending
  cards, plus a maintenance question opened at 15:59 that still awaits the maintainer's
  card-by-card decisions. The write belongs to the stage or person with write on that thread;
  the plan orders it before the closure. Content prepared; not recorded yet.

### Scenario 02 — The pendings of the week have an in-block disposition (spec criterion 2) — NOT RUN

- **Do:** on the same thread, verify that each pending question is answered or explicitly
  closed, and that anything outside the gate-fallen rationale stays open instead of being
  force-closed.
- **Why not run:** the maintenance question asking the maintainer to count and decide each
  card on the suggestions screen is posted and unanswered; the separate cycle on that thread
  owns the decisions. Not verified: the live on-screen count (figures said so far: 6 in the
  issue, 10 in the clarification) and each card's identity.

### Scenario 03 — This issue is closed pointing to the investigation (spec criterion 3) — NOT RUN

- **Do:** verify the issue state is closed with a reference to the investigation issue, only
  after scenarios 01 and 02 exist.
- **Why not run:** the issue state read in this stage is open; the plan's ordering keeps the
  closure after both registers exist there. Correctly pending.

## What this plan does not cover

- The repository gates (`npx tsc --noEmit`, the test suite, the audit scripts) were not run in
  this stage: no product file changed, so there is nothing for them to exercise, as the
  implementation and review stages already concluded.
- The maintainer's card decisions on the suggestions screen are workspace data, reachable only
  through the app by the person; they stay unverified here and belong to the separate cycle on
  the investigation thread.
- The author's formal acceptance of the disposal on the tracker stays unverified; the closure
  comment should quote the author's own wording, already in the record.

## Verdict

No blocking failure: the executed code-side scenario passes, the review's count correction is
confirmed, and the three tracker-side criteria are pending by design, in the order the plan
sets, after the maintainer answers the open question on the investigation thread.

## Resultado dos cenários

- No product file changed (spec criterion 4): passou (executado na sandbox) — Worktree inspection executed in this stage: the only modified file is the cycle memory the app maintains; the branch history carries only cycle-document commits. No product change exists.
- The runs model keeps the states the issue talks about: passou (lido) — Read in this stage: the runs schema defines pending (question, holder, stage) and failed with cause codes; output and transitions support them; nothing changed in this cycle.
- The prepared sweep text carries no fixed count of 6 (review finding): passou (lido) — Read in this stage: the investigation thread counts 10 pending cards (six of 07/10, four of 09/10); the prepared handoff describes the batch by origin and date and records only the disposition reference. The live on-screen count stays unverified.
- The batch record exists on the investigation thread (spec criterion 1): não rodou (lido) — Not run: the thread read in this stage shows no batch record — it carries the separate pending-cards cycle and an open maintenance question awaiting the maintainer's card-by-card decisions. The write belongs to the stage or person with tracker write; the plan orders it before the closure. Content prepared.
- The pendings of the week have an in-block disposition (spec criterion 2): não rodou (lido) — Not run: the maintenance question on the investigation thread (count and decide each suggestion card) is posted and unanswered; the live on-screen count and each card's identity remain unverified workspace data.
- This issue is closed pointing to the investigation (spec criterion 3): não rodou (lido) — Not run: the issue state read in this stage is open; the plan orders the closure after both registers exist on the investigation thread. No action taken here would satisfy the ordering.
