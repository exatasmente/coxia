# How the board follows the code host

The board of phase 1 stays what it is: a file the workspace owns, six channels, a screen. Phase 2 adds a **door** beside it (the only board file that may reach the host), a **read** of the host (the open issues of the workspace's projects, shown on the board with no local copy, and the issues of the cards the board opened, read by number), a **link** on the card, a **label vocabulary** for columns, one **new write** (reopen) and one **new setting** (the board's autonomy, schema 19), and **Send all**. The day's cards are not changed.

Everything below was read out of this tree (release 0.8.0). Nothing was run and no screen was opened.

## What is built

| # | Feature | Where it falls |
|---|---|---|
| 1 | `reopenIssue`, a write on the three hosts | `src/main/vcs/types.ts:219-220` (a new member of `VcsWriteOp`), `planWrite` of `github.ts:586`, `gitlab.ts:543`, `bitbucket.ts:487`; the validators already accept the shapes (below) |
| 2 | The board's own autonomy, schema 19 | `src/shared/config/types.ts` (`WorkspaceAutonomy`, `RunnerConfig.autonomy`, version), `defaults.ts:32-37`, `schema.ts:158-170,500`, `migrations.ts` (`v18ToV19`), `autonomy.ts` (`boardAutonomous`), `RunnerSection.tsx:209-220`, `runnerEdit.ts:33-34,60,79`, `ui-team.*.json` |
| 3 | The label vocabulary of a column, both ways | new `src/shared/boardHost.ts` (pure), one new step in `stageOf` (`src/main/vcs/stages.ts:72-81`) |
| 4 | The link between a card and its issue, and the mirror | `src/shared/board.ts` (fields, `mirrorOf`), `src/main/board-core.ts` (`link`, `note`, `mirror`) |
| 5 | The read of tracked issues, and the day's merge | new `src/main/vcs/boardRead.ts` (`readTracked`), `src/main/vcs/cards.ts` (two exports), `src/main/cards.ts:88-94` |
| 5b | The read of the project's issues, for the board only | `src/main/vcs/boardRead.ts` (`readProjects`), `workspaceProjects` exported from `src/main/vcs/cardSource.ts:30-35`, `src/shared/board.ts` (`BoardItem`, `BoardTarget`) |
| 6 | The board's door and the host paths of the handlers | new `src/main/boardHost.ts`, `src/main/board.ts` (a port, targets, `board:send`, `board:sendAll`, async handlers), `src/main/index.ts:288-292`, `src/main/module.ts:20-21`, the comment of `src/main/webPolicy.ts:31-32` |
| 7 | The screen | `BoardScreen.tsx` (host items, "No column", limits, Send all), `boardApi.ts`, `Today.tsx:202-208` (a mark on a card), `ui-cycle.*`, `ui-today.*`, `main.*` catalogs |
| 8 | The documentation made false | listed at the end of this section |

### 1. `reopenIssue`

A new member of `VcsWriteOp`, next to `closeIssue`: `{ op: 'reopenIssue'; project: string; iid: number }`. What each provider plans:

| Host | Command | Already accepted by the validator? |
|---|---|---|
| GitHub | `PATCH repos/{o}/{r}/issues/{n}` with `{ "state": "open" }` | yes: the rule for that address lists `state`, and the check accepts `open` and `closed` (`github.ts`, `WRITES` and the `state` test in `validateGitHubCommand`) |
| GitLab | `PUT projects/{id}/issues/{iid}` with the field `state_event=reopen` | yes: a `PUT` under `projects/` with no field rule is judged by its address (`gitlab.ts`, `FIELD_RULES` has none for it); the same as `state_event=close` today |
| Bitbucket | `PUT repositories/{w}/{r}/issues/{id}` with `{ "state": "open" }` | yes: the rule lists `state` and `ISSUE_STATES` has `open` (`bitbucket.ts:35,565`) |

`checkIid` guards the number like `closeIssue`. It is **not** a reuse of `setIssueStatus`, whose meaning differs per host (a numeric custom status on GitLab, a state word on Bitbucket, only open or closed on GitHub). Decision log, D8.

### 2. The board's autonomy

See "Configuration and migration".

### 3. The label vocabulary (`src/shared/boardHost.ts`, pure)

No I/O, no host call. Everything the door and the read side need to agree on:

- `BOARD_LABEL_PREFIX = 'board:'` and `stageLabel(id) = 'board:' + id`.
- `stageOfBoardLabel(labels, stages)`: the stage whose id makes one of the labels exactly `board:<id>` (case-insensitive); with several, the one with the highest `rank`.
- `ruleLabel(cfg, kind, stageId)`: the label a **mapping rule** can write for the stage, or null. A rule counts when `source === 'label'`, its `provider` is `any` or the host's kind, its `stage` is that stage, and its pattern is a plain name by the **existing** test `literalLabel` (`src/shared/priority.ts:48-56`: optional `^` and `$`, no other regex character) and is accepted by `checkLabel` (no comma, no line break, at most 200). First rule in the order written wins, as on the read side. Rules over `status`, `state`, `field` or `column` are never written (below).
- `readsAs(cfg, kind, label)`: the stage a label reads back as, using the same order as the read side (`mapStageByRules`, then `stageOfBoardLabel`; not the free-text patterns).
- `writtenLabel(cfg, kind, stageId)` returns one of `{ label, by: 'mapping' }`, `{ label: 'board:<id>', by: 'default', why }` or `{ refused: 'shadowed', rule }`. The mapping's label is used only if `readsAs` gives the same stage back; otherwise the default is tried with the same check; if a mapping rule also claims `board:<id>` for another stage, the move is **refused** with the rule named. `why` is `no-rule` or `unwritable-rule` (a rule exists for the stage but over a field, column, status or state, or a regular expression, or one that does not read back); the screen says which label was written when it is not the mapping's.
- `ownStageLabels(cfg, kind)`: every label the app could have written for **any** stage: `board:<id>` for each stage plus the plain label of each label rule for this host (not only the first rule per stage). This is the **only** set a column change may remove.
- `moveLabels(cfg, kind, issueLabels, toStage)`: `add` = the written label if the issue does not carry it; `remove` = every label of `ownStageLabels` the issue carries (compared case-insensitively) except the written one. Nothing else is ever in `remove`.
- `cardLabelChanges(old, next, ctx)`: priority and squad. `add` the new level's plain label (`boardPriorities`) and the new squad's `squadLabel`; `remove` the previous ones **only when the issue carries them**. Both sets are labels the board itself wrote.
- `issueLabelsOfCard(cfg, kind, card)`: what a new issue is born with: the written label of the column, `card.labels` (which already hold the squad's label), the priority level's label, deduplicated.
- `issueBodyOf(card, heading)`: the card's body, then, when the card has comments in its history, the heading `heading` (the catalog text `main.board.host.notesSoFar`) and one line per comment.
- `issueRefOfAnswer(answer)`: `{ iid, url }` from what a host answers to a creation: `number`/`iid`/`id` and `html_url`/`web_url`/`links.html.href`. A copy of what the runner reads (`runner/publish.ts:229-243`) on purpose: the board must not import the runner.
- `sameIssue(link, item)`: `iid` equal and, when both sides are paths, the project equal ignoring case.

**The read side** gets one step in `stageOf` (`src/main/vcs/stages.ts:72-81`), between the rules and the free-text patterns: `stageOfBoardLabel(issue.labels, stages)`. A workspace that never used the board has no `board:` label, so nothing changes for it; one that has the label gets the stage written.

**Not written in this phase, and said so:** `source: 'status'` (GitLab's custom status needs the numeric id of a status, which the rule's name does not give; `setIssueStatus` exists for it and `/^\d+$/` is checked at `gitlab.ts:517`), `source: 'state'` (closing is the card's own state, written by close and reopen, not by a column), `source: 'field'` and `source: 'column'` (a GitHub Projects v2 field: no write exists and the read of issues does not fill `fields` or `column` either, `stageOf` passes only labels, status and state). A move into a stage mapped only that way writes the default label.

### 4. The link and the mirror

See "Data".

### 5. The read of tracked issues (`src/main/vcs/boardRead.ts`)

```text
readTracked(refresh: boolean): Promise<TrackedRead | null>   // null: no usable host
```

1. `vcsReady()` false: return null, read nothing.
2. The cards to track: every card of `boardStore().list()` with a `host` link and either `state === 'open'` or `updatedAt` in the last 7 days (`TRACKED_RECENT_DAYS`), at most 50 (`TRACKED_MAX`), newest update first; the rest keep their stored copy.
3. A cache of five minutes (`REPORT_TTL_MS`, `src/main/report.ts:43`), keyed by the tracked set and the host's id; `refresh` skips it; a write the door just made clears it, and calls `invalidateReport()` (`report.ts`) so the listing is read again too.
4. Each tracked issue is read with `provider.getIssue(link.project, link.iid)` in a pool of four (`pool`, `vcs/util.ts`, already used by `cards.ts:150`). `not_found` gives `missing`; any other failure gives `unread` (the stored copy stays, the screen says the host was not read).
5. For an issue that is open it builds a **report item** with the same function the listing uses: lines 172-188 of `vcs/cards.ts` move into an exported `issueCardItem(issue, stage, ref)` (the listing calls it with the `changes` it computes; the tracked read calls it with none), and `issueRef` (`cards.ts:87-90`) is exported. The stage comes from `stageOf` with the workspace's stages and mapping, so a card moved on the host reads the same here and in the listing.
6. It returns `{ at, items, seen }` where `items` are the open tracked issues as report items and `seen` is, per card id, `{ state: 'open' | 'closed' | 'missing' | 'unread', title, labels, stageId, updatedAt, url }`.

#### The project's issues (`readProjects`), for the board only

```text
readProjects(refresh: boolean): Promise<ProjectsRead | null>   // null: no usable host
```

1. `vcsReady()` false, or `provider.caps.issues` false: null, nothing read.
2. The projects: `workspaceProjects(provider.id, issueProject)` (`cardSource.ts:30-35`, exported: the repositories of this integration, by `projectPath` or derived from `remoteUrl`, plus the issue project), deduplicated ignoring case, **the first 10** (`BOARD_PROJECTS_MAX`). A workspace that names none reads nothing and the board says there is no project to list.
3. Each project, in a pool of three (`pool`, `vcs/util.ts`), with `provider.listIssues({ project, scope: 'all', limit: 100 })` (`BOARD_ISSUES_PER_PROJECT`). The paging is the provider's own and is not rewritten: GitHub's search gives at most two pages, GitLab asks `ceil(limit/100)` pages and one more read of statuses per project (`gitlab.ts:263-271,288-300`), Bitbucket two pages and an empty list for a tracker that is off (`bitbucket.ts:264-275`). The most recently updated come first. A result that reaches the limit is flagged `truncated`.
4. One project that fails does not fail the read: its entry carries the reason (`error`) and the others stay.
5. Each listed issue that no card of the board is linked to (`sameIssue`) becomes a **`BoardItem`**, derived and never stored: `{ key: '<project>#<iid>', project, iid, title, column, labels, url, updatedAt, priority, squad }`. `column` is `stageOf(issue, [], stages, mapping, kind)?.id` with the workspace's stages (`stagesFor`, `vcs/stages.ts:41`), so the mapping rules, the `board:<id>` label and the patterns decide, as for any host card; the board does not read merge requests, so the fallback "what the merge requests imply" is always the backlog kind. `priority` and `squad` come from the issue's labels by the same `derivedFields(labels, ctx)` that `mirrorOf` uses. `null` column means "No column".
6. The listed issues that **are** linked to a card are handed to `readTracked` as already read, so they cost no read by number.
7. A cache of five minutes, keyed by the host's id and the project set; `refresh` skips it; a write the door made clears it (and the tracked cache), so a closed issue does not linger for the length of the cache. The listing is **never** read by `loadCards`, by a ceremony, or by anything on a clock.

`readTracked(refresh, listed?)` is the read described above, now taking the issues `readProjects` already listed.

`loadCards` (`src/main/cards.ts:54-97`) becomes:

1. `readReport` as today (the listing, or a card source command).
2. `readTracked(refresh)` (never `readProjects`: the day's volume and scope do not change); `items` of the tracked read that the listing does not already hold (`sameIssue`) are appended to the report's items **before** the card building loop, so merge requests, specs, blockers, priority and the stage text go through the code that exists. A tracked issue that is also in the listing is one card: the listing's.
3. `mirror(seen)` (below) is applied to the board file.
4. The board cards of phase 1 (`boardCards()`, `cards.ts:90`) are merged by this rule, replacing the `ref` filter of line 93: a board card with a `host` link is **never** a second card (the tracked or listed item stands for it); a board card without one is added as today. A card with a link whose seen state is `missing` or `unread` and that has no item is added from its stored copy, flagged.
5. Each resulting `Card` that stands for a board card gets `board: { id, host }` (the new optional field), where `host` is `'linked' | 'notSent' | 'waiting' | 'missing' | 'unread'`. `sortCards`, `rest` and `total` are unchanged, so the count of cards that did not fit counts a linked card once.

The `externalTools.cardSource` command keeps producing the listing; the tracked read goes through the provider whatever produced the listing, so the board mirrors the host with a command source too.

### 6. The board's door (`src/main/boardHost.ts`)

The same arrangement as the runner's (`src/main/runner/door.ts:1-31`): one file that imports Actions and the host, and nothing else of the board does.

**The port**, declared in `board.ts` (so `board.ts` never imports `./vcs` or `./actions`; `test/board-policy.test.ts` keeps its walk):

```ts
export interface BoardHost {
  ready(): boolean;                                   // vcsReady()
  name(): string | null;                              // the host's name for the screen
  labels(): boolean;                                  // the host's issues have labels (caps.issueLabels)
  cannotSend(): string | null;                        // why a card cannot become an issue now (no issue project, no issue tracker), else null
  read(refresh: boolean): Promise<HostRead | null>;   // the project listing and the tracked issues, in one answer for the board
  send(change: HostChange): Promise<HostSent>;        // plan, then run or propose by the autonomy; throws a person-readable reason
  waiting(): Map<string, Waiting>;                    // what waits in Actions, by card id
  onSettled(fn: (e: Settled) => void): void;          // a proposal of a card was carried out or set aside
}
```

`HostChange` is one of `create`, `labels` (a column move, priority and squad merged into one command set), `comment`, `close`, `reopen`; each carries a **target**, either a card or `{ project, iid }` of a listed issue, and, for a card, what the local copy becomes once the host has it (`effect`). A listed issue has no `effect`: nothing is written locally and the next read shows the result. `HostSent` is `{ mode: 'ran', link?: BoardHostLink, summary } | { mode: 'proposed', actionId, summary }`. `Waiting` is `{ kinds: string[]; failed: boolean; actionId: string }`, keyed by card id or by `<project>#<iid>`. The port also has `sendAll(cards, batch)` (below).

`setBoardHost(host)` replaces `setBoardReady`; its default is an inert host (`ready()` false), so a test or a phase-1 run without the wiring behaves as phase 1. `index.ts:288-292` calls `setBoardHost(realBoardHost)` before the module loop and drops the `deps` argument; `ModuleContext.deps` (`module.ts:20-21`) and the `ctx.deps?.(…)` call (`board.ts:107`) are removed. This also removes the getter-handed-back-to-the-module shape that caused the recursion in phase 1.

**`send`** in `boardHost.ts`:

1. `assertExternalWrite` is not repeated here: the handler of `board.ts` already refused a test workspace before it reached the port. The door's own `audited` and `approveAction` check again (`actions.ts:501,543`), so a proposal approved after the workspace became a test one is refused too.
2. It plans with the provider of the primary integration (`vcsProvider()`), reading the issue first when the command needs its labels (`getIssue`; for a listed issue the squad and priority it has now are derived from those labels, so nothing local is consulted): `create` → `createIssue` with `issueLabelsOfCard`, the title and `issueBodyOf`; `labels` → `setIssueLabels` with the add and remove sets of `moveLabels` and `cardLabelChanges`; `comment` → `commentIssue`; `close` → `closeIssue`; `reopen` → `reopenIssue`. The project is the issue project, `issueProjectKey()` (`workspaceConfig.ts:155`), for a card being created, and the target's own project for a listed issue and for a linked card. On a host with no issue labels a `labels` change on a listed issue is refused with a reason (there is no local card to keep the column), where for a card it stays local.
3. If the plan has no command (`setIssueLabels` with nothing to add or remove), nothing is sent and the local copy is changed at once.
4. With `boardAutonomous(getConfig())` on: each command goes through `runVcsAuto` (`actions.ts:531`) with `{ issue: iid, key: 'board:<card id>:<op>:<hash>', summary, by: 'board', bodyHash }`: validated, executed, one audit line each, a test workspace refused. The answers are collected; `create` reads `issueRefOfAnswer(answers[0])`.
5. With it off: `proposeVcsGroup` (`actions.ts:209`) with the same key and `unit: { purpose: 'board-<op>', cardId, effect }`, a summary the person reads, and a notification (`getSettings().notifications` decides, as for the runner's). One group is one "yes". `issue` is the issue number, or 0 for a creation (the release run registers its tracking issue the same way, `publish.ts:1451-1457`).
6. A second `labels` or `close`/`reopen` proposal for a target while one of its kind waits is refused with a reason (keys `board:<card id>:…` or `board:host:<project>#<iid>:…`); comments do not block each other.

**Listeners**, registered once by `startBoardHost()` (called beside `setBoardHost`): `onActionDone(fn)` (`actions.ts:241`) and `onActionSkipped(fn)` (`actions.ts:634`). Each ignores an action whose `unit.purpose` does not start with `board-` (the runner's listener does the same by `runId`, `publish.ts:1044-1055`, so the two do not meet). On `done`: `create` links the card from the answer, the others apply `unit.effect` to the card and add the history line; then `board:changed`. On `skipped`: a `board-create` leaves `hostNote { kind: 'declined' }` on the card; the others change nothing. A proposal that **fails** at approval has no listener (`actions.ts:547-620`); the board derives it from the list of actions, so the card says "failed in Actions".

**Send all** (`board:sendAll`, the eighth channel). After the handler's guard and the same `cannotSend()` check as `board:send`, it takes the open cards that have no link, no waiting creation and none in flight, oldest first, at most 50 (`SEND_ALL_MAX`; the answer says how many remain). Then, per card, exactly the last step of `board:send`:

- **Autonomy on:** the cards go one after the other (never in parallel: the audit stays in order and a host's rate limit is not hit by a burst); each success links the card, each failure leaves its `hostNote` and **does not stop the rest**. The answer is `{ sent, failed: [{ id, reason }], remaining }`.
- **Autonomy off:** **one proposal per card**, key `board:<card id>:create`, all with the same `unit.batch` (`board-send-<time>`), which Actions already groups and lets the person approve together (`src/shared/actions/batch.ts:15-26`); one notification for the lot (only the first proposal carries `notify`). Each can still be skipped on its own, which marks that card `declined` and leaves the others. The answer is `{ proposed, remaining }`.
- A test workspace is refused by the handler's guard before any card is looked at, with nothing planned or proposed.

**The mirror** is applied by `board.ts` (on `board:list`) and `cards.ts` (on `loadCards`) through `boardSource.ts`, never through the door.

**What is removed from phase 1**: `boardAvailable()`, `checked()` and `setBoardReady` in `board.ts:24-39`, the `ctx.deps` call (`:107`), the `deps` field of `ModuleContext` (`module.ts:20-21`), the `setBoardReady` calls in `index.ts:289,291`, and the two texts that only said the board was hidden (`main.board.noHost`, `ui.board.hostNote`, in both catalogs).

### 7. The screen

`board:list` takes an optional `refresh` and is async. `BoardView` loses `available` and gains `host: { name, labels, readAt, error } | null`, `projects: { project, count, truncated, error }[]`, `items: BoardItem[]` and, per card, `host: { state, note, waiting }`. `BoardScreen.tsx` drops the host note (`:186-187`) and always renders the board. Columns hold, in order, the cards of the board and the listed issues (marked as the host's); an issue with no stage goes to a last group, "No column". Per card, in this order of precedence: **waiting** (a proposal is pending or running: the card is read-only and links to Actions), **failed in Actions**, **on the host** (reference and address), **outside the host** (`missing`), **host not read** (`unread`), **not on the host yet** (with the note's reason and a **Send to the host** button, calling `board:send`), nothing at all with no host. Above the columns: the host's name, the time of the read, a refresh control, one line per truncated project ("showing the 100 most recently updated of {project}"), one per project that failed, and, when there is at least one sendable card, **Send all to the host** with the count. A listed issue offers move, priority, squad, comment and close, with the target `{ project, iid }`; title and description are read-only on any linked card or listed issue. On a host with no issue labels (`labels()` false) a card keeps the selectors for column, priority and squad with a line saying they live on the board only, and a listed issue offers none of the three. `boardApi.ts` reloads also on the `actions` app event (`App.tsx:124`) through the same `moduleEvents` bus, so an approval or a failure in Actions refreshes the card. Today shows a small mark on a card whose `board.host` is `notSent` (`Today.tsx:202-208` is the invitation line and stays).

**New catalog keys**, in both languages of `main.*` and `ui-cycle.*`/`ui-today.*` (all through `t()`, none literal): the summaries of a proposal per operation (`main.board.host.summary.create|labels|comment|close|reopen`), the notification title, `main.board.host.notesSoFar`, the refusals (`main.board.waiting`, `main.board.hostOwnsText`, `main.board.alreadySent`, `main.board.noRoundTrip` naming the rule), the notes (`main.board.host.noIssueProject`, `main.board.host.noTracker`, `main.board.host.unlinked`), and for the screen the states listed above, the refresh line, the Bitbucket line, the label a move wrote, `ui.today.board.notOnHost`, and the project lines (`ui.board.truncated`, `ui.board.projectFailed`, `ui.board.noProject`, `ui.board.noColumn`, `ui.board.fromHost`) and Send all (`ui.board.sendAll`, its count and its result, `main.board.host.summary.sendAll`). The pairing of `{placeholders}` between languages is what `test/main-catalogs.test.ts` and `npm run i18n:lint` check.

### 8. The documentation this change makes false

Both languages in each file, in the same commit as the behavior:

| File | Sentence | Becomes |
|---|---|---|
| `docs/cycles.md:167` and `:407` ("Priority") | "A card opened on the workspace's own board (it exists where no integration is usable — see runner.md) does not come from the tracker" | The board exists in every workspace; a card on the host is the host's issue and carries the host's labels, priority and milestone, and one that exists only on the board keeps its own |
| `docs/cycles.md:19` and `:259` (`stageMapping`) | "The first matching rule wins; what is left falls to the stages' `match`" | Adds: the app's default label `board:<stage id>` is read after the rules and before the `match` patterns; a rule is also what the board **writes** when it is `source: label` and a plain name |
| `docs/runner.md:13` and `:260` | "A card opened on the workspace's own board — which exists where no integration is usable — never starts a run, because the board is not the tracker" | A card only on the board never starts a run; one that became an issue is an issue the host lists and starts a run like any |
| `docs/runner.md:386` (English; the Portuguese section only mentions the block through the push exception at `:133`, which stays true) | "Settings › Runner holds one block of five fields" | The workspace's block has a sixth, **Board writes go to the host without a yes**, independent of the cycle switch and absent from a flow's block |
| `docs/vcs-providers.md:65` / `:210` | the list of operations | Adds `reopenIssue` |
| `docs/vcs-providers.md:108` / `:253` | `closeIssue` paragraph | Adds `reopenIssue` (shape per host) and that the board uses both |
| `docs/vcs-providers.md:214` ("Two variations ... The runner uses them, only through `runner/door.ts`") | the runner is the only user of the group and the autonomous write | The board uses them too, only through `boardHost.ts`, with `by: board` in the audit |
| `docs/vcs-providers.md:241` ("Creating an issue") | "the runner uses it, only through `runner/publish.ts` and `runner/door.ts`" | Adds the board; the table of labels gets the board's column label |
| `docs/vcs-providers.md:255-257` ("Cards and stages") | the card list is only the listing, and "an issue beyond the 100 most recent does not become a card" | The day is unchanged; adds that the board lists the open issues of the workspace's projects (10 projects, 100 issues each, read only when the board is opened or refreshed) and reads the cards it opened by number |
| `docs/vcs-providers.md:261` ("What the interface shows per host") | | Bitbucket: the board keeps the column, priority and squad on its own |
| `docs/vcs-providers.md:283-291` ("Not verified") | | Adds the unverified list of this phase |
| `docs/configuration.md:9,15,165` and the history at `:48` and `:197` | "schema 18" | schema 19, with the v19 line of the history |
| `CHANGELOG.md` `## [Unreleased]` | | One entry for the phase. The 0.8.0 entry that says the card "is never sent to a code host" is history and stays |

The `.coxia/rules/` files that phase 1's plan listed are no longer in this tree (removed by `0635fcd8`), so `docs/` is the only in-repo documentation to keep true; `CONTRIBUTING.md` explains how to add a provider or a cycle template, not the config chain, and needs nothing. `docs/README.md` indexes files, not behavior, and needs nothing.

## Data

### The card (optional fields, so every saved card still reads)

`BOARD_VERSION` stays 1: a card without the new fields is exactly "not on the host", which is what it is. In `src/shared/board.ts:192-211`:

```ts
export interface BoardHostLink {
  vcs: VcsKind;          // labels, urls and what can be written depend on the host's kind
  project: string;       // as the host's reads name it (the path); the write's key when the workspace has no path
  iid: number;
  url: string;
  linkedAt: string;
}
export interface BoardHostNote {
  kind: 'failed' | 'declined' | 'unsupported' | 'unlinked';
  text: string;          // already written for a person; a reason, never a token
  at: string;
}
// BoardCard gains:
host?: BoardHostLink;    // the issue it became. Absent: the card exists only on the board.
hostNote?: BoardHostNote;// why the last attempt to reach the host left no link. Cleared when the card is linked.
```

`BoardHistoryEntry.kind` gains `'sent'` (the issue was made: `text` is the reference) and `'host'` (the host changed something: `text` is `column`, `state`, `title` or `labels`, with `from` and `to` for column and state). Everything else about a card, `applyPatch` and the atomic write is as in phase 1.

`mirrorOf(card, seen, ctx)` is pure and returns the changes to apply for what the host said: `title`, `state`, `labels` (the host's, without the app's own stage labels), `updatedAt`, `column` (the `stageId`, only when the host's issues have labels and the stage is one the workspace configured), `priority` (the first configured plain level whose label the issue carries) and `squad` (the first squad whose `squadLabel` the issue carries). It returns nothing for `unread` and `missing`. For a host with no issue labels the board's own column, priority and squad are never touched. `board-core.ts` gets `link(id, link)`, `note(id, note | null)` and `mirror(id, seen, ctx)`; each writes the file only if something changed and appends the history lines.

### The day

`Card` (`src/shared/types.ts:13-36`) gains one optional field, `board?: { id: string; host: 'linked' | 'notSent' | 'waiting' | 'missing' | 'unread' }`. A saved ceremony that has no such field reads as before.

### The view

`BoardView` (`boardApi.ts:21-30`) and `boardView()` (`board.ts:45-56`): `available` goes; `host`, `projects`, `items` and per-card `hostState` come in, as in the screen section. The event `board:changed` is unchanged.

New in `src/shared/board.ts`:

```ts
export type BoardTarget = string | { project: string; iid: number };   // a card id, or a listed issue
export interface BoardItem {                                          // derived from the read, never stored
  key: string;                // '<project>#<iid>'
  project: string; iid: number; title: string;
  column: string | null;      // a stage id, null: "No column"
  labels: string[]; url: string; updatedAt: string | null;
  priority: string | null; squad: string | null;
}
export function derivedFields(labels: readonly string[], ctx): { priority: string | null; squad: string | null };  // shared with mirrorOf
```

The board file gains nothing for an issue that was not opened on the board. `board:update`, `board:comment`, `board:close` and `board:reopen` take a `BoardTarget` where they took a card id.

### The new write

`VcsWriteOp` gains `reopenIssue`. `ReleaseAction.unit` (`shared/types.ts:439`, `Record<string, unknown>`) carries `{ purpose, cardId, effect }`; no type changes.

## Configuration and migration

This is a config shape change, so it follows the project's rule: types, defaults and schema describe the same thing (`test/config-schema.test.ts` fails on drift), and a stored file that would not pick the field up on its own gets **a step in `STEPS`** (`src/shared/config/migrations.ts:323`).

- **Where it lives.** One new field, `board: boolean`, in the **workspace's** autonomy block `runner.autonomy` (`types.ts:818`). `AutonomyBlock` (`:723-735`) stays the five fields of a run, and a new `WorkspaceAutonomy extends AutonomyBlock { board: boolean }` becomes the type of `RunnerConfig.autonomy`. `FlowAutonomy` (`:737`) keeps extending the five-field block, so a flow has no `board`. `AUTONOMY_CHOICES` (`:716`) stays the four choices that need `cycle`; the board is not in it.
- **Independent of `cycle`.** The other four count only under `cycle` (`autonomy.ts:36`) because they are steps of a run. The board is not a run, a board write has no flow, and requiring `cycle` would force a person who never starts a run to switch on something about runs. `boardAutonomous(c) = c.runner.autonomy.board === true` in `autonomy.ts`, with no reference to `cycle`; `autonomyOf` (`autonomy.ts:27-33`) is edited to pick the five run fields instead of spreading the whole block, and `onChoices` is unchanged, so neither the run's header nor its note ever lists the board.
- **Workspace block only, not per flow.** A board card has no flow, and the main flow, a squad's flow and the release flow are different things from the board of the workspace. A per-flow field would also have to answer "which flow does a card without a squad follow", and a squad's own `autonomy` switch (`SquadDef.autonomy`) governs agents, not the person's clicks. One switch for one board.
- **Defaults.** `neutralAutonomy()` (`defaults.ts:32-34`) returns `WorkspaceAutonomy` with `board: false`; `neutralRunner()` (`:37`) is unchanged otherwise. Every field off, as every field of the block.
- **Schema.** `schema.ts:158-165` keeps `autonomy` for the five fields (the flow's block is built from it at `:167-170`); the runner's property (`:500`) becomes that object plus `board: boolean(...)`, so `additionalProperties: false` holds for both.
- **The step.** `v18ToV19` (after `v17ToV18`, `migrations.ts:316-321`): `runner.autonomy.board` is set to `false` when the stored value is not a boolean, `schemaVersion: 19`, a note `runner.autonomy.board was added (off: board writes wait in Actions for a yes)`. Idempotent; a stored `true` is kept (an older app would not have written one). It touches nothing else and never raises anything. `STEPS` gets `18: v18ToV19`, the history comment (`:7-37`) gets the v19 line, `CONFIG_SCHEMA_VERSION` becomes 19 (`types.ts:5`) and the headers that say "schema 18" (`types.ts:1`, `schema.ts:6`) follow. `v15ToV16` keeps spreading `neutralAutonomy()`, which now holds `board: false`; harmless, since `v18ToV19` keeps an existing value and the field was invented after that step ran.
- **Validation.** The JSON schema validates the field; an invalid value is repaired to the neutral one (`repair`, `migrations.ts`), never locks the workspace. No rule in `validate.ts` is needed.
- **A paired browser.** `runner.autonomy` is not in `WEB_EDITABLE` (`configScope.ts:14-32`), so `config:cycle-save` refuses any change under it, up or down: the new field inherits that and `configScope.ts` needs no code. The statement that a phone may only turn autonomy fields **off** holds for the flows' blocks (`raisedAutonomy`, `:95-104`); the workspace's block is stricter. The maintainer decided the phone may not turn this one off either (spec, decision 2).
- **The settings screen.** Autonomy is edited in Settings › Runner, `AutonomyBlock` of `RunnerSection.tsx:209-220`, which renders the five-field `AutonomyFields` (`AutonomyFields.tsx:25-41`). The board's choice is a separate `Toggle` in the same fieldset, under its own heading and **not** disabled by `cycle`, with its hint; read-only for a paired browser (`web`), like the rest. `AutonomyFields` and the flow editor (`FlowEditor.tsx:226-230`) are unchanged. `runnerEdit.ts` types the draft with `WorkspaceAutonomy` (`:34`) and copies it (`:60,79`).
- **Catalogs.** New keys in both `ui-team.en.json` and `ui-team.pt-BR.json`: `ui.autonomy.board` (the label), `ui.autonomy.board.hint` (what it does, that it needs no cycle switch, that a test workspace still refuses), `ui.autonomy.board.heading`. The existing `ui.autonomy.hint` (line 16) talks about "a run" and "the four choices below"; it is left as it is, because the new control sits under its own heading. These catalogs are not in the snapshot of `test/gitlab-catalogs-unchanged.test.ts`.
- **Tests that name the shape.** `test/runner-config.test.ts:12` (the neutral runner), `test/config-web-scope.test.ts:53-54` (the whole block assigned without `board`), `test/team-runner-edit.test.ts:12`, `test/autonomy.test.ts:9-11` (a flow block built by spreading `neutralConfig().runner.autonomy`, which would now carry `board` and fail the flow schema), and the literal `schemaVersion: 18` in `test/config-schema.test.ts:132`, `test/wizard-shared.test.ts:132` and `test/agent-team.test.ts:35,43,266` move to the new shape or to 19.
- **Not changed:** `config:export`/`import` (`transfer.ts` already migrates anything not current), and no other file of `src/shared/config/`.

## Flow

### Read side

1. The board is opened or refreshed by hand. `board:list(refresh)` asks `readProjects` and then `readTracked` (which skips the issues already listed); each is cached five minutes. **Nothing else reads the project listing**: not the day, not a ceremony, not a clock. `loadCards(…, refresh)` asks `readReport` and `readTracked` only.
2. `seen` (for the cards the board opened) is applied to the board file by `mirror`: the card's copy changes to the host's and a `host` line says so. Cards the host did not return keep their copy, flagged `missing`; cards that could not be read keep it, flagged `unread`. Nothing is deleted. The listed issues that no card is linked to become items in the answer and are written nowhere.
3. The day merges as in "5" above: a linked card is the host's item when the person's scope lists it, a card that is only on the board is added as in phase 1.
4. `stageOf` reads a stage from `board:<id>` labels after the mapping rules, for the day and for the items alike.

### Write side, per handler (all in `board.ts`, async)

Every handler keeps the order of phase 1: the checks that need no host, the `assertExternalWrite` guard (`board.ts:119,146,155,162,169`), and only then anything that writes. The guard comes before the port, so a test workspace never plans, proposes or reads for a write.

- **`board:create`.** Validate as today. Write the local card. If `host.ready()`: `cannotSend()` non-null leaves `hostNote { kind: 'unsupported', text }`; otherwise `send({ kind: 'create' })`. `ran` links the card and adds a `sent` line; `proposed` leaves the card unlinked (the screen derives "waiting" from Actions); a thrown reason leaves `hostNote { kind: 'failed', text }` (`unlinked` when the host answered with no number) and **still returns the card**: opening a card never fails because of the host.
- **`board:send(id)`** (new, the seventh channel): the same last step for a card that has no link. Refused when the card has a link, when a creation already waits for it, or when one is in flight (an in-process `Set` of card ids), so two clicks make one issue.
- **A listed issue as target.** `board:update` (column, priority, squad), `board:comment`, `board:close` and `board:reopen` accept `{ project, iid }`. The handler order is the same (checks, guard, port); `title` and `body` are refused; there is no local effect and no history, and `board:changed` makes the screen read again (the door cleared the caches, so the host is asked).
- **`board:sendAll`.** As in the door section.
- **`board:update`.** On a card with no link: as phase 1, except a card with a waiting creation is refused ("waiting for your yes in Actions"). On a linked card: `title` and `body` are refused with the reason; `column`, `priority` and `squad` become one `send({ kind: 'labels', effect })` (with `labels()` false, they stay local at once and no command is planned); `ran` applies `effect` and adds the history lines; `proposed` changes nothing local.
- **`board:comment`, `board:close`, `board:reopen`.** No link: as phase 1. Linked: `send` with `effect` = the history line or the state; the local copy changes only when the host has it (`ran`, or the listener on `done`).
- **Every handler** emits `board:changed` after it changes the file or proposes.

### The door and the autonomy

`ran` and `proposed` are the two outcomes of `boardAutonomous`. The door is the one every write uses: `validateVcsCommand` in `runVcsAuto` and in `proposeVcsGroup`, `audited` for each executed command (one audit line, and `assertExternalWrite`, `actions.ts:501`), `approveAction` for the person's "yes" (`actions.ts:542-543`, which also refuses a test workspace). A proposal is stored without that guard, which is why the handler's guard comes before the port. The board adds no way to the host that bypasses it, and no board file other than `boardHost.ts` may name `proposeVcsGroup`, `runVcsAuto`, `onActionDone` or `onActionSkipped`.

### Labels, concretely

Opening a card in `doing`, squad `core` (label `core`), priority `priority:high`, on a workspace with no rules: `createIssue` with labels `board:doing`, `core`, `priority:high`. With a rule `label ^in progress$ → doing` for this host: `in progress`, `core`, `priority:high`. Moving that card to `review` on GitHub, when the issue carries `in progress`, `core`, `bug`: `POST labels {labels: [board:review]}` and `DELETE labels/in%20progress`; `core` and `bug` stay. On GitLab the same is one `PUT` with `add_labels=board:review` and `remove_labels=in progress`.

## Commit order

One commit per feature, the plan alone first; each commit leaves `tsc`, `vitest`, the theme, i18n and public audits green.

1. `feat: plan phase 2 of the board following the host` (this spec and plan only).
2. `feat: reopen an issue on the three hosts` (feature 1: `types.ts`, three `planWrite`, `test/vcs-reopen-issue.test.ts`, the `docs/vcs-providers.md` lines).
3. `feat: add the board's own autonomy to the config` (feature 2: schema 19, step, defaults, schema, `autonomy.ts`, settings control, catalogs, the config tests, `docs/configuration.md` and the autonomy paragraph of `docs/runner.md`). Nothing reads the field yet.
4. `feat: read and write a card's column as a host label` (feature 3: `src/shared/boardHost.ts`, the `stageOf` step, `test/board-labels.test.ts`, one case in `test/vcs-cards.test.ts`).
5. `feat: link a board card to its issue` (feature 4: the card fields, history kinds, `mirrorOf`, `board-core.ts`, `test/board-store.test.ts`).
6. `feat: read the issues the board tracks and merge them into the day` (feature 5: `readTracked` in `boardRead.ts`, the two exports of `vcs/cards.ts`, `cards.ts`, `test/board-read.test.ts`, `test/board-cards.test.ts`).
7. `feat: list the project's issues on the board` (feature 5b: `readProjects`, `workspaceProjects` exported, `BoardItem`, `derivedFields`, the `items` and `projects` of the view; no write yet; tests in `test/board-read.test.ts`).
8. `feat: send a board card to the host through the door` (feature 6: `boardHost.ts`, the port and the handlers with their targets, `board:send`, wiring in `index.ts`, removal of `ModuleContext.deps`, `test/board-host.test.ts`, `test/board-policy.test.ts`).
9. `feat: send every unsent board card at once` (`board:sendAll`, the batch, the 50 cap, tests in `test/board-host.test.ts` and the policy test's eighth channel).
10. `feat: show the host's issues and where a card stands` (feature 7: screen, catalogs, Today mark, the remaining `docs/` sentences, `CHANGELOG.md`).

## Test plan

Every test that needs a data folder sets `CERIMONIAS_DATA_DIR` to a fresh temporary directory before importing the app, as the board tests of phase 1 do (`test/board-cards.test.ts:9-14`), and never touches the person's data. Hosts are fakes: `fakeGitlabRuntime` with `setVcsRuntimeForTests` (`test/helpers/vcs.ts`, `test/actions-group.test.ts:7-50`) for the door, and the local HTTP host of `test/helpers/fakeHost.ts` for the providers' own shapes. No test reaches a network or a model.

| File | Covers |
|---|---|
| `test/vcs-reopen-issue.test.ts` (new) | `planWrite({ op: 'reopenIssue' })` on the three providers returns the command above; `iid` 0 is refused; each validator accepts it, and still refuses a body with another key; `closeIssue` is unchanged |
| `test/board-labels.test.ts` (new) | `writtenLabel`: a plain rule label wins; `^x$` anchors are accepted; a regex, a field, a column, a status, a state rule, another host's rule or a label with a comma falls back to `board:<id>` with `why`; a rule that would read back as another stage falls back; a rule claiming `board:<id>` refuses. `moveLabels`: removes only own labels the issue carries, never `bug` or a priority or squad label; adds nothing already there; a second own label is removed so one remains. `cardLabelChanges`. `issueBodyOf`. `issueRefOfAnswer` for the three answer shapes. `stageOfBoardLabel`: case, rank, unknown id |
| `test/vcs-cards.test.ts` (one case) | an issue labelled `board:<id>` reads in that stage, after a matching rule and before a `match` pattern; a workspace with no such label reads exactly as before |
| `test/board-store.test.ts` (extended) | `link`, `note`, `mirror` write only on change; the `host` and `sent` history lines; an old file with no new field reads and round-trips; `mirrorOf` for column, state, title, labels, priority, squad; `unread` and `missing` change nothing; a host with no labels leaves column, priority and squad alone |
| `test/board-read.test.ts` (new) | with a fake GitLab runtime: a tracked issue not in the listing arrives as an item; `not_found` is `missing`; another failure is `unread`; the 50 cap and the 7-day rule; the five-minute cache and `refresh`; no host returns null and reads nothing; **the project listing**: a fake runtime lists two projects, and each is asked `listIssues` with `scope: 'all'` and limit 100; a result of 100 is flagged `truncated`; 11 projects read only 10; one failing project carries its reason and the other still lists; a project with the tracker off (Bitbucket) is empty and not an error; a listed issue gets its column from the mapping rules, then `board:<id>`, then the patterns, and `null` ("No column") when none; an issue a card is linked to is not an item and is not read again by number; priority and squad are derived from its labels; **listing writes nothing** (no `board.json` appears); the listing is cached five minutes, `refresh` skips it and a door write clears it; no host returns null and calls nothing |
| `test/board-cards.test.ts` (extended) | a linked card is one card whether or not the listing holds it, and `total` counts it once; a linked card the host closed leaves the day; `missing` and `unread` stay, flagged; a card with no link is added as in phase 1; `Card.board` is set; **the day is unchanged**: with a host whose project holds issues the person's scope does not list, `loadCards` returns exactly the cards of the scope (and the same `total` and `rest`), and the fake saw **no** `listIssues` with `scope: 'all'` from `loadCards` (only the read by number for linked cards) |
| `test/board-host.test.ts` (new) | the heart of the phase, over a fake runtime that records commands: **autonomy on**: create runs `createIssue` with the expected labels and one audit line, links the card, a second `board:send` is refused; move runs the add and the remove and nothing else; comment, close, reopen. **Autonomy off**: the same changes produce proposals in Actions and the fake receives **no** command until `approveAction`; approving applies the effect through the listener; skipping a creation leaves `declined` and the card sendable again; a failed approval shows in the derived state. **A test workspace** (registry marked test): every handler is refused, `listActions()` is empty and the fake saw nothing, with the autonomy on and off. **No host**: the handlers behave as phase 1. **Locks**: a card with a waiting creation refuses edits; a second waiting `labels` change is refused. **Bitbucket**: column, priority and squad stay local, no label command planned, comment and close reach the host; **a listed issue as target** (no card in the file): move writes the add and the remove computed from the issue's own labels, comment and close reach that project and number, squad and priority are derived from its labels, title and body are refused, nothing is written to `board.json`, and a waiting `labels` change on it refuses a second; on a host with no labels a column change on a listed issue is refused with the reason; **Send all**: with the autonomy on, N cards make N issues one after the other with N audit lines, a failing one keeps its `hostNote` and the rest still go, a second call sends none (all linked), the 50 cap leaves `remaining`; off, N proposals with one `unit.batch` and the fake receives nothing, skipping one leaves `declined` on that card only, approving the batch links all; a card waiting, linked or in flight is left out; a workspace with no issue project refuses it with the reason; **a test workspace** refuses it with `listActions()` empty |
| `test/board-policy.test.ts` (updated) | `CHANNELS` gains `board:send` and `board:sendAll` (eight; `WRITES` is seven); the web policy still gives every channel to a paired browser; the boundary becomes a matrix: `board.ts`, `boardSource.ts`, `board-core.ts` and `shared/board*.ts` import neither `./vcs` nor `./actions` and name none of the door's functions; `boardHost.ts` is the only board file that imports `./actions` and it does not name `approveAction` or `proposeVcsAction`, nor import `./vcs/(exec|runtime|validate)`; every changing handler still carries `assertExternalWrite(` (the shape half) and the behavior half is driven for all eight writes (Send all included), now over a fake host that is ready, and for a listed-issue target as well |
| `test/config-migrations.test.ts` (added) | 18 to 19 sets `board: false`, keeps a stored `true`, bumps the version, adds the note, is idempotent, validates; a current file is untouched; 19 is the newest and 20 is refused |
| `test/config-schema.test.ts`, `test/config-web-scope.test.ts`, `test/runner-config.test.ts`, `test/team-runner-edit.test.ts`, `test/autonomy.test.ts`, `test/wizard-shared.test.ts`, `test/agent-team.test.ts` | the shape and version edits listed under Configuration; web scope: a browser changing `runner.autonomy.board` either way is refused by name; `autonomyOf` and `onChoices` never carry `board`; `boardAutonomous` is independent of `cycle` |
| `test/ui-i18n.test.ts`, `test/main-catalogs.test.ts`, `npm run i18n:lint` | the new keys exist in both catalogs with the same placeholders; the removed `ui.board.hostNote` and `main.board.noHost` are gone from both |
| `test/vcs-writes.test.ts` (unchanged, must stay green) | still one importer of the executors and one caller of `exec.run` |

**Goldens.** The cycle goldens (`test/golden/`) hold prompts and parity text; nothing in this phase touches a prompt, a template or a catalog key they render. The one snapshot of catalogs, `test/gitlab-catalogs-unchanged.test.ts`, renders the keys of an older `main` and is not touched by new keys. The only existing assertions that change are the ones named above.

**The interface** is driven once the screen exists, as in phase 1: `electron-vite build`, an empty `CERIMONIAS_DATA_DIR` under a throwaway directory, the repository's Playwright with a fresh profile, a fake host on `127.0.0.1` for the workspace's integration. The scenarios are the eleven criteria of the spec; the two that need a real account (a label created by a real host, the answers' shape) stay marked **not verified**.

## Risks

What the plan supposes and did not verify:

1. **Labels created on use.** The maintainer's premise for GitHub and GitLab. The code was read for what is sent (`github.ts:543-549,588-589`, `gitlab.ts:510-515,545-546`); no host answered. If a host drops an unknown label, the card is on the host in no column.
2. **The shape of the answer to a creation** (`number`/`html_url`, `iid`/`web_url`, `id`/`links.html.href`) is read from how the runner reads it for its tracking issue, which also never met a real host (`docs/vcs-providers.md`, "Not verified"). If a host answers without a number, the card gets `hostNote { kind: 'unlinked' }` and a person is told to look on the host before sending again; sending again could make a second issue.
3. **`state_event=reopen` on GitLab and `state: open` on Bitbucket** are from the providers' documentation, as `closeIssue` was.
4. **Removing a label the issue no longer carries** is a 404 on GitHub. The plan reads the issue at planning time, so the common case is clean, but the labels can change between a proposal and the "yes"; the group then fails and stays in Actions, and a retry repeats the same command. The person skips it and moves again.
5. **A partial group.** With the autonomy on, a move is an add and then a remove; if the second fails the first stays. The error is shown, the local copy is not changed, and the next read shows the truth.
6. **The link's project.** `BoardHostLink.project` is the issue project as the host's reads name it. A GitLab workspace that configured only the numeric project id has no path; then the link holds the key the write used and `sameIssue` can match by number alone. If two projects shared a number there, the match could be wrong; a workspace with an issue project path is not affected.
7. **The 50-card cap and the 7-day rule** of the tracked read keep a large board from costing a request per card. A card past the cap shows its last copy.
8. **`stageOf` changes for every host card**: a `board:<id>` label now decides a stage. A label named that way by someone else, for a stage id that exists, would move a card; judged improbable, and the prefix is the one the maintainer fixed.
9. **Greedy rules.** A workspace whose rule patterns match `board:<id>` makes a move refused with the rule named. The cure is reordering the rules; the refusal is chosen over writing a label that reads as another column.
10. **A paired browser reaches the door.** With the autonomy on, a board write from a phone goes straight to the host; `board:*` is classified like `runs:*` (open to the browser, behind no external-effects switch), because the autonomy only the computer changes is the consent. The handler cannot tell where a call came from. The maintainer decided this (spec, decision 3). "Send all" widens it: from a phone with the autonomy on it makes up to 50 issues in one call, which is why the cap exists.
11. **A mirror write in a test workspace.** The mirror changes `board.json` from what the host said, with no guard, like `vcs-cards.json` is written on every read (`vcs/cardSource.ts:56-60`). It writes nothing outside the workspace's data and the spec's refusal list does not name it; a reviewer may want it guarded.
12. **An issue the app made and did not record.** A card is linked from the host's answer. Nothing links an issue the app created in a session that crashed after the host answered and before the file was written, and the card would be sendable again; since the project listing now shows the issue, the person can see the twin, but nothing matches them. The window is the time between two lines of one handler.
13. **No test enumerates the importers of `actions.ts` across `src/main`** that I could find (`test/runs-policy.test.ts:65` walks the runner's folder only); the new matrix test is the only guard of the board's boundary.
14. **Read volume and rate limits (new).** Opening the board reads up to 10 projects with up to 100 issues each, plus one read by number per linked card the listing lacks (at most 50), plus on GitLab one read of statuses per project. GitHub's search has a rate limit of its own that is lower than the REST one (`docs/vcs-providers.md`, "Cards and stages"), and its index can be late in showing a just-created issue. Containment: the read happens only when the board is opened or refreshed by hand, never on a clock and never from the day; it is cached five minutes; the caps are constants, and a truncated or failed project is said on screen. Not measured against a real host.
15. **The board's column for a listed issue ignores merge requests.** The day infers a stage from open, draft or approved merge requests when no label says; the board does not read them, so an issue the day shows in review can sit in the backlog column on the board until a label says otherwise. Said in the docs; a fix would add reads.
16. **A stale target.** A listed issue can be closed or moved on the host between the read and a click; the write then fails or lands on an issue in another state. The host's error is shown on the card and the next read corrects the view. A write the door makes clears the caches, but a GitHub search can still list a just-closed issue for a short time.
17. **A project with more than 100 open issues** hides the older ones from the board (said on screen); the person's day is unaffected.
18. **The project set.** `projects.repos` of another integration, or with no `projectPath` and no parseable `remoteUrl`, are not listed; a workspace that names no project on this host gets "no project to list" and still has its own cards.
19. **Async handlers.** `board:list` and the writes become async; other modules already register async handlers (`configModule.ts:89`), the screen already awaits them, but the RPC for a paired browser was not read for a handler that takes seconds (a creation with the autonomy on).

## Decision log

| # | Decision | Alternative rejected, and why |
|---|---|---|
| D1 | The host path lives in a new file, `boardHost.ts`, behind a **port** declared in `board.ts`; `board.ts` keeps importing nothing of the host. | Let `board.ts` import `./actions` and `./vcs` and loosen `test/board-policy.test.ts`. The phase-1 boundary and its test were the reason a write could not slip out through the board; the runner's `door.ts` is the working precedent. |
| D2 | Replace the `setBoardReady` getter and `ModuleContext.deps` with `setBoardHost(host)` called once by `index.ts`. | Keep the getter and add the host beside it. The getter handed back to the module is what recursed in phase 1; the host no longer needs "is the board offered", only "is there a host". |
| D3 | The card is **saved locally first**, then sent; a failed or declined send leaves a marked, sendable card. | Create the issue first and the card from its answer. The card would not exist if the host were down or the proposal declined, against the maintainer's answer 3 (never deleted, never lost). |
| D4 | The link is recorded from the answer when the write ran, and by the **`onActionDone` listener** when a proposal is approved; the "waiting" state is **derived** from the list of actions, not stored. | Store a `pending` flag on the card. It would go stale when a proposal is skipped, fails or is removed, and nothing tells the board about a failed approval. |
| D5 | A column is `board:<stage id>` by default and a **mapping rule's label when it is a plain name** (`literalLabel`, an existing test), checked to **read back** as the same stage. | Derive a label from any regular expression by guessing; or write the default only. The first writes labels the rule does not mean; the second ignores the mapping the maintainer said wins. |
| D6 | A move removes only **labels the app could have written** (default labels of every stage and the plain labels of the label rules) that the issue **carries**. | Remove every label that the mapping reads as a stage (could drop `needs-review-docs` under a loose `review`), or replace the labels wholesale. The first can delete a foreign label, the second always does. |
| D7 | Rules over `status`, `state`, `field` and `column` are **read but not written**; the default label is written and the screen says so. | Implement a status or Projects write. `setIssueStatus` needs a numeric id the rule does not hold; no Projects write exists; the issue puts a real Projects board out of scope. |
| D8 | A new operation `reopenIssue` on the three providers. | Reuse `setIssueStatus('open')`. Its meaning differs per host (a custom status id on GitLab) and its validator on GitLab is a GraphQL mutation, not a state; a reopen deserves its own audited shape beside `closeIssue`. Declaring reopen out of scope would leave the board unable to undo its own close. |
| D9 | `runner.autonomy.board`, **workspace block only**, independent of `cycle`, via `WorkspaceAutonomy` so `FlowAutonomy` and `AutonomyBlock` keep their five fields. | Add `board` to `AutonomyBlock` (every flow would get a field with no meaning, and the flow schema, the editor and `newFlowAutonomy` change); make it depend on `cycle` (it is not a run); a per-flow value (a card has no flow). |
| D10 | **(Q2, decided)** `board` is not touched by `configScope.ts`: the browser cannot change `runner.autonomy` at all. | Add a "may lower" rule for it now. The maintainer decided (Q2) to keep the block desktop-only, and a phone that could lower the setting would be the first edit of the workspace's block from a browser. |
| D11 | The tracked read (by number, for the cards the board opened) is **separate from the day's listing and from the board's project listing**, and returns report items made by the same function. | Add the tracked issues to the day's listing query, or widen `cardScope`. The listing is capped, scoped and shared with the command source; a card the person created must show whatever the scope is, and the extraction keeps one code path for an item. |
| D12 | The mirror **overwrites the board's copy** with the host's and logs a `host` line; the board's own column is kept for a host with no labels. | Keep two columns (local and host's) and show both. It reproduces the "two competing records" the issue forbids. |
| D13 | Title and description of a linked card are **read-only**. | Add an `editIssue` operation (three providers, a body write the release spec already judged more than needed). A silent local edit would diverge from the host, which wins. |
| D14 | **(Q5, decided)** A card with a waiting creation is **locked** until the proposal is decided; one waiting `labels` or state change per card. | Let the person edit and supersede the proposal (`supersede` in `actions.ts:160` keys on a run). Two waiting commands computed against the same host state can disagree when both are approved. |
| D15 | **(Q4, decided)** A comment made before the card reaches the host goes into the description under "Notes so far". | A comment sent after the creation: it needs the number, so a second command and a second "yes" for the same card. |
| D16 | **(Q7, decided)** `board:send` is explicit per card and **`board:sendAll`** sends every unsent card in one action; nothing sends a card because a host became usable. | Send every unsent card when the host is ready: nothing would be the person's choice, and the maintainer's answer 3 says each card keeps its place until the person sends it. Without Send all, the person with dozens of old cards would click dozens of times. |
| D17 | Updating the board's copy from a read is **not** guarded by the test-workspace refusal. | Guard it: a test workspace would stop showing what the host says. It is the workspace's own file, written on every read as `vcs-cards.json` is. |
| D18 | The audit line for a board write carries `by: 'board'` and the summary names the card. | Reuse an agent id: no agent made the write, and a person reading the log should see where it came from. |
| D19 | **(Q1, decided)** The board lists the **open issues of the workspace's projects** when a host is usable, beside the cards opened on it, in the column `stageOf` gives them; a card linked to an issue is that issue's single entry (`sameIssue`). | Show only the cards opened on the board (the earlier default, overruled): the board would be a partial view of the host. Adopt every listed issue into `board.json`: see D20. |
| D20 | An issue not opened on the board has **no local `BoardCard`, before or after the person acts on it**; the screen derives it from the read and the writes aim at `{ project, iid }`. | Create a record on the first action ("no copy until the person acts"). It would make a second record of an issue the host owns (the issue's rule 7), need a mirror and a dedupe for every touched issue, and grow the file with the host's data. The cost accepted: no history lines for an issue that is not a card, and no local column on a host with no labels. |
| D21 | The same channels take a **target** (a card id or `{ project, iid }`). | New channels for host issues (`board:hostMove`…): they would duplicate the guard, the web classification and the policy test for the same writes. |
| D22 | **Limits:** at most 10 projects and 100 open issues each (the providers' own paging, the same 100 as the day's listing), the most recently updated first, a truncated or failed project said on screen. | Page every project to the end: GitHub's search stops at two pages anyway, GitLab would multiply reads and statuses reads, and a rate limit would turn a refresh into a failure. Truncating silently, as the day does, rejected: the board is the whole project's view and must say what it left out. |
| D23 | **Closed issues:** the 7-day window applies to the **cards the board opened** (read by number); an issue closed on the host that was not opened on the board just leaves the list. | Read the closed issues of each project too: a second listing per project, with no record to attach them to and no use for them. |
| D24 | The **day does not change**: `loadCards` never reads the project listing, and the card scope still decides what the day holds. The board is a separate view. | Feed the listed issues to the day (a different scope: the day would show unassigned issues and its count and order would shift) or merge scopes. The maintainer asked that the day stay as it is. |
| D25 | The project listing is read **only on opening the board or refreshing by hand**, cached five minutes, cleared by the board's own writes. | A background refresh or a timer: the issue forbids a new clock. |
| D26 | **Bitbucket:** a listed issue sits in the column its state gives it; the board offers comment, close and reopen on it and no column, priority or squad. | A local column for it: it needs a stored record (D20). |
| D27 | **Send all = one proposal per card, all sharing one `unit.batch`**, sequential audited writes when the autonomy is on. | One `proposeVcsGroup` for all cards: one "yes" is attractive, but the person could not skip one card, a group stops at the first failing command, one answer list would have to be mapped back to cards by position, and the lock, the dedupe key and the `declined` mark are per card. Parallel writes: the audit order and a host's rate limit. |
| D28 | **(Q3, decided)** A write from a paired browser with the choice on goes straight to the host, like `runs:*`; `board:*`, `board:send` and `board:sendAll` are classified open. | Make a browser's board write a proposal even with the choice on: the handler cannot tell where a call came from, and the choice is only the computer's to switch on. |
| D29 | **(Q6, decided)** A created issue is **not assigned** to the person. | An assign operation on the three providers: out of scope; the board lists the project's issues and reads linked cards by number, so the issue is visible whatever its assignee. |
