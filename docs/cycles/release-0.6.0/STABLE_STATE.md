# Cutting the stable (release 0.6.0)

What this stage checked, what it asked for, and how the stable of this release stands. The
person's decisions in this run opened the gate ("the beta is no longer waited for: release the
stable", and the stable approved), so the stage moved from the check to the ask.

## What was asked for

Three steps, in this order, each one waiting for the person's yes in Actions:

1. `stable` — merges `release/0.6.0` into `main` and cuts `0.6.0` locally (tag `v0.6.0`).
2. `push-branch` (`main`) — sends `main` with the stable's commit.
3. `push-tag` (`stable`) — sends the tag `v0.6.0`.

**Nothing has run yet.** Each of the three is in Actions, waiting for the person's yes. The
pushes can only be approved after the cut is done; a push asked in the same stage as the cut is
carried out in the order the three need each other (Actions says what it waits for, and a yes
given out of order is refused with nothing run).

## The state the check found (verified in this stage)

- `release/0.6.0` is on the remote at `79d7dd2` (subject `feat: release 0.6.0-beta.2`), and this
  reading was made against the current remote, not the one a previous stage left.
- The annotated tag `v0.6.0-beta.2` dereferences to `79d7dd2`, the same commit the remote's
  release branch holds.
- The pre-release `v0.6.0-beta.2` **exists on the host and is published** (created
  `2026-10-04T19:12:02Z`, published `2026-10-04T19:21:03Z`, `isDraft: false`, `isPrerelease:
  true`). This is the publication the earlier `BETA_STATE.md` left as "not verified"; the host
  now shows it. `v0.6.0-beta.1` is also published.
- Every pull request aimed at `release/0.6.0` reads `MERGED` on the host: #50, #55, #61, #62,
  #63, #64 and #65. **No pull request is open against the release branch.**
- CI on the release branch is green: the latest run for `release/0.6.0` is `success` on
  `79d7dd2`, the branch's commit.
- `main` on the remote is at `0792535` (also what the local `origin/main` tracking ref holds),
  and `0792535` is already an ancestor of `release/0.6.0` — so merging the release branch into
  `main` is a fast-forward, with no divergence.

## What a stable cut requires (read in `scripts/release.sh`, stable rules)

The stable cut refuses unless, among others: a `v0.6.0-beta.*` tag exists (it does, `beta.2`),
that latest beta is in `main` (it will be, once the release branch is merged into `main`),
`release/0.6.0` (here or on `origin`) is merged into `main` and holds nothing newer than the
latest beta (it holds exactly `beta.2`), `origin/main` has nothing `main` lacks (it does not),
and the version is above the latest stable of its line (`v0.6.0` is above `v0.5.0`). It folds
the `[0.6.0-beta.*]` sections and `[Unreleased]` into one `[0.6.0]` section and removes the beta
sections. It runs the CI checks (tsc, tests, theme audit, i18n lint, `electron-vite build`) and
the public audit. The apply of the cut is what the person approves in Actions; the outcome is
recorded when it runs.

## Not verified

- Whether the cut and the two pushes were carried out: they are waiting for the person's yes,
  so no stable commit, no tag and no push exists yet because of this stage.
- Whether the host then shows the tag `v0.6.0` on `main` (the *Stable on the host* wait). This
  is the check the stage after this one has to make, without presuming.
- Whether the workflow run for `v0.6.0` succeeds and produces a draft, and whether that draft is
  published — the draft is checked and published by the person.
- The folded `[0.6.0]` changelog section itself, which only exists in the cut commit if the cut
  runs.
