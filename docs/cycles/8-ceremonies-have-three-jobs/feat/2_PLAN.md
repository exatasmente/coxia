# #8 Ceremonies have three jobs — technical plan

Scope: section "What this issue delivers §1" of [`1_SPEC.md`](1_SPEC.md). The "move out" items (§2) are not touched. Evidence for today's code is in [`AUDIT.md`](AUDIT.md).

## What gets built

| # | Feature | Where it lands |
|---|---|---|
| 1 | The card shows its priority | `Card` carries labels, milestone, `updatedAt`, issue project and a derived `priority`; `devCycle.priority` config; shown in Today and in the call; read by the turn agent |
| 2 | One order everywhere | one comparator in `src/shared/priority.ts` used by the card loader (call agenda) and by Today |
| 3 | Nothing dropped silently | `CardsResult.rest` holds the cards past the call limit; the call says how many and lists them with a control to bring one in |
| 4 | Readjust priority in the call | optional `prioridade` in the reply schema, a priority `Decision`, shown back in the call |
| 5 | Persist as a proposal | `saveMinutes` turns each priority decision into a `setIssueLabels` proposal through `proposeVcsCommands` |

## Data

### Card (`src/shared/types.ts`)

New optional fields (optional because a ceremony saved before this change holds cards without them):

```ts
export interface CardPriority { rank: number; label: string }   // rank 0 is the highest configured level
Card.labels?: string[]
Card.milestone?: string | null
Card.updatedAt?: string | null     // ISO, from the VCS issue
Card.project?: string              // the issue's project, needed to write a label
Card.priority?: CardPriority | null
```

`CardsResult` gets `rest?: Card[]`: the cards beyond the limit, already ordered.

`Decision.target` gains `'priority'`; `Decision` gains an optional `priority?: PriorityChange` (what to write: `to`, `from`, `label`, `add`, `remove`, `noWrite` with the reason when nothing is written, `project`, `iid`, `title`). A priority decision rides the existing decision list (call panel, minutes, selection in the minutes screen, version snapshots) instead of a parallel list.

### Plumbing from the tracker

- `CardItem` (`src/main/vcs/cards.ts`) adds `milestone` and `updated_at` (`labels` is already there).
- `ReportItem` (`src/main/report.ts`) adds optional `labels`, `milestone`, `updated_at`; an external card-source command may emit them too, without them the card simply has no priority.
- `loadCards` (`src/main/cards.ts`) copies them into the `Card` and derives `priority`.

## Config

`devCycle.priority = { labels: string[] }`, neutral default `{ labels: [] }`.

- Each entry is a case-insensitive regular expression tested against the issue's labels, **highest priority first**, the same matcher style as `StageDef.match` and `stageMapping.pattern`. The card's priority is the first entry that matches any label; `rank` is the entry's index, `label` is the label that matched.
- To **write** a priority the entry must be a literal label name: after stripping a leading `^` and a trailing `$`, it has no regex metacharacter. A pattern entry still ranks cards, but "move to this level" cannot be written; the decision then stays in the minutes with a line saying why.
- Schema: `devCycle.priority.labels`, at most 20 items, strings. `semantic()` in `validate.ts` rejects an entry that is not a valid regular expression and warns about a duplicate entry.
- `CARD_FIELDS` (the fields the turn agent may see) gains `priority` and `milestone`. `labels`, `updatedAt` and `project` are not shown to the agent (noise).

### Migration: schema 2 → 3

`CONFIG_SCHEMA_VERSION` goes to 3 and `STEPS[2] = v2ToV3` is added in `src/shared/config/migrations.ts`:

- sets `devCycle.priority = { labels: [] }` when absent;
- appends `priority` and `milestone` to `devCycle.enrichment.cardFields` when that list exists and lacks them. This is the reason for a real bump: a stored v2 file lists its card fields explicitly, so without a step an existing workspace would never show the agent the new fields;
- leaves a document with no `devCycle` alone (defaults complete it);
- is idempotent, never reads the disk, and sets `schemaVersion: 3`.

`v1ToV2` is unchanged (its base is the neutral config, which is already v3-shaped, and the next step runs on its result). Tests in `test/config-migrations.test.ts`: v2 file without the new fields becomes v3 with them; a customised `cardFields` keeps the person's choices and gains the two; a v1 file ends at 3; a v3 file is untouched; `validateConfig` accepts the result. Every place that asserts `schemaVersion` 2 changes to 3. `docs/configuration.md` says v3.

A v3 file opened by the previous app is refused ("written by a newer app"), which is the intended behavior of the bump.

## Order

`src/shared/priority.ts` (pure, no Electron):

- `priorityOf(labels, entries)`: derive `CardPriority | null`.
- `compareCards(a, b)`: blocked first; then priority rank, `null` last; then `updatedAt` newest first (missing last); otherwise `0`. No `ref` tie-break, and the sort is stable so equal cards keep their incoming order.
- `sortCards(cards)`: stable sort by it, never mutating.
- label helpers for the write: `literalLabel(entry)`, `priorityLevels(entries)`.
- `resolvePriority(card, to, entries)`: maps the reply's `to` (`"first"`, `"later"` or a configured label) to what must be written, or to the reason it is not written.
- `agendaOrder(cards, marks)` and `bringIntoAgenda(result, ref, callIdx)` live in `src/shared/sameDay.ts` next to `orderAgenda`.

Call: `loadCards` sorts with `compareCards`, cuts at the limit, `agenda()` (same-day `orderAgenda`) keeps working on top (a card nothing happened to, and that is not blocked, goes last).
Today: `sortByUrgency`/`urgencyRank` are removed. The loader hands the ceremony its cards through `sortCards` and `agendaOrder`, and Today lists `ceremony.cards` as they are, so both screens show the same array in the same order by construction. A status check re-orders the agenda with `agendaOrder` until the call has started.

Today's urgency groups (waiting for an answer, back from QA, close to QA) contradict the spec's order (blocked, then priority, then update), so they are dropped from the sort. The "asking" filter and the needs list still surface questions. `stageUrgency` stays in `src/shared/cycles/stages.ts` (it is public, tested against the original ranking) but no screen uses it for ordering any more.

## The call and its prompts

- **Reply schema** (`agents.reply`): `prioridade: null | { para: enum }` where `para` is `first`, `later` or one of the literal configured labels (the enum is built per call, so the model cannot invent a label). The key is Portuguese like its siblings (`decisao`, `efeito`); the values are stable English tokens like `alvo`'s.
- **Prompt text**: one new line in `prompt.sdd.reply.main` (`{priorityRule}`), with the wording for "this one goes first", "leave #12 for next week", "raise #7"; with labels configured the line lists them in order and says the card's current one; without labels it only offers `first` and `later`. One new line `{priorityLine}` in `prompt.sdd.turn.main` and `turn.sameDay` that is empty (so the line disappears) unless the card has a priority or milestone, so a card without them produces byte-identical turn prompts. Text in both catalogs. None of these strings mentions the "call", so no `.novoice` variants are needed.
- **Resolution** happens in main when the reply arrives (`src/main/priority.ts`): `first` is the first configured level, `later` the last one, a label is itself; `from` is the card's current priority label; `remove` is every label of the issue that matches any level, except the new one; `add` is the new label. The result is a `Decision` with `target: 'priority'`, a readable `text` and a `dest` that already says where it goes ("Actions, as a label proposal" or "minutes only, not written to the tracker: <reason>"), so the minutes file carries the line.
- **Shown back**: `ReplyResult.priority` is added to the decision list (the decisions panel, the minutes) and shown as a note under the card before the person moves on.
- Reordering the remaining agenda from a priority decision is **not** done: the decision is about the tracker's priority, not about the order of this meeting.

## Left out of the call

`loadCards` returns `rest` (ordered) and the existing `total`. The call:

- says it in the moderator's opening line (only when N > 0), in the end-of-agenda panel and in the agenda column, after the queue: a "Left out (N)" list with a button per card, "Bring in";
- bringing one in moves it from `rest` to `cards` right after the card in progress (before the call starts: at the end), so nothing already visited shifts;
- Today shows how many are outside the agenda (`total - cards.length`).

`SavedCeremony.cards` is a `CardsResult`, so `rest` is saved with the ceremony and a resumed call still lists them. A ceremony saved before this has no `rest` and shows nothing.

## Persisting

`saveMinutes` (`src/main/store.ts`) handles a decision with `target: 'priority'`:

1. `noWrite` is set (no priority labels configured, the level is a pattern, nothing to change, Bitbucket, no issue identified): record `ok: true`, nothing proposed, no refusal either. The minutes already say why through `dest`.
2. Otherwise the existing `externalRefusal` guard runs first (a test workspace refuses), then `planWrite({ op: 'setIssueLabels', project, iid, add, remove })` and `proposeVcsCommands` with key `priority:<ref>:<label>:<day>`. A `VcsError` `unsupported` (Bitbucket) is caught and recorded as "not created". A duplicate proposal is reported as already waiting.
3. Approval is the unchanged path: Actions screen, per-action "yes", `approveAction` (which has its own `assertExternalWrite`), audit log.

## Order of commits

1. `feat: add the technical plan for ceremony priority #8` (this file, alone)
2. `feat: show the tracker priority and milestone on the card #8`: `devCycle.priority`, the schema 3 migration, validation, `Card.priority`, the card on Today and in the call, the turn line (config tests, card tests, prompt goldens untouched for cards without priority)
3. `feat: list today and the call in one order #8`
4. `feat: say which cards were left out of the call #8`
5. `feat: let the person readjust priority in the call #8`: schema, prompt, decision, goldens regenerated for `reply.main` only
6. `feat: propose a label change for each priority decision #8`
7. `feat: add the test plan for ceremony priority #8`; docs (`configuration.md`, `cycles.md`, `CHANGELOG.md`) travel in the commit of the feature they describe.

## Test plan

- `test/priority.test.ts`: `priorityOf` (order, case, no match, invalid entry), `compareCards` (the three keys, nulls last, no ref tie-break, stable), `literalLabel`, `resolvePriorityChange` (first, later, a label, current already there, no labels, a pattern level).
- `test/config-migrations.test.ts`, `test/config-schema.test.ts`: the 2 → 3 step, defaults, schema/type parity, invalid regex refused.
- `test/vcs-cards.test.ts`: labels, milestone and `updated_at` reach the item. `test/worktrees-cards.test.ts`: the comparator replaces the old one.
- `test/dashboard.test.ts`: Today's order equals the call's for the same cards, including blocked, priority and update time.
- `loadCards` test: cap, `rest`, `total`.
- Reply flow with the fake engine: the `prioridade` field, with and without labels; prompts golden parity (`test/cycle-parity*.test.ts`, `test/cycle-prompts.test.ts`) regenerated with `UPDATE_GOLDEN=1` only for `reply.main`.
- `test/minutes-store.test.ts`: the proposal for a priority decision (command, key, kept labels), minutes-only with no labels, Bitbucket, test workspace refusal, duplicate.
- `test/i18n.test.ts` / `npm run i18n:lint`: key parity.
- Gates: `tsc`, `vitest`, `theme-audit`, `i18n:lint`, `public-audit`, `electron-vite build`.

## Risks

- **Prompt goldens**: the reply prompt changes on purpose; the turn prompts must not. The conditional `{priorityLine}` and the omission of a null `priority`/`milestone` from the card JSON exist for that.
- **Saved ceremonies**: new `Card`, `CardsResult` and `Decision` fields are optional; a ceremony saved before the change loads and behaves as before.
- **Priority drift between meetings**: the same-day fingerprint (`src/main/falas-core.ts`) does not include the priority, so a card whose label changed after a meeting still reads as "unchanged" in the next one. Not in the spec; named here so it is not forgotten.
- **Label write on GitHub is several calls** (one add, one delete per removed label): each is its own action, as for every other label write.
- **A downgrade** to an app that only knows schema 2 is refused by design.
- **Card sources**: a card source command that does not emit labels never yields a priority; the decision is still recorded in the minutes.

## Decision log

1. **Schema 3, not an additive field.** Optional additions to `devCycle` have been made without a bump before, but a stored v2 file lists `enrichment.cardFields` explicitly, so only a migration step can offer the agents the new `priority` and `milestone`. The step is idempotent and keeps what the person chose.
2. **Level syntax.** Entries are regular expressions like `StageDef.match` (reuse of the matcher style). Since writing needs a label name, an entry that is a plain name (optionally `^...$`) is writable and a pattern only ranks; `first`/`later` that land on a pattern are "not written, with the reason". Alternative rejected: exact names only, which would not match the stage matchers the spec points to.
3. **A priority decision is a `Decision` with `target: 'priority'`**, not a parallel list: it reuses the call's decisions panel, the minutes, the selection checkboxes of the minutes screen, the version snapshots and the day view with no new screen. Cost: a fourth target value; `destination()` and the dedupe in `saveMinutes` know it.
4. **"Priority, not milestone" ordering.** The milestone is context only (shown, given to the agent), never in the comparator, as the spec says.
5. **Today's urgency bands are dropped.** Pending question, back from QA and close to QA contradict "blocked, then priority, then last update", so by the lead's rule the spec wins. `stageUrgency` stays exported (public, tested against the original ranking); nothing orders by it. "Pending items" is also out of the comparator (the old call order had it; the spec's order does not).
6. **Today does not sort again.** It lists the agenda array the call follows, which makes "same cards, same order" true by construction, including for a ceremony resumed from disk that was ordered before this change. A status check re-orders only until the call starts.
7. **`updatedAt` is the issue's**, not the latest of its MRs, as the spec says ("from the VCS issue").
8. **Bring-in position.** A card brought in from the left out list joins right after the one in progress (at the end before the call starts). Nothing already visited shifts; the alternative (always at the end) would make "I want to talk about this one" wait the whole call.
9. **No reordering from a priority decision.** "This one goes first" changes the tracker's priority (the third job), not the order of this meeting.
10. **Reply field.** `prioridade: { para }` with `para` in `first | later | <configured label>`, built per call as an enum. "Raise" and "lower" are mapped by the agent from the card's current label (it is given the list and the current one), so the code needs no relative moves. The values are English tokens like the existing `alvo`.
11. **Refusal in a test workspace** happens at save (the existing `externalRefusal`, as for plan and note writes) and again at approval (the existing guard in `approveAction`). A decision that cannot be written has nothing to refuse and is not refused. Proposal key: `priority:<card>:<label>:<day>`, so a later day can propose the same change again after a skip or a revert.
12. **"A tracker without priority labels"** is read as "a workspace with no `devCycle.priority.labels`". Bitbucket is a separate reason (`unsupported`) because its label write is unsupported, as the spec's out-of-scope says.
13. **Applying a cycle template keeps the priority labels** when the template names none, and exporting a template leaves them out: they are the team's tracker conventions, like the QA account.
14. **Not done on purpose:** the same-day fingerprint (`falas-core.ts`) does not include the priority (a label changed between two meetings of a day still reads as "unchanged"); no Settings or wizard screen edits the priority labels (they live in `config.json` and the imported file, like `quickTransitions`).
