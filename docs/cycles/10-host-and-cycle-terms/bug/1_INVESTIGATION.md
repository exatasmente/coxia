# #10 Buttons and texts name GitLab and "MR" on other code hosts — investigation

Issue: https://github.com/exatasmente/coxia/issues/10 · Bug report: [`0_BUG_REPORT.md`](0_BUG_REPORT.md)

Read-only investigation of the code as of this branch (`fix-host-and-cycle-terms`, based on the `main` that carries the priority work of #8). Nothing was changed in source, tests or catalogs, and nothing was run against a model, a host or the network: the evidence is reading the code and the catalogs, plus two counting scripts over the JSON files (their rules are described under [Method](#method)).

## Summary

- **Root cause.** The configuration made the host, the cycle and the tools variable, but the *words* of the interface and of the agent prompts were never given a path to those values. Only the agent side has one, and only partly: `vcsName()` and `ceremonyLabel()` in `src/main/cyclePrompts.ts` feed `{vcsName}` and `{ceremony}` into prompts. The renderer receives no host word at all (`CycleView` carries the ceremony label, the template name, stages and the decision-log heading, nothing about the host), and the main-process catalogs reach the host name only where a caller passes `{ vcs: vcsName() }` by hand (7 keys). Everything else was written when GitLab was the only host and stayed that way: 33 keys name GitLab, 76 say "MR", 15 write the ref as `!{iid}`, and `src/main/vcs/cards.ts:172` builds `app!7` for every provider.
- **Second root cause, for the "hide, do not rename" part.** Features that exist on one host are shown on all of them because the screens never ask what the host can do. The data is there (`VcsCaps` in `src/main/vcs/types.ts:147`, `vcsCliFor()`, `devCycle.quickTransitions`, `agents.tools.trackerMcpServer`, `cycle:view.ceremonies`) but in the renderer only the Today ceremony cards use any of it (`cycle.ceremonies`); the host capabilities are read by main-process code only.
- **Counts** (catalog keys, pt-BR and en counted once; classes (i) wrong, (ii) host-only, (iii) fine):

| Family | (i) wrong | (ii) host-only: hide | (iii) fine | Keys in family |
|---|---|---|---|---|
| a. Host name | 33 | 0 | 27 | 60 |
| b. Change-request noun and refs | 77 | 0 | 15 | 92 |
| c. Host concepts (status, CI, manual job, reviewer, draft) | 11 | 34 | 19 | 64 |
| d. Tools (Claude Code, glab and gh, MCP, card source, release tool) | 5 | 21 | 11 | 37 |
| e. Cycle vocabulary | 56 | 0 | 280 | 336 |
| f. Other things configuration decides | 10 | 0 | 1 | 11 |

  Plus 24 code sites that build or hard-code a text outside the catalogs ([code sites](#code-sites-outside-the-catalogs)). A key that belongs to two families is counted in both; there are 550 distinct keys in the tables.
- **Proposed mechanism.** One set of *standard placeholders* (`{vcsName}`, `{cr}`, `{crs}`, `{crLong}`, `{crLongs}`, `{crMark}`, `{ceremony}`, `{Ceremony}`, `{summaryTarget}`, `{retroDays}`, `{cli}`), filled **centrally** by `t()`/`tv()` (and by the prompt `fill`) from a small *terms* table that the process holds next to the language and the voice mode; the main process sets it where it already calls `setLanguage()` (`workspaceConfig.ts:42,68`), and the renderer receives it inside `cycle:view`, which it already reloads on the `cycle` and `config` events. Sentences whose structure differs by host get a `.<kind>` key variant (same idea as `.novoice`). Features the host lacks are hidden from a `host` block of the same view. Details in [Proposed fix](#proposed-fix).
- **GitLab must not change.** The six prompt goldens (`test/golden/*`) are all produced with a GitLab-like host or with no integration; the mechanism is built so that both keep the exact text they have today. The proof for the other hosts is a leak test, not a new golden.
- **Open questions for the maintainer** are at the end (the neutral noun with no integration, the CI word on GitHub, the gender of "MR" in Portuguese, whether the open engine may keep "Continue in Claude Code", and one defect found on the way).

## Method

- Reads: `CLAUDE.md`, `CONTRIBUTING.md`, `docs/i18n.md`, `docs/cycles.md`, `docs/configuration.md`, `docs/vcs-providers.md`, then `src/main/cyclePrompts.ts`, `src/shared/cycles/*`, `src/shared/i18n/*`, `src/main/vcs/*`, `src/main/gitlabQuick.ts`, `src/main/agents.ts`, `src/main/workspaceConfig.ts`, the renderer screens that showed up in the searches, and `test/golden`, `test/helpers`.
- Catalog scan: every JSON file of `src/shared/i18n/` (core `pt-BR.json`/`en.json`, `main.*`, `minutes.*`, `wizard.*`, the six `ui-*` pairs (`call`, `docs`, `gate`, `settings`, `shell`, `today`)), including `.novoice` variants and `prompt.*` keys, matched against the term families with regular expressions (host names, `MR`/`merge request`/`pull request`/`PR`, `pipeline`/`job`/`manual`/`reviewer`/`draft`/`approv`/`work item`, `Claude Code`/`MCP`/`glab`/`gh`, `pré-daily`/`standup`/`spec`/`Plan`/`gate`/`QA`/`Registro`/`weekly`). Each hit was then classified by hand; the classification is the list in the tables, so it can be argued with key by key.
- A key counts once for the pair of languages. `file:line` is the line of the pt-BR entry in the file named (the en line is the same in the matching `en` file unless a second number is shown). All catalog paths are relative to `src/shared/i18n/`.
- Not done: no screen was opened (no display, and the rule against touching real data), so "reaches" says where the text is used, from the call sites.

## What already exists

| Piece | Where | What it gives |
|---|---|---|
| Host display name | `src/main/cyclePrompts.ts:23` `vcsName()` | "GitLab" / "GitHub" / "Bitbucket" from `rc().primaryVcs.kind`, else `cycle.vcs.fallback` ("o host de código" / "the code host"). Main process only. Not the host's address: a GitHub Enterprise instance is still "GitHub". |
| Prompt placeholders | `cyclePrompts.ts:49` `baseParams()` | `{vcsName}`, `{ceremony}`, `{qaMention}`, `{mode}`, `{heard}`, `{call}`, `{answered}`, `{speechRules}`, `{chatRules}`, `{optionsRule}` and the user terms (`{theUser}`, `{ofUser}`, `{toUser}`, `{he}`...). Used by `prompt()`; `text()` (`:18`) adds only the user terms. |
| Ceremony label | `cyclePrompts.ts:32` `ceremonyLabel()`; `src/shared/cycles/view.ts:40` `preDailyLabel` | "pré-daily" / "daily scrum" / "standup", from `devCycle.ceremonyParams.preDaily.label` (a catalog key or a literal). |
| Text of the cycle | `src/shared/cycles/text.ts:21` `cycleText`, `:16` `voiceText`, `:11` `fill`, `:73` `renderLines`, `:35` `userTerms`, `:58` `joinList` | catalog-key-or-literal resolution, `.novoice` lookup, placeholder filling with "a line that is only an empty placeholder disappears". |
| Prompt lookup | `src/shared/cycles/prompts.ts` `promptTemplate`, `renderPrompt`, `openersOf` | family fallback to `sdd`, per-language overrides, voice-off variants; `openersOf` rebuilds the session classifiers from the catalogs, so a reworded prompt is still recognised. |
| Per-kind read hints | `src/main/vcs/readPolicy.ts:44-102` | `prompt.sdd.vcs.hint.gitlab/github/tool`, `vcs.read.*`, `vcs.changes.*`: the agent's read instructions already follow the integration. The model for "variant per kind". |
| What the host can do | `src/main/vcs/types.ts:147` `VcsCaps` (`issueStatus`, `resolvableThreads`, `manualJobs`, `draftToggle`, `conflictFlag`, `issues`); `GITLAB_CAPS`, `GITHUB_CAPS`, `BITBUCKET_CAPS` | GitLab all true; GitHub `issueStatus:false`, `manualJobs:false`; Bitbucket `manualJobs:false`, `conflictFlag:false`. Read by `gitlabQuick.ts:58,179,280` (manual jobs), `cards.ts:119` and `probe.ts:143` (issues); no renderer code reads it. |
| CLI of the host | `src/main/vcs/index.ts:112` `vcsCliFor()`, `src/main/config-resolve.ts:100` `DEFAULT_CLI` | `glab`, `gh`, none for Bitbucket. |
| Language and voice as process state | `src/shared/i18n/index.ts:76-130` `setLanguage`, `setVoiceEnabled`, `subscribeLanguage`, `i18nSnapshot`; renderer `src/renderer/src/i18n.ts` `useT`, `useTv` | the pattern the new terms table should follow: module state, rebuild, listeners, `useSyncExternalStore`. |
| How the main process sets them | `src/main/workspaceConfig.ts:42-43` (load) and `:68-69` (`saveConfig`) | the two places that already call `setLanguage()` and `setVoiceEnabled()` for every config load and save. |
| How the renderer gets config-derived words | `cycle:view` (`src/main/cycle.ts:21`, `src/shared/cycles/view.ts:31` `buildCycleView`) → `useCycle()` (`src/renderer/src/cycleApi.ts:51`); reloaded on `CYCLE_EVENT` and `CONFIG_EVENT` (`cycleApi.ts:38-41`); language and voice through `api.getSettings()` (`i18n.ts:36`, `App.tsx:100,118`) | `CycleView` has `templateName`, `preDailyLabel`, `stages`, `meanings`, `destination` (heading, note tool), `ceremonies`, `userName`. It has **no host word, no noun, no capabilities, no CLI, no engine**. |
| Placeholders that exist in catalogs already | counted per key in pt-BR: `{vcs}` 7, `{vcsName}` 5, `{ceremony}` 8, `{mode}` 13, `{heard}` 11, `{qaMention}` 2, and **`{mr}` 9, `{host}` 20** | `{mr}` is the *ref* of a merge request ("app!7"), and `{host}` the *address* of a server: neither can be reused for the noun or the host's name. |
| Tests that bind it | `test/i18n.test.ts` (both catalogs, same placeholders), `test/cycle-prompts.test.ts`, `test/cycle-parity*.test.ts`, `test/cycle-parity-en*.test.ts`, `test/vcs-cards.test.ts`, `test/vcs-read-policy.test.ts` | no test renders the catalogs for a host and looks for a leak. |

Two things that look like a solution and are not: `{vcs}` is passed by hand (`main.quick.many` passes `vcs: vcsName()` at `gitlabQuick.ts:302`), so a new call that forgets it prints the raw placeholder; and `cycle.githubFlow.*` is a template whose wording is GitHub's, which is correct for that template, not a host mechanism.

## Inventory

Legend. **(i)** wrong on a non-GitLab host (or in a cycle that lacks the thing): rename or make config-driven. **(ii)** genuinely host-only (or engine-only, or ceremony-only): hide it where it does not exist. **(iii)** fine: neutral, per-kind already, or reachable only where it is true. "Reaches": *screen* (renderer), *main text* (notifications, errors, effects evidence, files the app writes) or *agent* (text sent to a model).

Surfaces that mention no family at all (voice, models, updates, secrets) were not listed; the 200 `i18n-ignore` lines were read one by one: 4 sites carry a word that must follow the configuration (`TodayParts.tsx:174,214,218` and the block in `bash.ts:56-62`), about 15 name a host, a CLI or a tool correctly (`Auditoria.tsx:12`, `readPolicy.ts`, `readTool.ts`, `claude.ts`), and the rest are CSS, shell, query languages, log lines and developer errors.

### Code sites outside the catalogs

| # | File:line | What it does | Family | Class | Should be driven by |
|---|---|---|---|---|---|
| 1 | `src/renderer/src/screens/TodayParts.tsx:214` | button labelled `GitLab` on every activity (`i18n-ignore`), opens the Quick actions screen even with nothing to propose | a, c | (i) | `host.name`; shown only when the card has a change request or a transition |
| 2 | `src/renderer/src/screens/TodayParts.tsx:174,218` | `<dt>MRs</dt>` and the `QA` button label (both `i18n-ignore`); the QA button is already gated by `cycle.ceremonies.qaHandoff` | b, e | (i) | `{crs}`; the QA word of the cycle |
| 3 | `src/renderer/src/screens/Today.tsx:157,209` | refresh button and footer: keys `ui.today.refreshGitlab`, `ui.today.foot` (named GitLab even with a card source command, where the cards come from the tool) | a, d | (i) | host name, or the card source tool's name |
| 4 | `src/main/vcs/cards.ts:172` | MR ref `short(project)!iid` for **every** provider; this ref is the card's `mrs[]`, `mrPaths[].ref`, the prefix of blockers, pending and changes, and the key of the persisted baseline | b | (i) | `crRef(kind, project, iid)` |
| 5 | `src/main/gitlabQuick.ts:60,194` | same ref, in the quick-action context and summaries | b | (i) | `crRef` |
| 6 | `src/main/actions.ts:498` | same ref, conflict resolution of an MR | b | (i) | `crRef` |
| 7 | `src/main/radar.ts:109` | same ref, in the radar result | b | (i) | `crRef` |
| 8 | `src/main/vcs/probe.ts:44` | sample ref `project!iid` shown in the wizard's "Test" result (full project path, not short) | b | (i) | `crRef` |
| 9 | `src/main/efeitos.ts:225` | `'!'` for an MR comment target, `'#'` for an issue | b | (i) | `{crMark}` |
| 10 | `src/main/actions.ts:695,711,789` | `a.mrs[0]?.ref ?? 'MR'` literal fallback in notifications | b | (i) | `{cr}` |
| 11 | `src/main/agents.ts:262-263` | shell allow-list for the agents: for a `tool` policy (Bitbucket, or any API-only integration) and for no integration it falls back to `GLAB_READ` patterns and to `gitlabHint()` as the text the agent gets when a command is refused (`cli ? policy.usage : gitlabHint()`); `policy.usage` already holds the right text (`readPolicy.ts:70`) | a, d | (i) | `policy.usage` |
| 12 | `src/main/engine/open/tools/bash.ts:56-58` | the Bash tool description the open engine sends the model lists `glab api / glab mr view / glab issue view, gh api / gh pr view / gh issue view` whatever the integration | d | (i) | the active `readPolicy` |
| 13 | `src/renderer/src/screens/QuickActions.tsx:154-163` | the "Issue status" block (heading, stage labels, transitions, the GraphQL note) renders whenever the context has an `issue`; on GitHub it reads "no status" with no transition | c | (ii) | `host.issueStatus && host.quickTransitions` |
| 14 | `src/main/gitlabQuick.ts:29-31` | transitions only for `kind === 'gitlab'` (a rule by kind, not by `caps.issueStatus`; the result is right: none elsewhere) | c | (iii) | works; the screen is what shows an empty block (row 13) |
| 15 | `src/renderer/src/screens/Settings.tsx:33-34`, `src/shared/config/settingsView.ts:14,31` | two tool switches named `gitlabMcp` and `glab` (labels "GitLab through MCP" and "GitLab through glab"). `glab` is `agents.tools.vcsCli`: on GitHub it governs `gh`, on Bitbucket and API-only integrations the `VcsRead` tool (`readPolicyFor`, `readPolicy.ts:66`), so the switch is live but mislabelled. `gitlabMcp` is `trackerMcp`, a no-op while `trackerMcpServer` is empty (the default, `defaults.ts:38`) | a, d | (i) / (ii) | label from `{vcsName}` and `{cli}`; MCP switch only with a server |
| 16 | `src/main/agents.ts:29-32` | `trackerMcpTools()` adds `get_issue_details_and_comments` and `get_merge_request_details_and_changes`, the GitLab MCP's tool names, for whatever server is configured | c, d | (ii) | document as GitLab MCP |
| 17 | `src/renderer/src/screens/Ajuda.tsx:83-91` | the "ceremonies" list is unconditional: Gate, QA hand-off, Retro, "QA return, Discussions, GitLab", Radar | e | (i)/(ii) | `cycle.ceremonies`, host name |
| 18 | `src/renderer/src/screens/ContinueInClaude.tsx` and 10 call sites (`Call`, `Deep`, `Gate`, `QaHandoff`, `Reentry`, `Conflict`, `Discussions`, `RetroScreen`, `History`, `Ata`) | "Continue in Claude Code" for any session id; open-engine sessions are stored under `<data>/open-sessions` (`agents.ts:410`) in the app's own format and `claude --resume` (`src/shared/claude-command.ts:36`) reads `~/.claude`, so the button cannot work for them (from reading; not run) | d | (ii) | the role's `engine` |
| 19 | `src/shared/tempo.ts:5`, `src/renderer/src/dashboard.ts:62` | `pre-daily` label and the fallback `ui.today.preDailyLabel` | e | (i) | `{ceremony}` |
| 20 | `src/shared/glossary.ts:70-72` | the spoken form of a ref: `web!202` read as "web, MR 202", `!202` as "MR 202" | b | (i) | `{cr}`, ref marker |
| 21 | `src/renderer/src/dashboard.ts:131-137,214` | `MR_CONFLICT = /^(.+): MR com conflitos$/` finds an MR with conflicts by a pt-BR sentence that only an external card source writes (a card built from a provider carries "app!7: Conflito com a branch de destino": `vcs.card.conflicts` with the ref `loadCards` prefixes, `src/main/cards.ts:61`). Not a wording problem: the "Resolve conflict" button never shows for cards built from a provider, and the regex would break on a reworded text | b | defect | fixed by #20 (a structured `mrConflicts` list) |
| 22 | `src/shared/config/schema.ts:110,279`, `src/shared/config/types.ts:315,356` | `quickTransitions` and its `id` are documented as GitLab-only | c | (ii) | document; hide the editor where it exists on non-GitLab |
| 23 | `src/main/retro.ts:94` | the retro digest has a field named by key `main.retro.digest.mudancas_gitlab` (pt: `mudancas_gitlab`, en: `host_changes`) that the agent reads | a | (i) | key `changes_host` / `{vcsName}` is not needed: rename the field neutrally |
| 24 | `src/renderer/src/screens/Auditoria.tsx:9-13`, `src/main/vcs/exec.ts:105,112`, `src/shared/glossary.ts:19,28,29`, `src/main/claude.ts:42`, `src/main/vcs/readTool.ts:13-24` | `KIND` map of audit entries (each entry names the host it was written to: correct), `kind:'GitLab'` in the GitLab executor's own errors, the default pronunciation glossary (editable), the terminal window title, the English description of `VcsRead` ("a merge or pull request", "Issue or MR number") | a, b, d | (iii) | — |

Counted by site, not by line: 24 rows, of which 19 need a change, 2 only need documenting (16, 22), 1 is a defect to decide on (21) and 2 are left alone (14, 24).

### Family a — host name ("GitLab", "GitHub", "Bitbucket")

Config value: `projects.issues.vcsId` → `vcs[].kind` (`rc().primaryVcs.kind`); display name from `vcsName()`. A host is one integration at a time in this code (`vcsProvider()` reads the primary one; `repos[].vcsId` only feeds `settingsOf`), so "issue tracker differs from the code host" has no separate value to drive: see the open questions.

**Class (i): 33 keys**

| Key | File:line | pt-BR → en | Driven by | Reaches |
|---|---|---|---|---|
| `call.explainsConflict` | `pt-BR.json:179` | A call explica o conflito; a resolução é feita na tela dele, numa wor… → The call explains the conflict; the resolution happens on its own scr… | {vcsName} | screen |
| `call.explainsConflict.novoice` | `pt-BR.json:180` | A conversa explica o conflito; a resolução é feita na tela dele, numa… → The chat explains the conflict; the resolution happens on its own scr… | {vcsName} | screen |
| `main.retro.digest.mudancas_gitlab` | `main.pt-BR.json:697` | mudancas_gitlab → host_changes | {vcsName} | agent |
| `main.saude.task.gitlab-quick` | `main.pt-BR.json:256` | Ações rápidas do GitLab → Quick code host actions | {vcsName} | main text |
| `minutes.delete.keptAlways` | `minutes.pt-BR.json:76` | Comentários e ações já publicados no GitLab ou em outro host continua… → Comments and actions already published to GitLab or another host stay… | {vcsName} | main text |
| `ui.discussions.proposalNote` | `ui-gate.pt-BR.json:45` | Cada botão só cria uma proposta. Nada vai ao GitLab antes do “seguir”… → Each button only creates a proposal. Nothing goes to GitLab before th… | {vcsName} | screen |
| `ui.discussions.reading` | `ui-gate.pt-BR.json:46` | Lendo as discussões no GitLab… → Reading the discussions on GitLab… | {vcsName} | screen |
| `ui.discussions.state.done` | `ui-gate.pt-BR.json:53` | enviada ao GitLab → sent to GitLab | {vcsName} | screen |
| `ui.help.ceremonies.others` | `ui-gate.pt-BR.json:169` | Retorno do QA, Discussões, GitLab → QA return, Discussions, GitLab | {vcsName} | screen |
| `ui.help.ceremonies.others.text` | `ui-gate.pt-BR.json:170` | Retorno do QA explica uma atividade que voltou do teste. Discussões p… → QA return explains an activity that came back from testing. Discussio… | {vcsName} | screen |
| `ui.help.ceremonies.unblock.text` | `ui-gate.pt-BR.json:180` | Conversa a fundo sobre uma atividade travada. O agente lê spec, GitLa… → An in-depth conversation about a stuck activity. The agent reads the … | {vcsName} | screen |
| `ui.help.never.agents.text` | `ui-gate.pt-BR.json:198` | Só leem (arquivos, skills do playbook, GitLab). Editar arquivos, aces… → They only read (files, playbook skills, GitLab). Editing files, acces… | {vcsName} | screen |
| `ui.help.never.gitlab.term` | `ui-gate.pt-BR.json:200` | Escrever no GitLab → Writing to GitLab | {vcsName} | screen |
| `ui.help.never.gitlab.text` | `ui-gate.pt-BR.json:201` | Nunca por conta própria. Tudo que escreve (comentário, label, reviewe… → Never on its own. Everything it writes (comment, label, reviewer, mer… | {vcsName} | screen |
| `ui.quick.intro` | `ui-docs.pt-BR.json:96` | Aqui você só monta propostas. Nada vai ao GitLab antes do “seguir” e … → Here you only build proposals. Nothing goes to GitLab before your “go… | {vcsName} | screen |
| `ui.quick.job.proposeLabel` | `ui-docs.pt-BR.json:99` | Proposta no GitLab da {iid} → GitLab proposal for {iid} | {vcsName} | screen |
| `ui.quick.job.readBusy` | `ui-docs.pt-BR.json:100` | Lendo o GitLab… → Reading GitLab… | {vcsName} | screen |
| `ui.quick.job.readLabel` | `ui-docs.pt-BR.json:101` | Leitura do GitLab da {iid} → GitLab read for {iid} | {vcsName} | screen |
| `ui.quick.kicker` | `ui-docs.pt-BR.json:102` | GitLab · propostas → GitLab · proposals | {vcsName} | screen |
| `ui.radar.intro` | `ui-today.pt-BR.json:170` | Cruza os arquivos e os trechos das suas MRs abertas, de atividades di… → Cross-checks the files and the hunks of your open MRs, from different… | {vcsName} | screen |
| `ui.resolver.job.busy` | `ui-gate.pt-BR.json:297` | Lendo o MR no GitLab… → Reading the MR on GitLab… | {vcsName} | screen |
| `ui.retro.intro` | `ui-docs.pt-BR.json:135` | A retro junta as cerimônias, decisões, ações de release, quizzes de g… → The retro gathers the ceremonies, decisions, release actions, gate qu… | {vcsName} | screen |
| `ui.settings.role.deep.hint` | `ui-settings.pt-BR.json:72` | Investiga a fundo, lendo spec, GitLab e playbook. Vale um modelo mais… → Investigates in depth, reading the spec, GitLab and the playbook. Wor… | {vcsName} | screen |
| `ui.settings.tool.gitlabMcp.hint` | `ui-settings.pt-BR.json:114` | Descrição e diff de issue e MR (gitlab-issue-analysis). → Issue and MR description and diff (gitlab-issue-analysis). | {vcsName} | screen |
| `ui.settings.tool.gitlabMcp.label` | `ui-settings.pt-BR.json:115` | GitLab pelo MCP → GitLab through MCP | {vcsName} | screen |
| `ui.settings.tool.glab.label` | `ui-settings.pt-BR.json:117` | GitLab pelo glab → GitLab through glab | {vcsName} | screen |
| `ui.settings.tools.hint` | `ui-settings.pt-BR.json:122` | Sempre bloqueado, independentemente daqui: editar arquivos, web, arqu… → Always blocked, regardless of this: editing files, the web, secret fi… | {vcsName} | screen |
| `ui.today.foot` | `ui-today.pt-BR.json:232` | Cada agente é montado a cada cerimônia a partir do cartão do GitLab, … → Each agent is built at every ceremony from the GitLab card, the spec … | {vcsName} | screen |
| `ui.today.refreshGitlab` | `ui-today.pt-BR.json:269` | Atualizar do GitLab → Refresh from GitLab | {vcsName} | screen |
| `ui.today.resume.restored` | `ui-today.pt-BR.json:270` | Cartões e agentes de hoje recuperados do disco, sem chamar o GitLab n… → Today's cards and agents were restored from disk, without calling Git… | {vcsName} | screen |
| `ui.today.testWorkspaceHint` | `ui-today.pt-BR.json:311` | Nada sai da máquina daqui: sem escrita no GitLab, no Plan das specs n… → Nothing leaves this machine from here: no writes to GitLab, to the sp… | {vcsName} | screen |
| `ui.webAccess.effects.hint` | `ui-settings.pt-BR.json:172` | Aprovar ações de release e de GitLab (escrita no GitLab, push). Desli… → Approve release and GitLab actions (writes to GitLab, push). When off… | {vcsName} | screen |
| `ui.workspaces.test.hint` | `ui-settings.pt-BR.json:214` | Nada sai da máquina daqui: sem escrita no GitLab, no Plan das specs n… → Nothing leaves the machine from here: no writes to GitLab, to the spe… | {vcsName} | screen |

**Class (iii): 27 keys, left as they are**

`cycle.githubFlow.name`, `main.errorlog.hint.accessRefused`, `main.errorlog.hint.cliMissing`, `main.errorlog.hint.networkVpn`, `prompt.sdd.conflict.comment.pipelinesHint`, `prompt.sdd.vcs.changes.github`, `prompt.sdd.vcs.changes.gitlab`, `prompt.sdd.vcs.hint.github`, `prompt.sdd.vcs.hint.gitlab`, `prompt.sdd.vcs.read.github`, `prompt.sdd.vcs.read.gitlab`, `vcs.action.what`, `vcs.probe.bitbucketRepos`, `vcs.validate.githubGraphql`, `vcs.validate.gitlabGraphql`, `vcs.write.guard`, `wizard.problem.vcsHost`, `wizard.step.integrations.hint`, `wizard.vcs.apiUrlHint`, `wizard.vcs.bitbucket`, `wizard.vcs.github`, `wizard.vcs.gitlab`, `wizard.vcs.hostGithub`, `wizard.vcs.scopes.bitbucket`, `wizard.vcs.scopes.github`, `wizard.vcs.scopes.gitlab`, `wizard.vcs.userBitbucket`

### Family b — change-request noun ("MR" vs "PR") and refs

Config value: the same `kind`. GitLab: "MR" / "merge request", ref `app!7`; GitHub and Bitbucket Cloud: "PR" / "pull request", ref `app#7`. How refs are built per provider: `cards.ts:172` writes `!` for all (table above, rows 4-9) and the three parsers that read an MR ref from text are `conflictFromMr.ts:13` (`/^\s*(.+?)!(\d+)\s*$/`), `actions.ts:550` (`/!(\d+)$/`) and `Deep.tsx:158` (`split('!')`); `errorlog.ts:169` and `vcs/gitlab.ts:118` already accept `[#!]`. Card JSON field names `mrs` and `mrPaths` (`CARD_FIELDS`, `config/types.ts:239`) are part of the schema the agents read and the prompts name them: keep (iii), and say once in the prompt that they list the pull requests where that is the noun.

Nine `prompt.sdd.effects.kind.mr_*` ids are *identifiers* the app stores and compares (`src/shared/efeitos.ts`); only their descriptions in the catalog are text.

**Class (i): 77 keys**

| Key | File:line | pt-BR → en | Driven by | Reaches |
|---|---|---|---|---|
| `cycle.sdd.meaning.blocker` | `pt-BR.json:496` | Bloqueio é tudo que impede a atividade de avançar hoje: MR com confli… → A blocker is anything that keeps the activity from moving today: an M… | {cr} {crs} {crLong} | agent |
| `main.actions.mrDataMissing` | `main.pt-BR.json:112` | faltam dados do MR na ação (projeto, número ou branch) → the action lacks MR data (project, number or branch) | {cr} {crs} {crLong} | main text |
| `main.actions.mrInConflict` | `main.pt-BR.json:109` | MR em conflito com a main → MR in conflict with main | {cr} {crs} {crLong} | main text |
| `main.conflictGit.badIid` | `main.pt-BR.json:158` | número de MR inválido: {iid} → invalid MR number: {iid} | {cr} {crs} {crLong} | main text |
| `main.conflictGit.mergeNotStarted` | `main.pt-BR.json:162` | o merge de {target} em {branch} não começou: a branch já contém a {ta… → the merge of {target} into {branch} did not start: the branch already… | {cr} {crs} {crLong} | main text |
| `main.conflictMr.invalidNumber` | `main.pt-BR.json:39` | número de MR inválido: {ref} → invalid MR number: {ref} | {cr} {crs} {crLong} | main text |
| `main.conflictMr.invalidRef` | `main.pt-BR.json:38` | referência de MR inválida: {ref} → invalid MR reference: {ref} | {cr} {crs} {crLong} | main text |
| `main.conflictMr.notOfActivity` | `main.pt-BR.json:41` | {ref} não é um MR desta atividade → {ref} is not an MR of this activity | {cr} {crs} {crLong} | main text |
| `main.conflictMr.notYours` | `main.pt-BR.json:44` | {ref} é de @{author}: só resolvo conflito de MR seu. → {ref} belongs to @{author}: I only resolve conflicts of your own MRs. | {cr} {crs} {crLong} | main text |
| `main.efeitos.behind_one` | `main.pt-BR.json:204` | !{iid} está {count} commit(s) atrás da main → !{iid} is {count} commit behind main | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.behind_other` | `main.pt-BR.json:205` | !{iid} está {count} commit(s) atrás da main → !{iid} is {count} commits behind main | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.behindUnknown` | `main.pt-BR.json:203` | !{iid}: o host não informou a divergência → !{iid}: the host did not report the divergence | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.commit` | `main.pt-BR.json:206` | commit {sha} em !{iid} → commit {sha} on !{iid} | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.mrFound` | `main.pt-BR.json:219` | MR !{iid} «{title}» → MR !{iid} «{title}» | {cr} {crs} {crLong} | main text |
| `main.efeitos.mrState` | `main.pt-BR.json:202` | !{iid} está {state} → !{iid} is {state} | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.noCommit` | `main.pt-BR.json:207` | nenhum commit novo em !{iid} → no new commit on !{iid} | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.noJob` | `main.pt-BR.json:211` | job {name} não rodou em !{iid} → job {name} did not run on !{iid} | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.noMr` | `main.pt-BR.json:220` | nenhum MR novo com «{value}» → no new MR with «{value}» | {cr} {crs} {crLong} | main text |
| `main.efeitos.noPipeline` | `main.pt-BR.json:209` | nenhuma pipeline nova em !{iid} → no new pipeline on !{iid} | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.noReviewer` | `main.pt-BR.json:201` | !{iid} sem reviewer → !{iid} has no reviewer | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.notDraft` | `main.pt-BR.json:199` | !{iid} não é mais draft → !{iid} is no longer a draft | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.pipeline` | `main.pt-BR.json:208` | pipeline {id} ({status}) em !{iid} → pipeline {id} ({status}) on !{iid} | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.reviewers` | `main.pt-BR.json:200` | reviewers de !{iid}: {names} → reviewers of !{iid}: {names} | {crMark} (ref written as !{iid}) | main text |
| `main.efeitos.stillDraft` | `main.pt-BR.json:198` | !{iid} ainda é draft → !{iid} is still a draft | {crMark} (ref written as !{iid}) | main text |
| `main.feedback.badMr` | `main.pt-BR.json:325` | MR inválido → invalid MR | {cr} {crs} {crLong} | main text |
| `main.quick.reviewerDraft` | `main.pt-BR.json:573` |  (o MR está em draft) →  (the MR is a draft) | {cr} {crs} {crLong} | main text |
| `main.radar.recommendation.same-fix` | `main.pt-BR.json:387` | Leia os dois trechos antes de mergear e comente nas duas MRs no mesmo… → Read both pieces before merging and comment on both MRs the same day:… | {cr} {crs} {crLong} | main text |
| `main.radar.stacked` | `main.pt-BR.json:399` | Uma MR parte da branch da outra. → One MR starts from the branch of the other. | {cr} {crs} {crLong} | main text |
| `main.retention.app.review` | `main.pt-BR.json:230` | revisão de MR → MR review | {cr} {crs} {crLong} | main text |
| `main.saude.task.feedback` | `main.pt-BR.json:254` | Feedback dos MRs → MR feedback | {cr} {crs} {crLong} | main text |
| `main.watchers.shippedMr` | `main.pt-BR.json:363` | !{iid} mergeada em {target} → !{iid} merged into {target} | {crMark} (ref written as !{iid}) | main text |
| `prompt.sdd.conflict.propose` | `pt-BR.json:385` | Conflito de sincronização com a main depois de uma release: issue {re… → Conflict syncing with main after a release: issue {ref} ({title}), {m… | {cr} {crs} {crLong} | agent |
| `prompt.sdd.discussion.main` | `pt-BR.json:453` | Revisão do MR {mr} (issue {ref}, {title}). Explique {toUser} UMA disc… → Review of MR {mr} (issue {ref}, {title}). Explain to {toUser} ONE ope… | {cr} {crs} {crLong} | agent |
| `prompt.sdd.effects.classify` | `main.pt-BR.json:195` | Classifique UMA ação pendente da {ceremony} numa verificação objetiva… → Classify ONE pending action from the {ceremony} into an objective che… | {cr} {crs} {crLong} | agent |
| `prompt.sdd.effects.kind.mr_comment` | `main.pt-BR.json:189` | {theUser} comentou no MR depois da cerimônia → {theUser} commented on the MR after the ceremony | {cr} {crs} {crLong} | agent |
| `prompt.sdd.effects.kind.mr_created` | `main.pt-BR.json:184` | um MR novo foi aberto no projeto (valor: palavras do título; iid null) → a new MR was opened in the project (value: words of the title; iid nu… | {cr} {crs} {crLong} | agent |
| `prompt.sdd.effects.kind.mr_job` | `main.pt-BR.json:188` | um job com esse nome rodou numa pipeline do MR depois da cerimônia (v… → a job with that name ran in a pipeline of the MR after the ceremony (… | {cr} {crs} {crLong} | agent |
| `prompt.sdd.effects.kind.mr_merged` | `main.pt-BR.json:183` | o MR foi mergeado → the MR was merged | {cr} {crs} {crLong} | agent |
| `prompt.sdd.effects.kind.mr_new_commit` | `main.pt-BR.json:186` | o MR recebeu commit novo (push) depois da cerimônia → the MR got a new commit (push) after the ceremony | {cr} {crs} {crLong} | agent |
| `prompt.sdd.effects.kind.mr_pipeline` | `main.pt-BR.json:187` | uma pipeline do MR rodou depois da cerimônia (valor opcional: status … → a pipeline of the MR ran after the ceremony (optional value: the expe… | {cr} {crs} {crLong} | agent |
| `prompt.sdd.effects.kind.mr_ready` | `main.pt-BR.json:181` | o MR deixou de ser draft (project + iid do MR) → the MR stopped being a draft (project + MR iid) | {cr} {crs} {crLong} | agent |
| `prompt.sdd.effects.kind.mr_reviewer` | `main.pt-BR.json:182` | o MR tem reviewer definido (valor opcional: username esperado) → the MR has a reviewer set (optional value: the expected username) | {cr} {crs} {crLong} | agent |
| `prompt.sdd.effects.kind.mr_synced_with_main` | `main.pt-BR.json:185` | a branch do MR está atualizada com a main, sem commits de divergência → the MR branch is up to date with main, with no diverging commits | {cr} {crs} {crLong} | agent |
| `prompt.sdd.qa.prepare` | `pt-BR.json:419` | Passagem para o QA da issue {ref} ({title}), {mode}. Você explica ao … → QA hand-off of issue {ref} ({title}), {mode}. You explain to QA what … | {cr} {crs} {crLong} | agent |
| `prompt.sdd.reentry.main` | `pt-BR.json:443` | {call} de reentrada da issue {ref} ({title}), {mode}: o QA ou a revis… → {call}: re-entry of issue {ref} ({title}), {mode}. QA or the review s… | {cr} {crs} {crLong} | agent |
| `prompt.sdd.reentry.noNotes` | `pt-BR.json:448` | Não há nota do {qaUser} na issue nem nos MRs. Diga isso e não invente… → There is no note from {qaUser} on the issue or on the MRs. Say so and… | {cr} {crs} {crLong} | agent |
| `prompt.sdd.reply.main` | `pt-BR.json:370` | {intro} ⏎ {TheUser} respondeu {answered}: «{text}» ⏎ "ack": até 25 pa… → {intro} ⏎ {TheUser} answered {answered}: «{text}» ⏎ "ack": up to 25 w… | {cr} {crs} {crLong} | agent |
| `prompt.sdd.rules.speechExamples` | `pt-BR.json:344` | Issue pelo número curto ("a 123"), MR pelo repositório e número ("o 4… → Say the issue by its short number ("issue 123") and the MR by reposit… | {cr} {crs} {crLong} | agent |
| `sameDay.change.mrAdded` | `minutes.pt-BR.json:96` | MR nova: {text} → new MR: {text} | {cr} {crs} {crLong} | main text |
| `sameDay.change.mrRemoved` | `minutes.pt-BR.json:97` | MR que saiu: {text} → MR gone: {text} | {cr} {crs} {crLong} | main text |
| `ui.actions.files.release` | `ui-docs.pt-BR.json:18` | {count} arquivo(s) do MR que a release também mudou → MR files the release also changed: {count} | {cr} {crs} {crLong} | screen |
| `ui.actions.what.sync.noRetest` | `ui-docs.pt-BR.json:50` | Faz merge da main em {branches} e push (fast-forward, sem force-push)… → Merges main into {branches} and pushes (fast-forward, no force-push).… | {cr} {crs} {crLong} | screen |
| `ui.actions.what.sync.retest` | `ui-docs.pt-BR.json:51` | Faz merge da main em {branches} e push (fast-forward, sem force-push)… → Merges main into {branches} and pushes (fast-forward, no force-push).… | {cr} {crs} {crLong} | screen |
| `ui.call.noMr` | `ui-call.pt-BR.json:60` | sem MR → no MR | {cr} {crs} {crLong} | screen |
| `ui.deep.conflict` | `ui-call.pt-BR.json:105` | MR com conflito → MR with a conflict | {cr} {crs} {crLong} | screen |
| `ui.discussions.noMr` | `ui-gate.pt-BR.json:36` | sem MR → no MR | {cr} {crs} {crLong} | screen |
| `ui.glossary.sample.spoken` | `ui-gate.pt-BR.json:150` | O web!202 está aprovado e o QA libera o merge no gateway. → web!202 is approved and QA clears the merge in the gateway. | {cr} {crs} {crLong} | screen |
| `ui.help.ceremonies.others.text` | `ui-gate.pt-BR.json:170` | Retorno do QA explica uma atividade que voltou do teste. Discussões p… → QA return explains an activity that came back from testing. Discussio… | {cr} {crs} {crLong} | screen |
| `ui.help.ceremonies.radar.text` | `ui-gate.pt-BR.json:175` | Só lê: cruza os arquivos das suas MRs abertas, de atividades diferent… → Read-only: it cross-checks the files of your open MRs, from different… | {cr} {crs} {crLong} | screen |
| `ui.qa.prepare.intro` | `ui-gate.pt-BR.json:238` | O agente lê o ISSUE_COMPLETION, o TEST_PLAN, o Plan, o diff do MR e a… → The agent reads the ISSUE_COMPLETION, the TEST_PLAN, the Plan, the MR… | {cr} {crs} {crLong} | screen |
| `ui.quick.mr.readonly` | `ui-docs.pt-BR.json:106` | MR de outra pessoa: só leitura. → Someone else's MR: read-only. | {cr} {crs} {crLong} | screen |
| `ui.quick.mrs` | `ui-docs.pt-BR.json:107` | Merge requests · {count} → Merge requests · {count} | {cr} {crs} {crLong} | screen |
| `ui.quick.mrs.none` | `ui-docs.pt-BR.json:108` | Esta atividade não tem MR. → This activity has no MR. | {cr} {crs} {crLong} | screen |
| `ui.radar.checked_one` | `ui-today.pt-BR.json:161` | Conferido às {time} · {count} MR → Checked at {time} · {count} MR | {cr} {crs} {crLong} | screen |
| `ui.radar.checked_other` | `ui-today.pt-BR.json:162` | Conferido às {time} · {count} MRs → Checked at {time} · {count} MRs | {cr} {crs} {crLong} | screen |
| `ui.radar.identicalLines` | `ui-today.pt-BR.json:169` | {count} linhas adicionadas são idênticas nas duas MRs. → {count} added lines are identical in both MRs. | {cr} {crs} {crLong} | screen |
| `ui.radar.intro` | `ui-today.pt-BR.json:170` | Cruza os arquivos e os trechos das suas MRs abertas, de atividades di… → Cross-checks the files and the hunks of your open MRs, from different… | {cr} {crs} {crLong} | screen |
| `ui.radar.job.busy` | `ui-today.pt-BR.json:171` | Conferindo as MRs abertas… → Checking the open MRs… | {cr} {crs} {crLong} | screen |
| `ui.radar.mrGoesTo` | `ui-today.pt-BR.json:179` | MR vai para {base} → MR goes to {base} | {cr} {crs} {crLong} | screen |
| `ui.radar.noCollisions` | `ui-today.pt-BR.json:181` | Nenhuma colisão entre as MRs abertas. → No collisions between the open MRs. | {cr} {crs} {crLong} | screen |
| `ui.reentry.seeDiscussions` | `ui-call.pt-BR.json:192` | Ver discussões dos MRs → See the MR discussions | {cr} {crs} {crLong} | screen |
| `ui.resolver.job.busy` | `ui-gate.pt-BR.json:297` | Lendo o MR no GitLab… → Reading the MR on GitLab… | {cr} {crs} {crLong} | screen |
| `ui.settings.tool.gitlabMcp.hint` | `ui-settings.pt-BR.json:114` | Descrição e diff de issue e MR (gitlab-issue-analysis). → Issue and MR description and diff (gitlab-issue-analysis). | {cr} {crs} {crLong} | screen |
| `ui.settings.tool.glab.hint` | `ui-settings.pt-BR.json:116` | Só leitura: discussões de MR, comentários de issue, mr/issue view. Es… → Read only: MR discussions, issue comments, mr/issue view. Writing is … | {cr} {crs} {crLong} | screen |
| `ui.today.mrCount_one` | `ui-today.pt-BR.json:238` | {count} MR → {count} MR | {cr} {crs} {crLong} | screen |
| `ui.today.mrCount_other` | `ui-today.pt-BR.json:239` | {count} MRs → {count} MRs | {cr} {crs} {crLong} | screen |
| `ui.today.noMr` | `ui-today.pt-BR.json:256` | sem MR → no MR | {cr} {crs} {crLong} | screen |

**Class (iii): 15 keys, left as they are**

`cycle.githubFlow.description`, `cycle.githubFlow.meaning.blocker`, `prompt.sdd.vcs.changes.gitlab`, `prompt.sdd.vcs.hint.github`, `prompt.sdd.vcs.hint.gitlab`, `prompt.sdd.vcs.hint.tool`, `vcs.probe.mrs`, `vcs.probe.sampleMrs`, `vcs.validate.githubGraphql`, `wizard.step.integrations.hint`, `wizard.vcs.intro`, `wizard.vcs.none`, `wizard.vcs.scopes.bitbucket`, `wizard.vcs.scopes.github`, `wizard.vcs.scopes.gitlab`

### Family c — host-specific concepts

Config values: `VcsCaps` of the primary provider, `devCycle.quickTransitions`, `agents.tools.*`. What each host has: GitLab: work item status (GraphQL), scoped labels, manual jobs, approvals, draft by title prefix, reviewers replaced on assignment. GitHub: no status of its own (the stage comes from labels and PRs, or a Projects field), checks and workflow runs instead of pipelines, no manual jobs, reviewers added, draft is a flag. Bitbucket: the issue state is the status, no labels, no manual jobs, Pipelines, draft is a flag.

**Class (i): 11 keys**

| Key | File:line | pt-BR → en | Driven by | Reaches |
|---|---|---|---|---|
| `cycle.sdd.meaning.blocker` | `pt-BR.json:496` | Bloqueio é tudo que impede a atividade de avançar hoje: MR com confli… → A blocker is anything that keeps the activity from moving today: an M… | CI word (kind variant) | agent |
| `main.efeitos.job` | `main.pt-BR.json:210` | job {name} ({status}) na pipeline {id} → job {name} ({status}) in pipeline {id} | CI word (kind variant) | main text |
| `main.efeitos.noJob` | `main.pt-BR.json:211` | job {name} não rodou em !{iid} → job {name} did not run on !{iid} | CI word (kind variant) | main text |
| `main.efeitos.noPipeline` | `main.pt-BR.json:209` | nenhuma pipeline nova em !{iid} → no new pipeline on !{iid} | CI word (kind variant) | main text |
| `main.efeitos.pipeline` | `main.pt-BR.json:208` | pipeline {id} ({status}) em !{iid} → pipeline {id} ({status}) on !{iid} | CI word (kind variant) | main text |
| `prompt.sdd.effects.kind.mr_job` | `main.pt-BR.json:188` | um job com esse nome rodou numa pipeline do MR depois da cerimônia (v… → a job with that name ran in a pipeline of the MR after the ceremony (… | CI word (kind variant) | agent |
| `prompt.sdd.effects.kind.mr_pipeline` | `main.pt-BR.json:187` | uma pipeline do MR rodou depois da cerimônia (valor opcional: status … → a pipeline of the MR ran after the ceremony (optional value: the expe… | CI word (kind variant) | agent |
| `prompt.sdd.reply.main` | `pt-BR.json:370` | {intro} ⏎ {TheUser} respondeu {answered}: «{text}» ⏎ "ack": até 25 pa… → {intro} ⏎ {TheUser} answered {answered}: «{text}» ⏎ "ack": up to 25 w… | CI word (kind variant) | agent |
| `ui.quick.badge.pipeline` | `ui-docs.pt-BR.json:91` | pipeline {status} → pipeline {status} | CI word (kind variant) | screen |
| `vcs.card.ciFailed` | `pt-BR.json:8` | Pipeline falhou → CI failed | CI word (kind variant) | main text |
| `vcs.card.ciRunning` | `pt-BR.json:10` | Pipeline em andamento → CI running | CI word (kind variant) | main text |

**Class (ii): 34 keys**

| Key | File:line | pt-BR → en | Driven by | Reaches |
|---|---|---|---|---|
| `main.quick.cannotLeave` | `main.pt-BR.json:556` | Não sai de “{status}” por aqui. → It does not leave “{status}” from here. | caps.issueStatus, quickTransitions | main text |
| `main.quick.cannotPlay` | `main.pt-BR.json:566` | o job {job} não pode ser tocado por aqui → the job {job} cannot be played from here | caps.manualJobs | main text |
| `main.quick.foreign` | `main.pt-BR.json:558` | A issue tem {labels}, fora do conjunto que o app troca. Ajuste no {vc… → The issue has {labels}, outside the set the app swaps. Adjust it on {… | caps.issueStatus, quickTransitions | main text |
| `main.quick.jobStuck` | `main.pt-BR.json:578` | Job {job} parado em {ref} → Job {job} stuck on {ref} | caps.manualJobs | main text |
| `main.quick.labelSummary` | `main.pt-BR.json:563` | Label da #{issue}: {change} ({from} → {to}) → Label of #{issue}: {change} ({from} → {to}) | caps.issueStatus, quickTransitions | main text |
| `main.quick.manyBody` | `main.pt-BR.json:581` | Draft e jobs manuais aguardando o seu “seguir”. → Drafts and manual jobs waiting for your “go ahead”. | caps.manualJobs | main text |
| `main.quick.noDraftPrefix` | `main.pt-BR.json:570` | o título não tem prefixo de draft; tire o draft no {vcs} → the title has no draft prefix; take the draft off on {vcs} | host is GitLab | main text |
| `main.quick.noManualJobs` | `main.pt-BR.json:565` | este host não tem jobs manuais de CI → this host has no manual CI jobs | caps.manualJobs | main text |
| `main.quick.noStatus` | `main.pt-BR.json:557` | sem status → no status | caps.issueStatus, quickTransitions | main text |
| `main.quick.notAllowed` | `main.pt-BR.json:560` | transição não permitida → transition not allowed | caps.issueStatus, quickTransitions | main text |
| `main.quick.notAllowedTo` | `main.pt-BR.json:559` | transição não permitida: {to} → transition not allowed: {to} | caps.issueStatus, quickTransitions | main text |
| `main.quick.nothingToChange` | `main.pt-BR.json:564` | Nada a mudar: a label já está certa e o status não pôde ser lido. → Nothing to change: the label is already right and the status could no… | caps.issueStatus, quickTransitions | main text |
| `main.quick.replaceReviewers` | `main.pt-BR.json:574` | Substitui os reviewers atuais: {list}. → Replaces the current reviewers: {list}. | host is GitLab | main text |
| `main.quick.runJob` | `main.pt-BR.json:577` | Rodar o job {job} em {ref} → Run the job {job} on {ref} | caps.manualJobs | main text |
| `main.quick.runJobIn` | `main.pt-BR.json:702` | Rodar o job {job} ({project}, pipeline {run}) → Run the job {job} ({project}, pipeline {run}) | caps.manualJobs | main text |
| `main.quick.sameStatus` | `main.pt-BR.json:555` | Já está neste status. → It is already in this status. | caps.issueStatus, quickTransitions | main text |
| `main.quick.statusDetail` | `main.pt-BR.json:562` | Muda o status do work item (skill issue-status). A label vai numa pro… → Changes the status of the work item (issue-status skill). The label g… | caps.issueStatus, quickTransitions | main text |
| `main.quick.statusSummary` | `main.pt-BR.json:561` | Status da #{issue}: {from} → {to} → Status of #{issue}: {from} → {to} | caps.issueStatus, quickTransitions | main text |
| `prompt.sdd.effects.kind.issue_label` | `main.pt-BR.json:191` | a issue ganhou a label (valor: a label, como STAGE::Ready to test) → the issue got the label (value: the label, like STAGE::Ready to test) | caps.issueStatus, quickTransitions | agent |
| `ui.quick.job.play` | `ui-docs.pt-BR.json:97` | Rodar job {name} → Run job {name} | caps.manualJobs | screen |
| `ui.quick.label` | `ui-docs.pt-BR.json:103` | Label: {labels} → Label: {labels} | caps.issueStatus, quickTransitions | screen |
| `ui.quick.label.already` | `ui-docs.pt-BR.json:104` | já está certa → already correct | caps.issueStatus, quickTransitions | screen |
| `ui.quick.label.propose` | `ui-docs.pt-BR.json:105` | Propor label → Propose label | caps.issueStatus, quickTransitions | screen |
| `ui.quick.reviewer.replaces` | `ui-docs.pt-BR.json:115` | Escolher outro reviewer substitui os atuais. → Choosing another reviewer replaces the current ones. | host is GitLab | screen |
| `ui.quick.stageLabels` | `ui-docs.pt-BR.json:117` | Labels de etapa: {labels}. Revisão e QA movem os demais status. → Stage labels: {labels}. Review and QA move the other statuses. | caps.issueStatus, quickTransitions | screen |
| `ui.quick.stageLabels.none` | `ui-docs.pt-BR.json:118` | nenhuma → none | caps.issueStatus, quickTransitions | screen |
| `ui.quick.status` | `ui-docs.pt-BR.json:119` | Status da issue · {status} → Issue status · {status} | caps.issueStatus, quickTransitions | screen |
| `ui.quick.status.none` | `ui-docs.pt-BR.json:120` | sem status → no status | caps.issueStatus, quickTransitions | screen |
| `ui.quick.statusNote` | `ui-docs.pt-BR.json:121` | O app propõe só a label. O status é GraphQL e fica por sua conta: a p… → The app proposes only the label. The status is GraphQL and is up to y… | caps.issueStatus, quickTransitions | screen |
| `vcs.card.ciManual` | `pt-BR.json:9` | Pipeline esperando um job manual → CI waiting for a manual job | caps.manualJobs | main text |
| `vcs.validate.gitlabGraphql` | `pt-BR.json:47` | GraphQL só para a mudança de status do work item (workItemUpdate com … → GraphQL is only allowed for the work item status change (workItemUpda… | caps.issueStatus, quickTransitions | main text |
| `vcs.write.playJob` | `pt-BR.json:51` | rodar jobs manuais de CI → running manual CI jobs | caps.manualJobs | main text |
| `vcs.write.statusNoNode` | `pt-BR.json:52` | a issue não tem identificador global para mudar o status → the issue has no global id to change its status | caps.issueStatus, quickTransitions | main text |
| `vcs.write.statusOpenClosed` | `pt-BR.json:53` | só abrir ou fechar a issue (open, closed) → only opening or closing the issue (open, closed) | caps.issueStatus, quickTransitions | main text |

**Class (iii): 19 keys, left as they are**

`cycle.githubFlow.meaning.blocker`, `main.actions.noteProposed`, `main.quick.notDraft`, `main.quick.reviewer`, `main.quick.stillDraft`, `main.quick.undraft`, `main.watchers.lostApproval_one`, `main.watchers.lostApproval_other`, `prompt.sdd.conflict.comment`, `ui.actions.what.qaComment.edit`, `ui.quick.badge.draft`, `ui.quick.group.usual`, `ui.quick.reviewer`, `ui.quick.reviewer.aria`, `ui.quick.reviewer.choose`, `ui.quick.reviewer.propose`, `ui.quick.undraft`, `vcs.card.draft`, `vcs.probe.writesNeed`

### Family d — tool names

Config values: `externalTools.claudeCli`, `agents.tools` (`trackerMcp`, `trackerMcpServer`, `vcsCli`), the role's `engine` (`llm.roles` → provider → `engine`), `externalTools.cardSource.command`, `externalTools.releaseSync.command`, `vcsCliFor()`.

- **Claude Code** is the product the person runs; `externalTools.claudeCli.command` may be a wrapper but is still Claude Code. The text is fine (iii); the *availability* is what is wrong when the session comes from the open engine (code site 18). The 21 keys of class (ii) below are the buttons, hints and process sentences that send the person to Claude Code.
- **glab / gh**: texts that name the CLI are right per kind (`readPolicy.ts`), except code sites 11, 12 and 15.
- **Card source**: `origin()` in `cyclePrompts.ts:35` already says "(GitLab via tool)" or the tool alone to the agent; the screens do not (code site 3).
- **Release sync tool**: texts say "your team's release tool" / "the release sync tool" and `rc().releaseSync` gates the feature: fine.

**Class (i): 5 keys**

| Key | File:line | pt-BR → en | Driven by | Reaches |
|---|---|---|---|---|
| `ui.settings.tool.gitlabMcp.hint` | `ui-settings.pt-BR.json:114` | Descrição e diff de issue e MR (gitlab-issue-analysis). → Issue and MR description and diff (gitlab-issue-analysis). | {vcsName} {cli}, trackerMcpServer | screen |
| `ui.settings.tool.gitlabMcp.label` | `ui-settings.pt-BR.json:115` | GitLab pelo MCP → GitLab through MCP | {vcsName} {cli}, trackerMcpServer | screen |
| `ui.settings.tool.glab.hint` | `ui-settings.pt-BR.json:116` | Só leitura: discussões de MR, comentários de issue, mr/issue view. Es… → Read only: MR discussions, issue comments, mr/issue view. Writing is … | {vcsName} {cli}, trackerMcpServer | screen |
| `ui.settings.tool.glab.label` | `ui-settings.pt-BR.json:117` | GitLab pelo glab → GitLab through glab | {vcsName} {cli}, trackerMcpServer | screen |
| `ui.settings.tools.hint` | `ui-settings.pt-BR.json:122` | Sempre bloqueado, independentemente daqui: editar arquivos, web, arqu… → Always blocked, regardless of this: editing files, the web, secret fi… | {vcsName} {cli}, trackerMcpServer | screen |

**Class (ii): 21 keys**

| Key | File:line | pt-BR → en | Driven by | Reaches |
|---|---|---|---|---|
| `call.effectsNote` | `pt-BR.json:183` | Nada daqui roda na call. Cada item vai para o Claude Code e espera o … → Nothing here runs in the call. Each item goes to Claude Code and wait… | role engine = claude-sdk | screen |
| `call.effectsNote.novoice` | `pt-BR.json:184` | Nada daqui roda na conversa. Cada item vai para o Claude Code e esper… → Nothing here runs in the chat. Each item goes to Claude Code and wait… | role engine = claude-sdk | screen |
| `main.ata.effects` | `main.pt-BR.json:347` | ### Efeitos aguardando "sim" no Claude Code → ### Effects waiting for a "yes" in Claude Code | role engine = claude-sdk | main text |
| `minutes.delete.keptEffects` | `minutes.pt-BR.json:74` | Efeitos que foram para a fila do Claude Code (o que já rodou lá não v… → Effects that went to the Claude Code queue (what already ran there do… | role engine = claude-sdk | main text |
| `prompt.sdd.turn.sameDay.effect` | `minutes.pt-BR.json:117` | - Efeitos na fila para o Claude Code: {text} → - Effects queued for Claude Code: {text} | role engine = claude-sdk | agent |
| `ui.ata.effect.run` | `ui-docs.pt-BR.json:61` | Executar no Claude Code → Run in Claude Code | role engine = claude-sdk | screen |
| `ui.ata.effects.copy` | `ui-docs.pt-BR.json:62` | Copiar para o Claude Code → Copy to Claude Code | role engine = claude-sdk | screen |
| `ui.ata.effects.hint` | `ui-docs.pt-BR.json:64` | Vai para o Claude Code. Lá, cada item espera o seu “sim”. → Goes to Claude Code. There, each item waits for your “yes”. | role engine = claude-sdk | screen |
| `ui.conflict.after` | `ui-gate.pt-BR.json:2` | Concordou com a resolução? Resolva acima, na worktree temporária (mer… → Agree with the resolution? Resolve it above, in the temporary worktre… | role engine = claude-sdk | screen |
| `ui.continueInClaude.label` | `ui-call.pt-BR.json:98` | Continuar no Claude Code → Continue in Claude Code | role engine = claude-sdk | screen |
| `ui.errors.copy` | `ui-settings.pt-BR.json:4` | Copiar para o Claude Code → Copy for Claude Code | role engine = claude-sdk | screen |
| `ui.gate.lastAfterTwo` | `ui-gate.pt-BR.json:95` | Duas rodadas erradas: o problema é o material. Reescreva a seção (no … → Two wrong rounds: the problem is the material. Rewrite the section (i… | role engine = claude-sdk | screen |
| `ui.gate.pick.intro` | `ui-gate.pt-BR.json:101` | O agente lê o artefato, faz o Resumo do gate e até 3 perguntas de con… → The agent reads the artifact, writes the Gate summary and asks up to … | role engine = claude-sdk | screen |
| `ui.gate.verdict.assertive.intro` | `ui-gate.pt-BR.json:115` | O gate abre com a sua frase no chat do Claude Code ({phrase}). Grave … → The gate opens with your phrase in the Claude Code chat ({phrase}). S… | role engine = claude-sdk | screen |
| `ui.help.ceremonies.gate.text` | `ui-gate.pt-BR.json:168` | O agente lê o artefato da fase (Investigation, RFC, Spec Funcional, F… → The agent reads the phase artifact (Investigation, RFC, Functional Sp… | role engine = claude-sdk | screen |
| `ui.help.never.effects.text` | `ui-gate.pt-BR.json:199` | A fila de efeitos não roda nada: cada item vai para o Claude Code, on… → The effects queue runs nothing: each item goes to Claude Code, where … | role engine = claude-sdk | screen |
| `ui.history.copyToClaude` | `ui-today.pt-BR.json:108` | Copiar para o Claude Code → Copy to Claude Code | role engine = claude-sdk | screen |
| `ui.reentry.continueNote` | `ui-call.pt-BR.json:176` | Seguir a reentrada é no Claude Code, nesta mesma sessão do agente. → Going ahead with the re-entry happens in Claude Code, in this same ag… | role engine = claude-sdk | screen |
| `ui.reentry.cycleNote` | `ui-call.pt-BR.json:177` | Tabela de ciclos da skill agent-pipeline, seção 3. Mover status e lab… → Cycle table from the agent-pipeline skill, section 3. Moving the stat… | role engine = claude-sdk | screen |
| `ui.retro.improvements.hint` | `ui-docs.pt-BR.json:133` | O IMPROVEMENTS.md é do time: copie a entrada e leve pelo Claude Code … → IMPROVEMENTS.md belongs to the team: copy the entry and take it throu… | role engine = claude-sdk | screen |
| `ui.webAccess.effects.hint` | `ui-settings.pt-BR.json:172` | Aprovar ações de release e de GitLab (escrita no GitLab, push). Desli… → Approve release and GitLab actions (writes to GitLab, push). When off… | role engine = claude-sdk | screen |

**Class (iii): 11 keys, left as they are**

`main.actions.noSyncTool`, `main.retention.app.teams`, `prompt.sdd.conflict.ask.intro`, `ui.actions.intro`, `ui.cost.goal.hint`, `ui.cost.goal.hintLimit`, `ui.qa.take.text`, `ui.retention.hint`, `ui.settings.tool.skills.hint`, `wizard.docs.autoDetectHint`, `wizard.sdk.legalLink`

### Family e — cycle vocabulary

Config values: `devCycle.ceremonyParams.preDaily.label`, `devCycle.ceremonies`, `devCycle.specLayout` (`decisionLog.heading`, `documents`, `planFiles`), `devCycle.enrichment.specFolder`, `devCycle.stages`, `devCycle.ceremonyParams.retro.windowDays`, `devCycle.prompts`, and what the template says (`github-flow` calls the pre-daily "standup", `scrum` "daily scrum", `kanban` and `minimal` "standup"; Scrum's retro window is 14 days).

What is already right: the tray, the notification title, the minutes heading (`main.ata.heading`) and the prompts use `ceremonyLabel()` / `{ceremony}`; Today follows `cycle.ceremonies` and `preDailyLabel`; the prompt families fall back to `sdd` only for what a template lacks; spec, decision-log and document references in prompts are conditional on the cycle (`agents.ts:551,582`, `cyclePrompts.ts:131`).

What is not: (1) the daily ceremony's name in 30 renderer and core texts; (2) the Help screen lists ceremonies the cycle lacks (code site 17); (3) generic texts that say "spec", "Plan", "playbook", "QA", "Registro do Plan" for every cycle; (4) "weekly retro" and "last 7 days" next to a configurable window and a sprint retro; (5) the decision-log reference is `o {heading} do Plan` (`cycle.decisionLog.ref`): "Plan" is the SDD file name, not a config value. File names `<date>-pre-daily.md` (`minutesVersions.ts:206-208`, `workspaces-core.ts:24`, `minutesStore.ts`) are identifiers on disk and stay (iii), but `ui.help.data.minutesFile` shows one to the person.

**Class (i): 56 keys**

| Key | File:line | pt-BR → en | Driven by | Reaches |
|---|---|---|---|---|
| `cycle.decisionLog.ref` | `pt-BR.json:466` | o {heading} do Plan → the {heading} section of the plan | ceremonies, specLayout, enrichment | agent |
| `cycle.log.noHeading` | `pt-BR.json:520` | Plan sem seção {heading}: ficou só na ata → the plan has no {heading} section: it stayed in the minutes only | ceremonies, specLayout, enrichment | agent |
| `cycle.log.noPlan` | `pt-BR.json:519` | issue sem Plan: ficou só na ata → the issue has no plan: it stayed in the minutes only | ceremonies, specLayout, enrichment | agent |
| `cycle.notice.retroBody` | `pt-BR.json:533` | O resumo da semana está pronto para conversar. Clique para abrir. → The summary of the week is ready to talk about. Click to open. | {retroDays}, retro name | main text |
| `cycle.notice.retroTitle` | `pt-BR.json:532` | Retro da semana → Weekly retro | {retroDays}, retro name | main text |
| `cycle.sdd.meaning.readyForQa` | `pt-BR.json:497` | Pronta para o QA é a atividade com a revisão de código aprovada (ou d… → Ready for QA is an activity whose code review is approved (or that QA… | ceremonies, specLayout, enrichment | agent |
| `help.commands.intro` | `pt-BR.json:237` | Na pré-daily, o app lê a sua fala (sem acento e sem maiúscula) antes … → In the pre-daily, the app reads what you say (no accents, lower case)… | {ceremony} | screen |
| `help.commands.intro.novoice` | `pt-BR.json:238` | Na pré-daily, o app lê o que você digita (sem acento e sem maiúscula)… → In the pre-daily, the app reads what you type (no accents, lower case… | {ceremony} | screen |
| `help.preDaily` | `pt-BR.json:241` | Lê os cartões da fonte configurada e monta um agente por atividade, b… → Reads the cards from the configured source and builds one agent per a… | {ceremony} | screen |
| `help.preDaily.novoice` | `pt-BR.json:242` | Lê os cartões da fonte configurada e monta um agente por atividade, b… → Reads the cards from the configured source and builds one agent per a… | {ceremony} | screen |
| `help.shortcuts.intro` | `pt-BR.json:227` | Valem nas telas com microfone: call, desbloqueio, gate, passagem para… → They work on the screens with a microphone: call, unblock, gate, QA h… | ceremonies, specLayout, enrichment | screen |
| `help.shortcuts.intro.novoice` | `pt-BR.json:228` | Todas as telas funcionam por texto, com a voz desligada: a conversa d… → Every screen works by text while voice is off: the pre-daily chat, un… | {ceremony} | screen |
| `main.ata.whatWrite` | `main.pt-BR.json:353` | gravar no Plan ou na nota do cartão → write to the plan or to the card note | ceremonies, specLayout, enrichment | main text |
| `main.custo.kind.turn` | `main.pt-BR.json:534` | Pré-daily (agentes) → Pre-daily (agents) | {ceremony} | main text |
| `main.retention.kind.historico` | `main.pt-BR.json:232` | Histórico das pré-dailies → Pre-daily history | {ceremony} | main text |
| `main.tempo.label.pre-daily` | `main.pt-BR.json:549` | pré-daily → pre-daily | {ceremony} | main text |
| `main.watchers.stop` | `main.pt-BR.json:356` | Pare: decida com o revisor e registre no Plan. Não rode uma terceira … → Stop: decide with the reviewer and record it in the plan. Do not run … | ceremonies, specLayout, enrichment | main text |
| `minutes.delete.keptRegistro` | `minutes.pt-BR.json:72` | Decisões gravadas no Registro do Plan → Decisions written to the plan's decision log | ceremonies, specLayout, enrichment | main text |
| `prompt.sdd.discussion.specLine` | `pt-BR.json:454` | Spec em {folder} ({phase}); consulte o Plan se o ponto tocar o escopo. → Spec in {folder} ({phase}); consult the Plan if the point touches the… | ceremonies, specLayout, enrichment | agent |
| `prompt.sdd.options.rule` | `pt-BR.json:346` | "opcoes": de 0 a 3 respostas prontas, curtas (até 12 palavras), escri… → "opcoes" (options): 0 to 3 ready-made replies, short (up to 12 words)… | ceremonies, specLayout, enrichment | agent |
| `prompt.sdd.retro.base.gates` | `pt-BR.json:437` | quizzes de gate → gate quizzes | ceremonies, specLayout, enrichment | agent |
| `prompt.sdd.retro.focus` | `pt-BR.json:440` | Olhe processo, não pessoas: reprovações em revisão e em QA, bloqueios… → Look at process, not people: rejections in review and in QA, blockers… | ceremonies, specLayout, enrichment | agent |
| `prompt.sdd.retro.main` | `pt-BR.json:433` | Retro semanal {ofUser}, {mode}, de {from} a {to}. Você conduz. ⏎ Base… → {ofUser} weekly retro, {mode}, from {from} to {to}. You lead it. ⏎ Ba… | {retroDays}, retro name | agent |
| `settings.notifications.hint` | `pt-BR.json:191` | Hora da pré-daily, bloqueio novo (com convite para a call) e mudança … → Pre-daily time, new blockers (with an invitation to the call) and sta… | {ceremony} | screen |
| `settings.notifications.hint.novoice` | `pt-BR.json:192` | Hora da pré-daily, bloqueio novo (com convite para a conversa) e muda… → Pre-daily time, new blockers (with an invitation to the chat) and sta… | {ceremony} | screen |
| `ui.ata.decisions.hint` | `ui-docs.pt-BR.json:57` | Cada uma vai para a sua casa: Registro do Plan, nota do cartão ou só … → Each one goes to its home: the Plan log, a card note or just the minu… | ceremonies, specLayout, enrichment | screen |
| `ui.ata.prompt.effect` | `ui-docs.pt-BR.json:69` | Execute esta ação da pré-daily, pedindo o meu sim antes: {ref} ({repo… → Run this pre-daily action, asking for my yes first: {ref} ({repo}): {… | {ceremony} | screen |
| `ui.ata.prompt.effects` | `ui-docs.pt-BR.json:70` | Da minha pré-daily de hoje, ações para executar. Peça o meu "sim" ant… → From my pre-daily today, actions to run. Ask for my "yes" before each… | {ceremony} | screen |
| `ui.ata.title` | `ui-docs.pt-BR.json:83` | Ata da pré-daily → Pre-daily minutes | {ceremony} | screen |
| `ui.call.moderatorOpening` | `ui-call.pt-BR.json:56` | Abertura da pré-daily → Pre-daily opening | {ceremony} | screen |
| `ui.call.title` | `ui-call.pt-BR.json:86` | Pré-daily → Pre-daily | {ceremony} | screen |
| `ui.help.ceremonies.gate.text` | `ui-gate.pt-BR.json:168` | O agente lê o artefato da fase (Investigation, RFC, Spec Funcional, F… → The agent reads the phase artifact (Investigation, RFC, Functional Sp… | ceremonies, specLayout, enrichment | screen |
| `ui.help.ceremonies.others.text` | `ui-gate.pt-BR.json:170` | Retorno do QA explica uma atividade que voltou do teste. Discussões p… → QA return explains an activity that came back from testing. Discussio… | ceremonies, specLayout, enrichment | screen |
| `ui.help.ceremonies.preDaily` | `ui-gate.pt-BR.json:171` | Pré-daily → Pre-daily | {ceremony} | screen |
| `ui.help.data.specs.text` | `ui-gate.pt-BR.json:190` | Specs que o app lê e, nas escritas acima, onde grava o Registro do Pl… → Specs the app reads and, in the writes above, where it saves the Plan… | ceremonies, specLayout, enrichment | screen |
| `ui.help.never.local.text` | `ui-gate.pt-BR.json:203` | “Gravar ata e decisões” grava a ata do dia e leva só as decisões marc… → “Save minutes and decisions” saves the day’s minutes and takes only t… | ceremonies, specLayout, enrichment | screen |
| `ui.history.effectsPrompt` | `ui-today.pt-BR.json:116` | Ações da pré-daily, peça o meu "sim" antes de cada uma: → Pre-daily actions, ask for my "yes" before each one: | {ceremony} | screen |
| `ui.history.entryTitle` | `ui-today.pt-BR.json:118` | Pré-daily · {span} → Pre-daily · {span} | {ceremony} | screen |
| `ui.push.hint` | `ui-settings.pt-BR.json:21` | Os mesmos avisos que o app do computador mostra (bloqueios, mudança d… → The same alerts the desktop app shows (blockers, status changes, pre-… | {ceremony} | screen |
| `ui.quick.stageLabels` | `ui-docs.pt-BR.json:117` | Labels de etapa: {labels}. Revisão e QA movem os demais status. → Stage labels: {labels}. Review and QA move the other statuses. | ceremonies, specLayout, enrichment | screen |
| `ui.retention.hint` | `ui-settings.pt-BR.json:50` | Apaga o que o app guardou e já passou do prazo: sessões dos agentes, … → Deletes what the app stored that is past its deadline: agent sessions… | ceremonies, specLayout, enrichment | screen |
| `ui.retention.kind.historico` | `ui-settings.pt-BR.json:54` | Histórico das pré-dailies → Pre-daily history | {ceremony} | screen |
| `ui.retro.headingWeek` | `ui-docs.pt-BR.json:132` | Retro da semana · {week} → Weekly retro · {week} | {retroDays}, retro name | screen |
| `ui.retro.intro` | `ui-docs.pt-BR.json:135` | A retro junta as cerimônias, decisões, ações de release, quizzes de g… → The retro gathers the ceremonies, decisions, release actions, gate qu… | ceremonies, specLayout, enrichment | screen |
| `ui.settings.role.deep.hint` | `ui-settings.pt-BR.json:72` | Investiga a fundo, lendo spec, GitLab e playbook. Vale um modelo mais… → Investigates in depth, reading the spec, GitLab and the playbook. Wor… | ceremonies, specLayout, enrichment | screen |
| `ui.settings.role.turn.hint` | `ui-settings.pt-BR.json:80` | Monta a vez de cada atividade na pré-daily. É o papel mais chamado: u… → Builds each activity's turn in the pre-daily. It is the most called r… | {ceremony} | screen |
| `ui.settings.schedule.preDaily` | `ui-settings.pt-BR.json:92` | Aviso da pré-daily → Pre-daily reminder | {ceremony} | screen |
| `ui.settings.tool.files.hint` | `ui-settings.pt-BR.json:112` | Read, Grep e Glob no workspace (specs, rules, código). Arquivos de se… → Read, Grep and Glob in the workspace (specs, rules, code). Secret fil… | ceremonies, specLayout, enrichment | screen |
| `ui.today.foot` | `ui-today.pt-BR.json:232` | Cada agente é montado a cada cerimônia a partir do cartão do GitLab, … → Each agent is built at every ceremony from the GitLab card, the spec … | ceremonies, specLayout, enrichment | screen |
| `ui.today.preDaily` | `ui-today.pt-BR.json:265` | Pré-daily → Pre-daily | {ceremony} | screen |
| `ui.today.preDailyLabel` | `ui-today.pt-BR.json:266` | pré-daily → pre-daily | {ceremony} | screen |
| `ui.today.retroWeekly` | `ui-today.pt-BR.json:275` | Semanal, últimos 7 dias → Weekly, last 7 days | {retroDays}, retro name | screen |
| `ui.today.tempo.preDaily` | `ui-today.pt-BR.json:305` | pré-daily → pre-daily | {ceremony} | screen |
| `ui.today.testWorkspaceHint` | `ui-today.pt-BR.json:311` | Nada sai da máquina daqui: sem escrita no GitLab, no Plan das specs n… → Nothing leaves this machine from here: no writes to GitLab, to the sp… | ceremonies, specLayout, enrichment | screen |
| `ui.workspaces.test.hint` | `ui-settings.pt-BR.json:214` | Nada sai da máquina daqui: sem escrita no GitLab, no Plan das specs n… → Nothing leaves the machine from here: no writes to GitLab, to the spe… | ceremonies, specLayout, enrichment | screen |
| `wizard.cer.preDaily` | `wizard.pt-BR.json:299` | Pré-daily → Pre-daily | {ceremony} | screen |

**Class (iii): 280 keys, left as they are**

- `cycle.kanban.*` (2)
- `cycle.minimal.*` (2)
- `cycle.qa.*` (1)
- `cycle.scrum.*` (2)
- `cycle.sdd.*` (17)
- `main.actions.*` (3)
- `main.custo.*` (2)
- `main.feedback.*` (4)
- `main.gate.*` (10)
- `main.qa.*` (4)
- `main.retention.*` (4)
- `main.tempo.*` (3)
- `main.watchers.*` (4)
- `prompt.sdd.*` (55)
- `ui.gate.*` (61)
- `ui.help.*` (2)
- `ui.qa.*` (39)
- `ui.reentry.*` (30)
- `ui.today.*` (8)
- `wizard.cer.*` (4)
- `wizard.cycle.*` (23)

### Family f — other things configuration now decides

- **Summary target.** `devCycle.ceremonyParams.preDaily.summaryTarget` decides where the summary is pasted and the agent is told (`agents.ts:661`); the screens say "the team chat" and "the team daily" (rows below).
- **Retro window.** `ceremonyParams.retro.windowDays` (`retro.ts:113`) vs "last 7 days" on the screens.
- **Issue tracker vs code host.** There is one primary integration (`workspaceConfig`, `vcs/index.ts:64` `settingsOf`); a workspace whose issues are on one host and code on another is not supported by the cards, the quick actions or the feedback jobs. Texts say "issue" and "MR/PR" as if both were the same host. Nothing to drive until that is a feature (open question).
- **Playbook specifics.** `ui.retro.improvements.hint` ("IMPROVEMENTS.md belongs to the team ... on a `docs/<slug>` branch") describes one team's convention; it is in the public app for every cycle (row below, also under e).

**Class (i): 10 keys**

| Key | File:line | pt-BR → en | Driven by | Reaches |
|---|---|---|---|---|
| `cycle.summary.chat` | `pt-BR.json:462` | chat do time → the team chat | {summaryTarget} | agent |
| `minutes.day.teams` | `minutes.pt-BR.json:51` | Para a daily do time · dia inteiro → For the team daily · whole day | {summaryTarget} | main text |
| `minutes.version.teams` | `minutes.pt-BR.json:24` | Para a daily do time · versão {n} → For the team daily · version {n} | {summaryTarget} | main text |
| `ui.ata.teams.note` | `ui-docs.pt-BR.json:80` | Você cola no chat do time; nada é publicado daqui. → You paste it into the team chat; nothing is published from here. | {summaryTarget} | screen |
| `ui.ata.teams.title` | `ui-docs.pt-BR.json:82` | Para a daily do time → For the team daily | {summaryTarget} | screen |
| `ui.help.never.teams.term` | `ui-gate.pt-BR.json:204` | Publicar no chat do time → Posting to the team chat | {summaryTarget} | screen |
| `ui.qa.teams.note` | `ui-gate.pt-BR.json:245` | Você cola no chat do time; nada é publicado daqui. → You paste it into the team chat; nothing is published from here. | {summaryTarget} | screen |
| `ui.retro.intro` | `ui-docs.pt-BR.json:135` | A retro junta as cerimônias, decisões, ações de release, quizzes de g… → The retro gathers the ceremonies, decisions, release actions, gate qu… | {retroDays} | screen |
| `ui.settings.role.teams.hint` | `ui-settings.pt-BR.json:78` | Escreve o resumo para a daily do time. → Writes the summary for the team's daily. | {summaryTarget} | screen |
| `ui.today.retroWeekly` | `ui-today.pt-BR.json:275` | Semanal, últimos 7 dias → Weekly, last 7 days | {retroDays} | screen |

**Class (iii): 1 key, left as they are**

`main.ata.teams`

## Root cause

1. **No path from configuration to words.** The words were constants when the facts were constants. When the facts moved into configuration, only the *agent side* got a bridge, and only for two values (`vcsName()`, `ceremonyLabel()`), reachable through `baseParams()`; the same bridge does not exist for catalog texts shown by the renderer (it never sees the host) and the main-process catalogs use it only where a caller remembers to pass a parameter (7 of ~60 host-naming keys).
2. **The same word means two things in the code base.** `{mr}` is a ref and `{host}` an address in existing keys, so a quick fix with the obvious names would collide; and `!` is at once the MR ref marker in text, in keys and in parsers.
3. **Screens do not ask what the host or the cycle has.** The Today row, the Quick actions screen, the Settings tool switches and the Help list are static. `VcsCaps`, `vcsCliFor()` and `cycle.ceremonies` exist but only some call sites consult them, and `CycleView` does not carry the host facts to the renderer.
4. **The refs were written for one host** (`cards.ts:172`), and a few words are baked into logic rather than text (the pt-BR regex `MR_CONFLICT`, the `kind === 'gitlab'` rule for transitions, the `gitlabHint()` fallback for the shell hook).
5. **Nothing tests for it.** No test renders the catalogs for a non-GitLab host; the six goldens all use a GitLab-like host or none, so a leak is invisible to the suite.

## Proposed fix

### Shape of the mechanism

**One terms table, filled in one place, read in one place.**

1. **`terms`** (new `src/shared/i18n/terms.ts`, pure): `termsFor(config: WorkspaceConfig, language): Record<string,string>` and `DEFAULT_TERMS` per language. It is built from `vcs[]`/`projects.issues.vcsId` (kind), `devCycle` (ceremony label, retro window, summary target), `agents.tools`, `claudeCli`. The standard placeholders:

| Placeholder | GitLab | GitHub | Bitbucket | No integration (default) | Notes |
|---|---|---|---|---|---|
| `{vcsName}` | GitLab | GitHub | Bitbucket | the code host / o host de código | already used in 5 keys and in `baseParams()` |
| `{cr}` / `{crs}` | MR / MRs | PR / PRs | PR / PRs | MR / MRs | masculine in pt-BR (see risks) |
| `{crLong}` / `{crLongs}` | merge request(s) | pull request(s) | pull request(s) | merge request(s) | |
| `{crMark}` | `!` | `#` | `#` | `!` | for the ref written in a sentence; the ref itself comes from `crRef()` |
| `{ceremony}` / `{Ceremony}` | label of `preDaily` and its capitalised form | same | same | pré-daily / pre-daily | already in 8 keys (prompts, tray, minutes); now also for the screens |
| `{summaryTarget}` | `summaryTarget` text, else "o chat do time" / "the team chat" | | | | |
| `{retroDays}` | `retro.windowDays` | | | | |
| `{cli}` | glab | gh | the VcsRead tool / a ferramenta VcsRead | (empty) | what the agent read switch drives |

   Names avoid every placeholder that exists today (`{mr}`, `{mrs}`, `{host}`, `{vcs}`, `{ref}`, ...). `{vcs}` stays as an explicit param where it is (7 keys) and is migrated to `{vcsName}` in the same change.

2. **Filling.** `format()` in `src/shared/i18n/index.ts:46` resolves `{name}` from the call's `params` first and from the terms table second; `fill()` in `src/shared/cycles/text.ts:11` is the same function and should call it (they are duplicates today). An unknown placeholder still stays visible, so a typo shows on screen and in the leak test. `t()`, `tv()`, `cycleText()`, `renderLines()` and the prompt render all go through it, so *no call site changes*. `setTerms()` rebuilds like `setLanguage()` and bumps `i18nSnapshot()`, so `useT()` components re-render.

3. **Where it is set.**
   - Main: `workspaceConfig.ts:42-43` and `:68-69`, next to `setLanguage()` and `setVoiceEnabled()`: `setTerms(termsFor(config, config.language))`. Language changes call it again (terms depend on the language: the ceremony label and the default phrases).
   - Renderer: `buildCycleView()` (`src/shared/cycles/view.ts:31`) adds `terms` and `host` to `CycleView`; `cycleApi.ts` applies `view.terms` with `setTerms()` when the view loads and on the existing `cycle` and `config` events (`cycleApi.ts:38-41`): no new channel, and `cycle:view` is already open to the web client (`webPolicy.ts:29` restricts only `cycle:apply` and the template writers). First paint: `DEFAULT_TERMS` for the language (never a raw `{cr}`), plus the last terms cached in `localStorage` the way the language is (`i18n.ts:5-6,36-46`).

4. **Kind variants for sentences, not words.** A sentence whose grammar or content changes with the host gets a key variant `<key>.<kind>` (`vcs.card.ciFailed.github`), looked up before the plain key, like `NOVOICE_SUFFIX` (`i18n/index.ts:23,51`); the lookup order is `key + voice + kind`, `key + voice`, `key + kind`, `key`. Use it for the CI words ("pipeline" vs "checks" on GitHub: 11 keys of family c, class (i)) and nothing else; if the maintainer prefers one CI word for all hosts the variants are not needed (open question).

5. **Refs.** One helper `crRef(kind, project, iid)` in `src/shared/vcs.ts` (pure): `short(project) + '!' + iid` for GitLab and `short(project) + '#' + iid` for the others. Used at code sites 4-9. The three parsers accept `[!#]` (code sites in the family b notes); persisted state keyed by the old ref (the card baseline in `vcs-cards.json`, discussion file names built at `feedback.ts:368`) is either not user-visible or one day's diff, so no migration: the first status check after the update shows no MR changes for that day. Collision to test: on GitHub an issue and a PR cannot share a number, but `short()` drops the owner, so `a/app#7` and `b/app#7` already collide today; the new test pins that the PR and the issue ref of the same project never equal each other.

6. **Hide, from a `host` block of the view.** `CycleView.host = { kind, name, issueStatus, manualJobs, draftToggle, quickTransitions: boolean, cli: string | null, trackerMcp: boolean, engines: {role → 'claude-sdk'|'open'} }`, built from `VcsCaps`, `devCycle.quickTransitions`, `vcsCliFor()`, `agents.tools.trackerMcpServer` and `rc().role(r).engine`. Pure predicates in `src/shared/cycles/view.ts` (testable without a DOM; the suite has no React renderer): `showQuickActions(card, host)`, `showIssueStatus(host)`, `visibleTools(host)`, `showContinueInClaude(host, role)`, `ceremoniesListed(view)`. The screens call them; the screens keep no host `if`.

7. **Reword generic strings rather than parameterise them** where the SDD word is not a config value: "spec", "Plan", "playbook", "QA" in generic hints (Help, Settings, Today footer, test-workspace hints) become neutral phrasing or are shown only when the cycle has the thing (`specFolder`, a QA stage). `cycle.decisionLog.ref` ("o {heading} do Plan") drops "do Plan" (the heading is already the section's name).

### Why this shape and not per-call params

- Per-call (`t('ui.today.refreshGitlab', { vcs })`) needs the renderer to have `vcsName()` anyway (the same data pipe), touches one call site per key (about 110 keys in families a and b), and leaves each future key one forgotten parameter away from a raw `{vcs}` or a leak: it is the state of the main-process catalogs today, where it worked for 7 keys out of ~60.
- The central fill makes the placeholder *impossible to forget*, keeps GitLab text byte for byte (the placeholder's GitLab value is the old word), and lets one test cover every key.

### Prompt goldens

- `test/golden/legacy-prompts.json`, `legacy-prompts-novoice.json` (migrated profile: host GitLab), `same-day-prompts*.json` (same config): **unchanged**, by construction: every placeholder resolves to the word that is in the text today. If a golden changes, the change is wrong.
- `test/golden/en-prompts.json`, `en-prompts-novoice.json` (neutral config, SDD, no integration, Ana): **unchanged** as long as the default for "no integration" is "MR" (they mention "MR" on 19 lines each). If the maintainer chooses a neutral noun ("MR/PR"), these two change and are reviewed as one diff.
- No new golden for GitHub or Bitbucket: the proof for them is the leak test below (cheaper, and it covers the UI catalogs the goldens do not reach). If wanted, `parity()` already takes a `setup` for another config (`test/cycle-parity-en.test.ts`), so a `github-prompts.json` is one more file.
- The one prompt text that changes for **all** hosts is none; the ones that change for non-GitLab hosts are the `{cr}`/`{crs}`/`{crMark}`/CI keys (family b, c).

### How to test it

1. **Leak test** (`test/host-terms-leak.test.ts`, new). For `kind` in `github`, `bitbucket` × language in `pt-BR`, `en` × voice on and off: `setTerms(termsFor(config, language))`, then for **every** key of `CATALOGS[language]` (and each `.novoice` and kind variant) render it and fail on `/GitLab|\bglab\b|\bMRs?\b|merge requests?|work item|\w!\d|!\{/i`. Same for `gitlab` with `/GitHub|\bgh\b|pull requests?|\bPRs?\b|\w#\d/` limited to keys that carry a placeholder. A short `ALLOWED` list of keys that must name another host (the wizard's kind labels, `prompt.sdd.vcs.*.gitlab/github`, `vcs.validate.*Graphql`, the `cycle.githubFlow.*` template, the "all three hosts" enumerations) each with a reason, and a check that every entry still exists so the list cannot rot. Prompt layer: render every id of `promptFamilies()` through `renderPrompt` with `baseParams()` for the same matrix. This test fails today on every row of class (i) and shrinks the allow-list as the commits land.
2. **`termsFor` table test** (`test/terms.test.ts`): each kind × language gives the values of the table above; "no integration" gives the defaults; a custom `preDaily.label` literal flows to `{ceremony}`; no placeholder of the standard set is left unresolved by `DEFAULT_TERMS`.
3. **Placeholder inventory test**: every `{name}` in the catalogs is either in the standard set or in a short list of per-call params per key prefix (so a typo is caught); extends `test/i18n.test.ts`.
4. **Ref tests**: `crRef` for the three kinds; `parseMrRef` and the `actions.ts:550` regex accept both marks; `vcs-cards.test.ts` gets a GitHub case asserting `app#7` in `mrs`, `mrPaths[].ref`, blockers and pending.
5. **Hide predicates** (`test/host-view.test.ts`): `buildCycleView` for each kind: `showQuickActions`, `showIssueStatus`, `visibleTools` (the agent read switch stays whenever there is an integration and is labelled by host and CLI; no tracker MCP switch without a server), `showContinueInClaude` for `open` vs `claude-sdk`, `ceremoniesListed` for kanban vs sdd.
6. **Source guard** (extend `scripts/i18n-lint.mjs` or a test): fail on an `i18n-ignore` line in `src/renderer` containing `GitLab|GitHub|Bitbucket|\bMRs?\b` (except the audit `KIND` map), and on a template literal matching `` `${...}!${...}` `` outside `crRef`.
7. **Regression**: `npx vitest run test/cycle-parity*.test.ts test/cycle-parity-en*.test.ts test/same-day*.test.ts` must pass **without** `UPDATE_GOLDEN`; then the whole suite, `npx tsc --noEmit`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

None of these touches a model, a host or the network (fakes in `test/helpers/`).

### Order of work (one logical change per commit)

1. terms module, `setTerms`, `DEFAULT_TERMS`, central fill, `CycleView.terms` and `host`, with the leak test in place and its allow-list holding every current offender (the test is red-free and each later commit removes entries).
2. family a and b catalogs (`{vcsName}`, `{cr}`, `{crs}`, `{crLong}`, `{crMark}`), pt-BR gender normalisation, code sites 1-3, 10, 20.
3. refs (`crRef`, the parsers, code sites 4-9) with the ref tests.
4. host-only features: code sites 13-16, 22, hide predicates and tests; code sites 11 and 12 (agent side, with a `vcs-read-policy` test).
5. cycle words (family e, f): `{ceremony}` in the screens, the Help list, the generic strings, the retro window, the summary target.
6. leave `MR_CONFLICT` (code site 21) to its own issue unless the maintainer wants it here (it became #20 and is fixed).
7. docs and changelog: the placeholder list in `docs/cycles.md` and rule 3 of `docs/i18n.md` (standard placeholders and how a call overrides them), `docs/vcs-providers.md` (what each host shows), and one line under `## [Unreleased]` in `CHANGELOG.md`.

## Hide, do not rename

| Feature | Hide when | Where | Today |
|---|---|---|---|
| Issue status block, stage-label line and the transitions on the Quick actions screen | `quickTransitions` is empty or the host has no issue status (GitHub; Bitbucket has the state but no rule) | `QuickActions.tsx:154-163`, `gitlabQuick.ts:29-31` | shown, with "no status" |
| Manual CI job buttons and the `jobs manuais` notices | `caps.manualJobs` false (GitHub, Bitbucket) | `QuickActions.tsx` (already data-gated), `main.quick.manyBody`, `vcs.card.ciManual` | buttons gated; notice text mentions jobs |
| "Choosing another reviewer replaces the current ones" and the replace detail | host is not GitLab (GitHub adds reviewers) | `ui.quick.reviewer.replaces`, `gitlabQuick.ts:246` | note shown on every host |
| The whole Today "host" button | the card has no change request and no allowed transition | `TodayParts.tsx:214` | always |
| Agent read switch (`glab` in the code) | no integration at all; with one it stays and is renamed (it governs `gh`, or the `VcsRead` tool) | `Settings.tsx:34` | always, labelled GitLab |
| Tracker MCP switch | `agents.tools.trackerMcpServer` is empty (the default) | `Settings.tsx:33` | always |
| `quickTransitions` editor and its `id` | host is not GitLab | config schema, wizard | documented as GitLab |
| "Continue in Claude Code" button and the sentences that send the person there | the role's engine is `open` | 11 files, 21 keys | always |
| Ceremonies in the Help screen (Gate, QA hand-off, Retro, "QA return", Radar when relevant) | `cycle.ceremonies[x]` false or the cycle has no QA stage / spec folder | `Ajuda.tsx:83-91` | always |
| Generic "spec", "Plan", "playbook", "gate", "QA" sentences | the cycle has no spec folder, gate or QA stage | the class (i) rows of family e | always |

## Risks

- **Gender in pt-BR.** The catalog already mixes "o MR" ("do MR", "um MR novo") and "a MR" ("Uma MR parte da branch", "as MRs", "MR nova", "Nenhuma colisão entre as MRs"). A placeholder cannot carry the article. Normalising to masculine ("o PR" and "o MR" both read naturally) changes about 10 pt-BR UI strings of a GitLab workspace (radar, minutes); no prompt golden is affected. Reword instead of agreeing where possible ("MR nova: x" becomes "novo {cr}: x").
- **Refs.** Changing the separator touches persisted keys (one day's change baseline and `mrPaths[].ref` in saved history; both only matter within the day) and three parsers. The risk is a string-based `isIssueRef` treating `app#7` of a PR as an issue ref: it is only called on `card.ref` (always an issue), and the ref test pins it.
- **First paint.** The renderer renders before `cycle:view` answers; without defaults a raw `{cr}` would flash. `DEFAULT_TERMS` and the cached terms remove it; the leak test also asserts the defaults resolve every standard placeholder.
- **Language switch** changes the ceremony label and the default phrases; terms must be rebuilt on `setLanguage` as well as on config save (both paths in `workspaceConfig.ts`).
- **Prompt classification.** `openersOf` builds recogniser regexes from the catalog line start (`prompts.ts:60-100`): a placeholder at the start of the first line is treated as "any short text", so adding `{cr}` there keeps working; the existing parity tests in `test/cycle-prompts.test.ts` pin it.
- **`.novoice` and kind variants** multiply keys; the placeholder test must check both variants keep the same placeholders (the voice test does this for `.novoice` already).
- **Do not "fix" by search and replace.** `MR` appears in identifiers on purpose (`mr_*` effect kinds, `mrs`, `mrPaths`, `VcsMr`, `listMyMrs`); only text changes.
- **A host's own words stay.** "Draft" as a GitLab title prefix, "STAGE::" scoped labels, "work item" in the GraphQL validator message: they are GitLab's, shown only on GitLab.

## Open questions for the maintainer

1. **No integration, no card source: which noun?** Keeping "MR" (the app's historic word, goldens unchanged) or a neutral "MR/PR" ("merge/pull request")? It decides whether the two English goldens change.
2. **CI word on GitHub:** one neutral word for all hosts ("CI"; in pt-BR "CI falhou" instead of "Pipeline falhou", which changes a GitLab string) or per-kind variants (`.github`: "checks")? Variants keep GitLab untouched and cost about 11 keys.
3. **Portuguese gender:** is "o MR" / "o PR" the form you want everywhere (the prompts already say so)?
4. **Open engine and "Continue in Claude Code":** hide the button for sessions of the open engine (the proposal), or support resuming them some other way? Reading the code says it cannot work today; I did not run it.
5. **Issue tracker on one host, code on another:** the cards and jobs use only the primary integration. Is a split meant to be supported soon (then "issue" and "PR" need different host words) or is one host the model?
6. **Ceremony names beyond the first:** only the daily ceremony has a configurable label. Do Gate, Unblock, QA hand-off and Retro need one too (the Scrum template would call it "sprint retro", the Kanban one "flow retro"), or is it enough that the screens stop saying "weekly"?
7. **`MR_CONFLICT` regex** (code site 21): fix here (conflict detection by a field, not by a pt-BR sentence) or in its own issue? It is why the "Resolve conflict" button cannot appear for provider-built cards. (Answered: its own issue, #20, now fixed.)
8. **`ui.retro.improvements.hint`** describes one team's conventions (`IMPROVEMENTS.md`, `docs/<slug>`): neutralise it here, or leave it with the SDD template?
9. **Summary target:** should the screens that say "paste it into the team chat" show the configured target, or stay generic?
