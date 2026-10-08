# The board follows the code host (phase 2 of the board of its own)

## The rule of the issue

Out of the issue, the half this phase delivers:

> With a host connected, the same card appears on both sides and does not become two competing records.

Decided earlier, and not asked again:

- **The code host is canonical; the board is its local mirror.** When the board and the host disagree, the screen shows the host's.
- **The host is read together with the app**, on demand: when the day is built, when the board is opened, when the person refreshes by hand. No new clock.
- **The board shows the host's issues too** (maintainer's answer, recorded below): with a usable host it lists the open issues of the workspace's projects, not only the cards opened on it. The day's cards do not change, except that it adds the cards opened on the board and linked to an issue, even when the person's scope does not list that issue (point 8).
- **Phase 1 is delivered** (release 0.8.0): a workspace with no usable host opens, moves, comments, prioritises, gives to a squad, closes and reopens cards on a board kept in the workspace's own data folder. This phase does not change that path.

The cut posted on the issue for this phase is the scope. It is eight rules:

1. One board per workspace. With a usable host it mirrors, and the local board stops being hidden.
2. A card opened in the app goes to the host as an issue, in the chosen column, mapped by the `devCycle.stageMapping` the workspace already configures. With no rule for a stage, the app's default writes one label per stage, a single one per card.
3. Moving a column writes on the host only what the mapping says, and never removes a label that is not the mapping's own.
4. Commenting on the board publishes the comment on the issue; closing and reopening close and reopen the issue.
5. The squad link stays what exists for a card with no host: the squad's label.
6. When the read disagrees with what is stored, the screen shows the host's, without deleting the local card.
7. A board card that already became an issue is the same card on both sides, never two records.
8. The only way out to the host stays the single write door (propose, confirm, audit).

Three questions blocked the plan and the maintainer answered them:

- **A board write reaches the host through an autonomy of its own.** A new choice in the autonomy block. On: the host write goes straight through the door, executed and audited. Off, the default: it becomes a proposal in Actions and nothing leaves before the person's "yes".
- **A card opened in a stage the host does not know** goes with the default label `board:<stage id>`, one per card, and the read side maps that label back to the stage. Bitbucket has no labels on issues, so there the column stays on the board only, and the screen says so.
- **A card that exists only on the board** (a proposal pending, refused, or made before the host was connected) stays in its local column, marked "not on the host yet", with an action to send it. It is never deleted, and the host never overwrites what it does not know.

## Where things are today

Checked in this working tree (release 0.8.0), not run.

| What | Where it stands | Evidence |
|---|---|---|
| The board is hidden when a host is usable | `boardAvailable()` is `!hostReady()`; every write handler stops at `checked()` with `main.board.noHost`; the screen shows `ui.board.hostNote` instead of the board | `src/main/board.ts:24-34`, `src/renderer/src/screens/cycle/BoardScreen.tsx:186-187`, `src/shared/i18n/ui-cycle.en.json:19` |
| How the module learns about the host | A getter handed in at registration; a getter handed back to the module once caused a `RangeError` recursion | `src/main/board.ts:37-39,107`, `src/main/index.ts:289-291`, `src/main/module.ts:20-21` |
| The board file | `board.json`, atomic writes; a card has `column`, `squad`, `priority`, `labels`, `repo`, `state`, a history; **no field says it is an issue on a host** | `src/main/boardSource.ts:419`, `src/main/board-core.ts:39-43`, `src/shared/board.ts:192-211` |
| The board never writes to a host | The policy test forbids the proposal and execution functions in `board.ts` | `test/board-policy.test.ts:122-135` |
| Board cards join the day | `loadCards` appends the board's open cards and drops one whose `ref` the report already has | `src/main/cards.ts:88-94` |
| The cards of a host come from a listing | Open issues by scope (`assigned` by default), plus the merge requests; at most 100 issues; cached five minutes; an issue the person did not get assigned is not a card | `src/main/vcs/cards.ts:122-137`, `src/main/vcs/cardSource.ts:38-62`, `src/main/report.ts:43,108-111`, `docs/vcs-providers.md` ("Cards and stages") |
| Which projects the workspace has on a host | The repositories of the integration (`projectPath`, else derived from `remoteUrl`) plus the issue project | `src/main/vcs/cardSource.ts:29-35`, `src/shared/config/types.ts:101-105` |
| Listing the open issues of one project | `listIssues({ project, scope: 'all', limit })`: GitHub by search, at most two pages; GitLab `ceil(limit/100)` pages and one extra read of statuses per project; Bitbucket two pages, and an empty list when the tracker is off | `src/main/vcs/github.ts:307-317`, `src/main/vcs/gitlab.ts:263-271,288-300`, `src/main/vcs/bitbucket.ts:264-275` |
| Proposals that wait and are approved together | A `unit.batch` on a proposal groups the open ones in Actions | `src/shared/actions/batch.ts:15-26` |
| How a read issue gets its stage | Mapping rules first (`devCycle.stageMapping`), then the stages' `match` patterns over the status and labels, then what the merge requests imply | `src/main/vcs/stages.ts:72-81`, `src/shared/cycles/stages.ts:43-70` |
| A mapping rule is a regular expression | `pattern` is a case-insensitive regular expression tested against a label, status, state, field or column | `src/shared/config/types.ts:282-292` |
| A precedent for "is this pattern a plain label" | `literalLabel` accepts a name with optional `^` and `$` and no other regex character | `src/shared/priority.ts:48-56` |
| Writes the three hosts can plan | `createIssue`, `closeIssue`, `commentIssue`, `setIssueLabels`, `setIssueStatus`. **There is no `reopenIssue`.** | `src/main/vcs/types.ts:190-228` |
| Labels on the three hosts | GitHub sends `labels` on creation and one `POST`/`DELETE` per label afterwards; GitLab sends `labels=a,b` and `add_labels`/`remove_labels`; **Bitbucket drops labels on creation and refuses `setIssueLabels`** | `src/main/vcs/github.ts:543-549,588-589`, `src/main/vcs/gitlab.ts:510-515,545-546`, `src/main/vcs/bitbucket.ts:463-464,489-491` |
| State of an issue on the hosts | GitHub `setIssueStatus` takes only `open` or `closed`; GitLab's `setIssueStatus` is a custom work-item status by numeric id; Bitbucket takes its own state words | `src/main/vcs/github.ts:550-552`, `src/main/vcs/gitlab.ts:516-528`, `src/main/vcs/bitbucket.ts:465-467` |
| The single write door | `proposeVcsAction` and `proposeVcsGroup` store a proposal, `approveAction` runs it, `runVcsAuto` runs one command audited with no "yes"; all refuse a test workspace; `onActionDone` and `onActionSkipped` tell a module what became of its proposal | `src/main/actions.ts:170,209,241,501,531,542-543,634` |
| The runner's way through the door | One file, `door.ts`, is the only file of the runner that imports Actions | `src/main/runner/door.ts:1-31`, `test/runs-policy.test.ts:58-75` |
| The autonomy block | Five fields, all off; `cycle` is the general switch and the other four only count while it is on; the workspace's block is `runner.autonomy`, each flow's is in `devCycle.autonomy` | `src/shared/config/types.ts:716-741,818`, `src/shared/config/autonomy.ts:27-36` |
| What a paired browser may change | `runner.autonomy` is not editable from a browser at all; a flow's block may only go down | `src/main/configScope.ts:14-32,84-104` |
| Schema | 18 today; the chain ends at `v17ToV18` | `src/shared/config/types.ts:5`, `src/shared/config/migrations.ts:316-323` |
| What Today says about a card without a host | An invitation to open a card, shown under an empty day | `src/renderer/src/screens/Today.tsx:202-208` |

## What this phase delivers

### 1. One board for the workspace

The board screen is the same whether or not a host is usable. The sentence that says "this workspace has a code host ... nothing here changes" disappears. A workspace with no usable host keeps exactly what phase 1 gave it: every card is local, nothing is marked, nothing is sent, and no host is read.

With a usable host the screen adds, at the top, the host's name, the time the host was last read and a refresh control. **The host is read when the board is opened and when the person presses refresh, and at no other time**; a read made less than five minutes ago is reused unless the person asks again. The board then shows two kinds of card in the same columns: the cards opened on the board, and the **open issues of the workspace's projects** (point 7).

### 2. A card opened with a host goes to the host

Opening a card works as before: a title, a description, a column to start in. The card is saved on the board **first**, so it exists whatever happens next. Then, when the workspace has a usable host with issues and an issue project:

- **Autonomy on:** the issue is created at once through the door, audited. The card is linked to it and says so.
- **Autonomy off (the default):** a proposal "open this card as an issue" waits in Actions with the exact command. Until the "yes" the card says it is waiting; **nothing leaves before it**.

The issue goes to the workspace's issue project. It carries the card's title, its description, and as labels: the column's label (point 3), the squad's label if the card was given to a squad, and the priority level if it has one. Anything the person wrote as comments on the card before it reached the host goes into the description under a "Notes so far" line, so nothing written is lost.

If the workspace cannot create issues (no issue project, or a host whose tracker has none), the card stays local, marked "not on the host" with the reason; opening a card never fails because of the host.

### 3. A column is a label on the host

- **The mapping wins.** If a `devCycle.stageMapping` rule for this host (`provider` equal to the host or `any`) says that a label means the stage, and its pattern is a plain label name (the same test the priority levels use: the name with optional `^` and `$` and no other regular-expression character), that label is what the app writes for the stage.
- **Otherwise the default.** The app writes `board:<stage id>`, and a card carries exactly one such label. The host creates the label on first use (GitHub and GitLab; that is the maintainer's premise and it is listed as not verified below).
- **Rules the app cannot write by.** A rule over a project board field, a board column, a custom status or an open/closed state is read as before and is **not written** in this phase: a move into a stage mapped only that way writes the default label, and the screen says which label it wrote.
- **The read side understands the default.** An issue carrying `board:<stage id>` is in that stage, after the mapping rules and before the stages' free-text patterns. A label that must read back as another stage than the one written is detected before writing, and the move is refused with the reason instead of leaving a card on the host that reads as a different column.
- **Bitbucket.** Its issues have no labels. The column, the priority and the squad of a card stay on the board only, and the board says so on screen. Opening, commenting, closing and reopening still reach the host.

### 4. Moving writes only what the mapping says

Moving a card to another column changes labels on the issue in one step: **add** the target stage's label and **remove** the labels the app itself could have written for any other stage that the issue actually carries. It touches no other label: `bug`, `priority:high`, a squad's label, a milestone's, a person's own labels stay as they are. The group is one proposal, one "yes", or one audited write per command when the autonomy is on. The card shows the old column until the host confirms, then the new one. The same holds for an issue the board lists from the host: the move is aimed at its project and number.

### 5. Comment, close, reopen

- **Comment** on a card on the host publishes the text as a comment on the issue; the board keeps the line in the card's history once the host has it.
- **Close** closes the issue; **reopen** reopens it. Reopening is a write that does not exist yet on any of the three hosts; this phase adds it (one operation, three providers, the same validation as closing).
- For a card that is not on the host, comment, close and reopen stay local exactly as in phase 1.

### 6. Priority and squad on a card that is on the host

Priority and the squad's link are labels. On a card on the host, changing either adds the new label and removes only the one the app added for the previous value. The squad link is the squad's label, as it already is for a card with no host. Title and description of a card on the host belong to the host: the board refuses to edit them and says where (no provider can edit an issue's text today).

### 7. The board shows what the host has, and the host's read wins

**The project's issues.** With a usable host the board lists the open issues of the workspace's projects: the repositories of the host integration (`projects.repos`) and the issue project, each read as `listIssues({ project, scope: 'all' })` does today. Each issue sits in the column its stage gives it (mapping rules, then the `board:<stage id>` label, then the stages' patterns), shown with its reference, title, labels, the squad and priority its labels say, and its address. An issue the stages cannot place goes in a last group, "No column".

- **No local copy.** An issue that was not opened on the board has no card in the board file. What is on the screen is derived from the read, and goes away when the issue is closed or no longer listed. The person can still act on it: move it, comment, close, reopen, set a priority or a squad, each one the same write as for a card of the board, through the same door and the same autonomy, aimed at the project and the number.
- **Limits, said on screen.** At most 10 projects are read and at most 100 issues per project, the most recently updated first (the providers' own paging, two pages at most on GitHub and Bitbucket). A project with more than that says "showing the 100 most recently updated of {project}"; an issue past the limit is not on the board. A project that cannot be read says so and the others still show.
- **Closed issues.** The list holds open issues only, so an issue closed on the host leaves the board. A **card opened on the board** and linked to its issue is also read by number: while open, and for seven days after it is closed, so a close or a reopen made on the host shows.
- **The day changes in one way only.** Today, the ceremonies, the squads' cut and the count of cards that did not fit are built as before, from the person's scope (`assigned` by default, or `labels`/`all`), and the day adds the cards opened on the board and linked to an issue, read by number, even when the scope does not list that issue (point 8). The board is otherwise a separate view; listing an issue on the board does not make it a card of the day.
- **Bitbucket.** Its issues have no labels: they appear in the column the state gives them (open or new in the first, resolved or closed-like in the last) and the column, priority and squad of an issue cannot be changed from the board; comment, close and reopen can.

**The host's read wins** for a card opened on the board: its local copy (title, column, open or closed, labels, priority, squad) is **updated to what the host says**, with a line in its history, and it is never deleted. A card whose issue the host **no longer returns** (deleted, moved to another project, no access) **stays on the board**, marked as outside the host. If the host **cannot be read** at that moment, the card keeps its last copy and says the host was not read. Updating that copy is a write to the workspace's own file, not to a host: it is not one of the writes a test workspace refuses.

### 8. The same card is one card

A card of the board that is linked to an issue, and that issue as the host lists it, are **one entry on the board**: the card, showing what the host says. It is never shown twice, whether the issue came from the project listing or from the read by number. In the day, the ceremonies and the squads' cut, a linked card is the host's item when the person's scope lists it, and is not duplicated; when the scope does not list it (an issue not assigned to the person), the day shows it all the same, once, built from the read by number, so a card the person opened does not vanish from the day because the host did not assign it. A linked issue the host closed leaves the day; one the host does not return, or that could not be read, stays from its stored copy, marked. This is the one thing the board adds to the day. A card opened on the board and not yet sent is in the day as in phase 1.

### 9. A card that exists only on the board

A card with no issue is shown in its column marked **"not on the host yet"**, with a **Send to the host** action on the card. The mark also covers a card whose proposal was refused ("Skip" in Actions) or failed, with the reason. Sending uses the same path and the same autonomy as opening a card. A card with a proposal waiting is **locked**: the card says "waiting for your yes in Actions" and does not accept edits until the proposal is approved or skipped, because the proposal carries the exact command it will run. Nothing in this phase sends a card by itself when a host becomes usable; each one is sent on purpose.

**Send all.** The board offers one action, "Send all to the host", that sends every open card that has no issue yet and is not waiting. It does what **Send** does for each card, with the same autonomy: on, each card is created and audited in turn, and the board says how many were sent and which failed (one failure does not stop the others); off, **one proposal per card** waits in Actions, all marked as one batch so Actions offers to approve them together, while each can still be skipped on its own. Nothing is sent before the "yes". A test workspace refuses it, proposing nothing.

### 10. The board's own autonomy

A new choice in Settings › Runner, in the autonomy block, **"Board writes go to the host without a yes"**:

- Off by default, like every field of the block; a config without it reads as off.
- **Independent of the Autonomous cycle switch.** The board is not a run: the cycle switch governs a run's steps, and a person who never starts a run still needs to be able to choose how the board writes.
- **Only the workspace's block has it.** A flow's block does not, because a card is not a run and has no flow.
- Only the computer changes it. A paired browser sees it for reading, like the rest of the workspace's block.
- A test workspace still refuses every board write, with the choice on or off.

### 11. What the screen says

On the board: the card's relation to the host in one short line (not on the host yet; waiting for your yes; on the host with its address; outside the host; host not read); that Bitbucket keeps the column on the board only; which label a move wrote when it was not the mapping's; and the reason a card could not be sent. An issue listed from the host says it is the host's and offers the same actions. On Today a card that is only on the board carries the same "not on the host yet" mark. All texts go through `t()` in both catalogs.

## Out of scope

- **Starting a run from a board card.** A card on the host is an issue the host lists, so it starts a run the way any such issue does; the board adds no action for it.
- **The inverted mirror**: the host mirroring the board. And **no local copy** of an issue that was not opened on the board: the board derives it from the read.
- **Changing the day's cards beyond the linked ones.** The scope, the order and the count of Today and the ceremonies are not touched by the board listing the project's issues. The only addition is the cards opened on the board and linked to an issue, which the day shows whether or not the scope lists that issue.
- **Closed issues of the project.** Only open ones are listed; a closed issue that was not opened on the board is not shown.
- **A new clock.** No background read, no scheduled refresh, no watcher on the host.
- **A real GitHub Projects board**: no write to a project field, a board column or a custom status. Those rules are read as today and not written.
- **Editing an issue's title or description** (no provider operation exists for it).
- **Assigning the issue.** Opening a card does not assign it; the tracked read is what keeps it visible.
- **An automatic send.** Nothing sends a card because a host became usable; Send and Send all are actions of the person.
- **The skills catalog.**
- **Anything for a workspace with no usable host**: phase 1 is intact.

## Acceptance criteria

Each one is verifiable on the screen or by a test; the tests drive a fake host and an empty data folder, never the person's data.

1. **Open from the board, see it arrive.** In a workspace with a usable host, an issue project and the autonomy on, opening a card creates exactly one issue in the issue project with the card's title, description and labels, in the chosen column's label; the card shows the issue's reference. The audit log has one line for it.
2. **Close.** Closing a card on the host closes the issue; reopening reopens it. Both are audited with autonomy on and wait in Actions with it off.
3. **Move, and only that.** Moving from column A to B writes: add B's label, remove A's label if the issue carries it. An issue that also carries `bug`, a priority label and a squad label still carries them afterwards. With a rule whose pattern is a plain label, that label is the one written; with a regex pattern, a field, a column, a status or a state rule, `board:<stage id>` is written and the screen says so.
4. **Comment.** A comment on the board appears as a comment on the issue, once.
5. **The host moved it.** With an issue moved on the host, opening the board shows it in the host's column, once. For a card opened on the board, its history has a line saying the host changed it.
6. **The autonomy decides, and the guard holds.** With the choice off, every write of a card on the host is a proposal in Actions and the host receives nothing until the "yes"; skipping one leaves the card where it was. A test workspace refuses all of them with the choice on or off, and proposes nothing.
7. **Outside the host.** A card opened on the board whose issue the host does not return stays on the board and says it is outside the host. A card never sent says "not on the host yet" and offers to send it; sending twice does not make two issues. **Send all** sends every such card once: with the autonomy on, one issue per card and a line of audit for each; off, one proposal per card in one batch and nothing sent before the "yes"; in a test workspace, refused with nothing proposed.
8. **Nothing changed without a host.** With no usable host, the board, its channels, its files and its messages are those of phase 1 and nothing reads or writes a host.
9. **One record.** For a card linked to an issue, the board shows one entry (never the card and the listed issue), and the day, the ceremonies and the squads' cut show it once, whether or not their scope lists the issue. Apart from the cards opened on the board and linked to an issue, the day, with the same scope, is the same as it was before this phase.
10. **The setting.** A config of schema 18 opens as schema 19 with the choice off; a paired browser cannot turn it on or off; the choice is off in a new workspace; the settings screen shows it in the autonomy block, outside the cycle switch's dependency, in both languages.
11. **Bitbucket.** Opening, commenting, closing and reopening reach the host, for a card and for a listed issue; changing the column, priority or squad of a card stays on the board with a visible note, a listed issue offers none of those three, and no label command is planned.
12. **Created on the host, shown on the board.** An issue created directly on the host, in a project of the workspace and with no board record, appears on the board in the column its labels or state give it, without any local card being written; moving it from the board writes only the mapping's labels on that issue, and commenting or closing it reaches the issue. The board file is unchanged by listing it.

## Open questions (all decided by the maintainer)

No product question is left open for this phase. Each answer is binding and is carried into the plan's decision log.

1. **Does the board show host issues that were not opened on it?** **Yes: all of the project's open issues.** Derived from the read, no local copy until the person acts and none even then (point 7), the day unchanged.
2. **May a paired browser turn the board's choice off?** **No.** `runner.autonomy` stays out of the browser's editable paths, up and down.
3. **A board write from a paired browser with the choice on** goes straight to the host, like the runs a browser may start. No "external effects" switch is involved.
4. **A comment written before the card reaches the host** goes into the description under "Notes so far".
5. **Edits while a creation waits in Actions:** the card is **locked** until the proposal is decided.
6. **Assigning an issue opened from the board to the person:** **no**, out of scope. No operation assigns.
7. **Sending cards made before the host was connected:** one action per card, **and "Send all"** (point 9), one proposal per card in one batch, refused in a test workspace.

## What was not verified

- Nothing was run and no screen was opened for this document; every statement is a reading of the code named beside it.
- That GitHub and GitLab create a label that does not exist when an issue is created or labelled with it is the maintainer's premise. The code was read to see what is sent (the label names above), not exercised against a host.
- The shapes of the answers that carry the new issue's number and address (`number`/`html_url`, `iid`/`web_url`, `id`/`links.html.href`) are read from the providers' documentation and from how the runner already reads them; no real host answered.
- A removal of a label the issue no longer carries is refused by GitHub; the plan avoids it by reading the issue first, and does not cover the case where the labels change between the proposal and the "yes".
- The read volume was estimated from the code, not measured: up to 10 projects, up to 100 issues each, one extra read of statuses per project on GitLab, GitHub's search with its own lower rate limit, plus one read per tracked card not in a listing. How a large workspace behaves against a real host's limits was not seen.
