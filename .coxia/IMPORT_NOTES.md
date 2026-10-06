---
checked-commit: 1a0858c59ed1d4c43e03feb3e709bbefd8441336
checked-date: 2026-10-06
evidence: [CLAUDE.md, CONTRIBUTING.md, README.md, docs/README.md, docs/documentation.md, scripts/public-audit.mjs, package.json]
summary: What was imported from this repository's Claude Code files into the .coxia docs, what was left out and why, and what a later pass re-checked against the code
---

# Import notes

This run creates the agent documentation in `.coxia/`. The issue lists one Claude Code file to
read and import, never to alter: `CLAUDE.md`. This note says what was imported and where, what
was left out and why, so a person can disagree, and what a later pass re-checked against the
code after the draft was approved.

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

## Re-checked after the draft was approved

The draft was approved, and the files were re-read against the current code before this
description was written. No command was run, so the gates still have not been exercised. The
`evidence` headers of the files touched here still carry the round's original commit and date;
the app writes the real commit and day when it commits the change.

| What was off | Where | Fixed by reading |
|---|---|---|
| A cross-reference to `rules/secrets.md`, a name that does not exist | `rules/safety-model.md` | Points at `rules/key-store.md` |
| The `checkFlow` error list was missing `agent-on-non-work` and `returns-to-non-work` | `rules/development-cycles.md` | `src/shared/runs/flowCheck.ts:10-11` |
| `runs:migrateFlow` was described as moving the run's own copy of the flow | `rules/development-cycles.md` | `src/shared/runs/flow.ts:65-82`: the run keeps its snapshot; the command moves the configuration's flow |
| `flows` (the per-squad flows) was missing from the `devCycle` field table | `rules/development-cycles.md` | `src/shared/config/types.ts`, `src/shared/runs/squadCheck.ts:157-178` |
| The engineering flow was said to reuse the `reviewer` agent | `rules/development-cycles.md` | `src/shared/cycles/templates/agentFlow.ts:33` names `tech-lead` |
| The cross-reference for the team's permissions pointed at the wrong rule | `rules/development-cycles.md` | Now points at `docs/cycles.md` and `src/shared/config/team.ts` |
| The GitLab read list did not match `GLAB_READ`, and the read path was described as always going through `VcsRead` | `rules/code-hosts.md` | `src/main/vcs/readPolicy.ts:13-26,66-72` |
| The escalation chain (`turnsTo`, the liaison hop, squad autonomy) was missing | `rules/runner.md` | `src/shared/config/types.ts:541-545`, `src/shared/config/squads.ts:74-94`, `src/main/runner/service.ts:479-486` |
| The rule that a run's own scripts come from the clone was missing from the runner rule | `rules/runner.md` | `RELEASING.md`, `docs/runner.md`, `src/main/runner/door.ts` |
| The conflict-verification rule mismatched the screen's own words and lacked the command cap | `rules/conflict-verification.md` | `src/renderer/src/screens/ConflictVerifySection.tsx`, `src/shared/verifyCommands.ts:8-13` |
| Evidence headers named a translated Portuguese document (`docs/cycles/30-agent-permissions/feat/1_SPEC.md`) and three tests that do not exist (`test/secrets.test.ts`, `test/vcs-read-policy.test.ts`, `test/verify-defaults.test.ts`) | `roles/qa.md`, `roles/tech-lead.md` | Replaced with the code that states the same thing (`src/main/runner/commands.ts`, `src/main/vcs/readPolicy.ts`); the conflict rule gained `test/verifyDefaults.test.ts` |
| A restatement of the two-folder split, which `docs/documentation.md` already owns | `rules/documentation.md` | Shortened, and the index summary now names both sections |

Two things in the draft were left as they are, deliberately: `rules/documentation.md` repeats
`docs/documentation.md` about a new interface string needing `t()` (a reader of `.coxia/` should
not have to open `docs/` for it), and `rules/public-repo.md` restates `CLAUDE.md`'s summary of
what the audit hunts (the coded patterns themselves are not readable, so the rule has to carry
the description). Both are the kind of repetition a reviewer may want to cut.
