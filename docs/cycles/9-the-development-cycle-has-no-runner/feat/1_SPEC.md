# #9 The development cycle has no runner — functional spec

Issue: https://github.com/exatasmente/coxia/issues/9. Takes in the minimum of #3 (agents as entities: who works each stage) and #4 (agents hand work to each other), and adds a forum where agents and people talk about each activity.

## The goal

A team of agents takes an issue from "open" to "pull request in review" on its own, stopping only where a person must decide: the gates, a question an agent cannot answer, and every write to the code host. Everything the agents do and say about an activity is in one place, the activity's forum thread, where the person reads, answers and redirects.

## Concepts

- **Agent.** A named member of the team with a job description, a model, the stages it works, whether it is autonomous (see *Publishing follows the agent's autonomy*) and a permission level: *reads* (today's agents) or *writes in the worktree* (can edit files and run the workspace's allowed commands inside the activity's worktree, nowhere else). The five roles the ceremonies use today stay as system agents: they can be edited (model, instructions) but not deleted. The person creates, edits and deletes the others.
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
7. **Writes to the code host.** Each stage leaves its result on the tracker as a comment, and the review is done on the pull request's lines (see *Comments on the tracker* and *Code review on the pull request*). Whether those are posted by themselves or wait for a "yes" depends on the agent's autonomy. Pushing the branch and opening the pull request (title, body built from the artifacts, link to the issue) always wait in Actions for the person.
8. **Ceremonies report runs.** The pre-daily turn of a card with a run reports its stage, what changed and what waits for the person; a pending question is a blocker.

## Rules

- An agent that writes is confined to its run's worktree: no file outside it, only the workspace's allowed commands, no network, no push. The app commits its work locally with the workspace's identity; commit messages follow the repository's rules and carry no AI attribution.
- A test workspace runs everything except the external writes, which it refuses as today.
- One run per issue at a time. A run survives an app restart: it resumes at the stage it was in; a stage interrupted mid-agent starts that stage over.
- Nothing is deleted when a run is cancelled: the worktree, the branch and the thread stay until the person removes them.

## Comments on the tracker

The forum is where the team works; the issue and its pull request are the public record. Each stage of the run leaves its result on the tracker as a comment, so whoever opens the issue months later understands what was decided without the forum.

### What gets a comment

| Event | Where | Kind |
|---|---|---|
| A work stage ends (refine, plan, implement, review, QA) | the issue; review on the pull request | the stage's comment, from the stage template |
| A gate is decided (approved, rejected, skipped) | the issue | a short decision comment pointing to the stage comment |
| An agent asks the person something | the issue (when the workspace says so) | a question comment; the answer can come in the forum or as a reply on the tracker |
| The pull request is opened | the pull request | the description, from the cycle's PR template |

Handoffs, intermediate posts and the agents' talk stay in the forum.

### The comment standard

The cycle defines, per stage, a comment template: a title, a status line and sections, each with what it must say. The defaults follow these rules, which every template keeps:

1. **Mixed audience.** The first sections are readable by product, support and the person who opened the issue: behavior, not implementation. File, function and line names go only in a collapsed "Technical detail" section, always last.
2. **Impersonal.** No first person and no people as subject; the subject is the system or the behavior.
3. **Self-contained.** No reference to the forum conversation, the agents, the tools, the run, local paths or commands; no raw logs; no exploratory diary; never a credential, token or personal contact, even if the issue has one.
4. **Status first.** Every stage comment opens with its status (for example "Spec ready for gate 1", "Plan approved", "Review: changes requested (round 1)").
5. **Extra findings apart.** Anything found outside the issue's scope goes in its own section, each item saying whether it enters this change or becomes another issue.
6. **One comment per stage, edited in place.** Before posting, the app looks for the stage's comment (the run remembers its id; otherwise it searches the issue for the stage's marker) and edits it. A new comment is posted only when the state changes in a way worth notifying, it is short, and it links to the stage comment.
7. **Checked after posting.** The app reads the comment back and confirms the markup survived (tables and collapsed sections are the ones that break).

Default templates per stage of the agent cycle:

- **Refine** — Status; What is asked (in the issue's words); What changes for the person using it; Acceptance; Out of scope; Open questions; Technical detail.
- **Plan** — Status; Approach in one paragraph; What changes, by area; Risks and how they are covered; How it will be tested; Technical detail.
- **Implement** — Status; What changed for the person using it; How to verify; Extra findings; Technical detail (commits, files).
- **Review** — Status with the round; Findings that block, each with where and why; Suggestions that do not block; Technical detail.
- **QA** — Status; Scenarios verified and their result; What was not verified; Technical detail.
- **Gate decision** — Status (approved, rejected with the reason, skipped with the reason) and a link to the stage comment.

### The person's cycle decides

The templates live in the workspace's cycle configuration, not in code: each cycle template brings its own set (the agent cycle brings the defaults above; a team's cycle can rename stages, add or drop sections, change the language), and the person edits them like the other texts of the cycle. A stage without a template posts nothing. The comment language follows the workspace language.

### Publishing follows the agent's autonomy

Autonomy belongs to each agent, and the person switches it on and off (in Team, and on the run's screen for the agent of the current stage), so a cycle can mix autonomous agents, agents that wait for the person, and human gates.

- **Autonomous agent.** When the run reaches its stage, the stage starts by itself; its comments and reviews are posted on the tracker and recorded in the audit log (who, what, where, the body's hash and the host's answer); it hands off to the next stage without waiting.
- **Agent that waits.** The stage waits for the person to start it; its comments and reviews wait in Actions for a "yes"; the handoff waits for the person to accept the stage's result or send it back with a note.
- **Human gates** are stages of their own and do not change.
- **Always the person:** pushing the branch and opening the pull request, whatever the agent.
- A change of the switch takes effect at the next stage start or publication, never in the middle of a stage. A test workspace refuses every external write.
- The agent cycle's default team (Refiner, Planner, Developer, Reviewer, QA) comes autonomous; the five agents of the ceremonies come not autonomous and the switch has no effect on the ceremonies.
- Every automatic post can be seen and undone from the run (the comment's link, and "delete" proposed as an action).

### Acceptance (additions)

- With a fake code host, a run posts one comment per work stage on the issue and the review comment on the pull request, each following its template and the rules above (checked by tests on the rendered body: status first, technical detail last and collapsed, no agent or tool names, no local paths).
- A stage that runs again (after a gate rejection or a review round) edits its comment instead of posting a new one; the run keeps the note id; with the id lost, the marker finds the comment.
- A run whose agents are all autonomous goes from refine to the pull request proposal stopping only at the human gates; each comment is posted and appears in the audit log with its target and body hash.
- With one agent switched off (for example the Developer), the run stops at its stage until the person starts it, its comments wait in Actions, and the next stage starts only after the person accepts its result; switching it back on applies from the next stage.
- A test workspace refuses every comment; the push and the pull request wait in Actions in every case.
- Changing a stage's template in the workspace changes the next comment of that stage; a stage with no template posts nothing.

## Code review on the pull request

The reviewer reviews like a person does on the code host: on the lines, not in a wall of text.

### What the review produces

- **Line comments.** Each finding about specific code is a comment on that line (or that range of lines) of the diff, on the side it refers to (new code; old code only for something removed). The comment follows the comment standard: impersonal, self-contained, says what is wrong and why it matters.
- **Code suggestions.** When the fix is a concrete replacement of exactly the commented lines, the comment carries it as the host's suggestion block, so the author applies it with one click (GitHub `suggestion`, GitLab `suggestion:-N+M`; Bitbucket has none, so the replacement goes as a plain code block). A suggestion is only used when it is complete and replaces exactly the lines the comment covers; anything larger, spread over files, or needing a decision is described instead.
- **File comments.** A finding about a whole file (its place, its name, something missing in it) is a comment on the file, where the host supports it; otherwise on its first changed line, saying it is about the file.
- **The general comment.** What does not fit the code directly (the approach, missing tests across the change, scope, documentation, an extra finding outside the issue) goes in the review's general comment, which is the review stage's comment from the template, with the round in its status.
- **Severity.** Every comment says whether it blocks (the round asks for changes) or is a suggestion that does not block.

### How it is posted

- The line, file and general comments of one round go to the host as **one review** (one action in Actions, one "yes" or one automatic post under the comments setting): "request changes" when anything blocks, "comment" otherwise. The app never approves a pull request; approval stays with a person.
- Positions are taken from the diff of the pull request's current head; a comment whose line is no longer in the diff becomes a file comment, or goes to the general comment when the file left the diff.
- **The next round** reads the earlier threads: a finding that was fixed has its thread resolved (where the host has resolvable threads) with a one-line reply; one that was not fixed gets a reply in its own thread instead of a new comment; only new findings open new threads.
- The developer agent receives the review as its handoff: each blocking finding with its path, line and suggestion, and applies the suggestions it agrees with.

### Acceptance (additions)

- With a fake code host, a review round with a blocking line finding carrying a suggestion, a non-blocking file finding and a general point is posted as one "request changes" review with one line comment (with the suggestion block), one file comment and the general comment.
- A suggestion that would replace lines other than the commented ones is not produced as a suggestion block.
- In round 2, a fixed finding's thread is resolved with a reply, an unfixed one gets a reply in its thread, and no duplicate comment is created.
- A finding whose line left the diff is posted as a file or general comment, never on a wrong line.
- The review never approves the pull request.

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
