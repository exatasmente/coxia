# Release note: delivery of

This delivery changes what a run's timeline shows and how a paired browser fills it in, plus one fix so a flaky test stops failing on slow machines.

## What changed

1. **You can now tell which attempt produced each document.** When a stage of a run goes through more than one attempt (a question was answered, the work was sent back, a failed attempt was retried, or the app restarted during the attempt), the timeline shows a small label next to each stage document: "attempt 1", "attempt 2" ("tentativa 1", "tentativa 2" in Portuguese). This is on the timeline itself, without opening any artifact.
2. **A paired browser no longer stitches lines of an earlier run into the timeline.** If the browser's timeline loses its live stream and comes back, what is fetched again keeps only lines of the run the screen is showing. A screen opened fresh keeps behaving as before: everything still held is fetched and the timeline starts up to date.
3. **One test that could fail on a slow machine was aligned.** The failure was in how the test waited for the run to reach a state, not in what the product does; it now waits for the state itself with a timeout instead of a fixed count of quick checks.

## How to use it

Nothing new to enable. Open a run and look at its timeline as today:

- On a stage that ran more than once, each document line carries its attempt label. On a stage that ran once, or on runs written before this change, nothing new appears.
- In a paired browser, the timeline of a live run stays limited to lines of that run even after the stream drops and returns.

## Good to know

- Both new texts exist in English and Portuguese.
- Verified live in the app on a disposable workspace with a run whose first stage ran twice: the labels appeared on each document in both languages, next to the attempt count the stage header already shows. The full test suite and the repository checks pass on the delivered tree; two voice-setup checks fail only because this machine's free disk space is below the threshold for model downloads — environment, not code.
- Not verified live: a real paired browser losing and regaining its stream over a running execution. The filtering logic behind it was verified by unit tests; the end-to-end event path was not exercised.
