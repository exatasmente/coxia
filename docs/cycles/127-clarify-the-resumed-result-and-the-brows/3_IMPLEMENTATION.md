# What was built to tell attempts apart and keep the browser timeline clean

## What was delivered, in the order the plan set

1. **The chain test now waits for the engine, and passes deterministically.** The case "is not answered by an agent once the person has answered it" in the chain test file did not fail on this tree: `npx tsc --noEmit` passes whole and the case passed in isolation, so the diagnosis step of the plan had to tell race from regression. The expected state does occur — the question is held by the tech-lead and stays put — so the failure the review saw is the fixed loop of 80 sleeps of 10 ms reading the run before the chain got there on a slow machine. The loop was replaced by a `until` helper that polls the run's state every few milliseconds (approving gates along the way, as the loop did) and fails on a timeout instead of surviving a machine that is only slow once. It ran with the expected state asserted, twice on this tree plus the full-suite runs below.

2. **Each document of a stage is marked with the attempt that produced it.**
   - `src/shared/runs/types.ts`: `StageRecord` gained the optional `artifactAttempts?: Record<string, number>` (document name → attempt number), next to `artifacts`. The wording follows the plan.
   - `src/shared/runs/schema.ts`: the run file schema carries the same optional mapping, so run files written before the field are read as before (it is only added).
   - `src/shared/runs/transitions.ts`: `finishStage` — the one place stage artifacts are merged — writes the mapping: a name produced in the attempt being finished gets its current attempt number (`r.attempts`, already the number of the attempt in progress), and a name produced again keeps its first attempt. Nothing else in the transitions writes artifacts beside it, so every producer is covered.
   - `src/renderer/src/screens/cycle/StageTimeline.tsx`: when a stage has more than one attempt and the mapping is recorded, each document line shows a small quiet marker with the attempt ("attempt 2" / "tentativa 2") through `t()`. When the stage has one attempt, or the run predates the mapping, nothing is shown.
   - The catalog key `ui.cycle.stage.attemptOf` — English "attempt {count}", Portuguese "tentativa {count}" — was added to `ui-cycle.en.json` and `ui-cycle.pt-BR.json`, ordered as the sorted-catalog test requires.
   - One deliberate deviation from the plan: `StageRow` in `src/shared/runs/view.ts` needed no change. Its `record` is already the whole `StageRecord`, so the mapping reaches the screen through it; carrying a second copy of the same object's field would be dead data.

3. **The reconnected browser timeline is narrowed to the run it shows.**
   - `src/renderer/src/activity.ts`: `createActivityStore` gained `backfillLive`, a narrowing variant of `backfill`: an entry of the packet stays only when its run was already in the bucket, or the run is still going judged on the packet itself (`runActive`). A run that ended before the drop and has no line in the bucket is left out — its lines are the seam the issue reports. The plain `backfill` keeps its behavior for a screen opened fresh.
   - `src/renderer/src/useActivity.ts`: the listener of `EVENTS_RECONNECTED` now fetches with the narrowed variant; the backfill of `useActivity` (a screen opened mid-run or an empty stretch) stays on the plain one, so rule 4 of the specification holds.

4. **`CHANGELOG.md` got a `## [Unreleased]` entry, one per behavior** (the attempt marker and the reconnected timeline), plus the racing test alignement noted in the same block.

## Files the work changed

- `src/shared/runs/types.ts`, `src/shared/runs/schema.ts`, `src/shared/runs/transitions.ts`
- `src/renderer/src/screens/cycle/StageTimeline.tsx`
- `src/renderer/src/activity.ts`, `src/renderer/src/useActivity.ts`
- `src/shared/i18n/ui-cycle.en.json`, `src/shared/i18n/ui-cycle.pt-BR.json`
- `CHANGELOG.md`
- `test/runner-chain.test.ts`, `test/runs-sendback.test.ts`, `test/activity-store.test.ts`, new `test/stage-timeline.test.ts`

## Tests written, per behavior

| Behavior | Test |
|---|---|
| Artifacts carry the attempt that produced them; a name produced again keeps the first | `test/runs-sendback.test.ts` — a run sent back to `implement` (attempt 2) merging `3_IMPLEMENTATION.md` (attempt 1) with a new `3_FOLLOW_UP.md` (attempt 2); also checks the run file still parses with the field |
| `attemptOf` in both catalogs, badges drawn when known and absent when not | `test/stage-timeline.test.ts` — new: static render of the timeline, badge on artifacts of both attempts, none with the mapping dropped or the stage at one attempt, and the Portuguese wording checked |
| The narrowed backfill keeps a held run and a run still going, drops a finished run never held, keeps nothing when nothing qualifies | `test/activity-store.test.ts` — three new cases |
| The plain backfill still files everything, as today | `test/activity-store.test.ts` — covered in the same suite |
| The chain question held by the agent is waited for, with a timeout instead of a fixed count | `test/runner-chain.test.ts` |

## What was run and how it ended

- `npx tsc --noEmit` — clean (it caught one mistake first: `runActive` mutates, and a readonly array is cast before the call).
- `npx vitest run` — 308 files, 4847 tests, all passing.
- `node scripts/theme-audit.mjs` — passes (no new colors; the renderer changes reuse existing badge/faint classes).
- `npm run i18n:lint` — passes; `node scripts/public-audit.mjs` — passes.
- `test/runner-chain.test.ts` ran alone twice, all its 10 tests passing both times, plus inside the full suite.

## The two suite lines carried over from the plan

The full suite prints `i18n lint: 1 untranslated strings, above the allowed 0` and `i18n lint: unknown scope "nowhere"`. Both are read, not blamed on the tree: they are the *stderr* the two lint-tool tests expect to fail on (`test/ui-i18n.test.ts` "exits non-zero above the allowed total" writes its own temporary file with one literal, and `test/i18n.test.ts` "refuses a scope it does not know" calls the script with an unknown scope). The gate itself passes; nothing in the renderer is untranslated. No code change was made for this.

## What was not verified here

- The interface was not exercised in a real run: no dev server was started and no paired browser was attached; the two behavior changes are covered by the unit tests listed above, not by a live click. Not verified.
- The seam in a real reconnect of a browser over a live run is not reproducible in a unit test — the narrowing was tested through the store's function, not against the event layer. Not verified live.
- The documentation snippet the review left: out of this issue by the tech-lead's decision, still awaiting its own report.
