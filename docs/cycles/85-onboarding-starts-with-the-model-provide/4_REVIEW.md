# The model choice is the second thing a fresh install asks, and the step says nothing runs without a provider

## What was reviewed

The commit that carries this change, read against the specification and the plan: the wording added to
both interface catalogs, the line rewritten at the top of the assistant, the notice that renders the
new wording, the test that locks the step order, and the snapshot test of the catalogs that had to
list the rewritten line as an intended difference. Also read: the two conditions the footer of a step
uses to decide its buttons, the test that blocks "Continue" on the model step, and the existing tests
of both catalogs, which pass with no change to them.

Nothing outside those files was reviewed: the engines, the providers, the provider editor inside the
model step, the documentation-folder step and the runner are out of this cycle and were left alone.

## What was verified

By running, on this machine, against the working tree as it stands:

- The wizard tests, with the catalogs and the snapshot of the main-branch catalogs: 22 tests passed.
  These lock the order of the steps by name, derive the set of steps that may be skipped from the
  order, and walk every wizard screen for a key that either language is missing.
- The whole test suite, 222 files: 217 passed, 25 tests failed in five files that do not render the
  assistant — the conflict resolution flow, the release worktree, the agent chain, the update script
  and the conflict policy. Each of those five files was run afterwards by itself, on this same
  machine: four of them came back green at once, and the conflict resolution file, which timed out
  in twenty of its twenty-one tests, came back green on a second run. In every case the failure read
  as a timeout (a test allowed 5 or 10 seconds) or as an assertion that flipped back when the file
  ran alone, which points at the machine's load rather than at this change. The suites that carry the
  two catalogs, the snapshot of the catalogs and the public audit passed both in the whole run and
  on their own.
- The type check, the theme audit, the text lint and the public audit of the repository: all clean.
  The catalogs define the same number of keys in both languages, 4055, and the new keys are there.

Not verified: the assistant was not opened, on a data folder or anywhere else. Whether the new
sentence and the rewritten opening line each stay on a single line cannot be settled by reading, since
a sentence renders at different widths in each language and window size; the only thing checked about
them is their length, between 96 and 168 characters, measured from the catalogs. The behavior of the
screen as a person sees it is taken from reading the code, not from exercise.

## What was found

Two points that do not change the behavior and are worth a decision before someone else reads the
documentation:

1. The setup wizard's section of the configuration document still describes the old rule, that all
   steps but the first and the last may be skipped, and it still says the first step is language and
   name and the second is models — which is now also what the assistant does, but for a different
   reason: the model choice was not "the second of nine" because it had to be, it was where it already
   happened to sit, and the text explains neither the new rule nor why the position matters. The
   documentation is not wrong about the current state; it reads as if nothing had changed.
2. The line that describes the change in the changelog tells more than what a release note needs: it
   names the two screens and repeats the mechanics, next to entries that state the change and its
   consequence in one or two sentences.

Neither point blocks the change: the app behaves as the specification asks, and both texts can be
fixed in a following commit in this same pull request.

## Where the rest stands

The acceptance checks that a person performs on a data folder of their own were not carried out by
this stage, and the previous stage did not carry them out either. The step order, the two footer
buttons and the block on "Continue" were checked by reading the code that decides them, and the
tests that lock the order and the catalogs pass; the walk through the assistant by hand remains to
be done before the change reaches people.
