# Test plan for the attempt badge on the run timeline and the clean reconnected browser timeline

## Scope

One plan covers the two behavior fixes and the aligned test: the run screen's timeline saying which attempt each shown stage document belongs to, the run in a paired browser keeping only its run's lines after a stream drop and return, and the chain test case that races. Verified by: the repository's checks and suite run on the delivered tree, and the run screen exercised in the built app on a disposable data folder — a seeded run whose first stage had two attempts, opened in the app window. Nothing of a real workspace was touched.

## Scenarios

1. **Timeline says which attempt each stage document belongs to** (blocking) — pass. A seeded run whose "Triage" stage ran twice (attempt 1 produced `0_TRIAGE.md`; attempt 2 produced `2_PLAN.md` and a name produced again) is opened on the run screen. Seen: `0_TRIAGE.md · tentativa 1`, `2_PLAN.md · tentativa 2`, `3_IMPLEMENTATION.md · tentativa 2`, stage header "tentativa 2"; every document line shows its attempt, without opening an artifact. Evidence: ev-15 (timeline), ev-17 (runs list); re-executed in a later attempt with the same outcome: ev-1, ev-2.
2. **The badge wording exists in English too** (blocking) — pass. The same seeded run with the workspace language switched to English. Seen: `0_TRIAGE.md · attempt 1`, `2_PLAN.md · attempt 2`, `3_IMPLEMENTATION.md · attempt 2`. Evidence: ev-16; first execution: ev-3.
3. **Stage documents keep the attempt that produced them; a name produced again keeps its first; a run file with the field parses** (blocking) — pass. Repository suite: `test/runs-sendback.test.ts` (12 tests) inside the full-suite run. Evidence: ev-4.
4. **The reconnect refetch drops a finished run the bucket never held and keeps one still going** (blocking) — pass. Repository suite: the reconnect cases of `test/activity-store.test.ts` (21 tests in the file) inside the full-suite run. Evidence: ev-4.
5. **A screen opened fresh fetches and files everything, as today** (blocking) — pass. Repository suite: the plain refill cases of `test/activity-store.test.ts`. Evidence: ev-4.
6. **The chain test waits for the question state with a timeout instead of a fixed count** (blocking) — pass. `test/runner-chain.test.ts` (10 tests) passed inside the full-suite run; not re-run alone in this stage (two earlier isolated runs in a scratch harness failed for a harness-only reason, before its setup matched the suite's). Evidence: ev-4.
7. **The compile check over the whole tree passes** (blocking) — pass. The type-check without emitting ended exit 0 with no errors; the production build of the app also ended successful, and the live screenshots came from that bundle. Evidence: ev-8.
8. **All new screen texts go through the catalogs in both languages** (blocking) — pass. The interface text lint reported every key in both catalogs and zero problems. Evidence: ev-6.
9. **Colors come only from theme tokens** (non-blocking) — pass. The theme audit reported the contrast pairs ok (minimum 4.5:1) on the delivered tree. Evidence: ev-5.
10. **The repository's public audit passes** (non-blocking) — pass. Evidence: ev-7.
11. **A paired browser loses its stream and comes back over a live run, and the timeline shows no seam** (blocking) — not run. Needs a run actually working against a code host with a paired browser attached, then a forced drop and return of its stream. Not available here; the narrowing of the refetch is covered by the store tests (scenario 4), but the real event-path behavior stays unverified.
12. **Voice setup checks** (non-blocking) — fail in this workspace. Two cases of `test/voice-setup.test.ts` failed inside the full-suite run: the check reads the real free disk space and it sits below what a model download needs, so the answer is "disk-low". Environment, not code; the delivered change touches nothing in that file.

## Result

Criteria 1, 2, 4 and 5 verified live or by the suite; criterion 3's store logic verified, its live end-to-end path not run; the compile check criterion passes.

## Resultado dos cenários

- Timeline says which attempt each stage document belongs to: passou (executado na sandbox) — Built app on a disposable data folder, seeded run whose Triage stage ran twice: the timeline lists 0_TRIAGE.md · tentativa 1, 2_PLAN.md · tentativa 2, 3_IMPLEMENTATION.md · tentativa 2, and the stage header counts attempts (tentativa 2). Badge visible without opening an artifact. (ev-15, ev-17)
- Badge wording exists in English too: passou (executado na sandbox) — Same seeded run with the workspace language switched to English: 0_TRIAGE.md · attempt 1, 2_PLAN.md · attempt 2, 3_IMPLEMENTATION.md · attempt 2. (ev-16)
- Stage artifacts keep the producing attempt; repeated name keeps first; run file parses: passou (executado na sandbox) — test/runs-sendback.test.ts (12 tests) passed inside the full-suite run executed in this stage.
- Reconnect refetch drops a finished run never held, keeps one still going: passou (executado na sandbox) — Reconnect cases of test/activity-store.test.ts (21 tests in the file) passed inside the full-suite run.
- A screen opened fresh fetches and files everything, as today: passou (executado na sandbox) — Plain refill cases of test/activity-store.test.ts passed inside the full-suite run.
- Chain test waits for the question state with a timeout: passou (executado na sandbox) — test/runner-chain.test.ts (10 tests) passed inside the full-suite run. Not re-run alone here: two scratch-harness isolated runs failed for a harness-only reason before the setup matched the suite's.
- Compile check passes over the whole tree: passou (executado na sandbox) — tsc --noEmit exit 0, no errors; electron-vite build also exit 0, and the live screenshots came from that bundle.
- All new screen texts go through the catalogs in both languages: passou (executado na sandbox) — Interface text lint reports all keys in both catalogs and zero problems.
- Colors come only from theme tokens: passou (executado na sandbox) — Theme audit reports the contrast pairs ok (minimum 4.5:1) on the delivered tree.
- Public audit passes: passou (executado na sandbox) — Public audit finds nothing to refuse in the delivered files.
- Paired browser drops and returns its stream over a live run: no seam: não rodou (lido) — Not run: needs a run actually working against a code host with a paired browser attached, then a forced stream drop and return. Not available in this workspace; the refetch narrowing is covered by the store tests (see scenario 4), but the event path end to end stays unverified.
- Voice setup checks: falhou (executado na sandbox) — test/voice-setup.test.ts fails 2 of 21 inside the full-suite run: the check reads real free disk space and this workspace's disk sits below the model-download threshold (disk-low). Environment, not code; the delivered change touches nothing in that file.
