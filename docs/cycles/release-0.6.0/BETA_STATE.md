# Cutting the beta (release 0.6.0)

What this stage checked and what the check found, and how the beta of this release stands
after the person's decision. Nothing was requested from the release step: no `open`, no
`merge-pr`, no `beta`, no push. No new cut was asked for because the release already holds its
beta, and the person chose to treat that beta as this release's beta rather than cutting a new
one (see "The decision").

## The branch

- `release/0.6.0` exists locally and on the remote (`origin/release/0.6.0`).
- Both point at the same commit, `79d7dd2`, whose subject is `feat: release 0.6.0-beta.2`.
- That commit is a **cut commit**, not a merge: the branch already went through a `beta` step
  and its result sits on the remote.

## The tags

- `v0.6.0-beta.1` exists (commit `ac19d5a`).
- `v0.6.0-beta.2` exists (annotated tag at commit `79d7dd2`), and it is on
  `origin/release/0.6.0`.
- The stage snapshot said the latest beta was `v0.6.0-beta.1`, so the next cut would be
  `beta.2`. The repository holds `beta.2` already, so the next number a new `beta` cut would
  take is `0.6.0-beta.3`, not `beta.2`.

## The pull requests

Every pull request aimed at `release/0.6.0` reads as `merged` on the host:

| PR | Head read | Changelog impact |
|---|---|---|
| #50 | `03e3e771` | ceremony agents ask before a command; a rule remembered |
| #55 | `8b3f967f` | cycle memory read and rewritten by every stage |
| #61 | `e94dce6e` | `@agent` answers wherever a person writes |
| #62 | `3dea0c26` | a called agent in a run's thread shows it is working |
| #63 | `e8854fd5` | an exhausted provider key is a wait |
| #64 | `98f7e24f` | sole-maintainer review: the person's yes stands for the approval |
| #65 | `4364fa52` | release script tests get more time (test-only) |

#64, which the plan listed as the item in doubt (not approved, conflict), now reads as
`merged` on the host at head `98f7e24f`, and its merge commit `766d101` is an ancestor of
`origin/release/0.6.0`. So the one thing the plan left open has already landed on the branch.

## Why no new cut was asked for

A `beta` step on this branch would run `scripts/release.sh beta`, which takes the next number
after the highest local beta tag. With `v0.6.0-beta.2` already present, that is
`0.6.0-beta.3`: a **new** beta cut on a branch whose last cut (`beta.2`) has not been reported
as published, tried or blocked. Cutting `beta.3` would have:

- produced a version whose changelog section would fold whatever `[Unreleased]` holds on top of
  a beta that nobody has reported on, and
- run a cut that waits for the person's yes and then a branch push that would find the remote
  already at the `beta.2` commit for everything the branch holds before the new cut — i.e. the
  push would carry only the new cut commit.

This is not the step the stage describes ("cut the beta"; the branch already has one). The
correct reading of the state is that **the beta cut of this release has already been carried
out** (its local cut and its branch/tag are on the remote) and what is missing is the check
that the host shows the `beta.2` pre-release, a different stage. The question the stage put to
the person settled this reading, and the person confirmed it.

## The decision

The person chose to **treat the already-cut `v0.6.0-beta.2` as this release's beta and only
check and publish its draft on the host**, rather than cut a new beta (`0.6.0-beta.3`) on top
of a `beta.2` not yet confirmed as published.

Consequences:

- This stage asks for **no cut and no push**. The beta cut, the branch push and the tag push of
  `beta.2` are already on the remote; nothing new is sent from here.
- The stage that follows has to confirm, without presuming, that the host shows the
  `v0.6.0-beta.2` pre-release, and the person publishes its draft. Whether that pre-release is
  published, drafted or missing is still unknown here (see "Not verified").

## Not verified

- Whether the `v0.6.0-beta.2` **pre-release exists and is published** on the host. The code
  host was read for the pull requests only; the release/pre-release for the tag was not read
  here, so whether `beta.2` is published, drafted or missing is unknown.
- Whether the workflow run for `v0.6.0-beta.2` succeeded and produced a draft.
- The release script's own checks (`tsc`, `vitest`, theme audit, i18n lint, `electron-vite
  build`) and the app build: none were run in this stage.
- Whether the commit the branch points at (`79d7dd2`) still holds. If the branch received a
  push after this reading, the check has to be made again before the following stage.
