# Decoupling inventory

Every company-specific or machine-specific assumption the app carried when it was a personal tool, where it lived, what replaces it, and which phase owns what is still open.

- **Line numbers.** Items marked *replaced* cite the line in the commit before phase 0 (`bf379f5`); the code at that line no longer exists in that form. Items marked *open* cite the current tree.
- **Replacement** is a field of `WorkspaceConfig` v2 (`src/shared/config/types.ts`), read through `rc()` / `getConfig()` in `src/main/workspaceConfig.ts`.
- **Behavior for the existing user** is unchanged: the migration (`src/shared/config/legacy.ts` + `migrations.ts`) writes the old values into the config of every workspace that existed before, so each *replaced* row below resolves to exactly what the constant was. A fresh install gets the neutral value (empty, `null`, or off).
- **Phases** (the next agents): `wizard` (setup UI and settings screens), `vcs` (GitLab/GitHub/Bitbucket providers), `devcycle` (dev-cycle templates, ceremonies, stage mapping), `engine` (open engine and provider UI), `voice` (voice-optional mode), `i18n` (string extraction, translated prompts), `packaging` (public packages, updates, installers).

## 1. Replaced in phase 0

### Paths and folders

| Where (base) | What it was | Replaced by | Fresh install |
|---|---|---|---|
| `src/main/env.ts:8` | `WORKSPACE = ~/projects`: working directory of every agent, search root for clones, transcripts folder | `projects.roots[0]` (`rc().projectsRoot`); clones: `rc().cloneRoots` | first root, or the workspace folder (never `$HOME`) |
| `src/main/env.ts:9` | `PLAYBOOK = ~/projects/sz-playbook` | `docs.*` dirs; `externalTools.releaseSync.cwd` | none |
| `src/main/env.ts:10`, `gate.ts:272,314`, `qa.ts:112`, `cards.ts:29` | `SPECS = <playbook>/.specs` | `docs.specsDir` (`CERIMONIAS_SPECS_DIR` still wins) | `null`: no spec features |
| `src/main/worktrees.ts:11,95,174` | `REPOS = [sz4, sz4-frontend, sz4-backend, new-agent, hub-whatsapp, agent-socket-manager, sz-playbook]` under `WORKSPACE` | `projects.repos[]` (`id`, `path`, `remoteUrl`, `vcsId`, `projectPath`); `projects.autoDiscover` for the later scan | empty list; the radar job is disabled |
| `src/main/custo.ts:13`, `retention.ts:32` | transcripts dir `~/.claude/projects/<WORKSPACE with / as ->` | derived from `projectsRoot` (`rc().transcriptsDir`; `CERIMONIAS_TRANSCRIPTS_DIR` still wins) | follows the agents' cwd |
| `src/main/conflictVerify.ts:9`, `agents.ts:41` | `~/.cache/post-release-sync` (mirror folder; the shell allow-list regex hardcoded it) | `externalTools.releaseSync.mirrorsDir`; allow-list built by `gitMirrorRead(dir)` | no mirrors, no regex |
| `src/main/store.ts:64`, `watchers.ts:18-19`, `retro.ts:78` | `~/.local/share/daily-report/{state.json,history.jsonl}` | `externalTools.cardSource.stateFile` / `.historyFile` | `null` |

### External tools (all optional now)

| Where (base) | What it was | Replaced by | Fresh install |
|---|---|---|---|
| `env.ts:11`, `report.ts:51` | `~/.local/bin/daily-report report --format json --dry-run`: the only source of cards | `externalTools.cardSource` (`command`, `reportArgs`, `timeoutMs`) | off: the day has no cards, no error |
| `store.ts:78` | `daily-report note <ref> <text>` | `cardSource.noteArgs` with `{ref}` and `{note}` | not written back |
| `actions.ts:32,95` | `<playbook>/.claude/bin/post-release-sync` run with cwd = playbook | `externalTools.releaseSync` (`command`, `cwd`, `mirrorsDir`) | off: no release scan, job not run |
| `claude.ts:24`, `shared/claude-command.ts:13,19,20` | `gnome-terminal --title ... -- bash -lc "cd ~/projects && claude-or --resume ..."` | `externalTools.terminal` (`command`, `args`), `externalTools.claudeCli` (`command`, `cwd`); the pasted command comes from the main process (`claude:command`) | `claude` in the workspace folder; auto-detect terminal |
| README, `tempo-core.ts:61,184`, `TempoHoje.tsx:12,62` | `clockify-log` export format | `externalTools.timeExport` (`format: 'clockify-log'`) | off (the day file is still written) |

### Git host and issue tracker

| Where (base) | What it was | Replaced by | Fresh install |
|---|---|---|---|
| `env.ts:18` and 9 call sites (`efeitos.ts:191`, `radar.ts:241`, `watchers.ts:210`, `gitlabQuick.ts:78`, `feedback.ts:79`, `actions.ts:104,208`, `saude.ts:143`) | `GITLAB = 'dark.smartzap.com.br'`, passed as `GITLAB_HOST` to every `glab` call | `vcs[].host` (`rc().vcsHost`, `vcsCliEnv()`); `vcs[].cliCommand`, `cliPreference` | no host: calls that need one fail with a named reason; GitLab jobs not run |
| `gitlabQuick.ts:13`, `actions.ts:34`, `feedback.ts:31` | `ISSUE_PROJECT = 1` | `projects.issues.projectId` / `.project` (`issueProjectRef()`) | `null` |
| `efeitos.ts:19`, `qa.ts:42,48`, `gitlabQuick.ts:150`, `feedback.ts:128,321` | `sz4/sz4` (project path, GraphQL `fullPath`, issue URLs) | `projects.issues.project` (`issueWebUrl()`, `issueProjectPath()`) | `null` |
| `gitlabQuick.ts:172`, `feedback.ts:125,216,318`, `agents.ts:506,633`, `actions.ts:436`, `tempo-core.ts:113`, `retention-core.ts:23`, `custo-core.ts:14` | the `sz4#` card ref prefix | `projects.issues.refPrefix` (`isIssueRef()`, `issueRef()`); classifiers no longer depend on it | empty prefix |
| `feedback.ts:30`, `actions.ts:35`, `qa.ts:42,48`, `agents.ts:507` | `qa.interno` (QA account) and the `@qa.interno` marker | `devCycle.qa.user` (`qaUser()`, `qaNoteMarker()`) | `null`: no QA hand-off notes |
| `watchers.ts:236` | version label `^sz4-\d+\.\d+\.\d+$` | `devCycle.releaseLabelPattern` (group 1 = version shown) | `^v?(\d+\.\d+\.\d+)$` |
| `agents.ts:14-18,218-221`, `settings.ts:53`, `Settings.tsx` | `mcp__gitlab-issue-analysis__*`, `Bash(glab ...)` rules, the GitLab reading hint | `agents.tools.trackerMcp` + `trackerMcpServer`, `agents.tools.vcsCli` (only when the primary integration is GitLab with its CLI) | server name empty: no MCP tools |

### Models, keys and providers

| Where (base) | What it was | Replaced by | Fresh install |
|---|---|---|---|
| `env.ts:38`, `saude.ts:154` | runs `~/.local/bin/openrouter-key` to get the key | secrets store, source `command` (seeded for existing installs under `llm.openrouter`) | key from the secrets store (`stored`, `command` or `env`) |
| `env.ts:49`, `saude.ts:188-190`, `custo.ts:12` | `https://openrouter.ai/api` and the `/v1/messages` health call | `llm.providers[].baseUrl`; health check posts to `<baseUrl>/v1/messages` for `anthropic` kind | Anthropic API |
| `env.ts:26` | `~/.claude/openrouter.settings.json` profile env | `llm.providers[].envFile` | `null` |
| `settings.ts:44-51`, `agents.ts:298` | model ids `deepseek/...`, `qwen/...`; one model per role | `llm.roles[role] = { provider, model }`, provider list `llm.providers[].models` | `haiku` / `sonnet` on Anthropic |
| `agents.ts:297-305` | one hardcoded engine: Claude Agent SDK with an OpenRouter base URL | `llm.providers[].engine` (`claude-sdk` or `open`), `engineFor(role)` in `engine/registry.ts`; migrated install keeps `legacyCustomEndpoint: true` | no custom endpoint offered |
| `agents.ts:235,302` | the role preamble and system prompt | `agents.roles[role].promptOverride` / `.extraInstructions`, `agents.extraInstructions`; `agents.roles[role].modelRole` | empty |
| `package.json` dependency | the SDK bundled in every build | `claudeSdk { installed, version, path }`, `locateSdk()` and `loadClaudeQuery()` in `claudeSdk.ts` | bundled until packaging changes |

### Development cycle

| Where (base) | What it was | Replaced by | Fresh install |
|---|---|---|---|
| `cards.ts:7-19` | phase from the files in the spec folder (`0_BUG_REPORT.md`, `2_PLAN.md`, `ISSUE_COMPLETION.md` ...) | `devCycle.specLayout.phaseFiles`, `.planFiles`, `.folderPrefix` (`#{iid}-`) | empty |
| `gate.ts:55-59,169`, `qa.ts:86`, `watchers.ts:84,92` | gate artifacts per `bug/feat/investigation`, `GATE_QUIZ.md`, `QA_CHECKLIST.md` | `devCycle.specLayout.gateFiles`, `.documents.{gateQuiz,completion,qaChecklist}` | empty gate list |
| `radar.ts:42-45` | stage names and weights (`Code Review OK`, `Ready To Test` ...) | `devCycle.stages[]` (`match`, `kind`, `rank`; `stageWeight()` reads them) | empty: weight 0 |
| (none) | which ceremonies exist | `devCycle.ceremonies.*` flags | pre-daily, unblock, gate, retro on |

### Settings and browser access

| Where (base) | What it was | Replaced by |
|---|---|---|
| `config.ts` | flat `Settings` file per workspace | `WorkspaceConfig` v2 in the same `config.json`; `Settings` is now a derived view (`settingsView.ts`); v1 file kept as `config.v1.json` |
| `settings.ts:62-68`, `webAccess.ts:24` | web defaults `172.18.0.1`, `https://koala.fortics.dev/cerimonias/`, `172.18.0.0/16`; VAPID fallback to that URL | loopback defaults (`NEUTRAL_WEB`); the old values are written to `web.json` of an existing install; fallback subject `https://localhost/` |
| `scheduler.ts` | status and release jobs always ran | run only with a card source / release tool; `Job.enabled` gates the GitLab jobs |

## 2. Open: owned by a later phase

### Git host behavior (`vcs`)

| Where (now) | What | Phase |
|---|---|---|
| `src/main/gitlabQuick.ts:22-37` | `RULES`: status transitions with GitLab custom status ids (`75`, `77`, `6`) and `STAGE::` labels | vcs + devcycle: from `devCycle.stages` and per-provider status mapping |
| `src/main/gitlabQuick.ts:150`, `feedback.ts:128` | GitLab work-item GraphQL | vcs (GitHub issues/Projects, Bitbucket equivalents) |
| `src/main/actions.ts:104,208-211` | `glab` and `glab config get token` + curl with `PRIVATE-TOKEN` | vcs: API client keyed by `vcs[].secretRef` |
| `src/main/agents.ts:34-38` | `GLAB_READ` shell allow-list regexes (glab only) | vcs: per-provider read allow-list |
| `src/main/conflictFromMr.ts`, `conflictGit.ts:61` | MR shape, "clone whose origin is that project" | vcs |
| `src/main/actions.ts:513` | strips `/post-release-sync/` from a mirror path | vcs / release tool contract |
| `src/main/efeitos.ts:120-130`, `src/shared/efeitos.ts:25` | verification kinds described in GitLab terms and `STAGE::Ready to test` | vcs |

### Cycle, stages and documents (`devcycle`)

| Where (now) | What | Phase |
|---|---|---|
| `src/main/radar.ts:52` | noise rule `^\.specs\/` | devcycle (from `docs.specsDir`) |
| `src/renderer/src/dashboard.ts:237,254`, `screens/Today.tsx:37`, `Actions.tsx:82` | stage regexes (`Test Fail`, `Code Review OK`, `Ready To Test`) and `STAGE::` stripping | devcycle: use `devCycle.stages` in the renderer |
| `src/main/feedback.ts:213,232` | `Test Fail` / `Failed testing` (the returned-from-QA signal) | devcycle (`kind: 'returned'`) |
| `src/main/feedback.ts:347-360`, `gate.ts:148,230`, `retro.ts:108-111`, `qa.ts:47` | prompts that cite agent-pipeline sections, `ISSUE_COMPLETION`, `Plan`, `IMPROVEMENTS.md`, `qa-release-branch`, `testar-atividade-gitlab` | devcycle + i18n: prompt templates per dev-cycle template |
| `src/main/gate.ts:341` | the text written at the top of a new `GATE_QUIZ.md` (cites `@skills/agent-pipeline`) | devcycle |
| `src/main/store.ts:41-56`, `src/shared/destination.ts:5`, `src/shared/types.ts:66` | the `spec` / `daily-report` / `ata` decision targets and "Registro" heading | devcycle |
| `src/renderer/src/screens/Gate.tsx:183,200,298,300`, `QaHandoff.tsx:99,141,143,150,169`, `Deep.tsx:184` | `.specs`, `GATE_QUIZ.md`, `ISSUE_COMPLETION`, `@qa.interno`, `Teams` in UI text | i18n + devcycle |

### Personal and company wording (`i18n`, `wizard`)

| Where (now) | What | Phase |
|---|---|---|
| `src/main/agents.ts:278-290,493,520-523,560,575,595,630-633`, `feedback.ts:347-480`, `gate.ts:148-232`, `qa.ts:103`, `retro.ts:107-147` | prompts address "o Luiz" and describe Teams, GitLab, the playbook | i18n: user name from config, per-language prompt files; `agents.*.promptOverride` already replaces the preamble |
| `src/main/custo-core.ts:12-13`, `retention-core.ts:19-28` | regexes that classify the app's own prompts by their first words ("Retro semanal do Luiz", "Escreva o texto que o Luiz vai colar no Teams") | i18n: classify by an explicit tag the prompt carries, not by wording |
| `src/renderer/src/screens/Today.tsx:96` | greeting `..., Luiz` | wizard: `user.displayName` |
| `src/renderer/src/screens/Ajuda.tsx:85-132`, `Today.tsx:189`, `Settings.tsx:23-30,204,240`, `WorkspacesSection.tsx:80` | help and hints naming `daily-report`, GitLab, the playbook, `~/projects/sz-playbook/.specs/`, Teams | i18n |
| `src/renderer/src/screens/Ata.tsx:37,110,181,194,197`, `QaHandoff.tsx:150-154`, `src/shared/custo.ts:12`, `minutes.ts:19` | the "Teams text" feature (a daily message for a chat product) | devcycle: make the summary target configurable (Teams, Slack, plain text) |
| `src/shared/glossary.ts:17-32,46,74`, `Glossario.tsx:30`, `Settings.tsx:204` | default pronunciations for `sz4`, `sz-playbook`, `Teams`, `hub-whatsapp` | voice + wizard: glossary seeded from the repos and stages of the config |
| `src/shared/errorlog.ts:52-63` | error hints that name `dark.smartzap`, `glab`, `openrouter-key`, OpenRouter | i18n + vcs/engine |
| `src/renderer/src/conflictVerifyDefaults.ts:4-7` | per-project verification commands for `sz4/sz4`, `sz4/sz4-backend`, `sz4/reports-consumer`, `sz4/agent-socket-manager` (docker, nvm 18) | wizard: suggestions from the configured repos, no company defaults |

### Models and cost (`engine`)

| Where (now) | What | Phase |
|---|---|---|
| `src/main/custo.ts:12,93`, `custo-core.ts:74`, `src/shared/custo.ts:44`, `Custo.tsx:204,268` | the cost screen reads OpenRouter's `/key` and `/generation` endpoints | engine: provider-neutral usage (the open engine records tokens itself); screen hidden without an OpenRouter provider (`openRouterProvider()` returns `null`) |
| `src/main/saude.ts:37-38,220-221`, `src/shared/saude.ts:13` | dependency ids `openrouter-key`, `daily-report`, `glab` | wizard: health items derived from the config |
| `src/main/llm-core.ts` | the environment variables for Bedrock, Vertex and Foundry are written from the Claude Code documentation and **not exercised against a live cloud account** | engine |

### Voice and machine (`voice`, `packaging`)

| Where (now) | What | Phase |
|---|---|---|
| `sidecar/voice_sidecar.py:26` | recognition prompt biased to `hub-whatsapp, new-agent, sz4` | voice (from the glossary/config) |
| `sidecar/voice_sidecar.py:29-30` | `~/projects/hermes-poc/vendor/kokoro` as a Kokoro model location | voice |
| `src/main/venv.ts:14-15` | looks in `~/.local/bin` first | packaging |
| `config.voice.enabled` | stored, but **nothing reads it yet**: the sidecar still starts and the screens still say "call" | voice |
| `src/main/update.ts:38,94-107`, `scripts/update.sh`, `scripts/install-local.sh` | updates by `git pull` + rebuild of `~/projects/cerimonias`, AppImage in `~/.local/opt/cerimonias`, `cerimonias.desktop` autostart | packaging |
| `electron-builder.yml:1,24`, `package.json:42-43` | `appId br.com.fortics.cerimonias`, maintainer, homepage `dark.smartzap.com.br` | packaging |
| `README.md` | the whole README describes the personal setup (paths, daily-report, Clockify, OpenRouter) | wizard + packaging: rewritten for open source |
| `src/main/retention-core.ts:23`, `src/main/watchers.ts:229` comments | examples that cite the company repos | cleanup |

## 3. Highlights (the fifteen that mattered most)

1. `GITLAB` host and `ISSUE_PROJECT` / `sz4/sz4` in nine modules.
2. `~/.local/bin/openrouter-key` as the only way to get the key.
3. OpenRouter base URL as the only route to a model, through an SDK that does not support non-Claude models.
4. `WORKSPACE = ~/projects` as cwd, clone root, transcripts folder and repo root.
5. `~/.local/bin/daily-report` as the only source of cards.
6. `<playbook>/.claude/bin/post-release-sync` and its `~/.cache` mirrors, also baked into a shell allow-list regex.
7. The SDD file names (`0_BUG_REPORT.md` ... `GATE_QUIZ.md`) deciding the card phase and the gate artifacts.
8. `qa.interno` and the `sz4#` ref prefix.
9. `claude-or` + `gnome-terminal` for "continue in Claude Code".
10. The stage vocabulary (`STAGE::`, `Code Review OK`, `Test Fail`) in the radar, quick actions, feedback and the dashboard.
11. Web defaults pointing at a private tunnel and docker bridge.
12. Prompts addressed to "o Luiz", with Teams and the playbook in the text, and classifiers that match that wording.
13. Model ids (`deepseek/...`) as the only choices in the picker.
14. Per-project verification commands for the company repos shipped as defaults.
15. Update and install scripts tied to `~/projects/cerimonias` and the author's AppImage layout.
