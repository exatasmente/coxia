# The runs screen lists labeled issues without an assignee, and each can be started by hand

## What this plan covers

The runs screen shows, in a section of its own, the open issues of the project that carry the
trigger label and have no assignee, each with a button that starts a run for it by hand. The
button is disabled for an issue that already has a run, a refusal to start shows its reason on
the screen, and the section hides itself when the list is empty. Nothing starts by itself from
that list: the automatic scan is unchanged.

## How this plan was checked

Every scenario in this plan was verified by reading the delivered code and the tests that cover
it. No command was run in this stage and no running app was opened, so the visual flow of the
section on screen was not exercised live; for each scenario the evidence column says whether it
was read in the code or only reasoned about, and the things not seen in a running window are
named in "Not verified" at the end.

## Scenarios

### 1. An open labeled issue with no assignee appears listed

- Result: pass (read)
- Evidence: the runner's `unassigned(label)` read returns only the open issues of the project
  with the trigger label and an empty assignee list; the `runs:unassigned` channel serves that
  list to the screen as number, reference, title and address; the screen section renders one
  item per returned issue. The unit test "returns only the open issues that carry the label and
  have no assignee" confirms an open labeled unassigned issue is returned.

### 2. Each listed issue has a control that starts its run

- Result: pass (read)
- Evidence: each item of the section renders a "Start" button that calls the existing manual
  start by reference (`runs:start`), the same path that creates the branch, worktree and cycle
  folder for the issue. The test "starts a run for the issue only by hand" shows the run starts
  for the issue on a manual start.

### 3. A closed issue with the label and no assignee does not appear

- Result: pass (read)
- Evidence: the `unassigned` read filters to `state === 'open'`, so a closed issue never enters
  the list. The unit test covers a closed labeled issue being excluded.

### 4. An open labeled issue with an assignee does not appear in this section

- Result: pass (read)
- Evidence: the read requires an empty assignee list, so an issue with an assignee is excluded
  from the list (it already belongs to the automatic scan's scope). The unit test covers an
  assigned issue being excluded.

### 5. Nothing but the explicit start gesture creates a run from the list

- Result: pass (read)
- Evidence: the `runs:unassigned` channel only reads and serves the list; it never starts a run.
  The only way a run begins for a listed issue is the person pressing the start button, which
  goes through the manual `runs:start`. The test "never lets the automatic scan start an issue
  that has no assignee, even when it is on the list" shows scanning produces no run for an
  unassigned listed issue.

### 6. The automatic scan behaves as before

- Result: pass (read)
- Evidence: the scan's source (`triggered` / `listMyIssues`) is untouched and keeps reading only
  the person's own issues, so an unassigned labeled issue never starts by itself, while the
  issues the scan already started keep starting. The unit test confirms the scan returns nothing
  for an unassigned issue even when it is on the manual list.

### 7. An issue that already has a run cannot be started again by accident

- Result: pass (read)
- Evidence: the start button is disabled for a reference that already appears among the runs on
  the screen, and the manual start path itself refuses a second run without the person saying so
  (a duplicate is refused). The unit test "starts a run for the issue only by hand, and refuses
  a second without the person saying so" covers the refusal.

### 8. A refusal to start shows its reason on the screen

- Result: pass (read)
- Evidence: when a start is refused (a closed issue, an existing branch, a duplicate run), the
  screen shows the refusal reason through the same error path other start controls use, in the
  section and not as a silent failure. This was read in the section's start handler; it was not
  exercised in a running window.

### 9. The section hides itself when the list is empty

- Result: pass (read)
- Evidence: the section returns nothing when the read comes back empty or when there is no
  issue project (the read returns an empty list in either case), so the screen shows no empty
  section and no error. This was read in the section's render logic; it was not exercised in a
  running window.

### 10. The change is a read and stays inside the security boundary

- Result: pass (read)
- Evidence: the new channel is classified by the web policy as an open read to a paired browser,
  is not desktop-only and is not behind the external-effects switch; the runs module still
  reaches the provider only through reads (the by-label list read included) and writes to the
  host through nothing new. The web-policy tests pin the served channels and the provider calls.

## Not verified

- The visual flow of the section in a running app (Electron) was not exercised in this stage:
  the list rendering, the disabled button for an already-started issue, the refusal reason shown
  on the screen, the section hiding when the list is empty, and starting a run by clicking were
  all verified by reading the code and the tests, not by interacting with an open window.
- The whole Vitest suite was not run in this stage; the tests read for this plan are the new
  `runner-unassigned` tests and the web-policy tests. A previously noted environmental failure
  in a sandbox GUI test does not touch the files of this change.
- No configured commands were run here; the gates the implementation/review ran (type check,
  i18n lint, theme audit, public audit) are reported in those stages' documents, not re-run here.
