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

## A whole team, not only engineering

The agent cycle's default team covers the roles a product team has, each with its stage, its job and who it turns to when it cannot decide.

| Agent | Stage(s) | Job | Permission | Turns to |
|---|---|---|---|---|
| Support | triage | reads a new issue as the person who reported it would: classifies it (bug, feature, question, duplicate), checks it can be reproduced or understood, asks the reporter on the issue for what is missing, links duplicates, writes `0_TRIAGE.md` | reads | Product Owner |
| Product Owner | refine (and priority) | writes the functional spec in the product's words: what changes for the person using it, acceptance, out of scope; proposes the issue's priority and milestone (#8's priority labels) | reads | the person |
| Tech Lead | plan, review | writes the technical plan; reviews the pull request on its lines; answers the developer's and QA's technical questions | reads | Product Owner for scope, the person otherwise |
| Developer | implement | changes the code and the tests in the worktree, only with the allowed commands | writes in the worktree | Tech Lead |
| QA | qa | turns the acceptance into scenarios, runs what can be run, reports results; sends the work back on a failure | reads | Tech Lead |
| Customer Success | communicate | after the pull request is merged: writes the release note of the change for the people who use it and answers the reporter on the issue with what changed and how to use it | reads | Product Owner |

The flow becomes `triage → refine → gate 1 → plan → gate 2 → implement → review → qa → ready → communicate`. `communicate` starts when the run's pull request is merged (the runner watches its state); until then the run waits in `ready`.

### Agents talk before they ask the person

A question goes first to the agent the asker turns to, in the run's forum thread. That agent answers when it can, from the artifacts, the issue and the code (read-only); when it cannot, or when the question is a decision only the person can take (scope, priority, a risk to accept), it passes the question on, up to the person. Every step is a forum message, so the person sees who asked whom and why it reached them. Gates are never decided by an agent.

- Each agent has `turnsTo`: another agent's id, or the person. A chain ends at the person; a loop is refused by validation.
- An agent's answer to another agent is a forum *answer* (internal); only what the person decides, and what the agents publish per the comment templates, goes to the tracker.
- A question that reaches the person is also posted on the issue when the workspace says so (as today).

### Everyone is editable

These are the defaults of the agent cycle, not fixed roles: the person renames them, changes their jobs, stages, models, autonomy and who they turn to, removes them, or adds others (a Designer for a refine step, a Security reviewer for review, a Release Manager). A stage names one agent; an agent may work several stages.

### Acceptance (additions)

- A new issue goes through triage: Support classifies it, asks the reporter for missing information on the issue (as a published comment under its autonomy), and the run waits for the reporter's reply before refine.
- The Developer's question goes to the Tech Lead, who answers it in the thread without the person; a scope question goes from the Tech Lead to the Product Owner, then to the person; the thread shows the chain.
- After the pull request is merged, Customer Success writes the release note and answers the reporter on the issue.
- Removing the Customer Success agent leaves `communicate` without an agent: the run ends at `ready` and says so; validation warns.
- A `turnsTo` loop is refused by validation.

## The cycle is the person's: a flow editor

The flow of the cycle is data the person edits, not code: which stages exist, in what order, who works each one, where a stage sends the work back, what each one produces and publishes. The agent cycle (`agent-flow`) is only the starting point.

### What a stage is

| Field | Meaning |
|---|---|
| name, id | how it is shown; the id names its folder files and comment marker |
| type | **work** (an agent produces something), **gate** (the person decides), **wait** (the run waits for an event) |
| agent | the agent that works it (work stages only) |
| produces | the artifact files it must write (`1_SPEC.md`…) |
| reads | which earlier artifacts and inputs it is given (default: all earlier ones) |
| next | the stage that follows (default: the next in the list) |
| returns to | where the work goes back: on a gate rejection, a review with blocking findings, a QA failure (default: the stage that produced what is being judged) |
| round limit | how many returns before the run stops and asks the person (default 2) |
| waits for | wait stages only: pull request merged, reporter's reply on the issue, a label, a time |
| comment | its tracker comment template (or none) |
| tracker status | optionally, the label/status the issue gets on the tracker when the run enters the stage (a write, published under the agent's autonomy; a gate's under the person's decision) |

### The editor

A screen in Settings › Cycle (and from the Cycle screen, "edit this flow"):

- **The stages as a list**, in order, each a row with its type, agent, what it produces and where it returns to; drag to reorder; add a stage (work, gate, wait) between any two; duplicate; remove.
- **A side panel for the selected stage** with every field above: agent picker (with "create agent" in place), artifact names, inputs, next and returns-to pickers limited to existing stages, round limit, wait event, comment template editor with a preview of a rendered comment, tracker status.
- **A live diagram** of the flow next to the list (forward arrows, return arrows dashed, gates and waits drawn differently), so a loop or a dead end is visible at once.
- **Checks while editing**, shown on the row and blocking save when they are errors: a work stage without an agent; a returns-to or next pointing nowhere; a stage nothing reaches; a flow with no end; a gate first; an artifact that no stage produces but a later stage reads; two stages producing the same file; a wait with no event. Warnings: an autonomous agent working no stage, a gate after the last work stage.
- **Templates:** start from a built-in flow (agent cycle, a shorter one without gates, the SDD one), save the edited flow as the workspace's, export it as a file and import one (no secrets in it, like the config export).
- **Runs in progress are not broken:** a run keeps the flow it started with (a copy in the run); the edited flow applies to new runs; the Cycle screen of an old run says it follows an earlier version and offers to move it to the new flow when its current stage still exists.

### What changes underneath

- The runner follows the stage's `type`, `next`, `returnsTo`, `roundLimit` and `waitsFor` instead of the fixed order and the fixed review/QA rules of phase 2a; the agent cycle's defaults reproduce today's behavior exactly (a test pins that).
- Validation of the flow lives in one shared function used by the config validator, the editor and the runner.
- The run stores the flow version it follows.

### Acceptance (additions)

- Adding a "security review" work stage after review with its own agent, returning to implement, makes new runs go through it; existing runs keep their flow.
- Removing gate 2 makes new runs go from plan straight to implement; the diagram and the checks update as the person edits.
- A returns-to pointing to a removed stage blocks saving with the reason on the row.
- Export then import of a flow on another workspace gives the same flow; the file holds no secrets.
- The default agent cycle, run through the generalized runner, produces exactly the same sequence as before the generalization.

## Squads

Agents work in squads. A squad has its own scope, its own members, its own flow and one agent that speaks for it to the other squads.

### What a squad is

| Field | Meaning |
|---|---|
| name, mission | what the squad is for, in a sentence the agents read |
| scope | which work is the squad's: repositories of the workspace, issue labels, paths in a repository (a monorepo split by folders), or "anything not claimed" |
| members | its agents; an agent belongs to one squad, or to none (a **shared** agent, such as Support at the front door or Customer Success, works for every squad) |
| flow | the cycle flow its runs follow (the workspace's by default; the flow editor edits per squad) |
| liaison | the member that is the squad's point of contact: questions and requests from other squads arrive to it, and its own members' questions about another squad's area leave through it |
| forum | the squad's channel (general talk, its runs' threads listed under it) |
| autonomy | a squad-wide switch that, when off, makes every member wait for the person (each agent's own switch applies when it is on) |

A workspace with no squads behaves as one squad holding every agent and every repository, so nothing changes for whoever does not use them.

### How work reaches a squad

1. A new issue enters through **triage** (a shared Support agent, or the squad's own when the issue's repository already names one squad).
2. The scope rules pick the squad: repository, then label, then path of the files the issue mentions. One match: the run starts in that squad. Several or none: Support proposes one and the decision is posted in the triage thread; with Support not autonomous, the person picks.
3. The run follows the squad's flow with the squad's agents; the issue gets the squad's label on the tracker when the workspace configures one.

### How squads talk

- **Inside a squad,** the `turnsTo` chain works as before, ending at the squad's liaison and then the person.
- **Between squads,** only liaisons talk, in a shared *squads* channel of the forum. An agent that needs something from another squad's area (a question about their code, a change in their repository, a decision of theirs) asks its liaison; the liaison posts a **request** to the other squad's liaison, who answers it, declines it with a reason, or turns it into an issue of its squad (a new run linked to the first, so each thread shows the other).
- A run that depends on another squad's issue waits for it (a wait stage on "linked issue done"), and the ceremonies report the dependency as a blocker.
- The person sees every request and answer, can step into any channel, and is the last stop of every chain.

### Ceremonies per squad

The pre-daily, the retro and the other ceremonies can be run for one squad (its runs and cards only) or for the whole workspace; the minutes say which.

### Acceptance (additions)

- With two squads scoped by repository, an issue of each repository starts its run in its squad, with that squad's flow and agents.
- An issue matching both squads stops at triage with Support's proposal; the person's choice starts the run there.
- A Developer of squad A asks about squad B's API: the question goes A's Developer → A's liaison → B's liaison (in the squads channel) → answered back down the chain, without the person; a request for a change in B's repository becomes a linked run in B, and A's run waits for it.
- A workspace with no squads runs exactly as a single team.
- An agent cannot be a member of two squads; a squad without a liaison is refused when it has members; removing a squad moves its runs to "no squad" only after the person confirms.

## Undoing an automatic post

Every comment an autonomous agent posted can be removed from the run's screen: "delete" becomes an action waiting for the person's "yes" (a new provider write, `deleteNote`, on the three hosts), recorded in the audit log. The run keeps the record of what was posted and removed.

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
