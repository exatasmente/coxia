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
  autonomous: boolean;   // runs by itself (see Autonomy below); off for the five system agents, on for the default team
  instructions: string;  // appended to its system prompt, catalog key or literal
  system: boolean;       // the five built-in agents: edited, never deleted
}
```

The five system agents have the ids of the five LLM roles (`turn`, `reply`, `deep`, `teams`, `fix`), no stages and permission `read`. They are what the ceremonies call today. The default team of the agent cycle (Refiner, Planner, Developer, Reviewer, QA) is five more agents, not system.

### StageDef additions

`agentId?: string` (the agent that works the stage), `artifacts?: string[]` (file names the stage must produce in the cycle folder), `human?: boolean` (a gate: waits for the person). The agent of a stage is `stage.agentId` when that agent exists, else the first agent of the team whose `stages` lists the stage, else none (the stage cannot start and says so).

### Autonomy

Autonomy belongs to each agent, which the person switches on and off, so a cycle can be hybrid: autonomous agents, human gates and agents that wait for the person.

| | Autonomous | Not autonomous |
|---|---|---|
| The stage | starts when the run reaches it | waits for the person to start it (`to-start`) |
| Its tracker comments and reviews | posted automatically, recorded in the audit log | wait in Actions for a "yes" |
| Its result | goes to the next stage without waiting | waits for the person to accept it, or send it back with a note (`to-accept`) |

Gates are unchanged. Pushing the branch and opening the pull request always wait for the person, whatever the flag, and a test workspace refuses every external write. A change of the flag takes effect at the next stage start or publication, never in the middle of a stage: a stage record keeps the value its agent had when the stage was entered (and `startStage` refreshes it), and phase 2 reads the flag at the moment it decides to publish. The ceremonies ignore the flag. Phase 1 builds the flag, the two waiting states and their transitions (`startStage`, `acceptStage`, `returnStage`, with `stageDone`, `reviewReturn` and `handBack` parking the result of a non-autonomous agent in `Run.pending`); phase 2 implements the behaviour around them: automatic start, automatic publication with an audit entry, proposals in Actions for the comments of a non-autonomous agent, and the buttons of phase 3.

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
  status: 'working' | 'gate' | 'question' | 'failed' | 'to-start' | 'to-accept' | 'done' | 'cancelled';
  stage: string;
  stages: StageRecord[];          // one per stage entered: agent, status, artifacts, startedAt, endedAt, attempts
  question: PendingQuestion | null;
  pending: PendingResult | null;   // the result of a non-autonomous agent, waiting for the person (to-accept)
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

Transitions are pure functions in `src/shared/runs/`, each `(run, flow, input, now) => { run, messages }`: `startRun`, `stageDone`, `gateApprove`, `gateReject`, `gateSkip`, `ask`, `answer`, `handBack`, `reviewReturn`, `startStage`, `acceptStage`, `returnStage`, `stageFailed`, `retry`, `cancel`, `resumeAfterRestart`. `messages` are forum drafts the caller appends to the run's thread, so the thread holds every post, handoff, question, answer and decision, in order. A `flow` is derived from the config (`flowOf`): the stages in rank order with their human flag and resolved agent.

### Forum

Thread: `{ id, kind: 'run' | 'general', runId, title, createdAt }`. Message: `{ seq, thread, at, kind, author, text, code?, params?, mentions[], refs[], stage, to?, replyTo?, public, published? }` with kinds `post | question | answer | handoff | decision | system` and author `agent <id> | person | app`. `system` and `decision` messages carry a `code` and `params`, rendered at display time with `t()`, so a language switch also translates the old thread.

A message has `public: boolean` (eligible to appear on the tracker: what an agent did, asked, was answered or was decided; handoffs and stage changes stay internal) and, once mirrored, `published: { target, noteId, url }`. The file is append only, so a publication is recorded as an annotation line (`{ type: 'published', seq, published }`) that reading folds into the message.

## Phase 1: data model and stores (this change)

Commits, one per part, tests and docs in each (a fifth, added later at the maintainer's request, makes autonomy a flag of each agent with the two waiting states it needs):

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

## Phase 2: the runner

Split in two. **2a (built, see the Decision log from 31 on and [`docs/runner.md`](../../../runner.md))**: the `runner` section (schema 5), the run service (start, worktree, issue record, stage executor on both engines, write confinement, the app's commits, autonomy, scheduler, restart, timeout, questions, mentions), the `runs:*` channels and their web policy. **2b (built, Decision log from 51 on)**: the comment templates of the cycle (schema 6), the stage comments and their check, publication through the actions door by the agent's autonomy, the line review on the pull request on the three hosts, the push and the pull request as proposals, and the credential fix 2a reported. Phase 3 (the screens) is what is left. The numbered list below is the original plan; where 2a or 2b chose otherwise the Decision log says so (mirroring thread messages, item 6's last sentence, was replaced by the templates).

1. **Run service** (`src/main/runner/`): `startRun(card)` creates the run (one active run per issue), a worktree and a branch from the repository's default branch, the cycle folder inside the worktree, copies the issue and its comments to `0_ISSUE.md`, opens the thread. `step(runId)` runs the current stage when its status is `working`; every transition goes through one function that saves the run first and then appends the messages. `resumeAll()` at start: a `working` run restarts its stage (`resumeAfterRestart`), the others wait where they were. Cancel never deletes anything.
2. **Stage executor.** Builds the stage prompt (issue, thread so far, previous artifacts, the artifacts this stage must write, the question protocol) and runs it through `run()` of `agents.ts` generalised to an *agent spec* (`resolveAgentModel(AgentModel)` in `config-resolve.ts` for the explicit provider and model case; the role case is what `engineFor` does today). The result is structured: `{ summary, handoff, artifacts[], question? , verdict? }`. A question pauses the stage; the answer resumes the same attempt.
3. **Write-confined agents** (`permission: 'worktree'`, only the developer by default):
   - Claude SDK: `Edit`, `Write` and `NotebookEdit` move from `disallowedTools` to allowed for this call only, with a `PreToolUse` hook (`worktreeGuard`) that denies any path whose real path (symbolic links resolved; for a file that does not exist, its parent) is outside the worktree, inside `.git`, or a secret path (`secretPath`). `Bash` stays behind the allow-list hook, with the patterns taken from the workspace's configured run commands (a new `runner.commands` list in schema 5) plus read-only git; no shell metacharacters; environment stripped of tokens; no network tool is on the list.
   - Open engine: new `Write` and `Edit` tools in `src/main/engine/open/tools/` named and shaped like the SDK's, so the same `worktreeGuard` callback runs through `policyFromHooks`; the tools also check the root they were constructed with (defence in depth: the guard is not the only check).
   - Both engines get the same refusal tests: write outside, symbolic link out, `.git`, secret file, a command outside the list, `git push`.
4. **Commits** made by the app, never by the agent: `git add -A` then `git commit` in the worktree with `-c user.name -c user.email` from the workspace identity (new `runner.identity`; never `git config`), `-c core.hooksPath=/dev/null` (a hook the agent edited must not run outside the confinement), the message from the developer's structured output checked against `runner.commitPattern`, with no AI attribution. The review stage reads the diff with `--no-ext-diff --no-textconv`.
5. **Review loop**: the reviewer's verdict `approved` ends the stage; findings go through `reviewReturn`: with a pass count under the maximum (2) the work goes back to the developer with the findings as a handoff, otherwise the run asks the person.
6. **Writes to the code host**, at the end of implement and of review: `proposeVcsAction` with two new ops. `pushBranch` is described by the provider as a `git` command carrying only the run id (the executor looks the worktree up in the run store, so a stored action cannot name another folder), validated like `assertPlainPush` (one plain `HEAD:refs/heads/<branch>` to `origin`, no force); `createMr` for GitHub (`POST /repos/{o}/{r}/pulls`) and GitLab (`POST projects/:id/merge_requests`), body built from the artifacts and the issue link; Bitbucket's `planWrite` says unsupported and the run ends with a thread message asking for it by hand. The pull request is proposed when the push is done. Both pass through `approveAction`, `audited` and `assertExternalWrite`, so a test workspace refuses them. Mirroring thread messages to the issue is a third proposal kind, off by default (`runner.mirrorToIssue`).
7. **Autonomy of the run**: per-agent behaviour as in the Autonomy table (start, publish, accept); on top of it `runner.autonomy` (the app starting runs by itself), `runner.triggerLabel` (default `coxia`), `runner.maxConcurrentRuns`; a scheduler job lists issues with the label through the provider, skips issues with an active run, starts up to the limit.
8. **IPC**: `runs:list`, `runs:get`, `runs:start`, `runs:cancel`, `runs:gate` (approve, reject, skip), `runs:answer`, `runs:retry`, `runs:ask-agent` (a mention). `runs:start` and the gate actions are local; web policy `allow`. The push and the pull request stay behind `actions:approve`.
9. **Schema 5** (`v4ToV5`): the `runner` section above.

Seams 2a leaves for 2b:

- **Findings and scenarios** are in the run file as given: `Run.reviews[]` (`round`, `stage`, `by`, `at`, `verdict`, `summary`, `findings[]` with `path`, `line`, `endLine`, `side`, `severity`, `body`, `suggestion`, and `head`, the commit the pass looked at) and `Run.qa[]` (`scenarios[]`, `head`); the text the thread and the developer got is `findingsText` / `failuresText` (`src/shared/runs/output.ts`). The review's diff base is `Run.base`.
- **Comment records** (`Run.comments`, `recordComment*` of phase 1) are untouched: nothing in 2a calls them. The place to call them from is `settle()` and `move()` of `src/main/runner/service.ts`, which see every stage result and every gate decision, and where the agent's `autonomous` flag is read at that moment (`deps.config()`).
- **Agent output** has the shape `StageOutput` (`src/shared/runs/output.ts`): `summary`, `artifacts`, `handoff`, `question`, `verdict`, `findings`, `scenarios`; a stage comment is rendered from it and from the stage's documents, so 2b adds fields there, not a second pass over the model.
- **Push and pull request**: `src/main/runner/git.ts` has no push on purpose (`test/runs-policy.test.ts` fails if one appears there); 2b adds its own module that goes through `actions.ts`, and reads the branch and the worktree from the run.
- **Mirroring thread messages** needs `ForumMessage.public` (set by the transitions) and `markPublished` of the forum store; nothing in 2a reads them.

2b used the seams so: `settle()` and `move()` of the service call the publisher (`src/main/runner/publish.ts`) after the run has moved; the comment is composed from `StageOutput.comment` and `.pr` (the fields 2b added there) and the stage's template; `Run.reviews` is what the review is built from; `Run.comments` keeps, besides where each comment stands, the text last written (`body`), its first line (`headline`) and the pull request's `title`; `ForumMessage.public` and `markPublished` link the thread to what was posted; the push and the pull request go through `runner/door.ts`, the one file of the runner that imports Actions, and `test/runs-policy.test.ts` names it.

### What phase 3 needs from 2b

- **Data** (all in the run file, nothing new to store): `Run.comments[key]` with `status` (`draft`, `proposed`, `published`, `refused`), `noteId`, `url`, `body`, `headline`, `title`; the keys are the stage ids, `decision-<gate>-<n>`, `question-<stage>-<n>`, `review-<round>` and `pr` (its `noteId` is the pull request's number). `Run.reviews[].findings` and `Run.qa[]` as in 2a. The forum messages carry `published` once mirrored.
- **Actions** (`actions:list`, existing): a proposal of the runner has `unit` = `{ runId, purpose: 'comment' | 'review' | 'run-pr', key, ... }`; `kind` `run-push` is the push; a group has `commands` and `done`. The Cycle screen can show "waits for your yes" for a stage by finding the proposal whose `unit.runId` and `unit.key` match, and link to Actions.
- **Audit** (`auditoria:list`, existing): the entries of automatic posts have `by` (the agent) and `bodyHash`, and `origin.kind` `auto`; a run's screen can list them by `origin.key` (`comment:<runId>:<key>`, `review:<runId>:<round>`).
- **Thread codes** the screen renders through `messageText`: `runner.comment.{posted,edited,proposed,held,refused,failed,markup,unreadable,noHost}`, `runner.review.{waiting,proposed,held,posted,refused,failed}`, `runner.push.proposed`, `runner.pr.{proposed,created,failed}`, `runner.publish.failed`.
- **Not built, for phase 3 or later**: undoing an automatic post from the run ("delete" as a proposed action: there is no delete operation in any provider's list yet); a button to release a held comment as it is, or to edit its text before the "yes"; a per-run view of the review's threads; editing the pull request's description after it was opened.

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
| Push and pull request wait in Actions; test workspace refuses | 2b | `runner-publish.test.ts` ("the push and the pull request", "a test workspace"), `actions-group.test.ts` |
| Comments per stage, in place, found by marker, by template; held or refused when they should be | 2b | `runner-publish.test.ts`, `runs-comment.test.ts`, `comment-config.test.ts` |
| Review on the lines: one review per round, suggestion, file and general comments, round 2 replies and resolves, never approves | 2b | `runner-publish.test.ts`, `runner-review.test.ts`, `vcs-review.test.ts` |
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

27. **Autonomy is a flag on each agent** (`AgentDef.autonomous`), off by default (a new agent, the five system agents) and on for the default team of the agent cycle. A file written before the flag existed reads as off, so no schema bump: the v3 to v4 migration seeds the system agents with it off. Validation warns for an autonomous agent that works no stage.
28. **Two waiting states, `to-start` and `to-accept`**, with a `pending` result on the run. Entering a stage whose agent is not autonomous waits for `startStage`; the finished result of such an agent (a stage done, review findings, a hand back) is parked and goes out only on `acceptStage`, which also counts a review round; `returnStage` sends the stage back to the same agent with a required note and starts it at once. What the person directs (the run's first stage, rejecting a gate, answering the review limit, retrying, returning with a note) starts the stage at once whatever its agent's flag.
29. **A stage record keeps the autonomy its agent had when the stage was entered**, so editing the flag never changes a stage in progress; `startStage` re-reads it, which is the "next stage start" the flag change waits for.
30. **A person's accept is a public decision** (`stage.accepted`), like a gate approval; a return with a note is `stage.returned` plus a handoff from the person to the agent.

31. **The `runner` section** is `enabled`, `triggerLabel` (default `coxia`), `maxConcurrentRuns` (default 1), `worktreesDir` (null: `worktrees/` in the workspace's data folder), `commands`, `stageTimeoutMs` (default 30 minutes), `identity` and `commitMessage` (default `feat: {summary} #{iid}`). It replaces the plan's `runner.autonomy`, `runner.commitPattern` and `runner.mirrorToIssue` (the last belongs to 2b). `commands` is `string[] | null`: null means the repository's `test` and `typecheck` scripts (`npm test`, `npm run typecheck`, read from the commit the branch was cut from), `[]` none. A command is one plain command, matched character for character; an operator in it is a validation error, because the open engine runs it without a shell and the SDK's shell would read it differently.
32. **Who writes documents and commits: the app.** The agent returns each document as `{name, content}`; the app writes it into the cycle folder (only the names the stage lists; others are ignored and said so) and commits with `git add -A`. A read agent therefore produces its documents without any write tool, and the commit never depends on a model choosing to run git. The commit subject is `commitMessage` with the agent's short `commit` text (one line, lowercase first letter, no full stop, 72 characters; any text that mentions a tool or an attribution is replaced by a fixed one, in English).
33. **One commit per stage attempt, and one at the start** (`add the issue record`). A question writes the documents it has so far and commits nothing; the commit comes when the stage is done. The commits stay on the branch: nothing rewrites them.
34. **The cycle folder is `docs/cycles/<n>-<slug>`**, a constant (`CYCLES_DIR`), as the spec says; the branch is `cycle/<n>-<slug>`. The slug is the title in lowercase ASCII words, at most 40 characters. A branch or a folder that exists is a refusal, never reused; the only thing the runner removes is the worktree and branch a failed start made.
35. **Which repository:** the one in `projects.repos` whose `projectPath` is the issue project, else the only repository, else the one `runs:start` names, else a refusal that says so. A repository with no local checkout is looked up by its origin (`findClone`).
36. **The issue is read once, at the start**, into `0_ISSUE.md` (description and human comments, masked with `redact`); stages never read the tracker again, so a comment added later is not seen. The description needed a new `VcsIssue.body` (read from GitHub, GitLab and Bitbucket).
37. **The run keeps what the agents found** (`Run.reviews`, `Run.qa`, `Run.base`) as optional fields of the run file: a file written before them reads as having none, and the format stays version 1 (phase 1 was never released).
38. **A review that lists a blocking finding is not approved, whatever its `verdict` says**; a `verdict: changes` with no finding still sends the work back, with the summary as the findings. A suggestion is kept only for a finding that names a line; a range needs a first line and ends at or after it.
39. **QA that fails hands the work back to the developer's stage** (the first stage before QA whose agent may write) and counts a review round, so review and QA share the budget of two; at the limit the question is the same review-limit question, whose answer goes to the stage before the one that asked (the reviewer, for QA). Left open for the maintainer: a separate counter for QA.
40. **A stage that runs out of turns is a failure**, not a partial answer (the ceremonies' wrap-up call is not used): an implementation half done must not be reported as done. Turn limits are constants (80 for an agent that writes, 30 for one that reads, 20 for a mention).
41. **The thread is the answer channel.** A person's `forum:post` in a run's thread whose run waits for an answer is recorded as the answer (an `answer` message, not a `post`), unless it names an agent: that is a question to the agent. `forum.ts` knows nothing of the runner: it offers `interceptPosts`, and the runner registers. `runs:answer` does the same without the post.
42. **Web policy.** `runs:list`, `runs:get` and `runs:answer` are open to a paired browser (the phone is where a person answers, and an answer only lets the stage that asked go on under the same confinement; it can also answer the review-limit question, which sends work to the developer: accepted, since the same person can already steer by a post). `runs:start`, `startStage`, `accept`, `return`, `gate`, `retry`, `cancel` and `setAutonomous` are desktop only: they start work, change a run or change what an agent does by itself. None is an external effect, because nothing in 2a writes to the code host; `test/runs-policy.test.ts` pins both lists and that no runner file imports Actions, an executor or a push.
43. **The scheduler counts runs that are `working`** against `maxConcurrentRuns` (a run parked at a gate, a question, a failure or a waiting state costs nothing), starts the oldest issue first, never starts an issue that ever had a run, and tries an issue it cannot start once per app session. A run the person starts is never held back. The issues come from `listMyIssues` of the primary integration filtered by label: assigned to the person, open, label compared without case. A provider with no issue listing starts nothing.
44. **Notifications** use the app's existing ones, for a gate, a question, a failure, a stage waiting to start, a result waiting to be accepted and the end, when the status changes; they open Today (there is no run screen until phase 3).
45. **Activity is correlated by job id** `run:<runId>`: every agent call of a run (stage or mention) runs inside `withActivityContext`, so the live view and the jobs dock can follow a run through `agent:activity:get`.
46. **A mention is answered by the named agent, read only, with no confinement object at all**, in a queue of one per run; the answer is an internal `post` (not public). A failed answer is a system message in the thread. Only a person's message calls an agent: an agent's own message naming another does nothing.
47. **The guard.** One function, `checkPath` in `src/main/engine/guard.ts`, answers for the SDK hook (`runner/hooks.ts`) and for the open engine's `Write` and `Edit` (which call it again inside the tool, with `O_NOFOLLOW`). It returns the path to use, resolved through real directories, so the tool never writes where the text of the path pointed. Reads are confined to the worktree too. `.husky`, `.githooks`, `.gitattributes` and `.gitmodules` are refused for a write along with `.git`, because they make git or a package manager run something. `~` is expanded and then judged like any path. The open engine's commands run without a shell and with the environment scrubbed of credential-looking names; the SDK's cannot be scrubbed (the SDK process needs the provider's key) and the docs say so.
48. **Commits are made with `core.hooksPath=/dev/null`, `commit.gpgsign=false` and `core.fsmonitor=false`**, an explicit `-c user.name -c user.email` and `--no-verify`; the identity is `runner.identity` or what `git config --get` already finds, and a start is refused when there is neither. Nothing is ever written to a git config.
49. **The review reads the branch's diff from `Run.base`** with `--no-ext-diff --no-textconv`, the cycle folder left out, cut at 60,000 characters with a line saying so; the commit of the review document comes after, so `ReviewRecord.head` is the commit the reviewer looked at.
50. **Prompts** are `prompt.sdd.runner.*` (the base family, as for every id with no role head), with their `.novoice`-free wording; text from outside is fenced in `<data>` tags (a `</data>` inside it is neutralised) and the system text says it is material, not instruction. The prompts are not yet in `APP_PROMPTS` of the retention and cost screens: sessions of the runner show as the person's own until phase 3 decides how.

51. **The comment is written by the stage's own agent, in the same answer**, not by a second call: the stage prompt carries the template's sections (heading and guidance) and the comment standard, and the answer has a `comment` field (a text per section, plus `technical`); the stage that ends with the push also answers `pr` (title and sections). Cheaper (no second model call per stage) and as reliable as a formatting call can be made without a real model to measure: the sections are matched to the template by heading, or by place when the agent wrote as many as the template has, and an answer with no `comment` falls back to the stage's summary under the first section. The status line is never the agent's: the template makes it, with the round and the result the app knows.
52. **Composing and checking are separate and the check is on the final text.** `renderComment` is deterministic (status in bold on the first line, `### heading` sections in the template's order, a collapsed `<details>` last, a hidden marker at the very end; the template's `title` is for Actions and the thread, not the body). `checkComment` then rewrites what can be rewritten without changing the meaning (secrets by `redact`, a path in the worktree to a path in the repository, any other absolute path to its last name, the run's id out of the text but kept in the marker, a mention to code) and reports what cannot (agent, tool and forum words, first person outside a quote, code and the technical detail, and the structure). A reported problem turns the post into a proposal even for an autonomous agent: the person reads it with the problems on top.
53. **Autonomy is the stage record's value at the moment the stage ended** (passed in the event), not the live flag at publication, so a switch changed in the middle of a stage never reaches back; a gate's decision follows the stage that produced what it judged, as it stood when the person decided. This is the plan's "next stage start or publication" made exact: the flag is read when the thing that publishes happens.
54. **Keys of `Run.comments`:** the stage id for a stage's comment (edited in place), `decision-<gate>-<n>` (one per decision: a rejection and the approval after it both stay readable), `question-<stage>-<n>`, `review-<round>` and `pr`. The review is per round, not "one comment per stage": its general comment is the body of a review, which the closed list of writes does not let the app edit, so each round has its own and the round is in the marker. A short comment that links to the full one is posted only for an autonomous agent, only when the first line of an edited comment changed, and never for a review (the review itself notifies).
55. **Publication is a per-run queue, not part of the stage**: the run moves first, the comment follows in order, and a failure to publish (the host down, a refusal, a changed markup) is a thread message and never a failed stage. `idle()` waits for it, so tests and a restart see it done.
56. **One door.** `publish.ts` decides what goes out and plans each write with the provider; `door.ts` is the only runner file that imports Actions (proposals, groups, the audited write of an autonomous agent, the push, the refusal of a test workspace). `test/runs-policy.test.ts` was changed for this and only for this: it now names the two files, pins that only `door.ts` imports Actions and only `publish.ts` plans a write or reads the host's pull request, thread and diff, and keeps "no git push anywhere in the runner".
57. **The push is a run-scoped action kind (`run-push`), not a provider operation.** A provider describes calls to its own API; a push is git. The action carries the run's id and the branch, never a path; approving it reads the worktree from the run's file, refuses a worktree on another branch or with an uncommitted change, and pushes `HEAD:refs/heads/<branch>` with `--no-verify`, no force, through the same audit as the conflict push. **The pull request is proposed when the push is done** (a pull request cannot be opened on a branch the host does not have), by a listener on Actions (`onActionDone`), not "after the review's approval": the review runs without waiting for the person, so it waits as a draft until the pull request exists, then the latest waiting round goes out. A pull request the person opened by hand is found through the issue's linked pull requests (`linkedMrs`, by branch) and is used.
58. **A round is one action: a group.** `proposeVcsGroup` puts several commands in one proposal (`commands`, with `done` counting how many ran) and `approveAction` runs them in order, each audited under the proposal, stops at the first failure and resumes from there; an autonomous round runs the same commands through `runVcsAuto`, one audit line per call under one key. The plan said "one audit record"; on GitHub the review is one call, on GitLab and Bitbucket it is several, and the log says what the host was really sent.
59. **What each host does with a review** is in `docs/vcs-providers.md`; the choices that were not obvious: GitHub's reviews endpoint takes no file comment, so a file comment is a separate review comment (`subject_type: file`); GitLab has no "request changes" call, so the verdict is the status line of the general note, and a comment on a file uses `position_type: file` from 16.10 (a guess, conservative: before it the comment stands on the first changed line, saying so); Bitbucket has no suggestion block and no comment on a file, so it describes the replacement and stands on the first changed line; every one refuses the review when the head moved (GitLab, which needs it) or takes the commit the positions were computed from (GitHub's `commit_id`).
60. **A suggestion block only when the comment stands exactly where the finding says**: the lines are in the diff, on the new side, not moved to the file. GitLab's block says how many lines above it replaces (`-N+0`, N from the range). Otherwise the replacement is described in a plain code block. Nothing the app writes is `APPROVE`: GitHub's validator refuses the event.
61. **Rounds after the first read the threads.** A comment's marker names the run, the round and the finding's place in that round; the original finding is read from `Run.reviews`; it is "the same" as one of the new round's when the file is the same and the words overlap by at least half (or the replacement is the same), whatever the line. Same: a reply in the thread, no new comment. Gone: a reply and, where the host resolves threads, a resolution. New: a thread. The judgement is a heuristic and the thread says what it did.
62. **The credential fix** (2a's open risk): the Claude SDK's child inherits the SDK process's environment, key included. `scrubShellHooks` wraps the shell guard: after the guard has matched the allowed command character for character, the hook answers `allow` with `updatedInput.command` rewritten to `env -u NAME ...` for every credential-looking name (the list `scrubbedEnv` of the open engine already drops) found in the environment the SDK child is given. The rewrite is allowed outright because it no longer matches the rules, which were applied to the original. The open engine already ran its commands with a cleaned environment and ignores `updatedInput`. Tested on the options the SDK receives and by running the rewritten command; the real SDK's behavior with `updatedInput` is in its types and was not observed.
63. **Schema 6** adds `devCycle.comments` (a template is `title`, `status`, `sections[{heading, guidance}]`, `technicalDetail`; keys are stage ids and `gate`, `question`, `pr`). The agent cycle brings the defaults; the other cycles bring none and post nothing; the migration gives a workspace on the agent cycle the defaults and any other none. Validation warns about a template nothing uses and a status with a placeholder that does not exist.
64. **`CommentRecord` gained `body`, `headline` and `title`** (optional: a file from before reads fine): the text last written, so Actions shows it, a draft waiting for its pull request posts it later, and an edit can tell whether the first line changed.
65. **A newer proposal of the same thing replaces the one that waits**: a proposal that carries a `unit` with the run, the key and the purpose (a comment, a review round, the push) skips the pending one of the same three, so Actions never holds two texts of one comment and the "sim" that comes is for the latest.
66. **On a pull request that is the person's own, the review is a comment.** GitHub and Bitbucket refuse a request for changes from the author; the app compares the pull request's author with the account of the integration and, when they are the same, sends `comment` (the status line of the general text still says "changes requested"). Without this the whole round would fail at its first call.
67. **An unfinished `delete`.** The spec says every automatic post can be undone from the run with a proposed delete. No provider has a delete operation in its list yet and none was added: it needs the operation, its validator on each host and a button, and is left for phase 3 with the screens.

## Not verified yet

Phase 1, 2a and 2b are built and tested against fakes: a scripted engine, a code host with a memory (GitHub's shape, the real provider and the list of writes in front of it), per-provider planned commands for GitLab and Bitbucket, and temporary git repositories with a local origin. Nothing has run against a real model, a real repository of a real project or a real code host; [`docs/runner.md`](../../../runner.md) and [`docs/vcs-providers.md`](../../../vcs-providers.md) say what that leaves open. Phase 3 is still a plan.
