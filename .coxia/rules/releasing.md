---
checked-commit: 43b5fdc5581544751c89d63a06245c5eff005e12
checked-date: 2026-10-08
evidence: [RELEASING.md:1-95, .github/workflows/ci.yml:1-90, package.json:6-60, docs/updates.md:25-58, CHANGELOG.md:1-10]
summary: The two builds, the release branch, beta and stable, and what a tag triggers
stages: [review, release]
roles: [release-manager]
---

# Releasing

A version is **opened** as a branch (`release/X.Y.Z`), work merges into it, a **beta** is cut
for the beta channel, and when the beta is good a **stable** version is cut on `main`. Each
cut bumps the version and tags it; pushing the tag has CI build the **public** packages and
upload them to a **draft** release. Nothing reaches an installed app before the draft is
published.

## Two builds

| | Personal build | Public build |
|---|---|---|
| Command | `npm run dist` | `npm run dist:public` |
| Config | `electron-builder.yml` | `electron-builder.public.yml` (extends the first) |
| Claude Agent SDK inside | Yes (the native binary unpacked next to `app.asar`) | **No**: every `@anthropic-ai` package is excluded |
| Used by | `scripts/update.sh`, `scripts/install-local.sh` | The release workflow, `.github/workflows/release.yml` |

The SDK is proprietary software under Anthropic's terms, so public packages do not
redistribute it; a public package asks for the terms in the setup wizard and installs the SDK
with `npm` into a folder of the user's. **Never run `npm run dist`: it bundles the SDK and must
not be redistributed.** At run time `src/main/claudeSdk.ts` treats the SDK as bundled only when
the SDK binary is next to `app.asar`.

## The process

Three modes of `scripts/release.sh`. The numbers follow semver: a feature bumps the minor, a
fix only the patch.

| Step | Where | Tag | Who receives it |
|---|---|---|---|
| Open the version | `release/X.Y.Z`, cut from `main` (or a stable tag for a patch) | none | Nobody: it is where the work lands |
| Beta | On `release/X.Y.Z` | `vX.Y.Z-beta.N` | People on the beta channel (`beta-linux.yml`) |
| Stable | On `main`, after `release/X.Y.Z` is merged into it | `vX.Y.Z` | Everyone (`latest-linux.yml`) |

The script never pushes and never writes `git config`; it takes its identity from `--author` or
`RELEASE_AUTHOR`. Options include `--dry-run`, `--skip-checks`, `--date`, `-m`,
`--allow-branch`, `--emergency` and `--worktree`; `scripts/release.sh --help` lists them.
`open` refuses a branch or tag that exists, a version not above the latest stable, a `main`
behind `origin/main`, and a dirty tree. `beta` and `stable` compare against the
remote-tracking refs and never fetch.

## Branching and commits

Branch from the **open release branch** (`release/X.Y.Z`; when no version is open, from
`main`). Name the branch for what it does. Commit messages have exactly two prefixes,
lowercase, English, imperative, no trailing period:

```
feat: add <thing>            # any addition or change of behavior
fix: correct <thing>         # a bug fix
```

One logical change per commit. If the change is visible to users, add a line under
`## [Unreleased]` in `CHANGELOG.md` (Keep a Changelog style: Added, Changed, Fixed). Open the
pull request against the release branch, fill in the template, and keep it focused: a refactor
and a feature are two pull requests. CI runs on it. The maintainer merges it locally, with the
noreply identity, and never with the host's merge button.

## The changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic
Versioning. A user-visible change gets a line under `## [Unreleased]`. `scripts/release-changelog.mjs`
and `scripts/release-notes.sh` are the helpers the cut uses.

## What a tag triggers

`scripts/release.sh` bumps the version, updates the changelog and creates the tag locally; the
person pushes the tag and GitHub Actions (`release.yml`) builds the public packages and uploads
them to a draft release. Third-party actions are pinned to commit SHAs. The repository also
ships `scripts/verify-release-files.sh` and `scripts/verify-release-origin.sh` to check a
draft's files and origin. A hotfix of a released version is cut from the stable tag with
`--from`, not from whatever `main` holds now.

How an installed app then updates itself is in `rules/updates.md`. An issue that belongs to a
version says which release branch it targets.
