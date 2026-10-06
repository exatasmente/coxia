---
checked-commit: 1a0858c59ed1d4c43e03feb3e709bbefd8441336
checked-date: 2026-10-06
evidence: [CONTRIBUTING.md:114-125, src/shared/cycles/index.ts:1-29, src/shared/cycles/templates/kanban.ts, src/shared/cycles/templates/sdd.ts, src/shared/runs/flowCheck.ts, test/cycle-templates.test.ts, test/cycle-prompts.test.ts, docs/cycles.md:31-51]
summary: The steps to ship a development-cycle template with the app
stages: [development]
roles: [developer, product-owner, tech-lead]
---

# Add a development-cycle template

A template is a named `devCycle` section: the ceremonies that are on, the stage vocabulary and
mapping, what counts as a blocker or "ready for QA", and where documents live
(`rules/development-cycles.md`). You can build one without code: adjust it in the app, export
it as a file and share it. To ship one with the app:

1. Create `src/shared/cycles/templates/<id>.ts` exporting a `CycleTemplate` (see `kanban.ts`
   for a small one, `sdd.ts` for a full one).
2. Register it in `BUILT_IN_TEMPLATES` in `src/shared/cycles/index.ts` (the order is the
   wizard's order).
3. Add its name and description keys (`cycle.<id>.name`, ...) to **both** catalogs, and any
   prompt texts it overrides under `prompt.<id>.*` (a family falls back to `sdd` for what it
   does not define).
4. Cover it in `test/cycle-templates.test.ts` (it must validate, and its stages must be
   reachable) and, if it changes prompts, `test/cycle-prompts.test.ts`.
5. List it in the table of `docs/cycles.md`.
6. A template may bring agents (`team`, see `agentFlow.ts`): applying it adds the ones the
   workspace lacks by `id` and never touches one it has. Their texts are catalog keys too.
7. A template may bring the comments its stages leave on the tracker (`devCycle.comments`, see
   `agentFlowComments.ts`); without them nothing is posted. Their texts are catalog keys too.
8. A template for an agent cycle describes a flow: each stage's `type`, `agentId`, `produces`,
   `returnsTo`, `waitsFor` and the other fields, and each agent's `turnsTo`. Run `checkFlow`
   over it (`src/shared/runs/flowCheck.ts`): `test/cycle-templates.test.ts` fails on any error
   or warning of a shipped template.

Use `example.com`, `group/project` and `#123` for anything that looks like a real host, person
or issue (`rules/public-repo.md`).
