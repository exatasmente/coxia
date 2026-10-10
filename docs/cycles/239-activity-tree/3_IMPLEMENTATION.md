# Implementation: the live activity as a tree

Commits follow the order of `2_PLAN.md`. Each section below is written in the commit it describes.

## Commit 1: the reasoning switch in the configuration

Schema 28, `v27ToV28`, `runner.showReasoning` (types, defaults, schema in one commit), `runner.showReasoning` in `WEB_EDITABLE`, the toggle in the runner section, the two texts
of `ui.runner.*`, `docs/configuration.md` in both languages, and the tests that pin the number or the neutral runner. Nothing reads the switch yet except the settings screen.

Deviations from the plan:

- `reasoningOn` (planned in commit 2 beside the new activity constants) is added to `src/shared/activity.ts` here, alone, because the runner draft (`runnerEdit.ts`) needs it
  to read an absent field as on. The rest of the shared activity changes stay in commit 2.
- The v26 helper of `test/config-migrations.test.ts` also deletes `showReasoning`, and the test that compares a v26 file with its migrated result overrides `showReasoning` on both
  sides like it does `sharedMemory`; the `:486`, `:527` and `:651` cases needed no edit (their `before` comes from `neutralConfig()`, which carries `true`, and the chain writes `true`).

## Commit 2: nodes, a ring per node and the new kinds in the activity log

`ActivityEntry` gains `parent` and `node` (every line of a node) and the kinds `thought` and `answer`; the main log keeps a ring per node, evicts by tree, answers a run id with
its subtree and a job id with no overall cut, keeps the newest status line when a ring turns over, and makes `thought`, `answer`, `child` and `lend`. `withActivityParent`,
`currentActivity`, `beginActivity`'s `node` and the joining `withActivityContext` carry the parent. The thoughts gate is wired in `src/main/index.ts`. The renderer store caps per
run, drops finished trees past 240 runs and keeps new children in `backfillLive`. Nothing emits a thought, an answer or a child yet.

Deviations from the plan:

- `stepText` lives in `src/renderer/src/activity.ts` (the existing DOM-free module), not in `activityTree.ts`, which is created in commit 6: the flat list needs it now, so that a
  thought can never print as a label. Commit 6 re-exports it from the tree module. The flat timeline (`ActivityTimeline`), the dock's `Steps`, `AgentActivity`'s `act-now` and the
  thread's `CallLine` all word the newest line through it.
- `getConfig` was not imported in `src/main/index.ts` (the plan said it was); it is added to the `./workspaceConfig` import next to `onConfigChange`.
- `beginCallActivity` takes the optional `node` here already (the signature is the log's, not the wiring of path A, which stays in commit 4).
- The pinned status line is not counted in the ring in the renderer's cap or in the main log's: a ring holds `ring` lines plus the newest status line when that one is older than
  all of them (`ring + 1` at most), as the plan says; the renderer mirrors this per run.
- Added `test/activity-policy.test.ts` here (the plan lists it with the phone's tests, no commit given), and the stub `RunActivity` of `test/mentions-call-line.test.ts` gained the
  new members.
- `activity.kind.thought`, `activity.kind.answer` and `activity.thought` are the only catalog keys added; the others of the plan's list (`activity.node.*`, `activity.callRefused.*`,
  the entry titles) come with the commits that use them, so no key sits unused.

## Commit 3: each sub-agent as a node of its own, in both engines

The open loop tells the caller about each sub-agent (`onSubAgent`, a `SubAgentHandle`) before it runs, synchronously and in the order of the tool calls; the sub-agent's own
`onToolUse` and `onInterim` go to the handle, and the model-switch notice, usage and the sign of life stay the parent's. A kind that changes things (`edit`, `shell`, `screen`) is
`queued` while another of them is open and `started` when its turn comes; the node ends in the existing `try`/`catch` (`finished`, or `failed` with the reason, a sub-agent out of
turns included). The agents module (`openSubAgent`) makes the node with `RunActivity.child`, and the Claude SDK loop routes each message by `parent_tool_use_id` to the node that
the `Agent`/`Task` tool use opened, ends it on the matching `tool_result` (`failed` when `is_error`, never with the result's text), closes what is left open at the `result` message
and, as `failed`, in a `finally`. `lineOf` words the `Agent` line as `Agent <kind>: <task>`; `source()` is untouched.

Deviations from the plan:

- `SubAgentStart` carries `{ role, kind, name, description, prompt }` instead of `{ kind, name, task }`: the role is the string the open engine already gives the sub-agent's usage
  (`<role>:<kind or definition name>`, and the node needs it), and the words that head the node (kind or definition, then the task or the first words of the prompt, clipped) are
  made in one place in the agents module (`subAgentWords`) for both engines.
- `SubAgentHandle.events` is `Pick<RunEvents, 'onToolUse' | 'onInterim'>`; `onThought` joins it in commit 5, where the engine first calls it.
- The loop's `runAgent` takes a fourth argument (`about`: the model's `description` and `subagent_type`), because the principal's `Agent` tool has both and the callback needs them.
- The handle is told `queued` or `started` by the loop itself, synchronously, right after it is created, instead of the agents module emitting a first status: the module cannot
  know whether another sub-agent is ahead. The node's order under its parent is that of the first line, so it is also the order of the tool calls.
- The tests are split in two files, `test/activity-subagents.test.ts` (open engine, through `askAgent`) and `test/activity-subagents-sdk.test.ts` (scripted `query`), because the
  SDK module is replaced for a whole file. The held/queued cases and the handle's own contract are in `test/engine-open-subagent.test.ts`, with a recording caller as the harness.
  "The usage unchanged" is not asserted separately: the existing usage tests of that file (`used`, `adds the sub-agent's use ...`) run unchanged and pass.
- `Task`, the older name of the SDK's sub-agent tool, is accepted beside `Agent`; the plan allowed it. A sub-agent of the SDK is headed by its `subagent_type` (or `agent`): the SDK
  has no kind. The live order and the `parent_tool_use_id` of parallel SDK sub-agents were read in the declarations and are not seen working (risk 3 of the plan).

## Commit 4: called agents linked under the agent that called them

`askAgent` runs the engine under its call's node (`withActivityParent`) and hands the engine its app tools wrapped to run under that node as well (`bindActivityParent`, which keeps
the job even from a chain that lost the async context); `lineOf` words `CallAgent` as `CallAgent <callee>: <topic>`. Path A: the call's line carries `node` (the message text) at both
call sites. Path B: `ask` makes the callee a node under the caller and hands it to `answerMentions` through `callOf`. Path C: `runConversation` makes one node for the whole
conversation, lends it to each round and closes it in its `finally`. The excerpt line is emitted by the code that posts the reply (`answerMentions` for A and B, the round loop for C), never
by an engine. A refused call adds a line to the caller's node (`activity.callRefused.cycle|cap`) in `converse.ts` and in the executor's `callAgent`.

Deviations from the plan:

- `bindActivityParent` (a new export of the log) is used by the wrapper instead of `withActivityParent` alone: it captures the job and the call that are current where the tool list is
  wrapped, so an in-process tool server that lost the async context (risk 2) still runs the tool in the same job and a nested `withActivityContext` joins instead of starting a call.
- `agentLabel(team, id)` (name as the team writes it, the id when the agent is gone) lives in `src/shared/config/team.ts`, pure, because `converse.ts` and `answer.ts` cannot import the
  agents module (it imports the mentions). `ConversationCall` gained an optional `label` for it.
- Path B and path C make their node with `currentActivity().child(...)` (the caller's secret-path check is inherited) and fall back to `beginActivity` only when no node is current. The node
  `ask` hands over is a thin wrapper that remembers whether anything said `failed`, so an agent that gave no answer after the engine said `finished` ends `failed` once, and one the engine
  already failed (held, stopped) is not failed twice.
- `get(job)` kept a run only when its call was the job's latest or it was still working; the lines of an `@` call have no call id, and the agents they call copy it, so a callee that
  had ended was dropped from the backfill while its caller still worked (rule 5). It now keeps every run of a tree that still has work in it (`treeDone`), a fix to commit 2's code
  found by the path-A test.
- The cap refusal line reads "the limit of N calls was reached" (not "this answer"), because the same key serves an answer and a stage.
- The unknown-agent refusal is left alone, as the plan says. The CHANGELOG line waits for commit 7, as the plan's order says.
- Tests: `test/activity-calls.test.ts` (A, B and C over the real `askAgent` and the fake server; path C there uses a hand-made `callAgent` that calls `runConversation`, as the executor's
  does); the executor's own refusal lines are in `test/runner-send-call.test.ts`, with the stage's node made by hand (its engine there is the fake one, which does not set the parent).
  `agent-activity-core.test.ts` gains the `get` case and `bindActivityParent`; the SDK file one `CallAgent` line case.

## Commit 5: the reasoning of each turn as one closed line

The open loop calls `onThought` once with `Completion.reasoning` when a turn is complete (after the assistant message is written, before its narration and tools are handled), and the
agents module hands it to the call's activity or, for a sub-agent, to its handle (`SubAgentHandle.events.onThought`). The Claude SDK loop joins the `thinking` blocks of one message
id and flushes them as one line on the node that took the turn (the call's, or the sub-agent's by `parent_tool_use_id`), before the turn's text and tool uses; an empty, blank or
`redacted_thinking` block makes none. The masking, the 2,000-character cut, the 20,000-character scan bound and the switch were already in the log (commit 2); the request to the SDK is
not changed.

Deviations from the plan:

- A sub-agent started by a caller that made no node for it (no `onSubAgent`) does not hand its thoughts to the parent's `onThought`: the nested events are the parent's with `onThought`
  cleared, then the handle's. Tool lines and narration of such a sub-agent still land on the parent's, as before. This is the one place the nested `events` object was rewritten
  (it is now always set, with the same members as before for everything but `onThought`).
- The SDK loop also flushes a held thought in its `finally`, so a call that ends by an error after a thinking block still shows the line.
- The test plan's single `test/activity-thoughts.test.ts` is two files, `test/activity-thoughts.test.ts` (open engine, through `askAgent`) and `test/activity-thoughts-sdk.test.ts`
  (scripted `query`), because the SDK module is replaced for a whole file. `toolStep` in `test/helpers/fakeOpenAI.ts` gained `reasoning` (a string or pieces) and `reasoningField`.
- "No file holds the marker of a thought" cannot run the open session with `sessionsDir: null` through `askAgent`; the test walks the data folder and skips `open-sessions`, the one
  place the principal's reasoning already was.
- No SDK `thinking` option or `forwardSubagentText` is set: a sub-agent's thought shows on the Claude engine only if the SDK forwards it (Q3 and question 3 of the plan).
