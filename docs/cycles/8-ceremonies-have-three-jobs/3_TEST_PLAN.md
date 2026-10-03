# #8 Ceremonies have three jobs — test plan

How a person checks, in the app, each acceptance item of [`feat/1_SPEC.md`](feat/1_SPEC.md). The "automated" lines say what the suite already proves with fakes; nothing below needs a real model for the checks that are about the screens and the proposal, but items 4 and 5 need an agent to answer, so they use a real or local model.

## Setup

Use a throwaway data folder and a throwaway project on a code host you own (GitLab or GitHub; **not** Bitbucket for the label write, which is unsupported):

```bash
export CERIMONIAS_DATA_DIR=$(mktemp -d)
export CERIMONIAS_SPECS_DIR=$(mktemp -d)
npm run dev
```

1. Finish the setup wizard: a model, the code host with a token that may write labels, the throwaway project as the issues project.
2. In the throwaway project create at least ten issues assigned to you, with these labels: one `P0`, one `P1` (and a `bug` label on it), one `P2`, two with no priority label, and the rest plain. Give one a milestone, make one blocked (a `blocked` label), and edit one of the plain ones last so it is the most recently updated.
3. Stop the app, add to the workspace's `config.json` (`<data>/workspaces/<id>/config.json`) `"priority": { "labels": ["^P0$", "^P1$", "^P2$"] }` inside `devCycle`, and start the app again. The file must say `"schemaVersion": 3`.
4. Mark the workspace as a **test** workspace in Settings (workspaces) for the checks that need the refusal, and as a normal one for the approval check; use only the throwaway project for the latter.

## Acceptance items

### A card with a priority label shows it, and its turn mentions it when it matters

1. Open Today. The `P0`, `P1` and `P2` issues show a small priority badge on their row; open one row and see "Priority" in the details, and "Milestone" on the issue that has one. Issues with no priority label show neither.
2. Start the call. The big card shows `priority P1` and the milestone in the line under the number; the agenda column shows the label next to the number.
3. Let the agent of the `P0` issue speak. It may mention the priority when it changes what matters now; it must not recite it for an issue where nothing changed. (Model behavior: judge by reading, it is not a pass/fail.)
4. Switch the workspace to a config without `priority` labels (empty list): badges and the priority line disappear, and nothing else changes.

Automated: `test/priority.test.ts`, `test/cards-load.test.ts` (labels, milestone, update time, priority, what the prompt carries and what it leaves out), `test/vcs-cards.test.ts`, `test/config-migrations.test.ts` (2 → 3), `test/config-schema.test.ts`.

### Today and the call list the same cards in the same order

1. In the throwaway project, note which issues are blocked, which have `P0`/`P1`/`P2` and which was edited last.
2. Today (after "refresh from GitLab"): blocked first, then `P0`, `P1`, `P2`, then the issues with no priority, newest update first. No ordering by issue number.
3. Open the call: the agenda column lists exactly the same cards in exactly the same order.
4. End the call and start a second one the same day: the cards nothing happened to (and that are not blocked) move to the end, in Today and in the call alike.

Automated: `test/priority.test.ts` ("the order of the cards"), `test/cards-load.test.ts`, `test/same-day.test.ts`.

### With more cards than the call takes, it states the number left out and names them

1. With ten or more open issues the call takes 8. The moderator's opening says how many were left out.
2. The agenda column has a "Left out" section after the queue, naming each one with its number, title and priority.
3. Press "Bring in" on one: it appears in the queue right after the card in progress, and leaves the left out list. Bring in one before the call has started: it goes to the end.
4. Today shows "N activities outside the agenda" below the list, and the count drops when you bring one in. Close the app in the middle of a call and open it again: the left out list is still there.

Automated: `test/cards-load.test.ts` (cut, rest, total), `test/priority.test.ts` ("bringing a left out card into the agenda").

### "This one goes first" produces a priority decision, visible before the next card; after the call a label proposal waits in Actions; approving changes the label; a test workspace refuses it

1. In the call, on the `P1` issue, say or type "this one goes first". A note appears under the card with the text (for example "Priority of #12: P1 → P0") and its destination ("a label change proposal in Actions, waiting for your yes"); the decisions panel lists it too. Move to the next card: the decision is still in the decisions panel.
2. Try "leave this one for next week" on another issue (it should go to the lowest level) and "raise this one" on a `P2` issue (one level up).
3. End the call, open the minutes. The priority decisions are in the list, checked, with their destinations. Save.
4. Open Actions. For each saved priority decision there is a pending proposal: its summary names the old and the new label, and the details show the request that will be sent (the old priority label removed, the new one added, no other label touched). Nothing changed on the host yet.
5. In a normal (non-test) workspace on the throwaway project: approve one. The issue on the host now has the new priority label, the old one is gone, its `bug` label is still there. The audit screen has the entry.
6. In a **test** workspace: repeat steps 1 to 3. On saving, the decision's result says it stayed in the minutes because it is a test workspace, and Actions has no proposal. (If a proposal was created earlier and you then switch to test, approving it is refused.)
7. Save the same minutes again the same day (after reverting the label): no second proposal; the result says an identical one exists.
8. Untick a priority decision in the minutes before saving: it is not proposed.

Automated: `test/priority-reply.test.ts` (what the agent is told and what comes back), `test/priority-save.test.ts` (proposal, kept labels, approval through the audited executor, test workspace refusal, duplicate, selection), `test/priority.test.ts` (`resolvePriority`).

### Without priority labels configured, the same sentence produces a decision in the minutes only, with a line saying it was not written

1. Remove the `priority` labels from `config.json` (or use a workspace that never had them) and restart.
2. In the call say "this one goes first". The decision text reads "Priority of #12: goes first" and its destination reads "minutes (not written to the tracker: this workspace has no priority labels configured)".
3. End the call, open and save the minutes: the minutes file (`<data>/workspaces/<id>/…pre-daily…md`) has the line, and Actions has no new proposal.
4. Repeat with labels configured but with a level that is a pattern (`"^P[01]$"`): "first" lands on it and the destination says the level is not a label name.

Automated: `test/priority-reply.test.ts`, `test/priority-save.test.ts` ("a priority decision that cannot be written").

### Bitbucket

With a Bitbucket integration the same sentence produces a decision whose destination says the host does not allow changing labels from here; no proposal is created. Not verifiable without a Bitbucket workspace; covered with a scripted provider in `test/priority-save.test.ts` and `test/priority-reply.test.ts`.

### The seven "move out" items exist as issues linked from this one

Not part of this change. Check on the tracker.

## Regression checks

- Prompt goldens: `npx vitest run test/cycle-parity.test.ts test/cycle-parity-novoice.test.ts test/cycle-parity-en.test.ts test/cycle-parity-en-novoice.test.ts` pass. Only the `reply` and `reply-resumed` prompts and their schema keys differ from before this change; turn prompts of cards with no priority and no milestone are byte-identical.
- An existing v2 `config.json` opens, is rewritten as v3 with `priority: { labels: [] }`, and its card fields gain `priority` and `milestone`; a ceremony saved before the change loads and shows no badge, no left out list.
- `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `node scripts/theme-audit.mjs` (total not above 8), `npm run i18n:lint` (0), `node scripts/public-audit.mjs`, `npx electron-vite build`.

## Not verified

- No real model was called: the prompts and the schema are checked against a scripted engine, so how well a real model maps a spoken phrase to `first`, `later` or a label is not measured.
- No real code host was called: the label proposal is checked against the GitLab provider's planned request, and the approval against a fake executor. The GitHub and Bitbucket label writes were not run.
- The screens (Today, the call, the minutes) were compiled and type-checked but not driven by an automated browser test; the checks above are manual.
