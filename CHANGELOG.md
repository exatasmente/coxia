# Changelog

All notable changes to Coxia are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The whole interface is translated: every screen, toast, tooltip and the browser (PWA) gate follow the workspace language, with dates and numbers formatted for it. Strings live in `src/shared/i18n/ui-*.json`; `npm run i18n:lint` now blocks untranslated text in the renderer. Glossary and rules in `docs/i18n.md`.

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
