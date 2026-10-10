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
