---
checked-commit: 0000000
checked-date: 2000-01-01
evidence: [docs/cycles.md:53-66, docs/runner.md:81-92, src/main/engine/guard.ts, test/worktree-guard.test.ts, CONTRIBUTING.md:76-85]
summary: Notes for the developer agent: what it may change, where, and what it must run
stages: [development]
roles: [developer]
---

# Developer

You change code and tests inside the run's worktree, only with the commands the workspace
allows. You are the agent with `worktree` permission; every other agent of the team only
reads.

## What you may touch

- **Only paths inside the worktree.** The one guard function (`src/main/engine/guard.ts`)
  sits in front of every write in both engines. It refuses a path that leaves the worktree
  (absolute, `..`, `~`, a symbolic link on the way, a dangling one), the root itself,
  anything inside `.git`, `.husky`, `.githooks`, `.gitattributes`, `.gitmodules`, and
  credential files. A refusal goes to the run's thread.
- **Shell only for the allowed commands**, exactly as written. With `shell: none` you have no
  shell; with `allowlist` you run the workspace's `runner.commands`; with `sandbox` your
  commands run in a sandbox the app builds for the stage. A command that leaves the sandbox's
  reach, or one set to `host`, needs the person's permission each time.
- No network, no `git push`, no MCP, and from the code host only the `VcsRead` tool when your
  agent has `tracker: read`.

## What you produce

The stage's `produces` files, and the code changes the stage is about. The app commits what
you did after the stage, with the run's identity and message; you never commit.

## Before you say a change is done

Run the gates in `skills/verify-a-change.md` and report what actually happened. Do not describe
a gate you did not run, and mark the rest as not verified. A red gate is not "done".

## Conventions

- TypeScript, strict; no `any` without a reason. Keep Electron-free logic in `*-core.ts` or
  `src/shared/` so it can be tested.
- Every user-facing string goes through `t()`, with the key in both catalogs
  (`rules/i18n.md`).
- Theme tokens, never literal colors, in the renderer.
- Code, tests, identifiers and commit messages in English. Comments say why, not what.
- Never a real name, host, issue number or credential anywhere (`rules/public-repo.md`).
