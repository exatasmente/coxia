# #9 The development cycle has no runner: technical plan

Spec: [`1_SPEC.md`](1_SPEC.md). Three phases, each its own set of commits and its own review. Phase 1 builds the data (configuration, template, run store, forum store); phase 2 builds the thing that runs; phase 3 builds the screens. Nothing in phase 1 starts a model, touches a repository or writes to a code host.

## What exists today and what the plan reuses

| Need | Where it is | Used as |
|---|---|---|
| Versioned config, hand-written JSON Schema validator, migrations | `src/shared/config/{types,schema,validate,migrations,defaults}.ts` | The team is a new `agents.team` list; schema 3 becomes 4 with a `v3ToV4` step, exactly how `v2ToV3` was added |
| Cycle templates (a named `devCycle`) | `src/shared/cycles/` | A new built-in template `agent-flow`; the template gains an optional default team |
| Agent engines, hooks, activity | `src/main/agents.ts` (`sdkOptions`, `agentHooks`, `runOnce`, `run`), `src/main/engine/` | Phase 2 runs a stage through the same two engines and the same hook callbacks |
| Live activity push | `src/main/activity.ts`, `ACTIVITY_EVENT` through `emit({type:'module', ...})` | The forum push event uses the same path |
| Git and worktrees | `src/main/conflictGit.ts` (`git`, `findClone`, `assertPlainPush`, `removeWorktree`), `src/main/worktrees.ts` | One worktree and branch per run |
| Write door to the code host | `src/main/actions.ts` (`proposeVcsAction`, `approveAction`, `audited`, `assertExternalWrite`), `src/main/vcs/` (`VcsWriteOp`, `planWrite`, `validate.ts`, `exec.ts`) | Push and pull request are proposals waiting for their own "yes" |
| What a paired browser may call | `src/main/webPolicy.ts` | Classification of the new channels |
| Atomic JSON writes | the `tmp` + `rename` pattern of `actions.ts`, `minutesStore.ts`, `workspaces-core.ts` | Run store |
| Per-workspace data folder | `ATAS` in `src/main/env.ts` | `runs/` and `forum/` live under it |

## Data model (all phases)

```
WorkspaceConfig (schema 4)
  agents.team: AgentDef[]
  devCycle.stages[]: StageDef + { agentId?, artifacts?, human? }
CycleTemplate
  + team?: AgentDef[]                       (default team, merged on apply)
<workspace>/runs/<runId>.json               Run   (one JSON per run, atomic, schema-versioned)
<workspace>/forum/<threadId>.jsonl          Thread header + ForumMessage lines, append-only
```

### AgentDef

```ts
interface AgentModel { role: LlmRole | null; provider: string; model: string }   // role set: borrow llm.roles[role]; null: provider + model
interface AgentDef {
  id: string;            // lowercase letters, digits, "-", "_" (the @mention name)
  name: string;          // catalog key or literal
  job: string;           // what it does, catalog key or literal
  model: AgentModel;
  stages: string[];      // devCycle.stages ids it works
  permission: 'read' | 'worktree';
  instructions: string;  // appended to its system prompt, catalog key or literal
  system: boolean;       // the five built-in agents: edited, never deleted
}
```

The five system agents have the ids of the five LLM roles (`turn`, `reply`, `deep`, `teams`, `fix`), no stages and permission `read`. They are what the ceremonies call today. The default team of the agent cycle (Refiner, Planner, Developer, Reviewer, QA) is five more agents, not system.

### StageDef additions

`agentId?: string` (the agent that works the stage), `artifacts?: string[]` (file names the stage must produce in the cycle folder), `human?: boolean` (a gate: waits for the person). The agent of a stage is `stage.agentId` when that agent exists, else the first agent of the team whose `stages` lists the stage, else none (the stage cannot start and says so).

### The agent cycle template

| Stage | Kind | Rank | Who | Artifacts |
|---|---|---|---|---|
| `refine` | backlog | 1 | `refiner` (read) | `1_SPEC.md` |
| `gate1` | backlog | 2 | person | |
| `plan` | development | 3 | `planner` (read) | `2_PLAN.md` |
| `gate2` | development | 4 | person | |
| `implement` | development | 5 | `developer` (worktree) | `3_IMPLEMENTATION.md` |
| `review` | review | 6 | `reviewer` (read) | `4_REVIEW.md` |
| `qa` | qa | 7 | `qa` (read) | `5_TEST_PLAN.md` |
| `ready` | reviewApproved | 8 | none: terminal | |

`specLayout` matches: folder prefix `{iid}-`, phase files from `5_TEST_PLAN.md` down to `1_SPEC.md`, plan file `2_PLAN.md`, gate 1 on `1_SPEC.md`, gate 2 on `2_PLAN.md`, sub-folder empty (flat cycle folder). Ceremonies on: pre-daily, unblock, gate, retro; off: QA hand-off, release conflicts. Prompt family `sdd`.

### Run

```ts
interface Run {
  version: 1; rev: number; id: string;
  issue: { ref: string; iid: number; title: string; url: string | null };
  repo: string; branch: string; worktree: string; cycleFolder: string; cycleId: string;
  status: 'working' | 'gate' | 'question' | 'failed' | 'done' | 'cancelled';
  stage: string;
  stages: StageRecord[];          // one per stage entered: agent, status, artifacts, startedAt, endedAt, attempts
  question: PendingQuestion | null;
  review: { rounds: number; max: number };
  error: { code: string; stage: string; detail: string | null } | null;
  history: HistoryEntry[];        // append-only trace of every transition
  comments: Record<string, CommentRecord>;   // tracker comments by stage id, and `pr` for the pull request
  createdAt: string; updatedAt: string;
}
```

```ts
interface CommentRecord {
  target: 'issue' | 'mr'; noteId: string | number | null; url: string | null;
  bodyHash: string | null; status: 'draft' | 'proposed' | 'published' | 'refused'; updatedAt: string;
}
```

A stage keeps one comment on the tracker and edits it in place; the run only records where that comment stands (phase 2 publishes). Transitions: `recordCommentDraft`, `recordCommentProposal`, `recordCommentPublished` (with the note id the host returned), `recordCommentEdited`, `recordCommentRefused`.

Transitions are pure functions in `src/shared/runs/`, each `(run, flow, input, now) => { run, messages }`: `startRun`, `stageDone`, `gateApprove`, `gateReject`, `gateSkip`, `ask`, `answer`, `handBack`, `reviewReturn`, `stageFailed`, `retry`, `cancel`, `resumeAfterRestart`. `messages` are forum drafts the caller appends to the run's thread, so the thread holds every post, handoff, question, answer and decision, in order. A `flow` is derived from the config (`flowOf`): the stages in rank order with their human flag and resolved agent.

### Forum

Thread: `{ id, kind: 'run' | 'general', runId, title, createdAt }`. Message: `{ seq, thread, at, kind, author, text, code?, params?, mentions[], refs[], stage, to?, replyTo?, public, published? }` with kinds `post | question | answer | handoff | decision | system` and author `agent <id> | person | app`. `system` and `decision` messages carry a `code` and `params`, rendered at display time with `t()`, so a language switch also translates the old thread.

A message has `public: boolean` (eligible to appear on the tracker: what an agent did, asked, was answered or was decided; handoffs and stage changes stay internal) and, once mirrored, `published: { target, noteId, url }`. The file is append only, so a publication is recorded as an annotation line (`{ type: 'published', seq, published }`) that reading folds into the message.

## Phase 1: data model and stores (this change)

Commits, one per part, tests and docs in each:

1. **Agent team in the config.** `AgentDef` and friends in `types.ts`; `agents.team` in schema, defaults and validation; schema 4 with `v3ToV4` (seeds the five system agents from `agents.roles`); pure helpers in `src/shared/config/team.ts` (`systemAgent`, `ensureSystemAgents`, `stageAgent`, `addAgent`, `updateAgent`, `removeAgent`). Validation: ids unique; id of a system agent reserved and flagged; stages exist; `stage.agentId` exists and a human stage has none; model resolves; artifact names are plain file names. Docs in `configuration.md`.
2. **The agent-flow template.** `StageDef` fields, the template and its team, `applyTemplate` merging the team without touching the person's agents (and dropping stage references that no longer exist), `templateFromConfig`/`parseTemplate` carrying the team, catalog texts in both languages, `cycles.md`, `CONTRIBUTING.md` note.
3. **Run store.** `src/shared/runs/` (types, JSON Schema of the file, `flowOf`, transitions) and `src/main/runs-core.ts` (store: one file per run, atomic write, newer versions never overwritten, one active run per issue) and `src/main/runs.ts` (bound to the workspace). Pure functions fully unit tested; the store tested against a temporary folder, including the end-to-end scenario of the spec.
4. **Forum store.** `src/shared/forum.ts` (types, mentions, rendering of system messages), `src/main/forum-core.ts` (JSONL store: ensure thread, append, list, read; repairs a torn last line; injected clock, redaction and listeners), `src/main/forum.ts` (module: `forum:list`, `forum:read`, `forum:post`, `forum:create`; push event `forum:message` through `emit`), web policy classification.

### IPC added in phase 1

| Channel | Does | Web policy |
|---|---|---|
| `forum:list` | thread summaries, newest activity first | allow |
| `forum:read(threadId, afterSeq?, limit?)` | messages of a thread after a sequence number | allow |
| `forum:post(threadId, text)` | a person's `post`, with `@agent` mentions resolved against the team | allow |
| `forum:create(title)` | a general thread | allow |
| event `forum:message` | `{ thread, message }` on every append | same stream as `agent:activity` |

All four are local reads or writes of the workspace's own folder. A browser may use them (the PWA is where a person answers from a phone). `test/forum-policy.test.ts` pins that none of them is in `EXTERNAL_EFFECT` or `DESKTOP_ONLY`. Mentioned agents answer with permission `read` whatever their own level (phase 2), so a post from a phone can never make a write-enabled agent write.

## Phase 2: the runner (later)

1. **Run service** (`src/main/runner/`): `startRun(card)` creates the run (one active run per issue), a worktree and a branch from the repository's default branch, the cycle folder inside the worktree, copies the issue and its comments to `0_ISSUE.md`, opens the thread. `step(runId)` runs the current stage when its status is `working`; every transition goes through one function that saves the run first and then appends the messages. `resumeAll()` at start: a `working` run restarts its stage (`resumeAfterRestart`), the others wait where they were. Cancel never deletes anything.
2. **Stage executor.** Builds the stage prompt (issue, thread so far, previous artifacts, the artifacts this stage must write, the question protocol) and runs it through `run()` of `agents.ts` generalised to an *agent spec* (`resolveAgentModel(AgentModel)` in `config-resolve.ts` for the explicit provider and model case; the role case is what `engineFor` does today). The result is structured: `{ summary, handoff, artifacts[], question? , verdict? }`. A question pauses the stage; the answer resumes the same attempt.
3. **Write-confined agents** (`permission: 'worktree'`, only the developer by default):
   - Claude SDK: `Edit`, `Write` and `NotebookEdit` move from `disallowedTools` to allowed for this call only, with a `PreToolUse` hook (`worktreeGuard`) that denies any path whose real path (symbolic links resolved; for a file that does not exist, its parent) is outside the worktree, inside `.git`, or a secret path (`secretPath`). `Bash` stays behind the allow-list hook, with the patterns taken from the workspace's configured run commands (a new `runner.commands` list in schema 5) plus read-only git; no shell metacharacters; environment stripped of tokens; no network tool is on the list.
   - Open engine: new `Write` and `Edit` tools in `src/main/engine/open/tools/` named and shaped like the SDK's, so the same `worktreeGuard` callback runs through `policyFromHooks`; the tools also check the root they were constructed with (defence in depth: the guard is not the only check).
   - Both engines get the same refusal tests: write outside, symbolic link out, `.git`, secret file, a command outside the list, `git push`.
4. **Commits** made by the app, never by the agent: `git add -A` then `git commit` in the worktree with `-c user.name -c user.email` from the workspace identity (new `runner.identity`; never `git config`), `-c core.hooksPath=/dev/null` (a hook the agent edited must not run outside the confinement), the message from the developer's structured output checked against `runner.commitPattern`, with no AI attribution. The review stage reads the diff with `--no-ext-diff --no-textconv`.
5. **Review loop**: the reviewer's verdict `approved` ends the stage; findings go through `reviewReturn`: with a pass count under the maximum (2) the work goes back to the developer with the findings as a handoff, otherwise the run asks the person.
6. **Writes to the code host**, at the end of implement and of review: `proposeVcsAction` with two new ops. `pushBranch` is described by the provider as a `git` command carrying only the run id (the executor looks the worktree up in the run store, so a stored action cannot name another folder), validated like `assertPlainPush` (one plain `HEAD:refs/heads/<branch>` to `origin`, no force); `createMr` for GitHub (`POST /repos/{o}/{r}/pulls`) and GitLab (`POST projects/:id/merge_requests`), body built from the artifacts and the issue link; Bitbucket's `planWrite` says unsupported and the run ends with a thread message asking for it by hand. The pull request is proposed when the push is done. Both pass through `approveAction`, `audited` and `assertExternalWrite`, so a test workspace refuses them. Mirroring thread messages to the issue is a third proposal kind, off by default (`runner.mirrorToIssue`).
7. **Autonomy**: `runner.autonomy`, `runner.triggerLabel` (default `coxia`), `runner.maxConcurrentRuns`; a scheduler job lists issues with the label through the provider, skips issues with an active run, starts up to the limit.
8. **IPC**: `runs:list`, `runs:get`, `runs:start`, `runs:cancel`, `runs:gate` (approve, reject, skip), `runs:answer`, `runs:retry`, `runs:ask-agent` (a mention). `runs:start` and the gate actions are local; web policy `allow`. The push and the pull request stay behind `actions:approve`.
9. **Schema 5** (`v4ToV5`): the `runner` section above.

## Phase 3: the screens (later)

Team section in Settings (list, create, edit, delete non-system, stages, permission, model picker over roles and providers) through `config:save` with the pure helpers of phase 1; the Cycle screen per run (stage timeline with agent and state, artifacts with links, the forum thread beside it, approve/reject/skip with reason at gates, an answer box for a pending question, an `@agent` mention box, the gate quiz as a tool); "Start cycle" and the run badge on the card; a forum list screen; the PWA gate for those screens; the pre-daily turn reporting a run's stage, what changed and what waits (a pending question is a blocker); notifications for gates and questions; the jobs dock and activity view following the stage agent.

## Risks

1. **A write-enabled agent is the largest risk of the project.** Its input is untrusted text (issue, comments, repository files) and its tools can change files. Layers: confinement to one worktree by real path, in the hook and again in the tool; no network and no push by construction (no tool, no allow-listed command); secret paths denied; commits made by the app with hooks disabled; every external write waiting for its own approval; a human at both gates and at the approval; the reviewer reads the diff. What is not covered: an allow-listed command (a test run) executes repository code, which can do anything the user can; mitigation is a short allow-list chosen by the person, a scrubbed environment and, where the machine has it, running those commands without network. Phase 2 states this as not verified against a real hostile repository.
2. **Prompt injection through the thread.** Forum text reaches later agents. Thread and issue text enter prompts as quoted data with the same wording the ceremonies use for card text; an agent's message is redacted before it is stored.
3. **Run store and thread out of step after a crash.** The run is saved first, then its messages appended: a crash in between loses a message, never duplicates one. Accepted; the history of the run holds the facts.
4. **Config drift of the five system agents.** Their model and instructions live in `agents.team` (for runs) and in `agents.roles` (read by the ceremonies). Editing a system agent through the helper writes both; editing `agents.roles` directly does not update the team entry. Phase 3 hides the duplicated fields from the roles editor.
5. **Stage references.** Applying a template that lacks a stage an agent was assigned to drops that reference; assignments of the agent cycle do not survive a round trip through another template. The default team is merged again on re-applying.
6. **Forum listing cost.** `forum:list` reads each thread file; threads are small, and a cached summary is a later optimisation if a workspace grows.
7. **Wizard offers the template before the runner exists.** Between phases the agent cycle can be picked and its ceremonies work, but nothing runs a stage. Not released between phases.

## Test strategy

- Phase 1 is pure or file based: no model, host or network. `test/config-schema.test.ts`, `config-migrations.test.ts`, `cycle-templates.test.ts` extended; new `agent-team.test.ts`, `runs-core.test.ts` (transitions), `runs-store.test.ts` (store and the full scenario), `forum-store.test.ts`, `forum-policy.test.ts`. The scenario test drives a run from start to `ready` with both gates approved, one gate rejection, one review round sent back, and one question answered, and checks the thread order and content.
- Phase 2 adds fakes to `test/helpers/`: a scripted engine (a stage returns a canned structured answer and, for the developer, performs tool calls through the real guard), the existing `fakeHost.ts`/`vcs.ts` for the code host, a temporary git repository (`conflictRepos.ts` pattern) for worktrees, commits and the refusals. The acceptance list of the spec maps one to one onto tests.
- Phase 3: renderer tests in the style of the existing screens, and a manual test plan (`3_TEST_PLAN.md`) against a scratch workspace.
- Gates before every phase is called done: `tsc`, the whole `vitest` suite, theme audit (total unchanged), `i18n:lint`, `public-audit`, `electron-vite build`.

## Acceptance trace

| Spec acceptance | Phase | Where |
|---|---|---|
| Start to "pull request proposed", gates, one review round, one question, thread in order | 1 (state and thread), 2 (execution) | `runs-store.test.ts` scenario; runner tests |
| Write outside, command outside the list, push: refused and reported in the thread | 2 | guard tests on both engines |
| Reject returns to the producing stage; skip recorded with reason | 1 | `runs-core.test.ts` |
| Restart in the middle of a stage resumes that stage | 1 (`resumeAfterRestart`), 2 (service) | tests |
| Create, edit, delete a non-system agent; system agent not deletable; stage without agent says so | 1 | `agent-team.test.ts`, `runs-core.test.ts` |
| Push and pull request wait in Actions; test workspace refuses | 2 | actions tests |
| Real repository, issue to pull request | 3 and manual | `3_TEST_PLAN.md` |

## Decision log

Choices taken where the spec is silent.

1. **The team is `agents.team`; system agents have the ids of the LLM roles.** The agent cycle's Refiner, Planner, Developer, Reviewer and QA are ordinary agents delivered by the template, so deleting one is allowed and the template can restore it.
2. **`StageDef.agentId` wins, `AgentDef.stages` is the fallback.** Both exist (the person edits an agent's stages in Team; a template names the agent of each stage). Validation errors when `agentId` names no agent and warns when the agent does not list the stage.
3. **`AgentDef.model` is `{ role, provider, model }`**, not a union: the config validator has no `oneOf`. `role` set means borrow; `role: null` needs a known provider and a model.
4. **System agent edits write through to `agents.roles`** (`modelRole`, `extraInstructions`), so the ceremonies keep reading unchanged code. The team entry is authoritative for runs.
5. **Missing system agents are added by `withConfigDefaults`** (a forward-compatible default like every other); validation errors for a system id used by a non-system agent and for `system: true` on another id. A system agent therefore cannot be removed by editing or importing a file.
6. **Applying a template merges its team by id**: agents already present are untouched, missing ones are added, and references to stages the new cycle lacks are dropped from every agent's `stages`.
7. **The cycle folder is flat** (`docs/cycles/<n>-<slug>/1_SPEC.md`, no `feat/` sub-folder): one flow for every kind of issue. Artifact names are `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md`, `4_REVIEW.md`, `5_TEST_PLAN.md`; artifact names must start with a letter or digit and hold no path separator.
8. **Stage kinds of the agent cycle** are existing ones (`ready` is `reviewApproved`), so no ceremony code changes; `stageMapping` is empty: the card's tracker stage is not driven by the runner, the run's stage is shown beside it in phase 3.
9. **A run is `done` when it enters the last stage.** The push and the pull request are proposed earlier, at the end of implement and review, as the spec says; `ready` is where the person acts on them.
10. **Review rounds:** a round is one review pass that ends in findings. Round 1 sends the work back; round 2 with findings stops the run and asks (`max` is 2, stored on the run).
11. **The review limit is a question** from the app. Answering it sends the run to `implement` with the answer as a handoff and a fresh budget of rounds.
12. **Run statuses:** `working`, `gate`, `question`, `failed`, `done`, `cancelled`. `failed` (a stage error, or a stage with no agent) waits for `retry` or `cancel`; the spec needs "a stage without an agent cannot start and says so", and a failed state is where that sentence lives.
13. **System and decision messages are stored as a `code` plus `params`** and rendered with `t()` at read time; free text is only what an agent or a person wrote.
14. **Forum files:** `<id>.jsonl`, first line the thread header; ids `^[a-z0-9][a-z0-9_-]{0,63}$` (a run thread is `run-<runId>`, general ones `general` and `g-<slug>`); sequence numbers per thread, gap free; text capped at 20,000 characters; a line that does not parse is skipped on read, and a torn last line is closed with a newline before the next append.
15. **Run store:** every file is validated against a JSON Schema on read; a file with a newer `version` is neither listed as usable nor ever overwritten; `rev` increases on every save; one non-terminal run per issue ref, enforced at creation. Run ids are `r-<base36 time>-<4 random chars>`.
16. **`runs/` and `forum/` are not added to `WORKSPACE_DIRS`**: that list recognises the flat layout of installs older than workspaces, and a new folder must not make a fresh root look like one.
17. **Forum channels are open to a paired browser**, and mentions only ever run read-only agents.
18. **`agent-flow` is registered last in `BUILT_IN_TEMPLATES`** and uses the `sdd` prompt family; its agents' names, jobs and instructions are catalog keys (`cycle.agentFlow.*`), like the other texts of a template, so they follow the language until the person edits them into literals.
19. **Mention syntax is `@<agent id>`**, case-insensitive, only for agents that exist; an unknown `@word` is left as text.
20. **Agent text is redacted** (`redact` of `errorlog-core.ts`, injected into the store) before it is written to a thread.
21. **No run IPC in phase 1**: nothing can start, change or read a run from the outside until phase 2 defines who may.
22. **The runner section of the config waits for phase 2** and becomes schema 5; a version number is cheap and a config written by a phase 1 build must keep opening.
23. **The app's commits run with hooks disabled** (`core.hooksPath=/dev/null`): a tracked hook an agent edited would otherwise run unconfined.

24. **Tracker comments are recorded, not published, in phase 1.** `Run.comments` is keyed by stage id and `pr` (a stage with the id `pr` draws a validation warning), each record `{ target, noteId, url, bodyHash, status, updatedAt }` with status `draft | proposed | published | refused`, so a stage can edit its own comment in place instead of posting a second one. A proposal over a published comment keeps its note id (it is an edit); a refusal never demotes a published comment. The transitions apply to a run in any status (the pull request comment comes after `done`); the body hash is computed by phase 2, the model has no hashing. Templates, configuration and the publishing itself are phase 2.
25. **`public` is a flag, not a message kind**, because a question, a decision and a post are all public records while a handoff of the same author is not. The transitions mark posts, questions, answers and decisions public and leave handoffs and stage changes internal; a person's plain `forum:post` is internal. Being public never publishes: mirroring needs the workspace option and its own approval.
26. **A message's `published` link is an annotation line**, since thread files are append only; `forum-core` folds the latest annotation into the message when it reads.

## Not verified yet

Everything here is a plan. Nothing has run against a real model, a real repository or a real code host; phase 2 will say so in its own documents and tests.
