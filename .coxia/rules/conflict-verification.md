---
checked-commit: 0000000
checked-date: 2000-01-01
evidence: [docs/verify-commands.md:1-54, src/main/verify-move.ts, src/shared/verifyCommands.ts, test/verify-commands.test.ts, test/verify-move.test.ts, docs/configuration.md:49-51]
summary: The per-project command run in the conflict worktree before the merge commit
stages: [development]
roles: [developer]
---

# Conflict verification

A **per-project command** that Coxia runs in the conflict worktree, after the resolution is
applied and before the merge commit (Settings › Conflict verification). It runs with
`bash -lc` inside the worktree, with `CLONE_DIR` (the clone) and `WORKTREE_DIR`. The merge's
files come from `git diff --cached --name-only HEAD`. A non-zero exit code fails the
verification.

## Whose command it is

The command belongs to the **workspace**: it lives in its `config.json` as
`projects.verifyCommands`, a map `group/project` → command. It goes out and in with export and
import, and the import preview lists it among the programs the file would run. Two workspaces
with the same project can have different commands. A key that is not `group/project` makes the
file invalid. Only the app window writes it (`conflicts:verify-set`); a paired browser may
read but not choose what Apply executes.

The screen lists the workspace's repositories (by `projectPath`, or the path of the
`remoteUrl`; a repo with no remote has no project), the projects of the release mirrors and the
projects that already have a command. The **Suggestion (Node)** button fills a project's field
with the Node command from the renderer's defaults file; save for it to count.

## The Node command

The default Node command installs the dependencies in the worktree (or links the clone's
`node_modules`), typechecks and runs the tests related to the changed `.ts` files. A
pre-existing failure on the main branch shows up here: compare with it before blaming the
resolution.

## Other stacks

Write the command the project needs, and follow two rules: do not write outside the worktree
(the cache and artifacts stay in it or in `/tmp`), and exit non-zero when something fails, with
`set -e` to stop at the first error.

## The old file

The commands used to live in one file shared by every workspace,
`<data>/conflict-verify.json`. At the first start after the update the app copies each command
into the workspaces whose repository or mirror is that project (without replacing a command a
workspace already has) and renames the file to `conflict-verify.json.migrated`. A command whose
project no workspace lists is not lost: it stays in the `.migrated` file, in
`conflict-verify.unclaimed.json` and, as names only, in `workspaces/migration.log`, and the
screen shows a note with "Use here". `test/verify-move.test.ts` pins the move.

## What was verified

Only fakes and temporary folders were used: the move was exercised on layouts built by the
tests, never on a real installation, and the screen's note was checked by reading the code and
the build, not in a running app.
