# What goes into the next version

This plan says which number the version takes, what enters it, what the changelog will tell
and what stays out. It was written from what the code host shows for the pull requests aimed
at the release branch and from the changelog in the branch, read at the time of the plan.

## The number

**0.6.0.** The version brings new behavior a person uses, not only repairs, so it moves the
minor number up from 0.5.0. The release branch already names 0.6.0. A release whose changes
were only fixes would take the patch instead.

## What goes in

The release branch gathers seven pull requests. Six of them already sit in the branch:

- [#50 — the ceremony agents ask before a command and remember what is always allowed](https://github.com/exatasmente/coxia/pull/50) — merged.
- [#55 — each run keeps a cycle memory every stage reads and rewrites](https://github.com/exatasmente/coxia/pull/55) — merged; closes [#52](https://github.com/exatasmente/coxia/issues/52).
- [#61 — an agent named with `@` answers wherever a person writes in the app](https://github.com/exatasmente/coxia/pull/61) — merged; closes [#53](https://github.com/exatasmente/coxia/issues/53).
- [#62 — an agent called in a run's thread shows that it is working](https://github.com/exatasmente/coxia/pull/62) — merged; closes [#29](https://github.com/exatasmente/coxia/issues/29).
- [#63 — an exhausted provider key becomes a wait instead of a failure](https://github.com/exatasmente/coxia/pull/63) — merged; closes [#58](https://github.com/exatasmente/coxia/issues/58).
- [#65 — the release script tests get the time the release step needs](https://github.com/exatasmente/coxia/pull/65) — merged; a test-only repair.

The seventh is the one still open:

- [#64 — the only maintainer's yes stands for the review of a release merge](https://github.com/exatasmente/coxia/pull/64) — **not approved** on the host and with a conflict against the release branch. It does not enter as it is; see below.

The branch already carries, under `[Unreleased]`, one repair with no pull request of its own
listed here: a release run no longer moves on, or ends, with a release the host does not have.
That change is part of what 0.6.0 will carry.

## What the changelog will say

In plain words, the version tells a person that:

- an agent of a ceremony can ask before running a command, and a command that is always allowed is remembered as a rule;
- every run keeps a memory of the cycle that each stage reads and that the person can correct;
- naming an agent with `@` makes it answer anywhere a person writes in the app, not only inside one run's conversation;
- an agent called in a run's thread looks like it is working while it answers;
- a provider key that ran out of room stops being an error that ends the run and becomes a wait, with the reason in plain words and the run going on by itself when the provider answers again;
- a release run no longer moves past, or ends with, a release the host does not have, and a push that finds the remote already holding what it would send ends as nothing sent rather than as done.

## Left out or at risk

- **#64 is the item in doubt.** It is not approved on the host, and it has a conflict against the release branch. It changes how a release merge is reviewed in a repository a single person maintains; without it, that path keeps requiring an approval the host does not let the author give. It enters only if it is approved and its conflict is resolved before the merge step; otherwise it stays out of 0.6.0 and can go into a later version. (The plan cannot merge a pull request that is not approved.)
- **The number of the next beta.** What the release snapshot reports is that the latest beta tag is `v0.6.0-beta.1`, so the next cut would be `0.6.0-beta.2`. The changelog read in this branch still holds its entries under `[Unreleased]`, with no `0.6.0-beta.1` section; that is not something this plan could reconcile, and the cut itself decides the number from the tags the repository holds. Not verified here.
- **Nothing else was checked by running it.** The checks of the release script, the build and the app were not run in this stage; a merge step still re-reads the host and refuses a pull request whose head moved, whose checks fail or that is not aimed at the release branch.
