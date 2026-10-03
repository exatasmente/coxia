# #23 Choose which issues become cards — test plan

How a person checks, in the app, each acceptance item of [`feat/1_SPEC.md`](feat/1_SPEC.md) against a GitHub repository they own. The "automated" lines say what the suite already proves with fakes; nothing in the suite reached a real host, so these steps are also what verifies the queries (GitHub's `label:"a","b"` OR and the search itself) on the real thing.

## Setup

Use a throwaway data folder and a throwaway repository on GitHub (`<you>/scope-check`) with the issue tracker on:

```bash
export CERIMONIAS_DATA_DIR=$(mktemp -d)
export CERIMONIAS_SPECS_DIR=$(mktemp -d)
npm run dev
```

1. Finish the setup wizard with a model and a GitHub integration whose token can read the repository (read-only is enough: nothing here writes). In the integrations step set the issue project to `<you>/scope-check`.
2. In the repository create:
   - issue A: assigned to you, labels `bug`;
   - issue B: assigned to you, no label;
   - issue C: not assigned, labels `ready`;
   - issue D: not assigned, labels `bug` and `ready to test`;
   - issue E: not assigned, no label;
   - issue F: closed, assigned to you, label `bug`;
   - a pull request from a branch of your own (any change), titled to mention issue A (`Closes #<A>`).
3. Keep the browser on the repository's issue list to compare.

## Acceptance items

### Default: an existing workspace is unchanged

1. Open Today (use "refresh" so the cache is skipped). The cards are A and B, and the pull request linked to A. C, D, E and F are not there.
2. Open the workspace's `config.json` (`<data>/workspaces/<id>/config.json`). `"schemaVersion"` is `4` and `projects.issues` shows `"cardScope": "assigned"` and `"cardLabels": []` after the wizard saved it. Set `"schemaVersion"` back to `3` and delete the two lines, restart the app: it opens and migrates, Today shows A and B again, and the file is back at version 4 with the two defaults.

Automated: `test/card-scope.test.ts` ("a current file without them opens as assigned"), `test/vcs-cards.test.ts` ("asks for the issues assigned to me, exactly as before"), `test/config-resolve.test.ts`, the prompt goldens (`test/golden`, untouched).

### Switching to every open issue

1. Settings -> "Settings and workspaces" -> "Open the wizard" -> Integrations. Under "Where the issues live" the new "Which issues become cards" has three options: "Assigned to me", "All open issues of the issue project", "Open issues with any of these labels".
2. Choose "All open issues of the issue project", continue to the end of the wizard (or save), and go to Today without waiting five minutes. The cards are A, B, C, D and E: assigned or not. F (closed) is not there. The pull request does not show up as an issue card: pull requests are never counted among the issues.
3. The linked pull request is still shown under A. Other people's pull requests, if the repository has any, are still not cards.
4. Open the call: the agenda lists the cards in the order blocked, priority, last update, as before.

Automated: `test/vcs-github.test.ts` (the search query, pull requests left out, two pages at most), `test/card-scope-report.test.ts` (a saved change shows at once; the cache is reused while nothing changes), `test/vcs-cards.test.ts`.

### Switching to labels

1. Back in the step choose "Open issues with any of these labels". A "Labels" field appears. Type `ready, bug` (a comma, with or without a space) and save.
2. Today shows A (bug), C (ready) and D (both labels, shown once), and not B or E. F stays out although it has `bug`, because it is closed.
3. Change the field to `ready to test` (a label with spaces): only D. Change it to `READY`: C and D (the match ignores case).
4. Clear the field: a note appears under the choice, "No label is listed: until some are, only the issues assigned to you become cards", and Today shows A and B.
5. Try typing a quote or a backslash in the field: it does not appear.

Automated: `test/card-scope.test.ts` (parsing, schema refusals), `test/card-scope-wizard.test.ts` (the step as rendered), `test/vcs-github.test.ts` (any-of syntax, quotes never reach the query).

### No issue project

1. In the step, empty the "Project" field while the scope is "All open issues" (or labels). A note says the choice does not apply yet and that only the issues assigned to you become cards.
2. Today shows the issues assigned to you across the repositories the token sees (the behavior of an empty issue project), not the whole tracker.
3. Put the project back: Today shows the wider list again, with no change to the saved choice.

Automated: `test/card-scope.test.ts` (fallbacks and their order), `test/vcs-cards.test.ts` (each fallback reads the assigned issues), `test/card-scope-report.test.ts`.

### A host without issue labels

Needs a Bitbucket workspace and a repository with its tracker on; if you have none, rely on the automated line.

1. With a Bitbucket issue integration, the choice lists only "Assigned to me" and "All open issues of the issue project".
2. "All open issues" shows every open, new or on-hold issue of the repository.
3. Edit `config.json` by hand to `"cardScope": "labels"` with a label and restart: the wizard still lists the choice (so it is not hidden) with the note that the tracker has no labels; Today shows the assigned issues.

Automated: `test/vcs-bitbucket.test.ts` ("refuses a label scope"), `test/card-scope.test.ts`, `test/card-scope-wizard.test.ts`.

### GitLab

If you have a GitLab project, repeat the three choices with its issues. Labels: `STAGE:: Doing` style (scoped) labels work as typed, with their spaces and colons. With two labels, an issue carrying both appears once.

Automated: `test/vcs-gitlab.test.ts` (one read per label, merged, scoped label encoded).

### The card source command

1. Turn on an external card source command in a copy of the workspace's config (`externalTools.cardSource.enabled` with a command that prints a report) and open the integrations step: a note says the command decides the cards and the choice does not apply.
2. Today shows what the command prints, whatever the scope.

### A hand-edited invalid value

1. In `config.json` set `"cardScope": "everything"` and a label `"a,b"` in `cardLabels`. Start the app: it opens, the log says the two fields were reset, and the rest of `projects.issues` (project and prefix) is intact. The scope shows "Assigned to me".

Automated: `test/card-scope.test.ts` ("an invalid scope or label is reset by itself").

### A long list

1. In the throwaway repository create thirty open issues (a loop with `gh issue create` is enough) and choose "All open issues". Today lists the cards; the call takes eight and says how many were left out, listing the rest with "Bring in".
2. With more than a hundred open issues the list is cut at the hundred most recently updated; this is not announced (the same limit as before for assigned issues), as documented.

Automated: `test/cards-load.test.ts` ("hold a whole tracker"), `test/vcs-github.test.ts` (two pages, the cut).

### Not verified

- The queries ran only against fakes modelled on the documentation. This plan is what checks them on a real GitHub, and the first run should confirm, in particular, that `label:"a","b"` returns the union and that a just-created issue shows up in the search within a minute or so.
- GitLab and Bitbucket have no real-host run at all in this change.

## Clean up

Delete the throwaway repository and the data folder. No setting of a real workspace was touched.
