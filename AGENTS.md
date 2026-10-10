# Project instructions

Coxia is an Electron + React + TypeScript desktop app: agents, driven by voice or text, carry a repository's development cycle, with the person at every gate. The authoritative sources are [CONTRIBUTING.md](CONTRIBUTING.md) (setup, scripts, tests, interface rules, commits and branches, how to add a code host, a cycle template or a model provider), [README.md](README.md) (what the app is and what is verified), [docs/README.md](docs/README.md) (the documentation index), [RELEASING.md](RELEASING.md) (how a version is cut and what the public package carries) and [CHANGELOG.md](CHANGELOG.md) (`## [Unreleased]`). Read them before changing behavior and link to them instead of restating them here.

## Working in this repository

- Read the relevant documentation before changing behavior; keep it consistent with the code.
- Keep changes focused, typed, and covered by tests. Tests must use fakes rather than real models, code hosts, or network services (the helpers are in `test/helpers/`).
- Route every user-facing string through `t()` and update both localization catalogs; the renderer uses theme tokens, never literal colors. See [docs/i18n.md](docs/i18n.md).
- Keep code, tests, identifiers, and commit messages in English. Comments explain why, not what.
- Update the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
- Never include credentials or real personal, host, or issue details in repository content. Use neutral examples such as `example.com`, `group/project`, and `#123`.

## Before calling a change done

`npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` and `node scripts/public-audit.mjs` all pass on Node from [.nvmrc](.nvmrc). CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs the same plus `electron-vite build`. A red gate is not done, and a gate you did not run is not reported as passed.

## Agent-run work

Follow the task and boundaries of the current stage. Work only in the assigned worktree, do not claim a check passed unless it actually ran, and report what remains unverified.
