# Your first run

A run takes one issue through the agent cycle: a branch and a worktree of its own, then one agent
per stage, one stage at a time, until a gate, a question or the end. What it writes stays in the
worktree and in the run's own thread; what goes to the code host waits for your yes.

1. Put the trigger label on an issue, or press **Start the cycle** on its card in Today.
2. The app reads the issue, makes the branch and copies the issue into the run's folder.
3. Each stage works and hands over its result. Where the process asks for a decision, the run stops
   at a **gate** and waits for you: approve, reject with a reason, or send it back.
4. An agent that cannot decide opens a **question**; you answer it from the app or the phone.
5. At the end of the last stage that writes, the branch push and the pull request are proposed, and
   wait for your yes in **Actions**. Nothing is pushed by itself.

The whole of it — the stages, the guard on an agent that writes, the commands, what goes to the
host — is in [The runner](/reference/runner).

**What you should see:** the run's screen with the stage timeline, the live activity of the agent
that is working, and the proposal waiting for you when it reaches the end.

<!-- site:image-placeholder -->
> **Screenshot (pending).** A run in progress, with its stage timeline. Taken from the app over a
> seeded workspace with fictitious data, refreshed with each release.
