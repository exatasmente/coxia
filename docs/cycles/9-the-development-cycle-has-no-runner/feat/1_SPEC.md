# #9 The development cycle has no runner — functional spec

Issue: https://github.com/exatasmente/coxia/issues/9. Takes in the minimum of #3 (agents as entities: who works each stage) and #4 (agents hand work to each other), and adds a forum where agents and people talk about each activity.

## The goal

A team of agents takes an issue from "open" to "pull request in review" on its own, stopping only where a person must decide: the gates, a question an agent cannot answer, and every write to the code host. Everything the agents do and say about an activity is in one place, the activity's forum thread, where the person reads, answers and redirects.

## Concepts

- **Agent.** A named member of the team with a job description, a model, the stages it works and a permission level: *reads* (today's agents) or *writes in the worktree* (can edit files and run the workspace's allowed commands inside the activity's worktree, nowhere else). The five roles the ceremonies use today stay as system agents: they can be edited (model, instructions) but not deleted. The person creates, edits and deletes the others.
- **Agent cycle.** A cycle template whose stages are work, not tracker statuses: `refine → gate 1 → plan → gate 2 → implement → review → QA → ready`. Each work stage names its agent and the artifacts it must produce; each gate stage is a person.
- **Run.** One issue going through the agent cycle: its current stage, what each stage produced, who is working, what is waiting for a person, and its history. A run owns a branch and a worktree of the issue's repository, created by the app, and its cycle folder (`docs/cycles/<n>-<slug>/`) lives in that worktree. The issue's text and comments are copied into the folder as the input of the first stage.
- **Forum.** One thread per run, plus general threads. Messages: *post* (what an agent did), *question* (needs a person; the stage waits), *answer*, *handoff* (from one agent to the next: what was produced and what to do), *decision* (a gate result, a skip with its reason), *system* (stage changes). Agents read their run's thread as context. A person writes in any thread; naming an agent (`@developer`) asks that agent, which answers in the thread.

## What the person sees and does

1. **Team.** In Settings, a Team section lists the agents: name, job, model, stages, permission. Create, edit, delete (not the system ones). New workspaces with the agent cycle get a default team: Refiner, Planner, Developer, Reviewer, QA.
2. **Start a run.** On a card of the agent cycle, "Start cycle". With autonomy on, the app also starts runs by itself for issues that carry the workspace's trigger label (default `coxia`), up to a configured number of runs at the same time.
3. **Follow a run.** A Cycle screen per run: the stages as a timeline with their agent and state, the artifacts with links, and the forum thread beside them. The card shows the run's stage and whether it waits for the person. The jobs dock and the live activity view show what the working agent is doing.
4. **Gates.** A gate stage waits for the person: approve, reject with a reason (the run goes back to the stage that produced the artifact, with the reason in the thread as a handoff), or skip with a reason (recorded as a decision). The gate quiz stays available as a tool on that screen.
5. **Questions.** When an agent cannot go on without a decision, it posts a question; the run's card shows it as blocked, a notification goes out, and the stage resumes when the person answers in the thread.
6. **Review loop.** The reviewer reads the diff and posts findings; with findings, it hands the work back to the developer; after two rounds without approval the run stops and asks the person.
7. **Writes to the code host.** At the end of implement and review, the app proposes, as actions waiting for their own "yes": push the run's branch and open the pull request (title, body built from the artifacts, link to the issue). Autonomy never skips this. Mirroring forum messages to the issue as comments is an option, off by default, and is a proposal too.
8. **Ceremonies report runs.** The pre-daily turn of a card with a run reports its stage, what changed and what waits for the person; a pending question is a blocker.

## Rules

- An agent that writes is confined to its run's worktree: no file outside it, only the workspace's allowed commands, no network, no push. The app commits its work locally with the workspace's identity; commit messages follow the repository's rules and carry no AI attribution.
- A test workspace runs everything except the external writes, which it refuses as today.
- One run per issue at a time. A run survives an app restart: it resumes at the stage it was in; a stage interrupted mid-agent starts that stage over.
- Nothing is deleted when a run is cancelled: the worktree, the branch and the thread stay until the person removes them.

## Out of scope

Merging, releases, suggesting new agents (#5), the conversation directing the next cycle (#6), the radar taking action (#7), moving the gate out of the ceremonies (#8 items).

## Acceptance

- With a fake code host and a fake model, a run goes from start to "pull request proposed" through every stage, with both gates approved, one review round sent back, and one question answered; the thread holds every post, handoff, question, answer and decision in order.
- A developer agent's attempt to write outside the worktree, run a command outside the allowlist, or push is refused and reported in the thread.
- A gate rejection returns the run to the stage that produced the artifact; a skip is recorded with its reason.
- After an app restart in the middle of a stage, the run resumes at that stage.
- Creating, editing and deleting a non-system agent works; a system agent cannot be deleted; a stage without an agent cannot start and says so.
- The push and the pull request wait in Actions; approving them pushes the branch and opens the pull request; a test workspace refuses them.
- On a real repository, an issue goes from open to a pull request in review with the person acting only at the gates, the questions and the approvals.
