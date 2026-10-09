# Plan of tests for the conflict-prone pull request check

## Scenario 1 — State registered for PR #146 (issue #142)
- Do: read on the code host the state of the pull request linked to the QA-stage issue: open or merged, target branch, CI status, and whether a merge conflict is pending.
- Expect: the pull request is merged into release/0.8.0, merged at 2026-10-08T04:46:30Z, with CI success on the merged commit, and hasConflicts=true remains as a residual marker against the current base with nothing pending.
- Result: executed — VcsRead host read on 2026-10-09 matches every expected field.

## Scenario 2 — State registered for PR #131 (issue #121)
- Do: same read as scenario 1 for the second conflict-prone pull request.
- Expect: the pull request is merged into release/0.8.0, merged at 2026-10-07T14:40:42Z, with CI success, and hasConflicts=true as a residual marker with nothing pending.
- Result: executed — VcsRead host read on 2026-10-09 matches every expected field.

Notes: this issue is a host-state check, not a UI change; the read-based criteria are satisfied and no interface scenario applies.

## Resultado dos cenários

- Scenario 1 — State registered for PR #146 (issue #142): passou (lido) — VcsRead host read on 2026-10-09 (project exatasmente/coxia, op=mr, iid=146): state=merged, targetBranch=release/0.8.0, mergedAt=2026-10-08T04:46:30Z, ci.status=success on the merged commit, hasConflicts=true as a residual marker against the current base with nothing pending. Criteria 1 and 2 of the test plan satisfied. — afirmado como executado (como o app registrou)
- Scenario 2 — State registered for PR #131 (issue #121): passou (lido) — VcsRead host read on 2026-10-09 (project exatasmente/coxia, op=mr, iid=131): state=merged, targetBranch=release/0.8.0, mergedAt=2026-10-07T14:40:42Z, ci.status=success, hasConflicts=true as a residual marker with nothing pending. Criteria 1 and 2 of the test plan satisfied. — afirmado como executado (como o app registrou)
