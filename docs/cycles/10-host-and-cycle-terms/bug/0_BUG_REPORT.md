# #10 Buttons and texts name GitLab and "MR" on other code hosts — bug report

Issue: https://github.com/exatasmente/coxia/issues/10

## The report

The maintainer, verbatim (pt-BR):

> quando a integração não é gitlab o nome gitlab continua aparecendo nos botões e textos, isso deve acontecer com outras coisas também que agora vem de configurações

In English: when the integration is not GitLab, the name "GitLab" still shows on buttons and texts, and the same probably happens with other things that now come from configuration.

The second half is the important one. Before the configuration work, the app had one host (GitLab), one process (spec-driven, with gates and QA) and one set of tools, so its texts could name them. Those facts now come from the workspace configuration (`vcs[]`, `devCycle`, `externalTools`, the engine of each role), but a large part of the texts still says the old fact.

## What a person sees

Setup for both cases: a fresh data folder (`CERIMONIAS_DATA_DIR`, `CERIMONIAS_SPECS_DIR` pointing at empty folders), the wizard finished with one integration and any cycle template, no card source command.

### A GitHub workspace

| Where | What it says | What it should say |
|---|---|---|
| Today, every activity row (opened) | a button labelled **GitLab** | the host name (GitHub), or no button when there is nothing to propose |
| Today, top action | "Atualizar do GitLab" / "Refresh from GitLab" | the host (or the card source tool, when one is configured) |
| Today, footer | "... from the GitLab card, the spec and the playbook" | the host; "spec" and "playbook" only when the cycle has them |
| Today, activity detail | the label **MRs**, a "2 MRs" / "no MR" badge, and refs such as `app!7` | "PRs", "2 PRs", `app#7` |
| Quick actions screen (the button above) | kicker "GitLab · proposals", "Reading GitLab…", "Merge requests · 2", "MR of someone else: read-only", an "Issue status · no status" block with a note about GraphQL | "GitHub · proposals", "Pull requests · 2"; no issue status block (GitHub issues have none) |
| Discussions screen | "Reading the discussions on GitLab…", "sent to GitLab", "no MR" | GitHub, "no PR" |
| Help screen | "Writing to GitLab", "QA return, Discussions, GitLab", "reading the spec, GitLab and playbook" | GitHub; ceremonies the cycle does not have are not listed |
| Settings, agent tools | two switches: **GitLab through MCP** and **GitLab through glab** (the second one actually controls `gh`) | one switch for reading the configured host (`gh`); the tracker MCP switch only when an MCP server is configured |
| Settings, web access / test workspace | "Approve release and GitLab actions", "no writes to GitLab" | GitHub |
| Radar, Retro intro | "nothing is commented on or changed in GitLab", "GitLab changes from the last 7 days", "your open MRs" | GitHub, PRs, and the retro window the cycle sets |
| Call, notifications, minutes | "Review of MR app!7", "MR in conflict with main", effects checked as `!7` | "Review of PR app#7", "PR in conflict with main", `#7` |
| What the agents are told (prompts) | the card refs as `app!7`; "MR by repository and number ('MR 45 of web')" as the way to say a number aloud; the effect kinds `mr_*` described as "the MR ...", "a pipeline of the MR ran"; "the MR wrote" in the conflict prompt; a shell denial that suggests `glab api ...` when the CLI is not the active read path | PR, `#7`, the host's CI word, and the read path of the active integration |

### A Bitbucket workspace

Everything above, plus:

- **Settings** still labels the agent read switch "GitLab through glab" although Bitbucket has no CLI: there the switch governs the `VcsRead` tool.
- The Quick actions screen offers the same layout although Bitbucket has no labels or manual jobs, and its status is the issue state.
- When an agent runs a shell command that is not allowed, the refusal tells it to use `glab` commands (`src/main/agents.ts:262`), which do not exist for Bitbucket.

### Other things that now come from configuration

- **Ceremony name.** The cycle names the daily ceremony ("pre-daily", "daily scrum", "standup"). Today's header follows it; the call title, the minutes title, the history entries, the help screen, the Settings reminder and the wizard still say "Pre-daily" (26 texts).
- **Cycle structure.** The Help screen lists Gate, QA hand-off and Retro for a cycle that has none of them; generic texts say "spec", "Plan", "playbook", "QA" for a Kanban or Minimal cycle.
- **Retro.** The retro window is a cycle parameter (7 days, 14 for Scrum), but the screens say "weekly" and "last 7 days", and the notification says "Weekly retro".
- **Where the summary goes.** `summaryTarget` says where the team summary is pasted; the screens say "the team chat".
- **Tools.** "Continue in Claude Code" is offered for sessions of any engine, although only Claude SDK sessions can be resumed there (the open engine keeps its sessions under `open-sessions/`, which `claude --resume` does not read; from reading the code, not run).

## Expected behavior

1. A text that names the code host names the **configured** one (GitHub, Bitbucket, GitLab), and one that has no integration to name says "the code host".
2. The noun for a change request follows the host: "MR" and "merge request" for GitLab, "PR" and "pull request" for GitHub and Bitbucket. Refs follow it too: `app!7` on GitLab, `app#7` elsewhere.
3. A feature the configured host does not have is **hidden**, not renamed: work item status transitions and manual CI jobs (GitLab), the CLI switch where there is no CLI, the tracker MCP switch where no server is configured.
4. A text that names a step, a document or a tool of the cycle (the daily ceremony, gate, QA, spec, plan, retro window, summary target) follows the cycle configuration, or is not shown when the cycle does not have the step.
5. On a GitLab workspace with the SDD template and its default parameters nothing changes, in the interface or in the prompts: the prompts the migrated profile gets stay byte for byte as they are (`test/golden/*`) and every catalog text reads as it did on `main`, except the pt-BR masculine normalisation ("o MR" where a few texts said "a MR"). Neutral or configuration-driven wording appears only when the host, the cycle template or its parameters differ.

## Scope

The inventory is in [`1_INVESTIGATION.md`](1_INVESTIGATION.md). In numbers (catalog keys, each counted once for the pair of languages; a key can belong to more than one family):

- 33 keys name GitLab where the configured host should be named, 77 say "MR" or "merge request" where the noun depends on the host, 15 of them also write the ref as `!7`.
- 34 keys belong to features that exist only on GitLab and should be hidden elsewhere.
- 56 keys name the daily ceremony (26), a cycle document or step (25) or the retro window (5) with a fixed word; 10 more name the summary target or the retro window.
- 24 spots in code build or hard-code the text outside the catalogs (the `GitLab` button and `MRs` label in `TodayParts.tsx`, the `'MR'` fallback in `actions.ts`, the ref in six places, the shell denial hint, the Settings and Help lists, ...); 19 of them need a change.

Out of scope: adding a host, changing what a provider can do, redesigning the Quick actions screen, and changing the text of the SDD template for a GitLab workspace. The "Resolve conflict" button not showing for cards built from a provider (a pt-BR sentence matched by `MR_CONFLICT`) was a separate defect that came up in the investigation; #20 fixed it.

## How to reproduce

1. Start the app against empty data folders and finish the wizard with a GitHub integration (a token is not needed to see the texts; the cards will be empty, so use the "Test" workspace flag and a card source fixture, or open Settings, Help and the Quick actions route directly).
2. Open Settings, Help and Today: the texts above are on screen without any card.
3. For the card-dependent texts (the button, the refs, the MR label) use a fake host: `test/helpers/fakeHost.ts` and `test/helpers/vcs.ts` are how the suite does it, and the proposed leak test in the investigation renders the catalogs for a GitHub and a Bitbucket workspace and fails on every one of the lines above.
