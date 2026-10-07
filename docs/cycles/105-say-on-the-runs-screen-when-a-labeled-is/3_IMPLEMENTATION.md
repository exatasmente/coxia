# Unassigned labeled issues are listed on the runs screen with a manual start

## What was implemented

The runner's issue source gained a dedicated read of the open issues of the project that carry
the trigger label and have no assignee. That list is served to the runs screen on its own
read-only channel, and the runs screen shows it in a section of its own, with a start button for
each issue.

Three layers changed:

1. **The read.** `IssueSource` now has `unassigned(label)`, implemented in the runner module with
   the provider's project-wide issues-by-label query, filtered to the open issues with the label
   and an empty assignee list. The automatic scan (`triggered` / `listMyIssues`) was not touched:
   it keeps starting only the person's own issues, so nothing starts by itself from the new list.
2. **The channel.** A new `runs:*` read channel returns the sparse list (number, ref, title,
   address), open to a paired browser like the other runs reads, and never writes to the host.
3. **The screen.** `RunsScreen` gained a section that lists those issues and, for each, a start
   button that calls the existing manual start by reference. A button is disabled for a ref that
   already has a run, and a refusal (closed issue, existing branch, a duplicate run) shows its
   reason instead of failing silently. The section hides itself when the list is empty or there
   is no issue project.

## How it was verified

Run and passing:

- TypeScript check (`tsc --noEmit`) passes.
- The new test file covers: the `unassigned` read returns only open, labeled, unassigned issues
  (closed, wrong-label and assigned issues are excluded); the label match is case-insensitive;
  the automatic scan never starts an unassigned labeled issue even though it is on the new list;
  a run starts for the issue by hand and a second start is refused as a duplicate without
  confirmation.
- The web-policy test passes: the new channel is classified as an open read (not desktop-only,
  not behind the external-effects switch), and the provider calls the runner module makes are
  pinned including the new by-label read.
- The whole Vitest suite passes except one sandbox test that depends on a real sandbox being
  available on the machine (`test/sandbox-gui.test.ts`); that test does not touch any file of
  this change and fails for an environmental reason, reported separately.
- The i18n lint passes (keys added to both catalogs, none unused, none untranslated), and the
  theme and public audits pass.

Not verified: the visual flow of the new screen section was not exercised in a running app (no
Electron run in this stage). The renderer production build (`electron-vite build`) was not run;
the TypeScript check over the renderer passed.

## Notes for the review

- The change keeps the automatic scan untouched, so the acceptance "nothing starts by itself
  from that list" holds by construction and is covered by a test.
- The shared sparse shape returned to the screen is the existing `RunIssue` (number, ref, title,
  address), so no new shared type was invented.
- The changelog gained a line under `## [Unreleased]` for this user-visible change, closing the
  review's blocking finding.
