---
checked-commit: 9f9ba219674ed482da8bfe1e6009a5b1fc73d4eb
checked-date: 2026-10-06
evidence: [src/shared/cycles/index.ts:1-29, src/shared/cycles/types.ts, src/shared/cycles/templates/agentFlow.ts:14-70, src/shared/runs/flowCheck.ts:10-11, src/shared/runs/flow.ts:29-82, src/shared/config/team.ts:66-75, src/shared/runs/squadCheck.ts:10-11, test/cycle-templates.test.ts, docs/cycles.md:1-130]
summary: The cycle templates, the devCycle section, stages, the agent flow and its teams
stages: [development, review]
roles: [developer, tech-lead, product-owner]
---

# Development cycles

Coxia does not assume one process. What the ceremonies do, what a card's stage is called,
where documents live and what agents say comes from the workspace's **cycle**: the `devCycle`
section of the `WorkspaceConfig`. A **cycle template** (`CycleTemplate`,
`src/shared/cycles/templates/`) is that section with a name. Choosing a template in the
wizard, or `cycle:apply`, rewrites `devCycle` and nothing else.

## The templates that ship with the app

`BUILT_IN_TEMPLATES` in `src/shared/cycles/index.ts` lists them in the wizard's order: `sdd`,
`scrum`, `kanban`, `github-flow`, `minimal`, `agent-flow`, `agent-flow-engineering`,
`release-flow`. `sdd` is the full process with gates and QA; `release-flow` is the flow of a
release run (`rules/runner.md`). A template is data, not code: the person can build one in
the app and export it as a file, and a shipped template is one TypeScript file under
`src/shared/cycles/templates/` registered in `BUILT_IN_TEMPLATES`.

## What `devCycle` defines

| Field | What it decides |
|---|---|
| `templateId` | Which template it came from (informative once edited) |
| `ceremonies`, `ceremonyParams` | Which ceremonies are on, and each one's parameters |
| `stages[]` | The stage vocabulary: `id`, `label`, `match`, `kind`, `rank`, and, for an agent cycle, `agentId`, `artifacts`, `human` |
| `flows` | Optional: a flow per squad id (`rules` below), or per run kind |
| `stageMapping[]` | Rules tying what the provider reports to a stage: `{ provider, source, name, pattern, stage }`. The first rule that matches wins; the rest fall to the stages' `match` |
| `meanings` | What counts as a blocker, as a question for me, and as ready for QA |
| `enrichment` | What an agent receives of each card: `specFolder`, `cardFields`, `extraFiles` |
| `specLayout` | Where documents live: `folderPrefix`, `phaseFiles`, `planFiles`, `gateFiles`, `decisionLog.heading`, `documents` |
| `comments` | The comment templates the runner posts, per stage id and event (`gate`, `question`, `pr`) |
| `priority` | The labels that mean urgency, from highest to lowest |
| `prompts`, `promptOverrides` | The text family of each role, and single-text overrides |
| `pipelineSkill`, `releaseLabelPattern`, `qa.user` | Optional: the team's pipeline skill, the version label, the QA account |

A cycle text is a **catalog key** (`cycle.sdd.name`) or a literal in the team's language; the
app tries the catalog and, if the key does not exist, uses the text as it is.

## The flow of an agent cycle

An agent-cycle stage has a `type`: `work` (an agent produces something), `gate` (the person
decides) or `wait` (the run waits for an event). A stage without a `type` in a flow cycle is
work. Beyond the fields the ceremonies use, a flow stage has `agentId`, `produces`, `reads`,
`next`, `returnsTo`, `roundLimit`, `waitsFor` (`pr-merged`, `reporter-reply`, `label`,
`time`, `linked-done`, `release-approved`, `beta-age`), `comment` and `trackerStatus`. The
order is the list's order. Read `docs/cycles.md` for the full field table.

**One pure check serves everyone:** `checkFlow` in `src/shared/runs/flowCheck.ts` runs at
configuration save, before the runner starts a run, and in the flow editor. Its errors
(`FLOW_ERRORS`: `no-stages`, `gate-first`, `work-no-agent`, `agent-unknown`,
`agent-on-non-work`, `next-nowhere`, `returns-nowhere`, `returns-to-non-work`,
`no-return-target`, `unreachable`, `no-end`, `artifact-unproduced`, `artifact-duplicate`,
`wait-no-event`, `turns-unknown`, `turns-self`, `turns-loop`) block saving a flow change and
block starting a run; its warnings (`FLOW_WARNINGS`: `agent-idle`, `gate-last`, `end-no-agent`)
do not. A flow already saved with a problem opens as it is; the runner refuses to start in it.
`flowIssueText` translates the codes. The two lists are code constants: read them there rather
than trusting this list.

**A run keeps a copy of the flow it started with** (`snapshotOf`, `Run.flow.hash` and
`Run.flow.stages`) and follows it after the cycle is edited: `flowOfRun` reads the agents as
they are now and falls back to `stageAgent` when the agent of a stage has left the team. The
agents' autonomy is not part of the hash, so switching one on or off never makes a new
version. The flow snapshot is what the agent read; `runs:migrateFlow` moves the
configuration's flow to the current one.

The flow the stages of a cycle become is `flowOf` in `src/shared/runs/flow.ts`: a stage with
no `type` is `work`, `next` defaults to the next stage in the list, `returnsTo` to the nearest
earlier work stage, `roundLimit` to `DEFAULT_ROUND_LIMIT`, and a `comment` left unset defaults
to the stage's own id (an empty `comment` means none). A work stage is picked by
`stageAgent`: the `agentId` it names, else the first agent of the team that lists the stage;
a gate and a wait never have one.

## The shipped agent team

`agent-flow` describes a product team: `triage → refine → gate1 → plan → gate2 → implement →
review → qa → ready → communicate`. The stages name their agent (`agentId`) and the files
they must produce (`0_TRIAGE.md` … `6_RELEASE_NOTE.md`, straight in the cycle folder, no
subfolder). The two gates wait for the person; `ready` is a wait; `communicate` runs after
the pull request is merged. `agent-flow-engineering` is the same flow with the engineering
roles only (`refine → gate1 → plan → gate2 → implement → review → qa → ready`); its review is
worked by `tech-lead` and its runs end at the wait, so an engineering run posts no release
note.

The shipped team, one row per agent (see `docs/cycles.md` for the permissions and the
escalation chain; the recommended `tracker` and `shell` come from `RECOMMENDED` in
`src/shared/config/team.ts`):

| Agent (`id`) | Stages | What it does |
|---|---|---|
| `support` | `triage` | Reads the issue as its reporter would, classifies it, asks what is missing, writes `0_TRIAGE.md` |
| `product-owner` | `refine` | Writes the functional spec and **proposes** priority and milestone |
| `tech-lead` | `plan`, `review` | Writes the technical plan, reviews the pull request on its lines |
| `developer` | `implement` | Changes code and tests in the worktree, only with the allowed commands |
| `qa` | `qa` | Turns the acceptance into scenarios, runs what it can, sends the work back on failure |
| `customer-success` | `communicate` | With the pull request merged, writes `6_RELEASE_NOTE.md` and answers the reporter |

None of these ids is fixed: the person renames them, changes their job, stages, model,
autonomy and whom they escalate to, removes them or adds others. Applying a template to a
workspace that already has agents keeps the person's agents: one with the same `id` is not
touched, the missing ones are added, and stages the new cycle does not have are removed from
each agent's stage list.

## Squads

Agents work in **squads** (optional; a workspace without them is one team). A squad is
`{ id, name, mission, scope, liaison, autonomy, label }`. An agent belongs to **one** squad
(or to none: it is shared and works for everyone). The squad's flow is
`devCycle.flows[<id>]`, or the workspace's. `checkSquads`
(`src/shared/runs/squadCheck.ts`) validates them; its errors block saving. Work reaches a
squad through its scope (repository, then labels, then path prefixes), and an issue no scope
claims goes to triage or to the `unclaimed` squad. Between squads, only the liaisons talk,
by request. Read `docs/cycles.md` for the full rules.
