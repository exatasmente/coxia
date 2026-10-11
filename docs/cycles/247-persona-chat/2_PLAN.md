# Plan: the persona agent, its wizard and the chat that opens the app

## What this plan is

The approved specification (`1_SPEC.md`, gate 1 passed on 2026-10-10: every open question settled with its recommendation, except the phone, which does everything the computer does with the persona, the wizard included) asks for four things: a **persona** kind of agent with its own editor, a **wizard** that builds it with the machinery of the agent creator, a **chat** with it that is the home in place of Today and the Call screen, and a new place for everything that leaves the home. This document says where each piece lands in this tree, in which order it is built, and which tests hold it. Every `file:line` below was read again on `0.9.0` stable (`b6dab598`, the tree this branch sits on, schema 28).

Two corrections to the spec, both settled outside it:

- **The schema number.** The spec says "28 to 29". Issue #246 (another branch) takes `v28 -> v29` and lands first, so the step of this plan is **`v29ToV30`** and the version **30**. This branch must be rebased on #246 before its configuration commit (commit 1). If #246 has not landed when the work starts, commit 1 is written as `v28ToV29` (version 29) and renumbered at the rebase; the places that carry the number are listed in "Configuration and migration".
- **The phone.** Rules 5 (last sentence), 12, 13 (third bullet) and the last sentence of acceptance 1 say that making, editing and the wizard are the computer's and that a phone without a persona gets a note. The gate decided the opposite (rules 38 and acceptance 21 stand): a paired browser makes, adjusts, tests, deletes and clears the persona, so **the wizard is open to it and a phone with no persona gets the same wizard as the computer, with no note**. The "note that the persona is made on the computer" is not built, and the wizard channels are not answered with the app-only refusal.

The shape of the answer, in nine sentences:

- **The persona is an `AgentDef` with `kind: 'persona'`** (optional, absent is an ordinary agent), found by its kind and never by its id. A second flag-like state already exists, `draft`, and the persona's test copy is a persona that is also a draft.
- **One predicate keeps it out of the cycle.** `outOfCycle(a) = isDraft(a) || isPersona(a)` replaces `isDraft` inside `workingTeam`, `stageAgent` and the sites that test `isDraft` directly; every reader that goes through `workingTeam` is covered without being touched, and a test walks them all with a persona in the team plus a source scan that fails when a new `isDraft(` reader appears unclassified.
- **Its chat is its direct conversation `agent-<id>`**, hidden from the Forum list like a draft's, answered by the pipeline that already answers a direct conversation (`mentions/module.ts`, `mentions/answer.ts`). Only the answer changes for the persona: plain text with no schema, no write proposals, a text sink, and two app additions to the stored message (`answersTo`, `buttons`).
- **The answer streams through a per-call text sink fed by both engines**, a throttled module event (`persona:live`), and a read (`persona:live-read`) that resynchronises a device that joined late. The live text is the stored text: the same `redact`, computed over the whole text so far, with the last unfinished word held back until it is whole. The bubble is a client-side view; the post stays what it is and replaces the bubble by arriving.
- **The wizard is the creator's machinery with its own questions.** The creator's readers, limits, state helpers and call path (`askBare`, role `deep`, no tool) are reused; the persona has its own prompts (the four themes), its own review without settings, its own state file, and its own channel prefix `persona:`, **open to a paired browser** and pinned by a policy test.
- **The chat view is one component in two sizes**: full screen (the home) and compact (the wizard's test). It draws the stored thread, the live bubble, the Work section (the existing activity tree, found by the message it answers), the buttons, and a box.
- **Buttons are stored targets, worded by the app.** The persona's one new tool, `OpenScreen`, validates a target with `parseTarget` and the cycle's own state and appends it to the answer; the model writes no label, so a button cannot say one thing and open another.
- **Today becomes the Overview by a mechanical commit** (rename plus one `HOME` constant that every "back" uses), and the **home switch is the last commit**: the constant flips from the Overview to the chat, the invitation appears, the bar and the notices change.
- **Ceremonies are untouched**: `useCeremony` stays in `App`, the Call screen and the other ceremony screens keep their code; only their back button and their `back` type change.

## What will be built

| Feature (spec rule) | Where it lands |
|---|---|
| The persona kind and its helpers (1, 2) | `src/shared/config/types.ts` (`AgentDef` `:626`, `draft` `:674`), `src/shared/config/team.ts` (`isDraft` `:106`, `workingTeam` `:109`, `stageAgent` `:121`, `newAgent` `:57`), new `src/shared/persona.ts` |
| Inert by validation, one persona, one draft copy (3) | `src/shared/config/validate.ts` (`teamRules` `:87`), `src/shared/config/migrations.ts` (`repair`, `poolKeyAt` `:436`) |
| Starting access of a reading agent (4) | `src/shared/persona.ts` (`personaAccess`), used by `persona:finish` |
| Out of the cycle, templates, export (2, 7, Q11) | the sites listed under "Data"; `src/shared/config/transfer.ts` (`buildExport` `:23`, `parseImport` `:54`), `src/main/config-transfer.ts` (`currentOf` `:40`, `applyImport` `:71`), `src/shared/cycles/apply.ts` (`mergeTemplateTeam` `:59`, `templateFromConfig` `:102`, `parseTemplate` `:156`) |
| Schema step (37) | `types.ts:5`, `schema.ts:6,268`, `migrations.ts` (`v29ToV30`, `STEPS` `:416`, history `:50`), `docs/configuration.md` |
| Plain-text call, text sink in both engines (28, 29, 32) | `src/main/engine/contract.ts` (`EngineRequest` `:184`), `src/main/agents.ts` (`AgentCall` `:1414`, `sdkOptions` `:489`, `runOpenEngine` `:657`, `runClaudeSdk` `:770`, `runAgent` `:1528`), `src/main/engine/open/loop.ts` (`RunEvents`, `call` `:571`, `:721`, `:740`) |
| The live text: store, event, read (28, 30, 39) | new `src/main/persona/live.ts`, `src/shared/persona.ts`, new `src/main/persona/module.ts`, `src/renderer/src/chatModel.ts`, `src/renderer/src/liveApi.ts` |
| The persona's answer: plain, stored once with `answersTo` and `buttons`, stop, failure, queue (30, 31, 35) | `src/main/mentions/answer.ts` (`mayPropose` `:171`, `:359`, `:399-421`), `src/main/mentions/call.ts` (`mentionCall` `:178`), `src/main/mentions/module.ts` (`:96-139`), `src/main/forum-core.ts` (`MESSAGE` `:111`, `build` `:312`), `src/shared/forum.ts` (`ForumDraft` `:50`, `ForumMessage` `:80`, `mentionableIds` `:188`), `src/main/forum.ts` (`personPost` `:44`, `attachmentPost` `:55`, `:103-107`, `:113-116`, `:147-157`) |
| The buttons (22) | new `src/main/persona/openScreen.ts`, `src/shared/push.ts` (`PUSH_SCREENS` `:27`, `parseTarget` `:34`) |
| The wizard: prompts, readers, channels (8 to 12, 38) | new `src/main/persona/assist.ts`, `src/main/persona/assistCore.ts`, `src/main/agentAssist.ts` (`AssistError` `:44`, `explain` `:47`), `src/main/agentAssist-core.ts` (`readAssistInput` `:192`, `testConversation` `:208`, `readRoundAnswer` `:237`), `src/shared/agentAssist.ts` (`ASSIST_LIMITS` `:16`, `readQuestions` `:151`, `readAssistDraft` `:179`, `ASSIST_ROUND_SCHEMA` `:319`), `src/shared/i18n/en.json` and `pt-BR.json` (`prompt.sdd.persona.*`), `src/main/custo-core.ts:20`, `src/main/retention-core.ts:31` |
| The wizard on screen (8 to 12) | new `src/renderer/src/screens/persona/PersonaWizard.tsx`, `personaWizard.ts` (DOM-free), `src/renderer/src/screens/team/assistEdit.ts` (`closeRound` `:119`, `hasProgress` `:125`, `withRound` `:134` made generic) |
| The chat (14 to 17, 28, 31, 34, 35) | new `src/renderer/src/screens/persona/ChatScreen.tsx`, `ChatThread.tsx`, `ChatMessage.tsx`, `chatModel.ts`; `src/renderer/src/screens/cycle/Thread.tsx` (`Composer` `:301` moved out), `src/renderer/src/ActivityTree.tsx` (`Items` `:109` exported) |
| The home, the strip, the card, the menu (13, 14, 18, 19, 21) | new `src/renderer/src/home.ts` (DOM-free), `ChatHeader.tsx`, `StatusStrip.tsx`, `src/renderer/src/App.tsx` (`Screen` `:48`, `:91`, `:145`, `:180`), `src/renderer/src/screens/Today.tsx` renamed `Overview.tsx` |
| Targets, notices, push, tray (25, 26) | `src/shared/push.ts`, `src/shared/types.ts:465`, `src/renderer/src/pushTarget.ts`, `jobNotify.ts:10`, `src/main/scheduler.ts:101,106,110,127`, `watchers.ts:293,294,331`, `feedback.ts:206`, `runner/module.ts:190`, `webPush.ts:247,265`, `index.ts:131,139` |
| The bar (27) | `src/renderer/src/screens/BottomNav.tsx:95-96`, `src/renderer/src/dashboard.ts:273-296` |
| Settings › Persona (5, 6) | new `src/renderer/src/screens/persona/PersonaSection.tsx`, `src/renderer/src/screens/Settings.tsx:135`, `src/renderer/src/screens/team/TeamSection.tsx:145` |
| Paired phone policy (38) | `src/main/webPolicy.ts` (`PERSONA_CHANNELS`, a pattern), `src/main/configScope.ts` (no change, pinned), `src/main/auditoria.ts`, `src/shared/auditoria.ts:1` |
| Updates (39) | `src/renderer/src/App.tsx:174-176`, `src/renderer/src/liveApi.ts` |
| Words (24) | `src/shared/i18n/ui-persona.en.json` and `.pt-BR.json` (new, gathered in `ui.ts`), `main.*.json`, the reworded keys listed under "The home" |
| Documentation | `docs/persona.md` (new), `docs/README.md`, `docs/configuration.md`, `docs/cycles.md`, `README.md`, `README.pt-BR.md`, `CHANGELOG.md` under `## [Unreleased]` |

## Data

### The kind, and the one predicate

```ts
// src/shared/config/types.ts
export const AGENT_KINDS = ['persona'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];
// AgentDef, after `draft`
/** The persona of the workspace: the person's representative in the app. Absent: an ordinary agent. */
kind?: AgentKind;

// src/shared/config/team.ts
export const isPersona = (a: Pick<AgentDef, 'kind'>): boolean => a.kind === 'persona';
/** Takes no part in the cycle: a draft of the AI assistant, or the persona. */
export const outOfCycle = (a: Pick<AgentDef, 'draft' | 'kind'>): boolean => isDraft(a) || isPersona(a);
export const personaOf = (team: readonly AgentDef[]): AgentDef | null => team.find((a) => isPersona(a) && !isDraft(a)) ?? null;
export const personaDraftOf = (team: readonly AgentDef[]): AgentDef | null => team.find((a) => isPersona(a) && isDraft(a)) ?? null;
export const withoutPersona = (config: WorkspaceConfig): WorkspaceConfig => /* the team without any entry of kind persona */;
```

- `workingTeam` (`team.ts:109`) and `stageAgent` (`:124,125`) call `outOfCycle` instead of `isDraft`. `newAgent` (`:57`) copies `kind` the way it copies `draft` (`:75`): only `'persona'` is carried.
- `schema.ts` (`agentDef` `:268`, after `draft` `:284`): `kind: enumOf('The persona of the workspace ... Absent: an ordinary agent.', AGENT_KINDS)`; `test/config-schema.test.ts` compares the keys of the schema with those of the neutral defaults, and `kind` is optional and absent from the defaults exactly as `draft` is, so the test needs only a case of its own.
- **Why `kind` and not a section** is Q1 of the spec and is settled. The price it named (every site that keeps a draft out of the cycle must keep the persona out too) is paid below, from a search and not from memory.

### Every site that excludes a draft must exclude the persona (rule 2)

Found with `grep -rn "isDraft\|workingTeam\|stageAgent" src` on this tree. Four classes.

**A. Through `workingTeam`: no edit at the site, covered by the new definition, and walked by a test.**

| Site | What it decides |
|---|---|
| `src/shared/config/squads.ts:37,44,102,116` | squad members, the effective team, the liaison, who an agent turns to |
| `src/shared/config/team.ts:237` | the recommendations of permissions |
| `src/shared/agentAssist.ts:122` | the stages the creator may offer (a stage naming an agent is not free) |
| `src/shared/runs/flowCheck.ts:171`, `squadCheck.ts:189` | the team the flow and the squads are checked over |
| `src/main/workspaceConfig.ts:83` | what counts as a change of the flow when a config is saved |
| `src/main/agentAssist-core.ts:52` | the agents the creator tells the model about |
| `src/main/forum.ts:103` | which agents get a direct conversation made (edited, see B) |
| `src/main/mentions/answer.ts:361` | who `CallAgent` may call in a conversation |
| `src/main/runner/executor.ts:1066` | who `CallAgent` may call from a stage |
| `src/main/runner/service.ts:858,1324,1604,1680` | sandbox preflight, `setAutonomous` (a persona is "unknown-agent"), the squad liaison |
| `src/renderer/src/screens/team/agentEdit.ts:265`, `flowEdit.ts:23`, `squadEdit.ts:12` | who an agent may turn to, the flow editor's team, who a squad may take |

**B. Direct tests of `isDraft`: edited to `outOfCycle` (or to a persona-aware rule).**

| Site | Edit |
|---|---|
| `src/shared/config/team.ts:124,125` (`stageAgent`) | `outOfCycle` |
| `src/shared/forum.ts:188-193` (`mentionableIds`) | the ids of agents that are not `outOfCycle`; the owner of a thread is added back **only when the owner is a draft that is not a persona** (the persona's chat resolves no `@`, rule 15). The generic parameter becomes `Pick<AgentDef, 'id' or 'draft' or 'kind'>` |
| `src/shared/forumView.ts:198` (`chatAgents`), `:191` (`mentionChoices`) | `!outOfCycle` |
| `src/main/forum.ts:103-107` (`forum:list`) | `ensureAgentThread` for the persona too (so the thread exists), and the persona's and any draft's thread ids in `hidden` |
| `src/shared/cycles/apply.ts:109` (`templateFromConfig`) | `!a.system && !outOfCycle(a)` |
| `src/shared/cycles/apply.ts:59` (`mergeTemplateTeam`) | skips a brought agent that is a persona (a template file never brings one); `parseTemplate` (`:156`) drops the `kind` of a brought agent with a warning |
| `src/shared/runs/flowCheck.ts:172` (`checkFlow` drafts set) | unchanged on purpose: a stage that names a persona reads as "not in the team" (`flow.check.agent-unknown`, `main.en.json:1455`); a persona draft gets the draft wording, which is true of it |
| `src/main/agentAssist-core.ts:224` (`adjustable`) | `!found.system && !outOfCycle(found)`: the creator never adjusts a persona |
| `src/main/agentAssist.ts:95,140,165,174` | the creator's draft doors (`draftOf`, `saveAssistDraft`, `discardAssistDraft`) refuse an entry of kind persona: the persona's drafts are handled by the `persona:` channels only |
| `src/renderer/src/screens/team/TeamSection.tsx:145,147` | the Team list filters out `isPersona`; `src/renderer/src/screens/team/agentEdit.ts:212` (`promoteDraft`) refuses one |

**C. Readers of `agents.team` that stay unfiltered, each with its reason** (written here so a reviewer does not have to rediscover it):

| Site | Why it stays |
|---|---|
| `src/main/runner/service.ts:440` (`callsOfMention`) | only ranks the memory's index by the agents a message names; the call itself is decided by `message.mentions`, which `mentionableIds` already filters |
| `src/main/runner/executor.ts:502` (`to === 'todos'`) | posts into the inboxes of agents that are working a stage; the persona has none |
| `src/main/mentions/answer.ts:188` and `mentions/module.ts:107,111` | resolve the agent that answers, by id: the persona must be found here |
| `src/main/memory/channels.ts:47`, `browser/module.ts:17,69,74`, `renderer/src/screens/memory/MemoryScreen.tsx:21,73`, `procedures/ProceduresScreen.tsx:53,107` | name and list an agent's notes, procedures and screens: the persona has them and they must show |
| `src/renderer/src/ActivityTree.tsx:120`, `JobsDock.tsx:127`, `Thread.tsx` names | only turn an id into a name |
| `src/main/suggestionsModule.ts:204`, `agentAssist.ts:167` | id uniqueness: the persona's id is taken |

**D. A guard, so the list cannot rot.** `test/persona-team-readers.test.ts` reads every file of `src/` for `isDraft(`, `outOfCycle(` and `workingTeam(` and fails when the set of files differs from the one the test lists, each with its class above. A new reader added later has to be classified before the suite is green, the way `test/memory-policy.test.ts` classifies a new channel.

### Validation (rule 3) and what a bad file does

`teamRules` (`validate.ts:87`) gains, all with the **path `agents.team[i].kind`** and an English message:

- a persona (not a draft) when another persona that is not a draft exists, and a persona draft when another persona draft exists: "only one persona per workspace" (at most one real and one test copy);
- a persona that has stages, a squad, a `turnsTo`, `autonomous: true` or `system: true`: one error per field, still at the `kind` path, saying which field.

Why the one path: `repair` (`migrations.ts:476`) answers an error by resetting the nearest path the neutral base has, and the base has no entry at index `i`, so an error at `agents.team[i].stages` would walk up to `agents.team` and **replace the whole team with the defaults**. The same already happens to any custom agent with a bad field, but a persona is the one entry a person writes about themselves, and a hand-edited file must not cost them the team. `poolKeyAt` (`migrations.ts:436`) gets one branch, `agents.team[i].kind` returns the index of `kind`, so `dropPoolField` deletes that field alone: the entry stays as an ordinary agent, the note says what was dropped, and the file loads. The permission fields are **not** constrained (rule 3): a file that gives the persona `tracker: 'read'` or `shell: 'sandbox'` is honoured as for any agent.

### The stored message gains two optional fields

`ForumDraft` (`shared/forum.ts:50`) and `ForumMessage` (`:80`):

```ts
/** A persona's answer: the `seq` of the message of the person it answers. `replyTo` is not used because the store keeps it only for `answer` messages (forum-core.ts:341). */
answersTo?: number | null;
/** Where the persona offers to take the person: targets of the notification vocabulary, validated again by the store. The app words the button. */
buttons?: PushTarget[];
```

- `forum-core.ts`: `MESSAGE` (`:111`) gets two optional properties (`answersTo` an integer of at least 1; `buttons` an array of at most 4 objects with `to` and optional `ref`, `id`, `mr`, `additionalProperties: false`); `build` (`:312`) writes `answersTo` only for an agent's `post` and runs every button through `parseTarget` again (a target the store cannot parse is dropped, never stored). A stored line without the fields reads as before.
- An older app refuses a thread file that carries them (`additionalProperties: false`), the same limit every added field of the message had; the configuration bump to 30 already stops an older app from opening the workspace.

### The live text

```ts
// src/shared/persona.ts (no Electron, no DOM)
export const PERSONA_LIVE_EVENT = 'persona:live';
/** One step of the text being written. `offset` is where `text` goes in the text so far: 0 replaces it (the first piece, a restart, a rewrite by the masking), else it appends. */
export interface LiveEvent { thread: string; to: number; agent: string; rev: number; offset: number; text: string; end?: true }
export interface LiveAnswer { thread: string; to: number; agent: string; rev: number; text: string }
export function applyLive(state: LiveAnswer | null, e: LiveEvent): { state: LiveAnswer | null; resync: boolean };   // DOM-free: the client assembly
```

`applyLive` ignores an event with `rev` at or below the state's, applies one that is exactly the next, and asks for a resync when `offset` is past the text it holds or `rev` skips. `end` drops the state. This is the whole of "the pieces arrive in order; a device that connects in the middle shows what was written and goes on".

### The persona's limits and starting access

`PERSONA_LIMITS = ASSIST_LIMITS` (name 80, sentence 1000, instructions 4000): the editor and the wizard share the creator's, so what the wizard writes can always be saved. `personaAccess()` returns the starting access of rule 4 and nothing else: `{ permission: 'read', tracker: 'read', shell: 'none', autonomous: false, turnsTo: null, stages: [], model: { role: 'deep', provider: '', model: '' } }`; no `tools` override (the workspace's tools), no `screen`, `allowedHosts` or `browserProfile`, and the main process sets it, never the model and never the screen.

## Configuration and migration

The schema is 28 in this tree (`types.ts:1,5`, `schema.ts:6`); `STEPS` ends at `27: v27ToV28` (`migrations.ts:416`), which wrote `runner.showReasoning = true` (`:410-414`). The step of this plan is **`v29ToV30`** (see the first correction above): it assumes #246's `v28ToV29` is in the chain, so the branch is **rebased on #246 before commit 1**.

- **The step** (`migrations.ts`, after `v28ToV29`; `STEPS[29] = v29ToV30`; the history comment at `:50` gains `v30`): writes nothing but the version. `kind` is optional and absent is an ordinary agent, so nothing raises and nothing is seeded, exactly as `v19` did for `draft` (`:38-39`): "Nothing stored changes; the bump makes an older app refuse the file instead of repairing (and then saving) a team it cannot read." It leaves no note. A second start changes nothing.
- **`CONFIG_SCHEMA_VERSION = 30`**, the header comment of `types.ts:1` ("schema 30") and the one of `schema.ts:6`.
- **If #246 has not landed** when the work starts, commit 1 is `v28ToV29` and version 29; at the rebase the number moves in: `types.ts:1,5`, `schema.ts:6`, the step name, its `schemaVersion` literals, `STEPS`, the history line, `docs/configuration.md` (the two lines the test requires, the two tables `:15,:170`, the two history paragraphs `:51,:205`), `test/config-migrations.test.ts` (the `describe` title and `fromVersion`, the "newest step" test at `:932-934` that reads `CONFIG_SCHEMA_VERSION` and `29 is refused`), and `docs/cycles/247-persona-chat/3_IMPLEMENTATION.md` once it exists. `test/docs-schema-version.test.ts` and `test/config-schema.test.ts` read the constant and need no edit: they are the guard that nothing was missed.
- **`docs/configuration.md`**: "versão do esquema 30)" and "schema version 30)" (lines `:9`, `:164`), `schemaVersion: 30` in the two tables (`:15`, `:170`), a `v30` entry at the end of both history paragraphs (`:51`, `:205`), and the `agents.team` row says the entry may carry `kind` and that the persona is the single entry that does.
- **Tests that pin the number** (read now): `test/config-migrations.test.ts:868-935` (the `schema 27 to 28` block and the "newest step" test, which becomes "30 is current and 31 is refused"), and a new `describe('schema 29 to 30: the persona kind')` after it with the cases of the test plan.

### Export, import, templates (Q11, settled here)

The persona's instructions are about the person, so they leave the workspace only by being read in it.

- **`buildExport`** (`transfer.ts:23`) exports `withoutPersona(config)` (every entry of kind persona, the draft copy included), and `requiredSecrets` is computed from that config. The export file is the thing a person shares; the persona is not in it.
- **`parseImport`** (`transfer.ts:54`) removes any entry of kind persona from a file it reads (a hand-made file, or one from a build that exported it) and adds a warning at `agents.team` saying so.
- **`applyImport`** (`config-transfer.ts:71`) writes a config over an existing workspace: today it would erase the workspace's own persona, because the file has none. It keeps the target's persona entry the way it already keeps the target's plugins (`pluginsOf`, `:100-109`): read from the stored file of an `existing` target and put back into the written team; a `new` target starts with none. `previewImport` (`:51`) and `currentOf` (`:40`) compare the target **without** its persona, so the preview does not list the persona as removed.
- **A cycle template** never carries one (`templateFromConfig`, `mergeTemplateTeam`, `parseTemplate`, above).
- **Who reads it.** A paired browser reads the configuration (`config:get`, reading is open), so it reads the persona's instructions: the same trust the maintainer gave the phone for the chat (Q11). The Persona section says in one line where its text is read (the model of its provider, this computer's session files, a paired browser). The session files of the open engine already hold every agent's system text (`loop.ts:563`); the session index records a kind and a reference and never a prompt (`sessions-core.ts:33-35`), the error log keeps a whitelist of short context values (`errorlog-core.ts:85-96`), and the usage records hold counts. Nothing here adds a place where the instructions are copied.

## The persona wizard

### What is reused and what is its own

| Piece | Reused from the creator | The persona's own |
|---|---|---|
| Readers and limits | `ASSIST_LIMITS` (`shared/agentAssist.ts:16`), `readQuestions` (`:151`), `readAssistDraft` (`:179`), `ASSIST_ROUND_SCHEMA` (`:319`), `readAssistInput` (`agentAssist-core.ts:192`), `readRoundAnswer` (`:237`), `testConversation` (`:208`), `AssistError`/`explain` (`agentAssist.ts:44,47`, exported) | `readPersonaReview(raw, previous)`: `{ draft }` only, no settings, no reasons; `PERSONA_REVIEW_SCHEMA = { draft }` |
| The call | `askBare('deep', prompt, schema, { system })` (`agents.ts:1074`): role `deep`, no tool, no code host, no docs | the prompts below; no `context` section (no stages, squads, agents, sandbox or tools are told to the model) |
| The state | `closeRound`, `hasProgress`, `withRound`, `withAnswer`, `answerOf`, `roundsLeft`, `canAskAnotherRound` (`assistEdit.ts:74-134`), generalised over the structural `RoundState` (`rounds`, `open`, `draft`, `enough`, `note`, `step`, `testId`) instead of the whole `AssistState` | `personaWizard.ts`: `PersonaState` without `settings` and `reasons`, `startPersona(base?)`, `toPersonaInput`, `withPersonaReview`, `personaDraftInput`, `personaFormOf(persona)` |
| The channels | none | `persona:round`, `persona:review`, `persona:saveDraft`, `persona:conclude`, `persona:discard`, `persona:finish` |
| The test | the direct conversation `agent-<id>`, `deleteAgentThread`/`ensureAgentThread` (`forum-channels.ts:21,33`) | rendered by the compact chat view, not by `Thread`; with none of the persona's tools |

### The prompts (rules 8, 9; acceptance 2)

In `en.json` and `pt-BR.json`, beside `prompt.sdd.assist.*` (`en.json:469-488`), so they pass through the same `cp()` path and the same `openersOf` recognition (`shared/cycles/prompts.ts:77`):

- `persona.system`: who the model is (it helps one person describe themselves so an assistant can represent them in a desktop app), that it has no tools and knows only what the message holds, **never to propose a setting, a permission, a tool, a stage or a command** (the app sets the starting access), the `<data>` rule for what the person wrote, and the language rule: the questions, the name and the sentence in the workspace's language, **the instructions in English**, written to the persona itself, with **one heading per theme**.
- `persona.round`: the request, the answered rounds, the draft so far; "ask from {min} to {max} new questions", the kinds `open`/`single`/`multi`, "never add Other", the four themes (below), and `enough` only when each theme has been covered; the person may skip a question.
- `persona.review`: finish the draft; the instructions end with the four headings `## Who the person is`, `## How they decide`, `## What matters to them`, `## What they never want done`, in that order, each filled from the answers or saying "not told".
- `persona.theme.who|decide|matters|never`: the four themes as words the round prompt lists (so the model is told them in the language of the workspace).
- `persona.task.create|adjust`, `persona.section.original` (the persona as it is, without `settings`); the sections `request`, `rounds`, `roundTitle`, `answer`, `skipped`, `other`, `draft`, `test`, `note` are **reused** from `prompt.sdd.assist.section.*`.
- The cost and retention screens recognise an app prompt by its opening: `['persona.round', 'assist']` and `['persona.review', 'assist']` are added next to `['assist.round', 'assist']` in `custo-core.ts:20` and `retention-core.ts:31`, so the wizard's calls are counted as the assistant's, and the wizard's Claude sessions (which hold what the person told about themselves) are recognised as the app's own and swept by the retention like the creator's (`retention-core.ts:99-101`: a session whose opening is not an app prompt is never touched).
- The prompt editor lists every `prompt.*` key from the catalogs (`configModule.ts:79`); the persona's appear there like the creator's.

### The channels and what each does (all in `src/main/persona/assist.ts`, registered by `personaModule`)

| Channel | Does |
|---|---|
| `persona:round` | `prepare()` as the creator's (`agentAssist.ts:75`) without the context: at most 4 rounds, `askBare`, `readRoundAnswer` |
| `persona:review` | the same, with `PERSONA_REVIEW_SCHEMA` and `readPersonaReview`; a model that proposed a setting is ignored (there is no field to read it from) |
| `persona:saveDraft` | **create:** refused when a persona already exists; saves (or, with the id the screen holds, updates) the persona draft: `kind: 'persona'`, `draft: true`, the inert fields of `draftAgent` (`agentAssist-core.ts:266`), the access of `personaAccess()`, name/sentence/instructions cut to the limits and masked; makes `agent-<id>`; an update starts the conversation over. **adjust (`from`):** a copy of the persona that keeps its model. A persona draft already in the team is reused, never a second (validation allows one) |
| `persona:conclude` | empties the draft's conversation and makes it again (`concludeAssistDraft` `:204`), for "back to the review" |
| `persona:discard` | removes the draft from the team first, then its conversation and files (`discardAssistDraft` `:218`); refuses an entry that is not a persona draft |
| `persona:finish` | **create:** removes the draft mark, applies `personaAccess()`, empties the test conversation, keeps the id, makes the thread; refuses when a persona exists. **adjust:** writes the draft's three texts onto the original persona (`updateAgent`), keeps its model, access and conversation, removes the draft and its thread. Returns `{ id }` |

`persona:saveDraft` and `persona:finish` build the entry in the main process from the texts alone: the screen's `settings` do not exist, so a paired browser cannot raise anything through them (a `tracker: 'read'` on a new agent would be refused by `raisedPermissions`, `configScope.ts:70-87`, on the `config:cycle-save` route; the channel route is why the wizard works from the phone).

Wording of errors: every refusal is worded in `main.persona.error.*` (both catalogs) and thrown as an `AssistError`, so the screen shows it as it does the creator's.

### The screen

`PersonaWizard.tsx` has two presentations of one component: `screen` (the home's invitation, and the phone) and `panel` (a `SidePanel`, `team/ui.tsx:34`, opened by Settings › Persona's **Adjust with AI**). Steps: request (who you are and what you do, in your words), questions (rounds, `AssistQuestionView` reused), review (name, sentence, instructions with the headings, and a fixed line of text saying what the persona can do now: read, chat, open screens), test (the compact chat), and the conclusion **Save and open the chat** (`persona:finish`, then `go(chat)`). **Not now** (home only) goes to the Overview for this session; nothing is stored. Closing with progress asks first (`hasProgress`), then `persona:discard`.

## The chat thread and the plain-text call

### The thread

The persona's chat is its direct conversation `agent-<id>` (`forum.ts` shared `:176`, `forum-channels.ts:21`). It is created when the persona is saved (`persona:finish`), when the app starts with a persona and no thread (a `personaModule` init that calls `ensureAgentThread`, and again on `onConfigChange`, `workspaceConfig.ts:121`), and when the forum is listed (`forum.ts:103`); it is **never in the Forum list** (`hidden`, class B), so there is one door and no unread badge in the Forum. Its messages stay in the forum store (`forum/<thread>.jsonl`).

`personPost` (`forum.ts:44`) and `attachmentPost` (`:55`) resolve `@name` against `mentionableIds`, which for the persona's thread is empty (class B), and then post a system line "unknown mention" for every `@word`. For this thread that line must not exist (rule 15: a `@name` stays plain text), so both take a `quiet` flag the handlers (`forum:post` `:113-116`, `forum:attachment-post` `:147-157`) set when the thread belongs to a persona (draft or not): `mentions: []` and no system line. A message written while an answer goes waits its turn: `inFlight` (`mentions/module.ts:31`) already chains the answers of one thread, and each accepted message already gets its `queued` line (`:105-116`).

### The answer (`answerMentions`, one branch for `isPersona(def)`)

All edits are in `src/main/mentions/answer.ts` and `call.ts`; nothing changes for any other agent, and no prompt of another agent changes (the goldens run unchanged as the proof).

1. `mayPropose` (`:171`) returns false for a persona: no `proposals` field, no `raiseWrites` (`:411`).
2. `mentionCall` (`call.ts:178`) takes `persona?: true`: `schema` is **undefined** (`:214`), the `proposals` and `labelsLine` parts are skipped, and the two persona texts replace `runner.mention.system`/`main` (`cp('runner.mention.persona.system')`, `cp('runner.mention.persona.main')`, in `main.en.json` and `main.pt-BR.json` beside `:1083-1084`). The system text says who it is (the person's representative; the instructions that follow describe the person), that today it can **chat, read, and offer buttons that open a screen, and nothing else**, that it **writes plain Markdown, in the language the person writes in**, and how to use `OpenScreen`. The sections (thread of the last 40 messages `:209`, shared memory, procedures, files) are the ones every conversation answer gets.
3. `AgentCall.schema` and `EngineRequest.schema` become optional (`agents.ts:1424`, `contract.ts:188`); `sdkOptions` (`agents.ts:515`) sets `outputFormat` only when there is one. The open engine already reads "no `outputFormat`" as "no schema" (`bridge.ts:135`), and its loop already ends a call without a schema on the text (`loop.ts:740-744`).
4. `answerMentions` posts `text = answerText(r.data)` (a string now, `:401`); `deps.forum.append` (`:403`) adds `answersTo: message.seq` and `buttons` from the call's sink. The excerpt `made.activity.answer(text)` (`:405`) stays.
5. **Stop** (`stoppedBy === 'person'`, `:418`): if the live text is not empty, the answer is posted first with what was written (masked by the store, `answersTo` set) and then **one** system line `runner.mention.stoppedPartial` ("The answer of {agent} was stopped by the person; what is above is what had been written."), instead of `runner.mention.stopped`. **Failure** (`:420-421`): the failure line only; the live state is dropped without a post (Q10 of the spec).
6. `finally` (`:422`): `live.end(thread, seq)`.
7. The persona has the conversation tools every answer has (`CallAgent` `:359`, the procedures and the memory sessions `:275-300`), plus `OpenScreen` pushed into `call.runnerTools` when the agent is a persona and not a draft (the test conversation is offered none of the persona's own tools, rule 11). The tool of a persona hangs its activity under the call's node through the existing `underNode` wrapper (`agents.ts:1541-1542`).

### The buttons tool (`src/main/persona/openScreen.ts`, rule 22)

`OpenScreen({ to, ref?, id?, mr? })`, offered by name in `allowedTools` by both engines through `runnerTools`. Its factory takes `{ config, cards, runs, sink }`. It never navigates: it validates and appends to the sink of the answer being written, and answers the model in text.

- **Shape:** `parseTarget` (`push.ts:34`) must accept it; anything else is refused with the reason.
- **The cycle has it:** `call` needs `ceremonyAvailable(cycle, 'preDaily')`, `deep` needs `unblock`, `qa` needs `qaHandoff`, `retro` needs `retro`, `gate` needs `gate` (`shared/cycles/ceremonies.ts:14-24`, with the `specs` context the cycle view builds); a ceremony the cycle turned off is refused with "this workspace's cycle has no <ceremony>".
- **The thing exists:** a `ref` must be a card of `loadCards(100)` (`cards.ts:74`, read without refresh); an `id` of `run` a run in the store; of `conflict` a pending conflict action; of `forum` a thread. A card that is not loaded is refused with "that card is not among today's cards".
- **At most 4 buttons per answer**, deduplicated by target. The model writes no label; the renderer words the button from the target (`buttonLabel(target, t)` in `chatModel.ts`: "Start the pre-daily", "Open the board", "Open the QA hand-off for #123"). A tap goes through `targetToScreen` and moves only the device that tapped.
- **Vocabulary.** `chat` and `overview` are added to `PUSH_SCREENS` (`push.ts:27`) as the spec says, and `board`, `procedures` and `memory` too, because the spec's own example ("show me the board") has no target without them and the menu lists them (question 2). `today` and `call` stay.

### The activity of an answer (rules 34, 35)

The call already runs under the job `mention:<thread>` and its first line carries `call: { agent, thread, message }` (`mentions/module.ts:112`). The chat reads `useActivityTree(mentionJob(thread))` (`useActivity.ts:43`) and `workOf(nodes, seq)` (new, in `chatModel.ts`) picks the roots whose `call.message === seq && call.agent === persona`; the stored answer finds its tree through `answersTo`. `workSummary(root)` gives the duration (first to last line) and the step count (tool lines in the subtree) for the closed section. The root's own trailing `answer` line is left out of the section, because the bubble is that answer. `ActivityTree.tsx` exports `Items` (`:109`) as `ActivityItems`; the section is `Chevron` + summary + `ActivityItems` over the root's items, **open while the call works, closed once the answer is posted**, with the person's own choice kept by `treeView` (`:12`). The activity is memory only, as ever: after a restart older answers have no section and say nothing.

### Updates (rule 39)

`App.tsx:174-176` reports busy when `callLive`, a speech or a job runs. `liveApi.ts` keeps the live answers of the window (the same module event the chat reads, subscribed at module load like the activity store, `useActivity.ts:11`), and `useLiveAnswers().length > 0` joins that expression, so an answer started on the phone also counts. The main process is unchanged (`updates.ts:325`).

## Streaming

### The sink (`src/main/engine/contract.ts`)

```ts
export interface TextSink {
  piece(text: string): void;      // the next piece of the turn being written
  restart(): void;                // what was written is not the answer: the turn ended in tool calls, or the call moved to another model
  settle(text: string): void;     // the whole final text, when the engine has it: a sink that got no piece shows it now
}
// EngineRequest and AgentCall: `text?: TextSink`; `runOpenEngine` and `runClaudeSdk` feed it, `runAgent` hands it through (agents.ts:1570).
```

### Open engine (`loop.ts`, `agents.ts:692-720`)

- `RunEvents` (`loop.ts:75-94`) gains three members the principal's `runOpen` uses and **a sub-agent never inherits**: `onPiece(text)`, `onTurnEnd(toolsFollow)`, `onRestart()`. The sub-agent's `events` (`:463`, `{ ...events, onThought: undefined, ...handle?.events }`) sets all three to `undefined` beside `onThought`, so a sub-agent's text never reaches the persona's bubble (its pieces are a tool result for its parent).
- `call()` passes `onText: (t) => { events.onText?.(t); events.onPiece?.(t); }` to `pool.complete` (`:578`); the existing `onText` stays the sign of life (`agents.ts:707`). Pieces come from `ChunkFolder.piece` (`client.ts:100-109`), which already excludes `<think>` blocks and reasoning.
- In the `c.toolCalls.length` branch, next to `events.onInterim?.(c.text)` (`:721`): `events.onTurnEnd?.(true)`. In `runOpenEngine`, `onTurnEnd: (tools) => tools && req.text?.restart()`; the text moves to the activity as narration through the existing `onInterim` (`agents.ts:711`), which is exactly rule 29.
- The pool's `onSwitch` (`loop.ts:394-397`) also calls `events.onRestart?.()`: a model that fails after it began to write is retried on another model from the start, and the first model's pieces must not stay in the bubble. A switch caused by a sub-agent through the shared pool restarts an already empty bubble.
- A call without a schema ends with `return done(c.text, turns)` (`:744`); `runOpenEngine` calls `req.text?.settle(String(result.data))` after `runOpenOnce` returns, so an engine path that produced no piece (a server that does not stream) still shows the text once, at the end.

### Claude SDK (`agents.ts:770-960`)

- `sdkOptions` (`:489`) sets `outputFormat` only when `req.schema` exists, and `runClaudeSdk` adds `includePartialMessages: true` to `options` (`:804-812`) **only when `req.text` exists**: no other call changes.
- The loop keeps its reading of whole assistant messages. New: a message with `type === 'stream_event'` and `parent_tool_use_id === null` whose event is a `content_block_delta` with a `text_delta` calls `req.text.piece(delta.text)`; a `message_start` of the top level calls `req.text.restart()` when text is held; a top-level `tool_use` block (`:902`) calls `req.text.restart()` at once, so the narration of a tool turn leaves the bubble when the turn ends and not when the next one starts. `thinking_delta` and every event of a sub-agent are ignored (their blocks reach their nodes as they do now).
- **The thought join must not be cut by the new events.** `if (m.type !== 'assistant') flushThought()` (`:870`) would flush the held thought at every `stream_event` and split one turn's thinking into several lines. It becomes `if (m.type !== 'assistant' && m.type !== 'stream_event') flushThought()`.
- **The result.** The success branch today requires `structured_output` (`:938`). For a call with no schema it accepts a `success` result and returns `data: m.result` (the SDK's final assistant text, `SDKResultSuccess.result`, `sdk.d.ts:5807`), falling back to the last top-level text block when `result` is empty; `req.text.settle(data)` follows. An error subtype keeps the existing refusal and busy handling (`:939-949`).
- `wrapUpAnswer` (`:1634`) resumes with the same request, so a persona call that runs out of turns resumes plain too.

### The live store and the event (`src/main/persona/live.ts`)

`createPersonaLive({ emit, redact, now })` keeps one entry per `(thread, to)`: `{ agent, raw, sent, rev, timer }`.

- `begin(thread, to, agent)` before `deps.engine` (`answer.ts:399`); `sink(thread, to)` returns the `TextSink`; `snapshot(thread, to)` returns the text a Stop posts; `end(thread, to, kind)` flushes and emits `{ end: true }`.
- **What is published is what will be stored.** The published text is `redact(raw.trimStart())` (the same `redact` the forum store applies to an agent's message, `forum-core.ts` `build` `guard`, `errorlog-core.ts:37`), computed over the whole text so far, so a secret that straddles two pieces is caught once it is whole. While the call writes, the **last unfinished word is held back** (the text is cut at the last whitespace of the redacted text) so a half-written token is not shown unmasked; at `end`/`settle` everything is published. If the new published text starts with the previous one the event is an append at `offset = previous length`; if the masking rewrote earlier text, it is an event with `offset: 0` and the whole text, which the client takes as a replacement. The last event of an answer therefore equals `redact(answerText(raw)).trim()`, which is the text the post stores (acceptance 9).
- **Throttle:** the entry flushes at most every 80 ms (a timer that coalesces pieces), so a long answer is some twelve events a second and not hundreds; a flush with nothing new emits nothing.
- `emit` is `ctx.emit({ type: 'module', name: PERSONA_LIVE_EVENT, payload })` from `personaModule`, the channel the activity lines already use to reach the window and every paired browser (`index.ts:63-66`, `web.ts:373-376`); nothing in the shell's emit changes.
- **The read.** `persona:live-read(thread)` returns the `LiveAnswer[]` of that thread (empty when none). The renderer calls it when the chat mounts, on `EVENTS_RECONNECTED` (`shared/activity.ts:51`), when the window gets focus, and every 15 s while a bubble is open, so a bubble whose call died with the app (no `end` ever came) is dropped on the next read, and the failure is the failed-answer line the pipeline already writes when it can.
- **One hard guarantee:** no entry survives a restart; a post is only ever made by `answerMentions`.

### The bubble (renderer)

`chatModel.ts` keeps the pure part: `applyLive` (above), `bubbleOf(live, messages)` (a live answer shows only while no stored message has `answersTo === live.to`, so the post replaces the bubble in the render in which it arrives, on every device, with no flicker and no duplicate whichever of the message event and the `end` event comes first), `queuedOf(messages, activity)` (messages with a call line still `queued`, shown as waiting), and `composerState` (an answer is going, a message will wait its turn). The bubble is marked as being written (a caret, `aria-busy`) and carries the **Stop** button (`screenApi.stop` → `runs:callStop`, `screenApi.ts:19`; `runs:*` is open to a paired browser, `webPolicy.ts:39-46`).

### The real check, outside the suite

The Claude path is the unverified part of the spec's risks, and the tests drive a scripted `query`, so they pin the loop's reading and not the SDK's behaviour. Before commit 3 is merged, one manual run: `CERIMONIAS_DATA_DIR` and `CERIMONIAS_SPECS_DIR` on empty folders, and a throwaway script (kept outside the repository) that calls the SDK's `query` with the options a persona call would use (`permissionMode: 'dontAsk'`, isolated settings, `includePartialMessages: true`, **no** `outputFormat`, the persona system text) and a prompt that needs a tool and then a long answer. It prints, per message, `type`, `parent_tool_use_id`, the event type and delta length of each `stream_event`, the content block types of each `assistant` message, and at the `result` its `subtype`, `is_error`, the length of `result`, and whether `structured_output` is present. It answers four questions: (1) do `text_delta` events arrive in several pieces before the assistant message; (2) does a tool turn's text arrive as deltas followed by a `tool_use` block; (3) does a success result carry `result` without a structured output; (4) does a `stream_event` appear between the thinking blocks of one turn (it would, which is why `flushThought` is exempted).

**If it fails:**
- No text deltas but a good `result`: the code already degrades to `settle`; the bubble shows "writing" with no text and then the whole answer. Streaming on the Claude engine is then **not delivered**, acceptance 9's second half becomes a decision recorded in `3_IMPLEMENTATION.md` for the maintainer, and the open engine streams as specified.
- No usable `result` without a structured output (an error subtype, or an empty string): the Claude engine keeps the structured shape for the persona (`{ text }` as the other conversations, no streaming, `answerText(data.text)`), selected by one boolean on the call, and the plain-text path is the open engine's alone. That is a fallback this plan does not build unless the check forces it.
- Deltas arrive for sub-agents too (`parent_tool_use_id` set): they are ignored by the guard above; a sub-agent that is not marked would leak its text into the bubble, which the test with two interleaved sources catches.

## The home

### Screens and the one constant

`Screen` (`App.tsx:48-78`): `today` and `call` become **`chat`**, **`overview`** (with an optional `section: 'blocked' or 'asking' or 'needs'`) and **`call`** (kept); `deep.back` becomes `'chat' or 'call'` (rule 24: it remembers whether it came from the chat or the pre-daily). `home.ts` (below) exports `HOME: Screen` and every "back to Today" does `go(HOME)`. The search for them (`grep -rn "name: 'today'" src/renderer`) finds 29 sites in 22 screens: `Actions.tsx:275`, `QuickActions.tsx:137`, `Gate.tsx:160,171`, `History.tsx:77`, `Auditoria.tsx:77`, `Discussions.tsx:138,149`, `Settings.tsx:124`, `Ata.tsx:106,163`, `Ajuda.tsx:15,60`, `cycle/ForumScreen.tsx:147`, `RetroScreen.tsx:104`, `Reentry.tsx:105,112`, `Radar.tsx:150`, `Saude.tsx:48`, `cycle/RunsScreen.tsx:214`, `cycle/RunScreen.tsx:95`, `cycle/BoardScreen.tsx:391`, `memory/MemoryScreen.tsx:137`, `prompts/PromptsScreen.tsx:29,136`, `Custo.tsx:184`, `QaHandoff.tsx:83,90`, `procedures/ProceduresScreen.tsx:134`, plus `Call.tsx:277` and `App.tsx:91,136,145-146`. Because the union loses `today`, `npx tsc --noEmit` finds any that were missed.

### The pure modules (`src/renderer/src/home.ts`, DOM-free)

- `homeView({ config, setupDone, snoozed })` returns `'loading' or 'chat' or 'wizard' or 'overview'`: no config yet is loading; a persona present is the chat; none and not snoozed is the wizard (the computer and the phone alike); none and snoozed (the person chose **Not now**, kept in a module variable, never stored) is the Overview. A persona draft without a persona is "none" (it is discarded or finished from the wizard or Settings).
- `homeCounts({ cards, turns, answered, runs, actions, alerts })` returns `{ blocked, asking, actions, needs }` with exactly the formulas of `Today.tsx:51-57` (blocked is a card with blockers or a run that blocks it; asking `pendingQuestions`, `dashboard.ts:174`; actions `isPendingAction`, `:140`; needs `needsYou(...).length + waitingRuns(runs).length`). **Today and the strip call the same function**, so acceptance 8's "equal counts" is a test of one function, not of two copies.
- `ceremonyCard(plan, cycle)` returns the `AgoraPlan` (`agoraPlan`, `dashboard.ts:80`) when the card should show (phases `ready`, `live`, `ended`, or a due retro or a same-day meeting) and `null` when the cycle has no pre-daily (`on.preDaily === false`) or the cards are still loading.
- `menuRows(phone)` returns the rows of the menu: desktop the Today header's buttons (`Today.tsx:129-140`); phone the rows of the More sheet (`BottomNav.tsx:32-44`) with Actions and History added. Badges (runs waiting, unread, health) come from the hooks the More sheet already uses.
- `navigateTarget`, in `pushTarget.ts`: `targetToScreen(t, hasCards)` becomes `chat` → chat, `overview` and `today` → Overview, `call` → `hasCards ? call : chat`, `deep` with `back: 'chat'`, and the rest as they are (`pushTarget.ts:5-27`); `boardTarget`-style entries for `board`, `procedures`, `memory`.
- `bottomNavActive` (`dashboard.ts:273-296`): `NavKey` gains `chat` and loses `today` and `call`; `chat` is **not** in the table (so the chat has no bar), `overview` maps to `chat`; question 8 asks whether that is the item that should be marked.

### The chat screen

`ChatScreen.tsx`, top to bottom:

1. **Header** (`ChatHeader.tsx`): the persona's name (`agentName`, `screens/team/text.ts:10`), the date (`Today.tsx:60-62`), the test-workspace chip (`Today.tsx:126`), `UpdateBadge`, `VoiceToggle`, the jobs bell (`Today.tsx:145`, the same `cerimonias:jobs-open` event), the menu button. The menu is the row list of `menuRows`: inline buttons on a wide screen, a `Sheet` on a phone (`Sheet.tsx`, as `BottomNav.tsx` uses it), with `HeaderModuleButtons` (`moduleSlots`).
2. **Status strip** (`StatusStrip.tsx`): four buttons from `homeCounts`; blocked, asking and needs open `go({ name: 'overview', section })`, actions opens `actions`. A zero is quiet, not hidden. No model call.
3. **The thread** (`ChatThread.tsx`): stored messages as bubbles, the live bubble, the Work section above each answer, the buttons under it, the queued notice, `OfferCards` (`cycle/OfferCards.tsx:95`, so the procedure offers of a direct conversation still show). Messages of another agent that the persona called with `CallAgent` (path B posts them into this thread, `answer.ts:366-381`) show with their author's name. System lines (a failed answer, a stopped one, a held provider) appear as `Message` draws them (`Thread.tsx:92-100`). `RichText` (`Diagram.tsx:161`) renders the text and the diagrams; `MessageAttachments` the files. It keeps to the bottom while the person has not scrolled up (`Thread.tsx` `stick`, `:535-578`) and calls `markThreadSeen` (`forumApi.ts:116`). No message can be deleted from the chat.
4. **The ceremony card** pinned above the box (`ceremonyCard`, drawn with the same `AgoraCard`, `TodayParts.tsx:32`, and the same `onAgora` as the Overview, both from one hook `screens/useAgora.ts` extracted from `Today.tsx:69-101`).
5. **The box.** The `Composer` of `Thread.tsx:301` is moved to `screens/cycle/Composer.tsx` unchanged, with two props: `mentions` (default true; off here: no completion, no unknown-mention note) and `enterSends` (desktop: Enter sends and Shift plus Enter breaks the line; a phone: Enter breaks the line and the button sends, `useIsPhone`, `useIsPhone.ts:13`). Files, drop, paste, the limits and the notice are the composer's own. The box root keeps a class the dock avoids (`.composer`, `JobsDock.tsx:22`) so the floating button lifts above it.

`ChatThread.tsx` has `compact`: no header, no strip, no card, used by the wizard's test and by nothing else.

### The Overview

`Today.tsx` is renamed `Overview.tsx` (`git mv`) and keeps its content: the Agora card, the tiles, the needs-you list, `RunNeeds`, the banners, the time of the day, the activities with their filters and refresh, the four ceremonies with the squad picker, the footer. Its header (`Today.tsx:109-150`) shrinks to a back button (to `HOME`), the title **Overview** and the date; the greeting, the nav buttons, the update badge, the test chip, the voice toggle and the bell move to the chat header. `section` is applied once on mount: `blocked` and `asking` call `showFilter` (`:103-107`), `needs` scrolls to the needs list. The effect that prepares every card's turn (`Today.tsx:64-67`) moves to `App` (`useEffect(() => { if (cards) void ceremony.prepareAll(); }, [cards, ceremony.prepareAll])`), so the cost at app open is **the same as today** (question 6).

### Targets, notices, push, tray (rules 25, 26)

| Place | Change |
|---|---|
| `shared/push.ts:27` `PUSH_SCREENS` | add `chat`, `overview`, `board`, `procedures`, `memory`; `today` and `call` stay |
| `shared/push.ts:53-61` `noticeTarget` | the fallback is `overview`; `navigate` with `chat` or `overview` parses |
| `shared/types.ts:465` | `to` also accepts `'chat'` and `'overview'` |
| `renderer/pushTarget.ts:5-27`, `App.tsx:145-146` | `today` means the Overview; `call` without cards lands on the chat; `chat` and `overview` are screens |
| `renderer/jobNotify.ts:10` | the fallback of a finished job is `overview` |
| `main/scheduler.ts:127` | the pre-daily notice sends `chat` (the chat then shows the card) |
| `main/scheduler.ts:101,106,110`, `watchers.ts:293,294,331`, `feedback.ts:206`, `runner/module.ts:190` | `overview`; their wording ("click to see the activities") stays true |
| `main/webPush.ts:247` | the high-urgency list is `deep`, `conflict`, `call` and **`chat`**; `:265` the burst sends `overview` |
| `main/index.ts:131,139` | the tray's "ceremony now" keeps `call`; the `go()` union gains the two names |
| `renderer/public/sw.js:80,96` | not edited: its `today` fallback is accepted and means the Overview |

A push made before the update with `today` or `call` still opens something sensible, and a payload with an unknown `to` is dropped by `parseTarget` as it is today.

### The bar of the phone (rule 27)

`BottomNav.tsx:95-96`: the first item is **Chat** (the icon of the current "Call" item, `voiceOn ? CallIcon : ChatIcon`, `:96`) and goes to `chat`; the live dot of a running pre-daily (`callLive`) moves to it; `hasCards` no longer disables it. The second item is gone; Actions, History and More stay. The chat has no bar (its menu carries what the bar and the More sheet carry); every other screen keeps it, so its first item returns to the chat.

### Words (rule 24)

Reworded in both languages, each with an entry in `INTENDED` of `test/gitlab-catalogs-unchanged.test.ts:49-` (the test snapshots the catalogs of `main`, and a text that changes must be listed with its reason): `ui.nav.backToday`, `ui.actions.backToday`, `ui.quick.backToday`, `ui.ata.backToday`, `ui.call.backToToday`, `ui.settings.back`, `ui.help.back` become "Home" or "Back"; `ui.help.agentVoice.text` ("at the top of Today") names the chat's header; `ui.runs.empty` ("an activity on Today") names the Overview; `ui.nav.today` becomes `ui.nav.chat`. A new test reads both catalogs and fails when a `ui.*` value names the screen "Today" or "Hoje" outside an allowlist of the Overview's own keys (`ui.today.*` keys describe content: "Today's time", the date, the activities). New keys live in `ui-persona.en.json` and `ui-persona.pt-BR.json` (added to `ui.ts:25-26`) and `main.en.json`/`main.pt-BR.json` for the main process; `npm run i18n:lint` and the catalog-parity tests are the gates.

## Settings › Persona

`PersonaSection.tsx`, placed next to `TeamSettings` (`Settings.tsx:135`). It reads the persona from the configuration view (`teamApi.config`, `useConfigView`), and works the same in the window and in a paired browser (rule 38).

- **No persona:** the invitation to make one (**Make with AI**, which opens the wizard as a `panel`), and a line saying what a persona is.
- **A persona:** name, the sentence, instructions (textareas with the wizard's limits), model (the `ModelFields` of the team editor, `TeamSection.tsx:484`, exported, over an `AgentDraft` of the persona), **Save**, **Adjust with AI**, **Clear conversation**, **Delete**, and **Open the chat** (a link to `chat`, which makes the chat reachable from commit 8 and not only by a target). Save goes through `persona:save` (below). Clear and Delete use `Confirm` (`team/ui.tsx:87`) with a body that names what goes (the conversation, its files and its memory folder; for Delete also the persona).
- **A persona draft left by a closed app** (rule 12): shown here with a **Discard** button, as the creator's drafts are in the Team list (`TeamSection.tsx:162-179`), and never in the Team list itself.
- Two more channels, both in `personaModule`: `persona:save` takes `{ name, job, instructions, model }`, builds `updateAgent(config, id, ...)`, and, when `callOrigin()` is `web` (`rpc.ts:20`), refuses it if `refusedPaths(before, after)` is not empty (so a phone cannot add a fallback model, `configScope.ts:107-121`); then `saveConfig` and the audit. `persona:clear` and `persona:delete` refuse while an answer is going in the thread (`callStops.running(thread)`, `mentions/stop.ts:35`) with a worded error, and otherwise do what `concludeAssistDraft` and `discardAssistDraft` do for a draft (`deleteAgentThread`: files, memory folder `memory/store.ts:603`, the thread; `ensureAgentThread` again for Clear; `removeAgent` first for Delete). A draft copy goes with Delete.
- The Team list filters the persona out (`TeamSection.tsx:145`), **Create with AI** (`:137`) stays the creator's, and the persona is not in what the creator is told about (class A).

## Paired phone

- **The channels.** `webPolicy.ts` names `PERSONA_CHANNELS` (exported, like `MEMORY_CHANNELS` `:93`): `persona:round`, `persona:review`, `persona:saveDraft`, `persona:conclude`, `persona:discard`, `persona:finish`, `persona:save`, `persona:clear`, `persona:delete`, `persona:live-read`. They are `allow`, in neither `DESKTOP_ONLY` nor `EXTERNAL_EFFECT`, with or without the external-effects switch, and a pattern `PERSONA_UNLISTED = /^persona:(?!(…)$)/` joins the `deny` list in `webAccess` (`:100-105`), so a channel added later under `persona:` is closed from the day it exists until somebody classifies it (question 7). The creator's `agentAssist:` pattern (`:74`) is not touched. `test/persona-policy.test.ts` reads `src/main` for every `persona:` channel a module registers and fails for one that is not classified (the scan `test/memory-policy.test.ts:57-62` does for the memory).
- **The configuration route.** `config:cycle-save` already admits the persona entry as part of `agents.team` (`configScope.ts:18`); `raisedPermissions` (`:70-87`) refuses a raise of `shell`, `tracker`, `screen`, hosts or browser profile, and treats a new agent as `none` for both, which is why the wizard builds the entry in the main process. A test pins both sides: a changed instruction text of the persona is accepted; a `tracker` raise on it, or a persona made through this route with `tracker: 'read'`, is refused.
- **Origin.** Every change (`finish`, `save`, `clear`, `delete`) records an audit entry with `callOrigin()` (`rpc.ts:20`): a new kind `persona` in `AuditKind` (`shared/auditoria.ts:1`), `target: 'persona:<op>'`, `via: 'window'` or `'paired'`, `fields: { agent }` and never a text, written by `recordWrite` (`auditoria.ts:24`); `Auditoria.tsx:15-32` gets its label (`ui.audit.kind.persona`, both languages).
- **The live read** is a read: open, with no effect.
- **The chat** uses `forum:*` (open, `webPolicy.ts:26-31`) and `runs:callStop`, nothing else.

## Ceremonies untouched (rule 23)

`useCeremony` stays in `App` (`App.tsx:88`) with its restore, its debounced save (`ceremony.ts:150-154`) and the reset when a day is deleted; the only change is that `prepareAll` runs from `App`. `Call`, `Deep`, `Gate`, `QaHandoff`, `RetroScreen`, `Reentry`, `Discussions`, `Conflict`, `Ata` keep their code; their back goes to `HOME` (or, for Deep, to the `back` it holds), and their labels are the reworded ones. The pre-daily is still held in `Call` (Q7 of the spec, settled): the chat's card, the menu, the Overview and the persona's button all lead to it.

## Order of the work: commits

Every commit leaves `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` and `node scripts/public-audit.mjs` green. `feat:` or `fix:`, lowercase, imperative, no trailing period; the identity by `git -c user.name=… -c user.email=…` only; no attribution trailer. **The home switch is the last code commit**: nothing before it changes what the person sees when the app opens, except that Settings gains a Persona section.

0. `feat: add the plan of the persona and its chat` (this file alone, after the spec).
1. `feat: add the persona kind to the agent team and the configuration` (**rebased on #246 first**): `AgentKind`, `kind`, `isPersona`, `outOfCycle`, `personaOf`, `personaDraftOf`, `withoutPersona`, `newAgent`; schema 30, `v29ToV30`, `schema.ts`, validation, the `repair` branch; `docs/configuration.md`; tests of the number, the validation, the migration, the repair. Nothing reads the kind yet.
2. `feat: keep the persona out of the cycle, the templates and the export` (classes A and B, the guard test, `transfer.ts`, `config-transfer.ts`, `apply.ts`, `forum.ts` hidden thread, the creator's refusals, the Team list). Nothing makes a persona yet.
3. `feat: let a call answer in plain text and stream what it writes in both engines` (`TextSink`, optional schema, `loop.ts` events, `runOpenEngine`, `runClaudeSdk` with partial messages and the `flushThought` exemption, `live.ts`, `shared/persona.ts`); the manual check of the Claude path is done before this commit is merged.
4. `feat: answer the persona's messages as streamed plain text with the work and the buttons behind them` (`answerMentions` branch, `mentionCall`, the persona prompts of the answer, `answersTo`/`buttons` in the store, `OpenScreen`, `personaModule` with `persona:live-read`, `PERSONA_CHANNELS` and the pattern, the `quiet` posts, the push vocabulary of `chat`, `overview`, `board`, `procedures`, `memory`). Testable from the main process with a persona in a test config.
5. `feat: add the persona wizard to the main process` (`assist.ts`, `assistCore.ts`, the prompts, `persona:round|review|saveDraft|conclude|discard|finish|save|clear|delete`, the audit kind, `custo-core` and `retention-core` entries).
6. `feat: add the chat view, the wizard and the persona section of the settings` (renderer: `chatModel.ts`, `liveApi.ts`, `ChatThread`, `ChatMessage`, `Composer` moved out of `Thread.tsx`, `ActivityItems`, `PersonaWizard`, `personaWizard.ts`, `PersonaSection`, the `ui-persona` catalogs). Reachable only from Settings.
7. `feat: rename Today to the Overview and send every back to one home constant` (mechanical: the union, `HOME = overview`, 30 sites, `targetToScreen`, the `overview` and `chat` names in the vocabulary, `bottomNavActive`; behaviour is unchanged because `HOME` is still the Overview).
8. `feat: add the chat screen with its header, strip, ceremony card and menu` (`home.ts`, `useAgora.ts`, `ChatScreen`, `ChatHeader`, `StatusStrip`, the route `chat`, reachable by a target and by Settings; the Overview header trimmed behind the flip).
9. `feat: open the app on the chat with the persona, or on the wizard when there is none` (`HOME = chat`, `homeView`, the invitation and **Not now**, the bar, the notices and push urgency, the tray types, the reworded labels and the `INTENDED` entries, `prepareAll` in `App`, the update busy flag).
10. `feat: document the persona and its chat` (`docs/persona.md`, `docs/README.md`, `docs/cycles.md`, `docs/configuration.md` text beyond the number, `README.md`, `README.pt-BR.md`, the `CHANGELOG.md` entry under `## [Unreleased]`: the app opens on a chat with a persona, Today's content is the Overview, the pre-daily notice opens the chat, the ceremonies are unchanged, schema 30 and no going back).

Commits 3 and 4 touch the same engine and mention files; each is rebased onto the release branch before it is pushed and the schema number of commit 1 is looked at again then.

## Test plan

No test reaches a model, a code host or the network; the fakes are in `test/helpers/` (`fakeOpenAI.ts`: `textStep(text, { pieces })` streams a text in the pieces asked, `toolStep(calls, { text })` carries narration; the SDK tests replace `query`, `agent-activity-sdk.test.ts:7-19`). Anything exploratory runs with `CERIMONIAS_DATA_DIR` and `CERIMONIAS_SPECS_DIR` on empty folders, which `test/setup.ts` already gives each file. **vitest runs in node (`vitest.config.ts:12`) and nothing renders a `.tsx` file**, so every decision above the markup lives in a DOM-free module and is tested as a plain function: `shared/persona.ts`, `chatModel.ts`, `home.ts`, `personaWizard.ts`, `pushTarget.ts`, `dashboard.ts`, `assistEdit.ts`.

**New files**

| File | Holds |
|---|---|
| `test/persona-config.test.ts` | The kind: accepted by the schema, a non-persona value refused by path, absent is an ordinary agent, the JSON Schema carries the field (acceptance 20). Validation: a second persona, a second draft copy, and a persona with stages, squad, `turnsTo`, `autonomous` or `system` fail with errors at `agents.team[i].kind` and nothing else; a persona with `tracker: 'read'`, `shell: 'sandbox'` and `permission: 'worktree'` passes (rule 3 constrains none of them). Migration `v29ToV30` (named for the number at the time): a v29 file bumps with only the version changed, a second start changes nothing, a document with a persona survives, a v31 is refused. Repair: a stored persona with stages loads as an ordinary agent, the team is intact, the note names `agents.team[i].kind`. |
| `test/persona-team-readers.test.ts` | Builds one team with an ordinary agent, a system agent, a draft, the persona and a persona draft, and walks the readers: `workingTeam`, `stageAgent` (a stage whose `agentId` names the persona returns none), `membersOf`, `effectiveTeam`, the squad liaison and `turnsTo` choices, `recommendations`, `offeredStages`, `checkFlow`, `checkSquads`, `mentionableIds` (no persona, not even in its own thread), `chatAgents`, `mentionChoices`, `templateFromConfig`, `mergeTemplateTeam` with a template that brings a persona, `assistContext`, `adjustable`. Then the **source scan** of class D: the files that call `isDraft(`, `outOfCycle(` or `workingTeam(` equal the listed ones. Acceptance 5 and 6. |
| `test/persona-transfer.test.ts` | `buildExport` has no persona and no persona draft; `parseImport` strips one with a warning; `applyImport` over an existing workspace keeps its persona entry and over a new one has none; `previewImport` does not list the persona as removed (Q11). |
| `test/persona-live.test.ts` | The live store with a fake clock and emitter: pieces coalesce at 80 ms; the first event has `offset: 0`; appends carry the previous length; a secret split across two pieces is never published; the last unfinished word is held back and released at the end; a rewrite by the masking is an `offset: 0` event; a restart empties; `end` flushes; the last published text equals `redact(answerText(raw)).trim()`. `applyLive`: in-order apply, duplicate ignored, gap and offset past the end ask for a resync, `end` drops. The read returns the text so far, empty after `end`. |
| `test/persona-stream-open.test.ts` | Open engine through `askAgent`/`runAgent` against `fakeOpenAI`, with a `TextSink` spy: `textStep(text, { pieces: 5 })` gives five pieces in order and `settle` with the whole; a `toolStep` with text and a call gives `restart` and the narration as an `onInterim` line, and the next turn's pieces start again; a pool switch after some pieces restarts; a sub-agent's pieces and restarts never reach the sink (three parallel sub-agents, as `activity-subagents.test.ts` does); a call with no schema returns the text as `data`; a call with a schema is unchanged. |
| `test/persona-stream-sdk.test.ts` | The scripted `query`: `stream_event` deltas (`message_start`, `content_block_delta` with `text_delta`) produce pieces in order; a top-level `tool_use` block restarts; a sub-agent's `stream_event` (`parent_tool_use_id` set) is ignored; thinking blocks of one turn with `stream_event`s between them are still **one** thought line; a success `result` with `result` and no `structured_output` returns it as `data`; an empty `result` falls back to the last text block; an error subtype keeps the failure and busy paths; `includePartialMessages` is set only when a sink is given and `outputFormat` only when a schema is; a script with no `stream_event` at all gives one `settle` (the degradation). |
| `test/persona-mentions.test.ts` | Over the real `answerMentions` and `fakeOpenAI` in a persona's thread: the call has no schema and no `proposals`; the answer is posted once, plain Markdown as written, with `answersTo` = the message and `buttons`; another agent's direct conversation still answers structured and proposes (acceptance 14); a message with `@name` posts no system line and no mention; queued messages: the second waits (`queued`), is answered after, with its own `answersTo`; Stop with text posts the partial and the `stoppedPartial` line and the next message is answered; Stop with no text posts only a stopped line; a failure posts the failure line and no text and `live.end`; the post arrives while the live entry exists and the bubble rule drops the bubble (`bubbleOf`); a draft persona's call is offered no `OpenScreen`; `CallAgent` from the persona hangs the callee under its node (`buildTree`). |
| `test/persona-open-screen.test.ts` | `OpenScreen`: a target that fails `parseTarget` is refused; `call` when the cycle has no pre-daily is refused with the reason and no button; `deep`/`gate`/`qa` for a card that is not loaded are refused; `run` and `conflict` ids that do not exist are refused; at most four buttons, deduplicated; the buttons come out in the post and survive a read of the thread file; the store drops a stored button that does not parse; a button's target passes `parseTarget` (acceptance 15). |
| `test/persona-assist-prompts.test.ts` | Modelled on `agent-assist-prompts.test.ts:1-60`: every `persona.*` text renders in both languages with nothing left over; the round prompt lists the four themes in the workspace's language; the review prompt contains the four English headings in order; nothing about stages, squads, agents, sandbox, tools or settings is told; the person's text is fenced in `<data>`; the sections reused from the creator render. Acceptance 2. |
| `test/persona-assist-module.test.ts` | The channels over a test config and a fake `askBare`: at most four rounds; an out-of-shape answer keeps the valid questions; `saveDraft` produces `kind: 'persona'`, `draft: true`, no stage, no squad, `autonomous: false`, `turnsTo: null`, the access of `personaAccess()`, and `agent-<id>`; a second `saveDraft` reuses the draft; create is refused when a persona exists; `finish` (create) removes the draft mark, empties the conversation and leaves `tracker: 'read'`, `shell: 'none'`; `finish` (adjust) copies three texts onto the original and removes the draft; `discard` refuses an ordinary agent and the creator's `agentAssist:discard` refuses a persona draft; `clear` empties the thread, its files and its memory folder and keeps the persona; `delete` removes both; both refuse while an answer is going; `save` from `web` refuses an added fallback model; each change records an audit entry with `window` or `paired`. Acceptance 3, 4, 22. |
| `test/persona-policy.test.ts` | Modelled on `memory-policy.test.ts`: every channel of `PERSONA_CHANNELS` is `allow` with and without the external-effects switch and in neither `DESKTOP_ONLY` nor `EXTERNAL_EFFECT`; `persona:made-up`, `persona:`, `persona:round2` are denied; `runs:persona`, `forum:persona:x` are not mistaken; the scan of `src/main` for registered `persona:` channels equals the set; `agentAssist:*` is still denied; `config:cycle-save` accepts a changed persona text and refuses a raise on it; `webAccess('forum:post')` and `('runs:callStop')` are `allow` (acceptance 21). |
| `test/persona-wizard-state.test.ts` | `personaWizard.ts`: the steps, rounds and limits (at most 4 rounds, `roundsLeft`), `hasProgress`, `toPersonaInput` cuts to the limits and carries no settings, `withPersonaReview`, adjusting carries the original's form and keeps its id, closing discards. |
| `test/chat-model.test.ts` | `chatModel.ts`: `bubbleOf` (live shows until the stored answer with `answersTo` arrives, whichever of the two events comes first), `queuedOf`, `workOf` (two answers have two sections, each with its own lines, the root's `answer` line left out), `workSummary` (duration and steps), `buttonLabel` for each target in both languages, and the composer state (answer going, message will wait). Acceptance 12, 13. |
| `test/home-model.test.ts` | `home.ts`: `homeView` (loading, chat with a persona, wizard with none, Not now gives the Overview, a persona draft alone is "none"); `homeCounts` **equals the counts the Overview derives for the same data** (the formulas are one function); `ceremonyCard` (hidden without a pre-daily, shown for ready, live and ended); `menuRows(false)` equals the buttons of the old Today header and `menuRows(true)` the More sheet rows plus Actions and History (acceptance 7, 8, 18). |
| `test/push-targets.test.ts` | `parseTarget` accepts `chat`, `overview`, `today`, `call`, `board`, `procedures`, `memory` and still rejects an unknown name, a `deep` without `ref`; `targetToScreen`: `today` is the Overview, `call` the pre-daily or, without cards, the chat, `chat` the chat, `deep` has `back: 'chat'`; `noticeTarget`'s fallback is `overview`; `targetFromSearch` of `?open=today` and `?open=call` still opens something; the urgency of a `chat` target is high (acceptance 17). |
| `test/catalog-screen-names.test.ts` | No `ui.*` value in either language names the screen "Today" or "Hoje" outside the allowlist of the Overview's own content keys; every key of the persona catalogs exists in both languages (acceptance 24). |

**Existing files that change**

- `test/config-migrations.test.ts:868-935`: the "newest step" test moves to 30 and 31; the new `describe` follows. `test/config-schema.test.ts` next to `:312` (the `kind` case beside the `draft` one). `test/docs-schema-version.test.ts` needs no edit.
- `test/forum-store.test.ts`: `answersTo` and `buttons` are stored, read back, validated by the schema, dropped when invalid; a line without them reads as before. `test/forum-policy.test.ts`, `test/forum-mentions*.test.ts`: `mentionableIds` for the persona's thread; the `quiet` posts.
- `test/mentions-agent-chat.test.ts:101-186`, `mentions-module.test.ts`, `mentions-stop.test.ts`: the cases for any other agent stay as they are and are the proof that nothing moved for them.
- `test/web-push.test.ts:146-152`: the fallback is `overview` and the high-urgency list includes `chat`. `test/run-notices.test.ts` for the `overview` targets.
- `test/dashboard.test.ts`: `bottomNavActive` (`chat` has no bar, `overview` marks the chat item), `agoraPlan` unchanged.
- `test/agent-assist-*.test.ts`: the creator refuses a persona (`adjustable`, `draftOf`); its policy test stays (`agentAssist:` still denied).
- `test/gitlab-catalogs-unchanged.test.ts`: the `INTENDED` entries for the reworded keys.
- `test/agent-activity-sdk.test.ts` and `agent-activity-open.test.ts`: the leak tests are unchanged and run as the proof that the thought join and the sub-agent routing still hold.
- Goldens: **none regenerated.** No prompt of any existing agent changes (the persona's texts are new keys, and `runner.mention.system`/`main` are untouched), so `test/prompts-screen.test.ts` and the `en-prompts`, `legacy-prompts` and `same-day-prompts` goldens run unchanged as the proof.

## Risks and what was assumed and not verified

Nothing was executed in this stage: no test was run and no behaviour was seen. The lines were read; the design is a reading of them.

1. **The schema number.** 30 assumes #246 lands first with `v28 -> v29`. Looked at again at the rebase before commit 1, and at every rebase after it. If #246 takes another shape, the fallback (`v28ToV29`) is in the Configuration section.
2. **The Claude path.** Everything about partial messages is read in `sdk.d.ts` only (`includePartialMessages` `:1863`, `SDKPartialAssistantMessage` `:5507`, `SDKResultSuccess.result`). That `text_delta` events arrive for a call with no `outputFormat`, that a success result is returned without a structured output, and that `parent_tool_use_id` is null on the top level are what the manual check decides. The tests pin the loop's reading of scripted messages, not the SDK. The degraded behaviours are written above.
3. **`redact` over a growing text.** It runs on at most the 20,000 characters a message holds (`MAX_TEXT`), up to a dozen times a second per live answer. Not measured; the 80 ms throttle is the bound. A pattern that rewrites earlier text (a long opaque string that becomes 32 characters long) makes one `offset: 0` event, shown as a replacement.
4. **`answerText` and a model that writes a JSON object** (`answer.ts:502-512`). A plain-text persona that answers with `{"text": "..."}` is unwrapped at the post, so the last live text differs from the stored one by the braces. Rare and cosmetic; the post replaces the bubble anyway.
5. **A flat model that does not stream.** A server that returns one JSON message shows no pieces; `settle` shows the text once. Nothing is lost.
6. **Concurrent wizards.** Two devices running the wizard at once share the single persona draft (validation allows one), so the second `saveDraft` updates the first's. Accepted: one persona per workspace; the draft is a scratch copy.
7. **A repaired persona becomes an ordinary agent.** If a hand-edited file breaks the persona's rules, load drops `kind` and the entry becomes an ordinary agent with whatever it had (inert when it had no stage). The person sees the note. The alternative (wiping the team) was worse.
8. **The persona's thread is hidden from the Forum list**, so a person who finds it by its id in the URL of the forum screen reads it as any thread. Not a leak (the phone reads it by design); noted because "the home is its one door" is a layout choice, not a lock.
9. **No Work section after a restart** (rule 35) and a limit of 60 trees in the main log (`maxRuns`): a long day of chat ages the oldest sections out of memory. Said by the absence of the section, not by an error.
10. **The dock's floating button over the box.** `useFabLift` (`JobsDock.tsx:31-67`) lifts it above elements matching `.composer` (`:22`). The chat's box carries that class, but it was not seen on a phone-sized screen; the Thread's own composer is `cy-composer`, which does not match, so it is not a precedent.
11. **The size of commit 9.** The flip touches the app shell, the bar, the notices and the ten reworded labels at once. It is last and kept to the switch; the screens it flips to are reachable and tested before it (commits 6 to 8).
12. **`prepareAll` at app open.** Moving the effect to `App` keeps today's cost (it ran when Today appeared, which was at open). If the chat should not pay for it, the preparation could wait for the first time the pre-daily or the Overview is shown; that is question 6.
13. **The messages of other agents in the persona's thread.** `CallAgent` posts the topic and the callee's answer into the same thread (`answer.ts:366-381`), so the chat shows other authors; the layout of that was not designed beyond "the author's name above the bubble".
14. **Hidden unread.** The persona's thread is not in the Forum list, so it has no unread badge; an answer that finishes while the person is on another screen shows only in the jobs dock while it works and in the chat when they return (question 3).
15. **Tests that read source.** The class D scan and the policy scan read `src/` by regular expression; a refactor that changes how a reader is written could slip past until the next review. They are as strong as the memory's.
16. **Old messages in a new app.** Messages written before the update have no `answersTo`; the chat shows them as plain bubbles with no Work section.
17. **Personal text in session files.** The persona's instructions are part of every prompt, so they sit in the open engine's session file (`open-sessions/`, in the workspace's data) and, on the Claude engine, in the transcript the SDK writes in the person's own Claude folder. The retention sweeps only sessions whose opening is an app prompt (`retention-core.ts:99-101`), and a conversation answer opens with `runner.mention.main`, which is not one, so these transcripts are never swept: the same as every other agent's conversation today. The plan adds no copy (the session index, the error log and the usage records hold none, see the export section) and does not change the sweep; whether the persona's sessions should be swept is question 12.

## Questions for the maintainer

Approved at gate 2 (2026-10-10): every question below is settled with the default the plan follows. The real Claude SDK checks are to be run.

None blocks the first commits. Each has a default the plan already follows; changing one is small.

1. **The persona's inherited tools.** The spec calls `OpenScreen` "the only tool of the persona in this issue", while every conversation answer already has `CallAgent`, the procedure tools and the shared memory's. *Default: the persona keeps those (they are not new, rule 16 names the memory and the procedures, and the Work section of rule 34 names the agents it called); `OpenScreen` is its only new tool.* If the persona must have no `CallAgent` before #248, it is one line (`conversationCallTool` skipped for a persona).
2. **The vocabulary.** The spec adds `chat` and `overview`; "show me the board" needs `board`, and the menu lists `procedures` and `memory`. *Default: add `board`, `procedures` and `memory` to `PUSH_SCREENS` too (plain screens with no argument; they become valid notification and URL targets as a side effect).* The alternative is a persona-only list of targets beside `PUSH_SCREENS`.
3. **An answer while the person is elsewhere.** The thread is hidden from the Forum, so no badge says "the persona answered". *Default: none; the dock shows the work while it goes, and the chat is where the answer waits.* A badge on the menu or the bar's Chat item is a later addition.
4. **Clear and Delete during an answer.** *Default: refused with a worded error until the answer ends or is stopped.* The alternative is to stop the answer and then clear.
5. **The line on Stop.** *Default: one new line (`runner.mention.stoppedPartial`) after the partial post, in place of `runner.mention.stopped`.* The alternative is two lines, the existing partial note (which says "ran out of steps") and the stopped one.
6. **Preparing every card's turn.** *Default: as today, at app open, now from `App`.* The alternative defers it to the first time the pre-daily or the Overview is shown, which saves the cost when the person only chats; it is a product choice (the spec's risk).
7. **A pattern for unlisted `persona:` channels.** *Default: deny, like the memory (`webPolicy.ts:94`), so a channel added by #248 to #251 is closed until classified.* The alternative is the open default of an unlisted channel.
8. **The marked item of the bar on the Overview.** *Default: the first item (Chat) is marked on the Overview, as Today marked its own.* The alternative is no item marked.
9. **The editor's limits.** *Default: the creator's (name 80, sentence 1000, instructions 4000).* A persona that describes a person may want more.
10. **The persona out of the export.** *Default: left out of the export, stripped from an import, kept on the target of an import (Q11 of the spec asked for this to be settled here).* The alternative is to export it behind a warning.
11. **The wizard on the phone with no persona.** *Default: the same wizard as the computer (rules 38 and 21), with **Not now** to the Overview.* This replaces the spec's "note" for the phone.
12. **Sweeping the persona's sessions.** The transcripts of the persona's chat hold personal text and are not swept by the retention, like every other conversation's. *Default: no change (the sweep stays as it is).* The alternative is to add the persona's opening to the sweep, which would delete the transcripts of a conversation the person may want to continue.

## Decision log

| # | Decision | Alternative rejected, and why |
|---|---|---|
| 1 | One predicate `outOfCycle` inside `workingTeam`, `stageAgent` and the direct readers, a walk test and a source scan | Editing the ~30 call sites to test `isPersona` (a new reader would forget it); only the walk test (it covers readers that exist, not the next one) |
| 2 | All persona validation errors are at `agents.team[i].kind`, and `repair` drops that field alone | Errors at the offending field (the repair would reset the whole team to the defaults); a tolerant validation that only warns (acceptance 5 says it fails) |
| 3 | The persona and its test copy are two entries of kind persona, one real and one draft | A separate "persona draft" store (a second place to find, delete and clean); copying the test into the original in place (it would change what the person uses before they save, rule 11) |
| 4 | `answersTo` and `buttons` as optional fields of the stored message | `replyTo` (the store keeps it only for `answer` messages, `forum-core.ts:341`, and the thread shows "reply to n"); a side file (a second thing to keep in step with deletes and clears) |
| 5 | Buttons are targets and the app words them from the target | A model-written label (a label that says one thing while the target opens another; a second language problem) |
| 6 | Plain text for the persona, one `TextSink` fed by both engines | Taking `text` out of a streamed JSON object (three times, and it breaks on any model that writes the object badly, Q3 of the spec) |
| 7 | The sub-agent never inherits `onPiece`, `onTurnEnd`, `onRestart` | Filtering by depth in the sink (the sink would need to know the loop); inheriting and clearing in `openSubAgent` (a handle per kind) |
| 8 | The live text is `redact` over the whole text so far, last word held back, with a replacing event when the masking rewrites | Masking each piece (a secret split over two pieces is shown); streaming raw and masking at the post (the bubble and the stored text would differ, against rule 29) |
| 9 | Events carry `rev` and `offset`, and a read resynchronises | Sending the whole text on every event (hundreds of kilobytes a second on a long answer); trusting the stream (a dropped event corrupts the bubble) |
| 10 | The bubble disappears because a stored answer with `answersTo` arrives, whichever event is first | Removing it on `end` (a flicker or a gap between the two events); posting from the live store (the live text would become a message of its own, rule 30 forbids it) |
| 11 | On the Claude engine the success result with no structured output returns `result`; no deltas degrades to `settle` | Keeping `outputFormat` with `{ text }` for the persona on Claude (no streaming at all there); built only if the manual check forces it |
| 12 | `flushThought` is exempt for `stream_event` | Leaving it (one turn's thinking would split into several lines the moment partial messages are on) |
| 13 | The wizard has its own `persona:` channels, open to a paired browser, with a pattern that denies unlisted ones | Extending `agentAssist:` (it is a pattern that denies a browser, and the gate decided the opposite for the persona); an open default (a later channel would be open by accident) |
| 14 | Starting access is set by the main process from the texts alone | Taking settings from the screen or the model (a phone could not make the persona, since `tracker: 'read'` on a new agent is a raise, and a model must never decide access) |
| 15 | The editor's Save is `persona:save` (audited, the scope check when it came from the web) | Saving through `config:cycle-save` (works, but records nothing about the origin, which rule 38 asks); a desktop-only Save (rule 38) |
| 16 | The persona stays out of the export, is stripped from an import and kept on the target | Exporting it with a warning (the file is the thing people share); letting an import erase the target's persona (it would destroy something the person wrote about themselves) |
| 17 | The `quiet` flag on the person's post in the persona's thread | Letting the "unknown mention" system line appear (rule 15: `@name` stays plain text) |
| 18 | `HOME` is a constant; Today is renamed before the home flips, and the chat route exists before it is the home | One commit that renames, adds the chat and flips (not reviewable, not bisectable) |
| 19 | The strip and the Overview call one `homeCounts` | Two copies of the formulas (acceptance 8 would be a test of two things that can drift) |
| 20 | The Work section is found by `call.message` and the stored answer by `answersTo` | A second link kept in memory (lost at restart) |
| 21 | Update busy is reported by the window from the live store | A main-process check of `callStops` (it would also hold the update for every other agent's answer, which the spec does not ask) |
| 22 | New catalogs `ui-persona.*.json`; reworded keys listed in `INTENDED` | Renaming the keys (the snapshot test would see a removed key and the old wording together) |
| 23 | The prompts' sections are reused from the creator; its `context` is not | A copy of every section under `persona.*` (twelve texts to keep in step); telling the model the stages and agents (rule 10: it proposes no settings) |
| 24 | `sw.js` is not edited | Changing the service worker's fallback (a new cache version for a name that is still accepted) |
