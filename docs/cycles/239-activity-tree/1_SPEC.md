# Agent activity as a tree: sub-agents, called agents and reasoning

## What is asked

The issue, in short: the floating button of running work and its "Agent tasks" panel should show what each agent is doing as a tree, and the model's reasoning as a collapsed line per turn. Today the panel is a flat list of short tool labels and loses most of what happens:

- a sub-agent (`Agent` tool) is invisible as such: its tool lines are merged into its parent's, flat and unlabeled, and parallel `explore` sub-agents interleave;
- an agent called with `CallAgent` shows a bare `CallAgent` line on the caller, and the called agent's own work lands in a generic "Agent" card with no link to the caller; its answer is not shown;
- the model's reasoning is not shown at all (the open engine uses it only as a sign of life; the Claude SDK loop ignores thinking blocks). The italic `≡` line is the model's visible narration between tool calls, not its reasoning.

## What the maintainer settled

These came out of the conversation that opened this refinement. They are product decisions, not proposals; the rules below follow from them.

1. **Reasoning is shown, collapsed.** One "thought" line per model turn (not per token), collapsed, opened on demand, in both engines (the open engine from the completion's reasoning, the Claude SDK from its thinking blocks). It is masked like every activity line, with a larger cap. A per-workspace switch controls it and it is **on by default**, in new workspaces and in existing ones. The paired phone sees the same as the desktop (parity decided for the app, #218).
2. **The panel is a tree.** Per run or conversation. The top level is the run or conversation; under it the agent that is working; under the agent its sub-agents (kind and task) and the agents it called with `CallAgent` (callee and topic, the callee's own work, a masked excerpt of its answer, nested calls), at any depth. Every level collapses and expands, and a level that is working shows it. The generic "Agent" card goes away. The floating button's badge counts top-level entries only. The run screen's live activity shows the same tree.
3. **Implementation is done by the maintainer's own session.** Not part of this spec; the plan (gate 2) carries the how.

## What changes for the person

- Open the panel while a stage delegates to three `explore` sub-agents: under the stage's agent there are three entries, each named by its kind and task, each with its own tool lines, and no line of one appears in another.
- Open it while an agent asks another for help: the caller's line says who it asked and about what; under it the called agent's work appears, then an excerpt of its answer, and if that agent called a third one, the third shows under it.
- Each model turn that reasoned leaves one closed line, "Thought". Click it and the (masked, bounded) reasoning opens. A workspace where the person does not want this turns the switch off and no such line exists anywhere, on the computer or on the phone.
- The badge counts runs and conversations, not what runs inside them.
- The same tree is on the run screen, and the paired phone shows the same.

## Where things stand today

Checked against this tree (release `0.9.0-beta.16`); every line number below was read again for this spec.

| Piece | What it does today | Where |
|---|---|---|
| The dock | One component is the button and the panel. It lists one group per `@` call, one generic "Agent" card for every running line with no call, and the renderer's own jobs. The badge is `shown + calls + (generic ? 1 : 0)` | `src/renderer/src/JobsDock.tsx:114`, totals `:136-141`, generic card `:279-285` |
| Call groups | One group per activity run whose lines carry `call`, while it is active. Lines without `call` never group | `src/renderer/src/activity.ts:49-66`, stray lines `:143-151` |
| Timeline | The latest line is the collapsed text; opening shows `ActivityTimeline`. Icons by kind: tool, text (`≡`), status | `JobsDock.tsx:91-107`, `src/renderer/src/AgentActivity.tsx:9-27,30` |
| Where the same list is shown | The run screen (`useActivity('run:<id>')`), the inline panel of the ceremony screens, and the call rows under the message that named the agent | `src/renderer/src/screens/cycle/RunScreen.tsx:113,185`, `AgentActivity.tsx:88-118`, `src/renderer/src/screens/cycle/Thread.tsx:526-549` |
| Renderer store | One bucket per job, 200 lines, merged and sorted | `activity.ts:79-140` |
| Wire line | `ActivityEntry {seq, runId, jobId, role, at, kind: 'tool' \| 'text' \| 'status', label, state?, call?}`; no parent link; caps 200 lines, 200 characters of narration, 240 of a label | `src/shared/activity.ts:2,19-38,40-42` |
| Main log | One ring of 200 lines **per activity run**, at most 60 runs (finished first; a running one only past 120), memory only | `src/main/activity.ts:74-90` |
| Masking | Every label passes `safeText`: one line, secret-file paths replaced, `redact()` | `src/main/activity.ts:60-72`, `errorlog-core.ts:23-37` |
| Narration | `text()` keeps only the last pending narration and emits it when a tool follows; a closing answer is dropped | `src/main/activity.ts:137-140` |
| Line wording | `source()` keeps the tool name plus the first of `command`, `file_path`, `pattern`, `skill` or an issue number; `to`, `topic`, `description`, `prompt`, `kind` are never read | `src/main/agents.ts:388-392` |
| Open engine reasoning | Arrives as `reasoning_content`, `reasoning` or `<think>`; folded per chunk; used only as `beat()`. The full text is on the completion and is stored on the assistant message and in the persistent session file | `src/main/engine/open/client.ts:100-127`, `agents.ts:656`, `loop.ts:333-336,530` |
| SDK loop | Reads `text` and `tool_use` blocks; no `thinking` block is read; `parent_tool_use_id` is not read | `agents.ts:805-826` |
| Open-engine sub-agents | `runAgent` runs a nested `runOpen` with the parent's events, so its tool lines and narration land in the parent's activity; its role (`<parent>:<kind>`) reaches usage only. `Agent` is offered at depth 0 only; the tool calls of one turn run with `Promise.all`; kinds that write run one at a time | `loop.ts:201,372-410,650`; the nested run has no session file (`:400`) |
| SDK sub-agents | `Agent` is allowed for `deep` with the sub-agents switch and in delegate mode; its tool lines arrive flat | `agents.ts:92,1468` |
| `@` call (path A) | The activity of the call is made when the message is accepted, with `call`; the only path that makes a group | `src/main/runner/service.ts:1481`, `src/main/mentions/module.ts:112` |
| `CallAgent` in an answer (path B) | `ask()` posts a forum message and answers it through `answerMentions` with `callOf: undefined`; the callee gets a new activity of its own, same job, no `call` | `src/main/mentions/answer.ts:356-380`, `src/main/mentions/converse.ts:22-51` |
| `CallAgent` from a stage (path C) | The called agent runs through `deps.engine`, inherits the stage's job, makes its own activity with no `call` | `src/main/runner/conversation.ts:312,325` |
| The called agent's answer | Goes to the conversation; not to the activity | `answer.ts:382`, `conversation.ts:341` |
| Delivery to the phone | The sink emits to the window and to every paired browser's event stream, no filter; `agent:activity:get` is open (no rule names it) | `src/main/index.ts:63-66,227,284`, `src/main/web.ts:373-376`, `src/main/webPolicy.ts:100-105` |
| Config | Schema 27; the per-workspace agent switches are optional booleans in `runner` (`procedures`, `sharedMemory`) with a migration step each | `src/shared/config/types.ts:5,963,980`, `src/shared/config/migrations.ts:400-406` |
| Tests | Renderer store and groups, main log (ring, eviction, narration rule, trim, redaction, secret path, job context), and per-engine lines including "tool results and the final answer never leak". No test renders `JobsDock`, `AgentActivity` or `Thread` (the runner is `environment: 'node'`); none covers sub-agent or `CallAgent` activity or the phone path | `test/activity-store.test.ts`, `test/agent-activity-core.test.ts`, `test/agent-activity-open.test.ts`, `test/agent-activity-sdk.test.ts`, `test/mentions-module.test.ts`, `vitest.config.ts:12` |
| Texts | 24 `activity.*` keys per language; the dock's `ui.jobs.*` | `src/shared/i18n/en.json:198-221` and the same range in `pt-BR.json` |

## Rules

### The tree

1. **A tree per run or conversation.** The top level is one entry per run (`run:<id>`) or per conversation outside a run (`mention:<thread>`) that has something working. Under it sit the agents working in it; under an agent, its sub-agents and the agents it called, at any depth. Every line belongs to exactly one node. A run or conversation never appears twice, and one that a renderer job already owns shows once, as that job does today.
2. **A level that works shows it.** A node that is working shows its state (working, waiting its turn, finished, failed) and, collapsed, its latest step. Every level, the top one included, collapses and expands. What is expanded is the person's choice and survives new lines arriving.
3. **No generic card.** The "Agent" card is removed. An activity with no run or conversation behind it (a ceremony answer, a scheduler call) is its own top-level entry named for the agent. It is not folded into another entry.
4. **The badge counts top-level entries only**: runs and conversations with something working, the renderer's own jobs, and activities with no run behind them. Children, called agents and sub-agents never add to the number, at any depth. Opening an entry from the panel goes where it goes today (the run's conversation).
5. **Finished children stay visible while their parent is in the panel.** A sub-agent or called agent that ended stays in the tree, shown as finished or failed, as long as the entry it belongs to is in the panel. When the entry leaves the panel, its children go with it (how long a finished top-level entry stays is Q4).

### What the lines say

6. **A `CallAgent` line names the callee and the topic**: the callee as the team names it (the id when the name is gone), and the topic clipped, both masked. A call that is refused (a cycle, the cap of calls per stage) says so on the caller's line and makes no child node.
7. **An `Agent` line names the kind and the task**: the kind (`explore`, `edit`, `shell`, `screen`, or the name of the plain sub-agent's definition) and the task clipped and masked, for example "explore: map the tests of X". The same words head the sub-agent's node.
8. **A sub-agent is its own node.** Its tool lines, its thoughts and its end belong to it and are shown under it, in the order they happened. Parallel sub-agents never interleave: each one is its own entry under the same parent, in the order they started, and no line of one appears under another or under the parent. A notice that a sub-agent runs on another model stays where it is today, on the parent's line.
9. **A called agent is a node under whoever called it** (rule 10). Under it, in order: the callee's own tool lines and thoughts, its sub-agents, the agents it called in turn, and at its end a **masked excerpt of its answer** with its own cap (Q1). The excerpt is the text the conversation already shows for that answer; the activity never shows a closing answer that the conversation does not. A callee that fails shows failed with the reason, as a call does today.
10. **The three paths end in the same tree shape.** Where the callee sits depends only on who called it:
    - **A: an `@` mention** (in a run's thread, a squad channel, the general conversation or a direct one). The callee is a node directly under the run's or the conversation's entry, beside any agent that is working there, with the message's text clipped as its topic. A mention that waits its turn shows as waiting under the same entry, as today.
    - **B: `CallAgent` inside an answer to a mention.** The callee is a node under the agent that called it, which is itself under the entry of the conversation or run.
    - **C: `CallAgent` from a stage.** The callee is a node under the stage's agent, under the run's entry.

    The callee's own nested calls and sub-agents follow the same rule one level down. Nothing lands outside the tree.

### Reasoning

11. **One "thought" line per model turn that reasoned**, never per token and never for a turn with no reasoning. It belongs to the node of the agent that took the turn (a sub-agent's thought sits under the sub-agent) and comes before that turn's narration and tool lines. It is a kind of its own, apart from the narration (Q2).
12. **Collapsed, opened on demand.** The closed line says only that there was a thought (the word, translated, with no prose); the text appears only when the person opens it. The latest-step text of a collapsed node, and the call rows under a message, never show reasoning text: when a thought is the newest line they show the word.
13. **Both engines.** On the open engine the line is the turn's reasoning as the completion reports it, whichever way the server sends it (a field or a `<think>` block). On the Claude SDK it is the turn's thinking blocks. What the model returns decides: a turn whose thinking is empty or withheld makes no line (Q3).
14. **Masked like every activity line, with a larger cap.** The thought passes the same masking as the other lines (flattened to one line, secret-file paths and credential shapes replaced) in the main process **before** it enters the log or leaves it, so what the window and the phone receive is already masked. Its cap is larger than the narration's (Q1). Over the cap it is cut, not summarized: no model is called for this.

### The switch

15. **Per workspace, on by default.** A workspace has one switch for showing reasoning. It is on in a new workspace and **on in a workspace that existed before** (the person turns it off; nobody has to turn it on). Off, no thought line is made: none is stored, none is sent to the window or to a phone, on any screen. Lines already in memory stay until they age out. It covers every agent of the workspace that has activity, ceremonies included. Where it lives, who changes it and how it migrates are Q5 and Q6.

### The phone

16. **The paired phone shows the same tree and the same thoughts** as the desktop, from the same stream, and rebuilds the same tree from a backfill after its stream reconnected. No line is filtered for the phone: the switch and the masking of rule 14 are the only controls, and both happen before the line leaves the main process. This is the parity the maintainer decided (#218); it is deliberate, not an omission of a phone rule.

### Limits

17. **The existing caps hold.** A node keeps at most the 200 lines the ring keeps today; the 60-run cap and its order of eviction (finished first) stay. A thought is one line like any other, so a chatty reasoner counts against its own node only.
18. **A chatty child cannot evict its parent's lines.** Each node keeps its own lines, so what a child says never pushes a parent's line out. A node of a tree whose entry is still in the panel is evicted last: the cap drops whole finished entries first, oldest first, and does not drop a finished child of an entry that still has work going (the existing allowance for a running one stays).
19. **Nothing new is written to disk.** The tree, the thoughts and the answer excerpts live in memory, as the activity does today, and are gone on restart. No new file, no new field in the run's record or the conversation, no change to the sessions the engines already keep. The only stored thing this adds is the switch in the workspace's configuration. Reasoning is already kept on disk by the open engine's own session file for the principal agent (`loop.ts:333-336`); this does not add to that, and the sub-agents' reasoning, which that file does not keep, stays in memory only.
20. **Volume stays bounded.** The log emits once per completed turn for a thought, never per streamed piece.

## The change to an earlier rule

The activity notice of the earlier delivery for called agents (#29, rule 5) read: the notice shows only what the activity record already shows, short labels, "nothing of file content, tool result or environment". This delivery changes that rule, on purpose and in two places:

- **The reasoning of the model is shown.** It is prose, not a label, and it can quote a file, a tool result or the prompt. The masking catches shapes of credentials and secret-file paths, not meaning. This is the maintainer's decision, and the switch (rule 15) and the masking before the stream (rule 14) are what stands against it. It is stated as a known limit, not as a guarantee that nothing sensitive can appear.
- **The excerpt of a called agent's answer is shown.** It is the text the conversation already shows, masked and cut.

What stays from that rule: **no tool result, no file content and no environment** enters the activity. A tool's output is never a thought, a label or an excerpt. The existing tests that assert the closing answer of an agent never shows as a step of its own stay true: the excerpt shows on the **call** of the caller, not as a step of the callee.

## Out of scope

- **Reasoning streamed token by token**, or shown while it is still being produced. One line when the turn is complete.
- **Storing reasoning or the tree** in the run's record, the conversation, a log or a file, or showing either after a restart.
- **A summary of reasoning by a model**, or any model call for activity.
- **A per-agent switch** and a per-device switch (Q5), and a different view for the phone.
- **Showing tool results, file contents or the environment** anywhere in the tree.
- **A new way to stop, answer or watch** from the tree. The call row's actions in the thread (watch the agent's screen, stop the answer) stay as they are; the tree adds none.
- **Changing how calls are made or limited**: the caps on calls per stage, the cycle refusal, the one-call-at-a-time order of a run and the sub-agents' kinds and depth are not touched.
- **The wording of the narration** (`≡`) and its rule of showing only when a tool follows.
- **A notification or sound** for a thought or a finished child.

## Acceptance criteria

Each one is a check a person makes on screen or by test, with the data folder pointed at an empty one and a fake model.

1. **Three sub-agents.** A stage whose agent delegates to three `explore` sub-agents in one turn shows, under that agent, three child entries, each headed by "explore" and its task, each with only its own tool lines; no line appears under a sibling or the parent. Each ends as finished or failed and stays while the stage's entry is in the panel.
2. **A chain of calls.** An agent that calls a second with `CallAgent`, which calls a third, shows three levels. The first call's line names the callee and the topic; the second agent's node shows its work; each node ends with a masked excerpt of the answer; no line is in a generic card, and there is no generic card on screen.
3. **The three paths.** The same call made (A) by `@` in a run's thread, (B) by `CallAgent` inside a conversation answer and (C) by `CallAgent` from a stage gives, respectively, a node directly under the entry, a node under the calling agent, and a node under the stage's agent; each node has the same content.
4. **A call refused.** A `CallAgent` that names an agent already in the chain, or over the cap, shows the refusal on the caller's line and makes no node.
5. **One thought per turn.** With the switch on, a turn that reasoned shows exactly one closed "Thought" line before its tool lines, on the open engine and on the Claude engine; a turn that did not reason shows none; a reasoning of many streamed pieces is still one line. The closed line and the node's latest-step text carry no reasoning prose; opening the line shows the masked text.
6. **Masked and cut.** A thought that contains a credential shape and a secret-file path is shown with both replaced; a thought longer than the cap is cut with an ellipsis; what the window receives is the same as the phone receives, already masked.
7. **The switch.** With the switch off, a turn that reasoned adds no line in the window and none on the phone, and the earlier lines age out; turning it on shows thoughts from the next turn. A workspace that existed before this version has it on after the update, with the person having done nothing; a new one has it on.
8. **The badge.** With a run, a conversation and, inside the run, two sub-agents and a called agent, the badge reads 2 (the top-level entries), whatever the depth, and the "running" part of its description counts the same entries.
9. **Collapse and keep.** Collapsing a level hides its children; new lines arriving do not re-open it; a working level shows its state and latest step while collapsed.
10. **Children stay with the parent.** A sub-agent that ended while its parent still works stays in the tree, marked finished; when the entry leaves the panel its children leave with it.
11. **Limits.** A child that emits more than the ring size in lines keeps its newest ones and the parent still has all of its own; with more than the node cap of finished entries, the oldest finished entries go first; the tree is gone after a restart and no file in the data folder holds a thought or an excerpt.
12. **The run screen.** The run's live activity on the run screen shows the same tree for that run, with the same collapse, state and thoughts.
13. **The paired phone.** From a paired browser the same tree, the same thoughts and the same switch effect appear as in the window, including after the stream dropped and came back.
14. **Nothing else leaks.** No tool result, file content or environment variable appears in any line, thought excerpt or answer excerpt (the existing leak tests stay green and gain the new kinds).
15. **Wording and theme.** Every new string is in both catalogs and uses `t()`; the tree uses theme tokens only.

## Open questions

Answered at gate 1 (2026-10-10): every question is settled with its recommendation, except Q5: the switch is per workspace only and is changed from the computer **or from a paired browser**, as the shared memory's switch is (the maintainer's parity decision).

Each has a recommendation; the maintainer decides at this gate.

**Q1. The cap of a thought, the cap of an answer excerpt, and how long text is cut.**
Today a narration line is cut at 200 characters and a label at 240.
*Recommendation:* a thought up to **2,000 characters**, cut at the end with an ellipsis (the start of the reasoning is kept; no summary, no model call); an answer excerpt up to **400 characters**. Both after masking, as separate constants next to the existing ones, so a later change is one line. The cost is bounded: one line per turn, 200 lines per node, and the thought only goes through the stream once. The alternative, keeping the tail (where conclusions often are), is reasonable too; the start is chosen because it reads as the reason for what follows. If you prefer the tail or a head and a tail, say so.

**Q2. Narration (`≡`) and thought: one kind or two.**
*Recommendation: two kinds.* The narration is what the model *said* between tool calls (it is visible text, with a 200-character cap and its own rule of showing only when a tool follows). The thought is what it *reasoned* (hidden by default, opened on demand, larger cap, switchable). They differ in cap, in switch and in how they are shown, so merging them would make the switch hide narration or force the narration to be collapsed. A turn that has both shows the thought first, then the narration, then the tools.

**Q3. Whether the Claude SDK should be asked for summarized thinking, or use what arrives.**
The SDK's thinking configuration can ask for a summarized or an omitted display; whether the models used here return the thinking text by default was not checked, and nothing was run.
*Recommendation: use what arrives and do not change the request.* Changing the thinking setting changes cost and behaviour of every Claude call, which this issue does not ask for. A thinking block that arrives empty or withheld makes no line. The plan includes one real check, outside the test suite, of what the models used actually return; if it is empty by default for them, the follow-up is a decision of its own (request the summarized display, with its cost, or accept that the Claude engine shows fewer thoughts than the open one). Until then the spec's promise for the SDK is "the thinking the model returns".

**Q4. How long a finished top-level entry stays in the panel.**
Today a finished call or generic entry leaves when its work ends; the renderer's own jobs that finish off-screen stay until dismissed.
*Recommendation: the same as today.* An entry leaves when its last working node ends, with its finished children (rule 5), and the run screen keeps the whole tree of that run on its own until the next start of the run, as its timeline does now. No new linger timer. The alternative is a short linger (about a minute) so the person can read how a run ended, at the price of a badge that counts something not working.

**Q5. A per-workspace switch only, or also per agent; who changes it.**
*Settled at gate 1: per workspace only, changed from the computer or a paired browser (it goes into the phone-editable settings).* The recommendation was: Recommendation: per workspace only, changed from the computer. One switch is enough for the privacy question the maintainer raised, and a per-agent switch adds a field to every agent's editor and to the team schema. The configuration is already something the paired phone does not change; the switch follows that. If a workspace needs a quiet agent (one that reasons over secrets), a per-agent override is a later, small addition.

**Q6. Where the switch lives and how it migrates (the schema is 27 now).**
*Recommendation:* an optional boolean beside the other per-workspace agent switches in `runner`, read as **on** when absent, written **on** by a migration step `27 → 28` for every existing workspace and by the defaults for a new one. Writing the value (instead of relying on "absent") makes the choice visible in the configuration and means a later change of the default does not flip a workspace that already decided. The step raises no permission, but this one does show more to the people who see the stream, so its note in the update says reasoning is shown and where to turn it off. Other branches aimed at the same open release may take schema 28 first; the number is checked at the plan. The alternative, no bump (an optional field read as on), is smaller but leaves an older app free to open a configuration that carries a field it does not know.

**Q7. Does the panel on the other screens use the tree?**
The same activity list is the inline panel of the ceremony screens (gate, deep, re-entry, conflict, QA hand-off, retro, call) as well as the run screen. The issue names the dock and the run screen.
*Recommendation: yes, one component everywhere.* Those screens also run agents that delegate or call, and a flat list there would keep the problem and the generic wording; one tree component keeps the behaviour the same on every screen, and a screen that shows one agent's activity shows that agent's subtree, expanded. If you prefer to keep them flat for this delivery, rules 1 to 5 stay for the dock and the run screen only.

**Q8. An activity with no run or conversation (rule 3).**
A ceremony answer or a scheduler call has no run or conversation to hang under. *Recommendation:* each is its own top-level entry named for the agent, so removing the generic card loses no visibility. The cost is that such an entry counts in the badge while it works (a few seconds, usually). The alternative, not showing them, would hide work the person can see today.

## How it was checked

By reading, in this stage: the issue, the audit of the code, and the specs of the earlier activity notice for called agents and of the shared memory (for structure). In this tree, against the lines cited above: the dock, its totals and the generic card; the renderer's grouping and stray logic; the timeline, its icons and the other places the list is shown; the wire type and its caps; the main log, its ring, its eviction and its masking; the narration rule; the wording of tool lines; the open engine's reasoning path, its sub-agent runner, its parallel tool calls and the session file; the Claude SDK loop; the three ways a called agent is started; the sink to the window and to paired browsers and the policy of the paired browser; the schema version and the migration step of the most recent switch.

Not verified: nothing was executed and no behaviour was seen working. Whether the Claude models used return the thinking text by default (Q3); the live order and the parent link of the Claude SDK's sub-agent messages, and how its parallel sub-agents are reported; edge cases of the `<think>` splitting in the open engine; how much a real run loses to the ring today; whether another branch aimed at the same release already takes schema 28; the token and memory cost of keeping a node per sub-agent in a big fan-out; whether a paired browser filters anything beyond the policy and the stream read here.

## Priority and milestone proposed

- **Priority: `priority:medium`.** It is a visibility improvement to work that already runs: today a person cannot tell which sub-agent or called agent is doing what, nor why an agent chose a step. It also exposes more of the model's own prose to every screen that sees the stream, which is why the switch and the masking are part of the delivery and not a later add-on. A proposal; the person accepts or refuses.
- **Milestone: the next beta of `0.9.0`.** It extends the activity notice that landed in this release. The release note says what the person sees: the activity panel is a tree of runs, agents, sub-agents and called agents; each turn's reasoning is a closed line to open; a switch in the workspace's configuration turns reasoning off.
