# What a run's timeline says about a resumed attempt, a browser timeline without another run's lines, and the test that does not compile

## What changes for the person using the product

A run can have more than one attempt at a stage: the person answers a question, sends the work back, asks for a retry after a failure, or the app restarts and the stage is picked up again. Today the run screen shows the timeline with the state of each stage, its attempts, its documents and its comments, but a text shown there does not say whether it was written by the attempt that came before or by the one that resumed the work. A person reading the timeline can take an old text as the current result. It changes so that the timeline itself says which attempt a shown text belongs to.

The same run screen is open in a paired browser. When that browser loses its live stream and comes back, what was said in between is fetched again; what comes back can carry lines of an earlier run of the same work and they get stitched into the current run's timeline. It changes so that a run's timeline in the browser shows only that run's lines: no stitched seam of another execution.

Besides the two behavior fixes, the review of the previous delivery found a test file that does not compile. It is fixed so the compile check passes again. The issue does not name the file; this specification treats it as "whatever the compile check reports" (not verified here; the check was not run in the stages so far).

## Rules

1. When a stage attempt of a run is resumed, every text the run's timeline shows for that stage says whether it belongs to the earlier attempt or to the resumed attempt. What marks it: the person answered a question, the work was sent back, a failed attempt was retried, or the app restarted while the attempt was running.
2. The distinction is visible in the timeline of the run screen, without opening an artifact or leaving the screen.
3. The timeline of a run in a paired browser holds only the lines of that run. When the browser's stream drops and comes back, the refetching must not stitch lines of an earlier run into the timeline of the run that is going.
4. When the browser screen is opened freshly (not reconnected), it keeps behaving as today: what is still held is fetched and the timeline starts up to date.
5. All new texts on the screen go through the translation catalogs, in both languages.
6. The compile check of the whole tree passes, with the test file it reports fixed.

## Out of scope

- The documentation snippet the review left behind. The person who opened the issue said the tech-lead decides whether it enters this issue or another; until then it is not scoped here.
- Redesigning how attempts, artifacts or comments are drawn in the timeline; only the attribution of the shown text and the seam change.
- The voice sidecar and anything outside the run screens and their tests.

## Acceptance criteria

1. Prepare a run, make one of its stage attempts end in a question, answer it and let the stage resume. The run screen's timeline then shows the text with a clear sign of which attempt it belongs to (the earlier one or the resumed one).
2. Do the same after sending the work back to the stage (and after a retry and after an app restart, when practical): each time the timeline says which attempt the shown text belongs to.
3. In a paired browser, open the run screen of a live run, let the browser's stream drop and come back. The browser's timeline shows no lines from an earlier run of the same work stitched into the current one.
4. Run the compile check: it passes, including the test file it previously reported.
5. All texts introduced by the changes are present in both language catalogs.

## Open questions that block

- None block the two behavioral fixes. Two open items ride with this issue and stay with whoever leads the work: which documentation snippet the review left behind (its scope is the tech-lead's decision, per the opener's answer) and the name of the test file that does not compile (not verified in this stage; the compile check names it when run).
