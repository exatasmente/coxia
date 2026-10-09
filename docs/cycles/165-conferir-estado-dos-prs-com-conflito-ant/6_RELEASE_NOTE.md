# Two pull requests left behind by conflicts are settled before the next release

## What changed

- Nothing changed in the app itself — its screens, behavior and tests are exactly as they were.
- The change is in the development routine: before cutting the next version, the two pull requests that had been skipped because of merge conflicts (the one for the QA-stage work and the one for the evidence work) were checked one by one on the code host, and the outcome of each is now recorded instead of left ambiguous.
- Both pull requests were already merged into the `release/0.8.0` branch (one on 07/10/2026, the other on 08/10/2026), each with green continuous verification. The conflict marks the host still shows are residual — they mean nothing is pending to rebase.
- The subjects of both deliveries are already in the published changelog of version 0.8.0, with follow-ups in the 0.9.0 beta entries, so the content reached the main line through the merge itself.

## How to use this

- The next release cut can proceed: for each of the two pull requests there is a settled state — merged — recorded on the host and in the cycle notes, not a silent leftover.
- When a pull request is skipped by a conflict again, follow the same pattern: read its current state on the host before cutting, record it, and make a single explicit decision per pull request (rebase and merge, or close as delivered elsewhere) before any new version tag.

## What is worth knowing

- No rebase is pending and no pull request needed closing: the decision recorded in each one is "merged", made by the maintainer through the normal flow.
- Not verified commit by commit that the merged content sits in the main line exactly as it merged; the changelog and the merged state on the host are the confirmation used.
- No open pull request remains blocked, and no new, unlisted work was discovered to come out of this check.
