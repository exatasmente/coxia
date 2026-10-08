# Review: the board follows the code host (phase 2)

Reviewed against the spec (`1_SPEC.md`), the plan (`2_PLAN.md`) and the repository's rules, on the diff `ebc281c0..HEAD` (9 commits, 67 files). Read in full: `src/main/board.ts`, `src/main/boardHost.ts`, `src/main/vcs/boardRead.ts`, `src/shared/boardHost.ts`, `src/shared/board.ts` (diff), `src/main/board-core.ts` (diff), `src/main/cards.ts` (diff), `src/main/vcs/cards.ts` and `stages.ts` (diff), `src/main/webPolicy.ts`, `src/main/index.ts`, `src/main/module.ts`, `src/shared/config/*` (diff), `src/main/actions.ts` (the paths the door uses), `BoardScreen.tsx`, `boardApi.ts`, the `RunnerSection.tsx` control, the catalogs' added keys, the docs and the CHANGELOG diff, and `test/board-policy.test.ts`, `test/board-cards.test.ts`, `test/helpers/boardHost.ts`. A throwaway probe (outside the repository, in the session scratchpad) drove the real handlers over the fake host to confirm finding 1.

## Verdict

**changes**. The write boundary is sound: one door, guard before every port call, the config migration and the browser classification are right, labels removed on a move are only the app's own, the host-born listing writes nothing and the no-host path is phase 1. Two defects block: with the default autonomy (off) a card cannot be closed twice or moved back to a column it already left from the same state, and the host is read by events after the board was opened once, against the promise of the spec and the CHANGELOG.

## Blocking findings

### 1. A repeated change is refused for good with the default autonomy: close, reopen, close again fails (`src/main/boardHost.ts:83,87,115,173`)

The proposal key of a comment, close, reopen and label change is `board:<where>:<op>:<sha(commands)>`. `proposeVcsAction`/`proposeVcsGroup` return `null` when an action with the same key is `pending`, `running` **or `done`** (`src/main/actions.ts:186` for one command, `:214` for a group), and nothing prunes done actions. The commands of `closeIssue` for one issue are always the same, so once a close was approved, any later close of that issue gets `null`, and `propose()` turns it into "A change of the same kind is already waiting in Actions" (`boardHost.ts:174`), which is false (nothing waits) and has no way out in the UI.

Reproduced with a probe over the real handlers, autonomy off, a card linked to issue 201, every proposal approved at once:

```
close ok, reopen ok, close  ERR "A change of the same kind is already waiting in Actions for acme/app#201."
move doing ok, backlog ok, doing ERR (same message)      // issue starting with the label board:backlog
```

Autonomy on is not affected (`runVcsAuto` has no key dedupe). The same mechanism blocks a second identical comment text and any A to B to A to B round of moves. The default configuration is autonomy off, and close then reopen is exactly what acceptance criterion 2 describes, so this is the main path.

Fix: make the key unique per proposal for `labels`, `close`, `reopen` and `comment` (a counter or the creation time in the key); `exclusive()` already refuses a second pending change of the same kind, which is the only dedupe wanted. Keep the stable key for `create` (one issue per card). Add a test that approves a close, a reopen and a second close in a row, and a move out and back.

### 2. The host is read by events after the board was opened once, not only on open and refresh (`src/renderer/src/screens/cycle/boardApi.ts:112-118`, `src/main/boardHost.ts:128-131`, `src/main/vcs/boardRead.ts:171-190`)

`useBoard()` calls `start()` the first time `BoardScreen` mounts, and the two listeners it registers (`board:changed` and `actions:changed`, the latter fed by `App.tsx:124` on every `actions` event) are never removed. From then on every Actions change calls `reloadBoard()` and so `board:list` (refresh false), whether or not the board is on screen. The listing cache lasts five minutes, so an unrelated Actions event six minutes later makes a full read: up to 10 project listings, a statuses read per project on GitLab, and up to 50 reads by number. That contradicts spec point 1 ("The host is read when the board is opened and when the person presses refresh, and at no other time"), criterion "no new clock", and the CHANGELOG sentence of the same words.

It also amplifies. `done()` and every door write call `stale()`, which empties both caches; so approving N proposals in Actions makes about 2 to 3 `actions` events and one `board:changed` per proposal, and each reload re-lists the whole workspace. `listProjects` and `readTracked` have no in-flight sharing, so these reloads run in parallel and each one repeats the full set of requests (Send all with 50 proposals approved together is the worst case).

Fix: reload on those two events only while `BoardScreen` is mounted (subscribe in an effect, unsubscribe on unmount), and make an event reload use what is cached when the cache was just cleared by a write only if the person is looking at the board; share one in-flight read per host id so concurrent `board:list` calls make one set of requests.

## Should fix (do not block, each is a real defect)

### 3. A card read by number loses the GitLab work-item status, so its column can flap between the day and the board (`src/main/vcs/boardRead.ts:80`; `src/main/vcs/gitlab.ts:301-306`)

`provider.getIssue(link.project, link.iid)` is called without `{ status: true }`; on GitLab that skips the status read, while the listing fills `status` through `withStatuses` (`gitlab.ts:263`). `stageOf` matches the status text (default stage patterns and `source: status` rules). `loadCards` (the day) reads every linked card by number with no `listed` issues, `readBoard` passes the listing's issues, and both feed `mirror`. For a GitLab workspace with statuses, the same card can get a column from the listing's read on one path and from a labels-only read on the other, so `mirror` rewrites the column and adds `host` history lines back and forth. Fix: ask for the status in the read by number (`{ status: true }`; it is one more GraphQL read per card, covered by the cache) or never derive `column` from a read that has no status.

### 4. A link is not tied to the host it came from (`src/main/boardHost.ts:49-54,56-116`, `src/main/vcs/boardRead.ts:70-80`)

`BoardHostLink.vcs` is stored and never compared. If the workspace's primary integration changes to another host of the same kind, or to another kind, linked cards are read by `project#iid` on the new host and the mirror overwrites title, state, labels and column with whatever that issue is; a close, comment or label change from the board is planned with `vcsProvider()` against the new host's issue of that number. Fix: compare `link.vcs` to `provider.kind` (and ideally store the integration id in the link) and treat a mismatch as `unread`, refusing writes with a reason.

### 5. A `{ project, iid }` target is accepted for any project (`src/main/board.ts:168-173`, `src/main/boardHost.ts:49-54`)

`targetOf` checks only the shape. The door will plan a comment, a close or a label change for any project path the token reaches, not only the projects the board lists (`boardProjects`). On the desktop the person clicked an item; from a paired browser with the board's autonomy on (decision 3, which is accepted) a write goes straight to the host, so the reach of a paired session grows from "the issues the board lists" to "any issue the token can write". Fix: in `plan()` refuse a target project that is not among `boardProjects(provider.id)` (case ignored) when the target is not a card.

### 6. Texts that this change made false (item 11 of the brief)

- `CHANGELOG.md` (the `[Unreleased]` entry, the only one; it is single): "The host is read when the board is opened or refreshed by hand and at no other time" (false, see finding 2, and the day reads linked cards by number, `src/main/cards.ts:77`) and "The day does not change" (false, see point on the day below).
- `docs/vcs-providers.md:267` (English) and `:117` (Portuguese): "The day does not change: the list, the order and the count of what did not fit come from the person's scope, as before" and "(never on a clock, never from the day)". The day now adds the open issues of linked cards that the scope does not list and reads them by number; the count and the order change with them.
- `1_SPEC.md` section 8 and acceptance criterion 9 ("when the scope does not list it ... the day does not show it"; "The day, with the same scope, is the same as it was before this phase"). See the open point below.

The docs the plan listed (`cycles.md`, `runner.md`, `configuration.md`, schema 18 to 19, the reopen operation, the door paragraph) were all edited in both languages; a grep for "schema 18", "own board", "where no integration" finds nothing left over.

### 7. Smaller defects

- `src/shared/boardHost.ts:198-201` and its callers in `src/main/cards.ts:78,92,120`: `sameIssue` calls `.includes` on `item.project`. A report item from `externalTools.cardSource` is parsed JSON with no validation (`src/main/report.ts:72`), and the type says `project: string` but a command that omits it makes the day throw a `TypeError` as soon as one card is linked and the iids coincide. Guard with `typeof project === 'string'`.
- `src/main/board.ts:314-319` (Send all): the cards are chosen once, then sent one at a time with awaits in between. A card the person sent by hand meanwhile reaches `sendCard` again and fails inside `plan()` ("already sent"), which writes a `failed` note on a card that is linked, and is counted as a failure. Re-run `sendable(card)` inside the loop.
- `src/main/vcs/boardRead.ts:177-188`: a listing where every project failed (host down) is cached for five minutes, so the failure sticks until the person presses Refresh; and an `unread` card read is not cached, so each reload retries up to 50 reads (see finding 2). Do not cache projects that failed, and stop reading after the first transport failure.
- `ui.board.sendAll.result` (both languages): "left for another call" / "para outra chamada". In this app "call" is the voice ceremony; reword ("left for the next Send all") so the `.novoice` convention does not have to be asked.

## The open point of the brief: the linked card the scope does not list

What the code does: `loadCards` reads every tracked card by number (`src/main/cards.ts:77`, `readTracked(refresh)`, no listing passed) and appends the open ones the listing does not hold to `items` before the cards are built (`:79`). So a card linked to an issue **not assigned to the person (or outside `cardScope`) is shown in the day, the ceremonies and the squads' cut**, once, built by `issueCardItem` with `board: { id, host: 'linked' }`. `total`, `rest`, the order and the calls change with it. A closed linked issue leaves the day (the mirror closes the card before `boardCards()` is read); a `missing` or `unread` one stays from its stored copy, flagged. `test/board-cards.test.ts` ("shows a card linked to an issue the scope does not list, from the read by number, once") pins exactly this.

Which text is inconsistent: `1_SPEC.md` section 8 (last-but-one sentence of the paragraph "when the scope does not list it ... the day does not show it") and acceptance criterion 9 ("show one card where their scope lists it"; "The day, with the same scope, is the same as it was before this phase"), together with "Out of scope: Changing the day's cards". The plan agrees with the code (step 5 in "What is built", point 2 of `loadCards`; D11 "a card the person created must show whatever the scope is"), and so does the test. D24 ("The day does not change") and the CHANGELOG/docs sentences above are the ones that contradict D11. The behaviour is the better one (a card the person opened must not vanish from the day because the host did not assign it), so the correction is in the texts: change section 8 and criterion 9 of the spec, D24, the CHANGELOG sentence and `vcs-providers.md:267/117` to say that a linked card is in the day whether or not the scope lists it, and that this is the one thing the board adds to the day. If the maintainer wants the spec's version instead, `loadCards` must stop appending `tracked.items`, and a linked card outside the scope then has to show from its stored copy flagged, like `missing`.

## Answers to the points of the brief

1. **The single write door.** Held. `board.ts` imports neither `./vcs` nor `./actions` (it imports `./boardSource`, `./cyclePrompts`, `./module`, `./workspace`, `./workspaceConfig` and `shared`). Only `boardHost.ts` imports `./actions` (`proposeVcsGroup`, `runVcsAuto`, the two listeners, `listActions`); `grep` finds no other `propose*`/`runVcsAuto` caller outside the runner's `door.ts`. `vcs/boardRead.ts` calls `getIssue` and `listIssues` only. `test/board-policy.test.ts` walks the imports and the names, and `test/vcs-writes.test.ts` still passes (one executor importer, one `exec.run`). Nothing in the door calls `approveAction` or `proposeVcsAction` directly.
2. **Test workspace.** Every handler (`create`, `send`, `sendAll`, `update`, `comment`, `close`, `reopen`) calls `assertExternalWrite` before `host.send`/`sendCard`/`run`, for card targets and `{project, iid}` targets; the planning before the guard (`planCard`, `unlocked`, `itemReady`) only reads. The behaviour test drives all 11 calls with the board's autonomy on and off and finds no action and no command on the host. `approveAction` and `runVcsAuto` refuse again (`actions.ts:501,543`), and a test covers a proposal approved after the flag flips. One gap: the behaviour test uses an unlinked card and a listed issue; add a linked card row (same guard, but the matrix should say so). The mirror to `board.json` without the guard (plan D17) is sound: it is the workspace's own file, written from a read, like `vcs-cards.json`; the rule in `test-workspace.md` says the local record keeps being written; in a test workspace no card can have been sent, so the mirror has almost nothing to change. No external effect is possible through it.
3. **Paired browser.** `board:*` is not in `DESKTOP_ONLY`/`EXTERNAL_EFFECT` and `webAccess` gives `allow`; `test/board-policy.test.ts` pins all 8 channels. `runner.autonomy` is not in `WEB_EDITABLE`, so `config:cycle-save` refuses any change under it either way (`test/config-web-scope.test.ts`). With autonomy on a phone write goes through `runNow` like `runs:*`; with it off it is a proposal that the phone can approve only behind the external-effects switch (`actions:approve`). Finding 5 is the one reach issue.
4. **Config migration.** `v18ToV19` is in `STEPS`, sets `board: false` only when the stored value is not a boolean, keeps a stored `true`, bumps to 19, is idempotent; types, defaults and schema agree; the newest-version refusal is tested (20 is refused). `autonomyOf` now picks the five run fields, so `board` never travels into a run; `FlowAutonomy` and `onChoices` do not have it; `boardAutonomous` is independent of `cycle`.
5. **Labels.** `moveLabels` removes only labels in `ownStageLabels` that the issue carries (`board:<id>` of every stage and the plain label of the label rules for this host) and never the one it writes; `cardLabelChanges` removes the previous priority and squad labels only when the issue carries them. `bug`, other priorities and foreign labels stay (`test/board-labels.test.ts`). A rule whose plain label is, say, `bug` would be removed on a move; that is the mapping's own and by design. `stageOf`'s new `board:<id>` step can change a day only for an issue whose label is exactly `board:<stage id>` (case ignored) of a configured stage (or of the host's default stages when none is configured), that no mapping rule claims first; the effect is that card's stage text and a one-time "stage changed" line in `vcs-cards.json`. Judged acceptable (plan risk 8); not guarded by a test of a foreign `board:` label, which would be worth one case.
6. **Mirror and dedup.** A linked card is one entry on the board (`readBoard` filters listed issues by `sameIssue` against every link at each call, so a link written after a cached listing still deduplicates) and one card in the day (`loadCards` drops the board card when an item stands for it). The host-born listing writes nothing (tested: no `board.json`). The scope point is above.
7. **Read volume.** `loadCards` never calls the project listing (tested: no `scope=all` read). The caps are constants (10 projects, 100 issues, 50 tracked, 7 days), the listing pool is 3, the by-number pool 4, the cache is 5 minutes, and a failing project is isolated (its reason is shown, the others list). Violated by event reloads (finding 2); `truncated` is also set when exactly 100 issues come back (harmless over-report).
8. **Phase 1 intact.** With no usable host the default `NO_HOST` is inert: `board:list` makes no read, `host` is null, `items` empty, `sendable` 0, no card is marked, no request. The phase-1 tests pass unchanged.
9. **Public repo.** `acme/app`, `git.acme.test`, `acme/lib` are fixtures. They are not new to the repository: 39 test files at the base commit already use `acme/app` and `git.acme.test`, and `public-audit` passes; the new files follow the convention that exists, not the one written in the rules. Recommendation: leave it, and fold it into one separate sweep to `group/project` and `example.test` rather than splitting the convention inside this branch. The grep of the diff for hosts, emails and names found only `*.example.test`, `acme.*` fixtures and public registries; the nine commits carry the maintainer's noreply identity, `feat:` subjects, no trailer.
10. **i18n and theme.** `npm run i18n:lint` 0, 4676 keys in both languages; the keys added to `main.*` and `ui-*` have the same placeholders (checked by `test/main-catalogs.test.ts` and `test/ui-i18n.test.ts`); the two keys that look unused (`main.board.host.summary.close|reopen`) are built dynamically. The removed phase-1 keys (`main.board.noHost`, `ui.board.hostNote`) are gone from both catalogs. No literal color in the renderer diff; `theme-audit` is green. The "call" wording is in finding 7.
11. **Docs.** Finding 6. The CHANGELOG has a single entry under `[Unreleased]`.
12. **Quality.** Send and Send all: `inFlight` is claimed in the same synchronous run as the check, so two clicks make one issue, and a link written after the answer ends the window; the double-send lock on a pending creation is `waiting()` derived from Actions plus the key `board:<id>:create`; the Send all race is in finding 7. Host unreachable: every read path catches (a card becomes `unread`, a project carries its error, the whole read returns `error`), a failed write leaves a `failed` note and the card; with an unreachable host the open reads are 10 listings plus up to 50 by number, each waiting for the provider's own timeout, which is slow but contained. Dead code of phase 1: none left (`setBoardReady`, `deps`, `boardAvailable`, `checked` and the two keys are gone). Tests pin behaviour (a fake host that records commands, audit lines, `listActions()`), with one exception that is by design: the policy test reads the source text of `board.ts` to find each handler's body (`board-policy.test.ts`, the "carries the external-write guard" case) and the import graph; the behaviour half beside it covers the same ground.

## Suggestions

- Add the rows the tests miss: a linked-card target in the test-workspace matrix; close then reopen then close, and a move out and back, with autonomy off (finding 1); a foreign `board:` label on a stage id; a card source command item with no `project`.
- In `board:list`, keep the by-number reads of closed cards (within seven days) out of an event reload; they cost one request each per reload.
- `ui.board.sendAll.result` could also hide `{remaining}` when it is 0.

## What was verified

Run in the worktree, outputs in the session scratchpad (`review-*.log`):

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no errors |
| `npx vitest run test/board-*.test.ts test/vcs-reopen-issue.test.ts test/config-migrations.test.ts test/autonomy.test.ts test/config-web-scope.test.ts test/vcs-cards.test.ts test/card-scope*.test.ts` | exit 0, 17 files, 315 tests passed |
| `npx vitest run test/main-catalogs.test.ts test/ui-i18n.test.ts test/vcs-writes.test.ts test/runs-policy.test.ts test/config-schema.test.ts test/team-runner-edit.test.ts test/gitlab-catalogs-unchanged.test.ts test/forum-policy.test.ts` | exit 0, 8 files, 90 tests passed |
| `node scripts/theme-audit.mjs` | exit 0 |
| `npm run i18n:lint` | exit 0, 4676 keys in both languages, 0 untranslated |
| `node scripts/public-audit.mjs` | exit 0, 1219 files |
| Probe (real handlers, fake GitLab, autonomy off, outside the repo) | confirmed finding 1; left no file in the worktree |

## What was not reviewed

- The whole suite was not run (the timing-sensitive files are for the main session).
- The screen was not opened and no paired browser was used: the layout, the busy states, the Actions screen showing the proposals and the phone path are unseen. `3_TEST_PLAN.md` for this phase does not exist yet; it is manual.
- No real host: label creation on first use, the shape of the creation answers (`number`/`iid`/`id`), `state_event=reopen` and Bitbucket's `state: open` are the maintainer's premises and the providers' documentation, as the spec says; GitHub's rate limit and search lag are untested.
- The behaviour of a read of 10 projects of 100 issues against a real host (time, limits) was not measured.
- `3_IMPLEMENTATION.md` for phase 2 does not exist, so the delivery claims were checked against the code and tests, not against a document.

## Second pass

Reviewed the five commits on top of `38e5ce5f` (`19bc7999`, `2a4ea07e`, `4683ae72`, `81fb63e4`, `961e279a`): the source diff in full, the new tests by name, and the text changes in the CHANGELOG, `docs/vcs-providers.md` (both languages), `1_SPEC.md` and `2_PLAN.md`.

### Verdict: approve

Both blockers are fixed, and no new blocking finding came up. What remains is below, none of it blocking. The `sameIssue` crash (item 7) is only half fixed, so I would ask for the one-line correction before the merge.

### Status of each earlier finding

| # | Finding | Verdict | Where |
|---|---|---|---|
| 1 | Repeated change refused for good with autonomy off | **Fixed** | `src/main/boardHost.ts:180-183`: every op but `create` gets `p.key + ':' + time + random`; `create` keeps `board:<id>:create`. The test added in `test/board-host.test.ts` covers close, reopen, close and a move out and back (the suite passes). |
| 2 | Host read by events after the board was opened once | **Fixed** | `boardApi.ts:111-122` (`watchBoard`, listeners added and removed by the effect at `BoardScreen.tsx:381-384`); nothing else calls `reloadBoard` outside the screen. In-flight sharing at `src/main/vcs/boardRead.ts:223-243`. |
| 3 | Read by number lost the GitLab status | **Fixed** | `boardRead.ts:96` asks `{ status: true }`; GitHub and Bitbucket ignore the option. |
| 4 | Link not tied to the host | **Partly fixed** | `link.vcs` is now compared to the provider kind at `boardHost.ts:58`, `boardRead.ts:86` and `linkedHere` (`:54-60`, used by the day and the listing dedupe). A card linked on another kind is `missing` with a note, never read or written there. Two instances of the **same kind** are still indistinguishable (the link stores no integration id). Acceptable for now; say so in the docs or store the id. |
| 5 | `{project, iid}` accepted for any project | **Fixed** | `boardHost.ts:50-54` refuses a project outside `boardProjects(...)`, case ignored, and writes with the listed spelling. A policy-test row covers it. |
| 6 | Texts made false | **Fixed, one leftover** | CHANGELOG, `vcs-providers.md:117` and `:267`, spec §8, acceptance 9, the "Out of scope" line and plan D24 now say the day also shows linked cards the scope does not list, and that the board re-reads while its screen is open when a proposal is decided. Leftover: `1_SPEC.md:67` still says the host is read "when the board is opened and when the person presses refresh, and at no other time". |
| 7a | `sameIssue` throws on an item with no `project` | **Partly fixed** | `src/shared/boardHost.ts:200` guards the second argument only. `src/main/cards.ts:78` (`inListing`) passes the **report item as the first argument** (`link`), so `link.project.includes('/')` still throws when a card-source item names no project and the number equals a tracked card's. The new test only passes the item side. Fix: guard `typeof link.project === 'string'` too, or build the pair the other way round. |
| 7b | Send all does not re-check each card | **Fixed** | `board.ts:314-317` looks the card up again and skips it when `sendable` is no longer null. |
| 7c | All-failed listing cached; `unread` retried every reload | **Fixed** | `boardRead.ts:213-215` keeps a listing unless every project failed; `unread` is cached for the same five minutes (`:104-108`) and cleared by a write or Refresh. Stopping after the first transport failure was not done (suggestion only). |
| 7d | "left for another call" | **Fixed** | Both catalogs reworded ("left for the next Send all"). |

### Looked at specifically

- **In-flight sharing (`boardRead.ts:223-243`).** A refresh never joins a non-refresh flight and a non-refresh read joins any; a write bumps `generation` through `forgetHost()` so a read that begins after joins nothing older. The promise settles: `readBoardNow` catches everything after `vcsReady()`, the transports have timeouts, and `flight` is cleared in `finally`. Two things to know, neither blocking:
  - **A read that began before a write can still fill the caches after it.** `listing =` (`:214`) and `cache.set` (`:84,96,102,107`) take no generation check, so a slow read R1 that finishes after `forgetHost()` and after the fresher R2 can leave pre-write data cached for up to five minutes (a just-closed issue shown again until Refresh). It needs a write during an in-flight read, which an approval in Actions does cause (the `running` event starts R1, the write finishes, `done` starts R2). Fix: capture `generation` at the start of the read and skip the cache writes when it changed. The renderer also applies whichever `list` answer arrives last.
  - The flight key is the integration id only, so a workspace switched while a read is in flight could be handed the previous workspace's answer. Add the project set (or the workspace id) to the key.
- **The nonce and `exclusive()`.** `exclusive(p)` runs first in `propose()` and reads `listActions()` for `pending`, `running` and `failed`, then the proposal is stored with no await in between, so a real pending duplicate of a `labels`, `close` or `reopen` is still refused; the nonce only lifts the `done` key. Comments were never covered by `exclusive`, and before this fix the content hash in the key deduplicated an identical pending comment; now two identical comments can wait together. The UI disables the button while a write runs, so this needs a retry from a second client; a suggestion, not a defect. `create` keeps its stable key, so one issue per card still holds.
- **The `link.vcs` comparison.** `BoardHostLink.vcs` is always a `VcsKind` (`linkOf` stores `provider.kind`; the helpers use `'gitlab'`), and phase 2 has not shipped, so no card linked before this change exists; `'vcs'` is an action kind, never stored in a link. A host that cannot be used makes `linkedHere` return false and `readTracked` returns null first, so a down host is not mistaken for a foreign one. The `unsupported` note set for a foreign card is cleared when the card is read on its own host again (`boardRead.ts:152-153`), and only on a card that has a link.
- **The project restriction.** Matching is case-insensitive and the first 10 projects only, the same set the board lists. One cosmetic effect: the write's `unit.project` is now the configuration's spelling, while the item's "waiting" badge looks up `${item.project}#${iid}` with the host's spelling (`board.ts:103`), so on a host that returns another case the badge may not show for a listed issue. `exclusive` is unaffected (both sides use the canonical spelling). Suggestion: normalise the key to lower case on both sides.
- **No-host path.** Unchanged: `readBoard` returns null before touching the flight, `linkedHere` is false, nothing is read.

### What is still open

1. `src/main/cards.ts:78`: the same `sameIssue` crash from the other side (7a). One line.
2. Generation guard on the cache writes of `boardRead.ts` (stale listing after a write during a read).
3. `1_SPEC.md:67`: reword "at no other time" to match the CHANGELOG.
4. Optional: integration id in the link; lower-case waiting keys; dedupe of an identical pending comment; the flight key including the workspace.

### Run (logs `review2-*.log` in the scratchpad)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run test/board-*.test.ts test/vcs-cards.test.ts test/vcs-reopen-issue.test.ts test/config-migrations.test.ts test/autonomy.test.ts test/config-web-scope.test.ts test/card-scope*.test.ts test/main-catalogs.test.ts test/ui-i18n.test.ts` | exit 0, 19 files, 345 tests passed |
| `node scripts/theme-audit.mjs` | exit 0 |
| `npm run i18n:lint` | exit 0, 4678 keys in both languages, 0 untranslated |
| `node scripts/public-audit.mjs` | exit 0, 1220 files |

Not re-run: the whole suite; the screen, a paired browser and any real host are still unseen, as in the first pass.
