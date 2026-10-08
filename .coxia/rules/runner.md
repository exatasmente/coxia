---
checked-commit: 8685a5fd22d1121c5ff0b0de24e57f17482692e3
checked-date: 2026-10-07
evidence: [src/main/runner/service.ts:1-120, src/main/runner/door.ts:1-35, src/main/runner/executor.ts, src/main/runner/memory.ts, src/main/runner/git.ts, src/main/engine/guard.ts:1-80, src/shared/config/squads.ts:74-94, test/runner-memory.test.ts, test/worktree-guard.test.ts, docs/runner.md:1-130]
summary: How the runner takes an issue through the agent cycle: worktree, stages, gates, autonomy, the one write door and the cycle memory
stages: [development, review]
roles: [developer, tech-lead, qa]
---

# The runner

The runner takes an issue through the agent cycle (`agent-flow`): it creates a branch and a
worktree of the issue's repository, copies the issue into the cycle folder, and runs the
agent of each stage, one at a time, until a gate, a question, a failure or the end. What it
does stays in the worktree and the run's thread. Nothing in the runner writes to the code
host: the issue is only read, and what leaves the machine goes through the one door below.

## Starting a run

`runs:start(ref)` (the card reference, such as `app#101` or just `101`). The app reads the
issue and its comments through the provider, read-only, and then:

1. Picks the repository: the one in `projects.repos` with the issue project's `projectPath`
   (or the only one, or the one the call names); without a local clone it looks for one by
   the remote.
2. Fetches the default branch (one read) and creates the worktree at
   `<worktreesDir>/<repo>/<n>-<title>` on a new branch `cycle/<n>-<title>`. A branch or a
   folder that already exists is refused, never reused.
3. Writes `docs/cycles/<n>-<title>/0_ISSUE.md` (title, URL, labels, description and human
   comments, with anything that looks like a credential masked) and commits it.
4. Links the clone's dependency folders into the worktree, opens the thread and enters the
   first stage. Whoever starts the run starts the first stage too.

There is only one run per issue at a time, and only in a workspace whose cycle is the agent
cycle. If any step fails after the worktree exists, the worktree and branch this call created
are removed: that is the only thing the runner deletes.

**Dependency folders.** A worktree is born without `node_modules` or `.venv`. The app links
what the clone has and the worktree lacks (`node_modules` and `.venv` at the root, one folder
down such as `sidecar/.venv`, and under `packages`, `apps`, `libs` and `services`; at most
30), only where the repository ignores the folder (`git check-ignore`, checked before linking)
and never over something that exists. The commands of a run use the clone's dependencies. An
agent still cannot write through that link: the guard refuses a path that leaves the worktree
through a symbolic link. Turn it off with `runner.linkDependencies: false`.

## One stage

For the current stage, its agent receives a prompt built by the app: the work, the agent's
instructions, the documents the stage must produce, the cycle folder's content so far, the
last messages of the thread, the handoff another stage left, and the person's answer to one of
its questions. Everything that came from outside goes between `<data>` marks, and the system
text says it is material, not instruction. The texts are catalog entries
(`prompt.<family>.runner.*`).

The answer is structured: `summary`, `commit` (the code commit subject, English, imperative,
lowercase, without a type prefix or issue number), `artifacts` (name and full content of each
document), `handoff`, `question`, `needsPerson`, `reporterQuestion` (first stage only),
`priority` and `milestone` (only in the stage that owns priority), `comment` and `memory`.

**Documents do not repeat the issue header.** The prompt asks each document to open with a
title of its own, without the issue reference, title or URL, and that a release note's title
says what changed without the internal reference. The app also normalizes what arrives that
way when it stores it.

**Only what was verified is asserted.** The system text of every runner agent says to state
only what the stage verified (read, ran or saw working) and to mark the rest as not verified.
The app does check one narrow claim of that kind: a QA scenario that says it was executed has
to rest on a command the stage's own sandbox ran, and the app records it as read when nothing
backs it (see "What a QA stage says it ran" below). Everything else the agent asserts is its
own word: the app does not check whether it is true.

**What a QA stage says it ran.** In a QA stage with a sandbox, a scenario answered as
`executed` with no command of its own backs it is checked against what the stage's sandbox
ran: the same scenario comes back to the agent once, in the same stage and with the same
tools, to keep the evidence it looked at, point at the command behind the claim, or say it
was only read (or did not run). A scenario that still has nothing behind it after that one
round is recorded as read and marked unbacked, and the conversation says so. A downgraded
scenario does not fail the stage: only a failed scenario whose severity blocks sends the work
back. What the run recorded is the one source the test plan, the QA comment and the run's
record are written from, so a scenario the app recorded as read is never called executed in
any of them. The test plan stops being the agent's text whole: the app writes the recorded
scenarios as their own section, taken from the record, and keeps out the agent's own scenario
lines, so one scenario is written once and only from the record; the plan's other sections
stay as the agent wrote them.

**What the agent looked at.** An image of the stage's output folder the agent opened with the
`ViewImage` tool and did not keep is kept by the app as evidence of the stage when the stage
concludes, before the sandbox (and the stage's folder) is removed: it appears in the run's
conversation, and what could not be kept (not an image, over the ceiling, gone) is said there
as looked and not kept, with the reason. An image the agent itself kept is not kept twice.

**The app runs commands before QA.** Before the QA stage, the app runs in the run's worktree,
against the delivered code, the commands the workspace allows (`runner.commands`; with no
list, the repository's test and typecheck scripts): each as a single command, with no shell,
with the environment cleared of anything that looks like a credential, up to 5 minutes, the
output cut at the end and masked. QA reads the results; it runs nothing itself unless its
`shell` is `sandbox`. A command that could not run (`ENOENT`, `EACCES`, exit codes 126 and
127) is recorded as `notRun`, and the QA prompt tells it not to approve a scenario that
depends on it. Commands start with the person's login-shell `PATH` in front of the app's.

## After the answer

The app applies the transition **by the stage's fields**, not by a code order: a question
pauses the run; a blocking review finding or a failing QA scenario returns the work to the
stage its `returnsTo` names and counts a return toward that stage; otherwise the stage is done
and the run goes to its `next`. `roundLimit` (default 2, counted per destination stage) stops
the run and asks the person when it is reached. The runs' states move by pure functions in
`src/shared/runs/transitions.ts`.

## Autonomy

An **autonomous** agent's stage starts when the run reaches it and its result goes on without
waiting; a stage whose agent **waits** stays `to-start` until the person starts it and
`to-accept` until the person accepts or returns it with a note. Changing the flag applies from
the next stage, never mid-stage. Pushing the branch and opening the pull request always wait
for a yes, and a test workspace keeps refusing every external write.

## A question the agent cannot answer

A question an agent cannot decide is passed on along a chain that ends at the person.
`AgentDef.turnsTo` names the agent it goes to first (or the person, when null); a member of a
squad that turns to the person goes through its **liaison** first
(`turnTarget` in `src/shared/config/squads.ts`, used by `askTarget` in
`src/main/runner/executor.ts`). The agent that receives it answers when it can and otherwise
passes the question on; a question marked `needsPerson` skips the chain and reaches the person
at once, and what reaches the person is also asked on the issue. The chain is checked by
`checkFlow` (`turns-unknown`, `turns-self`, `turns-loop`) and by `checkSquads`
(`turns-other-squad`, `chain-skips-liaison`, `chain-loop`). Squad autonomy rides on the same
switch: a squad that is off holds every member (`autonomousOf`).

With `runner.enabled`, a sweep every 5 minutes lists the open issues assigned to the person
that carry `runner.triggerLabel` and starts runs up to `runner.maxConcurrentRuns` working at
once. An issue that already had a run, in any state, is not started again on its own. The same
sweep resolves the waits and posts the reviews that were waiting for the pull request. A stage
is interrupted by `runner.stageIdleMs` (the agent's silence) or `runner.stageMaxMs` (a
generous wall-clock ceiling), and the run becomes `failed` with retry or cancel. Cancel stops
the agent and deletes nothing.

## The one write door

`src/main/runner/door.ts` is the only runner file that imports Actions. Everything that leaves
the machine from a run goes through the same proposals, the same refusal in a test workspace
and the same audit log as what a person starts by hand: a comment per stage, the review on the
pull request's lines, the push and the pull request. The push and the pull request always wait
for a yes. `rules/code-hosts.md` explains the write path. A run's own scripts come from the
**clone** (the workspace's `projects.repos`), never from the worktree: a merged pull request
cannot change what runs. The push itself is the `run-push` action, not a provider command.

## The cycle memory

The run's folder holds a fixed-name file, **`MEMORY.md`**, read whole by every stage before
the other documents and rewritten by the stage that concludes a pass. It exists so a long run
does not lose a decision either to the folder's read budget or to the 40-message window a
stage receives.

- **Fixed shape**, sections in order: Decisions, Constraints, Tried and discarded, Open
  questions, Where the work is (in the workspace's language). What a stage returns is
  normalized; a stage that pauses on a question writes nothing.
- **What enters by itself:** before building the text, the app adds each person's answer and
  each thread handoff, each marked with the message number, so rewriting does not duplicate a
  line.
- **The cap** is a code constant, `MEMORY_MAX` (10,000 characters), not a setting; over it, the
  file is still read whole and the stage is told to shorten it. The read itself has a wider
  ceiling of its own, so a runaway answer is not cut without a word.
- **The person can correct it** on the run screen (`runs:memory`). The app commits it as the
  person's and records it; the edit is refused while an agent works in the folder
  (`memory-busy`).
- It lives in the worktree and goes in the run's commits; nothing of it reaches the tracker by
  itself.

## The write guard

An agent with `worktree` permission runs with its working folder in the run's worktree, in
both engines, with **one guard function** (`src/main/engine/guard.ts`) in front of every
write: in the Claude Agent SDK it is a `PreToolUse` hook over `Edit`/`Write`; in the open
engine the `Write` and `Edit` tools call the same function. It refuses a path that leaves the
worktree (absolute, `..`, `~`, a symbolic link on the way, a dangling one), the root itself,
anything inside `.git`, `.husky`, `.githooks`, `.gitattributes`, `.gitmodules`, and secret
files. Reads are confined to the worktree and outside `.git` and secrets. Every refusal goes
to the run's thread and shows as "blocked" in the live activity. After a stage, the **app**
commits in the worktree with the identity of `runner.identity` or, empty, the repository's
`.git/config` one (read, never written), passed per command with `-c user.name=… -c
user.email=…`; the global git identity and the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` variables
never enter, and without an identity the run does not start. The message is
`runner.commitMessage` (default `feat: <summary> #<n>`) and never carries a tool attribution.
