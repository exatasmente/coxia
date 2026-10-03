# Changelog

All notable changes to Coxia are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Several pre-dailies on one day: each is a version of that day's minutes (`<date>-pre-daily.v<N>.md` plus an index), with a "what changed since the previous version" summary, a version switcher and a whole-day view where the latest decision of each activity wins. Decisions already written to a plan's log or a card note by an earlier version are not written again.
- A card already covered earlier the same day is compared with what that meeting saw: unchanged cards get a short turn built from the earlier one (no agent call, with "go deeper anyway"); changed cards are discussed focusing on what moved, next to what was said and decided. The agenda marks each card and puts what changed or is blocked first.
- Minutes can be deleted (one version or a whole day) from History and the minutes screen, after a confirmation that lists what stays where it was written. They go to a trash folder for 30 days and can be restored; the deletion is in the audit log.
- The card shows the tracker's priority and milestone, in Today and in the call, and the agent that prepares its turn reads them. The priority comes from a new `devCycle.priority.labels` list (highest first, regular expressions, empty by default), so the workspace configuration moves to schema 3; existing files migrate on first start.
- In the call, "this one goes first", "leave #12 for next week" or "raise #7" produces a priority decision for that card, shown before the call moves on and kept in the minutes (with a line saying so when the workspace has no priority labels, or the host cannot change labels).
- A priority decision becomes a label change proposal when the minutes are saved: it waits in Actions for its own approval, like every other write to the tracker. A test workspace refuses it; without priority labels (or on Bitbucket) it stays in the minutes with a line saying it was not written.
- The call says how many activities did not fit its agenda of 8 and lists them after the queue, each with a button to bring it in; Today shows the count.
- An agent team in the workspace configuration (`agents.team`): each agent has a name, a job, a model (an LLM role to borrow, or a provider and model), the stages it works, a permission (`read`, or `worktree`) and instructions. The five agents the ceremonies use are built in: they can be edited, never removed. Stages gain `agentId`, `artifacts` and `human`. The configuration moves to schema 4; existing files migrate on first start and keep every setting.
- A new cycle template, the agent cycle (`agent-flow`): refine, gate 1, plan, gate 2, implement, review, QA and ready, with the files each stage produces and a default team (Refiner, Planner, Developer, Reviewer, QA; only the developer may change files, inside its run's worktree). Applying it keeps the agents you already have; a template file carries its agents. The runner that executes the stages comes in a later change.
- The state of an agent-cycle run (the stage, what each stage produced, a pending question, review rounds, the tracker comment each stage keeps) is stored one file per run in the workspace, with pure, tested transitions for starting, finishing a stage, approving, rejecting or skipping a gate, asking and answering, handing back, retrying, cancelling and resuming after a restart. Nothing runs a stage yet.
- A forum for each activity: one thread per run plus general threads, stored as one append-only file per thread in the workspace (posts, questions, answers, handoffs, decisions, system lines, with `@agent` mentions, references to artifacts and a flag for what may reach the tracker). Channels `forum:list`, `forum:read`, `forum:post` and `forum:create`, open to the paired browser, and a `forum:message` push on every new message. Nothing writes to a thread yet but a person.

### Changed

- Today and the call list the cards in one order: blocked first, then priority, then the most recently updated. The reference text is no longer a tie-break, and the old urgency bands of Today (pending question, back from QA, close to QA) are gone.
- The whole interface is translated: every screen, toast, tooltip and the browser (PWA) gate follow the workspace language, with dates and numbers formatted for it. Strings live in `src/shared/i18n/ui-*.json`; `npm run i18n:lint` now blocks untranslated text in the renderer. Glossary and rules in `docs/i18n.md`.
- The main process, the shared modules and the agent prompts follow the workspace language (Portuguese or English): errors, notifications, tray, health messages, the minutes, the gate quiz, the QA checklist and the retro digest. The Portuguese texts are unchanged; English has golden tests of its own.

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

[Unreleased]: https://github.com/exatasmente/coxia/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/exatasmente/coxia/releases/tag/v0.1.0
