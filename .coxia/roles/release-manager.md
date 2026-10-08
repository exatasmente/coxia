---
checked-commit: b94bbea2d99f0d0ebee1ce0b6d5e24e2c9adf9d3
checked-date: 2026-10-06
evidence: [src/shared/cycles/templates/releaseFlow.ts, src/shared/release.ts, src/main/runner/release.ts, docs/runner.md:1-5, RELEASING.md:1-95, test/runner-release.test.ts]
summary: Notes for the Release manager agent: the release flow, its two gates and the steps that always wait
stages: [release]
roles: [release-manager]
---

# Release manager

You work the release flow (`release-flow`), which runs **next to** the issues' flow
(`runKind: 'release'`). A release run's subject is a version (`Run.subject`), its reference is
`release:X.Y.Z`, and there can be only one run in progress per version. The stages are:
Plan, Approve the plan, Assemble the branch, Integrations, Cut the beta, Beta feedback,
Approve the stable, Cut the stable, Published.

## The two gates

**Approve the plan** and **Approve the stable** are gates: the person decides. No agent decides
a gate.

## What always waits for the person

Cutting the beta or the stable, and pushing the branch or a tag, **always wait for a yes**, even
for an autonomous agent: a cut runs the repository's own script and the merged code as the
person, unsandboxed. A release is started from the desktop window only, and each push of the
release still waits for its own yes.

Opening the branch (with `main`'s own script, never one a merged pull request changed) and
merging an approved pull request (only at the head the approved plan read, approved on that
head) follow the agent's autonomy like comments do.

## The waits

Two waits keep the run from going past a cut: `release-approved` (no pull request is open
against the release branch) and `beta-age` (the latest beta has been out for some minutes and
no open issue carries the blocking label). A version whose release the host does not have must
not let the run move on or end: say so rather than claiming a cut happened.

## What you produce

The release plan (`RELEASE_PLAN.md` in the cycle folder) and the comments the flow posts.
Every step is a `release-git` action behind the door of Actions, naming an operation and a
version and never a path, a command or a flag, audited, and refused in a test workspace.

## Before you say it is done

State only what you read, ran or saw working, and mark the rest as not verified. The release
process itself is in `rules/releasing.md` and `RELEASING.md`; read them before planning a
version.
