# Implementation: turn limits as a setting, and a question instead of a stop

Commits follow the order of `2_PLAN.md`. Each section below is written in the commit it describes.

## Commit 1: the turns of each kind of sub-agent are a setting

Schema 29, `v28ToV29`, the five keys `runner.turns.explore|edit|shell|screen|plain` (types, defaults, schema in one commit), the draft and the section of Settings › Runner, the
catalogs (without the corrected hint of the stage's turns, which belongs to commit 4), `docs/configuration.md` in both languages, the loop reading `subTurns` when a sub-agent
starts, and the pinned tests. At a limit nothing asks yet: the sub-agent ends as before, with the configured number in the text.

Deviations from the plan:

- `subTurnsOf(read, kind)` (in `subagent.ts`, beside `DEFAULT_SUB_TURNS` and the `SubTurns` type) is the one place that turns the setting into the number a sub-agent gets, and
  it falls back to the default of the kind when the setting is not a whole number of at least 1. The plan had the loop index `subTurns()` directly.
- The step writes the five defaults as literals (12, 30, 20, 30, 12) and not from `neutralRunner()`, so a later change of the neutral defaults cannot change what the step
  wrote for a workspace that existed.
- `OpenRunParams.subTurns` is typed `Partial<Record<SubKind | 'plain', number>>`, so a harness or the app may hand it the whole `runner.turns` (which also carries `read`
  and `write`) without a copy.
- The plain sub-agent's failure text stays the raw `agent ended with error_max_turns` (the plan only gives the effective number to the sub-agent of a kind, as today).
- The CHANGELOG line of the setting is in this commit; the line about the question goes in the commit where it lands.

## Commit 2: the store of questions at a turn limit and its door

`shared/turnLimit.ts` (the record, the two decisions, the answerer, the event), `turnAsks-core.ts` (the store: no timer, one entry per question, abort ends as `finish` by `abort`,
one `answer` door), `turnAsks.ts` (the process store, the audit writer, the notification, the module with `turnAsks:list` and `turnAsks:answer`), `modules.ts`, the audit kind
`turn-limit` and its entry in the audit screen, and the two channels named in the web policy with their test. Nothing calls `ask` yet, so nothing is visible to the person: no
CHANGELOG line in this commit.

Deviations from the plan:

- `TurnAskInput` (the record without `id` and `since`) is exported from `shared/turnLimit.ts`, because the engine-side asker of commit 4 files it.
- `answer` returns `{ ok: false, reason: 'decision' }` for a decision that is not one, or `continue` where `canContinue` is false, and throws `TurnAskGone` only for a missing
  id; the channel checks the decision first (a bad decision to a gone id answers `decision`, as `runs:screenAnswer` does) and turns `TurnAskGone` into `gone`.
- A listener that throws (`changed`, `asked`, `audit`) is logged and ignored by the store, so it can neither decide an answer nor leave a question waiting.
- The notification bodies take `{used}`, `{round}` and `{task}` (the task clipped to 120 characters); the kind of a sub-agent is on the card of commit 5, not in the notice.
- The policy test reads `src/main/engine` to pin that the engine has no `turnAsks:` channel (the agent answerer is not built here).

## Commit 3: pause the open engine at a turn limit and ask

`TurnDecision`, `TurnStop` and `TurnLimit` in `engine/contract.ts` (and `EngineRequest.turnLimit`); `OpenRunParams.turnLimit`; the loop's `room()` and `finishNow()` in place of the
two throws (the top of the turn and the door's repair round); the partial result of a sub-agent (`finishNow`: a closing call with no tool, then the last narration, then a
line naming what it read, behind a note); `runAgent` of the loop wrapping the question of a sub-agent with its node (`waiting`, `continued`) and its kind and task;
`bridge.ts` and `runOpenEngine` passing `turnLimit` through; `AgentCall.turnLimit` and `turnLimitOf` in `agents.ts` (the call's own node says it waits and that it works again);
`RunActivity.waiting`/`continued` and the `waiting` activity state; `wrapUpAnswer` without the question. Every caller still passes none, so nothing asks yet and there is no
CHANGELOG line in this commit.

Deviations from the plan:

- `SubAgentHandle.waiting` and `.continued` are optional, so a caller that does not show a node (and the harnesses of the tests) keeps working; `openSubAgent` implements both.
- `OpenRunParams.task` was not added: the wrapper in the loop's `runAgent` fills the kind, the `subagent_type` and the task (the description, else the first 200 characters of the
  prompt) of the stop itself, so the nested run needs no field for it.
- The `{who}` of the partial note became two catalog keys, `main.engine.text.partialNote` (with the kind) and `main.engine.text.partialNotePlain` (a sub-agent of no kind), so the
  sentence is translated whole.
- `finishNow` of a stage throws `OpenMaxTurnsError` as the plan says; a sub-agent's returns through the same `done()` as any result, with the turns it used.
- The sources that name what a sub-agent read when it had nothing to say start at the length of the shared list when the run began (`startSources`), since the list is the
  principal's.
- `test/agent-turn-limit-open.test.ts` is a file the plan did not list: it pins the part of `runAgent` that commit 3 adds (the node's states around the wait, the failure
  of "finish now", the wrap-up that never asks). The part of the plan's `test/agent-turn-limit-sdk.test.ts` that is about the Claude engine stays for commit 7.
- `test/activity-turn-wait.test.ts` holds the log's part now (the tree model's part comes with commit 6).

## Commit 4: ask the person when a stage or a sub-agent reaches its turn limit

`main/turnLimit.ts` (`turnAsker`: the record, the two lines of the conversation, the masked task, the caller's clocks stood still for the whole wait on every outcome, one signal
from the engine's and the caller's); the three callers wired: the stage (`executor.ts`, `ExecutorDeps.turnAsks`, `RunnerDeps.turnAsks`, the runner module passing the process
store), the agent a stage calls (`ConversationDeps.turnAsks` and `.pause`, filled from the stage's watchdog) and an answer in a conversation outside a run (`MentionDeps.turnAsks`,
the mentions module passing the process store; not for a ceremony place); `askAgain` (so the QA repair, the evidence round and the missing-documents round) without the question;
the six conversation lines and their catalogs; the corrected hint of the stage's turns and the same sentence in the hint of the sub-agents' turns; the CHANGELOG line.

Deviations from the plan:

- **The CHANGELOG line is in this commit, but the buttons come in commit 5.** From this commit the question is filed, said in the conversation and notified, and it waits with no
  timer; the card that answers it (the stack on every screen and on the phone) is commit 5. Commits 4 and 5 are meant to be read, merged and shipped together: a build at commit 4
  alone would leave a stage waiting for an answer nobody can give (only `turnAsks:answer` over the wire could).
- A mention answered in a **run's thread** is not wired (the runner's own `answerMentions` call in `service.ts` passes no `turnAsks`): rule 21 lists the stage, the agent a stage
  calls and an answer in a conversation outside a run. `answer.ts` handles `place.run` when a caller does pass the store, so wiring it is one line in `service.ts`.
- The lines name the agent by the name the team gives it (`agentLabel`), not by its id, which is what the command lines use.
- The record's `agent` is the id and `name` the team's name for both the stage and the called agent; for an answer in a conversation it is the agent that answers.
- `test/helpers/runner.ts` gained `BootOptions.turnAsks` (the runner tests hand the store to `createRunner`).
- `test/runner-turn-limit.test.ts` drives the executor with the scripted engine of the runner tests (the responder calls `call.turnLimit.ask` as the open engine would, and throws
  `MaxTurnsError` on "finish now"), not the open engine on `fakeOpenAI` as the plan wrote: the loop's side is `test/engine-open-turn-limit.test.ts`. The clocks are real here
  (150 ms idle, 500 ms cap, a wait of one second); the fake-timer version of acceptance 6 and 7 is `test/turn-limit-ask.test.ts` on the real watchdog.
- The wait test found that a question asked before the watchdog's `guard` begins cannot pause it; the real engine always reaches its limit after at least one model call, so the
  tests let the responder take a moment first.

## Fix after commit 4: a mention answered in a run's thread asks too

The maintainer wants every limit that can ask to ask. The runner's `answerMention` (`service.ts`) now passes `turnAsks` to `answerMentions`, so a sub-agent of an agent named in a run's
thread leaves its question, with the run and the thread named, and the lines are in that thread (`answer.ts` already handled `place.run`). This replaces the second deviation of commit 4;
the answer's own limit still ends in a partial answer (spec Q6), and the chain question and the request between squads still pass none. Pinned in `test/runner-turn-limit.test.ts`.
