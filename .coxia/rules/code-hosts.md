---
checked-commit: 9f9ba219674ed482da8bfe1e6009a5b1fc73d4eb
checked-date: 2026-10-06
evidence: [src/main/vcs/types.ts, src/main/vcs/runtime.ts, src/main/vcs/validate.ts, src/main/vcs/readPolicy.ts:13-26, src/main/vcs/readPolicy.ts:66-72, src/main/vcs/github.ts, src/main/vcs/probe.ts, test/vcs-writes.test.ts:1-40, test/vcs-read-policy.test.ts, docs/vcs-providers.md:1-150]
summary: The neutral code-host interface, the providers, the single write path and the read policy
stages: [development, review]
roles: [developer, tech-lead]
---

# Code hosts

Everything Coxia reads from or writes to a code host (issues, merge or pull requests,
discussions, pipelines) goes through a **provider** in `src/main/vcs/`: GitLab, GitHub
(github.com and Enterprise Server) or Bitbucket Cloud. The app's modules talk to the neutral
interface, never to `glab` or to a GitLab endpoint. A host is optional: without one, Coxia
still works from local repositories and documents.

## Choosing the provider

`vcs[]` in the `WorkspaceConfig` describes the integrations. The **primary** one is the one
`projects.issues.vcsId` names, or the first. `cliPreference` decides the path:

| Value | What happens |
|---|---|
| `cli` | Always the CLI (`glab`, `gh`), with its login |
| `api` | Always `fetch` with the token of `secretRef` |
| `auto` | With a token configured, the API; without one, the CLI when installed. Bitbucket has no CLI: always the API |

The token comes from the secrets store and only travels in an HTTP header to the configured
host; a path that names another host is refused.

## One write path

1. A module describes the write with `provider.planWrite(op)` (neutral operations:
   `commentIssue`, `commentMr`, `replyThread`, `resolveThread`, `editIssueNote`, `editMrNote`,
   `setIssueLabels`, `setIssueStatus`, `addReviewer`, `setDraft`, `playJob`, `submitReview`,
   `createMr`, `createIssue`, `closeIssue`, `deleteNote`). A provider only **describes**: it
   returns commands, it does not execute.
2. `proposeVcsAction` in `src/main/actions.ts` validates the command with the provider's
   validator and stores a pending action.
3. The person sees the exact command in Actions and confirms. `approveAction` judges the
   command again (it may have come from disk), the executor runs it, and `auditoria.jsonl`
   records a line with the body and without the token.
4. **Only `vcs/runtime.ts` imports the executors and only `actions.ts` calls them.**
   `test/vcs-writes.test.ts` fails if that changes. A test workspace refuses the confirmation.

Two variations go through the same door: **a group** (`proposeVcsGroup`: several writes that
are one thing to the person, such as a review round, wait for **one** yes, run in order, each
audited, the first failure stops the rest and confirming again continues) and **an autonomous
agent's write** (`runVcsAuto`: no yes, but the same path, the same refusal in a test workspace
and the same audit log, with the agent in `by` and the body hash in `bodyHash`). The runner
uses them only through `src/main/runner/door.ts`. The push of a run's branch
(`proposeRunPush`) is not a provider command, it is git: its own `run-push` action, which
always waits for a yes.

The validators accept only a closed list of shapes; anything else is refused before it is
stored and again before it runs. In particular the GitHub review never sends `APPROVE`. Read
`docs/vcs-providers.md` for the per-provider shapes.

## Read policy

| Integration | What an agent may run |
|---|---|
| GitLab with CLI | `glab api projects/<group>/<project>/merge_requests\|issues/<iid>[/discussions\|notes\|approvals\|changes\|pipelines]`, `glab api projects/…/pipelines`, `glab mr view <iid> -R <project>`, `glab issue view <iid> -R <project>` (the `view` calls may carry `--comments`) |
| GitHub with CLI | `gh api repos/...`, `gh pr view`, `gh issue view`; no flags beyond `--paginate` (`-f`, `-F`, `--input`, `--method` become a write) |
| Bitbucket, or any API-only integration | The shell stays closed; the app's `VcsRead` tool reads (issue, comments, MR, threads, changes, CI) |

The lists are strict regular expressions (one command, no `;`, `&&` or pipes beyond
`| head`, no `..`): `GLAB_READ` and `GH_READ` in `src/main/vcs/readPolicy.ts`, tested in
`test/shell-allowlist.test.ts` and `test/vcs-read-policy.test.ts`. Who reads is decided by
`readPolicyFor`: an integration with a CLI reads through the CLI, an API-only one through the
app's `VcsRead` tool, and one that is off or unusable gets no read at all. Every agent of a run
reads the host only through the policy of the workspace's **primary** integration (never the
host CLI or the tracker MCP, which stay for the ceremonies), and only the workspace's projects.
A workspace that names no project gives its agents no host read.

## Testing an integration

`probeVcs(integration)` in `src/main/vcs/index.ts` is what the wizard's "Test" button calls:
it checks the credential, says who you are, reads the token's permissions, shows a sample of
issues and MRs, the rate limit and what is missing to write. The `vcs:probe` channel also
accepts a token typed but not yet stored (desktop only). Every call has a timeout (30 s on the
API, 60 s on the CLI); a read retries on network failure, timeout and 502/503/504; a write is
never retried.

## What was verified

GitHub and Bitbucket were tested against fake servers modelled on their documentation, never a
real account. Writes to any real host have not run; reads on GitLab are the only real-world
use so far. The full list of what was not verified is in `docs/vcs-providers.md`. Say so
honestly when documenting a provider: this project would rather admit a test against a fake
than let a reader assume otherwise.
