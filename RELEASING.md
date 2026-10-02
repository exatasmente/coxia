# Releasing

How a version of Coxia gets from a commit to the people who run it. How an installed app then updates itself is in [`docs/updates.md`](docs/updates.md).

In short: `scripts/release.sh` bumps the version and tags it, you push the tag, GitHub Actions builds the **public** packages and uploads them to a **draft** release, you check the draft and click *Publish release*. Nothing reaches an installed app before that click.

## Contents

- [Two builds](#two-builds)
- [First-time repository setup](#first-time-repository-setup)
- [Cutting a release](#cutting-a-release)
- [Beta releases](#beta-releases)
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
3. **Branch protection for `main`** (Settings › Branches or Rulesets), suggested:
   - require a pull request before merging, with code owner review (`.github/CODEOWNERS` names @exatasmente; with a single maintainer you can leave the approval count at 0 and still require the check);
   - require status checks to pass: **Typecheck, tests and build** (the job of `ci.yml`), branch up to date;
   - block force pushes and deletions.
4. **Protect the release tags** with a ruleset on `v*` (restrict creation and deletion to maintainers): pushing a tag publishes a build.
5. **Settings › Code security**: enable Dependabot alerts and version updates (`.github/dependabot.yml` already asks for weekly npm and GitHub Actions updates), secret scanning and push protection.
6. **Settings › General**: enable *Automatically delete head branches* if you like; leave *Releases* immutability to your taste (see [When something goes wrong](#when-something-goes-wrong)).
7. Run the dry run once ([below](#dry-runs-and-experimental-platforms)) to see the workflow green before the first real tag.

The repository starts private. Read [Private repository and autoupdate](#private-repository-and-autoupdate): installed apps cannot check for updates against a private repository.

### Pinned actions

`actions/checkout`, `actions/setup-node` and `actions/upload-artifact` are pinned to commit SHAs, each with its version in a trailing comment, so a moved tag cannot change what runs. Dependabot (`github-actions`) proposes new SHAs weekly. To pin a new action by hand, take the SHA that the release tag points to (for an annotated tag, the commit it dereferences to: `git ls-remote --tags https://github.com/<owner>/<action> 'refs/tags/v*'`, the line ending in `^{}`).

## Cutting a release

Start from a clean, up-to-date `main` with everything merged and CI green. Describe what changed under `## [Unreleased]` in `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style: Added, Changed, Fixed...): the release notes are that text.

```bash
scripts/release.sh 0.2.0 --author "Your Name <you@example.com>" -m "feat: release 0.2.0"
```

What it does, in order: refuses a dirty tree, a branch other than `main`, an existing tag and an empty changelog; runs the same checks as CI (`tsc`, `vitest`, theme audit, i18n lint, `electron-vite build`) and the public audit (`scripts/public-audit.mjs`, which always runs, even with `--skip-checks`); bumps `package.json` and `package-lock.json` (`npm version --no-git-tag-version`); moves `[Unreleased]` under `## [0.2.0] - <today>` and updates the compare links; commits with your message; creates the annotated tag `v0.2.0`. **It stops there and prints the push commands.** The author comes from the flag or `RELEASE_AUTHOR`; the script never touches `git config`. Options: `--dry-run`, `--skip-checks`, `--allow-branch`, `--date`.

Review the commit and the tag (`git show v0.2.0`), then push (this is the step that starts the workflow):

```bash
git push origin main
git push origin v0.2.0
```

The tag triggers **Release** (`.github/workflows/release.yml`):

1. **Check the version.** The tag must equal `v` + `package.json` version, or the run fails before building anything.
2. **Linux job.** `npm ci`, then `npm run dist:public -- --publish always` with `GITHUB_TOKEN`: builds `coxia-<version>.AppImage` and `coxia_<version>_amd64.deb` without the SDK, writes `latest-linux.yml`, and creates a **draft** release named after the tag, with the `CHANGELOG.md` section as its body, attaching the files. It then runs `scripts/verify-release-files.sh` (names, version and sha512 of the AppImage against the feed) and checks that the draft holds the three files.
3. Nothing else. Windows and macOS are off unless you ask for them ([below](#dry-runs-and-experimental-platforms)).

A final release **needs** a `CHANGELOG.md` entry for its version (the job fails without it); a pre-release falls back to a one-line note.

The first release (`0.1.0`) is a special case: `package.json` and the changelog already say `0.1.0`, so `scripts/release.sh 0.1.0 --author "..."` only runs the checks and creates the tag.

## Beta releases

Use a pre-release suffix:

```bash
scripts/release.sh 0.2.0-beta.1 --author "Your Name <you@example.com>" -m "feat: release 0.2.0-beta.1"
```

The workflow treats any tag with a suffix as a pre-release: the update feed is `beta-linux.yml` (the first identifier after the dash names the channel: `-rc.1` would give `rc-linux.yml`, but only `beta` is wired into the app's settings), the release is marked **pre-release** (and stays a draft until you publish it), and no `latest-linux.yml` is produced, so people on the stable channel never see it. People who pick *Beta* in Settings › Updates receive it. The app never moves anyone to an older version when they switch channels.

When the beta is good, release the final version (`0.2.0`) from the same line of commits: `scripts/release.sh 0.2.0` moves the changelog entries under `[0.2.0]`. The beta entry stays in the history.

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

**Actions › Release › Run workflow** starts it by hand (from `main`). Inputs:

- `dry_run` (default **on**): builds and checks the Linux packages with `--publish never`, uploads them as a workflow artifact (kept 7 days) and creates **no** release. Use it to see the pipeline green, or to look at the packages of a branch before tagging (run it from that branch). The version comes from `package.json`.
- `experimental_platforms` (default off): also builds **Windows (NSIS)** and **macOS (dmg and zip)**. These builds are **unsigned and untested**. Windows shows a SmartScreen warning, and automatic updates on macOS need a signed and notarized app (the macOS updater refuses unsigned ones), so do not announce them as supported. They need a code-signing certificate (and, for macOS, an Apple Developer account) added as repository secrets before they are worth publishing; the workflow does not use any today. With `dry_run` off they upload into the same draft as the Linux job.

With `dry_run` off, a run started by hand does the real thing for the version in `package.json` (tag `v<version>` is created when you publish the draft); prefer pushing the tag.

## When something goes wrong

- **The workflow failed before the draft was created** (version mismatch, checks): fix it, delete the tag locally and on GitHub (`git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0`), then tag again. This only makes sense for a tag that was never published.
- **The workflow failed after the draft was created:** delete the draft in the Releases page and the tag as above, fix, re-tag. (`electron-builder` reuses a draft with the same tag and replaces its files, but starting clean is safer.)
- **A published release is bad:** unpublish it (turn it back into a draft, or delete it) and publish a higher fix version. The app never downgrades by itself; a person who already installed it keeps it until the next version.
- **The version in `package.json` does not match the tag:** the *Check the version* step says so. Re-run `scripts/release.sh` rather than editing by hand.

## Private repository and autoupdate

`electron-updater` reads the update feed with anonymous HTTPS requests to GitHub. **While the repository is private it cannot see its releases**, so published apps get a 404 and report an update error in Settings › Updates and in the error log; nothing else breaks. Autoupdate for other people works only once the repository (and so its releases) is **public**. Downloading a package by hand from the draft or the release page works in both cases for people with access.

For private testing only, `electron-updater` can authenticate with a token: build with `-c.publish.private=true` (so the feed config says it is private) and start the app with a fine-grained token that can read the repository's contents in `GH_TOKEN`. This path has **not** been tested with Coxia. Never bake a token into a package, a file in the repository or the shell history; do not hand such a build to anyone else.

## What runs where

| What | Where | Trigger |
|---|---|---|
| `tsc`, `vitest`, theme audit, public audit, i18n lint, `electron-vite build` | `.github/workflows/ci.yml` (Ubuntu, Node from `.nvmrc`) | push and pull request to `main` |
| Public Linux AppImage and deb, draft release | `.github/workflows/release.yml` | tag `v*.*.*`, or manual |
| Windows and macOS (experimental) | same workflow | manual, with `experimental_platforms` |
| Version bump, changelog, commit, tag | `scripts/release.sh` | you, on your machine |
| Release notes of one version | `scripts/release-notes.sh <version>` | the workflow and `release.sh` |
| Name, version and checksum of the Linux files | `scripts/verify-release-files.sh <version> [dir]` | the workflow, and you |

CI does not run the Python voice sidecar (`sidecar/voice_sidecar.py`): it needs the speech models and an audio stack and has no automated tests of its own. The Node version used everywhere is in `.nvmrc`; change it there (and in your local Node) together.

What can only be checked on GitHub: that the workflows parse and run there, that `GITHUB_TOKEN` can create the draft, that the pre-release flag is set on a beta draft, and that `electron-updater` finds the published release. Run the dry run first, then a `-beta.1` tag, before the first final release.
