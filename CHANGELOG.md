# Changelog

All notable changes to Coxia are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The runner: an issue goes through the agent cycle by itself. Starting a run (`runs:start`) makes a branch `cycle/<n>-<title>` and a git worktree of the issue's repository, copies the issue and its comments (read only) into `docs/cycles/<n>-<title>/0_ISSUE.md`, and runs the agent of each stage in turn: it reads the issue, the earlier documents and the run's thread, and answers with its summary, its documents, a note for the next stage, and, if it needs the person, a question. The app writes the documents and commits them in the worktree, as the configured identity (or the one the repository already has), with hooks off and no attribution of any tool. Agents that are autonomous go straight on; one that waits stops at "start" and at "accept". A review sends findings (path, line, severity, suggestion) back to the developer, a failed QA scenario does too, and the run asks the person after two rounds. A question pauses the run until a person answers, in `runs:answer` or in the run's thread; naming an agent in the thread makes it answer, read only. A stage past its limit fails and can be retried; reopening the app starts the interrupted stage over; cancelling deletes nothing. With the runner on, issues that carry the `coxia` label (assigned to you) are started up to a number at a time. See [`docs/runner.md`](docs/runner.md).
- An agent with the `worktree` permission can change files only inside its run's worktree, on the Claude Agent SDK and on the open engine (which gains `Write` and `Edit` tools for this), through one shared guard: no path outside, none through a link that leads out, nothing in `.git`, hook folders or secret files, no command but the ones listed in `runner.commands` (by default the repository's test and typecheck scripts), no network and no push. Every refusal is posted in the run's thread and shown in the live activity.
- A `runner` section in the workspace configuration (on/off, trigger label, runs at a time, worktrees folder, allowed commands, stage timeout, commit identity and message), which moves the configuration to schema 5 (and 6, with the comment templates below); existing files migrate on first start with the runner off.
- On the Claude Agent SDK, the commands an agent that writes may run no longer inherit the provider's key and the other credential-looking variables of the app's process: each allowed command is rewritten to start with `env -u NAME` for each of them (the open engine already ran its commands with a cleaned environment).
- Each stage of the agent cycle leaves its result on the issue as one comment, edited in place: the status first, sections a person who does not read code can follow, the technical detail last and collapsed. The comment is written by the stage's own agent from a template of the cycle (`devCycle.comments`, one per stage and for a gate decision, an agent's question and the pull request description; the agent cycle brings them, the other cycles bring none and so post nothing), then checked by the app: secrets masked, local paths and run ids taken out, mentions turned into text, and anything it cannot fix (an agent, a tool or the forum named, first person, a broken structure) holds the comment for your "yes". An agent that is autonomous posts by itself with a line in the audit log (who, where, the body's hash, the host's answer); one that waits puts the comment in Actions. A test workspace refuses all of it. This moves the configuration to schema 6; the agent cycle's templates are added on first start.
- The reviewer's findings go to the pull request as one review per round, on the lines: line comments with GitHub's or GitLab's suggestion block when the fix replaces exactly those lines, file comments, and the general comment; "request changes" when something blocks, never an approval. The next round replies in the thread of a finding that is still there, resolves the ones that were fixed and opens threads only for what is new. Works on GitHub, GitLab and Bitbucket Cloud (see `docs/vcs-providers.md` for how each one maps).
- The runner proposes the push of a run's branch and, once it is pushed, the pull request (title and body from the cycle's template, linked to the issue). Both always wait for your "yes" in Actions, whatever the agents' autonomy, and a test workspace refuses them. Several writes that belong together (a review round) wait for one "yes".
- A run keeps the findings of each review pass and the scenarios of each QA pass as the agents gave them, and the commit the branch was cut from. The issue's description is now read from GitHub, GitLab and Bitbucket.

## [0.2.0] - 2026-10-03

### Added

- The card shows the tracker's priority and milestone, in Today and in the call, and the agent that prepares its turn reads them. The priority comes from a new `devCycle.priority.labels` list (highest first, regular expressions, empty by default), so the workspace configuration moves to schema 3; existing files migrate on first start.
- In the call, "this one goes first", "leave #12 for next week" or "raise #7" produces a priority decision for that card, shown before the call moves on and kept in the minutes (with a line saying so when the workspace has no priority labels, or the host cannot change labels).
- A priority decision becomes a label change proposal when the minutes are saved: it waits in Actions for its own approval, like every other write to the tracker. A test workspace refuses it; without priority labels (or on Bitbucket) it stays in the minutes with a line saying it was not written.
- The call says how many activities did not fit its agenda of 8 and lists them after the queue, each with a button to bring it in; Today shows the count.
- An agent team in the workspace configuration (`agents.team`): each agent has a name, a job, a model (an LLM role to borrow, or a provider and model), the stages it works, a permission (`read`, or `worktree`) and instructions. The five agents the ceremonies use are built in: they can be edited, never removed. Stages gain `agentId`, `artifacts` and `human`. The configuration moves to schema 4; existing files migrate on first start and keep every setting.
- A new cycle template, the agent cycle (`agent-flow`): refine, gate 1, plan, gate 2, implement, review, QA and ready, with the files each stage produces and a default team (Refiner, Planner, Developer, Reviewer, QA; only the developer may change files, inside its run's worktree). Applying it keeps the agents you already have; a template file carries its agents. The runner that executes the stages comes in a later change.
- Each agent is autonomous or waits for the person (`autonomous` on an agent, off by default, on for the agent cycle's default team), so a cycle can be hybrid. A run gains the waiting states this needs: a stage waiting to be started, and a result waiting to be accepted or sent back with a note. Nothing runs yet.
- The state of an agent-cycle run (the stage, what each stage produced, a pending question, review rounds, the tracker comment each stage keeps) is stored one file per run in the workspace, with pure, tested transitions for starting, finishing a stage, approving, rejecting or skipping a gate, asking and answering, handing back, retrying, cancelling and resuming after a restart. Nothing runs a stage yet.
- A forum for each activity: one thread per run plus general threads, stored as one append-only file per thread in the workspace (posts, questions, answers, handoffs, decisions, system lines, with `@agent` mentions, references to artifacts and a flag for what may reach the tracker). Channels `forum:list`, `forum:read`, `forum:post` and `forum:create`, open to the paired browser, and a `forum:message` push on every new message. Nothing writes to a thread yet but a person.

### Changed

- Today and the call list the cards in one order: blocked first, then priority, then the most recently updated. The reference text is no longer a tie-break, and the old urgency bands of Today (pending question, back from QA, close to QA) are gone.

### Fixed

- A workspace's cards show only the merge requests of its own repositories (and of the issue project); on GitHub they used to include every open pull request of the account.

## [0.1.0] - 2026-10-02

First public version.

### Added

- Voice ceremonies with one agent per open activity: pre-daily, unblocking, gate, hand-off to QA, retro and release conflicts. Listening runs locally (faster-whisper); speaking uses Edge TTS or the local Kokoro voices.
- Agents run on the Claude Agent SDK, or on any OpenAI-compatible server through the open engine (Ollama, LM Studio, llama.cpp, vLLM, OpenRouter and similar; so far only tested against a scripted fake server), with read-only tools by default and a structured-output contract.
- First-run setup wizard (language, models, Claude Agent SDK, projects, integrations, agent documentation, development cycle, voice) with configuration export and import.
- The Claude Agent SDK is not bundled in published packages: the wizard installs it into a folder of the user's, after showing Anthropic's terms.
- Workspaces with a "test" mark that keeps every effect (push, merge request, comment, notes) on the machine.
- Write-only-on-request flow: minutes, notes and the Plan log are written only when the user confirms; side effects are queued and copied to Claude Code instead of running in the app.
- Time per issue measured from the ceremonies, ready to export to a time tracker, and a cost screen for OpenRouter usage.
- Desktop app for Linux (AppImage and `.deb`), with a tray, optional autostart, and a paired-browser access (PWA) for the phone.
- Automatic updates for published AppImages through GitHub Releases (stable and beta channels, differential download, checksum verified), and an update flow for installs made from source.
- Interface in Portuguese (Brazil) and English, with light and dark themes.
- Several pre-dailies on one day: each is a version of that day's minutes (`<date>-pre-daily.v<N>.md` plus an index), with a "what changed since the previous version" summary, a version switcher and a whole-day view where the latest decision of each activity wins. Decisions already written to a plan's log or a card note by an earlier version are not written again.
- A card already covered earlier the same day is compared with what that meeting saw: unchanged cards get a short turn built from the earlier one (no agent call, with "go deeper anyway"); changed cards are discussed focusing on what moved, next to what was said and decided. The agenda marks each card and puts what changed or is blocked first.
- Minutes can be deleted (one version or a whole day) from History and the minutes screen, after a confirmation that lists what stays where it was written. They go to a trash folder for 30 days and can be restored; the deletion is in the audit log.

[Unreleased]: https://github.com/exatasmente/coxia/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/exatasmente/coxia/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/exatasmente/coxia/releases/tag/v0.1.0
