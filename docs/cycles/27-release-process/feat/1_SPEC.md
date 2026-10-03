# #27 Release process: a release branch per version, then beta, then stable — functional spec

Issue: https://github.com/exatasmente/coxia/issues/27

The issue has two parts. **Part 1** is the process itself: branches, versions, the release script, CI, the workflow and the docs. **Part 2** is the same process as something the runner drives: a Release manager agent, release actions behind the door of Actions, a run whose subject is a version, wait events and a template. Part 1 stands alone and is useful without part 2; part 2 only automates what part 1 makes explicit, and must never do anything a person cannot do with the script.

Section 3 is the process, section 4 the cycle. Sections 5 and 6 are the safety rules and the decisions that were taken (and the ones that are the maintainer's).

## 1. What exists today (read from the code)

| Piece | Today |
|---|---|
| `scripts/release.sh <version>` | refuses a dirty tree, a branch other than `main` (unless `--allow-branch`), an existing tag and an empty changelog; runs the checks and the public audit; bumps `package.json` and the lock; moves `[Unreleased]` under the version; commits and tags `v<version>` locally; prints the push commands. A pre-release suffix is accepted on any branch it runs on |
| `.github/workflows/ci.yml` | runs for pushes and pull requests to `main` only |
| `.github/workflows/release.yml` | a tag `v*.*.*` builds the public Linux packages and uploads them to a **draft**. The feed is `<channel>-linux.yml`, the channel being the first identifier after the dash (`-beta.1` gives `beta-linux.yml`); electron-builder, for a GitHub publisher, writes only that one feed (`computeChannelNames` in `app-builder-lib`), so a beta never writes `latest-linux.yml`. `scripts/verify-release-files.sh` checks that and the sha512 |
| the app | channels `stable` and `beta` in Settings › Updates (`docs/updates.md`); `beta` reads `beta-linux.yml`; switching never downgrades |
| the runner (for part 2) | one run per issue, in a worktree on a new branch; the app commits, the agent never writes `.git`; the **push and the pull request always wait for a person's "yes"** (`proposeRunPush` in `src/main/actions.ts`, `runner/door.ts`); the host's writes go through `runVcsAuto` (autonomous agent, audited) or `proposeVcsGroup` (waits); wait stages know `pr-merged`, `reporter-reply`, `label`, `linked-done` and `time` (`WAIT_KINDS`, `src/shared/config/types.ts`) |

Three gaps this issue closes:

1. Everything merges straight into `main` and a tag on `main` publishes a stable release to every installed app at once. Nothing reaches a smaller group first, and a release carries whatever happened to be merged that day.
2. The GitHub merge button records the account's email as the merge author. Merges are made locally with the maintainer's noreply identity.
3. **A bug seen on `v0.5.0-beta.1`:** the step "Check what the draft release holds" (and the one before it) looked the draft up by `tag_name == $TAG`. electron-builder creates a *pre-release* draft with the tag `untagged-<hash>`: GitHub links the real tag only when the draft is published. The lookup found nothing and the job failed after the draft was already uploaded. The lookup has to use the release **name** (`v<version>`, set with `releaseInfo.releaseName`), which is the one thing electron-builder fixes.

## 2. Vocabulary

- **Open release branch**: `release/X.Y.Z`, cut from `main` (a new minor or major) or from a stable tag (a patch). It is where the version's pull requests go.
- **Beta**: `vX.Y.Z-beta.N`, an annotated tag on `release/X.Y.Z`, published as a pre-release on the `beta` channel (`beta-linux.yml`).
- **Stable**: `vX.Y.Z`, an annotated tag on `main` after `release/X.Y.Z` was merged into it, published as a normal release (`latest-linux.yml`).
- **Frozen**: nothing but fixes for what the beta found enters the branch, and each fix produces the next beta.

## 3. Part 1: the process

### 3.1 The flow

1. **Open the version.** `scripts/release.sh open X.Y.Z` (from `main`) or `scripts/release.sh open X.Y.Z --from vA.B.C` (a patch, from the stable tag). It creates `release/X.Y.Z` **locally** and switches to it; nothing is pushed. The number follows semver: a feature bumps the minor, a fix only the patch.
2. **Develop into it.** Each issue has its branch, and its pull request targets `release/X.Y.Z`, not `main`. CI runs on those pull requests. The maintainer merges **locally** (`git merge --no-ff`, with the noreply identity passed with `git -c`), pushes the branch, and closes the pull request as merged by the push; the host's merge button is never used.
3. **Close the release → beta.** On `release/X.Y.Z`, `scripts/release.sh beta` cuts `X.Y.Z-beta.<next>`: version bump, changelog, one commit, one annotated tag. The maintainer pushes the branch and the tag; the workflow builds a draft **pre-release**; the maintainer checks and publishes it. Only apps on the `beta` channel receive it.
4. **Fixes during the beta** go into the same branch and produce `beta.2`, `beta.3`...
5. **Stable.** When the beta is good, `release/X.Y.Z` is merged into `main` (fast-forward when `main` has not moved), and on `main` `scripts/release.sh stable` (or `scripts/release.sh X.Y.Z`) cuts `vX.Y.Z`. The maintainer pushes `main` and the tag, publishes the draft, and deletes the release branch.
6. **Urgent fix on a stable version.** `scripts/release.sh open X.Y.(Z+1) --from vX.Y.Z`, the same path with a short beta.

### 3.2 The rules of `scripts/release.sh`

Modes are told by the first argument: `open`, `beta`, `stable`, or an explicit version (`X.Y.Z-beta.N` is a beta, `X.Y.Z` is a stable). Options kept as they are: `--author`/`RELEASE_AUTHOR`, `-m`, `--date`, `--skip-checks`, `--dry-run`; the public audit runs in every mode that cuts a version, even with `--skip-checks` and in a dry run; the script never writes `git config` and never pushes. `--allow-branch` keeps its meaning (skip the branch rules) and is loud. New: `--emergency`.

**`open X.Y.Z [--from vA.B.C]`**

| Rule | Refused when |
|---|---|
| The version is a stable semver, each number `0` or without a leading zero (`0.06.0` would make the tag `v0.06.0` and a `package.json` that says `0.6.0`; every version, tag and branch number is checked this way) | it has a suffix or a leading `v` |
| The tree is clean and the branch does not exist | `release/X.Y.Z` exists locally or on `origin`; a tag `vX.Y.Z` or `vX.Y.Z-beta.*` exists |
| From `main` (no `--from`) | `main` does not exist; `origin/main` has commits `main` lacks (update it first); the version is not above the highest stable tag, or is below the version `main` already carries (its `package.json` core, or any stable or beta tag reachable from it); the version is a **patch** (a stable `vX.Y.*` exists) and `main` is not exactly at that stable tag, which is how a patch is told from "everything merged on `main` since" |
| `--from vA.B.C` | the tag is not an existing stable tag; `X.Y` differs from `A.B` (`--from` is only for a patch); the tag is not the **latest stable of that minor**; `Z` is not above `C`; `main` already carries a newer line (a larger major.minor) than the hotfix: hotfixing an older line while `main` has moved on is not modelled (decision D9) |

**`beta` or `X.Y.Z-beta.N`** (on a branch)

| Rule | Refused when |
|---|---|
| The branch is `release/X.Y.Z` | on `main` or any other branch (`--allow-branch` overrides, loudly) |
| The number matches | the version's `X.Y.Z` is not the branch's: `release/0.6.0` cuts `0.6.0-beta.N` only |
| `beta` takes the next number | — (it is the highest existing `vX.Y.Z-beta.N` plus one, 1 when none) |
| An explicit `-beta.N` | the suffix is not exactly `beta.<positive integer>`; the tag exists; `N` is below the highest existing; a gap above the next number only warns |
| The remote | `origin/release/X.Y.Z` exists and has commits `HEAD` lacks (behind or diverged); not skippable. With no tracking ref, one warning line says the remote checks were skipped and that the script never fetches |
| The common checks | dirty tree; an empty `[Unreleased]` with no section for the version; a version below `package.json`'s (core compared) |

**`stable` or `X.Y.Z`** (on `main`)

| Rule | Refused when (`--emergency` skips only those marked *skippable*) |
|---|---|
| On `main` | any other branch (`--allow-branch`, loudly) |
| The version passed the beta (*skippable*) | no `vX.Y.Z-beta.*` tag exists |
| The beta is in `main` (*skippable*) | the latest beta's commit is not an ancestor of `HEAD` |
| The remote is not ahead (*skippable*) | `origin/main` exists and is not an ancestor of `HEAD` (behind or diverged): the tag would sit on a commit the push of `main` is rejected for. With no `origin/main`, one warning line says the remote checks were skipped |
| The release branch is merged and untouched (*skippable*) | `release/X.Y.Z` exists (locally or on `origin`) and its tip is not an ancestor of `HEAD`, or it is ahead of the latest beta (a commit after the last beta was never tried by anyone: cut another beta first). A branch that no longer exists is not an error: the beta tag stands for it, and the output says so |
| Always | the version is not above the latest stable of its own major.minor (of the whole repository when that line has none); `stable` alone reads the version from `package.json`'s pre-release (`0.6.0-beta.2` gives `0.6.0`) and refuses a `package.json` that is already stable |

**`--emergency`** is for a hotfix that cannot wait for a beta. It skips the four *skippable* rules (passed the beta, in `main`, merged and untouched, the remote not ahead), prints each rule it skipped on standard error behind a banner, repeats them at the end, and writes them in the tag's message (the subject `Coxia X.Y.Z (emergency: rules were skipped)` and one `skipped: <rule>` paragraph per rule), so the history says it. It does **not** skip the checks, the audit, the changelog or the version-order rule, and it works only for a stable on `main`.

### 3.3 The changelog

A beta moves `[Unreleased]` under `## [X.Y.Z-beta.N] - <date>`, as a release does today (the compare link goes from the previous tag, which is the previous beta, or the last stable for `beta.1`). A fix for a beta is written under `[Unreleased]` and becomes the next beta's section.

The **stable folds**: `## [X.Y.Z] - <date>` gathers, per subsection (`Added`, `Changed`, `Fixed`...), the bullets of every `[X.Y.Z-beta.*]` section in the order of the betas, then whatever `[Unreleased]` holds; the beta sections and their link lines leave `CHANGELOG.md`, and the stable's compare link goes from the previous **stable**. The reason: a person on the stable channel jumps from `0.4.3` to `0.5.0`, and their release notes must be everything since `0.4.3`, not the last fix of a beta. The published beta pre-releases keep their own notes (built from the tag), so nothing is lost where it was shown. The alternative (keep the beta sections and write a summary by hand) was rejected: it needs a person to copy text, and it duplicates every bullet in the file. Decision D1 below.

### 3.4 CI and the workflow

- `ci.yml` runs for pull requests and pushes to `main` and `release/**`.
- `release.yml` first checks that the tag's commit is reachable from `origin/main` (a stable) or `origin/release/X.Y.Z` (a beta), through `scripts/verify-release-origin.sh` over a checkout with `fetch-depth: 0`, so a tag from a local-only or stale commit publishes nothing; and finds the draft **by name** among drafts (`.name == "v<version>"`, or the tag when GitHub already linked it), in both the step that keeps a pre-release a pre-release and the step that checks the assets; the checks now also assert that a pre-release draft holds `<channel>-linux.yml` and **not** `latest-linux.yml`, and that a final draft holds `latest-linux.yml` and no `<channel>` feed. `RELEASING.md` also says that a draft left from a failed run has to be deleted before the tag is pushed again (electron-builder reuses a draft only by tag, and an untagged one is not found).
- What cannot be verified here: that GitHub still names the pre-release draft `untagged-…` and that the new lookup finds it; the workflow is checked by reading it and by a script test of the `jq` filter against a recorded shape. It is said in `RELEASING.md`.

### 3.5 Docs

`RELEASING.md` (the whole flow, hotfix, local merges, the emergency flag), `CONTRIBUTING.md` (the pull request's base is the open release branch), `docs/updates.md` (how a person joins the beta channel) and the changelog under `[Unreleased] › Added`. `CLAUDE.md` already points to `RELEASING.md` and needs no change.

### 3.6 Acceptance of part 1

1. `scripts/release.sh --dry-run beta` on `release/0.6.0` says `0.6.0-beta.1`, and after that beta is tagged, `0.6.0-beta.2`.
2. On `main`, before any beta, `scripts/release.sh stable` (and `scripts/release.sh 0.6.0`) refuses; after a beta and the merge it says `0.6.0`.
3. A branch whose number does not match the version is refused; so is a beta on `main`.
4. `--emergency` cuts a stable without a beta and says so three times (banner, summary, tag message).
5. The rules have tests that run the real script against temporary repositories, with no network; the changelog fold has its own unit tests.
6. `ci.yml` triggers on `release/**`; `release.yml` finds a draft named `v<version>` whose tag is `untagged-…`.
7. The first use: the pending work goes out as a beta first.

## 4. Part 2: the release as a cycle in the runner

### 4.1 What it is

A flow like any other, with a Release manager agent, so a release is configured, started and followed on the run screen:

| Stage | `type` | Who | Needs |
|---|---|---|---|
| Plan the release: list the approved activities, propose the semver and the changelog (`RELEASE_PLAN.md`) | `work` | Release manager (reads) | the host read of issues and pull requests (#30) |
| Approve the plan | `gate` | person | exists |
| Open `release/{semver}`, merge the approved pull requests into it, cut `v{semver}-beta.1` | `work` | Release manager | release actions |
| Wait for the beta's feedback | `wait` | — | `label` (e.g. `beta-approved`), or the new `beta-age` event |
| Ask for the final version | `gate` | person | exists |
| Merge the release branch into `main`, cut `v{semver}` | `work` | Release manager | release actions |

### 4.2 Release actions behind the door of Actions

A new action kind, **`release-git`**, next to `run-push`. Its stored form names *what* and *which version*, never a folder or a command line:

```
unit: { op, version, runId?, pr?, from? }      op: open | merge-pr | beta | stable | push-branch | push-tag
```

- **The app executes, the agent proposes.** The Release manager has no shell and no `.git` write; it calls an app tool (`ReleaseAction`, like `VcsRead`) that **proposes** one of the ops. The approval path (`approveAction`) validates the unit again (version semver, `pr` an integer, refs through `checkRef`), resolves the clone from the run (the repository id of the run, never a path in the unit) and runs fixed argv: `git` with the ref arguments and **`scripts/release.sh` of that clone** (`open`, `beta`, `stable`) with `--author` taken from `runner.identity` and `--skip-checks` off. The rules of section 3.2 are therefore not re-implemented: the script is the one place that decides.
- **Merging a pull request** is `git fetch` of the pull request's head from the host (a read) followed by `git merge --no-ff` into `release/{semver}` in the clone **with the configured identity**, never the host's merge button, then `push-branch`. The merge refuses a pull request that is not approved (the host's approval and checks, read through the provider), whose base is not the open release branch, or whose head moved since the plan was approved (the unit records the head sha).
- **Push and tags always wait for a person**, whatever the agent's autonomy, exactly as the run's push does today: `push-branch` and `push-tag` are proposals only (`proposeRelease` never goes through `runVcsAuto`). The local ops (`open`, `merge-pr`, `beta`, `stable`) follow the agent's autonomy as the tracker comments do: a "yes" in Actions for an agent that waits, audited calls for an autonomous one, one line in `auditoria.jsonl` per op (`kind: 'release'`, the op, the version, the sha before and after, the exit code). A test workspace refuses them all, like every external effect (`assertExternalWrite`).
- **Nothing a person could not do by hand with the script**: the ops are the script's modes and `git merge`/`git push`. The agent gains no ref, no path, no command string.

### 4.3 A run whose subject is a version

The runner works one issue per run. A release has no issue. Two designs were weighed; section 6 records the choice:

- **A. A "release" issue carries the version.** The run is an ordinary run over a tracker issue whose title or label names the version (`release/0.6.0`). No new run shape; but the run's repo/branch/worktree model assumes the branch is created for the issue, and a release run needs the clone's branches, not a feature branch.
- **B. A run kind.** `Run.subject: { kind: 'issue' | 'release', version? }`: the run's `issue` is a synthesized record (`ref: 'release/0.6.0'`, `iid: 0`, no url) and `branch`/`worktree` point to the release branch's own worktree. The first stage's input is the **list of activities of the version**: the pull requests that target `release/{semver}` (the host's read, #30), or, before the branch exists, those labelled `release:X.Y.Z` or in the milestone `X.Y.Z`; the plan states which rule it used.

Recommendation: **B**, because "one run per issue" is a property of the store (`ref` identifies it for "one run at a time") that a synthesized key keeps working (`release:0.6.0`), and because a release run must work in the branch it cuts, not a branch made for an issue. The run file's version is not bumped: `subject` is optional and its absence means `issue`.

### 4.4 Wait events

Besides `label` and `time`, two new `WAIT_KINDS`:

- **`release-approved`**: every pull request of the version is approved and merged into `release/{semver}`, and none is open against it (the run's activities, read through the provider; the run records the list it planned).
- **`beta-age`** (`minutes`): the latest beta has been **published** for N minutes (read from the host's release, not from the tag) and no issue labelled with the run's blocking label (default `beta-blocker`) is open. A stage that waits on it learns nothing but "ready" or "still waiting".

Both are read-only checks run by the same 5-minute pass as the other waits; both are covered by `flowCheck` (an error without the field they need) and added to the editor and to the wait documentation.

### 4.5 The template

`release-flow`, a cycle template (`src/shared/cycles/templates/releaseFlow.ts`), with the stages of 4.1, one agent (**Release manager**: reads the host, proposes release actions, no shell, no file writes beyond `RELEASE_PLAN.md`), comment templates for its stages (plan, beta cut, stable cut), and catalog keys in both languages. A workspace that applies it keeps its other flows (a flow per run kind, `devCycle.flows`). It is documented in `docs/cycles.md` and `docs/runner.md`, and covered by `test/cycle-templates.test.ts` (it must validate and its stages be reachable).

### 4.6 Acceptance of part 2

1. A run of the release template over a fake host plans a version from the pull requests that target the branch, stops at the first gate with `RELEASE_PLAN.md` in view, and nothing is written before the "yes".
2. The merge of an approved pull request is a local `--no-ff` merge with `runner.identity`, never a call to the host's merge; a pull request not approved, with another base, or whose head moved is refused with a message.
3. `push-branch` and `push-tag` wait for a person with an autonomous agent; a test workspace refuses every op.
4. The release actions validate their unit again at approval, and a unit that names a path, a ref outside `release/*` or `v*`, or a version that is not semver is refused.
5. `release-approved` and `beta-age` hold the run until their condition holds and then go on; `flowCheck` rejects one without its field.
6. The prompt goldens of the other templates do not change.

## 5. Rules

1. **The script is the only place that decides a version.** The runner's actions call it; they do not copy its rules.
2. **Nothing is pushed by a script or by an agent.** A person pushes; the app's push action waits for a "yes" in every mode.
3. **A merge is local and signed with the configured noreply identity.** The host's merge button is never used and never driven.
4. **A stable is a tested beta.** The only way around is `--emergency`, which is loud, recorded in the tag and never silent.
5. **No attribution of a tool** in a commit, a tag or a pull request (`RELEASE_AUTHOR` is a person).
6. **Every release action is audited and refused in a test workspace.**
7. The public audit runs in every mode that cuts a version.
8. The prompt goldens and the behavior of an existing flow do not change.

## 6. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | The stable **folds** the betas' changelog sections into `[X.Y.Z]` and removes them; the alternative is keeping the sections and summarising by hand | taken in part 1 (recommended; reversible: `release-changelog.mjs`) |
| D2 | `--emergency` skips the beta, merge and remote rules only, in a stable on `main`; it is written in the tag | taken in part 1 |
| D3 | `stable` also accepts being the keyword (version read from `package.json`) | taken in part 1 |
| D4 | The branch's merge is checked with the beta tag **and** the release branch when it still exists; a branch deleted earlier is not an error | taken in part 1 |
| D5 | Part 2 uses a **run kind** (`subject`), not a release issue | recommended; **maintainer to confirm before part 2** |
| D6 | Pushes and tags always wait for a person, even for an autonomous Release manager | recommended; **maintainer to confirm** |
| D7 | The merge of a pull request is a `git merge --no-ff` in the app's clone, not the host's API | follows the issue; recorded here |
| D9 | Hotfixing an older line while `main` carries a newer one is **not supported**; `open --from` refuses it and `RELEASING.md` says what to do instead (the current line, or by hand outside the flow) | taken in the review of part 1 |
| D10 | The script compares `HEAD` with the remote-tracking refs it has and never fetches: a stable needs `origin/main` to be an ancestor of `HEAD` (skippable with `--emergency`), a beta needs the same of `origin/release/X.Y.Z` (not skippable) | taken in the review of part 1 |
| D8 | The issue's "first use" (the pending work of #26 as `0.4.1-beta.1`) has been overtaken: `0.5.0-beta.1` was cut straight on `main` before the process existed, so the first real use is the next version, and `0.5.0` itself folds that beta into its stable | recorded |

## 7. Out of scope

- Staged percentages inside a channel (`stagingPercentage`): the beta channel is the first ring.
- A second prerelease channel (`rc`): the workflow already names the feed by the suffix, the app wires only `beta`.
- Windows and macOS signing.
- Enforcing "a feature bumps the minor" mechanically: the script enforces order and consistency, not the meaning of a change; the reviewer does.
- Branch protection settings on the host (documented in `RELEASING.md`, applied by the maintainer).
