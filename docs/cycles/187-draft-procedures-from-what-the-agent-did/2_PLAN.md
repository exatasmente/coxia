# Draft procedures from what the agent did, and offer to keep them: technical plan

Plan for `1_SPEC.md` (gates waived by the maintainer, 2026-10-09; the implementation follows this plan directly). Base `release/0.9.0` at `fcb0e76c`, schema 23, run format 6. Every `file:line` was read on this tree on 2026-10-09; nothing was run. Rule numbers ("rule 9") are the spec's. The first commit of the branch is this plan and the spec alone.

## 1. What is built, and where

| Piece | Where it lands |
|---|---|
| Per-field validator for drafted text (`acceptsText`) | `src/main/procedures/record.ts` (export beside `checkContent`, `:260`; wraps the private `text()` at `:156`) |
| Command draft, pure (`buildCommandDraft`, `ExecEntry`) | new `src/main/procedures/commands.ts` |
| `DraftStep.run?`; `c-N` drafts; `procedures_draft` for a shell-only call; `procedures_save` of `repo` or `tool` from a `c-N` draft | `draft.ts:15`, `session.ts:207,256,353` (generalise `fromDraft`; drop the "gui only" refusal at `:273` for command drafts), `tools.ts` (descriptions, schema), `engineTool.ts` (no change: it reads `procedureToolSpecs`) |
| Which commands a call has | `OpenContext.commands` in `port.ts:11-31`, passed to `SessionContext`; `executor.ts:786` and `mentions/answer.ts:242` |
| Whole-screen draft: `markOf`/`mark` on the screen session; window and `advance` in the adapter | `browser/sessions.ts:137,175,663`, `procedures/screen.ts:52-62`, `session.ts` (`getTool`, `saveTool`, `draftTool`) |
| Offer evaluation and registered drafts (`plan`, `settle`, `saved`, `followed`) | `session.ts` |
| One-turn call with only the procedure tools (`AgentCall.procedureOnly`) | `agents.ts:1255` (`runAgent`), modelled on `wrapUpAnswer` (`:1328`) |
| The wrap-up runner and its prompt | new `src/main/procedures/wrapup.ts`; prompt texts `prompt.sdd.runner.procedures.turn.*` in `src/shared/i18n/main.en.json` and `main.pt-BR.json` |
| Offers (memory), channels, event | new `src/main/procedures/offers.ts`; `index.ts` (singleton); `module.ts` (three channels, event) |
| Card, hook, API, strings | new `src/renderer/src/screens/cycle/OfferCards.tsx`; `Thread.tsx:590` mounts it; `screens/procedures/proceduresApi.ts`; `ui-procedures.en.json` and `.pt-BR.json`; `cycle.css` |
| Thread lines | `main.forum.code.runner.procedures.{wrapUp,offered,offerKept,offerDeclined}` (both catalogs) |
| Audit ops `offer`, `decline` | `procedures/audit.ts:9-24` |
| `createdBy` on a save | `store.ts:44-62,279` (`SaveRequest.createdBy`) |
| Docs, changelog | `docs/procedures.md` (both languages), `CHANGELOG.md` under `[Unreleased]` |

## 2. Data

- **No record field, run field or config field** (rule 19). `ProcedureRecord`, `StageRecord` and the config keep their shapes; the stage's wrap-up tokens go into the `usage` callback `executeStage` already receives (`executor.ts:576`), which the service sums per attempt.
- New types (memory only): `ExecEntry { n, command, exitCode, timedOut, refused? }`; `CommandDraft { steps: {n,text,run}[], pitfalls, failed, leftOut, trial, programs }`; `OfferDraft { id, kind, key, title, steps, pitfalls, waits, leftOut, handoff, stepsFrom, keyedBy?, upTo?, screen? }`; `Offer extends OfferDraft { offerId ('o-'+8 hex), thread, stage?, agent, writer, usage, at }`; `OfferView` (what the card gets: no `usage`, no `writer.ref`) in `src/shared/proceduresView.ts`.
- New parameters: `SaveRequest.createdBy?`, `OpenContext.commands?`, `AgentCall.procedureOnly?`, `ScreenSessions.markOf/mark`, `ProcedureScreen.lastStep()/advance()`.
- Constants (code, not config): `OFFER_MIN_SCREEN_STEPS = 5`, `WRAPUP_MAX_TURNS = 3`, `WRAPUP_MS = 120_000`, `OFFER_TTL_MS = 24h`, `OFFER_MAX_PENDING = 10`, `CLOSING_WORDS_MAX = 600`.

## 3. Configuration and migration

None. `CONFIG_SCHEMA_VERSION` stays 23 (`src/shared/config/types.ts:5`); no step in `STEPS`; the run format stays 6. `runner.procedures` is the only switch and is read through `ProceduresPort.open` (`port.ts:65-67`); `runner.*` is already outside what a paired browser edits. A test pins "no new step, schema 23" so a later field is a conscious change.

## 4. Flow and prompts

**Command draft** (`buildCommandDraft(entries, { mask, typedIn, home, repos })`), in this order, per rules 1-6: drop `refused`, never-run (`exitCode` null and not timed out); normalise (collapse whitespace, strip a leading `cd <path> &&`, strip env assignments and `env`); left out and counted: multi-line, `export set unset source .`, carriers (a fixed list of regexes in `commands.ts`: secret-file names, auth words, credentials in a URL, `<<`, payload flags of `curl wget http`), over 200 characters, a changed `mask(cmd)`, `typedIn(cmd)`; silent noise (a `Set` of programs plus read-only `git` subcommands, tested on the first program of the first segment); classify success/failure; apply the supersede rule per program; last occurrence wins for a repeated success; build `text` and `run`; run `acceptsText` on every `text`, `run` and pitfall (a refusal counts as left out); `trial` = a failure with a later success of its program and at least one step.

**Whole screen.** `ProcedureScreen.steps()` = log entries with `n > sessions.markOf(key)`; `visited()` over all entries; `lastStep()` = highest `n`; `advance(n)` = `sessions.mark(key, max(n, markOf))`. `draftTool` stores `upTo = lastStep()` in its draft entry. `saveTool` calls `advance(d.upTo)` after a successful `gui` save. `getTool` calls `advance(lastStep())` when the record is `gui` and its key is in `visited()`. The call-level `mark` const at `screen.ts:52` goes away.

**Draft tool.** `procedures_draft` returns the screen draft (`d-N`, existing text) and/or the command draft (`c-N`: steps as `n. text` with the `run` on the next line, pitfall candidates, "K commands were left out for safety", the key suggestion), and registers them. `procedures_save` with `draft: 'c-N'`: `kind` is `repo` or `tool`, `key` is validated as for any save, `steps` are `{n}` or `{n,text}` over the draft (the existing "may hold only n and text" refusal keeps `run` out of the agent's hands), `stepsFrom` is `recording` or `edited`. The tool texts say `c-N` exists only when the call has a shell, and the screen part only when it has the browser. `ProcedureSession` gets `has: { screen, commands }`; prompts use it: `proceduresGui` stays for the screen, a new `proceduresCmd` input (`StageInput`, `MentionInput`) adds a sentence for the command draft (`prompt.sdd.runner.rules.proceduresCmd`, both catalogs).

**Offer.** `session.plan({ words })` returns null unless `!created && !replaced && !read` and a threshold holds; otherwise it registers the drafts and returns `{ text, settle }`: `text` is the prompt body (drafts fenced as data); `settle()` returns the `OfferDraft`s whose draft id no successful save used. `runWrapUp(deps, plan)` (`wrapup.ts`): builds the call `{ agent: {...agent, permission:'read'}, prompt, schema: {type:'object',properties:{note:{type:'string'}},additionalProperties:false}, system: <small>, cwd, label, maxTurns: 3, procedures: tools, procedureOnly: true, abort: child controller, onUsage }`, races it against `WRAPUP_MS`, catches everything, counts tokens from `onUsage`, writes the `wrapUp` line, then for each `settle()` draft that passes `acceptsText` over all its fields and (screen) `steps ≤ 20`, raises an offer (audit `offer`, line `offered`). `runAgent` with `procedureOnly` applies the overrides of `wrapUpAnswer` (`agents.ts:1328-1352`): `allowedTools: []`, `extra: { maxTurns, tools: [], allowedTools: [] }`, no `exec`, `docs`, `read`, `confine`, `release`, `screen`, `evidence`, `runnerTools`, `attachments`, `incoming`; `procedures` kept.

**Stage** (`executor.ts`, after `keepLooked()` at `:1127`, before `called = true`): if the output is concluding (no `question`, no `reporterQuestion`) and `procedures` exists: `await offerWork(...)` inside its own try/catch. The closing words are `readOutput(data, kind).summary` clipped to 600. The stage's `usage` callback receives the turn's tokens; the session meter does not (`onUsage` is the turn's own function that calls `usage?.()` and a local counter). `procedures.finish` in the `finally` (`:1135`) then runs as today.

**Conversation** (`answer.ts`): `commands.entries` = `session.log` entries with `n > startN` (read right after the session opens); after the answer is posted and before the `finally`, `plan = procedures.plan({ words: text })`. With a plan: the `finally` skips `procedures.finish` and a detached task runs `runWrapUp` then `procedures.finish('done')`; without: unchanged. `MentionDeps.wrapUp?` is a seam for tests (returns the promise). The once-per-screen-mark rule for the turn: `offers.turned(screenKey, mark)` (a small Set in `offers.ts`, cleared by `forget(screenKey)` when the screen closes via `sessions.onClosed` in `mentions/module.ts`).

**Card.** `OfferCards` (thread id, team) lists `procedures:offers` on mount, on the `procedures-offers` module event, on focus and every 30 s while visible, and draws nothing when empty or when the call is refused (a paired browser). Yes calls `procedures:offer-keep(offerId, title)`; No calls `procedures:offer-decline(offerId)`. Keep returns `ProcedureWrite`-shaped text; a refusal is shown under the title field. Strings under `ui.procedures.offer.*`; colors from tokens only.

**Prompts** (new keys, both catalogs): `prompt.sdd.runner.procedures.turn.system` (who you are, data-not-instructions sentence, "you have only the procedure tools"), `...turn.main` (`{ref}`, `{words}`, `{drafts}`, the save-only-if-done instruction).

## 5. Phases and commits

Each phase is one agent's work; the gates (`npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`) are green at the end of each. Commit subjects are `feat:` or `fix:`, lowercase, imperative; identity by `git -c` only; no attribution lines.

### Phase 1: the command draft (5 commits)
Read first: `procedures/record.ts:98-262`, `procedures/draft.ts`, `procedures/session.ts:196-420`, `procedures/tools.ts`, `sandbox/session.ts:19-32`, `runner/executor.ts:660-680,780-800`, `mentions/answer.ts:200-260`, `test/procedures-draft.test.ts`, `test/procedures-tools.test.ts`.
1. `feat: export a text check from the procedure validator` (`acceptsText`, tests in `procedures-record`)
2. `feat: draft a procedure from the commands an agent ran` (`commands.ts`, `procedures-commands.test.ts`: acceptance 1-2)
3. `feat: offer the command draft through procedures_draft and procedures_save` (session, tools, `has`, test)
4. `feat: give a call its own commands to draft from` (`OpenContext.commands` in executor and answer, test over `procedures-surfaces`)
5. `feat: tell a call with a shell about the command draft` (prompt keys, `proceduresCmd`, catalog parity)

### Phase 2: the whole screen (4 commits)
Read first: `procedures/screen.ts`, `browser/sessions.ts:130-200,640-700`, `test/helpers/screenSessions.ts`, `test/procedures-screen.test.ts`, `test/procedures-gui-calls.test.ts:100-160`.
1. `feat: keep a draft mark in the screen session` (`markOf`, `mark`, fake in the helper)
2. `fix: draft a screen from when it opened, not from when the call began` (rewrites `procedures-screen.test.ts:14` and `procedures-gui-calls.test.ts:126`)
3. `feat: move the mark when a draft is saved or a procedure is followed` (`lastStep`, `advance`, session)
4. `feat: tell the agent the draft covers the whole screen` (tool and prompt wording)

### Phase 3: the offer store, the card and its channels (6 commits)
Read first: `browser/asks.ts`, `renderer/.../AskCard.tsx`, `askView.ts`, `Thread.tsx:560-600`, `procedures/module.ts`, `procedures/index.ts`, `webPolicy.ts:75-90`, `test/procedures-policy.test.ts`, `test/procedures-ui.test.ts`, `rules/paired-phone.md` and `i18n.md`.
1. `feat: add createdBy to a procedure save request` (`store.ts`, test)
2. `feat: add procedure offers held in memory` (`offers.ts`: raise, supersede, cap 10, TTL, keep, decline, forget; `procedures-offers.test.ts`)
3. `feat: add the offer channels and the audit operations` (module, `index.ts` singleton, event, `audit.ts`)
4. `fix: pin the offer channels as denied to a paired browser` (policy test lists)
5. `feat: show the offer card in a thread` (`OfferCards`, api, strings, css, `Thread.tsx`)
6. `feat: say what became of an offer in the thread` (`offerKept`, `offerDeclined`, `offered` lines)

### Phase 4: the last turn and the trigger (7 commits)
Read first: `agents.ts:1255-1352`, `runner/executor.ts:576-610,780-830,1085-1145`, `mentions/answer.ts:195-350`, `mentions/module.ts`, `test/procedures-engine.test.ts:100-140`, `test/procedures-run.test.ts`, `test/procedures-surfaces.test.ts`, `test/helpers/runner.ts`.
1. `feat: add a call that has only the procedure tools` (`procedureOnly`, engine tests on both engines)
2. `feat: decide when the work earned an offer` (`plan`, `settle`, `saved`, `followed`, thresholds, tests)
3. `feat: run the last turn and raise the offers` (`wrapup.ts`, timeout, abort, swallowed errors, usage, lines)
4. `feat: give a stage its last turn` (executor wiring, `procedures-run` additions)
5. `feat: give a conversation answer its last turn` (answer wiring, detached run, `turned`/`forget`)
6. `feat: write the last-turn prompts` (both catalogs, parity)
7. `feat: document the offer of a procedure` (`docs/procedures.md` pt-BR and English, `CHANGELOG.md`)

## 6. Test plan

New files: `procedures-commands.test.ts` (acceptance 1-2: tables for noise, supersede, repeated success, `ran.length`, kept-session slice, carriers, flags, env, heredoc, 200 characters, mask, typed; asserts the audit and draft text hold counts and no left-out text); `procedures-offers.test.ts` (7, 8: raise, supersede, cap, TTL with a fake clock, keep writes the right origin and baseline, refusals keep the offer, decline moves the mark); `procedures-wrapup.test.ts` (5, 6: conditions, the call's shape, tools only, timeout, abort, error swallowed, usage routing, prompt content); `procedures-offer-ui.test.tsx` style of `procedures-ui.test.ts` (card draws, Yes/No, refusal text, empty on a refused call).

Extended: `procedures-record` (`acceptsText`), `procedures-tools` and `procedures-draft` (3), `procedures-screen` and `procedures-gui-calls` (4; two existing tests rewritten), `procedures-store` (`createdBy`), `procedures-policy` (9: three new channels, scan list), `procedures-engine` (`procedureOnly` on SDK and open engine), `procedures-run` and `procedures-surfaces` (stage and conversation wiring, ceremony and called agent get nothing), `config-schema` (10: schema 23, no new step), `i18n` parity via `npm run i18n:lint`.

Goldens (`test/golden/*.json`) do not carry the procedure rules (verified by grep on 2026-10-09), so none changes unless a prompt builder changes its default output. No test reaches a model, host or network: the engine is the existing fake; hosts are `example.com`; commands are neutral (`npm test`, `pytest`). Acceptance 11 is checked by hand on a throwaway `CERIMONIAS_DATA_DIR`.

## 7. Risks (what the plan assumes and did not verify)

- **The SDK with `tools: []` and one in-process MCP server.** The existing wrap-up uses `tools: []` with no server; `agents.ts:496` suggests the open engine reads `tools: []` as "no native tool" while still taking extra tools. Phase 4 commit 1 must test both engines first; if the SDK drops MCP tools with `tools: []`, use `allowedTools` of only the procedure names instead and keep `disallowedTools` for the rest.
- **Ids of the log.** `session.log` numbering (`n`) is per session and 1-based; the plan relies on `n > ran.length` for a stage (`executor.ts:666`) and `n > startN` for a kept session. A host session's log is the same shape (`host.ts:215`), not read in full.
- **`readOutput(...).summary` as the closing words** is the stage's summary field (`shared/runs/output.ts:35`); a stage kind whose output has no summary gives empty words, which the prompt tolerates.
- **Latency of the stage-side turn** (up to 120 s) is accepted; if it is felt, Phase 4 can move it behind a flag without changing the data.
- **Detached conversation turn** after `finally`: the sandbox, screen and kept session are already released; the turn needs none of them, but the plan's `plan()` must have copied the drafts and counts first. A test asserts the turn works after `session.close()`.
- **`tool` keys** are listed only to agents with that program in `allowedCommands` (`port.ts:57-60`); records saved from conversations with several repositories may rarely be read.
- **Prompt injection through labels and commands** reaches only a call with the procedure tools; the validator, the card and the unreviewed marker are the defences, as in #179.
- **Two policy tests** scan sources for `handle('procedures:...')`; the new channel names must match `[\w-]+` (`procedures:offer-keep` does).

## 8. Decision log

All decided at refinement (gates waived by the maintainer, 2026-10-09).

| Decision | Alternative rejected, and why |
|---|---|
| A new in-memory offer store with its own channels and card, in the thread | A new `PendingAsk` kind: asks belong to an open screen (`asks.ts:131`, `OpenScreenInfo.pending`), wait on a promise with the agent's clocks paused, and a command-only offer has no screen. The issue's "can be another kind" is met in spirit: the card sits beside the ask cards |
| Offers are not persisted; 24 h, 10 per workspace | A file per offer or a run field: a new format, a retention question and stale cards after the work is forgotten. The thread line survives |
| The wrap-up is a fresh small call, not a resume | Resume: re-reads the whole context (tens of thousands of cached tokens) to learn what the draft already says, and depends on session ids matching engines |
| Commands drafted from the command text only; carriers left out; five layers | Reading output to find the "point" of a command: output is where secrets show. Masking instead of leaving out: a hole in a command is worse than none |
| "Same program" decides that a success supersedes a failure | A string-similarity measure: no similarity code in the app (#179 rule 4); the pitfall keeps the failure visible |
| Noise is dropped silently; only unsafe commands are counted as left out | Counting noise: the number would say nothing about safety |
| `repo` key by repository id, else `tool` by program | Asking the person for the key on the card: more friction; the Procedures view edits it later |
| Whole screen with a mark that moves on save, on No and on following | A fixed window per answer (the bug); a hash of drafted steps (more state, same effect) |
| The turn runs at the end of each conversation answer, once per screen mark; no turn at idle close | A closing turn: no call is running, the typed-value memory and the shell are gone, and it needs a second entry point |
| Stage turn awaited; conversation turn detached | Detaching the stage's turn: its usage would miss the stage's record and a created record its baseline. Awaiting the conversation's: the thread's next message would wait |
| Wrap-up tokens in the stage's `usage`, not the session meter | Into the meter: every baseline would include a turn that is not "what finding it cost". A new field: avoided (rule 19) |
| Card Yes is reviewed even after a hand-off, with a warning | Waiting for review after a Yes: the person has just read the exact text; the agent's own save in that call still waits (#179 rule 24) |
| Phone cannot see or answer the card; decline also desktop-only | Phone decline like `runs:handoffDecline`: an unanswered offer costs nothing and a new channel outside the prefix needs its own policy entry |
| A followed procedure that failed and was not replaced gets no offer | Offering a replacement: needs a comparison UI; follow-up |
| `procedures_draft` serves both drafts | A second tool: two names for one idea, and a call with both would need both |
