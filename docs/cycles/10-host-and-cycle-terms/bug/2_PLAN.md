# #10 Buttons and texts name GitLab and "MR" on other code hosts — plan

Issue: https://github.com/exatasmente/coxia/issues/10 · [Bug report](0_BUG_REPORT.md) · [Investigation](1_INVESTIGATION.md)

The investigation is the source of truth for the inventory, the root cause and the shape of the fix; this plan says how it is built, in what order, how it is proven and what was decided where it left a question open.

## Goal

A text that names the code host names the configured one; the noun for a change request, its ref and the CI word follow the host; a feature the host does not have is hidden, not renamed; a text that names a step, a document or a tool of the cycle follows the cycle configuration. On a GitLab workspace with the SDD template nothing changes for the agents: the six prompt goldens stay as they are, untouched.

## Mechanism

### 1. One terms table, filled in one place

- `src/shared/i18n/terms.ts` (pure): the host words per kind and language, and `defaultTerms(language)` (the "no integration" values).
- `src/shared/cycles/terms.ts` (pure): `termsFor(config, language)` builds the whole set from `vcs[]` / `projects.issues.vcsId` (kind), `devCycle` (ceremony label, retro window, summary target) and the CLI of the host (`agents.tools.vcsCli`, `vcsCliFor` rules). It returns the values plus the kind, which selects key variants.
- `src/shared/i18n/index.ts`: the process holds the terms next to the language and the voice mode. `setTerms()` rebuilds like `setLanguage()`, notifies the `useT()` subscribers and is part of `i18nSnapshot()`. `format()` (the one place that fills `{name}`) takes a placeholder from the call's `params` first and from the terms second; an unknown placeholder stays visible. `fill()` in `src/shared/cycles/text.ts` (a duplicate of `format()` today) calls it, so `t()`, `tv()`, `cycleText()`, `renderLines()` and the prompt render all fill the standard placeholders without any call site changing.

Standard placeholders (names chosen so none collides with `{mr}` = a ref, `{host}` = an address, `{vcs}`, `{ref}` that exist in the catalogs):

| Placeholder | GitLab | GitHub | Bitbucket | No integration |
|---|---|---|---|---|
| `{vcsName}` | GitLab | GitHub | Bitbucket | the code host / o host de código |
| `{cr}` / `{crs}` | MR / MRs | PR / PRs | PR / PRs | MR / MRs |
| `{crLong}` / `{crLongs}` | merge request(s) | pull request(s) | pull request(s) | merge request(s) |
| `{crMark}` | `!` | `#` | `#` | `!` |
| `{ceremony}` / `{Ceremony}` | label of the daily ceremony, and its capitalised form | same | same | pré-daily / pre-daily |
| `{summaryTarget}` | `summaryTarget` when set, else the team chat | same | same | same |
| `{retroDays}` | `retro.windowDays` | same | same | 7 |
| `{cli}` | glab | gh | the VcsRead tool | empty |

### 2. Kind variants for sentences, not words

A sentence whose content changes with the host gets a key variant `<key>.<kind>` (same idea as `.novoice`): lookup order `key + voice + kind`, `key + voice`, `key + kind`, `key`. Used for the CI word only (decision 2): GitHub says "checks", GitLab and Bitbucket say "pipeline". GitLab text is the plain key, so it stays as it is.

### 3. How the renderer gets the terms

`buildCycleView()` adds `terms` (the table for the workspace's language and its kind) and `host` (what the host can do, see 5) to `CycleView`. `cycleApi.ts` applies `view.terms` with `setTerms()` when the view loads and on the existing `cycle` and `config` events: no new channel, and `cycle:view` is already open to the web client. First paint uses `defaultTerms(language)`, never a raw `{cr}`. The main process calls `setTerms(termsFor(config, language))` in `workspaceConfig.ts` next to `setLanguage()` and `setVoiceEnabled()`, in both `load()` and `saveConfig()`.

### 4. Refs

`crRef(kind, project, iid)` in `src/shared/vcs.ts` (pure): `short(project) + '!' + iid` on GitLab and with `#` elsewhere. It replaces the six places that build the ref by hand (`cards.ts`, `gitlabQuick.ts` x2, `actions.ts`, `radar.ts`, `probe.ts`) and `efeitos.ts` takes the marker from `{crMark}`. The parsers that read an MR ref from text (`conflictFromMr.ts`, `actions.ts`, `Deep.tsx`) accept both marks. No migration of state keyed by the old ref: the first status check after the update may show no change for that day.

### 5. Hide, from a `host` block of the view

`CycleView.host = { kind, name, issueStatus, manualJobs, draftToggle, quickTransitions, cli, trackerMcp, engines }`, built from `VcsCaps`, `devCycle.quickTransitions`, `vcsCliFor()`, `agents.tools.trackerMcpServer` and the role's engine. Pure predicates in `src/shared/cycles/view.ts`, so they are tested without a DOM: `showQuickActions`, `showIssueStatus`, `visibleTools`, `showContinueInClaude`, `ceremoniesListed`. The screens call them and keep no host `if` of their own.

### 6. Reword rather than parameterise

Generic strings that say "spec", "Plan", "playbook", "gate", "QA", "weekly", "7 days" or "the team chat" for every cycle become neutral phrasing, take `{ceremony}`, `{retroDays}`, `{summaryTarget}`, or are shown only when the cycle has the thing.

### 7. Agent-facing leaks (in scope, from the investigation)

- `src/main/agents.ts` shell refusal: for a host with no CLI (Bitbucket, API-only integrations) and for no integration it names `glab`. The refusal follows the active read path (`policy.usage`), and says nothing about a CLI when there is no integration.
- `src/main/engine/open/tools/bash.ts`: the Bash tool description lists `glab` and `gh` whatever the integration. It follows the active read policy.

## Files

New: `src/shared/i18n/terms.ts`, `src/shared/cycles/terms.ts`, `test/terms.test.ts`, `test/host-terms-leak.test.ts`, `test/host-view.test.ts`, `test/cr-ref.test.ts`.

Changed (by commit below): `src/shared/i18n/index.ts`, `src/shared/cycles/text.ts`, `src/shared/cycles/view.ts`, `src/main/workspaceConfig.ts`, `src/main/cycle.ts`, `src/renderer/src/cycleApi.ts`, the catalogs (`src/shared/i18n/*.json`), `src/shared/vcs.ts`, `src/main/vcs/{cards,probe,readPolicy}.ts`, `src/main/{gitlabQuick,actions,radar,efeitos,agents,retro}.ts`, `src/main/engine/open/tools/bash.ts`, `src/shared/glossary.ts`, `src/renderer/src/screens/{Today,TodayParts,QuickActions,Settings,Ajuda,ContinueInClaude,Deep,...}.tsx`, `src/shared/config/settingsView.ts`, and the docs (`docs/cycles.md`, `docs/i18n.md`, `docs/vcs-providers.md`) and `CHANGELOG.md`.

## Commit order

One logical change per commit, tests in the same commit.

1. **Terms.** `terms.ts` (both), `setTerms`, central fill, `CycleView.terms` and `host`, wiring in `workspaceConfig.ts` and `cycleApi.ts`; `test/terms.test.ts`; the leak test, with an allow-list that holds every current offender so it starts green and each later commit shrinks it.
2. **Host name and change-request noun in the catalogs** (families a and b): `{vcsName}`, `{cr}`, `{crs}`, `{crLong}`, `{crMark}`, the CI variants, the pt-BR gender normalisation, the Today button and `MRs` label, the refresh button and footer, the glossary's spoken ref, the `'MR'` fallback in `actions.ts`.
3. **Refs.** `crRef`, the parsers, `{crMark}` in the effects text; `test/cr-ref.test.ts`, a GitHub case in `test/vcs-cards.test.ts`.
4. **Hide.** `host` predicates and their use: Quick actions issue-status block, Settings tool switches, "Continue in Claude Code", `quickTransitions` documented as GitLab-only; the agent-side leaks of 7 with a `vcs-read-policy` test; `test/host-view.test.ts`.
5. **Cycle words** (families e and f): `{ceremony}` in the screens, the Help list from `cycle.ceremonies`, neutral generic strings, the retro window, the summary target, `ui.retro.improvements.hint` outside the sdd template, the retro digest field name.
6. **Docs and changelog**: the standard placeholders in `docs/cycles.md` and rule 3 of `docs/i18n.md`, what each host shows in `docs/vcs-providers.md`, and a `### Fixed` line under `## [Unreleased]`.
7. **Test plan** (`3_TEST_PLAN.md`): how a person verifies with a GitHub and a Bitbucket workspace.

## Test plan

No test reaches a model, a host or the network; fakes are in `test/helpers/`.

1. **Leak test** (`test/host-terms-leak.test.ts`): for `github` and `bitbucket` x `pt-BR` and `en` x voice on and off, set the terms, render every catalog key (and each `.novoice` and kind variant) and every prompt id through `renderPrompt` with `baseParams()`, and fail on `GitLab`, `glab`, `MR`/`MRs`, `merge request`, `work item` and `!` refs. A short documented allow-list of keys that must name another host (the wizard's kind labels, `prompt.sdd.vcs.*`, the GraphQL validator messages, the GitHub flow template, enumerations of all three hosts); the test also fails when an entry no longer exists, so the list cannot rot. The same render for `gitlab` asserts it does not leak GitHub's words.
2. **GitLab is unchanged:** the six goldens (`legacy-prompts*`, `same-day-prompts*`, `en-prompts*`) pass without `UPDATE_GOLDEN`, and a test renders the whole catalog with the GitLab terms and compares it with the catalogs of `main` for every key outside a short list of the intended differences (the pt-BR gender normalisation, the neutralised strings).
3. **Terms table** (`test/terms.test.ts`): each kind x language gives the values of the table; no integration gives the defaults; a literal `preDaily.label` flows to `{ceremony}`; `defaultTerms` resolves every standard placeholder.
4. **Refs** (`test/cr-ref.test.ts`, `test/vcs-cards.test.ts`): `crRef` for the three kinds, an issue ref and a PR ref of the same project never equal, both marks parse, a GitHub card has `app#7` in `mrs`, `mrPaths`, blockers and pending.
5. **Hide predicates** (`test/host-view.test.ts`): `buildCycleView` for each kind.
6. **Agent side** (`test/vcs-read-policy.test.ts`, `test/shell-allowlist.test.ts`, `test/engine-open-tools.test.ts`): the shell refusal and the Bash tool description follow the active read path.
7. Whole suite, `tsc`, theme audit (total stays 8), `i18n:lint`, public audit, `electron-vite build`.

Not verifiable here: no screen is opened (no real GitHub or Bitbucket account, and no display); `3_TEST_PLAN.md` says how a person does it.

## Risks

- **Gender in pt-BR.** The catalog mixes "o MR" and "a MR". A placeholder cannot carry an article, so the UI strings that say "a MR" are normalised to masculine (decision 3). No prompt changes.
- **Refs in persisted state.** One day's change baseline and saved history keep the old marker; harmless within a day.
- **First paint.** `defaultTerms` and the cached terms remove the raw placeholder flash.
- **Language switch** changes the ceremony label and the default phrases: terms are rebuilt in both config paths.
- **Prompt classification** (`openersOf`) treats a leading placeholder as any short text; the parity tests in `test/cycle-prompts.test.ts` pin it.
- **Variants multiply keys.** The placeholder test checks that a variant keeps the placeholders of its base.
- **No search and replace.** `mr_*` effect kinds, `mrs`, `mrPaths`, `VcsMr` are identifiers; only text changes.
- **A host's own words stay** where they are true: "Draft" as a GitLab prefix, `STAGE::` labels, the GraphQL messages.

## Out of scope

- An issue tracker on one host and the code on another (decision 5): the cards, the quick actions and the feedback jobs use only the primary integration, so the texts say "issue" and "PR" as if they were the same host. Nothing to drive until that is a feature.
- The `MR_CONFLICT` regex in `src/renderer/src/dashboard.ts` (decision 7): it finds a merge request with conflicts by a pt-BR sentence that only an external card source writes, so the "Resolve conflict" button never shows for cards built from a provider. A separate defect, to be its own issue.
- New label configuration for Gate, Unblock, QA hand-off and Retro (decision 6): only the daily ceremony has a configurable name.

## Decision log

Defaults taken for the open questions of the investigation; the maintainer may revert any of them.

1. **No integration and no card source: "MR".** The neutral default is the app's historic noun, so GitLab-like and no-integration goldens stay byte for byte.
2. **CI word per kind.** GitLab "pipeline", GitHub "checks", Bitbucket "pipeline", through `.<kind>` key variants only where the sentence differs.
3. **pt-BR is masculine everywhere** ("o MR", "o PR"); the UI strings that said "a MR" are normalised. No prompt changes from this.
4. **"Continue in Claude Code" is hidden** for sessions of the open engine, which `claude --resume` cannot read (from reading the code, not run).
5. **Issue tracker and code on different hosts: out of scope**, noted above.
6. **No new label config** for gate, unblock, QA hand-off and retro; the screens stop hard-coding "weekly" and "7 days" and use the cycle's params.
7. **`MR_CONFLICT` is not in this issue.** Left as it is, noted above as a separate defect.
8. **`ui.retro.improvements.hint` is neutralised** outside the sdd template.
9. **"Paste it into the team chat" texts** show the configured `summaryTarget` when set, and the generic wording otherwise.
10. **Agent-facing host leaks are in scope:** the shell refusal in `agents.ts` and the open engine's Bash tool description follow the active read path.
11. **Terms follow the process language.** `fill()` ignores a language argument that differs from the process's: every caller passes the workspace language today.
