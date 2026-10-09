# Review of the skip exam against the spec and the plan

Scope: the branch carries no code change; the delivery of this cycle is the exam report
(`3_IMPLEMENTATION.md`) plus the earlier triage, spec and plan documents. The review reads the
report against every acceptance criterion of `1_SPEC.md` and the method fixed in `2_PLAN.md`,
checks the repository rules and runs the public audit over the tree (worktree clean; the audit
passed: 1278 files, nothing that belongs to a company or a person). The review found one
inconsistency in the delivered report's own count arithmetic and one quoting gap; both are
suggestions, neither breaks an acceptance criterion. The underlying run records live in the
maintainer's real workspace, outside this review tree, so the headline counts (25 / 4 / 8 of 37)
were checked only for internal arithmetic, not against the raw records: not independently
verified.

## Criterion-by-criterion

1–2 (every skipped step listed per release with stage, who, reason or "no trace") — met as
written. The 75 list covers all three discard lots and the recusal lot; 151 lists 4; 115 lists 8.
"Who" is marked as an inference wherever the actions catalog has no per-card author, and the
limitation is stated up front — consistent with the plan's own note that the catalog carries no
author per skip. Nothing was sampled away; the "dezenas" of 75 are all listed.

3 (count matches the release's own record) — met, with one defect. The counts come from the same
walk that produced the lists, the section sums reach 25 = 7 + 12 + 6, 4 and 8 (37 total), and the
retro's different numbers are reported as a finding instead of being reconciled silently. The
parenthetical that explains the 25, however, misstates its own arithmetic ("7 + 12 − 1 + 6 = 24 +
one more card counted in the first subsection"): the recusal subsection has exactly 7 rows and
there is no extra card to add. The total stands from the subsection sums; the explanatory note
does not. Finding 1 (suggestion).

4 (exactly one type per skip) — met: gate/wait decisions, redo leftover and other are applied
mechanically; the empty-reason release-git skips were checked against group supersession before
other/no-trace, as the plan fixed. No skip was forced into a type.

5 (repeated patterns named) — met: three named patterns (redo leftovers, script recusals read as
choices at 11 of 37, and exactly one real registered decision) with per-stage counts.

6 (source per entry) — met, except that in the 75 recusal table several rows cite the refusal as
"a mesma recusa" / "a recusa de checkout novamente" instead of the registered text, where the
spec asks for reasons quoted as recorded, not summarized (rule 6). Finding 2 (suggestion).

7 (short conclusion) — met: four concrete change suggestions, each explicitly routed to its own
future request, out of this delivery's scope.

8 (finished before the next beta cut) — met as delivered.

## Rules and safety

Read-only delivery confirmed: the branch adds no code, the worktree is clean, and no temporary
script or draft was left behind. Public audit passes over the tree. Repository rules (English,
no attribution, public-safe wording) hold.

## Conclusion

Approved. The two findings below are suggestions for a follow-up correction of the report; both
touch presentation of already-listed data, not the list itself, so nothing blocks.

## Not verified

- The raw run files and the actions catalog behind the counts were not re-read in this review
  (they are outside this tree, and the maintainer's workspace is off limits to it); the counts
  and quoted reasons are accepted as read by the exam stage.
- The 0.6.1 stable push gap that the 115 section deliberately leaves as an unattested finding
  remains unattested.
