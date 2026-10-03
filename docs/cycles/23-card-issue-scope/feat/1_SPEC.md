# #23 Choose which issues become cards — functional spec

Issue: https://github.com/exatasmente/coxia/issues/23

## The problem

Today a card is an open issue **assigned to the person**. On every host the built-in card source asks the tracker for "my issues" (GitHub `assignee=<me>`, GitLab `scope=assigned_to_me`, Bitbucket `assignee.uuid=<me>`). A maintainer who triages a whole tracker, who does not assign issues, or who works from a label ("ready", "sprint-12") sees an empty day, and has no way to change it short of an external card-source command.

## What this delivers

A workspace setting, **which issues become cards**, with three values:

| Value | Cards are | Default |
|---|---|---|
| `assigned` | the open issues assigned to me (today's behavior) | yes |
| `all` | all the open issues of the issue project | |
| `labels` | the open issues of the issue project that carry **any** of the listed labels | |

- It applies to the three hosts the app supports. What a host cannot do is said, not hidden (see "Per host").
- An existing workspace keeps `assigned`: its cards, their order and what the agents read do not change.
- The merge or pull requests that become cards (#11) are **not** affected: they stay the ones I authored or was asked to review, linked to the issues by the same rules.
- The page limits, the 8-card agenda of the call and its "left out" list (#8) work as before on whatever the scope produced. A scope that returns more issues than fit just fills the "left out" list; nothing is dropped silently.

## Rules

1. **The scope needs the issue project.** `all` and `labels` read the issues of `projects.issues.project` (the "Where the issues live" setting). With no issue project there is nothing to enumerate "all" of, so the card source **falls back to `assigned`** and the setting says so next to the control and as a configuration warning. The saved choice is kept: setting the project makes it take effect.
2. **`labels` needs labels.** A labels scope with an empty list falls back to `assigned`, with the same note. Labels are matched by name, case-insensitively where the host is (GitLab, GitHub). A card can carry other labels too: the list is "any of", not "all of".
3. **Bitbucket has no issue labels**, so it offers `assigned` and `all`. A stored `labels` on a Bitbucket workspace falls back to `assigned` with the note.
4. **Only open issues**, as today. Closing an issue removes its card on the next refresh.
5. **Same ordering and priority** (#8): blocked first, then priority, then last update. With `all` the issues are not mine, so nothing in the order assumes it.
6. **An external card-source command** (`externalTools.cardSource`) keeps its own definition of what a card is: the scope applies only to the built-in source, and Settings says that when a command is on.
7. **A change applies at once**: saving the scope refreshes the cards instead of waiting for the next cache expiry.
8. **The agents' card JSON does not change** for the default scope: no new field is added to a card, so the prompts and their goldens are untouched.

## Per host

| Host | `all` | `labels` (any of) |
|---|---|---|
| GitHub | open issues of the repository, pull requests left out | same, filtered by the listed labels |
| GitLab | open issues of the project | one read per label, merged by issue number (the "any of" filter is a paid-tier feature of the host, so it is not relied on) |
| Bitbucket | open, new and on-hold issues of the repository | not available (the tracker has no labels) |

The exact calls and how pagination is bounded are in [`2_PLAN.md`](2_PLAN.md).

## Where it is edited

In the setup wizard's integrations step (Settings → "Settings and workspaces" → "Open the wizard"), in the block that already holds the issue project and the card prefix: a "Which issues become cards" choice and, for labels, a field with the labels (separated by commas). That is where every other `projects` setting lives; there is no separate Settings page for the workspace configuration. The texts name the host through the workspace terms and are in both languages.

The block shows, as a note, what the saved choice will actually do: the fallback when the issue project or the labels are missing or the host has no labels, and that an external card-source command ignores the choice.

## Out of scope

- Showing who an issue is assigned to on the card (it changes what the agents read; its own issue).
- Filtering by milestone, author or text, or by labels combined with "all of".
- Choosing the scope per project or per repository; one scope per workspace.
- Issues of several projects in one workspace (the issue project is one).
- Changing which merge or pull requests become cards.

## Acceptance

- A GitHub workspace on `assigned` shows the same cards as before.
- Switching it to `all` shows the open issues of the issue project, assigned to me or not, and no pull request; switching to `labels` with `bug, ready` shows only the issues carrying either label.
- The same three on GitLab; on Bitbucket `all` works and `labels` is not offered.
- With no issue project, `all` and `labels` show the assigned cards and the settings explain why.
- An existing configuration file migrates to schema 4 with `assigned` and behaves as before; a hand-edited file with an invalid scope is repaired to `assigned`, never locks the workspace out.
- Today and the call take their cards as before: a long list fills the "left out" list.
- No test reaches a network, a model or a host.
