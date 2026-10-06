---
checked-commit: 0000000
checked-date: 2000-01-01
evidence: [CLAUDE.md, CONTRIBUTING.md, README.md, docs/README.md, package.json]
summary: What was imported from this repository's Claude Code files into the .coxia docs, and what was left out and why
---

# Import notes

This run creates the agent documentation in `.coxia/`. The issue lists one Claude Code file to
read and import, never to alter: `CLAUDE.md`. This note says what was imported and where, and
what was left out and why, so a person can disagree.

## What the task listed

- `CLAUDE.md` (the repository root).
- No `.claude/` folder was listed, and the repository has none. The reference docs under the
  workspace's `.claude/rules/` and `.claude/knowledge-base/` are outside this working tree and
  could not be read here; nothing from them is imported.

## What was imported, and where it landed

`CLAUDE.md` names the tree's facts and points at the repository's own documents. The facts it
carries were checked against the code and the docs, then rewritten in the `.coxia` layout:

| In `CLAUDE.md` | Where it landed | Checked against |
|---|---|---|
| The app is Electron + React + TypeScript; a solo maintainer runs voice ceremonies and agents over a repository's cycle | `.coxia/README.md` | `README.md`, `package.json` |
| Setup, scripts and tests live in `CONTRIBUTING.md` | `.coxia/rules/build-and-test.md`, `.coxia/skills/verify-a-change.md` | `CONTRIBUTING.md`, `package.json`, `.github/workflows/ci.yml` |
| The gates before a change is done (typecheck, tests, theme audit, i18n lint, public audit; CI adds the build) | `.coxia/skills/verify-a-change.md`, `.coxia/rules/build-and-test.md` | `CLAUDE.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml` |
| The public audit is a hard gate: patterns, neutral placeholders, the allow file | `.coxia/rules/public-repo.md` | `scripts/public-audit.mjs`, `scripts/public-audit.allow.json`, `CONTRIBUTING.md` |
| English for code, tests, identifiers and commit messages | `.coxia/rules/build-and-test.md`, `.coxia/roles/developer.md` | `CONTRIBUTING.md` |
| Every user-facing string goes through `t()`, key in both catalogs | `.coxia/rules/i18n.md` | `docs/i18n.md`, `test/i18n.test.ts` |
| The renderer uses theme tokens, never literal colors | `.coxia/rules/build-and-test.md` | `CONTRIBUTING.md`, `scripts/theme-audit.mjs` |
| No test may reach a real model, a real code host or the network; fakes in `test/helpers/` | `.coxia/rules/build-and-test.md` | `CONTRIBUTING.md`, `test/helpers/` |
| Never touch the maintainer's real workspaces; point `CERIMONIAS_DATA_DIR` at an empty folder | `.coxia/rules/build-and-test.md` | `CONTRIBUTING.md`, `src/main/index.ts` |
| Never run `npm run dist` (it bundles the Claude Agent SDK) | `.coxia/rules/releasing.md` | `RELEASING.md`, `package.json` |
| Comments say why, not what | `.coxia/rules/build-and-test.md` | `CONTRIBUTING.md` |

Beyond `CLAUDE.md`, the run read the repository's own documents (`README.md`,
`CONTRIBUTING.md`, `RELEASING.md`, `docs/*.md`, `CHANGELOG.md`) and the source files named in
each `.coxia` file's `evidence` header, and it wrote rules for the architecture,
configuration, cycles, the runner, code hosts, model providers, the safety model, the
credential store, releasing, updates, voice and conflict verification; skills for the three
"how to add" procedures and for verifying a change; and role notes for the seven agents of the
shipped team.

## What was left out, and why

Every item below is a rule about how another tool's session works, not a fact of the project,
so it stays out of the `.coxia` files. The prompt for this stage says so explicitly: "a
subagent never pushes" is a session rule; "the runner is the only module that writes to the
code host" is a project fact and is imported.

| Left out | Where it was | Why it is a session or tool rule |
|---|---|---|
| The repository "sits under a folder carrying a `CLAUDE.md` for an unrelated codebase; none of those rules apply" | `CLAUDE.md`, "Where this repository sits" | It describes how to read a checkout in one person's workspace, not the project |
| "Do not restate these here; read them and link to them", the "Where the facts live" table | `CLAUDE.md` | It governs how the Claude Code session writes its own file; the equivalent — pointing a reader at the repository's docs — is done in `.coxia/README.md` and `.coxia/rules/documentation.md` |
| "Run these and report what actually happened — do not describe a gate you did not run" | `CLAUDE.md` | The gates themselves are imported; the phrasing addresses a tool's session. The same instruction for the app's agents belongs to the app's own runner prompts, which are catalog entries, not this folder |
| The claim that the public audit "fails when a file ... carries the name of the company the app was born in" and the note that "the public audit below is why this document does not name it" | `CLAUDE.md` | The audit rule is imported as a project rule (`.coxia/rules/public-repo.md`); the sentence about why *this* file is worded that way is about the session's own document |
| The paragraph on `nvm use` and the exact shell block as a session ritual | `CLAUDE.md` | The commands are imported as a project fact; the "before you call a change done" instruction to a human/agent session is session framing |
| The PowerShell/bash "Working rules" that address a Claude Code session (branch, commit prefix, "do not add a `Co-Authored-By:` trailer") | parts of `CLAUDE.md` and `CONTRIBUTING.md` | The commit convention (English, lowercase, imperative, one change per commit) is a project fact and is imported into `.coxia/rules/releasing.md`; the no-AI-attribution instruction is about a tool's output, so it is left out |
| The pointer to the workspace's `../CLAUDE.md` and its development cycle | `CLAUDE.md` | It describes the surrounding workspace's own tooling, not this repository |

## What could not be verified

- The reference documents under the workspace's `.claude/rules/` and `.claude/knowledge-base/`
  were not readable from this working tree, so nothing from them is claimed here.
- No command was run in this stage. Everything above was verified by reading files; nothing
  here says a gate passed.
- The current code's schema version and template list change over time: the `.coxia` files
  point at the source (`src/shared/config/types.ts`, `src/shared/cycles/index.ts`) and at
  `docs/`, rather than copying numbers that go stale.
