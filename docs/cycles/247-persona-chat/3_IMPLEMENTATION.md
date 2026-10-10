# Implementation notes: the persona and its chat

What was built against `2_PLAN.md`, commit by commit, and every place it differs from the plan. The plan stays as approved; this file is where the differences are recorded.

## Commit 1: the persona kind and the configuration (schema 30)

Built as planned: `AGENT_KINDS` and `kind` in `types.ts`, `schema.ts`; `isPersona`, `outOfCycle`, `personaOf`, `personaDraftOf`, `withoutPersona` and the `kind` of `newAgent` in `team.ts`; `v29ToV30` (version only, no note) as step 29, version 30; validation in `teamRules`; the `repair` branch in `poolKeyAt`; `docs/configuration.md`; the tests (`test/persona-config.test.ts`, the "newest step" block of `test/config-migrations.test.ts`, a `kind` case beside the `draft` one in `test/config-schema.test.ts`).

Deviations:

- **Rebased on #246 first, as the plan asks.** The tree already had `v28ToV29` (the turns of the sub-agents), so the step is `v29ToV30`, version 30. Nothing else of the renumbering list applied.
- **The `system` error of a persona.** The existing rule "only the built-in agents are system agents" reports at `agents.team[i].system`, and the repair of a path the neutral base does not have walks up to `agents.team` and resets the whole team. A persona with `system: true` is therefore reported once, at `agents.team[i].kind` (the persona rule), and the existing check skips a persona; this is the plan's own reason for the one path, applied to the one field it had not listed.
- **The CHANGELOG line is not in this commit.** Nothing is visible to the person yet; the plan puts the entry at commit 10 (it covers the schema 30 and the impossibility of going back to an older build, which is the only visible effect of this commit).
- **One existing test updated** beyond the plan's list: `test/agent-team.test.ts` pins the exact key order of the agent in the JSON Schema; `kind` follows `draft`.

## Commit 2: the persona out of the cycle, the templates and the export

Built as planned: `outOfCycle` inside `workingTeam` and `stageAgent` (class A is covered by that alone); the direct readers of class B (`mentionableIds`, `chatAgents`, `mentionChoices`, `forum:list`, `templateFromConfig`, `mergeTemplateTeam`, `parseTemplate`, `adjustable`, the creator's three doors, the Team list, `promoteDraft`); the export, the import and the preview (`transfer.ts`, `config-transfer.ts`); the tests (`test/persona-team-readers.test.ts` with the source scan of class D, `test/persona-transfer.test.ts`, a persona case in `test/agent-assist-draft.test.ts` and `test/forum-policy.test.ts`).

Deviations and decisions:

- **`mentionableIds` for the persona's own thread.** The plan's class B row keeps the ordinary working team in the list and only withholds the owner; the "no `@` in the persona's thread" of rule 15 is the `quiet` post of commit 4 (a persona thread posts with `mentions: []` and no system line). `mentionableIds(team, personaThread)` therefore still lists the working team; the walk test pins that the persona itself is never in it.
- **`parseTemplate` drops the kind, `mergeTemplateTeam` skips the persona.** Both as the plan says: a template file that names a persona is read as an ordinary agent with a warning at `template.team[<id>].kind`; a team handed to `mergeTemplateTeam` programmatically never adds a persona.
- **`parseImport` strips before it validates.** The plan says "removes any entry of kind persona from a file it reads"; doing it on the document before the schema check means a file with two personas (which validation would refuse) still imports, minus the persona, with the warning at `agents.team`.
- **`applyImport` and a clash of ids.** The kept persona wins over an imported agent that has its id (two entries with one id would make the written file fail validation and the load would reset the team). A kept persona whose own model points at a provider (or a pool entry) the imported file does not have goes back to the `deep` role's, for the same reason. Neither case is in the plan.
- **Readers of `agents.team` found by the search and not in the plan's class C**, all looked at: lookups of an agent by id (`service.ts:1117,1579,1601`, `executor.ts:186`, `publish.ts:1444`, `ceremonyCommands.ts:25`, `mentions/ceremony.ts:54`, `browser/sessions.ts:694`), the id lists (`publish.ts:328`, `browser/module.ts`), `runner/module.ts:435`, the pool walkers of the wizard (`poolEdit.ts`), `flowFile.ts:65` (agents named by a flow file) and `squadEdit.ts:95-120`. None decides who works, is called or is offered, so none is filtered.
- **CHANGELOG** still waits for commit 10, as the plan has it (nothing is visible yet).
