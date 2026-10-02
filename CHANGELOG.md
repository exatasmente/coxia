# Changelog

All notable changes to Coxia are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Several pre-dailies on one day: each is a version of that day's minutes (`<date>-pre-daily.v<N>.md` plus an index), with a "what changed since the previous version" summary, a version switcher and a whole-day view where the latest decision of each activity wins. Decisions already written to a plan's log or a card note by an earlier version are not written again.
- A card already covered earlier the same day is compared with what that meeting saw: unchanged cards get a short turn built from the earlier one (no agent call, with "go deeper anyway"); changed cards are discussed focusing on what moved, next to what was said and decided. The agenda marks each card and puts what changed or is blocked first.
- Minutes can be deleted (one version or a whole day) from History and the minutes screen, after a confirmation that lists what stays where it was written. They go to a trash folder for 30 days and can be restored; the deletion is in the audit log.

## [0.1.0] - 2026-10-02

First public version.

### Added

- Voice ceremonies with one agent per open activity: pre-daily, unblocking, gate, hand-off to QA, retro and release conflicts. Listening runs locally (faster-whisper); speaking uses Edge TTS or the local Kokoro voices.
- Agents run on the Claude Agent SDK, or on any OpenAI-compatible server through the open engine (Ollama, LM Studio, llama.cpp, vLLM, OpenRouter and similar; so far only tested against a scripted fake server), with read-only tools by default and a structured-output contract.
- First-run setup wizard (language, models, Claude Agent SDK, projects, integrations, agent documentation, development cycle, voice) with configuration export and import.
- The Claude Agent SDK is not bundled in published packages: the wizard installs it into a folder of the user's, after showing Anthropic's terms.
- Workspaces with a "test" mark that keeps every effect (push, merge request, comment, notes) on the machine.
- Write-only-on-request flow: minutes, notes and the Plan log are written only when the user confirms; side effects are queued and copied to Claude Code instead of running in the app.
- Time per issue measured from the ceremonies, ready to log in Clockify, and a cost screen for OpenRouter usage.
- Desktop app for Linux (AppImage and `.deb`), with a tray, optional autostart, and a paired-browser access (PWA) for the phone.
- Automatic updates for published AppImages through GitHub Releases (stable and beta channels, differential download, checksum verified), and an update flow for installs made from source.
- Interface in Portuguese (Brazil) and English, with light and dark themes.

[Unreleased]: https://github.com/exatasmente/coxia/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/exatasmente/coxia/releases/tag/v0.1.0
