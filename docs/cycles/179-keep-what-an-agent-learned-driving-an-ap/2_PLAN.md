# Keep what an agent learned, as procedures, and follow them the next time: technical plan

The plan for `1_SPEC.md` (gate 1 approved on 2026-10-09, every open question on its recommended answer; gate 2 waived, so the implementation follows this plan directly). The spec argues the why; this plan says what is built, where, and in what order. Base: `release/0.9.0` at schema 20; `file:line` below were read on this tree on 2026-10-09. Nothing was run.

**Built on #177 and #178, neither implemented yet.** Their branches are merged in (#177, then #178) before phase D starts; phases A to C do not touch their code. Names of things that do not exist yet are marked *(planned)* and come from #177's plan (`Seams for #178 and #179`) and #178's spec; #178's plan was not written when this was; the implementer reconciles the names in section 7 with it before phase D. All of them are reached through one adapter file (`src/main/procedures/screen.ts`), so a rename is a one-file fix.

## 1. What is built, and where

New code: `src/shared/procedures.ts` (types, caps, `compare()`), `src/main/procedures/` (`record.ts` validator, `store.ts`, `select.ts`, `session.ts`, `tools.ts`, `engineTool.ts`, `draft.ts`, `screen.ts`, `module.ts`), `src/renderer/src/screens/procedures/`, tests `test/procedures-*.test.ts`.

| Piece (spec rules) | Where it lands |
|---|---|
| Record, validator, key forms, secret refusals (1, 2, 7, 8, 23) | `shared/procedures.ts`, `main/procedures/record.ts` (pure; uses `redact`, `errorlog-core.ts:37`) |
| Store: one file per record, atomic, revision-checked, caps, stale/replace/use (3, 5, 9, 11, 19) | `main/procedures/store.ts` over `<workspace>/memory/procedures/` (`MEMORY_DIR`, `runner/activities.ts:11`; `ATAS`, `env.ts:15`) |
| Prompt list (12-15) | `main/procedures/select.ts`; section in `runner/prompt.ts:251` (next to `shared`) and `mentions/call.ts:185`; rules text in both prompt catalogs |
| Tools for both engines (6, 16) | `main/procedures/{tools,engineTool}.ts`; plumbing in `main/agents.ts` (`AgentCall` at `:1168`, `EngineRequest`, `runOpenEngine` `:512-513`, SDK `:617-624`, wrap-up `:812,841`) |
| One session per call: reads, stale reports, usage meter, finish (11, 20, 21) | `main/procedures/session.ts`; opened in `runner/executor.ts` (beside `:900`), `mentions/answer.ts` (beside `:211`), `runner/conversation.ts:228` |
| Mark and chip (20) | `StageRecord.procedures` (`shared/runs/types.ts:56`), `recordProcedures` in `shared/runs/transitions.ts:1003`, saved from `runner/service.ts:626-641`, chip in `StageTimeline.tsx:141` |
| Comparison (21) | `compare()` in `shared/procedures.ts`; figures kept in the record |
| Switch (28) | `runner.procedures`, schema 22 |
| Channels and policy (17, 18) | `main/procedures/module.ts` (registered in `main/modules.ts`), pattern in `main/webPolicy.ts:72-77` |
| Audit and thread lines (22) | `AuditKind` `procedure` (`shared/auditoria.ts:1`, label map in `Auditoria.tsx:9`), `recordWrite` (`main/auditoria.ts:24`), forum codes `runner.procedures.*` |
| View (17, 18) | screen `procedures` (`App.tsx:45,213`, row in `BottomNav.tsx:33`), `StageTimeline.tsx`, `team/RunnerSection.tsx:157` |
| GUI draft (29-33, 24) | `main/procedures/{draft,screen}.ts` over #177's step log |
| Docs | new `docs/procedures.md`, `docs/README.md`, `docs/configuration.md`, `CHANGELOG.md` |

## 2. Data and types

- **Record** (`shared/procedures.ts`): exactly the fields of spec rule 1. `v: 1`; `kind`; `key`; `title`; `steps: {text, run?}[]`; `pitfalls`; `waits`; `state`; `lastVerified`; `lastFailed: {at, step}`; `origin`; `keyedBy: 'app'` (gui only); `stepsFrom`; `reviewed`; `previous` (text fields only). **Plan additions to `stats`**: `uses`, `failures`, `failuresSinceSave`, `lastUsed`, `baseline: StageUsage | null` (filled when the creating call finishes), `recent: {at, ref, failed, usage: StageUsage}[]` (last 20). `ref` is the run reference or thread id.
- **Decision on the 4,000 characters**: measured on the *content* (`key`, `title`, `steps`, `pitfalls`, `waits` serialised), not on `stats`, `origin` or `previous`. The file may be longer; `procedures_get` returns content plus the short provenance line.
- **Files**: `<workspace>/memory/procedures/<id>.json` and `deleted.json` (the ids ever deleted; a new id is drawn again until it is in neither). A file with `v` above ours is skipped by `list`, answers "written by a newer app" to `get`, and `save` refuses to touch it (`activities.ts:82-97` is the precedent). `store.ts` imports no Electron (spec question 8).
- **Draft** (in memory, per session): `{id: 'd-1', steps: {n, text, edited?}[], pitfalls: string[], waits: string[], sites: string[], handoff: boolean, replaces?: string, compare?: {kept, changed, added}}`.
- **Run format**: `StageRecord.procedures?: {id, revision, title, outcome: 'ok' | 'failed' | 'replaced'}[]`. Run files that carry it are `version: 5`: `RUN_VERSION = 5` (4 is the hand-off of #178), `RunVersion` gains 5, `runVersionOf` returns 5 when any stage record has the field (`shared/runs/types.ts:15-22`), the enum at `shared/runs/schema.ts:279` and the stage-record properties get the field, so an older app says "written by a newer app" instead of calling the run invalid (the rule #157 set). Runs without it stay at their current version.
- **`AuditKind`** gains `'procedure'`. `AgentCall` and `EngineRequest` gain `procedures?: ProcedureTools`. `StageInput` (`runner/prompt.ts`) and `MentionInput` (`mentions/call.ts:15`) gain `procedures?: string` (the rendered list). `ExecutorDeps` (`executor.ts:77`) and `MentionDeps` (`mentions/answer.ts:33`) gain `procedures?: ProceduresPort`.

## 3. Configuration and migration

`runner.procedures?: boolean` in `RunnerConfig` (`types.ts:808`); absent reads as off (`proceduresOn(config)` helper). `neutralRunner()` (`defaults.ts:36`) writes `true`, so a new workspace has it on; `schema.ts` gets the property next to `evidence` (`:524`) with `additionalProperties: false` kept.

Schema **21 to 22** (`CONFIG_SCHEMA_VERSION`, `types.ts:5` and its header line; `STEPS` at `migrations.ts:343`): `v21ToV22` writes `runner.procedures = false` when absent and the file has a `runner` object, with a note ("learned procedures are off for a workspace that existed; turn them on in Settings"), touching nothing else (shape of `v19ToV20`). #177 takes 21 and merges first; #170 (open PR #174) renumbers after this. `config-schema.md` is followed: type, default, schema, step, tests.

`runner.*` is not in `WEB_EDITABLE` (`configScope.ts:23-39`), so a paired browser can neither raise nor lower the switch; no change to `raisedPermissions` (`configScope.ts:65`), and a test pins that `runner.procedures` is a refused path. The Settings toggle sits in `RunnerSection.tsx:157` (desktop, with the other runner switches), labels in `ui-team`. Off means: no tool, no prompt section, no write by any agent; the view still lists, edits and deletes.

## 4. Flow and prompts

**Port.** `ProceduresPort.open(ctx): ProcedureSession | null` is built once in `main/procedures/index.ts` from the store and the config; it returns null when `proceduresOn` is false or the call is a ceremony or has no session. `ctx = {surface, agent, thread, run?, stage?, repos, tools, hosts, language, screenKey?}`. Surface comes from `MentionPlace` (`mentions/place.ts:12`): `run` is `run-thread`, `owner` is `direct`, a squad channel is `channel`, general is `forum`; a stage is `stage`; the agent a stage calls (`runner/conversation.ts`) is `called`.

**Session.** `open` computes the list text (select.ts) and returns `{tools, list, wrapUsage(fn), finish(outcome)}`. `wrapUsage` wraps `call.onUsage` (`executor.ts:800`, `AgentCall.onUsage` `agents.ts:1183`) to meter the call in memory, always; it is persisted only if a procedure was read. `finish('done')`, called in the `finally` of the stage attempt and of the answer:
1. each id read and not reported stale and not replaced in the call: `uses++`, `state = ok`, `lastVerified = now`, a `recent` entry (`failed: false`);
2. each stale report: already applied at report time (`state = failing`, `failures++`, `failuresSinceSave++`, `lastFailed`), plus a `recent` entry (`failed: true`);
3. each record created in the call: `stats.baseline` = the call's metered usage;
4. returns `ProcedureUse[]` and writes one system line "Used: {title}" per procedure (`runner.procedures.used`; system lines never reach a prompt, `prompt.ts:109-111`).
On `finish('failed')` (error, abort) nothing is inferred as a use. A stage passes the uses to `service.ts` through a dep that calls `moveRun(... recordProcedures ...)` next to `recordUsage` (`service.ts:632-641`); a conversation keeps them in the record and the thread line only (no usage store elsewhere, spec rule 21). The agent a stage calls (`runner/conversation.ts`) gets the tools and marks on its conversation thread, not on the calling stage's record.

**Tools** (`coxia_procedures`; open-engine names `procedures_*`, SDK names `mcp__coxia_procedures__procedures_*`): `procedures_list`, `procedures_get`, `procedures_save`, `procedures_stale`, and `procedures_draft` (offered only when the call has a browser screen, phase D). Handlers return `{text}` in English like the evidence tools (`evidence/tool.ts:12`, `engineTool.ts:20-51`), refusals as text naming the field and the reason without echoing the value; one JSON-schema table feeds the open engine, and the SDK server uses a `z.unknown()` shape per property as `runnerMcpServer` does (`runner/tools.ts:166-187`), since the app validates. No delete tool, no tool that touches the view. Server missing (SDK or zod not loadable): the list is still in the prompt and the thread says tools are unavailable (`main.procedures.error.tool-missing`), as the evidence server does at `agents.ts:615`.

**Save semantics** (record.ts + store.ts): validation per rules 7, 8, 23 in one pass that returns every refusal; `redact(field) !== field` refuses (email, credential, home path); then the caps (10 per kind and key, 300 per workspace, duplicate normalised title) naming the least-used record to replace; then the revision check (`save` with `id` must carry the `revision` it read, else "changed since you read it, read again"); write to `<id>.json.tmp-<pid>` and `rename` (`activities.ts:99-105`). Store calls are synchronous inside one process, so read-compare-write needs no lock. A replacement keeps `previous` once, resets state to `unverified` and `failuresSinceSave` to 0, and keeps `baseline`. The person's edit uses the same entry point with `actor: person`: `reviewed: true`, a failing record becomes `unverified`. A record with `failuresSinceSave >= 2` is dropped from the prompt list, never from the view (open question 2).

**Validator details fixed here.** Title: `^[A-Za-z0-9 .,\-/()']+$` (accented letters allowed through `\p{L}`), one line, 80. A "digit run" is `\d(?:[\s.-]?\d){5,}`. An "opaque token" is 20+ non-space characters that mix letters and digits (so `docs.example.com/budget/sheets` passes and a key does not); the draft rewrites path segments that are numeric or mixed 8+ characters to `:id` so its own text never trips this. Quotes: `"…"`, `'…'` and curly forms, `gui` steps and notes only. A table test pins each class with a passing and a refused example; false positives refuse and teach, by design.

**Selection** (select.ts, pure): the contexts of spec rule 13. `repo`: `run.repo` / `place.repos[].id`. `cycle`: `stage.kind` with `@<repo>` optional. `tool`: enabled plugin names (`pluginNotes()`, `plugins/module.ts:626`), the kinds of the workspace's `vcs` integrations (`types.ts:142`), the first words of the agent's `allowedCommands`. `gui`: the agent's allowed hosts *(planned, #177 `allowedHosts`)*. `request`: all, last. Order: kind, key match, `ok` then `unverified` then `failing`, most recently used; budget `min(2000, budgetFor(window) share)` using `budgetFor` (`shared/harness/select.ts:4`) and 25 entries; "N more not listed; use `procedures_list`". Entries are rendered with `cycleText` keys `main.runner.procedures.list.*` (as the activities do, `activities.ts:327-394`), including "not reviewed by the person" and "written by an agent (read-only)". Mark of a repository with an `AGENTS.md` (rule 26) comes from the harness scan the stage already makes (`executor.ts:641`, `harness/scan.ts:15`); a conversation skips the mark.

**Prompts.** Two new catalog keys per language: `prompt.sdd.runner.section.procedures` (the standing sentence, then `<data>{text}</data>`, user side next to `section.shared`, `fence()` at `prompt.ts:98`) and `prompt.sdd.runner.rules.procedures` in the system text (when to save, when to replace, no one-offs, nothing `AGENTS.md` already says, describe controls by role and visible label, `<value>` for values, report a failed step with `procedures_stale`). A call without the tools gets neither; with the switch off every existing golden is byte for byte unchanged.

**Channels** (`module.ts`): reads `procedures:list`, `procedures:get`, `procedures:stats` (open to a paired browser); writes `procedures:save`, `procedures:delete`, `procedures:review`, `procedures:restore` (desktop). `webPolicy.ts` gets `PROCEDURES_WRITE = /^procedures:(?!(list|get|stats)$)/` joined to the deny test at `:75`; none in `EXTERNAL_EFFECT` or `DESKTOP_ONLY` by name. The person's writes are audited (`recordWrite`, `issue: 0`) with no thread line (a workspace-level action has no thread); an agent's writes also leave the thread line. Audit fields: agent, id, revision, kind, key, title; never a step.

**View.** Screen `procedures`: list (filters kind, key, agent, state, unreviewed; search title and key), record panel, usage comparison from `compare()` (at least 3 uses and average below baseline, "approximate" label, cost only where reported). Controls (Edit, Mark as reviewed, Restore previous, Delete with confirm) render only when `!isWeb()` (`renderer/src/platform.ts:2`); the channels refuse a paired browser anyway. Every string in both `ui-*` catalogs, theme tokens only.

## 5. Order of the work: phases and commits

Each phase ends with `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` and `node scripts/public-audit.mjs` green; each commit carries its tests and, when visible, a line under `## [Unreleased]`. Commit 1 is this plan alone (`feat: add the plan of #179`). Tests use `example.com` and neutral names only, in a temp data dir.

**Phase A, the record and the store (5 commits).** Read first: `runner/activities.ts:1-130`, `errorlog-core.ts:14-60`, `rules/data-layout.md`, `rules/secrets.md`, spec rules 1-9, 19, 23.
2. `feat: add the procedure record and its validator` (`shared/procedures.ts`, `record.ts`; acceptance 6 without the gui clauses, 8, 16).
3. `feat: keep procedures in the workspace folder` (`store.ts`: files, `deleted.json`, atomic write, revision, caps, duplicate, newer `v`, stale/replace/use transitions, `finishUse`; acceptance 8-12, 18, a test that nothing is created in a worktree or cycle folder, 10).
4. `feat: add a workspace switch for learned procedures` (types, schema, defaults, `v21ToV22`, `proceduresOn`, Settings toggle; `config-migrations`, `config-schema`, `config-scope`; acceptance 19 first half).
5. `feat: list the procedures that fit a call` (`select.ts`, `main.runner.procedures.list.*`; acceptance 14 except the prompt placement).
6. `feat: compare what a procedure cost to find with what it cost to use` (`compare()`; acceptance 22).

**Phase B, the tools in both engines (4 commits).** Read first: `evidence/engineTool.ts`, `evidence/tool.ts`, `runner/tools.ts:140-200`, `agents.ts:480-640,800-850,1150-1290`, `rules/external-effects.md`, `rules/agent-read-only.md`.
7. `feat: add the procedure session and its handlers` (`session.ts`, `tools.ts`, audit kind and label, forum codes and catalogs; acceptance 12, 16, 26 for the agent's side, 20 first half).
8. `feat: offer the procedure tools to both engines` (`engineTool.ts`, `agents.ts` plumbing, names, wrap-up strips them, server-missing line; acceptance 13: same calls through both shapes, offered to a reading agent, refusal as text).
9. `feat: give stages and conversations their procedures` (`ProceduresPort` wired in `executor.ts`, `answer.ts`, `conversation.ts`; prompt section and rules text; not in a ceremony; switch off offers nothing; acceptance 15, 19 second half, 14 placement; goldens for the new keys only).
10. `feat: show which procedure a stage used` (`StageRecord.procedures`, `RUN_VERSION 5`, schema, `recordProcedures`, chip in `StageTimeline.tsx`; acceptance 20, 21 including "an answer that read a procedure records its usage and one that did not records none").

**Phase C, the person's view (3 commits).** Read first: `webPolicy.ts`, `test/screen-policy.test.ts`, `test/runs-policy.test.ts`, `renderer/src/App.tsx`, `BottomNav.tsx`, `screens/team/RunnerSection.tsx`, `screens/Auditoria.tsx`, `rules/paired-phone.md`, `rules/theme.md`, `rules/i18n.md`.
11. `feat: add the procedures channels and close the prefix to a paired browser` (`module.ts`, `modules.ts`, `PROCEDURES_WRITE`, `test/procedures-policy.test.ts` with a made-up channel and the handler scan; acceptance 17).
12. `feat: show the procedures and what they saved` (screen, route, More row, list, filters, record panel, comparison, read-only in a paired browser; acceptance 24 first half, 25, 23 by hand).
13. `feat: edit, review, restore and delete a procedure` (editor over `procedures:save`, same validator errors shown, confirm on delete; id not reused; acceptance 24, 26 for the person's side).
**Phase D, the GUI draft (4 commits), after #177 and #178 are merged.** Read first: #177's plan sections 6 and 7 and `src/main/browser/{stepLog,sessions,mask}.ts`, #178's plan, spec rules 24, 29-33, acceptance 1-7.
14. `feat: reach the screen steps from the procedures` (`screen.ts` adapter; extends `StepEntry` with `reason?` and `key?`, named non-printing keys only, in `stepLog.ts` if #177 did not keep them; `test/helpers/screenSteps.ts` fake log).
15. `feat: draft a procedure from the recorded steps` (`draft.ts` pure, `procedures_draft`; acceptance 1, 2 draft clauses).
16. `feat: save a gui procedure from a draft` (draft id required, no own steps, drop or reword only, key from visited sites, none for shell-only work, comparison and replacement of an existing id, hand-off sessions created `unreviewed`, typed-value refusal for every kind; acceptance 2-5, 6 gui clauses).
17. `feat: tell a screen task to keep its procedure` (prompt variant `rules.proceduresGui` only when the call has `coxia_browser`; acceptance 7 by hand).

**Phase E, closing (2 commits and a note).** Read first: `docs/runner.md`, `docs/configuration.md`, `docs/README.md`.
18. `feat: document the learned procedures` (`docs/procedures.md`, index, configuration, `CHANGELOG.md`).
19. `feat: review the procedures against the spec` (a pass over acceptance 1-27 with what each test covers; fixes only).
20. Outside the repository the main session updates `.claude/rules/{data-layout,paired-phone,agent-roles,config-schema,i18n}.md` and `_MAP.md` (new domain `procedures.md`), naming the folder, the `procedures:` prefix and the switch.

## 6. Test plan

New: `procedures-record` (every cap, key form per kind, newer `v`, secret classes with passing and refused examples), `procedures-store` (atomic write by a failing rename, two saves on one revision, caps, duplicates, transitions, retention sweep and activities untouched, never in a worktree), `procedures-select` (contexts, order, 25 entries and 2,000 characters, bracket and line-break titles), `procedures-tools` (handlers, refusals as text, surfaces), `procedures-engine` (open `ToolImpl`s and SDK server from the same handlers; server unavailable), `procedures-surfaces` (stage, direct, channel, forum, run-thread, called agent offered; ceremony not; "ignore your rules" adds no tool, host or permission), `procedures-usage` (marks, chip, system line, usage only for answers that read one, `compare()`), `procedures-policy` (acceptance 17), `procedures-ui` (static render as `test/live-screen-ui.test.ts`: list, controls only on the desktop), `procedures-draft` and `procedures-gui` (phase D, with the fake log). Changed: `config-migrations`, `config-schema`, `config-scope`, runs schema and `runs-core` (version 4 only with the field), `retention`, `auditoria`, prompt goldens for the new keys only, `ui-i18n`. No test reaches a real host or model. By hand at the end, on a throwaway data dir: acceptance 7, 23, 24 and 25.

## 7. Seams this plan depends on

From #177 *(planned)*: `StepLog`/`StepEntry {n, at, tool, role?, name?, site, path, class, held?, passed?, outcome, ms}`; `screenSessions().stepsOf(key)` and `.onClosed`; screen key `call:<thread>:<agentId>` (`callKey` in `shared/browser.ts`); `AgentDef.allowedHosts`; the `coxia_browser` server and its `AgentCall.screen`; audit kinds `screen-*`; the schema step 21; the `ProcedureSession` reads the key from the call, not from the browser. From #178 *(names to reconcile with its plan)*: a hand-off flag on the screen session (`handedOff: boolean`, set at the first interval, never cleared in the session) and the masker of typed values (`ScreenSession.masks: MaskSet`, whose `apply(text)` returns the text with typed values masked; a text is "holding a typed value" when `apply(text) !== text`). `screen.ts` exposes `steps(key, from)`, `stepCount(key)`, `visited(key)`, `handedOff(key)`, `typedIn(key, text)`; nothing else in `main/procedures/` imports a browser or screen module. If #178 applies its masker to the shell path, `typedIn` covers it; if it does not, only browser-path sessions are checked, and the thread says so.

## 8. Risks

- **The draft depends on the step log.** It needs `reason` and a named `key` that #177's `StepEntry` may not keep; commit 14 adds them. If #177 keeps a typed value or page text anywhere in an entry, `draft.ts` must not copy it: it reads only the fields listed in section 2 and a test feeds an entry with extra fields.
- **`RUN_VERSION` collided** with #178, which also made 4 mean something (a recording that holds a hand-off); merged, #179 is 5 and `runVersionOf` checks `procedures` first.
- **Schema 22 depends on the merge order** (#177 first, then this; #170 renumbers).
- **Per-attempt usage is not the stage's usage.** The baseline and the uses compare the metered calls of one attempt or one answer; the label "approximate" and the 3-use minimum say so (open question 10 stays as recommended).
- **A model that reads a procedure and does nothing else counts as a successful use** (rule 11): the view calls it "no failure reported".
- **Validator false positives** (a command with a long token, a path with digits) refuse a good save; the refusal names the field and the class, and the table test is the place to tune.
- **Two records of one agent in one call** share one usage meter; each gets the whole call's figures. Acceptable for an approximate comparison, said in the docs.
- **The in-process SDK server was not run** with a fourth app server beside the evidence, runner and shell ones; `agents.ts:617-624` builds several today, so it is expected, and commit 8 tests the object, not the SDK.
- **Concurrent windows**: the store is synchronous in one process; a second app instance on the same folder is out of scope and would meet the revision check.
- **Public repository**: records name real sites at run time; the folder is outside every worktree and the repository, tests use neutral hosts only.

## 9. Decision log

| # | Decision | Rejected alternative |
|---|---|---|
| D1 | Switch is `runner.procedures`, schema 22, off by migration, on for new | A top-level block editable from the phone (a raise path), or on for everyone (spec question 7) |
| D2 | One file per record plus `deleted.json` for ids never reused | One index file (contention between parallel runs and conversations; the activities file is single-writer) |
| D3 | 4,000 characters measured on the content | On the whole file (`stats` and `previous` would eat the room for steps) |
| D4 | `StageRecord.procedures` with run format 5 | Reading the chip from thread lines (it would vanish with the thread and the phone could not tell outcome) or from the record's `recent` (a deleted procedure would take the chip with it) |
| D5 | The session meters usage for every call and persists it only when a procedure was read | A usage store for all conversation answers (spec: out of scope) |
| D6 | A called agent's marks go to its own conversation thread | Writing them into the calling stage (needs a new path through `conversation.ts` for a small gain) |
| D7 | `PROCEDURES_WRITE` pattern with a negative lookahead for the three reads | A list of write channels (a channel added later would be open) |
| D8 | The person's writes are audited with no thread line | A line in the general thread (noise in a place the person did not open) |
| D9 | Baseline stays with the first creating call across replacements | Re-basing at every replacement (the comparison would only see the cheapest, fixed version) |
| D10 | One adapter file for every #177 and #178 name | Importing the browser modules from the store, tools and draft (a rename would touch many files) |
| D11 | The Procedures screen is reached from the More sheet | A tab of the Team area (spec question 12: read by people who never open the team editor) |
| D12 | Draft path templates replace id-like segments with `:id` | Keeping paths as visited (record text would trip its own secret check and leak ids) |
