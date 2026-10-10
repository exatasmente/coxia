# Test plan: verifying the closing of the pending suggestion cards

Nothing in this delivery changes code, so there are no gates to certify a red/green code state: the delivery is the recorded decision and the closing operation. What this plan verifies is (a) that the recorded closure material is correct and consistent, (b) that the screen path really can record the decisions today — which it cannot, a defect reproduced black-box below — and (c) the state of each specification acceptance criterion.

## Scenarios

### 1. Confirm the count of pending cards before deciding (spec rule 3, criterion 4)

Do: open the app against the real workspace, open the suggestions screen, count the cards waiting for a decision.
Expect: exactly 10 cards — 6 from the 07/10 batch (worktree-gate, pr-opener, ambient, fechamento, test-runner, checker), 4 from the 09/10 batch (review-unifier, re-revisor, despachante, reparo).
Result in this QA pass: **not-run.** The stage's tools cannot reach the app's suggestions screen against the real workspace data (single-instance rule; opening a second instance against the real data is prohibited), and the workspace action file is not reachable read-only from this stage's environment. The count of 10 stands on the implementation pass's reading of the workspace action file, recorded in 3_IMPLEMENTATION.md with the card list; reconfirmation on the live screen remains the person's step after the fix lands.

### 2. No card from the two batches stays waiting after the closure (criterion 1)

Do: decide every card on the suggestions screen (accept, edit or reject) and reopen the screen.
Expect: none of the 10 cards still shows as waiting for a decision.
Result in this QA pass: **fail** — the closure cannot be performed today. Every decision path answers "a sugestão … não está mais esperando" for a card from a session before the running one; reproduced black-box (scenario 6). This is a defect of the app, not of the recorded delivery; the confirmed way forward is to register the fix issue, leave the queue closure waiting for it and close the issue pending that fix, then run the already approved rejection pass.

### 3. Every decided card shows its decision and reason in the suggestion record (criterion 2)

Do: reject one card with the fixed reason and check it appears in the app's suggestion record.
Expect: the record shows the card as rejected with the recorded reason.
Result in this QA pass: **fail** — same cause as scenario 2: the rejection path throws before any decision record is written, for cards from a previous session. Cannot be exercised on the live screen for the same reasons as scenario 1.

### 4. Accepted suggestions appear as the normal flow's result (criterion 3)

Do: if any card is accepted, verify the created agent appears in the team.
Expect: the agent created by the acceptance shows up.
Result in this QA pass: **not-run, trivially satisfied** under the confirmed decision (all 10 rejected, nothing accepted, nothing to create). Explicitly nothing was executed for it; there is nothing to execute as long as the decision stands.

### 5. The confirmed count is registered together with the result (criterion 4)

Do: read 3_IMPLEMENTATION.md.
Expect: the count confirmed before the decision (10 cards, listed one by one with batch, proposal and stage) is recorded in the closing note.
Result in this QA pass: **pass** (read). The note records 10 pending cards, the decision in block with the fixed rejection reason, and the failed-runs part correctly out of scope, covered by the other issue.

### 6. The decision error mechanism holds black-box (blocking defect reproduced)

Do: in a disposable setup, with the in-memory waiting register empty (as it is after an app restart), simulate a pending suggest-agent card older than the session and call the three decision paths; also recover the proposal from the card itself.
Expect: reject, edit and accept all answer "a sugestão … não está mais esperando" and write no decision; the card itself carries the full proposal (id, name, role, stage, prompt, evidence), the path the fix would use.
Result in this QA pass: **pass** — a 4-test run passed (exit code 0): the three decision paths threw exactly "a sugestão [id] não está mais esperando", and the card recovered the full proposal. This reproduces the error the person saw on the live screen and confirms the fix remains viable on the current code.

### 7. The delivery changes no code and the tree stays healthy

Do: run the type check on the checked-out tree; look for product-code changes in the delivery.
Expect: type check passes; no product code touched.
Result in this QA pass: **pass** — `npx tsc --noEmit` exit code 0 on the checked-out tree; the delivery changed no product code. The repository's vitest suite could not be run in this environment (the check-out's shared, read-only dependencies cannot host vitest's temporary config writes); the targeted black-box run of scenario 6 was the executed test.

## What this pass did not verify

- The live screen against the real workspace data (count before, decisions during, queue after the fix) — for the reasons in scenario 1. Unverified here.
- The registration of the new fix issue and the issue closing note as described in the handoff — performed by the closing step, not by QA; unverified here.
- The complete prompt/evidence content of each card (visible only on the screen) — unverified; the count and card names come from the action-file reading recorded in the implementation note.

## Resultado dos cenários

- Confirm the count of pending cards on the live suggestions screen before deciding: não rodou (lido) — Not executed: the single-instance rule (a second app instance against the real data is prohibited) and the app's suggestions screen are not reachable by this stage's tools, and the workspace action file was not found anywhere readable in this environment. The count of 10 (6 from 07/10, 4 from 09/10) stands on the reading recorded in 3_IMPLEMENTATION.md.
- No card from the two batches stays waiting after the closure (spec criterion 1): falhou (executado na sandbox) — Cannot be met today: every decision path answers "a sugestão … não está mais esperando" for a card from a previous session. Reproduced black-box (scenario 6) and confirmed in code; defect of the app, external to the delivery, forwarded to a new fix issue with the issue closing pending — the approved way forward.
- Every decided card shows its decision and reason in the suggestion record (spec criterion 2): falhou (executado na sandbox) — Same cause as the previous scenario: the rejection path throws before any decision record is written. Not exercisable on the live screen for the single-instance reasons.
- Accepted suggestions appear as the normal flow's result (spec criterion 3): não rodou (lido) — Trivially satisfied under the confirmed decision (all 10 rejected, nothing accepted, nothing created). Nothing executed; nothing to execute as long as the decision stands.
- The confirmed count is registered together with the result (spec criterion 4): passou (lido) — 3_IMPLEMENTATION.md records the confirmed count of 10 pending cards, listed one by one with batch, proposal and stage, the decision in block with the fixed rejection reason, and the failed-runs part out of scope. Verified by reading the document.
- The decision error mechanism holds black-box (blocking defect reproduced): passou (executado na sandbox) — 4-test vitest run, exit code 0: with the in-memory waiting register empty (as after an app restart), reject, edit and accept of a simulated pending suggest-agent card each threw exactly "a sugestão [id] não está mais esperando" (pt-BR, matching the person's report) and recorded no decision; suggestionOf recovered the full proposal (id, name, role, stage) from the card, the path the fix would use.
- The delivery changes no code and the tree stays healthy: passou (executado na sandbox) — npx tsc --noEmit in the checked-out tree returned exit code 0; no product code was changed. The repository's full vitest suite was not run in this environment (shared read-only node_modules prevents vitest's temporary config writes) — unverified here.
