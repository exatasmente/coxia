---
checked-commit: 43b5fdc5581544751c89d63a06245c5eff005e12
checked-date: 2026-10-08
evidence: [CLAUDE.md, CONTRIBUTING.md, docs/README.md, package.json, src/main/index.ts]
summary: What this project is, how it is built and tested, and how to find a rule, a procedure or a role note in this folder
---

# Coxia

Coxia is a desktop app (Electron + React + TypeScript, with a phone companion PWA) where a
solo maintainer runs voice ceremonies and a fleet of agents over a repository's development
cycle. One agent per open task reads the repository, the specs and the documentation you
point it at before it says a word, helps unblock the work, and hands you the minutes. It
never changes anything outside your machine without your explicit yes.

The package is named `cerimonias` for historical reasons: the data folders, the installed
executable and the desktop entry keep that name, while the product name is Coxia.

## Where to look

| File | What it holds |
|---|---|
| `rules/overview.md` | The architecture: processes, main/renderer/shared, the modules, the data layout |
| `rules/configuration.md` | `WorkspaceConfig`, its schema versions and migrations, secrets, export and import |
| `rules/development-cycles.md` | The cycle templates, `devCycle`, stages, the agent flow and its teams |
| `rules/runner.md` | How an issue goes through the agent cycle: worktree, stages, gates, autonomy, the cycle memory |
| `rules/code-hosts.md` | The neutral VCS provider interface: GitLab, GitHub, Bitbucket, the write path |
| `rules/model-providers.md` | The two agent engines, the providers, the connection test, what was verified |
| `rules/safety-model.md` | Read-only agents, the write door, the audit log, test workspaces, the sandbox, the web policy |
| `rules/i18n.md` | The `t()` rule, the two catalogs, the voice-aware `tv()`, the lint |
| `rules/key-store.md` | The credential store, its three sources, and the rule that a value never leaves it |
| `rules/build-and-test.md` | Setup, scripts, the CI gates, how to add a test |
| `rules/releasing.md` | Two builds, the release branch, beta, stable, what a tag triggers |
| `rules/documentation.md` | How the docs in `docs/` are written and indexed |
| `rules/public-repo.md` | The public audit, the placeholder rule, the false-positive file |
| `rules/conflict-verification.md` | The per-project command run before a conflict merge commit |
| `rules/voice.md` | Voice is optional: what "off" means, the engines, the wording |
| `rules/updates.md` | How an installed app updates itself, the channels, the feed |
| `skills/add-a-vcs-provider.md` | The steps to add a code host |
| `skills/add-a-cycle-template.md` | The steps to ship a development-cycle template |
| `skills/add-a-model-provider.md` | The steps to add a model provider or a new engine |
| `skills/add-a-language.md` | The steps to add a third interface language |
| `skills/verify-a-change.md` | What to run before calling a change done |
| `roles/developer.md`, `roles/qa.md`, `roles/tech-lead.md`, `roles/product-owner.md`, `roles/support.md`, `roles/customer-success.md`, `roles/release-manager.md` | Notes for each agent of the shipped team |
| `IMPORT_NOTES.md` | What was imported from this repository's Claude Code files, and what was left out and why |

## What this folder is, and what it is not

`.coxia/` is the documentation the app's own agents read. `docs/` at the repository root is the
project's documentation for people; this folder does not replace it. Both live in the same
tree, so keep them consistent: a change that makes a statement here false should fix it in the
same pull request.

## The shape of a change

1. Branch from the open release branch (`release/X.Y.Z`) or, when no version is open, from
   `main`. Name the branch for what it does.
2. Write code, tests and the changelog line under `## [Unreleased]` when the change is
   user-visible.
3. Run the gates in `skills/verify-a-change.md`. A red gate is not "done".
4. Commit in English, lowercase and imperative, one logical change per commit.

Everything a contributor needs beyond this folder is in `CONTRIBUTING.md`, `docs/README.md`
and `RELEASING.md` at the repository root.

## Verified and not verified

This documentation was written by reading the code and the repository's own documents. It
was verified by reading `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `docs/` and the source
files named in each rule's `evidence` header. No command was run in this stage, so nothing
here is a claim that a gate passed.
