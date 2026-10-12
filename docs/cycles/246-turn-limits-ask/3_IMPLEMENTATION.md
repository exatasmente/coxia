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

## Commit 5: show the questions waiting for the person on every screen

`AskStack.tsx` (the one `div.cc-stack` holding the command cards and the turn cards, mounted by `WebGate` in place of `CeremonyCommands` for the window and the paired browser alike),
`CeremonyCommands.tsx` split into `useCeremonyCommands()` and the card `CommandCard`, `TurnAsks.tsx` (`useTurnAsks()` and `TurnAskCard`), the DOM-free `turnAskView.ts`
(`turnAskLines`, `sameTurnAsks`), `turnAsks.css` and the `ui.ask.*` / `ui.turnAsk.*` keys in both `ui-shell` catalogs. `ui.ceremonyCommand.region` went with its last reader.

Deviations from the plan:

- `turnAskLines(ask, say, time)` takes the translating function and a time formatter and returns finished strings, not keys and params: the test renders the real catalogs, so a wrong
  key or parameter fails there. `useT()` and the catalogs are the only renderer parts the card needs.
- Two keys the plan did not list: `ui.turnAsk.title.subPlain` (a sub-agent of no kind), `ui.turnAsk.noTask` and `ui.turnAsk.refused` (an answer the door refused as `decision`); three
  `ui.turnAsk.where.*` keys say where it waits (a run's stage, a run, a conversation). `ui.turnAsk.gone` was not added: an answer that comes back `gone` only takes the card away,
  there is nothing to say.
- The stage's title reads "{agent} used {used} of {limit} turns" with `limit` equal to `used`: the work stopped at its limit, and the record carries no separate limit.
- `useCeremonyCommands()` is the old effect unchanged (it does not refetch on reconnect, as before); the new hook does, on reconnect and on window focus.
- The card reuses the classes of the command card (`cc-item`, `cc-title`, `cc-actions`); `turnAsks.css` only adds the detail line.

## Commit 6: show a node that waits for the person in the activity tree

`activityTreeModel.ts` (`NodeState` `waiting`; `stateOf` reads it from the newest status line; `hasWork` counts it, so `topEntries` keeps the entry and the badge counts it once;
`waitsBelow`, `anyWaiting`, `waitingLine`; `TopEntry.waits`), `ActivityTree.tsx` (the state word for a waiting node, and on a closed row whose descendant waits "Waiting for you, below"),
`JobsDock.tsx` (a closed entry whose tree waits shows the reason of the waiting node in place of the newest step), `activity.css` / `jobs.css` (amber tokens, with the night variant the
file already has for red), `activity.node.state.waiting` and `activity.node.waitsBelow` in both catalogs (`activity.turnLimit` and `activity.continued` came with commit 3).

Deviations from the plan:

- `waitingLine(nodes)` is new: the dock's closed line shows the newest waiting node's own line ("Reached 12 turns: waiting for you"), which already says why, instead of a second
  text key. `Steps` takes `waits` (the entry's, or `anyWaiting` for a renderer job's tree) and picks that line only while closed.
- The tree still has no button: the row of a waiting node is the same markup as any other, with the class `act-state-waiting` that the amber rule reads.
- The tests are in `test/activity-turn-wait.test.ts` (the log's part from commit 3, the model's part here), not in `activity-tree.test.ts`, whose cases are untouched.

## Commit 7: a stage on the Claude engine continues past its turn limit

### The real check (outside the suite, not committed)

The throwaway script of the plan (`scratch/check-claude-resume.mjs`, git-ignored folder, deleted afterwards) was run on 2026-10-10 against the Claude Agent SDK 0.3.292 with the
Claude login of this machine, in a clean environment (`env -i` with `HOME` and `PATH`, so no inherited Claude Code variable reached it) and with `CERIMONIAS_DATA_DIR` and
`CERIMONIAS_SPECS_DIR` on empty temporary folders; the script does not read the app's data at all. It mimics the shape `runClaudeSdk` gives the SDK: a streaming prompt that stays
open, an in-process tool server, `outputFormat` as a JSON Schema, `permissionMode: 'dontAsk'`, no setting sources. The first call has `maxTurns: 3` and is asked for five calls of a
tool; the second resumes the session with `maxTurns: 6`.

| Model | First call | Second call (resumed) |
|---|---|---|
| `haiku` | `error_max_turns`, a session id, 2 tool calls so far, `num_turns` 4 | `success`, `structured_output` `{"steps":5}`, 5 calls in total, same session id, `num_turns` 5 |
| `sonnet` | `error_max_turns`, a session id, 2 tool calls so far, `num_turns` 4 | `success`, `structured_output` `{"steps":5}`, 5 calls in total, same session id, `num_turns` 6 |

**It passes**, on each point the plan set: the first round ends with `error_max_turns` and a session id after two calls; the second ends with `success`; its structured answer says 5;
the total of tool calls is 5 (three more in the resumed session, none redone); the in-process tool server answered in the resumed session (no unknown tool, no missing session); and
the limit counts per invocation, not per session (the session had used 4 turns when it was resumed with 6, and the second call used 5 and 6 without ending in `error_max_turns`;
counted from the start it would have run out). Not shown by the script, as the plan said: the stage's mailbox stream, which `runClaudeSdk` builds again on every call, pinned by the
test with the scripted `query`.

Because it held, `CLAUDE_CAN_CONTINUE` is `true` and the commit is the one that continues, not the one that offers only "finish now".

### What the commit does

`runAgent` (`agents.ts`) asks the stage's own limit on the Claude engine around the engine call: a `MaxTurnsError` with a session id, from a call whose `turnLimit.own` is set and whose
picked model is on the Claude engine, raises the question; on "continue" the call runs again as a resume of the same session (`continueRound`: a new prompt, `resume` and
`extra.resume` set, `extra.maxTurns` one round), the sources of the rounds are joined, and it asks again if that round is spent too; on "finish now", or when the call was
cancelled during the wait, the `MaxTurnsError` goes up and the executor makes the "turns" failure as before. A call that wraps up still does after "finish now", and the wrap-up
never asks. The new text is `main.engine.text.continueRound` in both catalogs; the CHANGELOG line now says the stage asks on either engine.

Deviations from the plan:

- The loop is in the callback of `withPool`, around `runnerFor(picked)`, with `anotherRound` and `continueRound` as small functions beside `turnLimitOf`, not a new `continueRound` of the
  module's exported surface. `CLAUDE_CAN_CONTINUE` is exported, as the plan names it.
- The test of the plan for `CLAUDE_CAN_CONTINUE = false` is not written: a constant cannot be flipped by a test, and the branch (`canContinue: false` refusing "continue") is the store's,
  already pinned in `test/turn-asks-core.test.ts`. The asker still ignores a "continue" when the constant is `false`.
- `EngineRequest.resume` is left as the plan had it (issue #253 tracks it); the commit sets it only on the request it builds for the resumed call, next to `extra.resume`.

## Commit 8: document the turn limits that ask

`docs/runner.md` in both languages (a section "When a turn limit is reached (#246)" after "Questions and mentions"; the sentence about a stage that runs out of steps in the
"Turn limit of these calls" paragraph; a bullet in "The live activity" for the node that waits; a bullet in "Not verified"), a pointer in the `turns` row of `docs/configuration.md` in
both languages (the rows and the history of the schema were done in commit 1), and the `CHANGELOG.md` line under `## [Unreleased]` completed (the screens and the phone, the audit, the
tree, the Claude engine).

Deviations from the plan: none beyond the ones of the commits above. The plan listed the CHANGELOG line as written in this commit; it was written in commit 4 and is completed here, as
the maintainer decided after commit 4 (no reshuffle).

## Review fixes

The review (`4_REVIEW.md`) found no blocker; these are the six points it asked to fix before the merge, one commit each.

1. **Leaving the waiting state on "finish now".** A sub-agent's node kept saying it waited for the person while its closing call ran. Any answer that is not an abort now moves the node out of the
   waiting state before the work goes on: `continued` for a new round, `started` for "finish now" (the round text would be wrong there). The finish case of `engine-open-turn-limit.test.ts` pins the order of the notes.
2. **Sub-agents ask in a stage's extra rounds.** The repair, evidence and missing-document rounds (`askAgain`) dropped the question altogether. They now keep it with `own: false`: the round's own limit stays
   quiet and ends as before, and the sub-agents the round starts ask. Test in `runner-turn-limit.test.ts`.
3. **The pause of a conversation answer's clock is pinned.** A test runs a mention answer with its real watchdog (the shortest limits the setting allows, time moved by fake timers) and shows the answer outlives both
   limits while its sub-agent waits. With `pause` replaced by a no-op the test fails.
4. **An older client cannot reset the sub-agent limits.** `keepStoredTurns` (`configScope.ts`) fills the missing `runner.turns` keys from the stored configuration before `config:save` and `config:cycle-save`
   validate, so the defaults no longer overwrite what the person set. Tests in `config-web-scope.test.ts`.
5. **The abort listeners of a question are released.** `either()` in `turnLimit.ts` now removes its listeners from both signals when the combined one fires and when the question settles. Test with two distinct signals.
6. **Texts.** One Portuguese word for "turn" in the turn texts ("passos", as the settings use): `activity.turnLimit`, the partial notes and the sub-agent stop text. `ui.turnAsk.where.run` is gone (the card
   passes the reference itself). The time placeholder `--:--` is gone too: it read the same in both languages, so a time that cannot be read now leaves its line out. The unused `ta-item` class is removed.

## Delivery summary

What the delivery does, against the acceptance criteria of `1_SPEC.md`:

1. **Settings.** Five numbers (`runner.turns.explore|edit|shell|screen|plain`, schema 29, `v28ToV29`) in Settings › Runner, 12/30/20/30/12, 1 to 500 with the stage's error, edited by the
   computer and a paired browser (the path was already in `WEB_EDITABLE`). Met by the tests of commit 1; not seen on screen.
2. **A limit is a setting.** A sub-agent reads its number when it starts (`subTurnsOf`); a setting changed during a wait does not change its round. Met by `test/engine-open-turn-limit.test.ts`.
3. **Continue, sub-agent.** The loop is kept waiting and goes on with the same dialog; it asks again after the round. Met by the same file.
4. **Finish now, sub-agent.** A closing call with no tools, then the last narration, then a fixed line, behind a partial note; a tool result and not an error; the node ends finished; the thread
   says it. Met by `test/engine-open-turn-limit.test.ts`, `test/agent-turn-limit-open.test.ts` and `test/runner-turn-limit.test.ts`. The usefulness of the summary on a real model is not known.
5. **A stage.** It leaves the question; continue finishes it normally; finish now ends in `turns`, retryable, with the line that it was the person's answer. Met by
   `test/runner-turn-limit.test.ts` (scripted engine) and `test/agent-turn-limit-open.test.ts` (the real loop).
6. **No answer.** Idle and wall clocks stand still for the whole wait (a real watchdog under fake timers, and real clocks in the runner test); cancelling ends it with no question left. Met.
7. **Clocks while only a sub-agent waits; two waiting at once.** Met by `test/turn-limit-ask.test.ts` and `test/runner-conversation.test.ts`.
8. **Several questions.** Three parallel sub-agents leave three independent questions, answered in any order. Met by `test/engine-open-turn-limit.test.ts`.
9. **Where it shows.** The store and its event, the stack on every screen of the window and the phone (`AskStack`), the run's thread, the notification, the paired phone. The data and the
   lines are tested; **the stack was not seen on screen** (no `.tsx` is rendered by the suite).
10. **The phone's answer.** Named in the web policy as open to a paired browser, pinned in `test/turn-asks-policy.test.ts`.
11. **One door.** A second answer, or one after the work ended, is refused as `gone`; the audit line says `window` or `paired`. Met by `test/turn-asks-core.test.ts` and the policy test.
12. **The tree.** The `waiting` state, the amber row, the collapsed line of the ancestors and of the dock's entry, counted once by the badge. The model is tested
    (`test/activity-turn-wait.test.ts`); **the rows were not seen on screen**.
13. **The Claude engine.** The real check passed (commit 7), so continue resumes the same session with a fresh limit and the stage goes on; finish ends it with the "turns" failure. Met by
    `test/agent-turn-limit-sdk.test.ts` with the scripted `query`, and by the real check once by hand.
14. **Nothing else moves.** A mention that runs out of turns still answers partially with its note; the idle and wall limits keep their values; the run's file holds no question; the stage's
    hint no longer says it fails. Met by `test/forum-mentions.test.ts`, `test/runner-turn-limit.test.ts` and the catalogs.
15. **Wording and theme.** Every new string is in both catalogs through `t()`; the card, the stack and the tree use theme tokens only (`node scripts/theme-audit.mjs`, `npm run i18n:lint`).

Also in the delivery, beyond the plan's list: a mention answered in a run's thread asks for its sub-agents too (the fix after commit 4).

### Not verified

- **The cards, the stack and the tree on screen.** The suite renders no component (`vitest.config.ts` is `environment: 'node'`); the pure functions behind them are tested, and the colors pass the
  theme guard. How the stack looks with three sub-agents plus a command at once, on the phone and in the dark panels, was not seen.
- **A real model at a limit.** Nothing ran with a real model through the loop's pause: whether the closing call with no tools gives a useful summary is not known (spec Q1).
- **The Claude resume with the stage's open message stream.** The real check used a streaming prompt that stays open, but not the app's door; the scripted `query` pins that the app builds
  the stream again. Checked on `haiku` and `sonnet` only, with SDK 0.3.292.
- **A caller's clock the plan did not cover.** The agent a stage calls has no clock of its own, so the wait of its sub-agent stops the stage's clocks (risk 7 of the plan); whether a called agent
  that works for long without a sign of life already trips them today was not checked.
- **A node that waits for days** and the activity log's limit of live trees: not measured.
- **A paired browser with a stale bundle** saving `runner.turns` without the five keys: fixed after the review (review fix 4); not tried from a real old bundle.
- **The schema number.** 29 was free on `0.9.0`; the persona (another branch) also takes a step. Whichever lands second renumbers, and this has to be looked at again before the pull request.
- **Issue #253** (`EngineRequest.resume` looks unused) is the maintainer's to track; this delivery sets `extra.resume` itself and does not depend on the field.
