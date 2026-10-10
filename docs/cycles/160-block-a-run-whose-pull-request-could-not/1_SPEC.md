# A run cannot be stuck waiting for a pull request the host refused to open, and the thread does not fill with waiting lines

## What changes for the person using the product

Today, when the branch is pushed but the host refuses to open the pull request (for
example because the release branch it targets was deleted when the stable version was
cut), nothing happens on the surface: the run carries on as if the pull request existed,
the final stage sits "waiting" forever for a merge that can never be detected, and the
review thread receives one identical "waiting for the pull request" line at every sweep
— more than 150 of them in the runs that showed this — with no actionable word anywhere
except a single failed line hours earlier.

After this change, the failed opening is a visible, named stop: the stage ends blocked
with the host's answer and the branch it aimed at as the reason, the run screen, the
runs list and the thread all show it, the final stage never starts a wait for a pull
request that does not exist, and when the cause is a base branch that is gone the
person can retry the pull request against a base chosen on the run screen. The review
says "waiting for the pull request" once per round, not once per sweep.

## Rules

1. **A failed pull request opening is a blocked stage, not a thread detail.** After the
   branch has been pushed, if the attempt to open the pull request fails, the stage that
   pushed it ends blocked; the reason carries the host's answer (the message code and
   text, e.g. a validation failure) and the branch the pull request was aiming at. This
   is visible on the run screen, in the runs list and in the thread.
2. **No wait without a pull request.** The final stage never enters its `pr-merged` wait
   unless a pull request is recorded for the run (published by it) or linked to it
   through cross-references. If the opening failed and nothing was recorded or linked,
   the run is stopped blocked at rule 1, not waiting.
3. **When the base branch is gone, say so and offer a retry.** When the failure is a
   base branch that no longer exists on the host, the blocked reason says that the base
   branch is gone and offers a retry of the pull request from the run screen against a
   base chosen there — the open release branch the run knows or the project's default
   branch. Retrying reuses the description the run already drafted.
4. **The review waits aloud once, not per sweep.** A draft review comment with no pull
   request to go to produces the "waiting for the pull request" line at most once per
   round. The sweep keeps delivering the review as soon as the pull request exists, but
   stays silent about the waiting until then; it does not re-emit the waiting line.
5. **A retry that succeeds resumes the normal flow.** When the person retries and the
   pull request is opened, the run behaves from there as if the pull request had been
   opened in the normal path: the review drafts go out, and the final stage may wait
   for the merge (rule 2 is then satisfied).

## Out of scope

- Preventing the base branch from being deleted in the first place (release lifecycle,
  other work).
- Editing the failed run's branch, recreating the push, or re-running stages: the retry
  only reopens the pull request with the draft already made.
- Changing how linked pull requests are found (the cross-reference path that recovery
  used by hand stays as it is).
- Automatic retry without the person: opening against a different base is a choice of
  the person on the run screen.

## Acceptance criteria

1. Make the host refuse to open a pull request after the branch was pushed (a base
   branch that no longer exists, answering 422 on a fake provider). The stage that
   pushed ends blocked, the run screen, the runs list and the thread show the blocked
   reason with the host's answer and the target branch, and the run does not show as
   "waiting".
2. With a 422 for a vanished base branch, the final stage does not enter the
   `pr-merged` wait; a test covers this.
3. A call that starts the `pr-merged` wait without a published or linked pull request
   does not start it; a test covers this.
4. On the blocked run, the run screen offers a retry of the pull request with a base to
   choose; retrying opens the pull request against the chosen base, and the run resumes
   its normal flow afterwards.
5. A draft review comment with no pull request yields at most one "waiting" line per
   round; running the sweep repeatedly while the pull request still does not exist adds
   no further "waiting" lines; a test covers this.
6. When the pull request comes to exist (published by a retry or linked from outside),
   the pending review drafts are delivered as today and no further "waiting" line is
   needed.

## Open questions blocking

None blocking: how the retry picks the base (offer the known bases on the screen, or
re-read the open release beforehand) is left to the implementation; the acceptance text
allows either.
