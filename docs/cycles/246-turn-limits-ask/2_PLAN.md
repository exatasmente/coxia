# Plan: turn limits as a setting, and a question instead of a stop

## What this plan is

The approved specification (`1_SPEC.md`, gate 1 passed on 2026-10-10: every open question settled with its recommendation) asks that the turns of the sub-agents be workspace
settings, and that an agent or a sub-agent that uses its last turn pause and ask the person, "continue for another round" or "finish now", instead of failing. This document
says where each piece lands in this tree, in which order it is built, and which tests hold it. Every `file:line` below was read again on `0.9.0` (`b6dab598`, the tree this
branch sits on, with the activity tree of the earlier cycle already in it), so some numbers differ from the spec's, which was read on a beta. The schema is 28 here; this
delivery takes the step 28 to 29.

The shape of the answer, in six sentences:

- **The limits are five more keys of `runner.turns`.** `explore`, `edit`, `shell`, `screen` and `plain` sit beside `read` and `write`. They are already under the path a paired
  browser may edit, they default to today's constants, and the format change is one step of the migration chain (`v28ToV29`) that writes those defaults into an existing file.
- **The loop pauses where it throws today.** At the two places `loop.ts` throws `OpenMaxTurnsError`, it first asks an injected `turnLimit.ask(stop)`; "continue" raises the
  limit by one round and the loop goes on with its dialog untouched, "finish now" ends as today for a stage and returns a partial result for a sub-agent. With no `ask` given
  the loop behaves exactly as before, which is how every caller that is not wired keeps its behaviour.
- **The question is a runtime-only record in a store of its own**, in the style of the ceremonies' command store but with no timer, behind two named channels
  (`turnAsks:list`, `turnAsks:answer`) that are open to a paired browser, and one audited answer call that any answerer, an agent later, goes through.
- **The callers that have a conversation to say it in are wired**: the stage, the agent a stage calls, and an answer in a conversation outside a run. Each builds one asker
  (`turnAsker`) that posts the line in its conversation, stops its own clocks while the question waits, and returns the decision.
- **The Claude engine asks too, and "continue" is a resume of the same session.** Because that has never been seen working, it is built last, after one real check outside the
  suite; if the check fails the question is still asked on that engine but offers only "finish now".
- **The screens**: one stack on every screen of the window and the phone (the stack of the ceremonies' commands, extended to hold both lists), a new `waiting` state of an
  activity node, and a collapsed line on every ancestor that says something below waits.

## What will be built

| Feature (spec rule) | Where it lands |
|---|---|
| Five sub-agent limits as settings, defaults, range 1 to 500, paired phone edits them (1, 2, 3, 4) | `src/shared/config/types.ts` (`RunnerTurns` `:830`), `defaults.ts:37`, `schema.ts:562`, `migrations.ts` (`v28ToV29`, `STEPS` `:416`), `src/main/configScope.ts` (nothing to add), `screens/team/runnerEdit.ts`, `RunnerSection.tsx`, `ui-team.*.json` |
| The open engine reads the limit when a sub-agent starts, from the setting (3) | `src/main/engine/open/subagent.ts:22-23` (`KIND_TURNS` stays as the default), `loop.ts:456`, `bridge.ts`, `agents.ts:657-727` |
| Pause and ask at the limit, continue by a round, finish now (6, 7, 8, 11, 12) | `src/main/engine/open/loop.ts` (`OpenMaxTurnsError` `:166`, throws `:692` and `:778`, `runAgent` `:414-489`), `src/main/engine/contract.ts` (new `TurnStop`, `TurnLimit`, `EngineRequest.turnLimit`), `bridge.ts:175` |
| A partial result for a sub-agent: one closing turn with no tools, then the fallbacks (11, Q1) | `loop.ts` (new `partialOf`), `src/shared/i18n/main.*.json` (`main.engine.text.partial*`) |
| The question as a record, the store, the door, the audit line (9, 10, 19, Q5) | new `src/shared/turnLimit.ts`, `src/main/turnAsks-core.ts`, `src/main/turnAsks.ts`, `src/main/modules.ts:8,48`, `src/shared/auditoria.ts` (`AuditKind`), `Auditoria.tsx:14-32` |
| One asker per caller: the lines, the clocks, the signal (13, 14, 15, 17, 21) | new `src/main/turnLimit.ts`; wired in `runner/executor.ts` (`:1040`, `:1111`), `runner/conversation.ts` (`:146`, `:339`), `mentions/answer.ts` (`:304`, `:354`), `runner/service.ts` (`:215`, `:431`), `runner/module.ts`, `mentions/module.ts:91` |
| The stage's own limit asks on the Claude engine (20, Q3) | `src/main/agents.ts` (`runAgent` `:1608-1615`, new `continueRound`), `claude-sdk` result at `:934` |
| The question on every screen and on the phone (16, 18) | new `renderer/src/AskStack.tsx`, `TurnAsks.tsx`, `turnAskView.ts`, `turnAsks.css`; `CeremonyCommands.tsx` split, `WebGate.tsx:144` |
| The waiting node and the collapsed ancestors (22, 23, 24, 25) | `src/shared/activity.ts` (`ActivityState`), `src/main/activity.ts` (`RunActivity` `:31`), `renderer/src/activityTreeModel.ts` (`NodeState` `:9`, `stateOf` `:47`, `hasWork` `:117`), `ActivityTree.tsx`, `JobsDock.tsx:92`, `activity.css`, `src/shared/i18n/en.json` / `pt-BR.json` |
| The phone may answer without the external-effects switch, pinned by a test (18, Q8) | `src/main/webPolicy.ts` (new `TURN_ASK_CHANNELS`, `webAccess` `:100`), new `test/turn-asks-policy.test.ts` |
| The hint of the stage's turns is corrected (5) | `src/shared/i18n/ui-team.en.json:319-321`, `ui-team.pt-BR.json:319-321` |
| Documentation | `docs/configuration.md` (version lines, history, the `runner` rows), `docs/runner.md` (both languages), `CHANGELOG.md` under `## [Unreleased]` |

## Data

### The record of a question (shared, `src/shared/turnLimit.ts`, new)

```ts
export const TURN_ASKS_EVENT = 'turn-asks';                       // the whole list on every change, as the commands' event does
export const TURN_DECISIONS = ['continue', 'finish'] as const;
export type TurnDecision = (typeof TURN_DECISIONS)[number];
/** Who gave the answer. A third value is the persona of a later issue; nothing here produces it. */
export type TurnAnswerer = 'window' | 'paired';

export interface PendingTurnAsk {
  id: string;
  /** `stage`: the agent of the stage used its last turn. `sub`: a sub-agent it started did. */
  of: 'stage' | 'sub';
  /** The run the work belongs to; null for an answer in a conversation outside a run. */
  run: string | null;
  /** The conversation whose lines say it (`run-<id>` for a run). */
  thread: string;
  ref: string | null;            // the run's issue reference, null outside a run
  issue?: number;                // for the audit line only
  stage: string | null;
  agent: string;                 // id
  name: string;                  // the name the team gives it
  kind: string | null;           // explore | edit | shell | screen, null for a plain sub-agent or a stage
  task: string;                  // masked and clipped like an activity line; empty for a stage
  used: number;                  // turns used so far
  round: number;                 // turns "continue" adds
  granted: number;               // rounds already granted
  canContinue: boolean;          // false only where the engine cannot (the Claude engine, if the real check fails)
  since: string;                 // ISO
}
export type TurnAnswerResult = { ok: true } | { ok: false; reason: 'gone' | 'decision' };
```

No tool output, file content or environment has a field to arrive in (rule 9). The record is in memory and in the event; it is never written to the run's file, the
conversation (only the lines below are) or the data folder (rule 26). `canContinue` is the one field that exists for the contingency of the Claude check.

### What the engine exchanges (`src/main/engine/contract.ts`, beside `CommandAsk` `:178`)

```ts
export type TurnDecision = 'continue' | 'finish';          // the same words as the shared type; the engine does not import from shared/turnLimit
export interface TurnStop {
  of: 'stage' | 'sub';
  role: string;                      // the role the usage is recorded under
  kind: string | null; name: string | null;
  task: string;                      // description, else the first words of the prompt; raw (the asker masks and clips)
  used: number; round: number; granted: number;
  canContinue: boolean;
}
export interface TurnLimit {
  /** The agent of the call asks too (a stage). Off: only its sub-agents do (a called agent, an answer in a conversation). */
  own: boolean;
  ask(stop: TurnStop, signal?: AbortSignal): Promise<TurnDecision>;
}
```

`EngineRequest` (`:184`) gains `turnLimit?: TurnLimit`, `OpenRunParams` (`loop.ts:95`) gains `turnLimit?: TurnLimit`, `subTurns?: () => SubTurns` and `task?: string`, `AgentCall`
(`agents.ts:1414`) gains `turnLimit?: TurnLimit`, and `BridgeArgs` (`bridge.ts:96`) passes the first two through. `SubTurns` is `Record<SubKind | 'plain', number>`;
`subagent.ts` exports `DEFAULT_SUB_TURNS = { ...KIND_TURNS, plain: 12 }`, which is what the loop uses when `subTurns` is absent, so every harness that does not pass it is unchanged.

### The activity state (`src/shared/activity.ts`)

`ActivityState` gains `'waiting'`. It is a state and not a label: `status()` (`src/main/activity.ts:242`) derives its text from `t(`activity.${state}`)`, and `activity.waiting` is already
taken ("Waiting for the first step…"), so `RunActivity` gains two methods and `status()` stops accepting the new state:

```ts
waiting(turns: number): void;     // a status line, state 'waiting', "Reached {turns} turns: waiting for you"
continued(): void;                // a status line, state 'started', "Continuing with another round"
```

`runActive` (`shared/activity.ts`) and `isDone` (`main/activity.ts:117`) look at "newest status is not finished or failed", so a waiting node is alive without a change (rule 23),
and the eviction of a live tree is untouched. The `lent` view (`activity.ts:248`) passes `waiting` and `continued` through; it only swallows `finished` and `failed`.

## Configuration and migration

The schema is 28 in this tree (`types.ts:5`; the header comments at `types.ts:1` and `schema.ts:6`). `STEPS` ends at `27: v27ToV28` (`migrations.ts:416`); `v27ToV28` (`:410`) wrote
`runner.showReasoning = true`. So the step is **`v28ToV29`** and the version **29**. Issue #247 (the persona, in another branch) also adds a step: it takes **29 to 30 after this
one lands**; whichever of the two lands second renumbers (risk 1).

The new keys are not a new field but five more members of an object the document already has, so the plumbing follows `read` and `write`, and the **switch of #239 is the
model for everything around it**: type, defaults, schema, `WEB_EDITABLE`, the draft, the pinned tests and the two documentation lines.

| Field | Type and meaning | Default |
|---|---|---|
| `runner.turns.explore` | integer 1 to 500. Turns of an `explore` sub-agent | 12 |
| `runner.turns.edit` | the same, `edit` | 30 |
| `runner.turns.shell` | the same, `shell` | 20 |
| `runner.turns.screen` | the same, `screen` | 30 |
| `runner.turns.plain` | the same, a sub-agent that is not of a kind (the `Agent` tool with no `kind`) | 12 |

- **`types.ts:830`**: `RunnerTurns` gains the five numbers, with a comment in the style of `read`/`write` (each said as "the sub-agents' turns; running out asks the person").
  **`defaults.ts:37`**: `turns: { read: 30, write: 80, explore: 12, edit: 30, shell: 20, screen: 30, plain: 12 }` in `neutralRunner()`. **`schema.ts:562`**: five `integer(..., 1, 500)`
  members of the `turns` object, none required (the helper's `required` is empty, so a missing key falls back to the neutral default through `withConfigDefaults`, as `read` and
  `write` do). `test/config-schema.test.ts` fails when the schema, the defaults and the types drift, and `test/runner-config.test.ts:12` compares the schema's runner keys with
  `neutralRunner()`'s, so the three move in one commit.
- **The step** (`migrations.ts`, after `v27ToV28`; `STEPS[28] = v28ToV29`; the history comment at `:44-50` gains `v29`): when `runner.turns` is an object, it writes the five defaults
  into it **whatever the chain seeded** (a v28 file cannot carry a stored choice, the keys are new; writing them makes the numbers visible and keeps a later change of the
  defaults from moving a workspace) and keeps `read` and `write` as they are. A document whose `runner` or `runner.turns` is not an object is only bumped (the defaults fill it
  later, as `v26ToV27` does for `runner`). It raises no permission and touches nothing else. It leaves a note, because this one changes what happens at a limit: `'agents ask you
  when a stage or a sub-agent reaches its turn limit, and the turns of the sub-agents are in Settings › Runner'`. A second start changes nothing (`changed` false).
  **A workspace that existed behaves as before** (rule 4) in numbers; what changes is that the end of a limit asks, which is the purpose of the issue and is in the release note.
- **`CONFIG_SCHEMA_VERSION = 29`**, the two header comments, and the `docs/configuration.md` lines guarded by `test/docs-schema-version.test.ts` (it requires exactly `versão do esquema
  N)` and `schema version N)`): `:9` and `:164` move to 29; the two tables that give `schemaVersion: 28` (`:15`, `:170`) become 29; a `v29` entry ends the history paragraph in both
  languages (`:51`, `:205`, after the `v28` entries); the `runner` row (`:46`, `:200`) names the five keys under `turns`.
- **Who may change them.** Nothing is added to `WEB_EDITABLE` (`configScope.ts:17-35`): `'runner.turns'` is there (`:28`) and `covered` (`:63`) admits every path under it, so the phone
  edits the five numbers with no new permission and still cannot change anything outside the list. In the renderer, `runnerOfWeb` (`runnerEdit.ts:117`) **must not** restore the
  turns from `stored`: it restores only what the computer alone changes.
- **The draft** (`runnerEdit.ts`): `RunnerDraft` (`:26-27`) gains `turnsExplore`, `turnsEdit`, `turnsShell`, `turnsScreen`, `turnsPlain`; `draftOfRunner` (`:66-67`) reads them; `runnerOf`
  (`:95`) writes `turns: { read, write, explore, edit, shell, screen, plain }`; `RunnerField` (`:121`) gains `'subTurns'`; `runnerProblems` (`:155`) checks the five with the same range and
  the same message (`ui.runner.err.turns`), reported on `subTurns` so the error shows under the new group and not under the stage's two fields.
- **The screen** (`RunnerSection.tsx:109-115`): under the stage's two fields, a `fieldset` (`ui.runner.subTurns`, hint `ui.runner.subTurnsHint`) with five number inputs in the same
  `wz-two` grid, in both modes (computer and phone), the same `num()` parsing and the same `min`/`max`. Texts in both `ui-team` catalogs: `ui.runner.subTurns`, `…Hint`,
  `ui.runner.turnsExplore`, `…Edit`, `…Shell`, `…Screen`, `…Plain` and one hint each ("Raising it makes the next explore sub-agent run longer; one already running keeps its own").
  **The hint of the stage's turns is corrected** (rule 5, `ui-team.en.json:319`, `.pt-BR.json:319`, and the write one at `:321`): the sentence "When they run out, the stage fails"
  becomes "When they run out, the app asks you whether to go on for another round of the same size or to finish now", and the sentence about the `@` call, the chain and the
  request (which still answer partially) stays. This text changes in the commit that makes the stage ask, not before.
- **Tests that pin the number or the neutral runner** (looked at now):
  - `test/config-migrations.test.ts:932-935` (the "newest step" test: 28 is current and 29 is refused become 29 and 30); a new `describe('schema 28 to 29: the turns of the
    sub-agents')` after `'schema 27 to 28: the reasoning switch'` (`:868`), modelled on it: an existing workspace gets the five defaults and keeps `read` and `write` as they were;
    a file that already carries other numbers for the five is written with the defaults (it cannot be a stored choice at v28); a second start changes nothing; a document whose
    `runner` or `runner.turns` is not an object is only bumped; the result validates; the note is left; a file from the first versions and a legacy install both end with the
    defaults. Its `v28()` helper deletes the five keys the way `v27()` (`:869`) deletes `showReasoning`.
  - The tests that compare a migrated file with the one it came from build their `before` from `neutralConfig()`, which now carries the five defaults, and the chain writes the same
    values, so they stay equal (`:837`, `:902` and the like); read, not run.
  - `test/runner-config.test.ts:12` (the literal of `neutralConfig().runner` gains the five keys); `:19-20` (`withConfigDefaults` of a runner with no turns, and with `{ write: 120 }`,
    now return the seven keys); `:125` and `:139` compare against `{ ...neutralRunner(), procedures: false, sharedMemory: false }` and stay equal because the migrated values are the neutral ones.
  - `test/team-runner-edit.test.ts:12-14` (the `RunnerConfig` literal needs the five keys, because `RunnerConfig` types them as required), `:120-124` (the range cases extend to the five,
    and the `turns` object `runnerOf` returns has seven keys).
  - `test/config-web-scope.test.ts:79-81` gains `c.runner.turns.explore = 40` among the admitted edits, and a case that a draft changing `runner.turns.plain` together with
    `runner.unconfined` is refused for `runner.unconfined` only.
  - `test/docs-schema-version.test.ts` needs no edit; it is the guard that the docs lines move with the number.

## Flow

### The open engine (`src/main/engine/open/loop.ts`)

**The limit of a sub-agent is read when it starts.** `runAgent` (`:414`) builds the nested run in `sub()` (`:446`), which is called when the sub-agent really begins (after the wait of
`inOrder` for the kinds that change things, `:469-474`). There, instead of `maxTurns: kind ? KIND_TURNS[kind] : 12` (`:456`), it reads `(p.subTurns?.() ?? DEFAULT_SUB_TURNS)[kind ?? 'plain']`
once, passes it as `maxTurns`, and the round of that sub-agent is that number for its whole life (rule 8, acceptance 2: a setting changed while it waits does not change its round).
The failure text of the unwired case (`:483`, `main.engine.text.subTurns`) is given the effective number and not `KIND_TURNS[kind]`. `agents.ts` supplies
`subTurns: () => ({ ...getConfig().runner.turns })` (the keys the loop reads are the seven names of `RunnerTurns`).

**The pause.** In `runOpen`, `p.maxTurns` is replaced by a local `limit`, with `round = p.maxTurns` and `granted = 0`. One helper replaces both throws:

```ts
// true: there is room (the limit was raised); false: the person finished the work now
const room = async (): Promise<boolean> => {
  if (turns < limit) return true;
  const asks = p.turnLimit && ((p.depth ?? 0) > 0 || p.turnLimit.own);
  if (!asks) throw new OpenMaxTurnsError(sessionId, sources);                      // today's behaviour, untouched
  const d = await p.turnLimit.ask({ of: (p.depth ?? 0) > 0 ? 'sub' : 'stage', role: p.role, kind: p.kind ?? null, name: null, task: p.task ?? '', used: turns, round, granted, canContinue: true }, p.signal);
  if (p.signal?.aborted) throw new EngineError('aborted', 'aborted');             // a cancel or a stop is not the person's answer
  if (d === 'continue') { limit += round; granted++; return true; }
  return false;
};
```

- **The loop's top** (`:691-693`): `if (!(await room())) return finishNow();`. **The door repair** (`:778`): the same, in place of the second throw.
- **`finishNow()`** is where the two kinds of work part. For a stage (`depth === 0`) it throws `OpenMaxTurnsError`, so the bridge (`bridge.ts:175`) makes the `MaxTurnsError` it makes
  today, the executor makes `StageError('turns')` (`executor.ts:1234`), in the same words and retried the same way (rule 12). For a sub-agent it returns `done(await partialOf(), turns)`:
  the result of the nested `runOpen`, which `runAgent` hands the principal as the text of the tool call, **not a `ToolError`**, and the node ends `finished` (`finish()` `:475`).
- **`partialOf()`** (Q1): `write` a user turn (`main.engine.text.partialAsk`: the person finished the task early, no tool is available, say briefly what was found and what was not
  reached) and `call({ tools: [] })` once, on the sub-agent's own dialog, with the pool member it was using. It is one model call beyond the limit, paid by "finish now". If it throws
  and the error is not `aborted`, `budget` or `auth` (those propagate, as `execute` lets them at `:637-639`), it falls back to the last narration of the sub-agent (a new local, set at
  `:721` where `onInterim` is called), and if there is none to a fixed line that names what it read (`main.engine.text.partialNone`, the last ten entries of `sources` from the index
  the nested run started at, each clipped). The text starts with `main.engine.text.partialNote` ("[partial result: the person finished this sub-agent of kind {kind} at its limit of
  {turns} turns; what follows is what it had and the rest of the task was not done]"; "sub-agent" when plain), so the principal knows it is partial (rule 11).
- **The wait is in the handle.** `SubAgentHandle` (`:64`) gains `waiting(used)` and `continued()`; `runAgent` wraps the `ask` it hands the nested run: before the question it calls
  `handle?.waiting(stop.used)`, after a "continue" `handle?.continued()`, and it fills `kind`, `name` and `task` of the stop from `about` and `prompt` (`:265`). `agents.ts`'s
  `openSubAgent` (`:428`) implements them over the child node's `waiting()`/`continued()`. For `of === 'stage'` the wrapper is in `runAgent` of `agents.ts` (below), because the
  principal's node is the call's activity.
- **Parallel and ordered work.** Three sub-agents of one turn run under `Promise.all` (`:722`); each has its own `room()` and its own record, and the others keep running while one
  waits (rule 15). The principal's turn ends when all its tool calls return, so it does not go on before the waiting one is answered. The kinds that change things run one at a time
  (`inOrder` `:407-411`), so at most one of them asks (rule 17).
- **Nothing is replayed.** `messages` is the dialog, `write` appends to it, and the loop continues from the same place: the earlier steps are in the next request (acceptance 3).

### The agents module (`src/main/agents.ts`)

- **`runOpenEngine`** (`:657`): passes `turnLimit: req.turnLimit` and `subTurns: () => getConfig().runner.turns` through `runOpenOnce` (`:675`); `onSubAgent` (`:701`) is unchanged.
- **`runAgent`** (`:1528`): wraps `call.turnLimit` into the request (`:1567-1606`, next to `incoming`):
  ```ts
  turnLimit: call.turnLimit && { own: call.turnLimit.own, ask: async (stop, signal) => {
    if (stop.of === 'stage') activity.waiting(stop.used);
    const d = await call.turnLimit!.ask(stop, signal);
    if (stop.of === 'stage' && d === 'continue') activity.continued();
    return d;
  } }
  ```
  so the call's own node shows the wait on both engines, and a sub-agent's node is the loop's. `wrapUpAnswer` (`:1634`) spreads `...request` and must set `turnLimit: undefined`: a wrap-up
  of two turns must never ask. `askAgain` (`executor.ts:711`) sets `turnLimit: undefined` on the repair round it builds from the stage's call: a repair round already fails quietly
  and the answer before it stands (decision 8; question 2).
- **The Claude engine** (Q3, built last). `runClaudeSdk` (`:770-961`) throws `MaxTurnsError` at `:934`. The stage's own limit on this engine is asked in `runAgent`, around
  `runnerFor(picked)<T>(request)` (`:1608-1615`), in a loop: when it catches a `MaxTurnsError` with a session id, the call has `turnLimit.own`, and `picked.engine === 'claude-sdk'`
  (an open-engine `MaxTurnsError` has already been through the question), it asks `{ of: 'stage', used: round * (granted + 1), round: call.maxTurns, granted, canContinue }`; on "continue" it
  runs the engine again with `{ ...request, resume: e.sessionId, prompt: t('main.engine.text.continueRound'), extra: { ...request.extra, maxTurns: round, resume: e.sessionId } }`, merges
  `sources` as `wrapUpAnswer` does (`:1655`), and may ask again; on "finish" it rethrows, and the executor makes `StageError('turns')`. It sets **both** `extra.resume` (what the SDK
  and the bridge read, `bridge.ts:159`) and `request.resume` (what `noteSession` reads, `:871`, so the session is not indexed twice). It does **not** rely on `request.resume`
  alone, because nothing in this tree forwards that field to either engine (risk 5). The tools of the stage are the request's, so the in-process servers are rebuilt by
  `runClaudeSdk` exactly as on the first call. `canContinue` is the constant `CLAUDE_CAN_CONTINUE` of this file, `true` if the real check passes and `false` if it fails (below).
  The settings of the sub-agents do not apply to the SDK's own sub-agents, whose limits the app does not set (spec, out of scope).

### Where each caller asks, and the clocks it must stop

The spec leaves open "how many callers of the engine have a clock beyond the stage's and the conversation answer's". Looked at now:

| Caller | Its clock | Asks for | Wired |
|---|---|---|---|
| A stage of a run | `watchdog` made at `executor.ts:1040`, guarding the call at `:1176`; `watch.pause` | the stage and its sub-agents (`own: true`) | yes |
| An agent a stage calls (`CallAgent` from a stage) | none of its own: the local `clock` of `runConversation` (`conversation.ts:146`) is a no-op, so a host command of a called agent does not stop the stage's clocks today | its sub-agents only (`own: false`; its own 12 turns are fixed, Q7) | yes, with a new `ConversationDeps.pause` that is the stage's `watch.pause` (risk 7) |
| An answer in a conversation outside a run, and the nested answer of a `CallAgent` inside one | `watchdog` at `answer.ts:206`, `watch.pause` (already used at `:379`) | its sub-agents only (`own: false`; the answer's own limit keeps its partial answer, Q6) | yes, not for a ceremony place (`place.kind === 'ceremony'`: answers recorded elsewhere, no conversation to ask in) |
| A question of the chain, a request between squads | `watchdog` at `service.ts:1626` and `:1704` | nothing | no (question 1) |
| A ceremony's agent (`runOnce`) | none | nothing | no |

A caller that is not wired passes no `turnLimit`, so its sub-agents still end with the tool error of today; the numbers they stop at are the settings'.

### The asker (`src/main/turnLimit.ts`, new)

```ts
export function turnAsker(d: {
  store: TurnAsks; place: { run: string | null; thread: string; stage: string | null; ref: string | null; issue?: number };
  agent: { id: string; name: string };
  say(code: string, params: Record<string, string | number>): void;      // a system line of the conversation
  pause(): () => void;                                                     // the caller's clocks
  signal: AbortSignal; isSecretPath?: (token: string) => boolean;
}): TurnLimit['ask']
```

It builds the record (the task through `safeText(task, ACTIVITY_NODE_MAX, isSecretPath)` of `src/main/activity.ts`, the agent's name from the team), says the question in the conversation, calls
`pause()`, `await`s `store.ask(record, signal)`, says the answer unless the wait ended by an abort, and in a `finally` releases the pause. Lines (rule 13; codes under `main.forum.code.`,
params redacted like every line of the conversation): `runner.turns.ask.stage|sub`, `runner.turns.continue.stage|sub`, `runner.turns.finish.stage|sub`, in both catalogs. The finish line of a
sub-agent says that a partial result went to its agent; the one of a stage says that the stage ends with the turns failure. A cancel or a stop leaves no answer line (rule 10).

- **The stage** (`executor.ts`): after `watch` exists (`:1040-1042`), `call.turnLimit = { own: true, ask: turnAsker({ store: d.turnAsks, place: { run: run.id, thread: threadId, stage: stage.id, ref: run.issue.ref, issue: run.issue.iid }, agent, say: (code, params) => d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code, params, stage: stage.id }), pause: watch.pause, signal: abort.signal, isSecretPath: (p) => secretPath(p, wt) }) }`.
  `ExecutorDeps` (`:92`) gains `turnAsks?: TurnAsks` and `RunnerDeps` (`service.ts:215`) forwards it with the other deps at `service.ts:431`; absent, no `turnLimit` is set and the stage ends in `turns` as today.
- **The called agent**: `ConversationDeps` (`conversation.ts:57`) gains `turnAsks?` and `pause?`, filled at the object built at `executor.ts:1111`; the call (`:339`) gets
  `turnLimit: { own: false, ask }` over the conversation's thread, the called agent's name and `deps.abort.signal`.
- **The answer in a conversation**: after `call.beat = watch.beat` (`answer.ts:354`), `if (deps.turnAsks && place.kind !== 'ceremony') call.turnLimit = { own: false, ask: turnAsker({ …, pause: watch.pause, signal: abort.signal }) }`;
  `MentionDeps` (`answer.ts:49`) gains `turnAsks?`, `mentions/module.ts` passes the process store (as it passes `ceremonyCommands` at `:91`), and the nested answer of a `CallAgent` (`:381`) gets it by the `...deps` spread.
  The person's Stop (`stopper`, `:231`) aborts the answer's `abort`, which ends the question.

**The clocks (rule 14, acceptance 6 and 7).** `Watchdog.pause()` (`executor.ts:271-345`) clears the idle and cap timers, keeps what was left of the cap, **counts overlapping pauses** and
starts both again when the last is released; `beat` does not re-arm while paused. Two sub-agents waiting at once are two pauses of the same watchdog, so the clocks restart only
after both are answered, and the wall cap resumes with what was left. Nothing is added to the watchdog.

## The ask store and the answering door

- **`src/main/turnAsks-core.ts`** (new, in the style of `ceremonyCommands-core.ts:45-100`, with no timer): `createTurnAsks({ changed, asked, audit, newId, now })` returns
  `{ ask(record, signal?), list(), answer(id, decision, through) }`. `ask` returns a promise that resolves with `{ decision, by: 'person' | 'abort' }`: it files the record,
  publishes the whole list (`changed`), calls `asked` (the notification) and waits **with no timer**. A signal that is already aborted resolves at once as `{ decision: 'finish', by: 'abort' }`
  and files nothing; a signal that aborts later does the same and removes the record. `answer` validates the decision (`TURN_DECISIONS`), refuses `continue` when the record has
  `canContinue: false` (`{ ok:false, reason:'decision' }`), writes the audit line once, removes the record, publishes, and resolves the waiting promise; a second call, or a call after
  the work ended, throws `TurnAskGone` (the channel turns it into `{ ok:false, reason:'gone' }`), so an answer is never applied twice (rule 19, acceptance 11). Several records are
  independent entries of one `Map` (rule 17); there is no cap per run, since the number is bounded by the tool calls of a turn.
- **`src/main/turnAsks.ts`** (new, in the style of `ceremonyCommands.ts`): the process store, the audit writer, the notification, and `register: Module`.
  - `ctx.handle('turnAsks:list', () => turnAsks.list())` and `ctx.handle('turnAsks:answer', (id, decision) => …)`, the latter taking the origin from `callOrigin()` (`rpc.ts:20`) as
    `runner/module.ts:381` does: `'paired'` for a browser, `'window'` otherwise. That is the one call every answerer goes through; the window, the phone and, later, an agent differ only in `through`.
    No tool, prompt or permission for an agent answerer is built here (rule 19, out of scope).
  - `changed` emits `{ type: 'module', name: TURN_ASKS_EVENT, payload: list }`.
  - `asked`, when `getConfig().notifications` is on, calls `ctx.notify` (title `main.turnAsk.notice.title`, body `main.turnAsk.notice.body.stage|sub`) with `onClick` opening the run
    (`{ type: 'open', screen: { name: 'run', id } }`), the conversation (`{ name: 'forum', thread }`) or today, the way `runner/module.ts:182-193` does for the screen's questions.
  - `audit` writes `recordWrite` with a new `AuditKind` `'turn-limit'` (`shared/auditoria.ts:1`): `target: 'turns:stage|sub'`, `via: through`, `fields: { agent, of, kind, used, round,
    granted, decision, through, run }`, `ok: true`, `origin: { actionId: '', kind: 'turn-limit', key: id, summary: null }`; no task text, and no entry for an end by abort. `Auditoria.tsx:14-32`
    (a `Record` over `AuditKind`) gains the entry and `ui-today.*.json` the key `ui.audit.kind.turnLimit`.
  - `modules.ts` (`:8`, `:48`) registers the module next to `ceremonyCommands`.
- **Nothing is stored** (rule 26): no file under the data folder holds a question, a waiting state or a partial result; the run file is untouched. A closing app ends the wait with the work.

## Renderer

### The question on every screen (rule 16)

The ceremonies' commands are shown by `CeremonyCommands.tsx`, mounted at `WebGate.tsx:144` for the window and the browser alike, as a fixed stack at the top (`ceremonyCommands.css`
`.cc-stack`, `z-index: 60`). The bottom of the screen is taken (`.bnav`, `.outbox`, `.upd-toast`, the jobs layer), so a second fixed stack would overlap the first. The two lists are therefore
**one stack**:

- `CeremonyCommands.tsx` is split: its list state and effect become `useCeremonyCommands()` and its card stays `Request`; the component no longer owns the container.
- New `TurnAsks.tsx`: `useTurnAsks()` (reads `turnAsks:list` once, listens to `TURN_ASKS_EVENT` on `moduleEvents`, and fetches again on `EVENTS_RECONNECTED` and window focus, as `useScreens.ts:39-45` does) and
  `TurnAskCard`. The card names who waits and where ("Sub-agent of kind explore: map the tests of X, used 12 of 12 turns" for a sub-agent; "{agent} used {used} of {used} turns" for a stage; the
  run's reference and stage; how many rounds were already granted; since when), and has two buttons, **Continue ({round} more turns)** (primary; absent when `canContinue` is false) and **Finish now**.
  Each calls `turnAsks:answer`; an answer that comes back `gone` removes the card (another screen answered first); the buttons are disabled while the call is out.
- New `AskStack.tsx`: the one `div.cc-stack` with `role="region"` and `aria-label` `ui.ask.region` ("Waiting for you"), rendered only when either list has an item, holding the command cards and the
  turn cards. `WebGate.tsx:144` mounts `<AskStack />` in place of `<CeremonyCommands />`. `ui.ceremonyCommand.region` is removed with its last reader.
- New DOM-free `turnAskView.ts` (the repository has no `.tsx` test, `vitest.config.ts:12` is `environment: 'node'`): `turnAskLines(ask, nameOf)` returns the title key and params, the detail
  lines and the label of the buttons; `sameTurnAsks` for a stable list. The card is only the markup of that.
- `turnAsks.css` reuses the stack's tokens (`--amber-line`, `--amber-soft`, `--amber-ink`, `--surface`, `--ink`) and the 44px target of `.btn`; `node scripts/theme-audit.mjs` is the gate. The mobile
  breakpoint of `.cc-actions` is reused. There is no card of its own on the run screen (Q5): the stack is above it, and the run's conversation carries the lines.
- Texts, in both catalogs (`ui-shell.*.json` beside `ui.ceremonyCommand.*`): `ui.ask.region`, `ui.turnAsk.title.stage`, `ui.turnAsk.title.sub`, `ui.turnAsk.detail`, `ui.turnAsk.rounds`,
  `ui.turnAsk.since`, `ui.turnAsk.continue`, `ui.turnAsk.finish`, `ui.turnAsk.gone`. Main side (`main.*.json`): `main.turnAsk.notice.title`, `…body.stage`, `…body.sub`,
  `main.forum.code.runner.turns.{ask,continue,finish}.{stage,sub}`, `main.engine.text.partialAsk|partialNote|partialNone|continueRound`.

### The activity tree (rules 22 to 25)

- **Model** (`activityTreeModel.ts`): `NodeState` gains `'waiting'` (`:9`); `stateOf` (`:47`) returns it for a newest status line with state `waiting`; `hasWork` (`:117`) counts it, so
  `topEntries` keeps the entry and the badge still counts it once (`dockCounts` is untouched). New `waitsBelow(node)` (a descendant waits and the node itself does not) and `anyWaiting(nodes)`;
  `TopEntry` gets `waits: boolean`. `defaultOpen` is untouched: the tree only shows (rule 25), it has no button to answer.
- **View** (`ActivityTree.tsx`, `NodeRow` `:91-104`): the state word for a waiting node is `activity.node.state.waiting` ("Waiting for you", distinct from `queued`'s "Waiting"), the row gets the class
  `act-state-waiting`, and a **collapsed** row whose `waitsBelow` is true shows `activity.node.waitsBelow` ("Waiting for you, below") beside its newest step. Opened, the child shows its own
  line, "Reached 12 turns: waiting for you". `JobsDock.tsx` `Steps` (`:92-107`) takes the entry's `waits` and shows the same text in its collapsed line instead of the newest step, so a closed
  entry does not hide it. `activity.css` gets `.act-state-waiting` with the amber tokens the file already uses and a `prefers-reduced-motion` rule beside the chevron's.
- Texts in `en.json` / `pt-BR.json` (the `activity.*` block, which the main process also reads): `activity.turnLimit` ("Reached {turns} turns: waiting for you"), `activity.continued`,
  `activity.node.state.waiting`, `activity.node.waitsBelow`. `npm run i18n:lint` and the catalog-parity tests are the gates.

## Paired phone

- **The question reaches it and it can answer.** The event goes through the same `ctx.emit` that reaches the browsers, the list is fetched at mount and at reconnect, and `AskStack` is mounted by
  `WebGate` for the browser too. The notification is the app's (`ctx.notify`).
- **The answer is not behind the external-effects switch** (rule 18, Q8). `webPolicy.ts` gets, next to `MEMORY_CHANNELS` (`:93-94`), `export const TURN_ASK_CHANNELS = new Set(['turnAsks:list',
  'turnAsks:answer'])` and a pattern `TURN_ASKS_UNLISTED = /^turnAsks:(?!(list|answer)$)/`; `webAccess` (`:100-102`) denies the pattern and returns `'allow'` for the named two before the
  `EXTERNAL_EFFECT` test, with a comment that says why: continuing spends the person's budget on work the agent was already allowed to do and opens no tool, host or file; it is not a write to
  the code host nor a command on the computer. `test/turn-asks-policy.test.ts` (model: `test/memory-policy.test.ts`) pins both as `allow` with and without the switch, neither in `DESKTOP_ONLY` nor in
  `EXTERNAL_EFFECT`, any other `turnAsks:` channel denied, and that the handlers in `src/main` register exactly those two.
- **The five numbers** need no policy change (`runner.turns` is in `WEB_EDITABLE`); a test pins that a paired browser may change them and still not `runner.unconfined` with them.
- **The audit line** says `window` or `paired` through `callOrigin()`, in a field that can hold a third value later.

## Order of the work: commits

Every commit leaves `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` and `node scripts/public-audit.mjs` green. `feat:` / `fix:`, lowercase,
imperative, no trailing period; the identity by `git -c user.name=… -c user.email=…` only; no attribution trailer.

0. `feat: add the plan of the turn limits that ask` (this file alone, after the spec).
1. `feat: make the turns of each kind of sub-agent a setting` (schema 29, `v28ToV29`, types, defaults, schema, the draft and the section, the catalogs without the corrected stage hint, `docs/configuration.md`,
   the loop reading `subTurns` and the effective number in the failure text, the pinned tests). At a limit nothing asks yet: the sub-agent ends as before, with the configured number.
2. `feat: add the store of questions at a turn limit and its door` (`shared/turnLimit.ts`, `turnAsks-core.ts`, `turnAsks.ts`, `modules.ts`, the web policy channels and their test, the audit kind and its
   screen entry). Nothing calls `ask` yet.
3. `feat: pause the open engine at a turn limit and ask` (`TurnStop`, `TurnLimit`, the loop's `room()` and `partialOf()`, the bridge, `runAgent`'s wrapper, `runOpenEngine`'s pass-through,
   `RunActivity.waiting`/`continued`, `ActivityState` `waiting`, the main-side catalogs). Engine-level tests with a scripted `ask`; every caller still passes none.
4. `feat: ask the person when a stage or a sub-agent reaches its turn limit` (`turnLimit.ts`, the three callers wired, `ExecutorDeps`/`RunnerDeps`/`MentionDeps`/`ConversationDeps`, the process store into the
   runner and mentions modules, the conversation lines and their catalogs, the notification, `askAgain` and `wrapUpAnswer` without the ask, the corrected hint of the stage's turns).
5. `feat: show the questions waiting for the person on every screen` (`AskStack`, `TurnAsks`, `turnAskView`, `CeremonyCommands` split, `WebGate`, the css and the catalogs).
6. `feat: show a node that waits for the person in the activity tree` (`activityTreeModel`, `ActivityTree`, `JobsDock`, `activity.css`, the catalogs).
7. **Run the real check on the Claude engine (below), outside the suite, and write its result in `3_IMPLEMENTATION.md`.** Then
   `feat: let a stage on the Claude engine continue past its turn limit` if it held, or `feat: offer finish now when a stage on the Claude engine reaches its turn limit` (`CLAUDE_CAN_CONTINUE = false`) if it did not.
8. `feat: document the turn limits that ask` (`docs/runner.md` in both languages, the `CHANGELOG.md` entry under `## [Unreleased]`: the sub-agents' turns are a setting, and reaching a limit asks
   instead of stopping).

Commits 3, 4 and 7 touch the same engine files; each is rebased onto the release branch before it is pushed and the schema number of commit 1 is looked at again then.

## The real check on the Claude engine (outside the suite)

What the spec asks (Q3): that a Claude session resumes with the same in-process tool servers, the stage's mailbox stream and the structured answer, and continues cleanly after an
`error_max_turns` end. Nothing in the suite can show it: the tests script `query`. It is one throwaway script, not committed, that mimics the shape `runClaudeSdk` gives the SDK
(a streaming prompt that stays open, an in-process tool server, `outputFormat` as a JSON Schema, `permissionMode: 'dontAsk'`, no setting sources), forces the limit, and resumes.

```js
// scratch/check-claude-resume.mjs (git-ignored folder; delete it afterwards)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const cwd = mkdtempSync(join(tmpdir(), 'coxia-check-'));
let calls = 0;
const probe = createSdkMcpServer({ name: 'probe', tools: [tool('step', 'Do one step; returns how many steps were done so far.', { note: z.string() }, async () => ({ content: [{ type: 'text', text: String(++calls) }] }))] });
const schema = { type: 'object', properties: { steps: { type: 'number' } }, required: ['steps'], additionalProperties: false };

async function round(text, extra) {
  let end;
  const done = new Promise((r) => (end = r));
  const prompt = (async function* () { yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }; await done; })();
  const options = { cwd, model: process.env.CHECK_MODEL ?? 'haiku', permissionMode: 'dontAsk', mcpServers: { probe }, allowedTools: ['mcp__probe__step'], disallowedTools: ['Bash', 'Edit', 'Write'], outputFormat: { type: 'json_schema', schema }, settingSources: [], ...extra };
  let last;
  for await (const m of query({ prompt, options })) if (m.type === 'result') { last = m; break; }   // leaves at the result, as the app does
  end();
  return last;
}

const first = await round('Call the step tool five times, one call per turn, then answer {"steps": <the last number it returned>}.', { maxTurns: 3 });
console.log('first ', first.subtype, first.session_id, 'calls so far', calls);
const second = await round('The step limit was raised. Continue from where you stopped and finish.', { maxTurns: 6, resume: first.session_id });
console.log('second', second.subtype, JSON.stringify(second.structured_output), 'calls', calls, 'same session', second.session_id === first.session_id, 'turns', second.num_turns);
```

How to run it (an empty data folder, so nothing of the maintainer's workspaces is touched; the script does not use the app's data at all, and the variables are set so that a later edit cannot):

```bash
cd <the worktree of this branch> && source ~/.nvm/nvm.sh && nvm use
mkdir -p scratch && cp /path/of/the/script scratch/check-claude-resume.mjs
export CERIMONIAS_DATA_DIR="$(mktemp -d)" CERIMONIAS_SPECS_DIR="$(mktemp -d)"
CHECK_MODEL=haiku node scratch/check-claude-resume.mjs      # needs a Claude login or ANTHROPIC_API_KEY on this machine; a few cents
rm -rf scratch/check-claude-resume.mjs
```

**It passes** when: the first round ends with `error_max_turns` and a session id after two or three calls; the second ends with `success`; its `structured_output.steps` is 5; the
total of calls is 5 (the step tool ran three more times and nothing was redone); the tool server answered in the resumed session (no "unknown tool" or "session not found"); and
`num_turns` of the second is within its own `maxTurns` (a limit that counts per invocation, not per session). Run it once with the model the workspace's roles use if it is not `haiku`.
The stage's mailbox stream is the part the script cannot show beyond the open prompt; commit 7's test with the scripted `query` pins that the app builds a fresh stream for the resumed call.

**If it fails** (the resume is refused, the tools are gone, the structured answer is lost, or the limit counts from the start): the Claude engine still asks, because the question is
raised in `runAgent` from the `MaxTurnsError` and needs nothing of the SDK; the record carries `canContinue: false`, the card shows only **Finish now**, `turnAsks:answer` refuses `continue`
for it, and the conversation line says "this engine cannot go on past its limit". Criterion 13 of the spec is split in `3_IMPLEMENTATION.md` (asks and finishes: met; continues: not met,
with the evidence). The open engine and the sub-agents are unaffected, since their loop is kept waiting and nothing is resumed. The plan does not guess the outcome.

## Test plan

No test reaches a model, a code host or the network; fakes are in `test/helpers/` (`fakeOpenAI.ts`: `textStep`, `toolStep` with several calls, a script may be a function of the request, per-request
delays; the SDK tests replace `query`, as `test/agent-activity-sdk.test.ts:137` does for `error_max_turns`). Anything exploratory runs with `CERIMONIAS_DATA_DIR` and `CERIMONIAS_SPECS_DIR` on an
empty folder, which `test/setup.ts` already gives each file. Harness shapes below were read, not run.

**New files**

| File | Holds |
|---|---|
| `test/turn-asks-core.test.ts` | The store. A record is listed and published whole; **no timer**: with fake timers moved a week it is still waiting; `answer` resolves it once, a second answer and an answer after the work ended throw `TurnAskGone`; an abort resolves it as `finish` by `abort`, removes it and files nothing when already aborted; several records are independent (answering one leaves the others); `continue` is refused when `canContinue` is false; the audit callback gets `through` (`window`, `paired`) and is not called for an abort; a throwing listener does not decide an answer. |
| `test/turn-asks-policy.test.ts` | `webAccess` of the two channels is `allow` with and without the switch; neither is in `DESKTOP_ONLY` or `EXTERNAL_EFFECT`; `TURN_ASK_CHANNELS` is exactly the two; any other `turnAsks:` channel is denied; the modules register exactly those two handlers (source scan, as `memory-policy.test.ts` does); the module's `answer` handler reports `paired` under `callOrigin() === 'web'`, and `gone` for a settled id. |
| `test/engine-open-turn-limit.test.ts` | The loop against `fakeOpenAI` and a scripted `turnLimit.ask`. **Stage** (`own`): with `maxTurns: 2` it asks with `used 2, round 2, granted 0`; "continue" gives two more turns with the earlier steps in the next request body and nothing redone, asks again after the second round (`granted 1`), "finish" throws `OpenMaxTurnsError`; an abort during the wait throws `aborted`, not a partial; with no `turnLimit`, or `own: false`, it throws as today (the existing test at `engine-open-loop.test.ts:245` stays). The second throw (door repair) asks too. **Sub-agent**: an `explore` with `subTurns` giving 3 asks after 3 turns, and with 20 the same task finishes without asking (acceptance 2); a plain sub-agent uses `plain`; "continue" goes on in the same dialog; **"finish" returns a partial result**: the closing call has no `tools`, the text starts with the partial note, it is not a tool error, the node ends `finished`; the fallbacks (the closing call fails: the last narration; none: the fixed line naming what was read; `budget`/`aborted` propagate); a `subTurns` that changes while it waits does not change its round; three parallel `explore` sub-agents ask separately, are answered in any order, and the others keep running; the kinds that change things ask one at a time. |
| `test/turn-limit-ask.test.ts` | `turnAsker` with a fake store, `say` and `pause`: the ask line then the answer line, with the right code per `of` and decision; the task is masked and clipped (a token and a secret-file path in it); **the pause is taken before the wait and released after, on every outcome**; an abort leaves no answer line; the same through a real `watchdog` with a minute for each limit and fake timers: idle and wall never trip during a wait much longer than both, the wall cap resumes with what was left, two overlapping waits restart the clocks only after both (acceptance 6 and 7). |
| `test/runner-turn-limit.test.ts` | A stage through the runner harness (`boot` of `test/helpers/runner.ts`, the open engine on `fakeOpenAI`, `turns.read: 2`): it leaves one record and the run is still `working`; **Continue** finishes the stage normally; **Finish now** ends in `turns`, retryable, with the finish line saying it was the person's answer; cancelling during the wait ends the stage as cancelled with no record left; the run's file (read from disk) holds no question; a sub-agent's question names the run and stage; a `shell: host` command question and a turn question wait together without touching each other. |
| `test/agent-turn-limit-sdk.test.ts` | The Claude path with the scripted `query`: a result `error_max_turns` with a session id raises the question (`of: 'stage'`, `used`, `round`, `canContinue`); "continue" calls `query` again with `options.resume` the session id, `maxTurns` one round, the same `mcpServers` keys, a fresh prompt (`main.engine.text.continueRound`) and a fresh stream when the call has a door; it asks again after that round; "finish" rethrows `MaxTurnsError`; a `MaxTurnsError` from the open engine is not asked a second time; `CLAUDE_CAN_CONTINUE = false` refuses `continue`; the wrap-up and the repair round never ask. |
| `test/activity-turn-wait.test.ts` | The log and the tree model: `waiting()` makes a status line of state `waiting` with the numbers; `runActive` and `isDone` read it as alive, so a tree with a waiting node is not evicted and is dropped only by the far-too-many rule; `continued()` and `finished` end it; `lend()` passes it through; `buildTree` gives `waiting`; `hasWork` and `topEntries` keep the entry, count one at any depth (`dockCounts`), and `waitsBelow`/`anyWaiting`/`TopEntry.waits` are true for the ancestors and false for the node itself and for siblings. |
| `test/turn-ask-view.test.ts` | `turnAskLines` for a stage, a sub-agent of a kind and a plain one; the label "Continue (12 more turns)"; no continue button when `canContinue` is false; the clipped task; stable `sameTurnAsks`. |

**Existing files that change**

- `test/config-migrations.test.ts`, `test/runner-config.test.ts`, `test/team-runner-edit.test.ts`, `test/config-schema.test.ts` (next to `:64-67`: the five are integers 1 to 500, 0 and 501 and a string are refused by path), `test/config-web-scope.test.ts`: as listed under Configuration.
- `test/engine-open-subagent.test.ts:239` and `:487`: they pin the unwired behaviour (an error the principal reads, the node ending `failed`) and stay as they are, with the effective number in the text; one case is added that the text carries
  the configured number.
- `test/mentions-call-line.test.ts:47`: the double of `RunActivity` gains `waiting` and `continued`.
- `test/runner-conversation.test.ts`: a called agent's sub-agent asks through `ConversationDeps.turnAsks`, pauses the stage's clock, and the called agent's own 12 turns keep ending in a partial.
- `test/forum-mentions.test.ts` and `test/runner-chain.test.ts:177`: a mention that runs out of turns still answers partially with its note (acceptance 14); a sub-agent inside a mention answer asks, and its
  line is in that thread; the chain and the request pass no `turnLimit`.
- `test/activity-tree.test.ts`, `test/agent-activity-core.test.ts`: the existing cases are untouched; the `waiting` cases are in the new file.
- Goldens: **none regenerated.** The new texts are keys of `main.*.json` and `ui-*.json` and `en.json`, none a `prompt.*` entry, so `test/prompts-screen.test.ts` and the `en-prompts`, `legacy-prompts`
  and `same-day-prompts` goldens run unchanged as the proof; `test/gitlab-catalogs-unchanged.test.ts` only reads keys the snapshot has, and none of those changes (the stage's hint is in `ui-team`, which it does not snapshot).

## Risks and what was assumed and not verified

Nothing was executed in this stage: no test was run and no behaviour was seen. The lines were read; the design is a reading of them.

1. **The schema number.** 29 is free in this tree. Issue #247 (the persona, in another branch) also adds a step; it takes 29 to 30 after this delivery lands. Whichever lands second renumbers its
   step, the version constant, the two header comments, the history entries, the pinned tests and the two documentation lines. Looked at again at every rebase, and before the pull request.
2. **A forced final turn may not give a useful summary** on the models the open engine is used with (spec, Q1). The fallbacks keep the principal from getting nothing, but the quality of the
   summary was not seen. It is the one extra model call "finish now" costs.
3. **The Claude resume.** Everything in the Claude section is a reading of `runClaudeSdk` and of the two resumes the app already makes; the real check decides it (above). The question itself does not depend on it.
4. **Where the limit counts from on the Claude engine.** The plan assumes `maxTurns` counts per invocation; if it counted per session the "round" would be wrong and the check shows it (`num_turns`).
5. **`EngineRequest.resume` looks unused.** Reading `sdkOptions` (`agents.ts:489-526`), `runClaudeSdk` (`:804-812`), `runOpenEngine` (`:675-721`) and the bridge (`:159`), the field set at `agents.ts:1590` is read
   only by `noteSession` (`:695`, `:871`); both engines take the session from `extra.resume`. If that is right, the QA repair round starts a new session with the repair text only. It is outside this issue and
   this plan does not depend on it (it sets `extra.resume` itself, as `wrapUpAnswer` does at `:1646`), but it is reported to the maintainer so it can become its own issue; the test at
   `test/runner-agent-open.test.ts:255` only checks that the repair text reaches the model.
6. **Clocks of callers the plan does not wire** (chain, request, ceremonies): their sub-agents keep ending with the tool error, and the question for them is not asked (question 1).
7. **The called agent has no clock of its own** (`conversation.ts:146`, a no-op). The plan pauses the **stage's** watchdog while a called agent's sub-agent waits, which also stops the stage's clocks
   when the conversation is a detached reader's (the stage goes on beside it). That is the cost of not letting the stage's idle clock trip over a wait it cannot see; whether a called agent working long
   without any sign of life already trips it today was not verified.
8. **The shared stack.** `CeremonyCommands` is refactored to share its container. No `.tsx` is tested, so the markup change rests on the pure functions around it and on the maintainer's check on screen.
   A stack with many cards (three parallel sub-agents plus a command) is tall; it scrolls inside its own `max-height`, as the command card does.
9. **A long wait and the activity log.** A waiting node keeps its tree live, so a run that waits for a week holds its tree (a live tree is dropped only past `2 * maxRuns`). Not measured.
10. **A paired browser with a stale bundle** saves `runner.turns` without the five keys; the server validates the result, which `withConfigDefaults` fills. Not run.
11. **The conversation lines are written by the app on the run's thread.** A `shell: host` command question and a turn question can both be on the run's screen; the existing command card and the
    new stack are independent, as `forumView.ts:42-50` only counts the command codes. Not seen on screen.
12. **The cancel races.** A cancel that arrives between the answer and the loop's next step reads `p.signal.aborted` after the answer and throws `aborted`, so a "continue" given a moment before a cancel
    does not run another round; the audit line was already written. Acceptable and pinned by the test of the abort during the wait.

## Questions for the maintainer

Approved at gate 2 (2026-10-10): every question below is settled with the default the plan follows. The real Claude SDK checks are to be run.

None blocks the first commits. Each has a default the plan already follows; changing one is small.

1. **Sub-agents inside a chain question, a request between squads and a ceremony's agent.** Rule 21 lists the stage, the agent a stage calls and an answer in a conversation. The chain question and the
   request are read-only calls with a clock and a thread of their own, and a ceremony's `deep` agent may delegate. *Default:* their sub-agents keep ending with the tool error ("stopped after N turns"),
   with the configured number. Wiring the chain and the request is the same asker and the run's thread; say so if you want it in this delivery.
2. **A repair round of a stage that reaches the limit.** The QA repair, the evidence round and the missing-documents round run inside the stage with the stage's call. *Default:* they do not ask; a round
   that runs out fails quietly and the answer before it stands, as today. The alternative is that they ask like the stage.
3. **A ceremony place in a conversation answer** (an answer recorded by a ceremony, not posted to a thread): *default* no question, because there is no conversation to say it in; its sub-agents end with the tool error.
4. **Detached reader conversation.** While a sub-agent of a called agent that reads waits for you, the stage's clocks stop although the stage goes on beside it. *Default:* stop them (risk 7); the alternative
   is to leave them running, which risks the stage failing for a wait it cannot see.
5. **The key of the plain sub-agent's number** is `runner.turns.plain`, and the field is labelled "Steps for a sub-agent that is not of a kind". Say if you prefer another word.

## Decision log

| # | Decision | Alternative rejected, and why |
|---|---|---|
| 1 | The five numbers are members of `runner.turns`, optional in the schema, required in the type, written by a step `v28ToV29` | A flat `runner.subTurns` object (a second place for "turns", and `WEB_EDITABLE` would need a line); no bump (an older app could open a file with keys it does not know and drop them on save) |
| 2 | The step writes the defaults whatever the chain seeded | Writing only what is missing (a hand-edited file would carry a number no one chose; the explicit write also keeps a later change of the default from moving a workspace) |
| 3 | The loop asks through an injected `turnLimit.ask`, and with none given it throws as before | Reading the store from the loop (the engine would know the app; every harness would need the store) |
| 4 | One `room()` helper replaces both throws | Patching each throw (the second one, in the door repair, would be forgotten the next time) |
| 5 | The limit of a sub-agent is read inside `sub()`, when it really begins | Reading it at the tool call (a sub-agent queued behind another would keep a number the person has since changed) |
| 6 | "Finish now" on a sub-agent spends one closing model call with no tools, then falls back to the last narration, then to a line naming what was read | The last narration alone (often empty, which is the failure the issue is about); failing the sub-agent (the dead end it removes) |
| 7 | A partial result is returned as the tool's text, starting with a note, and the node ends `finished` | A `ToolError` (the principal would read it as a failure and redo the work); a structured flag on the tool result (the Agent tool returns text) |
| 8 | A repair round and a wrap-up never ask | Letting them inherit the stage's `turnLimit` (a two-turn wrap-up would ask; a repair round fails quietly by design) |
| 9 | The question is a record in a store of its own, with no timer, behind two named channels | The run's `PendingQuestion` (written to the run, answered in text, the stage not alive); the host command's one-per-run slot (no place for a sub-agent in a conversation outside a run); the 15-minute decline of the other stores (rule 10) |
| 10 | One answering call with a `through` field | A channel per origin (an agent answerer later would be a third door to audit) |
| 11 | The channels are named in the web policy and open, with a pattern denying any other `turnAsks:` channel | Leaving them to the default (`allow`: a later change of the default could close or open them by accident); behind the external-effects switch (a phone able to see the question and not to answer it) |
| 12 | The asker builds the lines, pauses the caller's clock and passes the signal; each caller supplies `say`, `pause` and `signal` | Each caller writing its own (three copies of the masking and the clock release) |
| 13 | On the Claude engine the stage's question is asked in `runAgent` and "continue" is a resume with `extra.resume` and a fresh `maxTurns` | Asking inside `runClaudeSdk` (its options and servers are built once; a second `query` would have to swap the loop) |
| 14 | `canContinue` is in the record from the start, and the Claude commit is last | Building the Claude path with the rest (if the real check fails, a half-built path has to be taken out of three commits) |
| 15 | The state `waiting` is its own `ActivityState`, with `waiting()` and `continued()` on `RunActivity` | Reusing `queued` (it means a sub-agent waits for another); reusing `status` with a detail (the text key `activity.waiting` is taken) |
| 16 | One shared stack for the commands and the turn questions | A second fixed stack (it overlaps the first; the bottom is taken); a card on the run screen only (the question must reach every screen and the phone, rule 16) |
| 17 | No cap on the number of times "continue" may be pressed, and the round shown | A cap (spec, Q4: the person pays and answers, the wall cap runs while working) |
| 18 | The numbers go where `read` and `write` already are, so the phone edits them with no new permission | A desktop-only setting (the spec asks for the phone) |
