# How the workspace gets a board of its own

The board is the workspace's own cards. It is a file the workspace owns, a command that
changes it, and one line in the place where the cards of the day are already assembled. A
workspace with no code host stops showing an empty day; a workspace with one keeps behaving
exactly as it does today.

Everything below was read out of this tree. Nothing was run and no screen was opened.

## The shape of the change

1. **Where a card lives.** A new file of the workspace, `board.json` in the workspace data
   folder (next to `acoes.json`, `status.json`, `watchers.json`, written atomically as those are).
2. **How the cards of the day get them.** `loadCards` (`src/main/cards.ts`) merges them into
   the report it reads today.
3. **What changes them.** `src/main/board.ts` with its own channels, registered in
   `src/main/modules.ts` and classified in `src/main/webPolicy.ts`.
4. **What the person clicks.** A screen over those channels, `board:*`, and two new keys where
   Today says what the cards are.
5. **The docs that stop being true.** Two sentences in `docs/cycles.md` and `docs/runner.md`,
   and one table row in `.coxia/rules/runner.md`.

## Where a board card lives, and what it carries

The workspace data folder gets `board.json`:

```json
{
  "version": 1,
  "cards": [
    {
      "id": "k3m9x2p7",
      "title": "…",
      "body": "…",
      "column": "backlog",
      "squad": null,
      "priority": null,
      "labels": [],
      "repo": "app",
      "state": "open",
      "createdAt": "…",
      "updatedAt": "…",
      "history": [{ "at": "…", "kind": "moved", "from": "backlog", "to": "doing" }]
    }
  ]
}
```

What each field is for, and the rule the spec asks of it:

| Field | Decision |
|---|---|
| `id` | Eight lower-case letters and digits, made with `randomUUID()` the way an action id is made at `src/main/actions.ts:125`. **Not a number**, so it can never collide with a code host's reference, and it is not the project prefix either. The reference shown is `<repo id>#<id>` — `app#k3m9x2p7`, the same way a card of another project is shown today (`issueRef`, `src/main/vcs/cards.ts:87-90`), so no leading zeros and no path that looks like a host address. The path-like shape is harmless: every branch that would send it to a host ends in "nothing to do for this card" (below). |
| `column` | The id of a `devCycle.stages` stage, kept by id (not by the shown label) so it survives a language change and a template edit. The label shown is the stage's, through the same `text()` the rest of the app uses (`src/main/cyclePrompts.ts:19`), which is what makes "the columns are the stages the workspace already configured, shown in the workspace's own language" true. |
| `repo` | The repository the card belongs to, the short id of `projects.repos[].id`. The screen only offers repos that exist in the config; the card keeps mine when only one exists, and the column "whose is it" is the squad. |
| `squad` | The id of a squad, or null. |
| `priority` | The id of one of `devCycle.priority.labels`, or null — never the regular expression order, because the label's pattern is not a label. The card's `CardPriority` comes from `priorityOf([priority], levels)` (`src/main/cards.ts:83`), so the same configured level ranks it as any other card. |
| `createdAt`/`updatedAt` | ISO times. `updatedAt` is what the order uses (`compareCards`, `src/shared/priority.ts`) and what the card shows. |
| `history` | One line per change: `created`, `moved` (from, to), `priority` (from, to), `squad` (from, to), `closed`, `commented` (the text, kept for the card's own record), `edited`. Kept in the file, read back by the list and by the card's detail, and never trimmed by the app. |

**Append-only history is still open for the reviewer**: an embedded array is one story per card
and reads whole with the card; a second append-only file (`historico-cartoes.jsonl`) would let
the watchers read it as they read the external command's history. The embedded array is what
this plan builds, because nothing in this delivery reads that history, and the second half can
add the file without changing the card.

**No new config and no migration.** The file is the store and the defaults are code
constants, so this delivery does not touch `types.ts`, `defaults.ts`, `schema.ts`, `STEPS` or
`CONFIG_SCHEMA_VERSION`. The sections of the card are the workspace's data, and the project
rule that "a config change needs a migration step" is not triggered.

## How the board finds and serves its cards

`loadCards` becomes:

1. the report as it is read today (`readReport`, `src/main/report.ts`), which is empty with no
   code host;
2. plus the board cards, mapped to the `Card` shape;
3. a duplicate filter: a board card is dropped when a report item has the same `ref`;
4. `sortCards`, the `rest` count and the `total`, unchanged, so the count of the cards that did
   not fit the list grows when one is opened.

The mapping of one board card: `ref` `<repo>#<id>`, `iid` the id (so `spec` stays null:
`/^\d+$/.test(iid)` fails and no spec folder is looked for), `title`, `stage` the column's
label, `url` empty (the card's own address is its reference), `note` the last comment in its
history, `labels` its own labels, `priority` from `priorityOf([priority], levels)`,
`updatedAt` its `updatedAt`, `project` the repository **id** (the id the squad scope already
matches against: `claims`, `src/shared/squadCards.ts:26-32`). `blockers` and `changes` come
from the same helpers the report items use (`withStageBlocker`, `src/main/cards.ts:36`), so a
card in a stage the cycle counts as blocked shows the blocked line, and a board card never
carries a host's blocker text.

**The squad.** `claims` matches the labels first, which is the precedent: the squads'
`scope.labels` and the squad's own `label` are where a card with no host attaches itself, and
the board's "give it to a squad" writes the squad's own label (`label`, when it has one;
otherwise its first `scope.labels`). That label rides on the card the same way the docs flow
uses `docs/<squadId>` (`docsFlowOf`, `src/shared/config/squads.ts:69`): a name, not a host.
A squad that names no label is not offered as a destination and the screen says why. A card
nobody claims still lands on the squad that takes what is left (`unclaimed`), as any card
without a run does.

**An empty day.** `loadCards` keeps returning an empty list with no board cards
(`readReport` returns `{ generated_at: 1970-01-01…, items: [] }` and today's screens read that
as a day with no activities, `EMPTY`, `src/main/report.ts:65`). The screen adds one invitation
line **below** the existing empty list, in both catalogs: "Still nothing today — open a card on
the board" / "Ainda nada hoje — abra um cartão no quadro". The list, the count and the
ceremonies keep reading "nothing", not an error.

## The commands, and how the paired browser reaches them

`src/main/board.ts`, registered in `src/main/modules.ts` (the list is kept sorted):

| Channel | What it does |
|---|---|
| `board:list` | the board's cards, read whole |
| `board:create` | `{ title, body, column, repo?, squad?, priority? }` → the card; refuses a blank title, an unknown column or an unknown repo |
| `board:update` | `{ id, title?, body?, column?, squad?, priority?, labels? }` → the card; a `column` the board cannot back is refused with the reason, never silently moved |
| `board:comment` | `{ id, text }` |
| `board:close` | `{ id }` |
| `board:reopen` | `{ id }` |

**A write of the workspace's own data goes through the same guard as everything else that
leaves the machine.** Every one of those channels calls `assertExternalWrite` before it
writes, exactly as `gate:record` does (`src/main/gate.ts:334`; the refusal text is
`main.workspaces.testRefusal`, "Test workspace: {what} is not done here"). That blanket guard
is the cheap, reversible choice, and it is what makes the fifth acceptance criterion true.

**The open risk, and the alternative.** `isTestWorkspace()` is fail-closed on an unreadable
registry (`src/main/workspace.ts:9-11`), and a workspace rebuilt from its folders is marked
test (`rebuild`, `src/main/workspaces-core.ts:144-157`). If the board refuses writes under
that blanket rule, it refuses them in a real workspace whose registry got rebuilt. The
alternative, if the review prefers it, is the narrower reading of the spec's own words — "a
card of a board with no host is the workspace's own data, and it is refused in a test workspace
exactly as it is outside one" — with the test refusal read as "a test workspace does not run
the agents' and the ceremonies' external effects": the check moves into `board:create`/`close`
only, an open card refuses to start a run, and the spec's criterion 5 is rewritten to say
which of the six commands refuses. **The plan builds the blanket guard and no run ever starts
from a board card** (the runner reads its issues through `deps.issues`, the provider, and
nothing hands it a board card), so the spec's rule holds either way; only the strength of the
test-workspace refusal is a decision, and it is worth one line of review.

**The paired browser.** The six channels go into the existing runs-style classification in
`src/main/webPolicy.ts`: open to a paired browser, in no `DESKTOP_ONLY` set and in no
`EXTERNAL_EFFECT` set, with a test in the style of `test/runs-policy.test.ts` (every channel
served is classified; none is desktop-only; none sits behind the external-effects switch).
The guard inside the handler is what refuses a test workspace, not the web policy.

**The screen.** A lightweight screen over those channels: the columns of `devCycle.stages` as
its columns, each card a title, its reference and its squad, and the actions open, move,
comment, prioritise, give to a squad, close and reopen. It follows `SquadPicker.tsx`: the squad
name through the storage name, and every user-facing string through `t()` with the key in both
`ui-*.en.json` and `ui-*.pt-BR.json`. Two or three `ui.board.*` keys on Today (the invitation
line and the "board" word beside the refresh control) are what connects the two screens.

## How the host maps the board's columns

The decision to write down now, for the second half (nothing of it is built here):

- **By default, a column is a label on the issue**, `board:<stage id>`, and the card carries
  exactly one of them: entering a column adds its label and removes the previous one, which is
  what an issue's state has to look like on a host without a board field.
- **A host that has a real board field wins**: a `devCycle.stageMapping` rule with
  `source: 'field'` or `source: 'column'` (a GitHub Projects field, `src/shared/cycles/stages.ts:43-54`)
  maps that field to the stage before the `<stage id>` match ever runs, and the board uses it as
  its column when one is configured.
- **A workspace may write its own mapping**: a `devCycle.stageMapping` rule per stage
  (`{ provider: 'any', source: 'label', pattern: '<the label the host uses>', stage: '<id>' }`)
  wins over the default, so a project that already labels its board keeps its labels.
- The `<stage id>` match cannot fire by accident on a plain stage name: `matchStage` tests each
  `devCycle.stages[].match` pattern as a regular expression (`src/shared/config/stages.ts:7-13`,
  `24-27`), not as a literal, so the id is not read from the label's text. **Not verified at
  runtime** — this was read, not exercised.
- Board cards do not map anywhere: they are the board.

## The documentation this change makes false

Corrected in this same pull request:

1. `docs/cycles.md`, the **Priority** section, both languages: "O cartão leva o que o tracker
   diz da issue" and "The card carries what the tracker says about the issue" are no longer the
   whole truth. Add: a card opened on the board carries what the board says — its own labels,
   its own priority level out of `devCycle.priority.labels`, no milestone — and priority,
   order and the rest of the section work the same for it.
2. `docs/runner.md` and `.coxia/rules/runner.md`, the start of a run, both languages:
   "`runs:start(ref)` … O app lê a issue e os comentários pelo provedor" gains the sentence
   that a card opened on the board never starts a run — starting one still begins from an issue
   read from the code host. `docs/runner.md` is what makes `.coxia/rules/runner.md`'s summary
   false, and both move together.
3. `CHANGELOG.md` under `## [Unreleased]`: one line for the new capability.
4. Not touched: `.coxia/rules/configuration.md` (nothing new to configure),
   `docs/vcs-providers.md` ("Cards and stages" is about the host's cards and stays true),
   `.coxia/rules/code-hosts.md` (the write path is untouched), `docs/configuration.md` (no
   schema change). `.coxia/rules/development-cycles.md` may stay as it is: nothing here reads an
   agent's `stages` list, and the squad's own label lives in `configuration.md`'s squads block.

## What could go wrong

| Risk | How it is contained or checked |
|---|---|
| Today lies about a board card: it says "Atualizar de {vcsName}" and a "Status conferido às" that belong to the host. | One `ui.board.*` key beside the refresh control, shown when the workspace has no integration, and the invitation line below the empty list. Read by a test that the two catalogs agree and the key is used. |
| A board card is served to a host path — a link, a proposal, a leftover. | The runner starts only from `deps.issues` (the provider), the propose path in `loadCards` is unchanged, and the card's reference is built from the repo id and the board's own id, never from the report's prefix. |
| A board write leaves the machine because a handler reached `actions.ts`. | The channels of `board.ts` do not import `actions.ts`, and `test/runs-policy.test.ts`'s sibling — a new test over the new file — fails on `proposeVcsAction`, `proposeVcsGroup`, `proposeVcsRunPush`, `runVcsAuto`, `approveAction`, `assertExternalWrite` and `externalRefusal` outside the allowed file, exactly as that test does for the runner. |
| A card opened in a test workspace. | `assertExternalWrite` in every mutating handler; the refusal text is `main.workspaces.testRefusal`, checked by a unit test. Not verified in a running app. |
| A board card of a workspace with a host shows as a second record. | A board with a host is not offered: the feature is read and written only where `vcsReady()` is false (spec rule 6). Read, not exercised — criterion 7 stays marked **not verified**. |
| A column that no stage backs is offered as a destination. | `board:update` refuses an unknown column with a reason, and the screen offers only the stages of `devCycle.stages`. |
| The columns are shown as raw catalog keys. | The screen goes through the same `cycleText`/`text()` as the rest of the app; the test of the check is a rendered screen. |
| The `i18n` pair rule (a variant paired with its plain wording) trips on the "no integration" keys. | The new keys are plain `ui.board.*` keys, not variants; the pair test only looks at `.{on-*,off-*}`, `.{on-*.off-*}` and `.{novoice}` suffixes. |

## How this gets tested

**What will be run by the developer and by the QA** (the gates of this repository):

```bash
npx tsc --noEmit
npx vitest run
node scripts/theme-audit.mjs
npm run i18n:lint
node scripts/public-audit.mjs
```

**Pure tests, no disk and no network** (`test/board-store.test.ts`): create, move, comment,
prioritise, give to a squad, close and reopen change only that card; a blank title, an unknown
column and an unknown repo are refused with a reason; the history records each change; a file
written and read back is the same board.

**Board plus the day's report** (`test/board-cards.test.ts`, in the style of
`test/card-scope-report.test.ts` with its own `CERIMONIAS_DATA_DIR`): with the workspace
pointed at a data folder with no integration, `loadCards` returns the board's cards, `total`
grows when one is opened, a card whose `ref` the report already has is not duplicated, the
priority level out of `devCycle.priority.labels` ranks the card, and a card in a blocked stage
shows the blocked line.

**The squad cut** (`test/board-squads.test.ts`): a board card with the squad's own label is in
that squad's cards and in no other's; an unclaimed card lands on the squad that takes what is
left.

**The run never starts from a board card**: `runs:start` with a board card's reference is
refused (`refOf`, `src/main/runner/service.ts:764`, and `deps.issues.get` for a non-numeric
ref), asserted in a test.

**The door and the policy**: a new policy test over `src/main/board.ts` (nothing that proposes
or runs a host write, `assertExternalWrite` only where it belongs) and the `webPolicy.ts` test
for the six new channels.

**The interface, once the screens exist**: the screen is opened against a dev server started in
the background on `127.0.0.1` on a free port, with `CERIMONIAS_DATA_DIR` pointed at an empty
folder under a throwaway directory of the machine and a fresh Playwright profile, never the
person's own data folder. The scenarios are the five criteria that this delivery claims (open a
card and see it; move, comment, prioritise, give to a squad and close; the card's own address
and no host action; the day and the count including it; a test workspace refusing), plus the
two guards, which stay **not verified here** — with a host connected nothing was opened in this
stage, so the host path is reported as read, never as exercised.

## What was not verified

- No command was run and no screen was opened: every statement about behaviour is a reading of
  the code named beside it.
- The counts that need a running app — the card in Today, the count of the cards that did not
  fit, the refusal text on screen — were not seen. They are what the QA has to exercise.
- The host path (a workspace with a code host: the same order, the same photograph, what moved,
  what is blocked, the partial list) was read, never exercised.
- The decision to accept the spec's "one board, not two" for a board with no host is the
  product owner's, taken in the spec this plan follows; nothing here reopens it.
