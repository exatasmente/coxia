# From an issue to a pull request

An issue is opened, the trigger label goes on it, and the run starts by itself. Here is the whole
of what happens to it.

**Triage.** The front door reads the issue and proposes who should work it. With several squads
claiming the issue, the run waits for the choice or takes the proposal, under the agent's autonomy.

**Refinement and plan.** An agent reads the code and writes what the issue really asks for, then the
technical plan: the files, the order, the tests, the risks. The plan is a document in the cycle
folder, and the run stops at a gate for you to approve it.

**Development.** The Developer works in the run's worktree, on a branch of its own. It writes, runs
the commands the workspace allows in a sandbox, and commits one logical change at a time through the
app. Whatever it cannot decide becomes a question, and the question is answered by the person or the
agent it turns to.

**Review and QA.** The Reviewer reads the branch's diff and leaves findings with a file and a line;
the QA runs the project's own checks and marks each scenario it exercised, citing the command behind
it. A finding or a failed scenario sends the work back to the implementation, and the round limit
says when to stop.

**The end.** The last stage writes the pull request description, and the push and the pull request
are proposed. They wait for your yes in Actions. Once the pull request is merged, the run ends and
the person who opened the issue gets their note.

What each step writes to the code host, and the one rule behind it, is in
[The runner](/reference/runner#what-goes-to-the-code-host).

<!-- site:image-placeholder -->
> **Screenshot (pending).** The review round with its findings and where each one's thread stands on
> the pull request. Taken from the app over a seeded workspace with fictitious data, refreshed with
> each release.
