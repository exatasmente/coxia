# #10 Buttons and texts name GitLab and "MR" on other code hosts — plan

Issue: https://github.com/exatasmente/coxia/issues/10 · [Bug report](0_BUG_REPORT.md) · [Investigation](1_INVESTIGATION.md)

The investigation is the source of truth for the inventory, the root cause and the shape of the fix; this plan says how it is built, in what order, how it is proven and what was decided where it left a question open.

## Goal

A text that names the code host names the configured one; the noun for a change request, its ref and the CI word follow the host; a feature the host does not have is hidden, not renamed; a text that names a step, a document or a tool of the cycle follows the cycle configuration. A GitLab workspace on the SDD template with its default parameters sees exactly the text it saw before, in the interface and in what the agents are told (the six prompt goldens stay as they are, untouched, and `test/gitlab-catalogs-unchanged.test.ts` compares every catalog key with the catalogs of `main`); the one difference is the pt-BR masculine normalisation ("o MR", decision 3). Neutral or configuration-driven wording appears only when the host, the cycle template or its parameters differ.

## Mechanism

### 1. One terms table, filled in one place

- `src/shared/i18n/terms.ts` (pure): the host words per kind and language, and `defaultTerms(language)` (the "no integration" values).
- `src/shared/cycles/terms.ts` (pure): `termsFor(config, language)` builds the whole set from `vcs[]` / `projects.issues.vcsId` (kind), `devCycle` (ceremony label, retro window, summary target), the CLI of the host (`agents.tools.vcsCli`, `vcsCliFor` rules) and the tracker MCP server. It returns the values plus the kind and the cycle variants (`flags`), which select key variants.
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
| `{trackerMcp}` | the configured tracker MCP server, else `gitlab-issue-analysis` | the configured server, else empty | same | `gitlab-issue-analysis` |

Two more were needed while rewording: `{CrLongs}` ("Merge requests", for a heading) and `{anCr}` ("an MR" / "a PR" in English, the bare noun in Portuguese: the English article depends on the sound of the noun, and the sdd English golden says "an MR"), and `{ci}` ("pipeline", "checks" on GitHub) for a word in a list.

### 2. Variants for sentences, not words

A sentence whose content changes with the host gets a key variant `<key>.on-<kind>` (same idea as `.novoice`; the plain `.<kind>` would collide with keys such as `wizard.vcs.scopes.gitlab`): lookup order `key + voice + variants`, `key + voice`, `key + variants`, `key`, where the variants in force are the host's `.on-<kind>` and then the cycle's. Used for the CI word (decision 2: GitHub says "checks", GitLab and Bitbucket say "pipeline") and for the few sentences whose structure differs on a host (the CLI hint of Settings, the effects classifier prompt, the retro digest field name). GitLab text is the plain key, so it stays as it is.

The cycle has the same mechanism (decision 17): a text that is only true of the SDD template with its default parameters ("Plan", "playbook", "weekly", "the team daily") keeps that wording in the plain key, and a variant says what the cycle that differs reads: `.off-sdd` (another template), `.own-ceremony` (the daily has a name of its own), `.own-target` (the summary has a target of its own), `.own-retro` (a window other than a week). `Terms.flags` holds the ones in force (`cycleVariants()` in `src/shared/cycles/terms.ts`); the host's variant wins, then the first of that list. Documented in `docs/i18n.md`.

### 3. How the renderer gets the terms

`buildCycleView()` adds `terms` (the table for the workspace's language and its kind) and `host` (what the host can do, see 5) to `CycleView`. `cycleApi.ts` applies `view.terms` with `setTerms()` when the view loads and on the existing `cycle` and `config` events: no new channel, and `cycle:view` is already open to the web client. First paint uses `defaultTerms(language)`, never a raw `{cr}`, or the cached terms of this workspace: the cache (`src/shared/i18n/termsCache.ts`) is keyed by the workspace id (`view.workspaceId`) and the language it was built for, is used only once `workspace:list` says which workspace runs and only if nothing has set the terms yet, is ignored when its shape is not a `Terms`, and a `cycle:view` that fails to load puts the defaults back (decision 18). The main process calls `setTerms(termsFor(config, language))` in `workspaceConfig.ts` next to `setLanguage()` and `setVoiceEnabled()`, in both `load()` and `saveConfig()`.

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

New: `src/shared/i18n/terms.ts`, `src/shared/cycles/terms.ts`, `src/shared/i18n/termsCache.ts`, `test/terms.test.ts`, `test/terms-cache.test.ts`, `test/host-terms-leak.test.ts`, `test/gitlab-catalogs-unchanged.test.ts` (with `test/fixtures/catalogs-main/`, the catalogs of `main` before this issue), `test/host-view.test.ts`, `test/cr-ref.test.ts`.

Changed (by commit below): `src/shared/i18n/index.ts`, `src/shared/cycles/text.ts`, `src/shared/cycles/view.ts`, `src/main/workspaceConfig.ts`, `src/main/cycle.ts`, `src/renderer/src/cycleApi.ts`, the catalogs (`src/shared/i18n/*.json`), `src/shared/vcs.ts`, `src/main/vcs/{cards,probe,readPolicy}.ts`, `src/main/{gitlabQuick,actions,radar,efeitos,agents,retro}.ts`, `src/main/engine/open/tools/bash.ts`, `src/shared/glossary.ts`, `src/renderer/src/screens/{Today,TodayParts,QuickActions,Settings,Ajuda,ContinueInClaude,Deep,...}.tsx`, `src/shared/config/settingsView.ts`, and the docs (`docs/cycles.md`, `docs/i18n.md`, `docs/vcs-providers.md`) and `CHANGELOG.md`.

## Commit order

One logical change per commit, tests in the same commit.

1. **Terms.** `terms.ts` (both), `setTerms`, central fill, `CycleView.terms` and `host`, wiring in `workspaceConfig.ts` and `cycleApi.ts`; `test/terms.test.ts`. (The leak test was written first to drive the work, and committed after the rewording with a short allow-list instead of one that shrinks.)
2. **Host name and change-request noun in the catalogs** (families a and b): `{vcsName}`, `{cr}`, `{crs}`, `{crLong}`, `{crMark}`, the CI variants, the pt-BR gender normalisation, the Today button and `MRs` label, the refresh button and footer, the glossary's spoken ref, the `'MR'` fallback in `actions.ts`.
3. **Refs.** `crRef`, the parsers, `{crMark}` in the effects text; `test/cr-ref.test.ts`, a GitHub case in `test/vcs-cards.test.ts`.
4. **Hide.** `host` predicates and their use: Quick actions issue-status block, Settings tool switches, "Continue in Claude Code", `quickTransitions` documented as GitLab-only; the agent-side leaks of 7 with a `vcs-read-policy` test; `test/host-view.test.ts`.
5. **Cycle words** (families e and f): `{ceremony}` in the screens, the Help list from `cycle.ceremonies`, neutral generic strings, the retro window, the summary target, `ui.retro.improvements.hint` outside the sdd template, the retro digest field name.
6. **Docs and changelog**: the standard placeholders in `docs/cycles.md` and rule 3 of `docs/i18n.md`, what each host shows in `docs/vcs-providers.md`, and a `### Fixed` line under `## [Unreleased]`.
7. **Leak test** (`test/host-terms-leak.test.ts`) and, last, the **test plan** (`3_TEST_PLAN.md`): how a person verifies with a GitHub and a Bitbucket workspace.

## Test plan

No test reaches a model, a host or the network; fakes are in `test/helpers/`.

1. **Leak test** (`test/host-terms-leak.test.ts`): for `github` and `bitbucket` x `pt-BR` and `en` x voice on and off, set the terms, render every catalog key (and each `.novoice` and kind variant) and every prompt id through `renderPrompt` with `baseParams()`, and fail on `GitLab`, `glab`, `MR`/`MRs`, `merge request`, `work item` and `!` refs. A short documented allow-list of keys that must name another host (the wizard's kind labels, `prompt.sdd.vcs.*`, the GraphQL validator messages, the GitHub flow template, enumerations of all three hosts); the test also fails when an entry no longer exists, so the list cannot rot. The same render for `gitlab` asserts it does not leak GitHub's words.
2. **GitLab is unchanged:** the six goldens (`legacy-prompts*`, `same-day-prompts*`, `en-prompts*`) pass without `UPDATE_GOLDEN`, and `test/gitlab-catalogs-unchanged.test.ts` renders every key of the catalogs of `main` (snapshot in `test/fixtures/catalogs-main`, merged in the order of `CATALOGS`) for a GitLab workspace on the SDD template with its default parameters, in both languages, voice on and off, and fails on any difference outside an explicit list of ten pt-BR keys whose only change is the masculine normalisation (each with the exact replacement). Keys renamed because they were about GitLab alone are mapped to their new name in the test.
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
- The "Resolve conflict" button for cards built from a provider (decision 7): it was a separate defect (a pt-BR sentence matched by `MR_CONFLICT` in `src/renderer/src/dashboard.ts`) and #20 fixed it, with a structured `mrConflicts` list on the card. Nothing to do here; `test/resolve-conflict-button.test.ts` runs it on GitHub (`app#7`) and GitLab (`app!7`).
- New label configuration for Gate, Unblock, QA hand-off and Retro (decision 6): only the daily ceremony has a configurable name.

## Decision log

Defaults taken for the open questions of the investigation; the maintainer may revert any of them.

1. **No integration and no card source: "MR".** The neutral default is the app's historic noun, so GitLab-like and no-integration goldens stay byte for byte.
2. **CI word per kind.** GitLab "pipeline", GitHub "checks", Bitbucket "pipeline", through `.<kind>` key variants only where the sentence differs.
3. **pt-BR is masculine everywhere** ("o MR", "o PR"); the UI strings that said "a MR" are normalised. No prompt changes from this.
4. **"Continue in Claude Code" is hidden** for sessions of the open engine, which `claude --resume` cannot read (from reading the code, not run).
5. **Issue tracker and code on different hosts: out of scope**, noted above.
6. **No new label config** for gate, unblock, QA hand-off and retro; the screens stop hard-coding "weekly" and "7 days" and use the cycle's params.
7. **`MR_CONFLICT` was not in this issue**, and #20 has since fixed it (a structured `mrConflicts` list on the card, with a test for GitHub and GitLab). Nothing left to note here.
8. **`ui.retro.improvements.hint` is neutralised** outside the sdd template.
9. **"Paste it into the team chat" texts** show the configured `summaryTarget` when set, and the generic wording otherwise.
10. **Agent-facing host leaks are in scope:** the shell refusal in `agents.ts` and the open engine's Bash tool description follow the active read path.
11. **Terms follow the process language.** `fill()` ignores a language argument that differs from the process's: every caller passes the workspace language today.
12. **Kind variants are `.on-<kind>`**, not `.<kind>`: a key that merely ends in a host's name (`wizard.vcs.scopes.gitlab`) is its own key.
13. **`cycle.decisionLog.ref` ("o {heading} do Plan") and the retro digest field `mudancas_gitlab` keep their GitLab text:** both are in the legacy and English prompt goldens, so changing them would change what a GitLab workspace tells its agents. The digest field has `.on-github` and `.on-bitbucket` variants (`mudancas_no_host` / `host_changes`), so the agent of another host never reads a field named after GitLab. Renaming the GitLab one is a follow-up that regenerates those goldens on purpose.
14. **The pt-BR articles around `{ceremony}` stay as written** ("da {ceremony}", "na {ceremony}"): the prompts already read that way and the gender of a free label is unknown.
15. **Parity of placeholders between the catalogs** now compares the set of names without case or count (`{Ceremony}` in English where Portuguese has `{ceremony}`, two `{cr}` where the other language has one).
16. **Where the tracker has separate numbering (Bitbucket)** a pull request whose short ref equals an issue's gets its full project path as ref, instead of colliding.

### Second round (code review: a GitLab workspace on SDD must read what it read)

The maintainer's rule: a GitLab workspace on the SDD template with default parameters sees exactly the UI text and the agent prompts of `main`, except the pt-BR masculine normalisation; neutral or config-driven wording appears only when the host, the cycle template or its parameters differ.

17. **Cycle variants beside the host ones.** The plain key is the wording of the SDD template with its default parameters; `.off-sdd`, `.own-ceremony`, `.own-target` and `.own-retro` hold what a cycle that differs reads (see Mechanism 2). 31 keys have them (the "Retro da semana" family and its notification, the "daily do time" / team chat family, "Plan" / "playbook" / "spec", the ceremonies list). `{trackerMcp}` is the one new standard placeholder: the hint of the tracker MCP switch names the configured server, and while none is configured it keeps the name `main` hard-coded, on GitLab and with no integration (on GitHub and Bitbucket the switch is hidden without a server; on GitLab it stays, as on main).
18. **Terms cache.** Keyed by workspace id and language, validated by shape, applied only after the running workspace is known and while no view has answered, replaced by the defaults when the first `cycle:view` fails. First paint on a GitLab/SDD workspace never flashes: the defaults are its words.
19. **Hide, but only what is absent.** `issueStatus` is GitLab's capability, true whether or not the cycle has rules for moving the status, so the issue status block and the host button of a GitLab card stay as before; only the list of transitions waits for `quickTransitions` (`showTransitions`). The host button shows for a GitLab card with no change request, as before, and for another host only with a change request.
20. **Spoken refs.** A host that marks a change request with `#` writes an issue the same way, so the voice reads `app#12` as "app, 12" and says "PR" only for a ref known to be one (`RefWords.known`); GitLab's `!N` still reads "MR N".
21. **English texts that never named the host stay neutral.** `main.saude.task.gitlab-quick` read "Quick code host actions" on `main`, and a GitLab workspace keeps reading it; the two parity tests list it. The classifier prompt keeps "work item status change" on the plain key (GitLab), with `.on-github` and `.on-bitbucket` variants.
22. **What the "pipeline" word is allowed to name on GitHub.** The leak test now flags it; the QA "pipelines" comment of the release flow, the manual-job texts and the `agent-pipeline` skill name are allowed, each with its reason.
