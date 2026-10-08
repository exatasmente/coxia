# Project instructions

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, scripts, tests, and repository conventions. Use [docs/README.md](docs/README.md) to find product and maintenance documentation, and [RELEASING.md](RELEASING.md) for release work.

## Working in this repository

- Read the relevant documentation before changing behavior; keep it consistent with the code.
- Keep changes focused, typed, and covered by tests. Tests must use fakes rather than real models, code hosts, or network services.
- Route every user-facing string through `t()` and update both localization catalogs. Use theme tokens instead of literal colors in the renderer.
- Keep code, tests, identifiers, and commit messages in English. Comments explain why, not what.
- Update the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
- Never include credentials or real personal, host, or issue details in repository content. Use neutral examples such as `example.com`, `group/project`, and `#123`.

## Agent-run work

Follow the task and boundaries of the current stage. Work only in the assigned worktree, do not claim a check passed unless it actually ran, and report what remains unverified.
