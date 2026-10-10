# Test plan: the reissued per-squad priority holds against the repository and the tracker

This cycle delivered documentation only (a cycle-conduction action); the QA stage
changes no code and alters no delivered document. Each scenario below comes from one
acceptance criterion of 1_SPEC.md or from a claim the delivery rests on. No app
interface is exercised: nothing in the product changed. The full test suite could not
run inside this stage's environment (see scenario 06).

## Scenario 01 — no product code changed by this cycle

- What to do: scan `src/` for any reference to the cycle (reissue, cycle-document
  identifiers) and re-read the only delivery file listed in the branch (the cycle
  folder documents).
- What to expect: no `src` file references this cycle; the priority occurrences in
  `src/shared/config` and `src/shared/board.ts` are the pre-existing config and board
  model, with no new feature and no write path outside Actions.
- Result: pass (grep over `src/` returned no cycle references; the model code found is
  pre-existing). Evidence: ev-2.

## Scenario 02 — the squad list in the delivery matches the squad model the config exposes

- What to do: read `SquadDef`/`SquadScope` in `src/shared/config/types.ts`.
- What to expect: the model carries exactly the fields the reissued decision documents
  state it read — `mission`, `scope` (repos, labels, paths, `unclaimed`) and `liaison`
  (plus `autonomy` and the squad's tracker `label`).

## Scenario 03 — the proposed tracker label obeys the plain-label rule

- What to do: read the priority-label handling in `src/shared/config/types.ts`
  (PriorityConfig), `src/shared/config/validate.ts` (labels validated as expressions,
  first position ranks duplicates) and `src/shared/board.ts` (a card's stored priority
  is a plain label name, never a pattern).
- What to expect: `priority:medium` — recorded on the issue — is a plain label,
  writable under the rule; `^priority:high$` / `^priority:medium$` / `^priority:low$`
  are anchored plain labels, all writable, and ordering is first-match-highest.
- Result: pass. Evidence: ev-4.

## Scenario 04 — the whole tree, cycle documents included, passes the public audit

- What to do: run the repository's public audit script over the worktree.
- What to expect: no company, real person, real host, real unrelated issue number or
  secret in any tracked or untracked file; exit 0.
- Result: pass (1516 files checked, script exited 0). Evidence: ev-5.

## Scenario 05 — the repository gates pass on this worktree

- What to do: run the gates on the Node version pinned by `.nvmrc` (v26.5.1, matched):
  type check, theme audit, i18n lint.
- What to expect: all exit 0 — the documentation-only delivery broke nothing.
- Result: pass. Evidence: ev-6. (The full test suite is scenario 06.)

## Scenario 06 — the full test suite runs on this worktree

- What to do: run the repository's test suite.
- What to expect: the suite executes and its summary is green.
- Result: not-run — the test runner could not start inside this stage's environment:
  materializing its temporary config file failed with a read-only-filesystem error
  (node_modules is read-only here). No pass is claimed; the method section of the
  delivery already declared no `src` change, so the suite has nothing new to check,
  but this remains unverified by this stage.

## Scenario 07 — the accepted label is actually on the tracker

- What to do: read the tracker issue for this cycle directly.
- What to expect: the issue is open and carries the label `priority:medium`, matching
  the proposal accepted in the cycle conversation; nothing else was added.
- Result: pass (labels list read from the tracker: `["priority:medium"]`; no milestone,
  no area label), re-verified directly on the tracker by this stage. Evidence: ev-9.
  This closes the open point the review left — it had not re-verified the tracker.

## Scenario 08 — the review's documentation findings are real and non-blocking

- What to do: check the two findings of 4_REVIEW.md against the delivered documents.
- What to expect: `3_IMPLEMENTATION.md` line 28 carries `devCycle.priority.labela`
  (typo for `labels`); the acceptance section mixes criterion 5 with the acceptance
  narrative. Neither blocks: documentation typos, no acceptance criterion unmet, no
  code, no security surface, no secret.
- Result: fail as presented (the defects exist), non-blocking — QA does not rewrite
  delivered stage documents; the fix belongs to a docs pass if anyone wants it.
  Evidence: ev-8.

## Summary

Eight scenarios accounted for: 01–05 pass by commands with exit code 0, 07 pass by a
direct code-host read of the tracker re-verified in this attempt (evidence ev-9), 02
and 03 by code reading backed by scans; 08 confirms the two review findings, real but
non-blocking; 06 (the full test suite) is not-run — the runner could not start in this
stage's environment. Nothing user-facing changed in the product, so no interface
scenario applies.

## Resultado dos cenários

- 01 — no product code changed by this cycle: passou (executado na sandbox) — grep -rniE 'reissue|cycle docs|189-puxar' src/ returned nothing; the priority occurrences in src/shared/config and src/shared/board.ts are the pre-existing model, no new feature, no write path outside Actions.
- 02 — squad list matches the config squad model: passou (executado na sandbox) — SquadDef/SquadScope read in src/shared/config/types.ts: mission, scope (repos, labels, paths, unclaimed), liaison, autonomy and tracker label — exactly the fields the reissued decision documents state it read.
- 03 — proposed tracker label obeys the plain-label rule: passou (executado na sandbox) — PriorityConfig in types.ts, validate.ts (labels validated as expressions, first position ranks duplicates) and board.ts (stored priority is a plain label name) read by this stage; priority:medium is a plain label, writable; ^priority:high$ / ^priority:medium$ / ^priority:low$ are anchored plain labels, first-match-highest.
- 04 — public audit over the whole tree: passou (executado na sandbox) — node scripts/public-audit.mjs over the worktree, exit 0, 1516 files checked.
- 05 — repository gates on this worktree: passou (executado na sandbox) — Node matched .nvmrc; npx tsc --noEmit exit 0, theme-audit exit 0, i18n:lint exit 0.
- 06 — full test suite runs on this worktree: não rodou (executado na sandbox) — Test runner could not start inside this stage's environment: materializing its temporary config failed with a read-only-filesystem error (node_modules read-only). No pass claimed.
- 07 — accepted label actually on the tracker: passou (executado na sandbox) — Re-verified in this attempt: direct read of tracker issue 189 with the code-host read tool (VcsRead, exatasmente/coxia) returned state open, labels [priority:medium], no milestone, no other label — matching the accepted proposal. The read is a tool response, not a shell command; the write of the evidence file 07-tracker-label-read.txt (shell commands 12 and 13) recorded exactly what the tool returned, and the file was staged as ev-9. Closes the open point 4_REVIEW.md left.
- 08 — review's documentation findings are real and non-blocking: falhou (executado na sandbox) — 3_IMPLEMENTATION.md line 28 carries devCycle.priority.labela (typo for labels); the acceptance section mixes criterion 5 with the acceptance narrative. Neither blocks; fix belongs to a docs pass if anyone wants it.
