# #10 Buttons and texts name GitLab and "MR" on other code hosts — test plan

Issue: https://github.com/exatasmente/coxia/issues/10 · [Plan](bug/2_PLAN.md)

How a person checks the fix in the app, with one GitHub workspace and one Bitbucket one. The automated tests prove the texts and the predicates against fakes; nothing here was run against a real GitHub or Bitbucket account, a real model or a display, so this is the part that is **not verified yet**.

## Setup

1. Work on a throwaway copy of the data: close an installed Coxia, then start the development app with `CERIMONIAS_DATA_DIR` and `CERIMONIAS_SPECS_DIR` pointing at two empty folders.
2. Create two workspaces, each through the setup wizard: one with a **GitHub** integration (a fine-grained token with read access is enough, or the `gh` CLI logged in) and one with a **Bitbucket** integration (an app password). For each, pick the generic cycle template ("SDD, gates and QA") the first time and "Kanban" the second.
3. Switch the app between pt-BR and English in Settings and repeat the checks that mention a word.

## 1. GitHub workspace, SDD cycle

| Where | Expect |
|---|---|
| Today, top action | "Refresh from GitHub" (pt-BR: "Atualizar do GitHub") |
| Today, footer | "... from the GitHub card, the spec and the playbook" |
| An opened activity with a pull request | the label **PRs**, a "1 PR" badge, refs written `app#7`; a button named **GitHub** |
| An opened activity with no pull request | no GitHub button |
| The GitHub button (Quick actions) | kicker "GitHub · proposals", "Reading GitHub...", "Pull requests · 1", reviewer proposals; **no** "Issue status" block, no manual job buttons, no "replaces the current reviewers" note |
| Card of a pull request with failing CI | the blocker reads "Checks failed", not "Pipeline falhou"/"pipeline" |
| Discussions | "Reading the discussions on GitHub...", "no PR" |
| Settings, agent tools | **GitHub through gh** (and its hint naming `gh`), no tracker MCP switch |
| Settings, web access | "Approve release actions and writes to GitHub, push included" |
| Help | every ceremony of the cycle listed, with "GitHub" where the host is named |
| Radar | "your open PRs", "nothing is commented on or changed in GitHub" |
| Read aloud (voice on) | "web#202" is said "web, 202" (it may be an issue: a "#" host writes both alike) and a bare "#101" is said "101"; on GitLab "web!202" is still said "web, MR 202" |

The words **GitLab**, **MR**, **merge request** and **glab** must not appear anywhere on these screens, in either language.

## 2. Bitbucket workspace, Kanban cycle

Everything in section 1 with "Bitbucket" and "PR", except:

- Settings, agent tools: **Bitbucket through the app tool** (there is no CLI), and its hint says the `VcsRead` tool.
- Kanban has no gate, QA hand-off or return from testing: the Help screen does not list them, Today has no Gate or QA button, and the retro says "Last 14 days" if the Scrum template is applied instead (try it with Scrum to see the window follow the cycle).
- Retro screen intro: the neutral wording (no IMPROVEMENTS.md, no gate quizzes).
- When the issue tracker is on and an issue and a pull request share a number, the card list shows two entries, the pull request with its full path (`workspace/app#7`).

## 3. The cycle's own words

1. In Settings or `config.json`, set the daily ceremony's label to something of your own ("morning sync"), a summary target ("the #team channel") and the retro window to 10 days.
2. Today, the call title, the minutes title, the history entries, the Help screen, the Settings reminder and the tray say "morning sync"; the minutes screen says "For the #team channel"; "You paste it into the #team channel; nothing is published from here"; the retro says "Last 10 days".

## 4. "Continue in Claude Code"

1. With every role on the Claude engine: the button and the copy icon appear on the call, deep, gate, QA, re-entry, retro and history screens.
2. Point the deep role at an OpenAI-compatible provider (a local server is enough): after a deep session the button is gone for it and still there for a turn; point the reply role there as well and it is gone for turns too.

## 5. The agents

1. With a GitHub workspace, ask a ceremony agent (any real model, your own key) something that needs a refused command (`ls`): the refusal it gets names `gh api ...`, never `glab`. On Bitbucket it names the `VcsRead` tool. With the read switch off it names no command.
2. On the open engine, the model's tool list describes the Bash tool with the commands of the active host only (visible in the provider's request log).

## 6. A GitLab workspace does not change

1. Start from the SDD template with a GitLab integration: every text reads as before ("MR", `app!7`, "pipeline", "GitLab"); the issue status block of Quick actions shows when `devCycle.quickTransitions` has entries.
2. The six prompt goldens pass without `UPDATE_GOLDEN` (`npx vitest run test/cycle-parity*.test.ts test/same-day*.test.ts`).

## What the tests already cover

`test/terms.test.ts` (the table, the variants, the view), `test/host-terms-leak.test.ts` (every catalog key and prompt on GitHub and Bitbucket, both languages, voice on and off; the words of the SDD cycle in a cycle of its own), `test/cr-ref.test.ts` and `test/vcs-cards.test.ts` (refs and cards), `test/host-view.test.ts` (what is hidden), `test/vcs-read-policy.test.ts` and `test/engine-open-tools.test.ts` (the agent side), `test/glossary.test.ts` (spoken refs).

## Not verified

- No screen was opened: layout of the longer texts (the Settings labels with a custom CLI name, the Quick actions kicker) was not looked at.
- No real GitHub or Bitbucket account, token, `gh` CLI or model was used.
- The open engine's tool description was checked as text, not against a provider's request log.
- pt-BR wording with a custom ceremony label keeps the article of the default ("da morning sync"): the gender of a free label is not known.
