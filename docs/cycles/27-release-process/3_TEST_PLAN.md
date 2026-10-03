# #27 Release process: a branch per version, then beta, then stable — test plan

How a person checks, in the app, part 2 of the issue (the release as a run of the runner): each acceptance item of section 4.6 of [`feat/1_SPEC.md`](feat/1_SPEC.md), plus the tracking issue. The "automated" lines say what the suite proves with fakes (no model, no real host, no network, no `npm run dist`); the steps below are what verifies it for real. Part 1 (the script, the workflow, the docs) has its own checks in `test/release-script.test.ts`, `test/release-changelog.test.ts` and `test/release-workflow.test.ts`, and the dry runs in [`RELEASING.md`](../../../RELEASING.md).

## Setup

A throwaway data folder, a throwaway **private** repository you own on GitHub with an `origin` you can push to (it needs `scripts/release.sh`, `scripts/release-changelog.mjs`, `scripts/release-notes.sh`, `scripts/public-audit.mjs`, a `CHANGELOG.md` with an entry under `[Unreleased]`, a `main` tagged with a stable tag such as `v0.1.0` and `package.json` at that version: copy them from this repository), a token for that repository (the app's own settings), and a model you can afford (the release stages are short).

```bash
export CERIMONIAS_DATA_DIR=$(mktemp -d)
export CERIMONIAS_SPECS_DIR=$(mktemp -d)
npm run dev
```

Finish the wizard with the engineering or the agent cycle and the integration for that repository (the issue project is the same repository). Settings › Runner: set the **identity** (name and email; a noreply address), then apply the **Release** template (it adds the release flow and the Release manager; the flow of your issues stays). In another folder, open two pull requests from branches of the repository, aimed at `main` for now.

## Acceptance items

### 1. The plan, and nothing written before a yes

1. Settings › Team: the **Release manager** has Code host **Read only**, Commands **None**, and it is not able to change files. Switch it to **waits for you** (not autonomous) for this item.
2. Runs › *Start a release*, version `0.2.0`. The run opens at the plan stage. Nothing was written yet: no issue on the host, no branch (`git branch --list release/*` in your clone shows none), and Actions lists two proposals: **Create the tracking issue of the release 0.2.0** and **Open the release branch of 0.2.0**, each with what it would do.
3. Say yes to the first: the issue **Release 0.2.0** exists on the host, the run knows it (the run screen links it) and the comments that waited (the plan's) are on it. Say yes to the second: `release/0.2.0` exists, cut by the repository's script in the **worktree of the steps** (`git worktree list` shows `release-0.2.0-steps`), and your own checkout is exactly as you left it (same branch, same `git status`, your `main` unmoved); nothing is on the remote.
4. Accept the plan stage: `RELEASE_PLAN.md` is in the run's folder and the run waits at **Approve the plan**. The plan comment is on the tracking issue, with the sections of the template, and another comment (**Activities of the release**) lists the pull requests aimed at `release/0.2.0` (none yet: push the branch with `git push -u origin release/0.2.0`, retarget one of your pull requests to it, and within 5 minutes the comment is edited, not posted again, with the link, whether it is approved and the issue it closes).
5. Automated: `test/runner-release.test.ts` ("starting a release", "the release from the plan to the stable", "the comments of a release on its tracking issue"), `test/release-actions.test.ts`.

### 2. Merging an approved pull request, and the refusals

1. Approve one pull request on the host (not a draft, checks green). Approve the plan; the stage that assembles the branch asks for `merge-pr`: with an agent that waits it is a proposal, with its number and the commit it was read at.
2. Say yes: `git log --merges -1 release/0.2.0` is `Merge pull request #N from <branch>`, authored **and** committed by the identity of the runner settings, with two parents. The host's page for the pull request still says open (nothing was pushed, and the merge button was not used).
3. For the other pull request, **not approved**: ask the agent (or approve a proposal made for it) and read the action's result: it says it is not approved, and `HEAD` did not move. Do the same for a draft, one aimed at `main`, and one whose branch gets a new commit after the plan was read ("is at X now, and the plan read it at Y").
4. A merge that conflicts: make two pull requests that change the same line; the second is refused with "conflicts, and the merge was undone", `git status` is clean and there is no `MERGE_HEAD`.
5. Automated: `test/release-git.test.ts` ("merge-pr"), `test/release-actions.test.ts` ("approving a step").

### 3. Pushes always wait

1. Switch the Release manager to **runs by itself**. Let the run reach **Cut the beta**: the beta is cut with no question (`git tag --list` shows `v0.2.0-beta.1`, the audit log has a row *Release step* by `release-manager`), and **two proposals** appear in Actions: push the release branch, push the latest beta tag. Nothing is on the remote (`git ls-remote --tags origin`).
2. *See the push* shows the refs and the commits that would go. Say yes to the branch, then to the tag (in the other order the tag is refused: "Push release/0.2.0 first"). The workflow of part 1 starts; check and publish the draft as in `RELEASING.md`.
3. In a **test workspace** (Settings › Workspaces, mark it) every step is refused when it runs and nothing is logged; the proposals still exist and their confirmation is refused.
4. Automated: `test/runner-release.test.ts` (the pushes of the beta and of the stable are proposals with an autonomous agent), `test/release-actions.test.ts` ("a step an agent's autonomy lets go out": a push is refused by `runReleaseAuto`; "is refused in a test workspace").

### 4. The unit is judged again, and an agent cannot reach `--emergency`

1. Open `<data>/workspaces/<id>/acoes.json`, find a pending `release-git` action and add `"cwd": "/etc"` or `"emergency": true` to its `unit`. Say yes in Actions: it fails with `unknown-field`, nothing runs, nothing is logged.
2. In the thread of a run, the agent's refused calls (a path, a flag, another version, a step that is not one of the six) are messages "A release step was refused, and nothing was done".
3. Read the audit log after a whole release: no row has `--emergency` or `--allow-branch`; an emergency stable is cut by hand in a terminal ([`RELEASING.md`](../../../RELEASING.md#hotfix)).
4. Automated: `test/release-unit.test.ts`, `test/release-actions.test.ts`, `test/engine-release-tool.test.ts`, `test/runner-release.test.ts` ("the tool the Release manager asks for the steps with").

### 5. The waits

1. After the merges, the run waits at **Merges in** (`release-approved`) while any pull request is open against `release/0.2.0`; close or merge the last one: within 5 minutes it goes on (or *Go on without waiting*).
2. At **Beta feedback** (`beta-age`, a day, `beta-blocker`): publish the beta's draft; the tracking issue gets **Beta published** with the link. Before the day has passed, or while an open issue carries the label `beta-blocker`, the run waits (for a quick check, edit the stage in Settings › Team › Flow and put 2 minutes). A beta that was cut and not published does not count.
3. A stage whose wait has no minutes is refused by the flow check (`beta-age`), and the flow editor offers both new events with their fields.
4. Automated: `test/runner-release.test.ts` ("what the sweep and the waits read from the host"), `test/flow-check.test.ts`, `test/runs-subject.test.ts`.

### 6. The stable, and closing

1. Approve **Approve the stable**: the agent asks for `stable` (it merges `release/0.2.0` into `main` and cuts `v0.2.0`; your `main` is not touched: the stable tag is on a detached commit made from `origin/main`), then the pushes of `main` and of the tag wait. Say yes in that order and publish the draft.
2. The tracking issue then gets **Stable version published** and is closed (by itself, or as a proposal when the agent waits). Run it twice more: nothing is written again.
3. Automated: `test/runner-release.test.ts` ("goes all the way").

### 7. Nothing else changed

1. The prompts of the other templates are what they were: `test/runner-golden.test.ts` and `git diff origin/main -- test/golden` are empty.
2. Starting an issue run, the flow of your issues and the agent cycle behave as before (the whole suite).

## What the checks do not cover

- A real model: the scripted engine says what the Release manager "does". Whether it picks the commit to merge at, the steps and their order, and writes the plan and the comments well, was not measured.
- A real host: GitHub's releases-by-tag read, GitLab's releases and `closeIssue` on each host ran only against fakes modelled on the documentation; Bitbucket has no releases and no labels on issues, so the tracking issue is not closed by itself there and `beta-age` needs *Go on without waiting*.
- The build: `npm run dist` and the GitHub workflow are not run by any test here (and the release checks are replaced by a stub `npx` in the temporary repositories); the draft's files, its publication and the update of an installed app are checked by hand as in `RELEASING.md`.
- The worktree: the steps run in a worktree of their own (`<worktrees>/<repo>/release-0.2.0-steps`) and never touch your checkout; the test does check its HEAD, branch and status after a whole release against a temporary repository, but not against a repository with a large `node_modules` or hooks of your own (the links to the dependencies and the exclude file were seen only with a small fake one).
