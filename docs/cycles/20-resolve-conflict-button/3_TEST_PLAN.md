# #20 "Resolve conflict" never shows for cards from a code-host integration — test plan

How a person checks the fix in the app. Everything below runs against a throwaway repository on a host you own; no model is needed for these checks.

## Setup

```bash
export CERIMONIAS_DATA_DIR=$(mktemp -d)
export CERIMONIAS_SPECS_DIR=$(mktemp -d)
npm run dev
```

1. In the setup wizard connect a **GitHub** workspace (github.com or Enterprise Server) with a token that can read the throwaway repository, and **no** external card-source command (the default). Set the repository as the workspace's repository.
2. In the repository create an issue assigned to you, `#1`.
3. Create two branches from `main` that change the same line of the same file differently; open a pull request from each into `main`, both with `Closes #1` in the description. Merge neither. Open the second one only after the first exists: GitHub reports the second as conflicting once the first is merged into `main`, so merge the first, then leave the second open. (Alternatively edit `main` after opening a single pull request so that it conflicts.)
4. Optional second pass: repeat on a GitLab project, or make the pull request's pipeline fail as well, to check the "not the first blocker" case.

## Checks

1. **Today.** Refresh the cards. The issue shows a blocked row whose text says the pull request conflicts with the target branch (the interface language decides the wording). The row has a "Resolve conflict" button. Before the fix it had none.
2. **Unblock screen.** Open the row ("Deepen"). The right-hand side shows the conflict panel with the button.
3. **The button works.** Press it: it prepares the resolution and opens the conflict screen. The resolution itself is out of scope for this issue.
4. **Language.** Switch the interface to the other language (Settings), refresh the cards, and repeat 1 and 2: the button is still there; only the blocker wording changed.
5. **No conflict, no button.** Close the conflicting pull request, or rebase it on `main` and wait for the host to recompute (a minute or two), then refresh: no conflict panel and no button (the issue may still be blocked for another reason, such as a failing pipeline).
6. **Not the first blocker.** If the pull request also has a failing pipeline, the row's text is the pipeline reason, and the button is still offered, labelled with the pull request's reference when the issue has more than one conflicting request.
7. **Card-source command workspace.** For a workspace that uses an external card-source command whose report writes the blocker "MR com conflitos", the button still shows (the text fallback).

## Not verified here

- Hosts: only fakes of GitHub and GitLab were exercised by the suite. Bitbucket Cloud reports no conflict flag, so it has no button by design.
- GitHub computes mergeability lazily: right after a push the flag can be unknown for a moment, and the button appears on the next refresh.

## Automated

- `test/resolve-conflict-button.test.ts`: a GitHub-like and a GitLab-like fake host → `buildCardReport` → `loadCards` → `conflictMrs` and the Today row, in pt-BR and en, for a conflicting and a clean merge request; the text-only source; the "not the first blocker" and "only that MR's button" rows.
- `test/dashboard.test.ts` (`MR conflicts`): the flag by itself, the legacy sentence by itself, both together.
