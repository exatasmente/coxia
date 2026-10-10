# Implementation notes: the persona and its chat

What was built against `2_PLAN.md`, commit by commit, and every place it differs from the plan. The plan stays as approved; this file is where the differences are recorded.

## Commit 1: the persona kind and the configuration (schema 30)

Built as planned: `AGENT_KINDS` and `kind` in `types.ts`, `schema.ts`; `isPersona`, `outOfCycle`, `personaOf`, `personaDraftOf`, `withoutPersona` and the `kind` of `newAgent` in `team.ts`; `v29ToV30` (version only, no note) as step 29, version 30; validation in `teamRules`; the `repair` branch in `poolKeyAt`; `docs/configuration.md`; the tests (`test/persona-config.test.ts`, the "newest step" block of `test/config-migrations.test.ts`, a `kind` case beside the `draft` one in `test/config-schema.test.ts`).

Deviations:

- **Rebased on #246 first, as the plan asks.** The tree already had `v28ToV29` (the turns of the sub-agents), so the step is `v29ToV30`, version 30. Nothing else of the renumbering list applied.
- **The `system` error of a persona.** The existing rule "only the built-in agents are system agents" reports at `agents.team[i].system`, and the repair of a path the neutral base does not have walks up to `agents.team` and resets the whole team. A persona with `system: true` is therefore reported once, at `agents.team[i].kind` (the persona rule), and the existing check skips a persona; this is the plan's own reason for the one path, applied to the one field it had not listed.
- **The CHANGELOG line is not in this commit.** Nothing is visible to the person yet; the plan puts the entry at commit 10 (it covers the schema 30 and the impossibility of going back to an older build, which is the only visible effect of this commit).
- **One existing test updated** beyond the plan's list: `test/agent-team.test.ts` pins the exact key order of the agent in the JSON Schema; `kind` follows `draft`.
