# The board, built and driven

The plan was implemented in the order `2_PLAN.md` gives, with a test for each behaviour and the
screen opened against a running app. This document says what was built, what was run, and what
is still only read.

## What was built

| Piece | File |
|---|---|
| The card, its patch and the day's mapping (pure) | `src/shared/board.ts` |
| The board file, written atomically | `src/main/board-core.ts` |
| The board of the running workspace | `src/main/boardSource.ts` |
| The six channels and their guard | `src/main/board.ts` |
| Registered and classified | `src/main/modules.ts`, `src/main/webPolicy.ts`, `src/main/index.ts`, `src/main/module.ts` |
| The day merges the board's cards | `src/main/cards.ts` |
| The screen, its channel wrapper and its place in the app | `src/renderer/src/screens/cycle/BoardScreen.tsx`, `boardApi.ts`, `App.tsx`, `Today.tsx`, `BottomNav.tsx`, `dashboard.ts`, `cycle.css` |
| The two catalogs of the screen and of the day | `src/shared/i18n/ui-cycle.*.json`, `ui-today.*.json`, `main.*.json` |

A card is `{ id, title, body, column, squad, priority, labels, repo, state, createdAt, updatedAt,
history }`, kept in `board.json` in the workspace data folder. The id is eight lower-case letters
and digits made from random bytes and **never only digits**, so it can never be read as an issue
number; the reference shown is `<repo id>#<id>`. `loadCards` reads the report as before, maps the
board's open cards and drops any whose `ref` the report already has, and the project of a board
card is the repository **id** (what the squads' scope already matches), not the `projectPath`.

## Verified by running

Every gate of this repository was run, on the whole tree:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npx vitest run` | 287 files, 4403 tests, all passed |
| `node scripts/theme-audit.mjs` | 0 |
| `npm run i18n:lint` | 0 — 4616 keys in both languages, 0 untranslated strings |
| `node scripts/public-audit.mjs` | 0 — 1223 files, nothing that belongs to a company or a person |

Five new test files, all passing:

- `test/board-store.test.ts` — a card is created whole and reads back from the file; move,
  priority, squad, comment, close and reopen each leave their line; `updatedAt` only moves when
  something changed; an unknown id and an unreadable file are refused/empty; the id is eight
  characters and never only digits; a column name is the label's text, and a label that is a key
  nobody has falls back to the name of its kind.
- `test/board-cards.test.ts` — an empty day is empty and not an error; the day carries the board's
  cards with their own reference, column and repository id; the total grows and `rest` holds what
  did not fit; a configured priority level ranks the card; a card in a blocked stage shows the
  blocked line; the last comment is the card's note; a closed card leaves the day.
- `test/board-squads.test.ts` — the squad's own label claims the card, an unclaimed card lands on
  the squad that takes what is left, the squad's cut read back by the ceremonies sees it, and a
  squad that names no label is not offered as a destination.
- `test/board-run.test.ts` — a board id is never a number, so it can never name an issue of the
  host: the runner's own reference test refuses it even with the workspace's prefix stripped.
- `test/board-policy.test.ts` — the six channels are open to a paired browser, none is desktop-only
  and none is behind the external-effects switch; they are exactly the channels the module serves;
  the module imports nothing that proposes or runs a host write, and each changing handler passes
  the external-write guard.

**The interface was opened and driven** in the app built from this tree (`electron-vite build`,
run against an empty data folder under the throwaway sandbox directory, driven over the debugging
port with the repository's Playwright). What was seen working:

1. A workspace with no integration and a cycle applied from a template: the board screen lists the
   cycle's own columns, named in the workspace's words (Triagem, Refinamento, Gate 1, Plano, Gate
   2, Implementacao, Revisao, QA, Pronto, Comunicacao).
2. A card opened on the screen itself appears on the board, with its own reference (`6vayx1g0`).
3. Moving it to another column through the screen's own select writes `moved` and the card sits in
   the new column; commenting writes `commented` with the text; closing and reopening write
   `closed` and `reopened`, and the card reads `closed` then `open` again.
4. The day, after its own refresh, lists the card — the activity count grows to 1, the card shows
   as "Implementacao · sem MR", and the empty-day invitation line is no longer shown.
5. With the running workspace switched to **test**, all five writes are refused with the reason
   (`main.workspaces.testRefusal`: "mudar um cartao do quadro nao e feito aqui").
6. With a code host configured but no token, the board is still offered — `vcsReady()` is false
   there, which is the rule the spec set ("only where no integration is usable").

## A defect found by running, and fixed

The first driver run failed with `RangeError: Maximum call stack size exceeded` on `board:list`;
the app's own error log showed `boardReady` calling itself. The dependency the last pass had
introduced was `deps: (d) => setBoardReady(() => d.boardReady())` — the module handed back its own
getter instead of the app's, so `boardAvailable()` recursed for ever. The wiring now hands the
app's `vcsReady` itself, once, at start-up:

```ts
setBoardReady(() => vcsReady());
for (const register of MODULES) register({ handle, notify, emit, job: registerJob, deps: (d) => setBoardReady(d.boardReady) });
```

The defect could not be seen by any unit test (the getter is only exercised through the running
app) and only a driven app showed it. The board screen was re-driven after the fix.

## Also fixed while passing

Three things the previous pass had left red, all in the new catalogs: a key out of alphabetical
order in `ui-cycle.*.json`, an unused key (`ui.board.card.move`), and `ui-today.*.json` keys
placed out of order. `ui-today` and `ui-cycle` now sort, and `npm run i18n:lint` is green.

## The documentation corrected

In this same change, as the plan required:

- `docs/cycles.md`, the **Priority** section in both languages: a card opened on the workspace's
  own board does not come from the tracker — it carries its own labels, the priority the board
  stored, no milestone — and priority, order and the count work the same for it.
- `docs/runner.md` and `.coxia/rules/runner.md` (English only, the rule's own language): a run
  always begins with an issue read from the host, and a card opened on the board never starts one.
- `CHANGELOG.md`, under `## [Unreleased]`: one line for the new capability.

Not touched, as the plan said: `.coxia/rules/configuration.md`, `docs/vcs-providers.md`,
`docs/configuration.md`, `.coxia/rules/code-hosts.md`, `.coxia/rules/development-cycles.md`.

## What was not verified

- **The host path (spec criteria 6 and 7) is still not exercised.** No workspace with a usable
  integration was opened, so what happens with a connected host — the same order, the day's
  photograph, what moved, what is blocked, the partial list — is a reading of the code, not
  something seen working. Criterion 7 (a host's card is never a second record) likewise.
- A workspace with a code host **and** a usable integration was never opened; what was seen is
  that a host configured without a token keeps the board, because `vcsReady()` is false there.
- The board's own screen in a paired browser was not opened: the six channels were checked through
  the policy and by a direct call on the running app's own server, not by pairing a phone.
- The refusal text was seen in the app's error channel, in Portuguese, for the five writes; the
  English wording of `main.workspaces.testRefusal` was not seen on screen.
