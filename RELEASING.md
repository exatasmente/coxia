# Releasing

How a version of Coxia gets from a commit to the people who run it. How an installed app then updates itself is in [`docs/updates.md`](docs/updates.md).

In short: a version is **opened** as a branch (`release/X.Y.Z`), its work is merged into it, `scripts/release.sh beta` cuts a **beta** that only people on the beta channel receive, and when the beta is good `scripts/release.sh stable` cuts the **stable** version on `main`. Each cut bumps the version and tags it locally; you push the tag, GitHub Actions builds the **public** packages and uploads them to a **draft** release, you check the draft and click *Publish release*. Nothing reaches an installed app before that click.

## Contents

- [Two builds](#two-builds)
- [First-time repository setup](#first-time-repository-setup)
- [The process](#the-process)
- [Merging locally](#merging-locally)
- [Hotfix](#hotfix)
- [From the app: the release as a run](#from-the-app-the-release-as-a-run)
- [What a tag triggers](#what-a-tag-triggers)
- [The changelog](#the-changelog)
- [Verifying a draft](#verifying-a-draft)
- [Publishing](#publishing)
- [Dry runs and experimental platforms](#dry-runs-and-experimental-platforms)
- [When something goes wrong](#when-something-goes-wrong)
- [Private repository and autoupdate](#private-repository-and-autoupdate)
- [What runs where](#what-runs-where)

## Two builds

| | Personal build | Public build |
|---|---|---|
| Command | `npm run dist` | `npm run dist:public` |
| Config | `electron-builder.yml` | `electron-builder.public.yml` (extends the first one) |
| Claude Agent SDK inside | yes (the native binary is unpacked next to `app.asar`) | **no**: every `@anthropic-ai` package is excluded |
| Used by | `scripts/update.sh`, `scripts/install-local.sh` (installs from your own source tree) | the release workflow, `.github/workflows/release.yml` |
| AppImage / deb size (0.1.0) | about 289 MB / 230 MB | about 178 MB / 142 MB |

The SDK is proprietary software under Anthropic's terms, so public packages do not redistribute it. A public package asks for the terms in the setup wizard (step "Claude Agent SDK") and installs the SDK with `npm` into a folder of the user's. At run time `src/main/claudeSdk.ts` treats the SDK as bundled only when the SDK binary is next to `app.asar`; without it, the wizard offers the install.

## First-time repository setup

The repository is `exatasmente/coxia`. Do this once, on GitHub (nothing here is automated, and the workflows do not need any secret: they use the short-lived `GITHUB_TOKEN`).

1. **Push `main`** and the tags you want. The first push must contain `.github/workflows/`.
2. **Settings › Actions › General**
   - Allow GitHub Actions (all actions and reusable workflows is fine; the workflows pin third-party actions to commit SHAs).
   - *Workflow permissions*: **Read repository contents** (the default is the safe one). The release workflow asks for `contents: write` only in the jobs that upload files.
   - Leave *Allow GitHub Actions to create and approve pull requests* off.
3. **Branch protection for `main` and `release/**`** (Settings › Branches or Rulesets), suggested:
   - require status checks to pass: **Typecheck, tests and build** (the job of `ci.yml`, which runs for pull requests into `main` and `release/**`);
   - block force pushes. Block deletions of `main`, and of `release/**` for everyone but you (you delete a release branch after its stable version);
   - the work reaches a branch by a **local merge that you push** ([Merging locally](#merging-locally)), so do not require pull requests *for pushes* on a repository with one maintainer, or let your own role bypass that rule: the pull request and its green CI are the gate before the merge, and the host's merge button is never used. This has not been verified against the host's settings screens.
4. **Protect the release tags** with a ruleset on `v*` (restrict creation and deletion to maintainers): pushing a tag publishes a build.
5. **Settings › Code security**: enable Dependabot alerts and version updates (`.github/dependabot.yml` already asks for weekly npm and GitHub Actions updates), secret scanning and push protection.
6. **Settings › General**: enable *Automatically delete head branches* if you like; leave *Releases* immutability to your taste (see [When something goes wrong](#when-something-goes-wrong)).
7. Run the dry run once ([below](#dry-runs-and-experimental-platforms)) to see the workflow green before the first real tag.

The repository starts private. Read [Private repository and autoupdate](#private-repository-and-autoupdate): installed apps cannot check for updates against a private repository.

### Pinned actions

`actions/checkout`, `actions/setup-node` and `actions/upload-artifact` are pinned to commit SHAs, each with its version in a trailing comment, so a moved tag cannot change what runs. Dependabot (`github-actions`) proposes new SHAs weekly. To pin a new action by hand, take the SHA that the release tag points to (for an annotated tag, the commit it dereferences to: `git ls-remote --tags https://github.com/<owner>/<action> 'refs/tags/v*'`, the line ending in `^{}`).

## The process

Three steps, each a mode of `scripts/release.sh`. The numbers follow semver: a feature bumps the minor, a fix only the patch.

| Step | Where | Tag | Who receives it |
|---|---|---|---|
| Open the version | `release/X.Y.Z`, cut from `main` (or from a stable tag, for a patch) | none | nobody: it is where the work lands |
| Beta | on `release/X.Y.Z` | `vX.Y.Z-beta.N` | people on the **beta** channel (`beta-linux.yml`) |
| Stable | on `main`, after `release/X.Y.Z` is merged into it | `vX.Y.Z` | everyone (`latest-linux.yml`) |

The script never pushes, never writes `git config` and takes the identity from `--author` or `RELEASE_AUTHOR`. Options: `--dry-run`, `--skip-checks`, `--date`, `-m`, `--allow-branch`, `--emergency`, `--worktree` (for a place where `main` is not a branch: `open` cuts from `origin/main`, and a stable is cut on a detached HEAD that holds the release merged into `origin/main`'s commit; the app's release steps use it, and so may you in a `git worktree`); `scripts/release.sh --help` lists them.

### 1. Open the version

From an up-to-date `main` (fetch, and fast-forward it first):

```bash
scripts/release.sh open 0.6.0
git push -u origin release/0.6.0
```

It creates `release/0.6.0` from `main` and switches to it. It refuses a branch or a tag that exists, a version that is not above the latest stable, a `main` that is behind `origin/main`, and a dirty tree. It also refuses a version below what `main` already carries (its `package.json`, or a stable or beta tag reachable from it). A **patch** of a released version (`0.5.1` after `0.5.0`) is cut from the stable tag, not from whatever `main` holds now: `scripts/release.sh open 0.5.1 --from v0.5.0` ([Hotfix](#hotfix)).

### 2. Develop into it

Every issue has its own branch, and its pull request targets `release/0.6.0`, not `main`; CI runs on those pull requests. Merge locally ([below](#merging-locally)). Describe each user-visible change under `## [Unreleased]` in `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style: Added, Changed, Fixed...).

### 3. Close the release: the beta

On `release/0.6.0`, clean and with CI green. **Fetch first** (`git fetch origin`): the script never touches the network, and it compares your branch with the `origin/release/0.6.0` it already has. If the remote has commits your branch lacks it refuses, so the tag cannot sit on a commit that the push of the branch would be rejected for.

```bash
scripts/release.sh beta --author "Your Name <12345+you@users.noreply.github.com>"
git push origin release/0.6.0
git push origin v0.6.0-beta.1
```

The number is the next one after the highest `v0.6.0-beta.N` tag (`beta.1` the first time). An explicit `scripts/release.sh 0.6.0-beta.2` is accepted when it follows the latest beta. The script refuses to run anywhere but on `release/X.Y.Z`, and refuses a version whose number is not the branch's (`release/0.6.0` cuts `0.6.0-beta.N`, never `0.7.0-beta.1`). What it does, in order: refuses a dirty tree, a tag that exists and an empty changelog; runs the same checks as CI (`tsc`, `vitest`, theme audit, i18n lint, `electron-vite build`) and the public audit (`scripts/public-audit.mjs`, which always runs, even with `--skip-checks` and in a dry run); bumps `package.json` and `package-lock.json` (`npm version --no-git-tag-version`); moves `[Unreleased]` under `## [0.6.0-beta.1] - <today>`; commits with `feat: release 0.6.0-beta.1`; creates the annotated tag. **It stops there and prints the push commands**; review the commit and the tag (`git show v0.6.0-beta.1`) first. Push the branch **before** the tag: the workflow refuses a beta tag whose commit is not on `origin/release/0.6.0`. When there is no `origin/release/0.6.0` yet (the branch was never pushed), the script says on one line that the remote checks were skipped.

The tag triggers the workflow ([below](#what-a-tag-triggers)); it makes a **draft pre-release**. The feed is `beta-linux.yml` (the first identifier after the dash names the channel: `-rc.1` would give `rc-linux.yml`, but only `beta` is wired into the app's settings) and no `latest-linux.yml` is produced, so people on the stable channel never see it. After you [verify](#verifying-a-draft) and [publish](#publishing) it, people who pick *Beta* in Settings › Updates receive it ([how to join](docs/updates.md#joining-the-beta-channel)). The app never moves anyone to an older version when they switch channels.

### 4. Fixes during the beta

A fix goes into the same release branch (its own branch, a pull request into `release/0.6.0`, a local merge), is described under `[Unreleased]`, and `scripts/release.sh beta` cuts `0.6.0-beta.2`, then `beta.3`... The branch is frozen to fixes for what the beta found: a stable only goes out from a beta somebody tried.

### 5. Stable

When the beta is good, **fetch** (`git fetch origin`), merge the release branch into `main` and cut the stable version there:

```bash
git fetch origin
git switch main
git merge --ff-only origin/main          # main must not be behind the remote
git merge --ff-only release/0.6.0        # or a merge commit with your identity (Merging locally), when main has moved
scripts/release.sh stable --author "Your Name <12345+you@users.noreply.github.com>"
git push origin main
git push origin v0.6.0
```

`stable` reads the version from the pre-release in `package.json` (`0.6.0-beta.2` gives `0.6.0`); `scripts/release.sh 0.6.0` says the same. It refuses unless **a `v0.6.0-beta.*` tag exists**, **the latest beta is in `main`**, and **`release/0.6.0` (when it still exists, here or on `origin`) is merged and holds nothing newer than that beta**: a commit after the last beta was tried by nobody, so cut another beta first. It also refuses when `origin/main` has commits that your `main` lacks (behind or diverged), so the tag cannot sit on a commit that the push of `main` would be rejected for. The version must also be above the latest stable of its own line. When the release branch has already been deleted, **only the beta tag stands for it**: the script checks that the latest beta is in `main`, and cannot see commits that landed on `main` after that beta, so look at `git log v0.6.0-beta.2..main` before cutting. Push `main` **before** the tag: the workflow refuses a stable tag whose commit is not on `origin/main`. Then the draft is built, checked and published like a beta's, and everyone on the stable channel receives it. The script ends by printing, not running, the commands that delete the release branch (`git branch -d release/0.6.0`, `git push origin --delete release/0.6.0`): run them after the draft is published.

The first release (`0.1.0`) was a special case: `package.json` and the changelog already said `0.1.0`, so `scripts/release.sh 0.1.0 --author "..."` only ran the checks and created the tag. The same shortcut applies whenever the version and its changelog section are already in place, but it skips only the version bump and the changelog move: the branch, beta, merge and remote rules above still apply (a first stable with no beta needs `--emergency`, written in the tag).

## Merging locally

The host's merge button records the account's email as the merge author, so **it is never used**. Merge on your machine with the maintainer's noreply identity, passed with `-c` (never `git config`: that would write the repository's configuration, shared with every worktree):

```bash
git fetch origin pull/12/head:pr-12
git switch release/0.6.0
git -c user.name="Your Name" -c user.email="12345+you@users.noreply.github.com" \
  merge --no-ff -m "Merge pull request #12 from you/feat-thing" pr-12
git push origin release/0.6.0
```

The host shows the pull request as merged once its commits reach the base branch by that push. A pull request that was opened against `main` by mistake is retargeted to the open release branch before merging.

## Hotfix

An urgent fix on a stable version takes the same path with a short beta:

```bash
scripts/release.sh open 0.6.1 --from v0.6.0      # release/0.6.1, from the stable tag
git push -u origin release/0.6.1
# the fix: its own branch, a pull request into release/0.6.1, a local merge
scripts/release.sh beta --author "..."           # 0.6.1-beta.1; push the branch and the tag
# when somebody has tried it:
git fetch origin && git switch main
git -c user.name="Your Name" -c user.email="12345+you@users.noreply.github.com" \
  merge --no-ff -m "Merge release/0.6.1" release/0.6.1   # a merge commit, with your identity ("Merging locally")
scripts/release.sh stable --author "..."
```

`--from` must be **the latest stable tag of that major.minor** (`v0.6.0`, once `v0.6.1` exists, `v0.6.1` for `0.6.2`) and the version above it; anything else is refused.

**Not supported: hotfixing an older line while `main` has moved to a newer one.** Once `main` carries `0.7.0` (its `package.json`, or a stable or beta tag reachable from it), `open 0.6.2 --from v0.6.1` is refused: the stable of the old line is cut on `main`, and merging an old line into a newer `main` would bring back the old version number. Do the fix on the current line instead (it goes out as the next version of `main`'s line, with a short beta), or, if a real support line is needed, do that release by hand outside this script and say so in the release notes. This flow does not model support branches.

**When even a beta cannot wait** (an incident), `scripts/release.sh 0.6.1 --emergency --author "..."` on `main` cuts the stable without the beta, merge and remote rules. It is loud on purpose: a banner on standard error naming every rule it skipped, the same lines again at the end, and the skipped rules written in the tag's message (`git show v0.6.1`). It never skips the checks, the public audit, the changelog or the version order. Do not make it a habit; a rule you have to skip twice a month is a rule to change.

## From the app: the release as a run

The same process can be driven from the app, as a **release run** (the `release-flow` template, [`docs/runner.md`](docs/runner.md#a-release); the decisions are in `docs/cycles/27-release-process/feat/1_SPEC.md`, section 6). Nothing here is another way to release: every step is what this document does by hand, run by the repository's own `scripts/release.sh` or by plain `git`, in **a worktree of the run's own** (never in your checkout: its branch, its files and its `main` are not touched; the worktree is made from your clone on the first step, next to the run's folder), signed with the identity of the runner settings (the app refuses a step when none is configured).

0. **Before you start.** Nothing to do in your checkout; if you have `release/0.6.0` checked out there, switch it away first (a branch cannot be checked out twice, and the app says so instead of taking it).
1. **Start it.** On the runs screen, *Start a release*, with the version (`0.6.0`, and the stable tag `v0.5.0` for a patch). The run makes a tracking issue **Release 0.6.0** (or adopts an open one with that title), lists there the pull requests aimed at `release/0.6.0`, and opens the branch (`scripts/release.sh open`) if it does not exist. You push that branch yourself or approve the push (step 3); the pull requests of the version target it, as above.
2. **Approve the plan.** The Release manager writes `RELEASE_PLAN.md` (the number, what goes in, the changelog, what is left out) and the run waits at a gate. Say yes, or send it back with a reason.
3. **Merge and cut the beta.** For each pull request that is approved, not a draft, green and aimed at the release branch, the agent asks for a local `git merge --no-ff` with your identity (the host's merge button is never used). It then waits until no pull request is open against the branch, and asks for `scripts/release.sh beta`. **Every push waits for your yes in Actions**, whatever the agent's autonomy: push the branch first and then the tag, as in [the process](#3-close-the-release-the-beta); *See the push* shows what would be sent. A merge or a cut an agent that does not run by itself asks for waits there too, and a step that fails (the script refuses it) can be approved again once the cause is fixed.
4. **Check and publish the draft** on the Releases page, as in [Verifying a draft](#verifying-a-draft) and [Publishing](#publishing). The run waits until the host shows the beta published for the minutes the stage names (a day by default) and no open issue carries the blocking label (`beta-blocker` by default); a bug seen in the beta is reported with that label, fixed in the release branch, and the run is sent back to cut the next beta. On Bitbucket (no releases, no labels on issues) the run cannot see any of this: move it on with *Go on without waiting*.
5. **Approve the stable.** The second gate. The agent asks for `scripts/release.sh stable` (the worktree stands on a detached HEAD at `origin/main`, `release/0.6.0` is merged into that commit and the stable tag is made on it; your local `main` does not move: pull it afterwards), then for the push of `main` and of the tag `v0.6.0`, again waiting for your yes. Publish the draft.
6. **Closing.** When the host shows `v0.6.0` published, the run says so on the tracking issue and closes it (by itself when the agent runs by itself, otherwise as a proposal). The release branch is deleted by you, after the draft is published, with the commands the script prints.

What the app never does, from a run: push without your yes, use `--emergency` or `--allow-branch` (an emergency stable is cut by a person in a terminal, see [Hotfix](#hotfix)), run a command or write a file for the agent, or click a merge or publish button on the host. What it does not verify: the workflow's build, the draft's files and the publication (you do, steps above).

## What a tag triggers

The tag triggers **Release** (`.github/workflows/release.yml`):

1. **Check the version.** The tag must equal `v` + `package.json` version, and the tag's commit must be on the branch it belongs to on the remote (`origin/main` for a stable, `origin/release/X.Y.Z` for a beta; `scripts/verify-release-origin.sh`), or the run fails before building anything. Push the branch first, then the tag.
2. **Linux job.** `npm ci`, then `npm run dist:public -- --publish always` with `GITHUB_TOKEN`: builds `coxia-<version>.AppImage` and `coxia_<version>_amd64.deb` without the SDK, writes the feed (`latest-linux.yml`, or `beta-linux.yml` for a beta), and creates a **draft** release named after the tag, with the `CHANGELOG.md` section as its body, attaching the files. It then runs `scripts/verify-release-files.sh` (names, version and sha512 of the AppImage against the feed; a pre-release must not produce `latest-linux.yml`), marks a beta's draft as a pre-release and checks that the draft holds the three files and **only its own channel's feed**.
3. Nothing else. Windows and macOS are off unless you ask for them ([below](#dry-runs-and-experimental-platforms)).

A draft of a pre-release has no tag until it is published: GitHub lists it as `untagged-<hash>`. The workflow therefore finds the draft **by its name** (`v<version>`), not by `tag_name`. A final release needs a `CHANGELOG.md` entry for its version (the job fails without it); a pre-release falls back to a one-line note. What cannot be checked outside GitHub is that this lookup still finds the draft: the first beta cut with this workflow is the test.

## The changelog

During the version, entries live under `## [Unreleased]`. A **beta** moves them under `## [X.Y.Z-beta.N] - <date>`, so the beta's release notes say what that beta changed (a fix for `beta.1` is its own `beta.2` section). The **stable** folds: `## [X.Y.Z] - <date>` gathers, subsection by subsection (Added, Changed, Fixed...), everything in the version's beta sections and whatever `[Unreleased]` still holds, and the beta sections leave `CHANGELOG.md` (their published pre-releases keep their own notes). A person who goes from `0.5.x` straight to `0.6.0` reads everything since, in one place. Check the folded section in the stable's commit (`git show`) before you push.

## Verifying a draft

On the release page (visible to you only, while it is a draft) check:

- the name is the tag, the notes read well, *pre-release* is ticked exactly when the tag has a suffix;
- the assets are `coxia-<version>.AppImage`, `coxia_<version>_amd64.deb` and `latest-linux.yml` (`beta-linux.yml` for a beta). The AppImage carries its block map inside, so there is no separate `.blockmap` on Linux (Windows would add `.exe.blockmap`). `builder-debug.yml` and `linux-unpacked` must **not** be there;
- download the assets and run the same check the workflow ran:

  ```bash
  mkdir -p /tmp/coxia-draft && cd /tmp/coxia-draft
  # download the three files here from the draft, then, from the repository:
  scripts/verify-release-files.sh <version> /tmp/coxia-draft
  ```

- start the AppImage **with a scratch data directory**, so your real data is untouched:

  ```bash
  chmod +x coxia-<version>.AppImage
  mkdir -p /tmp/coxia-scratch/{home,data,ud}
  HOME=/tmp/coxia-scratch/home CERIMONIAS_DATA_DIR=/tmp/coxia-scratch/data \
    ./coxia-<version>.AppImage --user-data-dir=/tmp/coxia-scratch/ud
  ```

  It must open the setup wizard, and the "Claude Agent SDK" step must show the Anthropic terms and the **Install** button (not "already ships with this app").
- to test an update end to end, install the previous version, then publish the new draft (public repository only, see below) and use Settings › Updates › Check now. `scripts/update-e2e.mjs` does the same against a local server without publishing anything.

## Publishing

On the draft release page click **Publish release**. For a final release, GitHub marks it *Latest*; the apps start finding it at their next check (every 6 hours by default). After publishing:

- open `https://github.com/exatasmente/coxia/releases/download/v<version>/latest-linux.yml` in a private window: it must answer `200` (public repository only);
- never replace or edit the files of a published release: the feed has a `sha512` and anyone who already fetched it would start failing the check. Publish a higher version instead.

## Dry runs and experimental platforms

**Actions › Release › Run workflow** starts it by hand (from `main`). `scripts/release.sh --dry-run ...` is the other dry run: it validates the rules of a cut and prints the plan, changing nothing. Inputs:

- `dry_run` (default **on**): builds and checks the Linux packages with `--publish never`, uploads them as a workflow artifact (kept 7 days) and creates **no** release. Use it to see the pipeline green, or to look at the packages of a branch before tagging (run it from that branch). The version comes from `package.json`.
- `experimental_platforms` (default off): also builds **Windows (NSIS)** and **macOS (dmg and zip)**. These builds are **unsigned and untested**. Windows shows a SmartScreen warning, and automatic updates on macOS need a signed and notarized app (the macOS updater refuses unsigned ones), so do not announce them as supported. They need a code-signing certificate (and, for macOS, an Apple Developer account) added as repository secrets before they are worth publishing; the workflow does not use any today. With `dry_run` off they upload into the same draft as the Linux job.

With `dry_run` off, a run started by hand does the real thing for the version in `package.json` (tag `v<version>` is created when you publish the draft); prefer pushing the tag.

## When something goes wrong

- **The workflow failed before the draft was created** (version mismatch, checks): fix it, delete the tag locally and on GitHub (`git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0`), then tag again. This only makes sense for a tag that was never published.
- **The workflow failed after the draft was created:** delete the draft in the Releases page and the tag as above, fix, re-tag. A draft of a pre-release is untagged, and `electron-builder` reuses a draft only by its tag, so a leftover one is *not* reused: the next run would make a second draft with the same name. Delete it first.
- **A beta has a bug:** fix it in `release/X.Y.Z` and cut the next beta; the stable waits for a beta that is good. Do not edit or re-tag a published beta.
- **A published release is bad:** unpublish it (turn it back into a draft, or delete it) and publish a higher fix version. The app never downgrades by itself; a person who already installed it keeps it until the next version.
- **The version in `package.json` does not match the tag:** the *Check the version* step says so. Re-run `scripts/release.sh` rather than editing by hand.

## Private repository and autoupdate

`electron-updater` reads the update feed with anonymous HTTPS requests to GitHub. **While the repository is private it cannot see its releases**, so published apps get a 404 and report an update error in Settings › Updates and in the error log; nothing else breaks. Autoupdate for other people works only once the repository (and so its releases) is **public**. Downloading a package by hand from the draft or the release page works in both cases for people with access.

For private testing only, `electron-updater` can authenticate with a token: build with `-c.publish.private=true` (so the feed config says it is private) and start the app with a fine-grained token that can read the repository's contents in `GH_TOKEN`. This path has **not** been tested with Coxia. Never bake a token into a package, a file in the repository or the shell history; do not hand such a build to anyone else.

## What runs where

| What | Where | Trigger |
|---|---|---|
| `tsc`, `vitest`, theme audit, public audit, i18n lint, `electron-vite build` | `.github/workflows/ci.yml` (Ubuntu, Node from `.nvmrc`) | push and pull request to `main` and `release/**` |
| Public Linux AppImage and deb, draft release | `.github/workflows/release.yml` | tag `v*.*.*`, or manual |
| Windows and macOS (experimental) | same workflow | manual, with `experimental_platforms` |
| Open a release branch; version bump, changelog, commit and tag of a beta or the stable | `scripts/release.sh` (`open`, `beta`, `stable`) and `scripts/release-changelog.mjs` | you, on your machine |
| Release notes of one version | `scripts/release-notes.sh <version>` | the workflow and `release.sh` |
| The same steps as a run: open, merge, beta, stable, the pushes and the tracking issue | `src/main/releaseGit.ts` (the steps, in a worktree of their own), `src/main/runner/` (the run), the Actions screen (the pushes) | the app, with your yes for every push |
| Name, version and checksum of the Linux files | `scripts/verify-release-files.sh <version> [dir]` | the workflow, and you |

CI does not run the Python voice sidecar (`sidecar/voice_sidecar.py`): it needs the speech models and an audio stack and has no automated tests of its own. The Node version used everywhere is in `.nvmrc`; change it there (and in your local Node) together.

What can only be checked on GitHub: that the workflows parse and run there, that `GITHUB_TOKEN` can create the draft, that the pre-release flag is set on a beta draft, and that `electron-updater` finds the published release. Run the dry run first, then a `-beta.1` tag, before the first final release.
