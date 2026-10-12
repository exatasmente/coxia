# Turn limits as a setting, and a question instead of a stop

## What is asked

The issue, in short: a sub-agent that reaches its turn limit fails, and a stage that reaches its own ends with an error. In a real review the reviewer split the work into `explore` sub-agents, one of them stopped with "stopped after 12 turns without finishing", and the reviewer redid that dimension itself, in its own larger context, which is exactly what delegating was meant to avoid.

- **The sub-agents' limits are constants in code.** `explore` 12, `edit` 30, `shell` 20, `screen` 30, and a plain sub-agent 12. The person cannot change them.
- **The stage's limit is a setting, but reaching it ends the stage.** `runner.turns.read` and `runner.turns.write` are configurable; running out fails the stage with a "turns" error.
- **Both are a dead end.** The only way on is to start over, or to do the work another way, with what the agent already read thrown away.

## What the maintainer settled

These are product decisions, not proposals; the rules below follow from them.

1. **The sub-agents' limits become workspace settings**, per kind and for the plain sub-agent, in Settings › Runner next to the stage's turns, editable from the computer and from a paired phone. Today's values are the defaults.
2. **Reaching a limit never fails the work.** For a sub-agent and for a stage the work pauses and the person is asked: *continue for another round of the same size*, or *finish now with what it has*.
3. **With no answer it waits indefinitely** and nothing is cancelled. The stage's idle and wall clocks stand still while it waits.
4. **The question reaches every screen and the paired phone**, and later the persona of #245, which may answer. This spec says how the question is exposed so that a future agent can answer it; it builds nothing for that agent.
5. **"Finish now" hands back what there is.** A sub-agent returns its partial result to the principal; a stage ends as it does today. Either way the run's conversation says so.
6. **The activity tree shows the waiting node and why.**

## What changes for the person

- In Settings › Runner, under the two stage fields, there are five more numbers: the turns of an `explore`, `edit`, `shell` and `screen` sub-agent and of a plain one. They show 12, 30, 20, 30 and 12. Raising the `explore` one makes the next `explore` sub-agent run longer. The same fields are on the paired phone.
- When a sub-agent uses its last turn, it stops where it is and a question appears: who is waiting ("sub-agent of kind explore: map the tests of X, used 12 of 12 turns"), and two buttons, **Continue (12 more turns)** and **Finish now**. The question is on the run's screen, in the run's conversation, in the notification the app already sends for a command that waits, and on the paired phone.
- **Continue** lets the sub-agent go on with its dialog and its files exactly as they were. It asks again if it uses up that round too.
- **Finish now** makes the sub-agent hand the principal what it has, marked as partial, and the principal goes on. The conversation says "You finished the sub-agent now" and that a partial result went to the principal.
- A stage that uses its last turn leaves the same question. **Continue** gives it another round; **Finish now** ends the stage the way running out of turns does today, with the "turns" failure the person can retry.
- Nobody answering is not a failure. The run stays where it is for an hour or a week; the stage does not fail with "no sign of life" and does not hit its time cap.
- In the activity tree the waiting node says it waits for you and why ("Reached 12 turns: waiting for you"), and so does the collapsed line of whatever is above it, so a closed tree does not hide it.

## Where things stand today

Checked against this tree (release `0.9.0-beta.19`); every line number below was read again for this spec.

| Piece | What it does today | Where |
|---|---|---|
| Sub-agent limits | `KIND_TURNS` is `explore 12, edit 30, shell 20, screen 30`. A sub-agent of a kind gets `KIND_TURNS[kind]`, a plain one 12 | `src/main/engine/open/subagent.ts:22-23`, `src/main/engine/open/loop.ts:456` |
| Reaching it | The loop throws `OpenMaxTurnsError` at the top of a turn (and again in the door's repair round); for a sub-agent of a kind it is turned into a tool error, `main.engine.text.subTurns`, "stopped after N turns without finishing", and the sub-agent's node ends as failed with that reason | `loop.ts:166-174,692,778`, `loop.ts:481-485`, `src/shared/i18n/main.en.json:675` |
| A plain sub-agent | `kind` is absent, so the error is not rewritten: the tool call fails with the raw text "agent ended with error_max_turns", which the principal reads as a tool error | `loop.ts:483` (only `kind && …`), `loop.ts:636-641` |
| What a sub-agent is | The same loop, nested: no session file, shares the principal's sources, `Agent` removed from its tools. Parallel tool calls of one turn run with `Promise.all`, so the principal's turn waits for all of them; kinds that change things run one at a time | `loop.ts:403-411,446-465,722`, `loop.ts:457` (`sessionsDir: null`) |
| Its node | A sub-agent is told to the activity as its own node (`onSubAgent` -> `openSubAgent`); `state('queued'/'started')`, `end(failure?)` | `loop.ts:417-431`, `src/main/agents.ts:428-443` |
| The stage's limit | `runner.turns.read` (30) and `.write` (80), 1 to 500; the executor passes `maxTurns` from them | `src/shared/config/types.ts:829-833,946-947`, `src/shared/config/defaults.ts:37`, `src/shared/config/schema.ts:562`, `src/main/runner/executor.ts:1030` |
| Stage reaches it | The open engine's error becomes `MaxTurnsError` in the bridge, and the executor turns that into `StageError('turns')`; the Claude SDK path throws the same `MaxTurnsError` on the `error_max_turns` result | `src/main/engine/open/bridge.ts:175`, `executor.ts:1234`, `executor.ts:72` (the code), `agents.ts:934` |
| Claude SDK path | `maxTurns` goes to the SDK as an option of the call. The app sets no limit for the SDK's own sub-agents (no agent definitions are passed), so those are the SDK's | `agents.ts:1580`, `agents.ts:93,1576` |
| Continuing a Claude session | A session can be resumed by id with the same tools and a new prompt: the repair rounds of a QA stage do it. The wrap-up of a call that ran out of turns resumes with `maxTurns: 2` and no tools | `agents.ts:1442-1444,1590`, `executor.ts:711-717`, `agents.ts:1634-1661` |
| Who else has a limit | A mention, a question of the chain and a request between agents use `runner.turns.read` **and** `wrapUp: true`: out of turns they resume once with no tools and answer "partial", with a note in the thread. A called agent of a stage has a fixed 12, no wrap-up | `src/main/mentions/call.ts:220-221`, `src/main/runner/chain.ts:81-82`, `src/main/runner/request.ts:78-79`, `agents.ts:1612-1614`, `src/main/mentions/answer.ts:412`, `src/main/runner/conversation.ts:339` |
| The settings screen | Two fields (read, write) with their hint and the error "whole number from 1 to 500"; the same section is on the paired phone (only the identity, sandbox and similar blocks are hidden there). The hint says "when they run out, the stage fails" | `src/renderer/src/screens/team/RunnerSection.tsx:110-117`, `src/renderer/src/screens/team/runnerEdit.ts:26-27,66-67,95,137-138,155`, `src/shared/i18n/ui-team.en.json:239,318-321` |
| Who may change it from the phone | `config:cycle-save` accepts a change only when every differing path is under `WEB_EDITABLE`, and `runner.turns` is there already, with everything under it | `src/main/configScope.ts:28,63`, `src/main/configModule.ts:68` |
| Schema | Version 28, whose step wrote `runner.showReasoning` | `src/shared/config/types.ts:5`, `src/shared/config/migrations.ts:410-414` |
| A question to the person mid-stage (host command) | The agent's call awaits `askCommand`. The runner records a pending command (in memory, one per run, never written to the run file), posts a line in the run's thread, sends a notification when they are on, and **waits with no timer**: only the person's answer or the stage's abort ends it. While it waits the stage's clocks are paused | `src/main/runner/service.ts:466-469,478-507,1225-1232`, `src/main/runner/executor.ts:527-553` |
| The clocks | `watchdog.pause()` clears the idle and cap timers, keeps what is left of the cap, counts overlapping pauses and starts again when the last one is released. A conversation answer has its own watchdog with the same `pause` | `executor.ts:276-325`, `src/main/mentions/answer.ts:206,637-649` |
| Other asks | The ceremonies' command store and the app browser's asks keep a list in memory, publish the whole list on a module event, show it in a stack mounted on every screen (window and paired browser) and **decline after 15 minutes** | `src/main/ceremonyCommands-core.ts:45,68`, `src/renderer/src/WebGate.tsx:144`, `src/main/browser/asks.ts:1-14`, `src/shared/browser.ts:11` |
| The run's question channel | `PendingQuestion` (`agent`, `review-limit`, `squad`, `pr-retry`) is written to the run, puts it in a question status and is answered with text; the stage is not alive meanwhile | `src/shared/runs/types.ts:96-130`, `src/main/runner/module.ts:406` |
| Phone and answers | Every channel is open to a paired browser unless named; `actions:approve`, `runs:command`, `runs:startRelease`, `runs:screenAnswer` and `runs:retryPr` need the external-effects switch | `src/main/webPolicy.ts:24,100-105` |
| Activity states | `queued`, `started`, `resumed` ("Step limit reached: answering with what it has read"), `finished`, `failed`, `blocked`. A run is alive while its newest status is not finished or failed; the tree model maps states to `queued`/`working`/`finished`/`failed`, and a node with work (`working`, `queued`, or a child with work) is what the badge counts | `src/shared/activity.ts:3-5,83-86`, `src/main/activity.ts:31-45,245-250`, `src/renderer/src/activityTreeModel.ts:9,47-53,117-119`, `src/shared/i18n/en.json:213-220` |
| Tests that pin today's behavior | A sub-agent out of turns is an error the principal reads and its node ends as failed; a stage out of turns ends in `turns`; a mention out of turns answers partially | `test/engine-open-subagent.test.ts:239,487`, `test/engine-open-loop.test.ts:244-308`, `test/runner-config.test.ts`, `test/runner-chain.test.ts`, `test/forum-mentions.test.ts` |

## Rules

### The settings

1. **Five new numbers per workspace**: the turns of an `explore`, an `edit`, a `shell` and a `screen` sub-agent, and of a plain sub-agent (the one that is not of a kind). Defaults: 12, 30, 20, 30, 12, the values of today. Same range as the stage's turns, 1 to 500, with the same error text. They sit in Settings › Runner right under the stage's two fields.
2. **Computer and paired phone both edit them.** They live under the path a paired browser may already change (`runner.turns`), so the phone gets them without any new permission and still cannot change anything outside the list of paths it has today.
3. **Read when the work starts.** A sub-agent takes its limit when it starts; a stage when its attempt starts. Changing a number does not touch work that is already running or waiting; it applies from the next sub-agent or stage.
4. **A workspace that existed before behaves exactly as before**, with the numbers above, until the person edits one. How the format change is written (a step in the migration chain, `rules/config-schema.md`) belongs to the plan.
5. **The hint of the stage's turns is corrected.** It must stop saying that the stage fails when they run out, and say that the app asks.

### Reaching a limit

6. **It never fails the work.** When a sub-agent or a stage uses its last turn on the open engine, at the point where today it throws, the work pauses and asks. What it read, what it wrote on disk and its dialog stay as they are; nothing is replayed or restarted.
7. **Two answers.** *Continue*: the limit rises by one round and the work goes on from where it stopped. *Finish now*: the work ends with what it has (rules 11 and 12). There is no third answer and no free text in this delivery.
8. **A round is the size of the limit.** For a sub-agent, its own limit as it was set when it started (12 more for an `explore`). For a stage, Q2. When the round is used up it asks again, as many times as the person says continue (Q4).
9. **The question says what the person needs to decide.** Who waits (the agent's name, and for a sub-agent its kind and task, clipped and masked as the activity lines are), in which run and stage, how many turns it has used, how big the next round is, how many rounds were already granted, and since when. No tool output, file content or environment is in it.
10. **Waiting has no end of its own.** No timer declines it, answers it or cancels it. It ends by the person's answer, by the person cancelling the run or stopping the answer, or by the app closing (the same ends a working stage has). A cancel or a stop ends it as "finish now" would, without the conversation claiming that the person chose it; a closing app ends the wait with the work, and a stage that was working starts over after a restart, as it does today. The question itself is never written to the run's file.

### What "finish now" gives

11. **A sub-agent returns a partial result, and the principal is told it is partial.** The principal reads text that says the sub-agent stopped at its limit by the person's choice and that the rest is what it had; it is not a tool error and the sub-agent's node ends as finished. What the partial result is, is Q1.
12. **A stage ends as it does today**: the "turns" failure, in the same words, retryable by the person the same way. The only difference is that it was the person's answer and not an automatic stop.
13. **The conversation says it, both times.** The run's conversation gets a line when the question is asked and a line when it is answered, in the same style as the command's lines: who asked, what the person chose, and for "finish now" that a partial result went to the principal (or that the stage ended). Masked like every line of the conversation.

### The clocks

14. **The stage's idle and wall clocks stand still for the whole wait**, both when the stage's own agent waits and when only a sub-agent does (the principal is blocked on it, so the stage looks silent). They start again when the last overlapping wait ends, the wall cap with what was left of it, as with a command that waits. A sign of life arriving while paused does not start them.
15. **Other work is not held.** Parallel sub-agents of the same turn keep running while one waits; the principal's turn ends when all its tool calls return, so the principal does not go on before the waiting one is answered. Several can ask at the same time (rule 17).

### Where the question appears and who answers

16. **It reaches every screen.** The run's screen, the stack of waiting questions that is on every screen of the window and the paired phone, and the run's conversation; and, when notifications are on, a notification that opens the run, as the command's does. The paired phone shows it from the same stream and can answer it.
17. **Each question is its own.** Two sub-agents of one turn can both reach their limit; each leaves its own question, answered separately, and neither answer touches the other. Sub-agents of the kinds that change things run one at a time, so at most one of them asks at a time.
18. **The phone's answer is not behind the external-effects switch.** Continuing spends the person's model budget on work the agent was already allowed to do and opens no tool, host or file it did not have; it is not a write to the code host or a command on the computer. The channel is named in the web policy and pinned by a test, so a later change of the default cannot close or open it by accident (Q8).
19. **One door for any answerer.** The question is a plain record (an id, the run, the stage, the agent, the kind of work, the turns used, the round size, the rounds granted, since) and the answer is one call with that id and one of the two decisions. The window, the paired phone and, later, an agent all go through that same call, and an answer to a question that no longer waits is refused as gone and never applied twice. The audit says who answered (the window or a paired browser) in a field that can hold a third value later. Nothing for an agent answerer is built here: no tool, no prompt, no permission.

### The Claude engine

20. **A stage on the Claude engine asks too.** Its principal agent reaching `maxTurns` is the same question and the same two answers. "Continue" has to keep the session going past the limit (Q3). The settings for sub-agents apply to the open engine; the SDK's own sub-agents keep the SDK's limits, which the app does not set.

### Where it applies

21. **A sub-agent asks wherever the open engine runs it**: in a stage, in an agent called from a stage and in an answer in a conversation outside a run. The answer's own limit and the other calls that already finish with a partial answer keep doing so (Q6). A called agent of a stage keeps its fixed limit (Q7).

### The activity tree

22. **A node that waits for the person has a state of its own**, apart from "waiting its turn" (which is a sub-agent waiting for another). It says it is waiting for you and why, with the numbers of the question ("Reached 12 turns: waiting for you"), in both catalogs. The state is cleared when the question is answered: it goes back to working on "continue" and to finished on "finish now".
23. **A waiting node is alive.** It counts as work for the badge and for "is this run active", so it does not disappear from the panel while it waits, and the eviction rules for a working node keep applying to it.
24. **The collapsed line of an ancestor shows it.** A closed run, agent or sub-agent whose descendant waits for the person says so on its own line, so the wait is not hidden by collapsing. Opening the node shows the child with its reason.
25. **The tree only shows.** It adds no button to answer; the question is answered where rule 16 puts it. The entry opens the run's conversation as it does today.

### What does not change

26. **Nothing is stored beyond the settings.** The question, the waiting state and the partial result are in memory, as the activity is; only the five numbers go in the workspace's configuration.
27. **Costs and permissions stay as they are.** "Continue" does not widen what an agent may read, write or run, and the idle and wall caps are the same numbers.
28. **Every new string** goes through `t()` with the key in both catalogs, and the card, the stack entry and the tree use theme tokens only.

## Out of scope

- **The persona of #245 answering.** Only the door and the record of rule 19; no agent answers in this delivery.
- **A cap on how many times "continue" may be pressed**, and any budget or cost limit (Q4).
- **A time limit on the question**, or any automatic answer after a wait.
- **Surviving a restart.** The question and the waiting work are lost with the process, as a working stage already is.
- **A different size for a round**, and free text with the answer ("continue, but look at X"). Two answers only.
- **Asking in a conversation for the answer's own limit** (a mention, a chain question, a request between agents), which keep their partial answer (Q6).
- **The called agent of a stage**, with its fixed 12 turns, and the other fixed limits of the ceremonies (Q7).
- **The Claude SDK's own sub-agents**, whose limits the app does not set.
- **Per-agent turn limits**, and changing the idle or wall limits.
- **Answering from the activity tree.**
- **Changing the kinds of sub-agent, their depth, their tools or which model they run on.**

## Acceptance criteria

Each one is a check a person makes on screen or by test, with the data folder pointed at an empty one and a fake model.

1. **Settings.** Settings › Runner shows five new numbers with 12, 30, 20, 30 and 12; a value outside 1 to 500 is refused with the same error as the stage's; saving survives a restart; the paired phone shows and saves the same numbers.
2. **A limit is a setting.** With the `explore` limit at 3, an `explore` sub-agent that needs more stops after 3 turns and asks; with it at 20 and the same task, it finishes without asking. A change made while a sub-agent already waits does not change that sub-agent's round.
3. **Continue, sub-agent.** A sub-agent that reached its limit leaves one question. Continue lets it go on, with its earlier steps still in its dialog and nothing redone, for one more round, and it asks again if that round is spent too. The principal receives its normal result in the end.
4. **Finish now, sub-agent.** The principal receives a partial result marked as such, as the sub-agent's answer and not as an error; the sub-agent's node ends finished; the run's conversation has the line saying the person finished it and that a partial result went to the principal; the stage does not fail.
5. **A stage.** A stage that reaches its limit leaves the same question instead of an error. Continue gives it another round and it finishes normally. Finish now ends it with the "turns" failure the person can retry, and the conversation says it was the person's answer.
6. **No answer.** With the question unanswered for longer than the stage's idle limit and then longer than its wall cap (with the limits set to a minute in the test), the stage is still working, was not failed by either, and finishes after the answer within its remaining wall time; cancelling the run during the wait ends it without a question left behind.
7. **Clocks while only a sub-agent waits.** With the stage's agent silent because a sub-agent waits, the idle clock does not trip; two sub-agents waiting at once restart the clocks only after both are answered.
8. **Several questions.** Three parallel `explore` sub-agents reaching their limit leave three questions, answered in any order; answering one does not change the other two; the others keep running meanwhile.
9. **Where it shows.** The question is on the run's screen and in the stack on every screen of the window, in the run's conversation, in the notification when notifications are on, and on the paired phone, which can answer it; after an answer it disappears from all of them.
10. **The phone's answer.** A paired browser without the external-effects switch can answer; the web policy names the channel, and a test pins it as open to a paired browser (not external, not desktop-only).
11. **One door.** A second answer to the same question, and an answer after the work ended, is refused as gone and changes nothing. The audit line says whether the window or a paired browser answered.
12. **The tree.** The waiting node shows the waiting state and its reason; its parents show on their collapsed lines that something below waits; the badge still counts the entry; after the answer the node is working, or finished, and the marker is gone.
13. **The Claude engine.** A stage on the Claude engine that reaches `maxTurns` leaves the question; Continue resumes the same session with a new `maxTurns` and the stage goes on; Finish now ends it with the "turns" failure.
14. **Nothing else moves.** A mention that runs out of turns still answers partially with its note; the idle and wall limits keep their values; no file in the data folder holds a question or a partial result; the stage's turns hint no longer says the stage fails.
15. **Wording and theme.** Every new string is in both catalogs and uses `t()`; the card and the tree use theme tokens only.

## Open questions

Answered at gate 1 (2026-10-10): every question is settled with its recommendation.

Each has a recommendation; the maintainer decides at this gate.

**Q1. What is the "partial result" of a sub-agent that is finished now?**
A sub-agent in the open engine has no schema; its result is the text of its last turn. At the limit its last model turn was usually a tool call, so its last narration is often empty or a half sentence.
*Recommendation:* a **forced final turn**: one more model call on the sub-agent's own dialog with no tools offered, asking it to say what it found so far and what it did not get to (the app already does this: the closing call of the loop with `tools: []` at `loop.ts:682`, and the wrap-up of a call that ran out of turns, `agents.ts:1634`). That is one extra turn beyond the limit, paid by "finish now". If that call fails, fall back to the last narration, and if there is none, to a fixed line saying the sub-agent stopped and what its sources were. The text the principal gets begins with a short note that it is partial. The alternative, the last narration alone, costs nothing but often returns nothing useful, which is the failure this issue is about.

**Q2. Does a stage's "continue" add the same number of turns?**
*Recommendation: yes, the size of the setting the stage's attempt started with* (`turns.read` or `turns.write`), so a stage with 30 turns gets rounds of 30 and changing the setting during the wait does not change the round. The alternative, a smaller or growing round, adds a rule the person must learn; the number is the one they set.

**Q3. Can the Claude engine continue a session past `maxTurns`?**
The SDK path ends the call with an `error_max_turns` result and the app already resumes that session by id in two ways: with the same tools and a new prompt for a QA repair round, and with no tools and `maxTurns: 2` for a wrap-up. Nothing was run to see that a resume with the same in-process tool servers, the stage's mailbox stream and the structured answer continues cleanly after a max-turns end.
*Recommendation:* implement "continue" on the Claude path as a resume of the same session with a fresh `maxTurns` of one round and the tools of the stage, and **prove it with one real check outside the suite** at the plan. If it does not hold, the Claude engine keeps asking but offers only "finish now" for the stage, and the spec's criterion 13 is split. The open engine is unaffected, since its loop is simply kept waiting and nothing is resumed.

**Q4. A cap on how many times "continue" can be pressed?**
*Recommendation: no cap.* The maintainer prefers asking over stopping, the person is the one who pays and the one who answers, and the stage's wall cap does not run while waiting but does run while working, so a stage that keeps going is still bounded by it. The question shows how many rounds were already granted so the person sees a loop forming.

**Q5. Where does the question live: the run's question channel, or a new kind of ask?**
The run's `PendingQuestion` is written to the run, moves it to a question status and is answered in text; the stage is not alive meanwhile. That fits a question the *agent* asks the person; it does not fit pausing a live loop that must continue in memory from the same point. A new, runtime-only ask fits: the host-command precedent (one per run, never written, no timer), or the global list of the ceremonies' commands and the app browser's asks (shown in the stack on every screen), which also works with no run behind it.
*Recommendation:* **a new kind of ask, runtime-only, in the global-list style, but without the 15-minute decline those two have** (rule 10), published on a module event and shown in the stack that is already on every screen of the window and the phone, plus the lines in the run's conversation. The run's screen needs no card of its own beyond what its conversation shows unless the plan finds the stack not enough there. The answer is one channel (rule 19). The alternative, one pending record per run like the command, is simpler for a stage but leaves a sub-agent inside a conversation answer with no place to ask.

**Q6. Mentions outside a run: an answer that runs out of turns.**
A conversation answer (a mention, a chain question, a request between agents) already does not fail at its limit: it is resumed once with no tools and answers as partial with a note in the thread (`agents.ts:1612-1614`, `answer.ts:412`). Asking there would hold the conversation's queue behind an unanswered question: the other mentions of that conversation wait their turn behind an answer in flight.
*Recommendation:* **keep the partial answer for the answer's own limit in this delivery**, and let the sub-agents *inside* such an answer ask (rule 21; the answer's clock already has `pause`). Revisit when the persona of #245 can answer. If you want the answer's own limit to ask as well, it is the same record and door, and the cost is that conversation blocked while it waits.

**Q7. The called agent of a stage (12 fixed turns) and the ceremonies' fixed limits.**
A called agent of a stage is neither a sub-agent nor the stage; it runs with a fixed 12 and no wrap-up (`conversation.ts:339`). The ceremonies pass their own numbers in code.
*Recommendation:* out of scope here, left as they are; the called agent is worth its own small issue, since the hook that asks would also serve it.

**Q8. May the paired phone answer without the external-effects switch?**
The brief says the question reaches the phone; the command's answer is behind that switch, because it runs a command on the computer.
*Recommendation: yes, open (rule 18).* The answer lets an agent do more of what it was already allowed to do, at the person's cost, or ends its work early; it opens nothing new. The alternative (behind the switch) would leave a phone able to see the question and unable to answer it unless it had the stronger power, which makes the notification useless for the main reason the phone is paired.

## How it was checked

By reading, in this tree: the issue; the sub-agent runner and its limits, the loop's two throw points and how they surface as a tool error, as a stage failure and as a wrap-up; the executor's turns, its watchdog and its host-command wait; the runner service's pending command, its thread line, its notification and its answer; the stores that ask the person elsewhere (ceremony commands, the app browser's asks) with their 15-minute decline; the web policy and the paths a paired browser may edit; the settings screen, its draft and its limits; the config schema, its version and the most recent migration step; the activity states, the tree model's states and what the badge counts; the Claude SDK path's max-turns result and the existing resumes of a session.

Not verified: nothing was executed. Whether a Claude session resumes with its tools after an `error_max_turns` end (Q3); whether a forced final turn on a sub-agent's dialog gives a useful summary on the models the open engine is used with (Q1); how many callers of the engine have a clock beyond the stage's and the conversation answer's, which must all pause while a sub-agent waits (the plan lists them); the effect of a long-waiting node on the activity log's eviction of runs; whether another branch aimed at the same release already takes the next schema number.

## Priority and milestone proposed

- **Priority: `priority:medium`.** The cost of today's behavior is real but bounded: a review redone by hand, and a stage retried from scratch, on work that can be worth hours. It is not blocking, and the workaround (raise the stage's turns) exists for the stage but not for sub-agents. A proposal; the person accepts or refuses.
- **Milestone: the next beta of `0.9.0`.** It changes a number people already set (the stage's turns) and adds five next to it, and the activity tree it extends landed in this release. The release note says what the person sees: sub-agents' turns are a setting, and reaching a limit asks instead of stopping.
