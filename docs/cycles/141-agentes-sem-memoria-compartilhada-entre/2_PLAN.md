# Shared memory of the activities: where it lives, who keeps it, and how an agent reads it

## What this plan is

The approved specification asks for one record per activity that any agent can read, wherever it is
called, that survives a restart, is updated by the app along the cycle, is visible without a model
call, and that the person can correct. This document says where that record lives, who writes it,
how it reaches an agent, and in what order the work is done, with the tests that hold each behavior.

Two things are already in the tree and this plan builds on them without changing them:

- The **cycle memory** of a run (`src/main/runner/memory.ts`, `src/main/runner/cycleFolder.ts`): one
  file of a fixed name inside the cycle folder, in the run's worktree, read and rewritten by the
  stages of that run. It is the closest thing to what is asked and it is wrong on two counts: it is
  in the worktree (so it rides the pull request), and only the run that owns it can read it.
- The **state of a run** (`src/shared/runs/types.ts`, `src/shared/runs/transitions.ts`): the stage
  records, the current stage, the open question, the pending result, the history, the review and QA
  records. Every point of specification rule 3 already exists as a named move of the run
  (`stage-started`, `stage-done`, `stage-ready`, `stage-owned`, `answer`, `hand-back`, `question`,
  `handoff`, `cancelled`, `completed`, `failed`, `resumed`), and everything a field can already say.

So the decision that carries this plan: **the shared memory is not a document an agent rewrites — it
is an index the app derives from the state the app already keeps, and an agent receives a rendering of
it, never the whole index.**

## Decisions

### 1. Where the shared memory lives, and why not in the worktree

`<workspace>/memory/activities.json`, inside the workspace folder the app already owns (the same
folder as `historico/`, `atividade/`, `qa/` — `WORKSPACE_DIRS` in `src/main/workspaces-core.ts`,
reached through `ATAS` in `src/main/env.ts`). A directory of its own, one file, so later deliveries
(agent thumbnails, person edits, summaries) add files beside it instead of a second layout.

Why not the run store: a run is one execution, and specification rule 1 says a second execution of the
same activity is not a second front. Why not the cycle folder: specification rule 10 — it must not
appear in the pull request, in the commits or in the worktree of any run. Why not "the run files,
read whole": three runs of the same issue already exist side by side as separate files, there is no
place in that store to keep the person's own words for an activity that has no live run, and the
record has to outlive the removal of a worktree.

### 2. Every external write goes through Actions, and this write does not

`src/main/actions.ts` is the single door for writes to the code host; the shared memory never touches
the code host, it is a file of the workspace folder like `acoes.json` or `auditoria.jsonl`. The rule
of the squad is kept: no new path that writes to the code host is added by this change.

### 3. One front per activity, and the cycle folder keeps its own file

The front is keyed by `Run.issue.ref` (`app#101`; `release:X.Y.Z` and `docs:<repo>` for the
synthesized subjects, which is what "one run at a time" already keys on). A second execution of the
same issue updates the same front: the rule holds by construction, not by a merge step.

The per-run memory (`MEMORY.md`, `memory.ts`) is **not touched**: the spec puts it out of scope.
Nothing of this change deletes it, shortens it or makes a stage read it. The new record adds what the
per-run memory cannot do (be shared, cross restarts, be read from outside the run); if it later makes
the per-run file redundant, removing it is a change of its own with its own cycle.

### 4. Who writes: the app, from a projection of the run

New module `src/main/runner/activities.ts` — the core, pure and Electron-free:

```ts
export interface ActivityFront {
  ref: string;                 // the key ("app#101", "release:1.2.0", "docs:group/project")
  iid: number | null;
  title: string;
  url: string | null;
  lifecycle: 'open' | 'waiting-integration' | 'integrated' | 'cancelled';
  /** The front exists but no execution of it was ever created (rule 8): what is known is the reference. */
  bare?: true;
  stage: { id: string; label: string; since: string } | null;
  runId: string | null;        // which execution is current, so the front can be projected again
  squad: string | null;
  agent: string | null;        // who is working the activity now
  lastAgent: string | null;    // who touched it last
  decisions: string[];         // newest first, each capped
  openQuestions: string[];
  stoppedAt: { text: string; stage: string | null; at: string } | null;
  lastHandoff: { text: string; from: string; to: string; at: string } | null;
  updatedAt: string;
}

export interface ActivityIndex { version: 1; fronts: Record<string, ActivityFront>; agents: Record<string, { ref: string; stage: string | null; at: string }>; }

export function frontOfActivity(run: Run, prior: ActivityFront | undefined): ActivityFront;
export function folded(index: ActivityIndex, run: Run): ActivityIndex;   // pure: adds/replaces one front
export function selectFronts(index: ActivityIndex, q: ActivityQuery): ActivityFront[];   // the cuts
export interface ActivityQuery { refs?: string[]; agents?: string[]; all?: boolean }
export function renderFronts(fronts: ActivityFront[], opts: { staleAfterMs: number; now: string }): string;
```

`frontOfActivity` reads only the run: `issue`, `stage` with the flow label (`shownText` /
`cycleText`), `squad`, the stage record's agent, the last `hand-off`/`answer` of the history, the
`question` when it is open and held by nobody, the last `stage-done`/`hand-back` detail, the
`completed`/`cancelled` entry, and the last stages recorded. Nothing is asked of the model, and
nothing here reads the forum: the run's own history already carries what the person answered (the
`answer` entry, with the detail capped like every history entry).

The **writer** lives in the runner: one function inside `createRunner` (`src/main/runner/service.ts`)
called where the run is saved. Every move of a run already goes through `move()`
(`service.ts:527`) and the asynchronous turns through `moveRun(d, id, …)`; both are the same two
places. The write is:

- *attempted from the move itself*: after `moveRun` returns, the front of the new run is upserted, and
  a failure is logged and swallowed (`console.error('[runner] could not update the shared memory', …)`).
  A move of a run must not start failing because a file of the workspace could not be written.
- *the one durable record*: if the upsert did not land, the front is stale and `claimFronts` in the
  reader rebuilds it from the run store (below). This is what makes the loss self-healing instead of
  silent.

No lock is needed and no two advances can erase each other: there is one writer (the main process),
each call reads the file, merges one front by key, and writes atomically (temp file + rename, as
`runs-core.ts` does). Two activities advancing at the same instant are two keys.

### 5. An activity that never had a run (specification rule 8): recorded, not invented

The app records the reference when it is about to create the worktree and the run:
`create()` in `service.ts` records the front after the identity and the repository are known and
*before* `writeIssueRecord` — a start that fails afterwards leaves the bare entry (reference, title,
url, the instant) and a start that succeeds is replaced by the projection of the run. A start refused
before that point (branch exists, no identity, no repository) is not recorded: nothing existed to
lose. The entry stays until an execution of that activity exists; it is never removed by the sweep.
A bare front is rendered as "known, never started" (rule 8) and never as work in progress.

### 6. How a front reaches an agent, and how a call is not flooded (rules 5, 6, 7)

Two additions to what a call is told, used by every call site:

- `MentionInput.memory?: string` in `src/main/mentions/call.ts`, rendered as its own section beside
  the thread, between `<data>` tags, with a line that says in words that it is material of the app
  and not an instruction (rule 5). `answerMentions` (`src/main/mentions/answer.ts`) fills it before
  `mentionCall`, for every place: a run's thread, a squad channel, a general conversation and the
  direct conversation of an agent.
- `StageInput.shared?: string` in `src/main/runner/prompt.ts`, rendered as a section of its own after
  the cycle folder files. `executeStage` fills it. The per-run memory is untouched and stays where it
  is (first, in `files`).
- The chain calls (`chainCall` in `src/main/runner/chain.ts`, `requestCall`) get the same section for
  the run they are about, so an agent that answers a question about an activity also knows it.

The shared record is **shown, not dumped**: it is not added to `allowedTools` and no tool is offered
that would read it, because a tool would let the model fill its own context without the app's limit
(and the open engine offers exactly the names the call was given). The selection is:

- **Named activity** (the ref, its title, or the number it carries): the whole front, once.
- **Named agent**: that agent's front, plus its thumbnail if it points at another activity.
- **Nothing named**: one compact line per activity in progress, with a closing line that says the
  person may name one to see it whole (rule 7). Nothing else — the field is filled by name, and
  an ordinary mention that names nobody says no activity of the shared record.
- **Every call of a stage**: the front of its own activity in full, because a stage is about a known
  activity and the rule allows it ("the cut may not cut the front of the activity in question"), plus
  the compact list of the others. `renderFronts` applies the caps: at most the compact lines fit in
  `SHARED_MAX` characters, and the front of the activity in question is never cut (never dropped
  first); a front that does not fit is truncated with a line that says it was.

`SHARED_READ_MAX` and the per-call cap are named constants in the module and pinned by tests, and the
counts are written into the log (`[shared] {n} fronts, {chars} chars`) so they can be read back later
instead of guessed.

Who may read what: the selection is built from the arguments of the call — the ref of the place
(`MentionPlace.ref`, already resolved by `placeOfThread` from a run's thread or a card under
discussion, `src/main/mentions/place.ts`) and the agent ids named in the message
(`parseMentions`, already used). A message from a person who names an activity it did not open is not
answered from the field: the field is filled by name, and the compact list already carries what "is
the QA testing" amounts to. That is a deliberate cut, and its reason is context: a name a message
carries is not enough to open the whole record to that call.

### 7. Who is "an agent outside the run"

This is the gap the issue reports, and it is handled explicitly:

- a mention outside a run's thread is answered by `mentionsModule` (`src/main/mentions/module.ts`)
  through `answerMentions`, so the section reaches it and no `cwd` is needed;
- an agent that is already working in a run (the QA of the report) hears a message through the stage
  inbox (`openInbox`, `src/main/runner/inbox.ts`): `onMessage` (`service.ts`) hands the text to the
  agent as its next step. That text now carries the sentence "the shared record of the activities was
  moved after you last read it; ask for the activity by name if you need to read it again" — a
  message, never a second copy of the record — which is what makes the QA of the report answer with
  the stage the activity is in;
- a conversation between two agents (`conversation.ts`, `CallAgent`) gets the section for the run it
  is happening in.

### 8. Two reads that touch nothing they should not

Two rules the implementation must keep, named here because they touch channels that write files:

1. **No read of the worktree.** The section is built from the index and the run file, never from a
   cycle folder; an agent's `Read`/`Grep`/`Glob` stay confined exactly as they are
   (`readConfinedHooks` in `src/main/runner/hooks.ts`) and the index is never added to `extraDirs` or
   to a confinement's `roots`.
2. **The index is not public content.** `renderFronts` masks through `redact`
   (`src/main/errorlog-core.ts`) like `issueRecord` does, because the index mixes text that came from
   the tracker, from the model and from the person.

### 9. The person sees it and corrects it without a model call (rules 13, 14)

- The runs screen (`src/renderer/src/screens/cycle/RunsScreen.tsx`, `runsApi.ts`) gets a section under
  the filters: one row per activity, with reference, title, stage, agent and where it stopped, read
  through a new channel `runs:activities` (read, open to a paired browser like every other read:
  `webPolicy.ts` refuses nothing under `runs:*`). No model call anywhere in the path.
- Each row opens a sheet in the same shape as the cycle memory's (`ArtifactView.tsx`): the front
  read-only, and editable. The person's version is saved through `runs:activitySave` with
  `source: 'person'`, masked and capped like `editMemory` does today
  (`service.ts:1131`). The front keeps the field `source`, so the rule "the record says the correction
  was the person's" is answered by the data and not only by a history entry.
- A correction survives the next projection: `frontOfActivity` keeps what the person wrote for the
  trailing text of a front whose `source` is `person` until the next advance of the run replaces it
  with the app's own words. This is the one merge rule in the module and it is pinned by a test.
- Corrections are not refused while an agent works: the file is not in the worktree and nobody races
  anybody for it (the refusal that exists today for the cycle memory, `memory-busy`, is about a file
  inside the worktree and does not apply).

### 10. Growth (specification rule 9 and 15)

The index never drops a front, and the renderer never presents an old front as work of now:

- a front whose `updatedAt` is older than `STALE_AFTER` (30 days, named constant) renders as
  "probably finished" together with what it records;
- `selectFronts` cuts by recency of the *render*, never by deleting: closed and old fronts are
  summarised into one closing line ("N older activities are in the record and were left out of this
  answer") so the answer stays bounded;
- the font of this record is the run store (one file per run, tens of runs, not the forum), so the
  size is not the issue that grows without end — what grows is the answer of a call, and that is what
  the caps bound.

The *product* question of what the record does with hundreds of activities after months is not
answered here and is not hidden: the total cap of the index (should an old front be summarised in a
new field?), whether the per-run `MEMORY.md` stays as a file of its own, and with what words the
release note says the change are in "Open questions and acceptance criteria" below.

### 11. Order of the work: four steps, each one green

`STEPS` in `src/shared/config/migrations.ts` does not move: this change adds no field to
`WorkspaceConfig` and therefore none of `src/shared/config/types.ts`, `defaults.ts` or `schema.ts`.
The schema of the index is its own file and its own version, read leniently: a file written by a newer
app is not used and never overwritten.

1. **The record and the projection.** `activities.ts` (shape, `frontOfActivity`, `folded`,
   `selectFronts`, `renderFronts`, the caps), the store and its schema against a path that comes in
   as an argument, the reader (`claimFronts`), and the upsert from `move()` and the async moves.

   *Tests* — file `test/activityIndex.test.ts`: a front exists once per reference and a second
   execution updates it (rule 1); the projection of a run says stage, agent, open question, last
   handoff, where it stopped and the instant (rule 2); the states of rule 3 each leave their mark,
   driven by `drive` of `test/helpers/runs.ts` with the pure moves; the person's correction survives
   the next projection (rule 14); a front older than `STALE_AFTER` renders as probably finished and
   is never dropped (rule 9); the index round-trips through the file and a newer version is refused
   (rule 11); the renderer cuts by name and by recency and counts the characters it used (rules 6, 7).

2. **The record reaches a call.** `MentionInput.memory`, the section of `prompt.ts`, that of
   `call.ts`, the selection at each place in `answer.ts` (run, channel, general, direct conversation),
   the stage of `executeStage`, the chain calls, and the notice to a working agent's inbox.

   *Tests* — file `test/sharedMemoryCall.test.ts`: an agent named in a general conversation, a squad
   channel, a run's thread and in its own direct conversation receives the front of the activity
   named in the message, and says no work is in progress only when the record has none; a question
   that names nothing receives the compact list and not the whole record; a stage receives the front
   of its own activity whole; an agent that works and hears a message is told the record moved;
   no file of the record is ever read by a tool (the section is text, and the call's allowed tools
   and extra directories are the ones of today).

3. **The person, without a model call (rules 13, 14).** `runs:activities` and `runs:activitySave` in
   `src/main/runner/module.ts`, the two methods of `runsApi.ts` and the section of `RunsScreen.tsx`
   with the sheet.

   *Tests* — file `test/run-web.test.ts` (the policy of the two new channels: reads open, the save
   open like every other `runs:*` move) and file `test/sharedMemoryFiles.test.ts` (the shape of the
   file: sorted, stable, deterministic, capped, masked). The interface itself is checked on the
   simulator at acceptance, with the data folder pointed at an empty one.

4. **The documentation and the release note.** `docs/runner.md` (a section on the shared record: where
   it lives, who writes it, what a call sees, how it is corrected), the `Unreleased` section of
   `CHANGELOG.md`, and `AGENTS.md` only if a rule there becomes false (it does not: the universal
   instructions do not describe where the memory lives).

   *Tests* — the gates of `CONTRIBUTING.md` (`npx tsc --noEmit`, `npx vitest run`,
   `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`), which is
   what CI runs, plus the build.

## Risks and how they are contained

| Risk | How it is contained |
|---|---|
| A move of a run starts failing because the index could not be written | The upsert never throws into the move; the failure is logged, and the reader rebuilds that front from the run store |
| Two advances at the same instant lose one | One writer (the main process), merge by key, atomic write; two activities are two keys |
| The file drifts from the run (a stage the front never learned) | The key field `runId` makes the reader able to project the current run again; the projection is pure and tested |
| The answer of a call grows with the number of activities | `SHARED_MAX` per call, the compact form by default, the full front only for what was named, old fronts summarised into a closing line, and the counts logged |
| An agent reads the index as an instruction | The section goes between `<data>` tags with a line that says it is material, the same rule the rest of the outside text follows |
| The index becomes a way out of the sandbox | Nothing of the index is added to `additionalDirectories` or to a confinement's `roots`; the section is text and the writes stay in `Actions` |
| The person corrects a front and loses it on the next advance | The merge rule keeps what a person wrote for a front it owns until the next advance; pinned by a test |
| The record enters a pull request | It lives in the workspace folder, and no path of the change writes into a worktree |

## Acceptance criteria of the specification

| # | Criterion | Where it is covered |
|---|---|---|
| 1 | The QA that did not know about the test | step 2 (the section at every place), checked on the simulator at acceptance |
| 2 | After a restart | rules of persistence in step 1 (the file is not a process state; nothing of the record is in memory only); the restart itself is checked by hand at acceptance (opening the app twice with the same data folder) |
| 3 | In parallel, the same state | the record is one file read by both callers; `test/sharedMemoryCall.test.ts` asks twice and compares |
| 4 | Neither worktree nor execution | the record is outside every worktree; removing a worktree does not touch it (pinned by the shape of the store: the front is keyed by reference, not by path) |
| 5 | Without a model call | step 3: the runs screen reads the record through a channel that runs no model |

Nothing in the plan is left uncovered; the three product questions below are not acceptance criteria.

## Open questions and acceptance criteria the plan does not settle

None of the three blocks the design; all three are visible on purpose.

1. **The scope of the first delivery** (specification question 1). This plan delivers the fronts, the
   thumbnails and the read screen together, agreeing with the recommendation of the spec: the
   criterion 1 is about an agent called *anywhere*, and an agent called outside a run is exactly the
   case that does not exist with less than the whole. If the answer is "the fronts and the read
   first", step 2 loses the places outside a run and criterion 1 is not met.
2. **Where the person edits** (specification question 3). This plan puts the correction on the runs
   screen, next to the list, in the same gesture as the cycle memory of today. As a maintenance
   operation under Settings it is the same server side and a different screen.
3. **The release note** (specification question 4). The plan writes one line under `## [Unreleased]`
   saying what changed for the person: the app now keeps a record of the activities that agents read
   wherever they are called and that survives a restart. The wording is confirmed before the release,
   as the spec asks.
4. **What the record does with hundreds of activities after months** (specification question 2) is
   *partially* answered above (nothing is deleted, old fronts are summarised in the answer, the
   render is bounded) and the part that is left — whether the file itself should summarise old fronts,
   and with what words — is a change of its own, with its own cycle, not a guess in this one.

## What was verified in this stage

By reading, in this stage: `src/main/runner/memory.ts` and `cycleFolder.ts` (the per-run memory and
its cap); `src/main/runner/executor.ts` (where the memory is read, born and written, and where the
stage text is built); `src/main/runner/prompt.ts` and `src/main/mentions/call.ts` (the two places
where a call is assembled, and what a stage sees today); `src/main/mentions/answer.ts` and
`src/main/mentions/module.ts` (every place a mention is answered outside a run); `src/main/runner/service.ts`
(`move`, `moveRun` from the runner, `settle`, `create`), `src/main/runs-core.ts` and
`src/main/runs.ts` (how the runs are stored and how a change is saved); `src/shared/runs/types.ts`,
`transitions.ts` and `schema.ts` (the state and every point of rule 3); `src/main/runner/module.ts`
(the channels of the runner), `src/main/webPolicy.ts`, `src/main/web.ts` and `src/shared/apiChannels.ts`
(what a paired browser may call and how a channel is registered); `src/main/runner/tools.ts`,
`src/main/agents.ts` (what a call is offered as a tool) and `src/main/engine/open/loop.ts`
(which names become tools); `src/renderer/src/screens/cycle/ArtifactView.tsx`, `runsApi.ts` and
`RunsScreen.tsx` (how the cycle memory is read, edited and listed today); `src/main/env.ts` and
`src/main/workspaces-core.ts` (the workspace folder and its entries); `src/shared/config/migrations.ts`
(`STEPS`, which this change does not move).

Not verified: nothing was executed; no test was run, no behavior was exercised, and the interface was
not opened. The whole document is a design read from the code above.
