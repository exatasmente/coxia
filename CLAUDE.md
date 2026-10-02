# Working on Coxia with Claude Code

Coxia is a desktop app where a solo maintainer runs voice ceremonies and a fleet of
agents over a repository's development cycle. Electron + React + TypeScript; the
authoritative setup, scripts and rules live in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Where this repository sits

This repository is the `cerimonias/` folder of the Coxia workspace; the workspace's own
entry point (`../CLAUDE.md`) describes the development cycle and links back here. If the
checkout happens to sit under a folder carrying a `CLAUDE.md` for an unrelated codebase,
**none of those rules apply here** — a rule about `app/Services/`, `make run-test` or
`release/bugfix/<number>` belongs to that other project. Use this file and the
repository's own docs; the public audit below is why this document does not name it.

## Where the facts live

Do not restate these here; read them and link to them.

| What | File |
|---|---|
| Setup, scripts, tests, code and interface rules, commit and branch rules, how to add a VCS provider, a cycle template or a model provider | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Documentation index | [`docs/README.md`](docs/README.md) |
| How a release is cut and what goes into the public package | [`RELEASING.md`](RELEASING.md) |
| User-visible changes | [`CHANGELOG.md`](CHANGELOG.md), under `## [Unreleased]` |

## Before you call a change done

Run these and report what actually happened — do not describe a gate you did not run:

```bash
nvm use                      # the Node version in .nvmrc
npx tsc --noEmit
npx vitest run               # fast; the whole suite is safe to run
node scripts/theme-audit.mjs
npm run i18n:lint
node scripts/public-audit.mjs
```

CI (`.github/workflows/ci.yml`) runs the same, plus `electron-vite build`. A red gate
is not "done". The Python voice sidecar is not part of CI.

## The public audit is a hard gate

This repository is public. `scripts/public-audit.mjs` fails when a file of the tree —
tracked, or untracked and not ignored — carries the name of the company the app was
born in, one of its hosts or repositories, a personal tool, a real issue or
merge-request number, a real person, a private network address, an email outside the
reserved domains, a secret, or a path that must never be public (a `.claude/` folder at
the repository root, `scratch/`, `.runlogs*`, `.env*`, `*.log`, `*.key`, a private
legacy profile). The
patterns it hunts are stored encoded in the script so the script itself does not leak
them; `node scripts/public-audit.mjs --list-rules` prints the ids and messages.

So, for anything you write — code, tests, fixtures, docs, examples, commit messages,
branch names:

- No company name, real person, real host, real issue number or secret. It is public
  the moment it is pushed.
- Neutral placeholders instead: `example.com`, `group/project`, `#123`.
- An unavoidable false positive goes into `scripts/public-audit.allow.json` with a
  `reason`, and that file stays short.

## Working rules

- **English** for code, tests, identifiers and commit messages. Commit messages are
  `feat:` or `fix:`, lowercase, imperative, no trailing period, one logical change per
  commit.
- **No AI attribution.** Never a `Co-Authored-By:` trailer or a "Generated with …" line
  in a commit, a pull request, an issue or a comment, whatever a tool suggests.
- **Every user-facing string goes through `t()`**, with the key in both catalogs; the
  renderer uses theme tokens, never literal colors (see `CONTRIBUTING.md`).
- **No test may reach a real model, a real code host or the network.** Fakes live in
  `test/helpers/`.
- **Never touch the maintainer's real workspaces.** Point `CERIMONIAS_DATA_DIR` (and
  `CERIMONIAS_SPECS_DIR`) at an empty folder for anything exploratory. Never run
  `npm run dist`: it bundles the Claude Agent SDK and must not be redistributed.
- **Comments say why, not what** — short, in English, no account of how you
  investigated.
