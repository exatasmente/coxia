# 119 Put the issue number in every pull request title and commit of a run

- Endereço: https://github.com/exatasmente/coxia/issues/119
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## What should happen

Every pull request (merge request) a run opens carries the issue's number in its title, and every commit the app makes for an issue run carries it in its message. Both come from a template in Settings › Runner that cannot leave the number out.

Today:

- **Commits**: `runner.commitMessage` defaults to `feat: {summary} #{iid}` (`src/main/runner/git.ts`, `commitMessage`), but validation only requires `{summary}` (`src/shared/config/validate.ts`): a template without `{iid}` is accepted and the commits go out without the number.
- **Pull request title**: the title the agent wrote (`output.pr.title`) or the issue's title, never the number (`src/main/runner/publish.ts`, where the `pr` draft and the `createMr` proposal are built).

### 1. A template for the pull request title

- A new field, `runner.prTitle`, next to `runner.commitMessage`, with the placeholders `{title}` (the title the agent wrote, or the issue's title) and `{iid}`. Default: `{title} #{iid}`.
- The title is built from the template when the draft is made and again when the proposal is made, so the proposal, Actions and the code host show the same text. The 120-character cap applies to `{title}`, never cuts the number.
- A title that already carries the number (the agent wrote `#123` in it) does not get it twice.

### 2. The number cannot be left out

- Both templates must contain `{iid}` (and `commitMessage` still `{summary}`, `prTitle` `{title}`); validation refuses a template without it, in the editor and on import.
- A run with no issue (a release run, a documentation run: `iid` 0) drops the number and the `#` before it, as `commitMessage` already does.
- Migration: a stored `commitMessage` without `{iid}` gets ` #{iid}` appended; `prTitle` is added with the default. Nothing else moves.

### 3. Every commit of an issue run

Every commit the app makes for an issue run goes through `commitMessage`: the stage commits, the issue record, the cycle memory and the commit of a conflict resolution made for a run's branch (`src/main/conflictGit.ts`, `mergeMessage`). Merge commits of a release (`src/main/releaseGit.ts`) keep their own messages.

## Out of scope

Commits a person makes by hand on the run's branch, and the title of a pull request that already exists (the app does not rename it).

## Acceptance

- A run of issue #123 with the defaults opens a pull request titled `<title> #123`, in the proposal and on the code host.
- A run with `prTitle` set to `#{iid} {title}` opens `#123 <title>`.
- An agent title that already has `#123` does not get it twice.
- Saving or importing a `commitMessage` or a `prTitle` without `{iid}` is refused, with the reason.
- A workspace whose stored `commitMessage` has no `{iid}` is migrated to one that has it; every commit of an issue run carries `#<n>`.
- A release run and a documentation run produce titles and commits without a dangling `#`.

## Notes

Functional specification only; the solution design belongs to refinement and planning. Independent from the autonomy work.

## Comentários

(sem comentários)
