# #20 "Resolve conflict" never shows for cards from a code-host integration — plan

Root cause and evidence: [`1_INVESTIGATION.md`](1_INVESTIGATION.md). The smallest fix: carry the conflict as data on the card, read it where the text is read today, and keep the text as a fallback for card sources that only have text.

## Changes

| # | File | Change |
|---|---|---|
| 1 | `src/main/report.ts` | `ReportItem.has_conflicts?: boolean` (optional: an external card-source command may or may not emit it; the integration already does, `vcs/cards.ts:197`) |
| 2 | `src/shared/types.ts` | `Card.mrConflicts?: string[]`: the refs of the card's MRs that the source says conflict. Optional, because a card saved before this change, or from a source that does not say, has none |
| 3 | `src/main/cards.ts` | `loadCards` fills `mrConflicts` from the MR items with `has_conflicts === true` |
| 4 | `src/renderer/src/dashboard.ts` | `conflictMrs` = MRs whose ref is in `mrConflicts` **or** that a blocker names with the legacy sentence (`MR_CONFLICT`); the needs list sets `conflictCard` when `conflictMrs(card)` is not empty, whatever the first blocker is, and records which MR the row is about (`conflictRef`) |
| 5 | `src/renderer/src/screens/TodayParts.tsx` | read `conflictRef` instead of re-deriving the MR from the row title |
| 6 | `CHANGELOG.md` | one line under `### Fixed` |

`Deep.tsx`, `ResolveConflict.tsx` need no change: they already ask `conflictMrs`.

## Tests

- `test/dashboard.test.ts`: `conflictMrs` from `mrConflicts` alone (a blocker in the localized integration wording, pt-BR and en), a non-conflicting MR does not, the legacy sentence still works, the two sources agree on the same MR once; the needs row offers the button when the conflict is not the first blocker, and names the MR when the first blocker is that MR's.
- `test/cards-load.test.ts`: `loadCards` carries `mrConflicts` (only the MRs flagged, per issue; absent flag means none).
- `test/vcs-cards.test.ts`: end to end with a GitHub-like and a GitLab-like fake host: `buildCardReport` → `loadCards` → `conflictMrs` returns the conflicting MR in pt-BR and en and not the clean one.
- The command-source path: a report with only the text "MR com conflitos" and no `has_conflicts` still yields the button (existing assertions kept).

## Decision log

1. **Separate `mrConflicts` field, not a flag on `mrPaths` entries.** `mrPaths` is serialized into agent and job prompts (`qa.ts`, `feedback.ts`, `efeitos.ts`) and exposed to the agent through `cardFields`; a new key there would change those payloads (and the prompt goldens) for a UI-only concern. A card-level list of refs is read by the one place that needs it and reaches no prompt.
2. **Text fallback kept.** The external command's report is not ours to change and its documented signal is the sentence; dropping it would break those workspaces. The match stays anchored to that exact sentence, so the integration's localized wording is never parsed.
3. **Structured data OR text, not structured data over text.** `has_conflicts: false` from a source that also writes the sentence is contradictory input; showing the button is the safer error (the resolution re-checks with a local merge, `conflictFromMr`).
4. **The needs row no longer depends on `blockers[0]`.** The integration puts "pipeline failed" before the conflict, so a first-blocker guard would hide the button for a conflicting MR with a red pipeline. The row offers the button whenever the card has a conflicting MR; when the row's own title is that MR's blocker only that MR's button shows, otherwise every conflicting MR of the card gets one.
5. **Bitbucket stays without the button.** It reports no conflict flag (`conflictFlag: false`); inventing one from the text would be a guess. Documented, not changed.
6. **Not changed:** the localized blocker text, `conflictFromMr`, the prompt goldens. If a golden moves, the plan was wrong.
