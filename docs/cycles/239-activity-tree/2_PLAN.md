# Plan: the live activity as a tree of agents, sub-agents, called agents and reasoning

## What this plan is

The approved specification (`1_SPEC.md`, gate 1 passed on 2026-10-10: every open question settled with its recommendation, except Q5, where the switch is per workspace and is
changed from the computer **or from a paired browser**, like the shared memory's) asks that the floating button of running work and its "Agent tasks" panel show what each agent
does as a tree, with the model's reasoning as one closed line per turn, behind a per-workspace switch that is on by default. This document says where each piece lands in this
tree, in which order it is built, and which tests hold it. Every `file:line` below was read again on `0.9.0-beta.16` (the tree this branch sits on, with the shared memory of
#215 already in it, so the schema is 27 and the step of this plan is 27 to 28).

The shape of the answer, in five sentences:

- **A node is an activity run, and a run may have a parent.** The main log already keeps one ring of 200 lines per activity run. The tree makes each sub-agent and each called
  agent a run of its own, with a `parent` run id and a short `node` descriptor on each of its lines; the lines stay flat on the wire and the renderer builds the tree. Because
  every node has its own ring, a chatty child cannot push its parent's lines out, and parallel sub-agents cannot interleave: each one writes through its own handle.
- **The parent is carried the way the job already is.** `withActivityContext` / `beginActivity` (`src/main/activity.ts:182,194`) read an `AsyncLocalStorage`; the context gains
  the id of the node whose engine run is current. `askAgent` sets it around the engine, and also around the app tools it hands the engine, so paths A, B and C of the spec
  (an `@` mention, `CallAgent` in an answer, `CallAgent` from a stage) end in the same shape without each path knowing the others.
- **Reasoning is one line per completed turn.** The open engine calls a new `onThought` once with `Completion.reasoning`; the Claude SDK loop joins the `thinking` blocks of one
  turn and calls the same method once. The log masks it (`safeText`, 2,000 characters, cut with an ellipsis) before it is stored or emitted, and drops it when the switch is off.
- **The switch is `runner.showReasoning`, an optional boolean read as on when absent**, written `true` by migration step 27 to 28 and by the defaults, and put in the list a paired
  browser may change.
- **One tree component** (a DOM-free builder plus a thin React view) replaces the generic card, the call groups of the dock and the flat timeline, on the dock, the run screen and
  the inline panels; the badge counts top-level entries only.

## What will be built

| Feature (spec rule) | Where it lands |
|---|---|
| Wire fields `parent`, `node`, new kinds `thought` and `answer`, caps `ACTIVITY_THOUGHT_MAX` and `ACTIVITY_ANSWER_MAX` (11, 14, Q1, Q2) | `src/shared/activity.ts` (`ActivityKind` `:2`, `ActivityEntry` `:19`, constants `:40-42`), `reasoningOn` beside them |
| A node per run with a parent; a ring per node; eviction by tree; `get` by subtree; ring keeps the newest status line (1, 5, 17, 18) | `src/main/activity.ts` (`Run` `:32`, `evict` `:83`, `isDone` `:92`, `begin` `:97`, `get` `:153`), `RunActivity` gains `child`, `lend`, `thought`, `answer` |
| The parent carried through async work; nested context of one job joins the outer call (9, 10) | `src/main/activity.ts` (`Context` `:17`, `withActivityContext` `:182`, `beginActivity` `:194`, `beginCallActivity` `:203`), new `withActivityParent`, `currentActivity` |
| Lines that name the callee and topic, and the kind and task (6, 7) | `src/main/agents.ts` (`source` `:388`), new `lineOf` beside it |
| Sub-agents of the open engine as nodes, parallel ones apart (7, 8) | `src/main/engine/open/loop.ts` (`RunEvents` `:51`, `Agent` tool `:199-239`, `runAgent` `:377-421`), `src/main/agents.ts` (`runOpenEngine` events `:645-664`) |
| Sub-agents of the Claude SDK as nodes, by `parent_tool_use_id` (7, 8) | `src/main/agents.ts` (`runClaudeSdk` loop `:795-832`) |
| Called agents linked under their caller on the three paths; the answer excerpt; a refused call on the caller's line (6, 9, 10) | `src/main/agents.ts` (`runAgent` `:1432-1505`), `src/main/mentions/answer.ts` (`:348,360-378,384`), `src/main/mentions/converse.ts` (`:45-46`), `src/main/mentions/module.ts` (`:112`), `src/main/runner/service.ts` (`:1481`), `src/main/runner/conversation.ts` (`:121-225,325`), `src/main/runner/executor.ts` (`:1082`) |
| One thought per turn in both engines, masked and cut (11 to 14, 20) | `loop.ts` (`call` `:501-540`), `agents.ts` (`:656`, `:815`), `src/main/activity.ts` |
| The switch: type, default, schema, migration, who may change it (15, Q5, Q6) | `src/shared/config/types.ts` (`:5`, `RunnerConfig` after `sharedMemory` `:980`), `defaults.ts:37`, `schema.ts:584`, `migrations.ts` (`v27ToV28`, `STEPS` `:406`), `src/main/configScope.ts` (`WEB_EDITABLE` `:16-35`), `src/main/index.ts:284`, `runnerEdit.ts`, `RunnerSection.tsx` |
| The tree, its collapse state, the badge, the generic card removed (1 to 5, Q4, Q7, Q8) | new `src/renderer/src/activityTree.ts` (DOM-free), new `ActivityTree.tsx`, `activity.ts` (`mergeEntries` `:8`, `backfillLive` `:108`, `strayActivity` `:143`), `AgentActivity.tsx`, `JobsDock.tsx`, `useActivity.ts`, `activity.css`, `jobs.css` |
| Same tree on the run screen, the inline panels and the thread's call rows (12, Q7) | `screens/cycle/RunScreen.tsx:113,185`, `AgentActivity.tsx:88`, `screens/cycle/Thread.tsx:65` (`CallLine`) |
| The paired phone: same stream, the switch editable, backfill that keeps new children (16) | `src/renderer/src/activity.ts` (`backfillLive`), `configScope.ts`; nothing in `webPolicy.ts` or `web.ts` |
| Texts | `src/shared/i18n/en.json` and `pt-BR.json` (`activity.*`, `:198-221`), `ui-team.*.json` (`ui.runner.*`, `:308`) |
| Documentation | `docs/configuration.md` (the version lines and the history, in both languages), `docs/runner.md`, `CHANGELOG.md` under `## [Unreleased]` |

## Data

### The wire line (additive)

```ts
// src/shared/activity.ts
export type ActivityKind = 'tool' | 'text' | 'thought' | 'answer' | 'status';
export type ActivityNodeType = 'sub' | 'call';
/** What heads a node that is not an agent's own run. Both words are masked and cut in the main process. */
export interface ActivityNode { type: ActivityNodeType; label: string }

export interface ActivityEntry {
  /* seq, runId, jobId, role, at, kind, label, state?, call? as today */
  /** The run id of the node this one hangs under. Absent: a root of its job (a stage's agent, a ceremony's, an `@` call). */
  parent?: string;
  /** Present on every line of a sub-agent or called agent: type and the words that head it. Absent on an agent's own run. */
  node?: ActivityNode;
}
export const ACTIVITY_THOUGHT_MAX = 2000;   // Q1
export const ACTIVITY_ANSWER_MAX = 400;     // Q1
export const ACTIVITY_NODE_MAX = 120;       // the task / topic that heads a node, and the same clip inside a tool line
export const reasoningOn = (config: { runner?: { showReasoning?: boolean } | null } | null | undefined): boolean => config?.runner?.showReasoning !== false;
```

- **A node is a run, so its id is `runId`.** No new id type. A line carries `parent` and `node` on **every** line of the node, not only the first, because the ring drops the
  oldest lines and the first line (the "started" status) is the one a long node loses first; the cost is two short strings on a line that already carries `role` and `label`.
  `node.label` is at most `ACTIVITY_NODE_MAX` characters.
- **`call` stays as it is** (present only on the lines of an `@` call, `src/shared/activity.ts:19-38`): the thread's call rows and the run screen's call header keep reading
  `callGroups`. A callee of path B or C carries `parent` and `node`, not `call`, so no new row appears under a message that did not name it.
- **`thought` and `answer` are kinds of their own** (Q2 and rule 9). `answer` is the masked excerpt of a called agent's reply, always the last line of a call node and never
  emitted by an engine, only by the code that posts that reply (below). `runActive` and `isDone` look at status lines only, so neither kind changes whether a node is working.
- **The `node.type` of an agent's own run is not sent**: a line with no `node` is an agent's run. In the renderer the tree node has type `agent`, `sub` or `call`.
- Roles: a sub-agent's `role` is `<parent role>:<kind or definition name>` (the same string the open engine already gives usage, `loop.ts:392`); a callee's `role` is its agent
  id, as today (`agents.ts:1432` `call.label`; `conversation.ts:312` `label: deps.called.id`). The renderer still never reads `role` for logic, only to name an agent node.

### The main log (`src/main/activity.ts`)

- `Run` gains `parent: string | null`, `node: ActivityNode | null`, and keeps `jobId` and `callId`, which a child **copies from its parent run** when it is made (not from the
  async context), so a tree is always one job and one call. `begin`'s options gain `parent` and `node`; `emit` (`:103`) adds `parent` and `node` to each line when set.
- **A ring per node is what exists**: `ring` is per `Run` (`:107`). Children are runs, so a child's lines can never evict a parent's (rule 18), and a node keeps its own 200.
  One guard is added because a long node used to lose its "started" line first and then read as finished: when the ring trims, the **newest status line is kept** and the
  oldest other line goes. The ring still holds 200 lines plus at most that one status line.
- **Eviction counts trees.** `evict` (`:83`) counts roots (runs with no parent); `maxRuns` stays 60 and finished-first order stays. A tree is finished when every node in it is
  finished (`isDone` `:92`, over the tree), so a finished root with a callee still working is not dropped, and a finished child of a live entry never is (rule 18). A tree goes
  whole, oldest first. The existing allowance stays: a live root is dropped only past `2 * maxRuns`. A second cap bounds memory in a large fan-out: `maxNodes` (new option,
  default `4 * maxRuns` = 240, question 5); past it the oldest finished tree goes whole; a live tree is never trimmed.
- **`get(id)`** (`:153`): a run id answers that node **and its descendants**; a job id answers the runs of the job as today (the latest call, plus anything still going)
  and, because a child copies its parent's `jobId` and `callId`, their children come with them; `null` answers the runs no job asked for. The final
  `.slice(-ring)` over all lines is removed: it would let a child's lines push a parent's out of the backfill. Each node's own ring already bounds the answer (rule 18).
- **Handles.** The log keeps `Map<runId, RunActivity>` so `currentActivity()` can answer the node the async context names (used for the refusal line, below); the map
  entry goes when its run does.

`RunActivity` (`:24`) becomes:

```ts
export interface RunActivity {
  readonly id: string;
  tool(label: string): void;
  text(text: string): void;
  thought(text: string): void;                       // masked, ACTIVITY_THOUGHT_MAX, dropped when the switch is off
  answer(text: string): void;                        // masked, ACTIVITY_ANSWER_MAX
  blocked(label: string): void;
  status(state: Exclude<ActivityState, 'blocked'>, detail?: string): void;
  child(node: ActivityNode, role?: string): RunActivity;   // a node under this one: same job, same call; the opener says "started" or "queued"
  lend(): RunActivity;   // a view whose finished and failed are ignored: one engine run that is a round of a longer exchange (path C)
}
```

`createActivityLog` options gain `thoughts?: () => boolean` (default `() => true`) and `maxNodes`. `src/main/index.ts:284` points the process log at the workspace:
`setThoughtsGate(() => reasoningOn(getConfig()))`, next to `setActivitySink` (`getConfig` is imported there, `:40`). The gate is read when a thought is made, so turning
the switch off or on takes effect from the next thought; what is already in memory ages out (rule 15).

### The renderer store (`src/renderer/src/activity.ts`)

- `mergeEntries` (`:8`) caps **per run id** instead of the bucket as a whole: a node keeps its newest `cap` (200) lines, so a child's lines never push the parent's out of the
  bucket. The existing call `mergeEntries([], many, 5)` (all one run) behaves as before. A bucket also drops whole finished trees past 240 distinct runs, the main log's rule.
- `backfillLive` (`:108`) keeps an entry when its run was already here, **or** is still going, **or its chain of parents reaches a run that is** (a fixed point over `parent`).
  Without the last clause a sub-agent that began and ended during a dropped stream would be filtered out and the phone's tree would differ from the window's (rule 16).
- `strayActivity` (`:143`) and `callGroups` (`:49`): `callGroups` stays (the thread's call rows and the run screen's header read it); `strayActivity` is replaced by
  `topEntries` (below) and removed with its test.

### The tree module (new `src/renderer/src/activityTree.ts`, DOM-free like `activity.ts`)

```ts
export type NodeState = 'queued' | 'working' | 'finished' | 'failed';
export type TreeItem = { type: 'line'; entry: ActivityEntry } | { type: 'node'; node: TreeNode };
export interface TreeNode {
  id: string; parent: string | null; type: 'agent' | 'sub' | 'call';
  role: string; label: string; call: ActivityCall | null;
  state: NodeState; since: number;
  items: TreeItem[];        // its own lines and its child nodes, in the order they began (by seq)
  children: TreeNode[];
  latest: ActivityEntry | null;   // its newest own line
}
export interface TopEntry { key: string; kind: 'run' | 'conversation' | 'agent'; id: string; nodes: TreeNode[]; since: number; latest: ActivityEntry | null }
export function buildTree(entries: readonly ActivityEntry[]): TreeNode[];                       // roots, oldest first
export function topEntries(all: ReadonlyMap<string, readonly ActivityEntry[]>, owned: ReadonlySet<string>): TopEntry[];
export const stepText = (e: ActivityEntry, word: string): string => (e.kind === 'thought' ? word : e.label);
export function createTreeView(): { open(id: string, def: boolean): boolean; toggle(id: string, def: boolean): void; subscribe(l: () => void): () => void };
```

- `buildTree` groups lines by `runId`, links by `parent`, orders a node's items by `seq` (a child's position is its first retained line), and derives `state` from the newest
  non-blocked status line (the rule `runActive` already has, `src/shared/activity.ts:62`): `queued`, `started`/`resumed` is working, `finished`, `failed`. A node whose parent
  is not in the list (a backfill that missed it) becomes a root of its bucket: nothing lands outside the tree.
- `topEntries` is the badge's source (rules 1, 3, 4). Per bucket not in `owned` (the keys of running renderer jobs): `run:<id>` makes one entry of kind `run`,
  `mention:<thread>` one of kind `conversation`, any other key (including `''`, the runs no job asked for) makes **one entry per root node**, of kind `agent`, named for
  the agent (Q8). An entry exists only while some node of it works (itself or a descendant); a finished child stays inside it for as long as it does (rule 5, Q4) and leaves with it.
  An entry's `latest` is the newest line anywhere in its tree (question 6).
- `createTreeView` holds the collapse state outside any component, so it survives the panel closing and new lines arriving (rule 2): an explicit open/closed choice per node
  id (and per thought line id `runId:seq`), else the default (question 1: the top entry is collapsed; an agent's own node is open; a sub-agent or called node is collapsed).

## Configuration and migration

The schema is 27 in this tree (`src/shared/config/types.ts:5`, the header comment of `:1`, `schema.ts:6`). `STEPS` ends at `26: v26ToV27` (`migrations.ts:406`); `v26ToV27`
(`:400-405`) wrote `runner.sharedMemory = false`. So the step is **`v27ToV28`** and the version **28**. Open pull request #229 also adds a step to the same chain; whichever
of the two lands second renumbers its step and every number below (risk 1). Pull requests #231, #232 and #238 take no step but edit files this delivery also edits
(`webPolicy.ts`, `runner/service.ts`, `docs/`): textual conflicts to resolve at the rebase.

| Field | Type and meaning | Default |
|---|---|---|
| `runner.showReasoning?` | boolean. On: a turn that reasoned leaves one closed "Thought" line in the activity, on every screen and on the paired phone. Off: none is made, stored or sent. Optional: absent reads as **on** (`reasoningOn`) | `true` in `neutralRunner()` (`defaults.ts:37`, after `sharedMemory: true`) |

- **The step** (`migrations.ts`, after `v26ToV27`; `STEPS[27] = v27ToV28`; the history comment at `:44-49` gains `v28`): writes `runner.showReasoning = true` into an existing
  document **whatever the chain seeded**, as `v26ToV27` writes `false`: a v27 file cannot carry a stored choice (the field is new), so the only value on the way is the neutral
  one; writing it makes the choice visible and means a later change of the default does not flip a workspace that already decided (Q6). It touches nothing else and raises no
  permission. It leaves a note, because this one shows more to the people who see the stream: `'the activity shows the reasoning of the agents as a closed line; turn it off in Settings › Runner'`.
  A document whose `runner` is not an object is only bumped (as `v26ToV27` does). A second start changes nothing (`changed` false).
- **`CONFIG_SCHEMA_VERSION = 28`**, the header comment of `types.ts:1` ("schema 28") and the one of `schema.ts:6`.
- **`types.ts`**: `RunnerConfig` gains `showReasoning?: boolean` after `sharedMemory` (`:980`), with a comment in the style of its neighbours. **`schema.ts`**: `runner.showReasoning`
  after `runner.sharedMemory` (`:584`), `boolean(...)`, optional, description "…The computer and a paired browser change it. Optional: absent reads as on."
  `test/config-schema.test.ts` fails when the schema, the defaults and the types drift and `test/runner-config.test.ts:12` requires the schema's runner keys to equal
  `neutralRunner()`'s, so types, defaults and schema move in one commit.
- **Who may change the switch.** `'runner.showReasoning'` goes into `WEB_EDITABLE` (`src/main/configScope.ts:16-35`, after `'runner.sharedMemory'` `:33`) and the comment block
  above it (`:11-12`, which already says `runner.sharedMemory` is in on purpose) gains one sentence for this switch: the maintainer decided the phone changes it (gate 1, Q5) and
  it opens no tool, host or file. `covered` then admits the path and nothing else. In the renderer, `runnerOfWeb`
  (`src/renderer/src/screens/team/runnerEdit.ts:112`) **must not** restore `showReasoning` from `stored` (it restores `procedures`, `flex` and `unconfined` and, deliberately,
  not `sharedMemory`); `RunnerDraft` (`:46`) gains `showReasoning: boolean`, `draftOfRunner` (`:76`) `showReasoning: reasoningOn({ runner: r })`, `runnerOf` (`:102`)
  `showReasoning: d.showReasoning`. `RunnerSection.tsx` draws the toggle in the first block beside `sharedMemory` (`:162-163`), in both modes; the read-only `<dl>` that a
  paired browser sees (`WebOnComputer`) does not list it. Texts: `ui.runner.showReasoning` and `ui.runner.showReasoningHint` in `ui-team.en.json` / `ui-team.pt-BR.json` beside
  `ui.runner.sharedMemory` (`:308`), the hint saying that reasoning can quote files and tool output, that the masking catches shapes of credentials and secret-file paths and not
  meaning, and that it is off for nobody until the person turns it off.
- **`docs/configuration.md`**: the two lines that name the version (`:9`, `:164`) become "versão do esquema 28)" and "schema version 28)"
  (`test/docs-schema-version.test.ts` requires exactly `versão do esquema N)` and `schema version N)`); the two tables that give `schemaVersion: 27` (`:15`, `:170`) become 28;
  a `v28` entry at the end of the history paragraph of both languages (`:51`, `:205`, after the `v27` entries); `showReasoning` is added to the `runner` rows (`:46`, `:200`).
- **Tests that pin the number or the neutral runner** (looked at now):
  - `test/config-migrations.test.ts:864-867` (the "newest step" test: 27 is current and 28 is refused become 28 and 29); a new
    `describe('schema 27 to 28: the reasoning switch')` after the `'schema 26 to 27: …'` one (`:801`), modelled on it: an existing workspace gets `true`; a file that already
    says `false` is written `true` (it cannot be a stored choice at v27) and a second start changes nothing; a document without `runner` is only bumped; the result validates; the
    note is left; a file from the first versions and a legacy install both end with `true`.
  - The tests that compare a migrated file with the one it came from, found by reading the same pattern and not run: `:486`, `:527`, `:651` and `:835` build their `before`
    from `neutralConfig()`, which now carries `showReasoning: true`, and the chain writes `true`, so they stay equal; the `v26()` helper at `:802` deletes `showReasoning` the
    way the new `v27()` helper must, and `:835` gains `showReasoning: undefined` in its override like `sharedMemory` did.
  - `:21` (`existing()`), `:161`, `:241`, `:339` and `test/runner-config.test.ts:125,139` compare against `{ ...neutralRunner(), procedures: false, sharedMemory: false }`: unchanged,
    because the migrated value (`true`) equals the neutral one. `test/runner-config.test.ts:12` (the literal of `neutralConfig().runner`) gains `showReasoning: true`.
  - `test/team-runner-edit.test.ts:12` (the `RunnerConfig` literal gains `showReasoning`, because the draft round trip writes it) and a sibling of the cases at `:52-59`: the draft
    carries `showReasoning`, an old config without the field reads as **on**, and `runnerOfWeb` does not restore the stored value.
  - `test/config-schema.test.ts` next to `:53-56` (type boolean, on for a new workspace, a string is rejected by path); `test/config-web-scope.test.ts` next to `:103-114`
    (see the test plan). `test/docs-schema-version.test.ts` needs no edit; it is the guard that the docs lines move with the number.

## Flow

### The parent travels with the work

```ts
// src/main/activity.ts
interface Context { jobId: string | null; callId: string; parent: string | null }
export const withActivityParent = <T>(runId: string, fn: () => T): T => als.run({ ...(als.getStore() ?? { jobId: null, callId: randomUUID() }), parent: runId }, fn);
export const currentActivity = (): RunActivity | null => /* the handle of als.getStore()?.parent */;
export function beginActivity(role: string, isSecretPath?, o?: { node?: ActivityNode }): RunActivity;  // parent = the context's
```

- `beginActivity` (`:194`) passes the context's `parent` and `o.node` to `begin`; with no parent it makes a root, exactly as today. `beginCallActivity` (`:203`, path A) takes
  a `node` too and never a parent.
- **`withActivityContext` joins an outer call of the same job** (`:182`): inside a context for the same `jobId` it returns `fn()` as it is, without a new `callId` and without
  `startCall`. Without this, path B's `withActivityContext(...)` at `answer.ts:380` would make the callee's call the job's "latest invocation" and a later backfill would drop the
  caller (`get`, `:153-163`, keeps only the latest call's runs and runs still going), orphaning the tree. A different job still starts its own call.
- **`askAgent` sets the parent around the engine** (`src/main/agents.ts:1432` makes or receives the call's `activity`): the `runnerFor(picked)<T>(request)` call at `:1500` runs in
  `withActivityParent(activity.id, …)`, and `runnerTools: only ? undefined : call.runnerTools` (`:1492`) is mapped so that each `ToolImpl.run` runs in
  `withActivityParent(currentActivity()?.id ?? activity.id, …)`. The second is the one that matters on the SDK: the in-process tool server answers from the SDK's own
  callbacks, and whether the async context survives that transport is not verified (risk 2); closing over `activity` does not depend on it. The `currentActivity()` part keeps a
  plain sub-agent of the open engine pointing at its own node (below).

### The three paths end in one shape

| Path | Where the callee is made | Parent | `node` | Excerpt |
|---|---|---|---|---|
| A: `@` mention | `beginCallActivity` when the message is accepted: `service.ts:1481` (job `run:<id>`) and `mentions/module.ts:112` (job `mention:<thread>`) | none: a root of the job, beside any working agent | `{ type: 'call', label: message text }` | `made.activity.answer(text)` after the reply is posted, `answer.ts:384` |
| B: `CallAgent` in an answer | `ask` (`answer.ts:364-373`) makes the node and hands it to `answerMentions` as `callOf` | the context's: the caller's node | `{ type: 'call', label: topic }` | same line as A (`callOf` is the mechanism A already uses) |
| C: `CallAgent` from a stage | `runConversation` (`conversation.ts:121`), once per conversation, when the caller's first message is known (`:175`) | the context's: the stage's node | `{ type: 'call', label: first message }` | `node.answer(turn)` after each round that answered (`:204-219`) |

- **A.** Only the `node` is new at both call sites (the message text, clipped and masked by the log). Everything else is today's: `call` stays on the lines, `callGroups` keeps working.
- **B.** `ask` does, in order: post the forum message as today; `const node = beginActivity(to, secret, { node: { type: 'call', label: topic } })` (the parent comes from the
  context, which the tool wrapper above guarantees); `node.status('started')`; `answerMentions(place, asked, { ...deps, calls: [to], chain, callOf: () => ({ activity: node, queued: false }), release: undefined })`.
  `callOf` is the door A uses: `answer.ts:348` gives the node to the engine as `call.activity`, so `askAgent` does not start it again (`agents.ts:1434`), the hold path (`:198`) and
  the failure path (`:396`) already end it, and `:378`'s `queued` branch is skipped. What `callOf` does not cover is `answerMentions` skipping an agent that left the team
  (`:189-192`) and the case where it returns with no answer: `ask` ends the node itself with `node.status('failed', …)` when no answer came back. The caller's clock pause
  (`answer.ts:366`) is untouched.
- **C.** A conversation is several rounds: `turnOf` (`conversation.ts:248`) runs the engine once per round (`:325`). One node for the conversation, not one per round:
  `runConversation` makes it and passes `node.lend()` to each round as `call.activity`, so a round's own `finished` or `failed` does not close it; the conversation closes it in
  its `finally` (`:222`): `finished`, or `failed` with the reason when a round threw. A follow-up message to a conversation already open (`executor.ts:1075-1078`) makes no node,
  and the caller's `CallAgent` line is its record. A reader's conversation runs detached (`executor.ts:1144`), so its node can still be working after the stage's node ended; the
  entry stays active (rule 5) and the tree shows it under the stage's agent.
- **The excerpt is what the conversation shows.** A and B: `answerText(...)`, the text posted at `answer.ts:384`. C: the round's `turn` (`conversation.ts:213-218`, which is posted,
  clipped to 2,000, by `turnOf`). The log masks and cuts it to 400. Nothing else becomes an `answer` line: a tool's output, a file's content and a **sub-agent's** final text
  (a tool result for its parent) never do (the part of the earlier rule that stays).
- **A refused call says so on the caller's line and makes no node** (rule 6). Both refusals are decided before any node would exist: `converse.ts:45-46` (cycle, cap) and
  `executor.ts:1082` (`callRefusal`). Each now also calls `currentActivity()?.tool(t('activity.callRefused.cycle' | 'activity.callRefused.cap', …))`, which appends a line to the
  caller's node right after its `CallAgent <callee>: <topic>` line (the log is append-only; question 2). The unknown-agent refusal is not in the spec's list and is left alone.
- **The words of the lines** (`agents.ts:388`, rules 6 and 7). `source()` is kept as it is: it also feeds the `sources` list a call returns, which `History.tsx:267` shows, and
  that list is not masked. A sibling `lineOf(name, input)` is what the activity uses (`agents.ts:648` and `:822`):

  - `CallAgent` (input `to`, `topic`): `CallAgent <callee>: <topic clipped to ACTIVITY_NODE_MAX>`, the callee as `getConfig().agents.team` names it, its id when the name is gone.
  - `Agent` (open engine input `kind`, `subagent_type`, `description`, `prompt`; SDK input `subagent_type`, `description`, `prompt`): `Agent <kind>: <task>`, where kind is
    `kind`, else `subagent_type`, else `agent`, and the task is `description`, else the first words of `prompt`, clipped. The node's `label` is the same words without the tool
    name (`explore: map the tests of X`), so "the same words head the sub-agent's node".
  - anything else: `source(name, input)`.
  The whole line then passes through `safeText` in `tool()` as every line does, so a credential shape or a secret-file path in a topic or a task is replaced there.

## Engines

### The open engine (`src/main/engine/open/loop.ts`)

`RunEvents` (`:51-63`) gains two members:

```ts
onThought?: (text: string) => void;                       // once per completed model turn that reasoned, with the whole text
onSubAgent?: (s: { kind: string | null; name: string | null; task: string }) => SubAgentHandle | undefined;
export interface SubAgentHandle {
  events: Pick<RunEvents, 'onToolUse' | 'onInterim' | 'onThought'>;   // what the child's own turns report to
  within<T>(fn: () => T): T;                                           // runs the child with the node as the async context's parent
  state(s: 'queued' | 'started'): void;
  end(failure?: string): void;
}
```

- **Sub-agents.** The `Agent` tool (`:199-239`) passes `input.description` to `runAgent` (`:377`), whose signature gains it. `runAgent` calls `events.onSubAgent?.(...)` first,
  synchronously, so the order of the nodes under a parent is the order the tool calls were run in. The nested `runOpen` (`:390`) is given
  `events: { ...events, ...handle.events }` for a plain sub-agent as well as for a kind (`:408` today passes `events` only for a kind and inherits the parent's `events` through
  `...p` otherwise): the child's `onToolUse`, `onInterim` and `onThought` land on its node; `onSwitch`, `onUsage`, `onText`, `onReasoning` and `onWait` stay the parent's, so a
  model-switch notice stays on the parent's line (rule 8) and usage and the sign of life are unchanged. The agents module's child `onToolUse` also calls `req.beat?.()`, as the
  parent's does (`agents.ts:647`), because the spread replaces the whole member.
- **Parallel and ordered kinds.** The tool calls of one turn run with `Promise.all` (`:650`); each `execute` (`:546`) reaches `runAgent` with its own handle, so each child
  writes through its own node and nothing is shared (not even the narration the log keeps pending). `edit`, `shell` and `screen` run one at a time through `inOrder` (`:372`,
  `:408`): their node is made at once with `handle.state('queued')` when another of them is open and `handle.state('started')` when its turn comes (the `queued` state is the one
  `activity.queued` already words, "Waiting its turn…"), and the node ends in the existing `try`/`catch` (`:407-420`): `handle.end()` on success, `handle.end(message)` on any
  throw, so a sub-agent that runs out of turns (`:416-419`) or is refused by budget reads as failed. `handle.within` wraps `sub()`, so a plain sub-agent's `CallAgent`, which it
  inherits (`:193`), hangs its callee under the sub-agent's node.
- **Thoughts.** `call()` (`:501`) already holds the completion; after the assistant message is written (`:530-532`), `if (c.reasoning?.trim()) events.onThought?.(c.reasoning)`.
  That is once per completed turn whichever way the server sent the reasoning (`reasoning_content`, `reasoning`, or a `<think>` block the splitter folded,
  `client.ts:100-127,187`), and it runs in the nested loop too, so a sub-agent's thought goes to its own node. A call retried after a context overflow (`:536-540`) threw before
  this point and makes no second line. `onReasoning` stays the per-piece sign of life and is **not** the source of a line.
- `agents.ts:645-664` (`runOpenEngine` events): `onThought: (text) => req.activity?.thought(text)` and
  `onSubAgent: (s) => req.activity ? openSubAgent(req.activity, req, s) : undefined`, where `openSubAgent` makes `parent.child({ type: 'sub', label }, role)`, emits its
  `started` or `queued` status, and returns the handle (`events` over the child's `tool`/`text`/`thought`, `within` over `withActivityParent(child.id, …)`, `end` over
  `child.status('finished' | 'failed', reason)`).

### The Claude SDK (`src/main/agents.ts`, `runClaudeSdk` loop `:795-832`)

- **Sub-agents.** The SDK marks a message produced inside a sub-agent with `parent_tool_use_id` (`sdk.d.ts`: "non-null when the message was produced inside a subagent started by
  that tool_use"), and by default forwards only the sub-agent's `tool_use` and `tool_result` blocks, not its text or thinking (`forwardSubagentText`, off by default).
  The loop keeps `nodes: Map<toolUseId, RunActivity>`. A `tool_use` block named `Agent` (or `Task`, the older name) makes a node with `req.activity.child({ type: 'sub', label }, …)`
  keyed by the block's id, and the parent still gets its `Agent <kind>: <task>` line. A message whose `parent_tool_use_id` is in the map writes its `tool_use` blocks (and its
  text and thinking when the SDK forwards them) to that node, so two parallel sub-agents never share a line. A `user` message with a `tool_result` for a mapped id ends its node
  (`failed` when `is_error`, else `finished`); at the `result` message and in a `finally`, any node still open is ended. The existing debug read of user messages (`:826`) stays
  as it is. The option stays unset (question 3): the request does not change, and a sub-agent's reasoning and narration are shown on the Claude engine only if the SDK sends them.
  The live order, the `parent_tool_use_id` of parallel sub-agents and the `Agent`/`Task` naming were read in the SDK's declarations and **not seen working** (risk 3).
- **Thoughts.** A `thinking` block (`block.thinking`) is gathered per message id: the SDK emits "one assistant message per completed content block", so a turn's thinking blocks
  arrive as separate messages with one `message.id`. The loop keeps `held = { owner, id, text }`; a thinking block with the same owner and id appends; a block of another kind, a
  message of another id and the `result` message flush it as **one** `thought(text)` on the owner (the node of `parent_tool_use_id`, else the call's activity), before the
  turn's `text` and `tool_use` are handled, so the line comes first. A `redacted_thinking` block, an empty `thinking` string or a missing one makes no line (Q3: use what
  arrives). The turn's narration and tools are handled exactly as today.

## Reasoning

- **One line, masked and cut in the log.** `thought()` (`activity.ts`) does: gate (`thoughts()`), trim, take the first 20,000 characters (a bound on what `redact` scans; the
  cut text is never shown, since the line keeps 2,000 after masking), then `safeText(text, ACTIVITY_THOUGHT_MAX, isSecretPath)`: one line, secret-file paths replaced,
  `redact()` (auth headers, tokens, JWT, key=value, URL credentials and queries, e-mails, opaque 32+ strings, home folder), cut with an ellipsis at 2,000. The start is kept
  (Q1). Masking comes first and the cut after, so a credential straddling the cut cannot be half-shown. The sink receives the masked line and so does `get`, so the window and the
  phone get the same text (rule 14, acceptance 6).
- **`answer()`** is the same with `ACTIVITY_ANSWER_MAX` (400) and is not behind the switch (it is not reasoning).
- **The closed line says only the word.** The renderer's `stepText(entry, word)` returns the translated word for a `thought` and the label for any other line. It is the one function
  the dock's collapsed text, a node's collapsed text, `AgentActivity`'s `act-now`, and `CallLine` in the thread (`Thread.tsx:68-69`) use for "the newest line", so none of them can
  print reasoning (rule 12). The text appears only in the opened thought row.
- **Switch off.** `thoughts()` false: nothing is created, so nothing is stored or sent, on the window or on a phone, whichever engine ran. Lines already in memory stay until they
  age out (rule 15). On: the next thought shows. Ceremonies are covered because the gate is in the log, not in a screen.
- **Volume.** One `emit` per turn that reasoned (rule 20): `onThought` is called from `call()` and from the SDK flush, never from a streamed piece.
- **The check Q3 asks for, outside the test suite.** One manual run with `CERIMONIAS_DATA_DIR` on an empty folder and a throwaway script that asks the Claude engine, with the models
  the workspace uses, a question that needs a tool, and prints the content-block types the loop sees (`thinking` and its length, `redacted_thinking`). It decides whether the
  Claude engine shows fewer thoughts than the open one; if the text is empty by default the follow-up is the maintainer's decision (request the summarized display, with its cost).
  No code of this plan depends on the answer.

## Renderer

### Components

- **`src/renderer/src/ActivityTree.tsx`** (new): `ActivityNodes` renders the items of a node: a line is an `<li class="act-step act-<kind>">` as `ActivityTimeline` draws it today
  (`AgentActivity.tsx:56-62`, time, `KindIcon`, label); a child node is an `<li class="act-node">` with a header `<button aria-expanded>` (chevron, a spinner while working, the
  title, the state word, and the newest own step while collapsed) and, when open, its own `<ol>`. A **thought** line is a row with a button that shows only `t('activity.thought')`;
  its text sits in a `<p class="act-thought-text">` rendered only when that row is open (the view store keeps it). An `answer` line shows the excerpt with its own icon.
  `nodeTitle(node, nameOf)` (in `activityTree.ts`): an agent node is the agent's name (`agentName(team, role)`, `screens/cycle/names`); a `sub` node is its label; a `call` node is
  `<name>: <label>`. The scroll-follow of the old timeline (`atBottom`, "Jump to the latest") stays on the outer list.
- **`AgentActivity.tsx`**: the head (title, newest step through `stepText`, elapsed) is as it is; the body is `ActivityNodes` over `buildTree(useActivity(jobId))`, agent nodes open
  (Q7: a screen that shows one agent's activity shows that agent's subtree, expanded). `ActivityTimeline` and `KindIcon` (`:9`, `:30`) are reused for a node's own lines; `KindIcon`
  gains a `thought` glyph and an `answer` glyph. **Run screen** (`RunScreen.tsx:185`): unchanged call site; it shows the whole bucket's tree, finished nodes included, until the run
  starts again (Q4), and keeps `callGroups` for its call header (`:115`).
- **`JobsDock.tsx`**: `Steps` (`:91`) and `JobSteps` (`:109`) are replaced by an entry view over `buildTree`; the call groups (`:261-278`) and the generic card (`:279-286`) are removed
  with `activity.generic`. `useStrayActivity` (`useActivity.ts:42`) becomes `useTopEntries(ownedKeys)` over `topEntries`, still backfilling `''` once. Renderer jobs keep their own
  items (`:287-302`) and their `JobSteps` is now the same tree of their bucket. The totals (`:139-140`) become
  `total = shown.length + tops.length` and `running = shown running + tops.length` (every top entry exists only while it works), which is what makes the badge a count of top-level
  entries at any depth (rule 4, acceptance 8). A `run` entry opens `openJob({ name: 'run', id, tab: 'forum' })` as the call item does today (`:262-271`) and shows the run's ref;
  a `conversation` entry is static as a non-run call is today and is titled by the agents working in it (question 7); an `agent` entry is static and titled by the agent.
- **`Thread.tsx` (`CallLine`, `:65`)**: its step text goes through `stepText`; nothing else. **`Today.tsx`'s** bell and `JOBS_OPEN` are untouched.
- **CSS** (`activity.css`, `jobs.css`): `.act-node`, `.act-node-head`, `.act-thought`, `.act-thought-text` (`white-space: pre-wrap`), `.act-answer`, an indent as a `border-left` plus
  `padding-left` per level, all with the tokens the files already use (`var(--line-2)`, `var(--muted)`, `var(--red-ink)`, `var(--link)`, `color-mix(in srgb, currentColor …)`); a
  `prefers-reduced-motion` rule beside the chevron's. Targets keep the 44px height the dock's buttons have. `node scripts/theme-audit.mjs` is the gate.
- **i18n**, in both `en.json` and `pt-BR.json` (the `activity.*` block, `:198-221`, which the main process also reads): added `activity.kind.thought`, `activity.kind.answer`,
  `activity.thought`, `activity.thought.show`, `activity.thought.hide`, `activity.node.show`, `activity.node.hide` (with `{name}`), `activity.node.state.working|queued|finished|failed`,
  `activity.conversation.entry`, `activity.run.entry`, `activity.callRefused.cycle`, `activity.callRefused.cap` (main side); removed `activity.generic` (and
  `activity.call.entry` when nothing reads it any more, found by a grep in the commit). `ui.runner.showReasoning` and `…Hint` in the two `ui-team` catalogs.
  `npm run i18n:lint` and the catalog-parity tests are the gates.
- **What cannot be tested.** There is no `.tsx` test (`vitest.config.ts:12` is `environment: 'node'`), so every decision above the React layer is in `activityTree.ts` and
  `activity.ts`, tested as plain functions; the components only map that output to markup.

## Paired phone

- **Same stream, nothing filtered.** The sink emits to the window and to every paired browser (`index.ts:63-66`, `web.ts:373-376`), `agent:activity:get` is open (`webPolicy.ts`,
  no rule names it), and masking and the switch happen in the log, before either. Nothing in `webPolicy.ts`, `web.ts` or `index.ts`'s emit changes, and a test pins that
  `webAccess('agent:activity:get')` is `allow` and the channel is in neither `DESKTOP_ONLY` nor `EXTERNAL_EFFECT`.
- **The switch** is editable from a paired browser (`WEB_EDITABLE`, above); `config:cycle-save` already admits the paths of that list and nothing else (`configModule.ts`
  through `refusedPaths`, `configScope.ts`), so adding the path is the whole policy change.
- **The tree** is the same renderer code in the browser bundle. After a reconnect `EVENTS_RECONNECTED` fetches again and `backfillLive` keeps the new children (above).
  A phone opened fresh in the middle of a run holds nothing for a `run:<id>` bucket until a line arrives or the run screen asks (the dock backfills only `''` today); that is
  today's behaviour and is left as it is (risk 8).

## Order of the work: commits

Every commit leaves `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` and `node scripts/public-audit.mjs` green. `feat:` / `fix:`,
lowercase, imperative, no trailing period; the identity by `git -c user.name=… -c user.email=…` only; no attribution trailer.

0. `feat: add the plan of the activity tree` (this file alone, after the spec).
1. `feat: add the reasoning switch to the configuration` (schema 28, `v27ToV28`, defaults, schema, `WEB_EDITABLE`, runner section toggle, `ui.runner.*`, `docs/configuration.md`,
   the tests that pin the number and the neutral runner). Nothing reads it yet.
2. `feat: give the activity log nodes, a ring per node and the new kinds` (`shared/activity.ts`, the main log: `parent`, `node`, `child`, `lend`, `thought`, `answer`, eviction by tree,
   `get` by subtree, newest status kept, `withActivityParent`, `currentActivity`, `withActivityContext` joining, the thoughts gate and its wiring in `index.ts`; the renderer store's
   per-node cap and `backfillLive`; `stepText`, `KindIcon` glyphs and `activity.kind.*` so a thought can never print as a label on the flat list). Nothing emits the new things yet.
3. `feat: show each sub-agent as a node of its own in both engines` (`onSubAgent`, `lineOf` for `Agent`, the open loop's handle, the SDK's `parent_tool_use_id` routing; `queued` for
   the ordered kinds). A flat renderer still shows a sub-agent's lines, now under distinct run ids.
4. `feat: link called agents under the agent that called them` (parent through `askAgent` and the tool wrapper, `lineOf` for `CallAgent`, the three paths, the excerpt, the refusal
   line, the `lend` of a conversation).
5. `feat: show the reasoning of each turn as one closed line` (`onThought`, the SDK thinking join, the masking and the cap, the tests of the switch).
6. `feat: show the activity as a tree on the dock, the run screen and the inline panels` (`activityTree.ts`, `ActivityTree.tsx`, `JobsDock.tsx`, `AgentActivity.tsx`, `Thread.tsx`'s
   step text, `useActivity.ts`, CSS, i18n; the generic card removed; the tests of the tree and of the badge).
7. `feat: document the activity tree and the reasoning switch` (`docs/runner.md`, the `CHANGELOG.md` entry under `## [Unreleased]`: the panel is a tree, each turn's reasoning is a
   closed line, the switch in Settings › Runner, on for every workspace).

Commits 3 to 5 touch the same engine files and 4 the mentions and the runner; each is rebased onto the release branch before it is pushed and the schema number of commit 1 is
looked at again then.

## Test plan

No test reaches a model, a code host or the network; fakes are in `test/helpers/` (`fakeOpenAI.ts`: `textStep` takes `reasoning` and `reasoningField`, `toolStep` takes several calls,
a script may be a function of the request; the SDK tests replace `query`). Anything exploratory runs with `CERIMONIAS_DATA_DIR` (and `CERIMONIAS_SPECS_DIR`) on an empty folder, which
`test/setup.ts` already gives each file. Harness shapes below were read, not run.

**New files**

| File | Holds |
|---|---|
| `test/activity-tree.test.ts` | The DOM-free module. `buildTree`: lines grouped by run, children linked by `parent`, items ordered by `seq` (a child sits where it began), a node whose parent is missing becomes a root, states from the newest non-blocked status (`queued`, working, finished, failed). **Three parallel children never interleave:** raw `seq` order across the children is deliberately mixed in the fixture and the test asserts it is mixed (so a flat merge would fail it), then that each child holds only its own lines and the parent none of theirs. `topEntries`: a run, a conversation, two sub-agents and a called agent count **2** whatever the depth; a bucket owned by a running job is left to the job; the `''` bucket gives one entry per root, named for the agent; no entry without a working node; a finished child stays while its parent works and goes with the entry. `stepText` returns the word for a thought and the label otherwise, and a thought newest in a node or an entry never prints its text. `createTreeView`: default open/closed by depth, an explicit choice survives new lines and a store `add`, a thought row's choice is separate. |
| `test/activity-subagents.test.ts` | Open engine through `runOpen`/`askAgent` against `fakeOpenAI`: a stage that delegates to three `explore` sub-agents in one turn (`toolStep` with three `Agent` calls, and per-request delays so their completions arrive reversed) gives three child nodes under the stage's node, each with the `explore: <task>` label, each with only its own tool lines (distinct file arguments), `parent` = the stage's run id, a `started` and a `finished` status each, the usage unchanged. `edit`/`shell` kinds: the second node is `queued` until the first ends (the order test of `engine-open-subagent.test.ts:276` as the harness). A sub-agent that runs out of turns ends `failed`. A model-switch notice for a delegated kind stays on the parent's line. SDK through the scripted `query`: two `Agent` tool uses, then interleaved sub-agent messages carrying each `parent_tool_use_id`, and `tool_result`s closing them out of order; each line lands on its own node, an `is_error` result fails its node, a node left open at `result` is closed. |
| `test/activity-calls.test.ts` | The three paths over the real `askAgent` and `fakeOpenAI` (scripted by request, as `agent-activity-open.test.ts:30-45` does): **(A)** `answerMentions` for an `@` of a run's thread: a root node with `call` and `node.label` = the message text, beside the stage's node; **(B)** an answer whose model calls `CallAgent`: a node under the caller with `node.label` = the topic and no `call`; **(C)** a stage whose model calls `CallAgent` through `runConversation`: one node under the stage's node for several rounds, not closed between rounds (`lend`), closed once at the end, failed with the reason when a round throws. **Three levels:** an agent calls a second that calls a third; `buildTree(activityLog.get(job))` has depth 3, each `parent` is the caller's run id, each caller's line reads `CallAgent <name>: <topic>`, and each callee ends with an `answer` line equal to the posted text, masked and cut to 400. A refused call (a callee already in the chain, over the per-stage cap) adds the refusal line to the caller and creates no node, on B and on C. Same content on all three paths (acceptance 3). A failing callee reads failed with its reason. A callee that left the team ends its node. |
| `test/activity-thoughts.test.ts` | Open engine: a turn with reasoning pieces (`reasoning` in `textStep`, both field names, and a `<think>` block) is **one** `thought` line before that turn's tool lines; a turn without reasoning makes none; the narration rule is untouched (`≡` still appears only when a tool follows); a sub-agent's thought sits on its node. SDK: three `thinking` blocks of one message id are one line, an empty block, a `redacted_thinking` block and a turn with none make no line, the thought comes before that turn's `text`/`tool_use`. Masking: a credential shape and a secret-file path are replaced, a long thought is cut at 2,000 with an ellipsis, a thought longer than the 20,000-character scan bound still ends with the masked start, and what the sink receives equals what `get` returns (the phone's backfill). Switch: off makes no line from either engine, nothing reaches the sink, lines made earlier stay, on again shows the next turn's. The existing leak assertions gain the new kinds: a tool result, a file's content and an environment value never appear in any `thought`, `answer` or label, and the closing answer never appears as a step of its own callee. No file under the data folder holds the marker of a thought (the open session file is written with `sessionsDir: null` in this test, because the principal's own session file keeps its reasoning today, `loop.ts:333-337`, which this plan does not change). |
| `test/activity-policy.test.ts` | `webAccess('agent:activity:get')` is `allow`; the channel is not in `DESKTOP_ONLY` or `EXTERNAL_EFFECT`; `WEB_EDITABLE` contains `runner.showReasoning`. Small on purpose: the phone's behaviour is the stream's. |

**Existing files that change**

- `test/agent-activity-core.test.ts`: a child run of the same job shares its parent's job and call; **a child that emits more than the ring keeps its newest lines and the parent
  keeps all of its own** (acceptance 11); `get(runId)` answers the subtree and `get(job)` has no overall slice; eviction: with more than 60 trees the oldest finished tree goes
  whole, a finished child of a live tree is never dropped, a finished root with a working callee is kept, `maxNodes` drops a finished tree and never a live one; the ring keeps
  the newest status line; `withActivityContext` of the same job inside another joins it (same call, `latestCall` unchanged) and a different job does not; `withActivityParent`
  is seen by `beginActivity` across awaits and parallel work (as `:148` does for the job); the thoughts gate; `thought()` and `answer()` caps. The tests at `:28,38,50,64,75,92`
  stay as they are.
- `test/activity-store.test.ts`: `mergeEntries` caps per run (the existing cap test stays), a child's flood leaves the parent's lines, `backfillLive` keeps a child that began and
  ended in the gap when its parent is live, and does not stitch an old run in; `strayActivity` cases move to `topEntries` in the new file.
- `test/agent-activity-open.test.ts`, `test/agent-activity-sdk.test.ts`: the existing lines are unchanged (no optional field appears on a root run), and the leak tests gain the
  new kinds. `test/mentions-module.test.ts:75-85`: the lines of the call carry `node.label` = the message text and still `call`; `test/runner-lifecycle.test.ts:967` stays as it is.
- `test/engine-open-subagent.test.ts`: `onSubAgent`'s handle is called once per sub-agent, in order, with the kind and the task; a harness without the member behaves as before.
- `test/runner-conversation.test.ts`: the node per conversation, rounds, the excerpt per round, the refusal line.
- Configuration: `test/config-migrations.test.ts`, `test/runner-config.test.ts`, `test/team-runner-edit.test.ts`, `test/config-schema.test.ts` as listed above; `test/config-web-scope.test.ts`
  next to `:103-114`: a paired browser **may** change `runner.showReasoning` in both directions, the path is in `WEB_EDITABLE`, a stored config that never had the field gets it written by
  the draft (admitted), and a draft that changes it together with `runner.unconfined` is refused for `runner.unconfined` only.
- Goldens: **none regenerated.** No prompt text changes: this delivery adds no section to any prompt, so `test/prompts-screen.test.ts` and the `en-prompts`, `legacy-prompts` and
  `same-day-prompts` goldens run unchanged as the proof.

## Risks and what was assumed and not verified

Nothing was executed in this stage: no test was run and no behaviour was seen. The lines were read; the design is a reading of them.

1. **The schema number.** 28 is free in this tree. Open pull request #229 also takes a step in the same chain and is aimed at the same release; whichever lands second renumbers its
   step, the version constant, the history entries, the pinned tests and the two documentation lines. #231, #232 and #238 are textual conflicts (`webPolicy.ts`, `service.ts`,
   `docs/`), not number clashes. Looked at again at every rebase.
2. **The async context across the SDK's tool transport.** The plan does not rely on it: `askAgent` wraps each app tool in a closure over the call's node. What is not verified is
   whether a *plain* in-process tool of a sub-agent of the SDK can be told from the principal's (the MCP handler is not told `parent_tool_use_id`), so a `CallAgent` made from inside an SDK
   sub-agent hangs under the principal's node, not the sub-agent's. The open engine has no such limit (`handle.within`).
3. **The SDK's sub-agent messages.** Read in the declarations only: `parent_tool_use_id` on assistant and user messages, that only `tool_use`/`tool_result` of a sub-agent arrive
   without `forwardSubagentText`, the tool being named `Agent` (the plan also accepts `Task`), how parallel sub-agents are reported and in what order, and that a `tool_result`
   with the same `tool_use_id` closes one. Whether the models used return thinking text by default (Q3) is the manual check above. The tests drive a scripted `query`, so they pin the
   loop's reading, not the SDK's behaviour.
4. **Reasoning is prose.** It can quote a file, a tool result or the prompt; `redact` catches shapes of credentials and `isSecretPath` catches path-like tokens, not meaning, and the stream
   reaches every paired phone unfiltered by decision (rule 16). The switch and the masking before the stream are the whole defence, as the spec says. Reasoning is already stored in the
   open engine's session file for the principal (`loop.ts:333-337`); this adds an in-memory copy and the stream, and a sub-agent's reasoning, which that file does not keep, exists in memory only.
5. **`<think>` splitting.** `Completion.reasoning` is whatever `ThinkSplitter` folded (`client.ts:187`); an unclosed or split tag follows the splitter's behaviour (`engine/open/text.ts:42`),
   not tested here beyond one well-formed block and the two field names.
6. **Cost of masking a long reasoning.** `redact` runs on at most the first 20,000 characters, once per turn. Not measured; the bound is the answer to "unbounded input".
7. **Memory of a large fan-out.** A live tree is never trimmed (rule 18), so a run that spawns many sub-agents holds all their nodes (200 lines each) until it ends; `maxNodes` bounds the
   finished trees only. In practice `Agent` is offered at depth 0 (`loop.ts:201`) and each sub-agent has a turn limit (`KIND_TURNS`), so the number is bounded by the principal's
   turns; not measured, and the `get` answer of such a tree is large.
8. **A browser opened mid-run** holds no `run:<id>` bucket until a line arrives (the dock backfills `''` only, `useActivity.ts:47`). Same as the call groups today, left as it is; the
   reconnect path (`useActivity.ts:25-28`) does backfill every bucket it holds.
9. **`withActivityContext` joining.** The change is for the same job only and nothing else in the tree nests two contexts of one job that this reading found (`rpc.ts:32`,
   `executor.ts:1172`, `service.ts:1628,1706`, `answer.ts:380` are entry points); a nested call of one job elsewhere would now keep the outer call. The existing tests of the call
   semantics (`agent-activity-core.test.ts:148,168`) are the proof.
10. **The excerpt follows the end of the callee.** The engine reports `finished` and the posting code then adds the `answer` line, so the node's last line is the excerpt after
    its `finished`. `runActive`, `isDone` and `callGroups` read the status line, not the newest line, so nothing reads it as work; the tree orders by `seq`.
11. **A detached conversation (path C, reader).** It can outlive its stage and the run's own state; the entry stays active while it works. A conversation that never reports an end
    (a crash between rounds) would keep an entry working until `maxRuns * 2` evicts it, as an activity that never reported its end does today.
12. **A retried model (`withPool`).** The call's `activity` is made once; the nodes of a failed attempt stay in the tree, as its tool lines stay today. A QA repair round (`call.resume`)
    reuses the activity as it does today.
13. **Rendering cost.** Every line triggers a store publish and a rebuild of its bucket's tree; `buildTree` is O(lines) and memoised per snapshot in the hook. The store's `mergeEntries`
    sorts on every add already. Not measured with thousands of lines.
14. **Harness shapes.** The fakes and the engine harnesses were read (`fakeOpenAI.ts`, `engine-open-subagent.test.ts`, `agent-activity-sdk.test.ts`, `runner-conversation.test.ts`); whether the
    runner's `boot` helper reaches the path-C callee with the real `askAgent` was not run, and the test falls back to a `StageEngine` that wraps `askAgent` if it does not.

## Questions for the maintainer

Approved at gate 2 (2026-10-10): every question below is settled with the default the plan follows.

None blocks the first commits. Each has a default the plan already follows; changing one is small.

1. **Default open and closed.** Top-level entry collapsed (as the panel is today), an agent's own node open when its entry is open, a sub-agent or called node collapsed showing its state and
   newest step, a thought closed. Say if sub-agents and called agents should open by default.
2. **How a refusal is shown.** The log is append-only, so a refused `CallAgent` adds a line to the caller's node right after the call line (`Not called: <callee> …`) rather than
   editing the call line. Say if the call line itself must change.
3. **`forwardSubagentText` on the Claude engine.** The plan leaves the request unchanged (Q3 of the spec): an SDK sub-agent's tool lines are shown on its node, its narration and reasoning
   only if the SDK sends them. Setting the option shows them, at the cost of more messages per call; it is one line to turn on later.
4. **Excerpts of a multi-round conversation (path C).** One `answer` line per round that answered (each is a message the caller receives and the thread shows), not only the last.
5. **The node cap.** `maxNodes` = 240 (four times the 60-run cap) for finished trees, a live tree never trimmed. The spec fixes the 60-run cap and the order, not this number.
6. **The collapsed top entry's text.** The newest line anywhere in its tree (what is happening now), while a collapsed node shows its own newest line. The alternative is the root agent's own.
7. **The title of a conversation entry.** `Conversation · <names of the agents working in it>` (the forum's title is not loaded by the dock). A run entry shows the run's reference.

## Decision log

| # | Decision | Alternative rejected, and why |
|---|---|---|
| 1 | A node is an activity run with a `parent` run id; lines stay flat on the wire and the renderer builds the tree | A nested structure on the wire (breaks the flat `get`, the backfill merge by `runId:seq` and every consumer); a node id separate from `runId` (a second id to keep in step) |
| 2 | `parent` and `node` on every line of a child node | Only on its first line (a ring that dropped it would orphan the node); a separate "nodes" message (a second channel to backfill) |
| 3 | A ring per node; eviction counts roots, drops finished trees whole, never a finished child of a live tree; a `maxNodes` bound for finished trees | A shared ring with priority (the spec's rule 18 is met by construction with separate rings and priority needs bookkeeping); counting every node against the 60 (a fan-out would evict whole runs) |
| 4 | `get(job)` loses its overall `slice(-ring)`; each node's ring bounds the answer | Keeping the slice (a child's lines push the parent's out of every backfill and of the phone's tree) |
| 5 | The ring keeps the newest status line | Leaving it (a node with more than 200 lines loses its "started" line and reads as finished, and the eviction treats it as done) |
| 6 | The parent travels in the `AsyncLocalStorage` that already carries the job, and `askAgent` also wraps the app tools in a closure over the call's node | The context alone (unverified across the SDK's tool transport); passing a parent argument through `answerMentions`, `runConversation`, the executor and the tool factories (every signature changes) |
| 7 | `withActivityContext` of the same job inside another joins the outer call | A new call for the nested one (makes the callee the job's "latest call" and a later backfill drops the caller) |
| 8 | Path B hands the callee's node to `answerMentions` through `callOf`, the door path A already uses | A new parameter on `answerMentions`; letting the engine make the node and finding it afterwards by ALS (the excerpt and the failure need the handle) |
| 9 | Path C makes one node per conversation and lends it to each round | A node per round (one callee shows as several, each with the same topic); closing it at the end of each round (the node flickers finished while the conversation is open) |
| 10 | The excerpt is an `answer` line emitted by the code that posts the reply, not by the engine | A field on the status line (a line that is "finished" and carries text breaks the leak tests' reading of status lines); emitting it from the engine (the closing answer would then be a step of the callee, which the earlier rule and its tests forbid) |
| 11 | `thought` and `answer` are kinds of their own | Reusing `text` with a flag (the narration and the thought differ in cap, switch and display, spec Q2) |
| 12 | The open engine reports a thought from `Completion.reasoning` once per turn in `call()` | Folding the per-piece `onReasoning` (many events, the 200-line ring flooded, and a half-turn thought) |
| 13 | The SDK's thinking blocks are joined by message id and flushed once, before the turn's text and tools | One line per block (the SDK emits one message per block; a turn would show several thoughts) |
| 14 | `lineOf` beside `source()`, `source()` untouched | Changing `source()` (it feeds the call's `sources` list, shown in the history, which is not masked, so a topic would be shown unmasked there) |
| 15 | The tool line is `Agent <kind>: <task>` and the node's label is `<kind>: <task>` | The bare words on the tool line (every other tool line starts with the tool's name) |
| 16 | The refusal is a line appended to the caller's node | Editing the call line (an append-only log, and the sink has already sent it) |
| 17 | `runner.showReasoning`, optional, read as on, written `true` by `v27ToV28`, in `WEB_EDITABLE` | No bump (an older app could open a file with a field it does not know); a per-agent switch (spec: per workspace only); desktop-only (reversed by the maintainer at gate 1) |
| 18 | The switch is read in the log when a thought is made | Reading it in each engine (two places and a screen could forget it); at `begin` (a run started before the change would keep the old value for its whole life) |
| 19 | The first 20,000 characters go to `redact`, then the cut at 2,000 | Masking the whole text (unbounded cost on a very long reasoning); cutting first at 2,000 (a credential straddling the cut could be shown half) |
| 20 | `stepText` is the one function that words "the newest line" | Each component checking the kind (one of them would print a thought) |
| 21 | The collapse state lives in a DOM-free store outside the components | `useState` per node (the panel closing unmounts it and the choice is lost; the spec asks that it survive new lines) |
| 22 | `backfillLive` keeps an entry whose parent chain reaches a live or known run | The current filter (a sub-agent that began and ended during a dropped stream is missing on the phone) |
| 23 | `strayActivity` is replaced by `topEntries`; `callGroups` stays | Keeping both (two answers to "what is on the badge") |
| 24 | The SDK option `forwardSubagentText` stays unset | Setting it to show a sub-agent's reasoning on the Claude engine (changes every Claude call's traffic, which the issue does not ask for) |
