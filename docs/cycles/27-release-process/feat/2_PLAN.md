# #27 Release process: a release branch per version, then beta, then stable — technical plan

Reads with [`1_SPEC.md`](1_SPEC.md) (section numbers and "D" decisions point there). Checked against the code as of `0.5.0-beta.1` (`package.json`, the tags `v0.4.3` and `v0.5.0-beta.1`, config schema 10).

**Part 1** is the process (spec section 3): done in the branch `feat-release-process` (commits at the end of this file). **Part 2** is the release as a runner cycle (spec section 4): not started, briefed at the end of this file.

## What gets built

| # | Item | Part |
|---|---|---|
| 1 | `scripts/release-changelog.mjs`: pure changelog functions (beta cut, stable fold, status) and a CLI | 1 |
| 2 | `scripts/release.sh`: `open`, `beta`, `stable`, explicit versions, the branch and tag rules, `--emergency` | 1 |
| 3 | `test/release-script.test.ts` (the real script against temporary repositories, no network) and `test/release-changelog.test.ts` | 1 |
| 4 | `ci.yml`: `release/**` | 1 |
| 5 | `release.yml`: the draft is found by name; feed assertions; `test/release-workflow.test.ts` for the filter | 1 |
| 6 | `RELEASING.md`, `CONTRIBUTING.md`, `docs/updates.md`, `CHANGELOG.md` | 1 |
| 7 | Release actions (`release-git`) behind the door of Actions, with the `ReleaseAction` app tool for the agent | 2 |
| 8 | `Run.subject` (a run over a version), its first-stage input, the worktree of the release branch | 2 |
| 9 | Wait kinds `release-approved` and `beta-age`, `flowCheck`, the editor, the watcher | 2 |
| 10 | The `release-flow` template, the Release manager agent, comments, catalogs, docs (`cycles.md`, `runner.md`), tests | 2 |

## 1. `scripts/release-changelog.mjs` (part 1)

Plain ESM, no dependency, importable by a test (`// @ts-expect-error`, like `public-audit.mjs`) and runnable as `node scripts/release-changelog.mjs <command> <file> <version> [date]`.

```
status <file> <version>   prints one word: section (the version already has a section), content (there is something to release), empty
cut    <file> <version> <date>   rewrites the file; a version with a suffix is a beta cut, one without is a stable (fold)
```

Model: the file is split at the first `## [` line into a head, the sections (`heading`, `version`, `date`, `body`) and the link lines (`[x]: url`, any position after the first section). It is written back as head, sections, links, with one blank line around each: the unchanged file round-trips byte for byte (a test pins it on the repository's own `CHANGELOG.md`).

- **Beta cut** (`X.Y.Z-beta.N`): the `[Unreleased]` body becomes a new section directly under it; `[Unreleased]` is left empty; its link points at the new tag; the new link goes from the previous tag (read from the old `[Unreleased]` link). Same output as the awk it replaces.
- **Stable cut** (`X.Y.Z`): gather the bodies of the `X.Y.Z-beta.*` sections in beta order and the `[Unreleased]` body; split each at `### ` headings; merge by heading (Keep a Changelog order first, then unknown headings in first-seen order, text before the first heading kept on top); the beta sections and their links are removed; the new section goes under `[Unreleased]`; the stable's compare link goes from the previous **stable** section's version (the first non-pre-release heading below), or to `releases/tag` when there is none; `[Unreleased]` points at the new tag. Nothing to gather is an error.
- A version that already has a section is not touched by `cut`; `release.sh` asks `status` first (the first-release case, as before).

## 2. `scripts/release.sh` (part 1)

The file keeps its shape: usage comment, `set -euo pipefail`, `die`, option loop, the checks, the plan, the dry-run exit, the checks run, the bump, the commit, the tag, the instructions. What changes:

- A mode is chosen right after the options: `open`, `beta`, `stable`, or a version (`*-beta.N` or stable). A suffix other than `beta.N` is refused on a release branch.
- Helpers (all `git`, no network): `stable_tag [MAJOR.MINOR]` (highest `vX.Y.Z` by `sort -V`, of one line or overall), `floor_tag VERSION` (the stable a version must be above: its own line's latest, else the repository's), `max_beta CORE` (highest `N` of `vCORE-beta.N`, 0 when none), `release_refs CORE` (the local branch and `origin/` branch that exist), `main_version` (the highest version `main` carries: its `package.json` and the tags merged into it), `origin_skipped` (the one warning line), `is_ancestor`, `tag_commit`.
- `open` is a function of its own, runs before the author check (it commits nothing), and ends with `git switch -c release/X.Y.Z <base>` (not on a dry run).
- A rule that fails is collected as a *problem*. Branch rules die at once; the three stable rules go in a list so `--emergency` can name every one it skips. Loud means: a banner on standard error, one line per skipped rule, the same lines at the end of the output, and the tag message.
- Changelog: `status` and `cut` of section 1 replace the awk; the stable's "empty" test counts the beta sections as content.
- The final instructions depend on the mode: a beta pushes `release/X.Y.Z` and the tag; a stable pushes `main` and the tag and then prints (does not run) the commands that delete the release branch locally and on the host.
- `--allow-branch` skips the branch rule of beta and stable and prints a warning; it is the only way to run the script on a feature branch (a dry run of a hotfix, for example).

Failure ordering for a person reading the output: argument errors, then the tree, then the branch rules, then the tag, then the version order, then the changelog, then the audit, so the first message is the most useful one.

## 3. Tests (part 1)

`test/release-script.test.ts` builds a temporary repository per case (git `init -b main`, a `package.json` and lock at `0.4.0`, a changelog with entries, a stub `scripts/public-audit.mjs` that exits 0, copies of `release.sh`, `release-notes.sh` and `release-changelog.mjs`, a `v0.4.0` tag) with `HOME`, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` so nothing of the machine leaks in, and runs the real script with `--skip-checks` (the checks need the repository's toolchain; the rules do not). No test reaches the network: `npm version --no-git-tag-version` and git are local.

Cases: every refusal of the three tables of spec 3.2, the numbering (`beta.1`, `beta.2`, an explicit number, a gap, an existing tag), the version/branch mismatch, the changelog result of a beta and of a stable (folded, links), `--emergency` (skipped rules in the output and the tag message), `--dry-run` changing nothing (tree, tags, branches), the author never written to the repository's config, `open` (branch created and checked out from the right base; patch from the tag; patch from a moved `main` refused).

`test/release-changelog.test.ts`: the fold (two betas and an unreleased, merge order, unknown headings, preamble), the links, the round trip on the real file, the empty cases.

`test/release-workflow.test.ts`: reads `release.yml`, extracts the `jq` program of the two lookups (they must be identical) and runs it with the real `jq` (skipped when `jq` is missing; CI's runner has it) against a recorded list of releases (an `untagged-…` pre-release draft named `v0.6.0-beta.1`, a published release with the same name, a draft of another version, a draft whose tag is already linked): only the two drafts are picked, in order. It asserts `ci.yml` lists `release/**` for both events, and runs `scripts/verify-release-files.sh` over temporary files to pin the feed rule (a beta with `beta-linux.yml` passes; with `latest-linux.yml` beside it, or instead of it, it fails; a final version wants `latest-linux.yml`).

## 4. The workflow fix (part 1)

Both steps that used `select(.draft and .tag_name == "$TAG")` use one filter, to get the **id** of the newest matching draft:

```
.[] | select(.draft and (.name == $ENV.TAG or .tag_name == $ENV.TAG)) | .id
```

`$ENV.TAG` instead of shell interpolation (the tag is already validated against `package.json`, but a value should not be spliced into a program); `sed -n 1p` (not `head`, which can SIGPIPE `gh` under `pipefail`) takes the first, and the assets step reads that release by id. The assets step is extended: a pre-release draft must hold `<channel>-linux.yml` and **no** `latest-linux.yml`; a final draft must hold `latest-linux.yml` and no `<other>-linux.yml`.

Checked in the code (not by a build, which needs the network): `computeChannelNames` in `app-builder-lib` returns only `[currentChannel]` when the publisher is GitHub, so a beta writes `beta-linux.yml` and never `latest-linux.yml`; `GitHubPublisher` looks a draft up by `tag_name === tag` only, so a draft that GitHub shows as `untagged-…` is not reused on a re-run (which is why a failed run's draft is deleted before the next push of the tag: `RELEASING.md` says so).

## 5. Risks

- **The fold is a text transformation of a file people also edit by hand.** It only reads `###` headings and bullets; text it does not understand stays, in order, under the heading it was found. A test pins the real file.
- **A branch rule can be too strict for a real day.** The escape hatches are `--allow-branch` (branch rules) and `--emergency` (beta rules), both loud. A rule that has to be skipped twice in a month is a rule to change.
- **The workflow cannot be run here.** The filter is tested against recorded shapes and the electron-builder behavior is read from its source; the first beta cut with the new workflow is the real test, and `RELEASING.md` says so.
- **`origin/main` is read, not fetched.** `open` refuses a `main` behind a remote-tracking branch that exists locally; it does not fetch (no network from the script), so the person fetches first, which the output reminds.

## 6. Decision log

| # | Decision | Why |
|---|---|---|
| P1 | The changelog logic is a small Node module the script calls, not more awk | folding by subsection is parsing; a module is testable directly and the script already depends on `node` |
| P2 | The stable **folds** the betas and removes their sections (D1) | the person on the stable channel needs everything since the last stable in one place; the pre-release pages keep their own notes |
| P3 | `stable` is also a keyword; the version is read from `package.json`'s pre-release core | after the merge the file says `0.6.0-beta.2`; typing the number again is a chance to type the wrong one |
| P4 | The stable gate checks the latest beta tag **and**, when it still exists, the release branch tip: merged and equal to that beta | the invariant is "a stable is a tested beta"; a commit after the last beta was tried by nobody |
| P5 | A deleted release branch is not an error; the tag stands for it | the branch is deleted *after* the stable, so a re-cut after a failure must still work |
| P6 | `--emergency` skips the beta, merge and remote rules only; it never skips checks, audit, changelog or version order, and works only for a stable on `main` | a hotfix may skip waiting, never the checks |
| P7 | `open` refuses a patch cut from a `main` that moved (the patch comes from the tag) | otherwise a "fix release" carries every feature merged since |
| P8 | `open` switches to the new branch | the next thing a person does is work on it; one command fewer to forget |
| P9 | The script does not fetch | no network from the script; the person's `git fetch` is what makes `origin/*` checks meaningful, and the output says so |
| P10 | The draft is found by `name` or `tag_name`, with `$ENV.TAG` | the real shape seen on `v0.5.0-beta.1`; both are accepted so a future change in how electron-builder links the tag does not break it |
| P11 | The tests run the real script against temporary repositories | the rules are about git state; a re-implementation in a test would test itself |
| P12 | The explicit `-beta.N` form stays and accepts a gap with a warning | the issue says it still works; refusing a gap would make it useless, refusing a lower number is the real protection |
| P14 | **Review 1.** The remote is read through the tracking refs only: a stable requires `origin/main` to be an ancestor of `HEAD` (a PROBLEMS entry, so `--emergency` skips it loudly), a beta requires `origin/release/X.Y.Z` to be one (a refusal of its own; `--emergency` does not apply to a beta); with no tracking ref one warning line says so and that the script never fetches | a stable could be tagged on a commit that the push of `main` is rejected for while the tag push went through |
| P15 | **Review 2.** Every number of a version, tag, branch and `--from` is `(0\|[1-9][0-9]*)` (`NUM` in the script) | `0.06.0` made the tag `v0.06.0` and a `package.json` that says `0.6.0` |
| P16 | **Review 3.** `open` without `--from` refuses a version below `main_version` (main's `package.json` core and every stable or beta tag merged into main); `open --from` refuses when `main_version` has a larger major.minor than the hotfix, and `--from` must be the latest stable of its line. The hotfix of an older line while main moved on is documented as unsupported (spec D9) | the flow cuts the stable on `main`: merging an older line into a newer `main` brings the old version number back |
| P17 | **Review 9.** `scripts/verify-release-origin.sh` (stable: reachable from `origin/main`; beta: from `origin/release/X.Y.Z`) runs in the workflow's `prepare` job over a `fetch-depth: 0` checkout, for pushes only; a script rather than inline shell so it is tested over a temporary repository with a bare origin | a tag pushed before its branch, or from a local-only commit, must publish nothing |
| P18 | **Review 5, 6.** The emergency tag's subject is `Coxia X.Y.Z (emergency: rules were skipped)` (the rules are not only the beta's now); with the release branch deleted only the beta tag stands for it, and commits on `main` after that beta are not detected: said in `RELEASING.md` | what the script cannot know is told, not guessed |
| P13 | Part 2 follows spec section 4 with decisions D5 and D6, **approved by the maintainer on 2026-10-03**, and the tracking issue D11 (approved the same day) | they set the shape of `Run` and of what an autonomous agent may do |

## 7. Part 2: what the next agent needs

Read the spec's section 4 first; D5 and D6 there are the maintainer's to confirm (ask before writing code that depends on them). The facts below were read from the code while writing part 1.

**Where things are**

- The door: `src/main/runner/door.ts` is the only runner file that imports `actions.ts`. A new kind goes next to `run-push` (`proposeRunPush`, `publishRunBranch`, the `a.kind === 'run-push'` branch of `approveAction`, `ActionKind` and `ReleaseAction` in `src/shared/types.ts`; the Actions screen lists by kind and needs a row for it). `audited(...)` is the one audit path; its `AuditBase` kinds are listed with `recordWrite` in `src/main/auditoria.ts` and the audit screen's labels are catalog keys.
- Identity: `runner.identity` (`src/shared/config/types.ts`, `RunnerIdentity`); `repoIdentity` (`runner/git.ts`) is the fallback the app already uses. The commit helper `commitAll` shows the `-c` flags that switch hooks, signing and fsmonitor off: use the same set for `git merge`. `scripts/release.sh` takes `--author`; do not pass it anything but the identity, never run `git config`.
- The run: `Run` in `src/shared/runs/types.ts` (`issue: RunIssue`, `repo`, `branch`, `worktree`, `cycleFolder`); the store is `src/main/runs.ts`; `runner/service.ts` creates the worktree (`createWorktree` in `runner/git.ts`, which refuses an existing branch, so the release run needs its own entry that *adopts* `release/X.Y.Z` or creates it through the `open` op). "One run at a time" keys on `issue.ref`.
- Waits: `WAIT_KINDS` and `WaitFor` in `src/shared/config/types.ts`; the watcher is the loop around `publish.ts:799` (the `label` kind is the closest model, a read of the issue's labels); `flowCheck` rule `wait-no-event` (`src/shared/runs/flowCheck.ts:92`); the schema list of flow fields is in `src/shared/runs/schema.ts`; the wait kinds are documented in `docs/cycles.md` (Waits) and the editor lists them.
- Templates: `src/shared/cycles/templates/agentFlow.ts` is the model (`member()`, `template()`, `RECOMMENDED` in `src/shared/config/team.ts` by agent id, `agentFlowComments`); register in `BUILT_IN_TEMPLATES` (`src/shared/cycles/index.ts`); catalog keys `cycle.<id>.*`, `prompt.<id>.*` in both catalogs (and `.novoice` variants where a prompt mentions a call); cover it in `test/cycle-templates.test.ts`.
- The host read for the planning stage: the `VcsRead` tool and its project limit (#30); linked pull requests exist (`issue_linked_mrs`); a list of pull requests *by base branch* does not, so the provider interface may need a read (`listMrs` filtered by target branch), which means all four providers and `test/vcs-*.test.ts`.

**Order I recommend**

1. The `release-git` kind with only the local ops over a **temporary repository** (`open`, `beta`, `stable` through the script of that repository; `merge-pr` through `git merge --no-ff` of a branch that a test makes), validators, audit, refusal in a test workspace. This is the safety-critical part and is testable without the runner.
2. `push-branch` and `push-tag` as proposals that always wait (copy `proposeRunPush` and `publishRunBranch`; the unit holds the version and the repository id, never a path; at approval read the clone from the config).
3. `Run.subject` and the release run's entry point, then the two wait kinds with their watcher reads, then the template and the agent with its `ReleaseAction` tool, then docs and tests.

**Traps**

- `approveAction` must validate the unit again; never trust what a stored action says (the existing push does it by reading the run).
- A test workspace refuses everything through `assertExternalWrite`; the push *proposal* still exists there and its confirmation is refused. Mirror that.
- The script prints the push commands; the action must not parse them, it knows what to push (`HEAD:refs/heads/release/X.Y.Z`, `refs/tags/vX.Y.Z`), plain, no force.
- `--emergency` must not be reachable from an agent's tool. Only a person, in the terminal, uses it.
- The prompt goldens (`test/runner-golden.test.ts`) must not change for existing templates; a new family needs its own prompts or falls back to `sdd`.
- No test may reach a host: use `test/helpers/fakeHost.ts` and `vcs.ts`.
- Do not run `npm run dist`.

## 8. Part 1: what shipped

| Commit | What |
|---|---|
| `feat: add the spec and plan of the release process #27` | this document and the spec |
| `feat: open release branches and cut betas and the stable from release.sh #27` | `scripts/release.sh`, `scripts/release-changelog.mjs`, `test/release-script.test.ts` (36 cases), `test/release-changelog.test.ts` |
| `feat: run ci for pull requests and pushes to release branches #27` | `ci.yml` |
| `fix: find the untagged draft of a pre-release by name in the release workflow #27` | `release.yml`, `test/release-workflow.test.ts` |
| `feat: document the release branch, beta and stable flow #27` | `RELEASING.md`, `CONTRIBUTING.md`, `docs/updates.md`, `CHANGELOG.md` |

Not verified: the workflow on GitHub (the lookup against the real API, the pre-release flag, the checks of the feed); the branch protection settings suggested in `RELEASING.md`. The real `0.5.0` line: `v0.5.0-beta.1` was cut on `main` before this process existed, so `scripts/release.sh open 0.5.0` is refused ("already has a beta tag") on purpose. Both ways on exist and were dry-run against a clone of this branch: `scripts/release.sh 0.5.0` (or `stable`) on `main` already passes, because the beta tag exists, is in `main` and there is no release branch (the output notes it), and it folds `[0.5.0-beta.1]` and `[Unreleased]` into `[0.5.0]`; or `git switch -c release/0.5.0` by hand and cut `beta` for a second round.
