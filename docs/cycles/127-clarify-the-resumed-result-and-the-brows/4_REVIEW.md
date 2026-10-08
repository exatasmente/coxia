# Review of what the run's timeline now says and what the browser keeps

## What was reviewed

The whole diff of the delivery against 1_SPEC.md and 2_PLAN.md: the attempt mapping in the run record, the badge on the timeline, the narrowed refetch after the browser's stream comes back, the aligned chain test, the record change to the two catalogs, and the new and changed tests.

## How each behavior was checked

- **Attempt attribution.** `finishStage` in `src/shared/runs/transitions.ts` is the only place stage artifacts are merged (read in full; no other producer of `artifacts` in `src/shared/runs`), and it writes `artifactAttempts` only for names not already there, so a name never moves its attempt. The type (`src/shared/runs/types.ts`) and the run-file schema (`src/shared/runs/schema.ts`) carry it as optional, so a run written before the field stays valid; the schema rules the values to integers from 1. The screen (`src/renderer/src/screens/cycle/StageTimeline.tsx`) shows the badge only when the stage has more than one attempt and the mapping knows the name — no change for an old run or a stage that ran once.
- **Browser timeline.** `backfillLive` in `src/renderer/src/activity.ts` keeps an entry only when its run was already in the bucket or is still going judged on the fetched packet itself; the plain `backfill` keeps its behavior for a screen opened fresh, and `src/renderer/src/useActivity.ts` narrows only the reconnect listener. This matches specification rules 3 and 4. Static reasoning about the filter, plus the two tests added to `test/activity-store.test.ts`; a real drop-and-return was not exercised live (not verified live).
- **Chain test.** `test/runner-chain.test.ts` now waits for the question state with a timeout instead of a fixed count of sleeps; the timeout message names the state the run ended in, and gate approvals continue to be given while waiting. The plan's diagnostic step is met: the state does occur, and the change is the wait, not the behavior.
- **Tests per behavior.** The mapping merge and the run-file parse in `test/runs-sendback.test.ts`; badge and wording (both languages, absent badge in both cases the spec requires) in the new `test/stage-timeline.test.ts` — its static render asserts the exact lines a person reads; three reconnect cases and the unchanged plain refill in `test/activity-store.test.ts`; the deterministic wait in `test/runner-chain.test.ts`.
- **Catalogs.** `ui.cycle.stage.attemptOf` exists in `ui-cycle.en.json` and `ui-cycle.pt-BR.json`, positioned where the sorted-catalog check requires. The badge text reuses the same wording family as the stage header's attempt count, so the screen's vocabulary stays one word, one meaning.
- **Repository rules.** All new screen text goes through `t()` with keys in both catalogs; colors reuse existing faint/badge classes, no literal color. Public audit patterns: no company, person, host, real issue number or secret in the diff; neutral example names only.

## What was run in this review

No command was run in this stage beyond reads: the review is static over the diff and the code it touches. The five gates (compile check, full suite, theme audit, interface text lint, public audit) are reported green by the implementation stage on this same tree and are **not re-verified here**; the full suite result (about 4847 tests passing) and the `runner-chain` case passing twice are taken from that report.

## Findings

None blocking. Two minor notes, both non-essential:

1. `test/stage-timeline.test.ts` asserts some strings twice (`t('ui.cycle.stage.attemptOf', …)` compared against itself) before the markup assertions; redundant with the markup check that follows, harmless — a suggestion only.
2. `test/stage-timeline.test.ts` defines an identity wrapper `headed(d)` that returns its argument unchanged; a direct expression would read simpler. Suggestion only.

## Verdict

Approved. All five specification acceptance criteria are addressed by code that was read here; criteria 4 (the gates) rest on the implementation stage's reported runs, and the two acceptance criteria about the screens were checked by reading the drawing and store code and their tests, not in a live interface session — the same unverified-live note the implementation stage left, unchanged.
