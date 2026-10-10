# Plan: minutes of a day show the questions that repeat unanswered across days

Implements 1_SPEC.md. All behavior verified against the code of this worktree by reading it; nothing ran yet (plan stage).

## Basis read

- `src/shared/minutesVersions.ts` — `MinutesSnapshot` (per-version snapshot, `unanswered: {ref, question}`), `mergeDay` (a day's merged unanswered, resolved stages removed), `DayView`.
- `src/shared/minutes.ts` and `src/shared/types.ts` — `Minutes.unanswered` (per version, `{ref, question}`).
- `src/main/minutesStore.ts` — the day index (`<date>-pre-daily.versions.json`), `snapshotOf`, `registerCeremony`, `openVersion`, `dayView`, `writeDayFile`, `minutesDates`.
- `src/main/minutes.ts` — the `minutes:day` handler that already ships `DayView` to the window (and browser).
- `src/renderer/src/screens/MinutesParts.tsx` — the day summary block that renders `minutes.day.unanswered`.
- `src/main/store.ts` (`minutesMarkdown`), `src/main/agents.ts` (`prepareTurn`), `src/main/sameDay.ts` (`earlierText`) — the version document and the turn prompt path.

## Pairing definition (operationalizes "same question-forma: same stage, same subject")

Questions without an answer come only from cards, so each unanswered question carries the ref of the activity it asks about. The model-free subject of a question is that activity ref; a "question-forma" is therefore **ref + stage**. Two occurrences pair when both match (squad too — pairing never crosses squads; `undefined` pairs with `undefined`). Text equality is not required.

The per-version snapshot silently drops the card's stage today (`snapshotOf` keeps `{ref, question}` only). The plan extends the snapshot entry with `stage: string | null`:
- `snapshotOf` writes the card's stage;
- `openVersion` (which builds a snapshot literal from `Minutes.unanswered` and has no cards) writes `null`;
- reading old day indexes: missing field → looked up in that same version's `covered` by ref; still unknown → `null`.
The index keeps `version: 1`: the addition is backward compatible on read. A `null` stage pairs by ref alone (an unknown stage is not evidence the form changed).

## Changes, in order

1. **`src/shared/minutesVersions.ts`**
   - `snapshotOf`: keep `stage` on each `unanswered` entry (nullable).
   - New types `RepeatedQuestion { ref, question, stage, squad?, dates: string[], count: number }` and `DayUnanswered { date, squad?, unanswered: {ref, question, stage, questionText}[] }`.
   - New pure `repeatedUnanswered(todayDate, todayUnanswered, previousDays)` — pure core of the feature: take up to 7 previous days, pair today's merged unanswered (same ref+stage, squad respected), return items with the dates ascending (today's date last) and the day count. No repeaters → empty array.
2. **`src/main/minutesStore.ts`**
   - `openVersion` snapshot literal: `stage: null` on unanswered entries.
   - New export `previousDayAnswers(date, limit = 7)`: `minutesDates()` before `date`, most recent up to 7, `readIndex` (never `ensureDay` — no index is created for empty days); for each, `mergeDay(index.versions).unanswered` with the stage resolved from the version's `covered`, plus each version's `squad`. Malformed/missing index → that day is skipped.
   - `dayView`: add `repeated: RepeatedQuestion[]` to `DayView`, built with `repeatedUnanswered(date, merged.unanswered, previousDayAnswers(date))`.
   - `writeDayFile`: after the version parts, if `repeated` is non-empty, append a day-level section (`## Perguntas repetidas sem resposta` via a catalog key) with one line per item — question text (latest), ref, dates, day count. Regeneration logic unchanged.
3. **`src/renderer/src/screens/MinutesParts.tsx`** — in the day summary block, after the day's unanswered title and items: when `repeated.length > 0`, render the section (title + count, then one item per repeated question: ref in mono, question text, the dates it appeared, and the day count). Nothing rendered when the list is empty (spec rule 5). Theme tokens only.
4. **Catalogs** — keys added in **both** catalogs:
   - `src/shared/i18n/minutes.pt-BR.json` / `minutes.en.json`: the screen section title and the item/count wording (pluralized where the catalog uses `_one/_other`).
   - `src/shared/i18n/main.pt-BR.json` / `main.en.json`: the document section heading and item line (`word()`, as `writeDayFile` does today).
   - `prompt.sdd.turn.crossDay` (both files): the one-line note told to the turn of the day — "this decision was already left unanswered on {dates}".
5. **`src/main/sameDay.ts` / `src/main/agents.ts` (ceremony note)** — `prepareTurn` computes the card's cross-day repeats (new helper in `minutesStore`, ref+stage against `previousDayAnswers`) and the note line joins the turn prompt: inside `turn.sameDay` context (`earlierText` gains the line) and for `turn.main` via a new `{crossDay}` slot in the `turn.main` catalog templates. Scope: the prompt text only; `reusableTurn` short-circuits before the prompt, so a turn reused from an earlier day carries no cross-day note this round (limitation, stated below).
6. **`CHANGELOG.md`** — entry under `[Unreleased]`.

Doc positions, on purpose: the day document is a concatenation of version files, so the section lands as a day-level block at the end of the day file, after all "Perguntas sem resposta" of the day's versions — closest the day-shaped document gets to "after the day's unanswered". The version file itself stays untouched (a version is one ceremony; the repetition is a fact of the day).

## Tests (one per new behavior, fakes only, no network)

File `test/minutes-versions.test.ts` (pure core):
- Two days, same ref+stage, different question wording → one item, both dates, count 2 (spec criterion 1).
- Same ref across two days but stage moved → not repeated (rule 2).
- No matching ref between the two days → empty; the section is not shown for that day (criterion 2, rule 5).
- Same question-forma twice in one day, no earlier day → not repeated (criterion 3, rule 1).
- Resolved questions (absent from the previous day's `mergeDay`, or from today's merged unanswered) → not listed (criterion 4, rules 4 and 7).
- Window: only the previous days with an index, capped at 7.
- Old index without `stage` on unanswered → pairs by ref; stage falls back from `covered`.

File `test/minutes-store.test.ts` (storage + screen/document data):
- `snapshotOf` keeps the card's stage; `registerCeremony` round-trips it through the day index.
- Reading a day index written by the old shape still works and yields `stage` via `covered` or `null` (rule 8: nothing rewritten backwards).
- `dayView(date).repeated` matches the pure computation on a fixture with two days.
- `writeDayFile` writes the section only when there are repeaters, after the version parts; saving today's version does not rewrite an older day's day file (criterion 5).
- `previousDayAnswers` reads at most 7 days and skips dates without an index (`readIndex`, never `ensureDay`).

File `test/minutes.test.ts` or a prompt test: the turn prompt carries the cross-day note for a card matching a previous day, in the same-day and the fresh-card paths.

Gates also confirm the rest: `npx vitest run` (golden prompt files, if the catalogs change them, get regenerated in the same change), `npm run i18n:lint` (keys in both catalogs), `node scripts/theme-audit.mjs` (screen), `node scripts/public-audit.mjs` (no real numbers/hosts), `npx tsc --noEmit`.

## Acceptance coverage

Criteria 1–4 and 6 are covered by the tests above; criterion 5 by the writeDayFile test (old documents untouched). The visibility part of "endereçar as recorrentes" (screen + document) is covered; the ceremony note is covered by the prompt test. No acceptance criterion is left uncovered.

## Risks and containment

- **Old day indexes carry no stage.** Contained by the `covered` fallback and the ref-only pairing for `null`; test added. Data is never mutated backwards (rule 8).
- **Stage moves between days on the same activity** produce non-repeats by design (the spec's definition); the test documents it so the behavior is not read as a bug.
- **Subject = ref is model-free and misses the same theme across different activities** (e.g. the same blocker pattern named under two different activity refs). Known boundary, accepted by the spec (no model calls); the plan does not hide it.
- **Golden prompt catalogs** break when prompt keys change — updated together with the change, covered by the suite.
- **Performance:** each `dayView` opens up to 7 small index files synchronously on the main process; bounded and local, same cost class as the existing `ensureDay` calls.
- **Squads:** pairing restricts to the same squad so one squad's repetitions do not show in another's minutes; `undefined` squads pair with themselves.
- **`reusableTurn` reuse path** skips the prompt, so that turn carries no cross-day note this round; the list in the day view is unaffected and covers the insight the person acts on.

## Not verified here

The numbers the issue reports (127 unanswered in the week; 5–8 on the two example days) were never reproduced in this cycle. The 7-day window is a proposal reversible at review; the section layout inside the generated document (end of day file) is a decision of this plan and can move if review prefers it inside each version file.
