# Configuração / Configuration

[Português](#português) | [English](#english)

---

## Português

Esta é a fundação de configuração do Coxia (fase 0). Tudo que antes estava fixo no código (a empresa, a máquina, o fluxo de trabalho) vive agora em um documento versionado por workspace: o `WorkspaceConfig` v2. O inventário do que foi desacoplado, e do que falta, está em [`decoupling-inventory.md`](decoupling-inventory.md). Provedores e motores de agente: [`llm-providers.md`](llm-providers.md). Provedores de VCS (GitLab, GitHub, Bitbucket): [`vcs-providers.md`](vcs-providers.md).

### Onde as coisas moram

| O quê | Onde | Escopo |
|---|---|---|
| Configuração | `<dados>/workspaces/<id>/config.json` (v2, `schemaVersion: 2`) | por workspace |
| Segredos (referências resolvidas) | `<dados>/secrets.json` (modo 0600), por `secretRef` | máquina; **nunca exportado** |
| Acesso pelo navegador | `<dados>/web.json` | máquina (todos os workspaces) |
| Marcador da migração | `<dados>/config-migration.json` | máquina |
| Config antiga (v1) | `config.v1.json` ao lado do `config.json` | cópia de segurança |

"Várias configurações" = vários workspaces. Trocar de workspace reabre o app. Exportar e importar levam só a configuração de um workspace, nunca o histórico.

### O modelo

`src/shared/config/types.ts` documenta cada campo; `schema.ts` emite o JSON Schema (`config:schema`), que também valida a importação. Um teste (`test/config-schema.test.ts`) falha se tipos, schema e padrões divergirem.

| Seção | O que decide |
|---|---|
| `schemaVersion`, `setupComplete`, `language` | versão, se o assistente já terminou (`false` em instalação nova), idioma (`pt-BR` ou `en`) |
| `appearance`, `notifications`, `closeToTray`, `retention`, `schedule` | as configurações que já existiam |
| `llm.providers[]` | `{ id, kind, engine, baseUrl, models, secretRef, envFile, options, capabilities, structured, headers, ..., legacyCustomEndpoint }`. `kind`: `anthropic`, `bedrock`, `vertex`, `foundry`, `openai-compatible`. `engine`: `claude-sdk` (modelos Claude) ou `open` (loop próprio, OpenAI-compatível e local) |
| `llm.roles` | por papel (`turn`, `reply`, `deep`, `teams`, `fix`): `{ provider, model }` |
| `projects` | `roots[]`, `repos[]` (`id`, `path`, `remoteUrl`, `vcsId`, `projectPath`), `autoDiscover`, `issues` (projeto de issues, prefixo dos cartões) |
| `vcs[]` | integrações `gitlab` / `github` / `bitbucket`: `host`, `apiUrl`, `user`, `secretRef`, `cliPreference`, `cliCommand` |
| `docs` | fontes de contexto no estilo Claude Code: `claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`, `mcpConfigFiles`, `specsDir`; `autoDetect` acrescenta `~/.claude` e `<projeto>/.claude` |
| `devCycle` | `templateId`, `ceremonies` (liga/desliga cada cerimônia), `stages[]` (nome → tipo e posição no fluxo), `specLayout` (pasta da issue, arquivos que dizem a fase, artefatos dos gates), `qa.user`, `releaseLabelPattern` |
| `agents` | `tools`, `extraInstructions` (todos), `roles[papel]` = `{ modelRole, extraInstructions, promptOverride }` |
| `voice` | `enabled`, `engine`, `sttModel`, `depsInstalled` e os ajustes que já existiam |
| `claudeSdk` | `{ installed, version, path }`: de onde sai o Claude Agent SDK |
| `externalTools` | integrações **opcionais**, todas desligadas até serem configuradas: `cardSource` (comando que lista os cartões do dia), `releaseSync`, `timeExport`, `terminal`, `claudeCli` |

Caminhos usam `~/` quando estão sob a home, para a configuração ser portátil. O acesso pelo navegador (host, porta, URL pública) é da máquina e fica em `web.json`.

### Instalação nova × instalação existente

- **Nova** (pasta de dados vazia): configuração neutra, `setupComplete: false`. Nenhum host, repositório, usuário de QA, ferramenta externa ou caminho `sz4`. O modelo padrão é a API da Anthropic (`haiku`/`sonnet`), com a chave referenciada por `llm.anthropic`. Sem projeto configurado, o agente trabalha na pasta do workspace, nunca na home.
- **Existente**: a migração (`src/shared/config/migrations.ts`, `legacy.ts`) constrói o v2 a partir do `config.json` antigo e das constantes que o app tinha. Vale para **todos** os workspaces que existiam, mesmo sem `config.json`. O arquivo antigo fica em `config.v1.json`. O perfil antigo (OpenRouter, GitLab da empresa, `~/projects`, daily-report, SDD) mora em um único arquivo: `legacy.ts`. A fonte do segredo `llm.openrouter` passa a ser o comando `~/.local/bin/openrouter-key`, então a chave não é copiada. Workspaces criados depois da atualização são neutros.
- Um campo inválido num arquivo antigo é trocado pelo padrão (com nota no log), nunca trava o workspace. Um arquivo escrito por uma versão mais nova do app é recusado.

Decisões do produto já refletidas:

1. **Dois motores.** `claude-sdk` só para modelos Claude (Anthropic, Bedrock, Vertex, Foundry); `open` para OpenAI-compatível e local. Login de assinatura do claude.ai nunca é oferecido: só chave de API ou credenciais de nuvem.
2. **Config migrada mantém o comportamento de hoje:** OpenRouter + deepseek pelo SDK, marcado `engine: 'claude-sdk'` e `legacyCustomEndpoint: true`. Uma instalação nova não oferece essa combinação (a validação avisa).
3. **O SDK não vem junto nos pacotes públicos:** `claudeSdk` registra a instalação e `src/main/claudeSdk.ts` (`locateSdk`, `loadClaudeQuery`) procura primeiro a instalação local (`claudeSdk.path`) e depois a cópia embutida. O empacotamento muda depois; a busca já é configurável.

### Segredos

`src/main/secrets-core.ts` (puro, testável) e `secrets.ts` (Electron). Chave `secretRef` (`^[a-z0-9][a-z0-9._-]{0,63}$`); o config guarda só a referência. Três origens:

| Origem | Como funciona |
|---|---|
| `stored` | valor cifrado com o chaveiro do sistema (`safeStorage`). Sem chaveiro (no Linux, backend `basic_text` não conta), **recusa** gravar, a menos que o usuário aceite explicitamente o arquivo inseguro (`acceptInsecureStorage()`): então grava texto puro em `secrets.json` (0600) com aviso no próprio arquivo |
| `command` | o valor é a saída de um executável (sem shell). É assim que quem já usava `openrouter-key` continua sem copiar a chave |
| `env` | o valor é uma variável de ambiente |

Nada devolve valor exceto `resolve()`, e quem chama entrega direto a um processo filho ou a um cabeçalho HTTP. `list()` e `check()` nunca devolvem o valor. A exportação nunca inclui segredos.

### Exportar e importar

Formato (`src/shared/config/transfer.ts`): `{ format: "coxia-workspace-config", formatVersion: 1, exportedAt, app, workspace: { name }, requiredSecrets: [{ ref, usedBy, label }], config }`. Importa também um `config` solto, de qualquer schema anterior (é migrado). Um valor de segredo no arquivo (`apiKey`, `token`...) faz a importação ser recusada.

Canais (módulo `configModule.ts`; os que escrevem ou tocam arquivo são **só desktop**, ver `webPolicy.ts`):

| Canal | O que faz | Web |
|---|---|---|
| `config:get` | `{ config, secrets, storage, requirements, claudeSdk, workspaceId }` | permitido |
| `config:schema`, `config:validate` | JSON Schema; valida um documento | permitido |
| `config:save` | valida e grava o config inteiro | só desktop |
| `config:secret-set` / `-remove` / `-check`, `config:secrets-accept-insecure` | gerencia as fontes dos segredos | só desktop |
| `config:export` | abre "salvar como" e grava o arquivo | só desktop |
| `config:import-pick` | abre "abrir arquivo" | só desktop |
| `config:import-preview` | valida, mostra o diff, os segredos pedidos (e quais já existem), os **programas que o config executaria** e os caminhos que não existem aqui; não grava | só desktop |
| `config:import-apply` | grava os segredos informados e o config, em workspace novo ou existente (o config anterior fica em `config.pre-import.json`) | só desktop |

### Para os próximos agentes

- **Leia a configuração por `rc()`** (`src/main/workspaceConfig.ts`), na hora do uso, nunca na importação do módulo. `rc()` dá caminhos absolutos e as integrações ligadas: `projectsRoot`, `repos`, `primaryVcs`, `vcsHost`, `issues`, `qaUser`, `specsDir`, `specLayout`, `stages`, `cardSource`, `releaseSync`, `claudeCli`, `role(papel)`. Atalhos: `vcsCliEnv()`, `issueProjectRef()`, `issueWebUrl()`, `isIssueRef()`, `gitlabCliReady()`, `docsSources()`. Para escrever, `saveConfig` / `updateConfig` (valida e grava); `onConfigChange` avisa.
- **Assistente (wizard):** `config:get` já traz tudo; `setupComplete` é a flag. Detecção de fontes de documentação: `resolveDocs` (`config-resolve.ts`). Teste de conexão de provedor aberto: `probeOpenAIProvider` (grava o resultado em `llm.providers[].capabilities`). Rótulos de `SecretRequirement` estão em inglês: traduza na tela.
- **Provedores de VCS:** `src/main/vcs/` (GitLab, GitHub, Bitbucket Cloud) atrás de uma interface neutra: `vcsProvider()` devolve o da integração primária, `vcsReady()` diz se ela está usável (os jobs que leem o host só rodam com ela, `Job.enabled`), `probeVcs(integração)` alimenta o botão "Testar" do assistente. Escritas só por `proposeVcsAction` + confirmação em Ações. Detalhes, permissões de token e o que cada recurso usa: [`vcs-providers.md`](vcs-providers.md).
- **Templates de ciclo de desenvolvimento:** um template é um patch (`DeepPartial<WorkspaceConfig>`) sobre `devCycle` (+ `docs`, `projects.issues`) aplicado com `mergeDeep`; o perfil `sz-sdd` está em `legacy.ts` (`legacyProfile().devCycle`) como exemplo completo. Falta ligar `ceremonies` às telas e `stages` ao dashboard e aos regexes do inventário.
- **Motores:** `engineFor(papel)` (`engine/registry.ts`) devolve provedor, modelo e motor; `agents.ts` despacha por `registerEngine(id, runner)`. O motor aberto está registrado, e `openSelection()` monta a seleção dele a partir do config (chave via `providerSecret`, `capabilities`, `structured`, `docs` de `docsSources()`). O gancho `COXIA_ENGINE=open` continua valendo e vence o config.
- **Voz opcional:** `voice.enabled` é guardado mas **nada o lê ainda**.
- **i18n:** `t(chave, params)` em `src/shared/i18n` (renderer e main), catálogos `pt-BR.json` e `en.json` com chaves planas; falta de chave cai no pt-BR e depois na própria chave. No renderer: `useT()` e `initLanguage()`. A tela de Configurações usa `t()` nos títulos. `npm run i18n:lint` (`scripts/i18n-lint.mjs`) lista os textos literais por arquivo (`--file`, `--json`, `--max N` para travar em CI, `--keys` confere os dois catálogos).
- **Testes:** `test/setup.ts` dá a cada arquivo de teste uma pasta de dados própria (config neutra). Para simular uma instalação antiga: `installLegacyConfig()` e `installEnvSecret()` de `test/helpers/config.ts`.

### Assistente de configuração

`setupComplete: false` (instalação nova, ou um workspace novo) abre o assistente em vez do app; uma configuração migrada (`true`) nunca o vê, a não ser em Configurações → "Configurações e workspaces" → "Abrir o assistente". Nove passos (idioma e nome, modelos, Claude Agent SDK, projetos, integrações, documentação dos agentes, ciclo, voz, revisão); todos menos o primeiro e o último podem ser pulados, e o passo atual fica em `<workspace>/wizard.json` para retomar. Cada "Continuar" grava a configuração inteira (`config:save`).

- Código: `src/renderer/src/wizard/` (tela, passos, importação e exportação), `src/main/wizard.ts` (canais `wizard:*`, **só desktop**; um navegador recebe só o aviso "termine no computador"), `src/main/wizard-core.ts` (varredura de repositórios e de documentação, instalador do SDK, chamada mínima de VCS), `src/shared/wizard.ts` (passos, presets, recomendações, formatos). Textos em `src/shared/i18n/wizard.*.json`.
- Segredos: digitados só no desktop, vão para `config:secret-set` (guardado, variável de ambiente ou comando); o valor nunca volta para a tela.
- Teste de conexão: provedores abertos usam `probeOpenAIProvider` (capacidades gravadas no provedor); os da família Claude fazem uma chamada curta pelo Claude Agent SDK, com o mesmo ambiente dos agentes.
- SDK: instalado com `npm` em `<dados>/claude-sdk` depois dos termos da Anthropic; registra `claudeSdk`. `COXIA_SDK_BUNDLED=0` simula uma build sem o SDK embutido; `COXIA_NPM` troca o executável do npm.
- Peças de outros trabalhos, procuradas em tempo de execução (o assistente funciona sem elas): `src/main/vcs` (`probeVcs`, que o assistente já usa; sem ela, um GET do usuário atual pela API REST), `src/shared/cycles` (modelos de ciclo e a varredura "Preparar agentes", senão lista de espaço reservado e uma busca simples de `.claude/`, `CLAUDE.md`, `.mcp.json`), canais `voice:check|install|test` (senão "em breve").
- `userName` (como os agentes chamam a pessoa) já é guardado e usado na saudação do Hoje; os prompts dos agentes ainda dizem "Luiz" e passam a usá-lo na fase de prompts.

### Não verificado

- Variáveis de ambiente de Bedrock, Vertex e Foundry (`llm-core.ts`) foram escritas pela documentação do Claude Code, sem conta de nuvem para testar.
- Chaveiro: testado com `safeStorage` simulado e, na máquina de desenvolvimento, com backend `gnome_libsecret`; macOS e Windows não foram exercitados.
- A tela de configurações completa (provedores, projetos, segredos, importação) é da fase do assistente: aqui só existem os canais.

---

## English

This is the configuration foundation of Coxia (phase 0). What used to be hardcoded (the company, the machine, the workflow) now lives in one versioned document per workspace: `WorkspaceConfig` v2. The inventory of what was decoupled, and what remains, is in [`decoupling-inventory.md`](decoupling-inventory.md). Providers and agent engines: [`llm-providers.md`](llm-providers.md). VCS providers (GitLab, GitHub, Bitbucket): [`vcs-providers.md`](vcs-providers.md).

### Where things live

| What | Where | Scope |
|---|---|---|
| Configuration | `<data>/workspaces/<id>/config.json` (v2, `schemaVersion: 2`) | per workspace |
| Secrets (resolved references) | `<data>/secrets.json` (mode 0600), by `secretRef` | machine; **never exported** |
| Browser access | `<data>/web.json` | machine (every workspace) |
| Migration marker | `<data>/config-migration.json` | machine |
| Old config (v1) | `config.v1.json` next to `config.json` | backup |

"Multiple configurations" means multiple workspaces. Switching workspace relaunches the app. Export and import carry a workspace's configuration only, never history.

### The model

`src/shared/config/types.ts` documents every field; `schema.ts` emits the JSON Schema (`config:schema`), which is also what import validates against. A test (`test/config-schema.test.ts`) fails when types, schema and defaults drift apart.

| Section | What it decides |
|---|---|
| `schemaVersion`, `setupComplete`, `language` | version, whether the wizard finished (`false` on a fresh install), language (`pt-BR` or `en`) |
| `appearance`, `notifications`, `closeToTray`, `retention`, `schedule` | the settings that already existed |
| `llm.providers[]` | `{ id, kind, engine, baseUrl, models, secretRef, envFile, options, capabilities, structured, headers, ..., legacyCustomEndpoint }`. `kind`: `anthropic`, `bedrock`, `vertex`, `foundry`, `openai-compatible`. `engine`: `claude-sdk` (Claude models) or `open` (own loop, OpenAI-compatible and local) |
| `llm.roles` | per role (`turn`, `reply`, `deep`, `teams`, `fix`): `{ provider, model }` |
| `projects` | `roots[]`, `repos[]` (`id`, `path`, `remoteUrl`, `vcsId`, `projectPath`), `autoDiscover`, `issues` (the issue project, card ref prefix) |
| `vcs[]` | `gitlab` / `github` / `bitbucket` integrations: `host`, `apiUrl`, `user`, `secretRef`, `cliPreference`, `cliCommand` |
| `docs` | Claude Code style context sources: `claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`, `mcpConfigFiles`, `specsDir`; `autoDetect` adds `~/.claude` and `<project>/.claude` |
| `devCycle` | `templateId`, `ceremonies` (per-ceremony switch), `stages[]` (name to kind and rank), `specLayout` (issue folder, files that say the phase, gate artifacts), `qa.user`, `releaseLabelPattern` |
| `agents` | `tools`, `extraInstructions` (all), `roles[role]` = `{ modelRole, extraInstructions, promptOverride }` |
| `voice` | `enabled`, `engine`, `sttModel`, `depsInstalled`, plus the settings that already existed |
| `claudeSdk` | `{ installed, version, path }`: where the Claude Agent SDK comes from |
| `externalTools` | **optional** integrations, all off until configured: `cardSource` (command that lists the day's cards), `releaseSync`, `timeExport`, `terminal`, `claudeCli` |

Paths use `~/` when under the home folder, so a config is portable. Browser access (host, port, public URL) belongs to the machine and stays in `web.json`.

### Fresh install vs existing install

- **Fresh** (empty data folder): neutral config, `setupComplete: false`. No host, repository, QA user, external tool or `sz4` path. The default model is the Anthropic API (`haiku`/`sonnet`), with the key referenced as `llm.anthropic`. With no project configured the agent works in the workspace folder, never in the home folder.
- **Existing**: the migration (`src/shared/config/migrations.ts`, `legacy.ts`) builds v2 from the old `config.json` and the constants the app used to hold. It covers **every** workspace that existed, even one with no `config.json`. The old file is kept as `config.v1.json`. The previous profile (OpenRouter, the company GitLab, `~/projects`, daily-report, SDD) lives in a single file: `legacy.ts`. The `llm.openrouter` secret's source becomes the command `~/.local/bin/openrouter-key`, so the key is never copied. Workspaces created after the update are neutral.
- An invalid field in an old file is replaced by its default (with a note in the log) and never locks a workspace out. A file written by a newer app is refused.

Product decisions reflected here:

1. **Two engines.** `claude-sdk` only for Claude models (Anthropic, Bedrock, Vertex, Foundry); `open` for OpenAI-compatible and local. A claude.ai subscription login is never offered: API keys or cloud credentials only.
2. **A migrated config keeps today's behavior:** OpenRouter + deepseek through the SDK, marked `engine: 'claude-sdk'` and `legacyCustomEndpoint: true`. A fresh install does not offer that combination (validation warns).
3. **Public packages do not bundle the SDK:** `claudeSdk` records the install and `src/main/claudeSdk.ts` (`locateSdk`, `loadClaudeQuery`) looks for a user-local install (`claudeSdk.path`) first, then the bundled copy. Packaging changes later; the lookup is already configurable.

### Secrets

`src/main/secrets-core.ts` (pure, testable) and `secrets.ts` (Electron). Keyed by `secretRef` (`^[a-z0-9][a-z0-9._-]{0,63}$`); the config holds only the reference. Three sources:

| Source | How it works |
|---|---|
| `stored` | value encrypted with the OS keychain (`safeStorage`). Without a keychain (on Linux the `basic_text` backend does not count) it **refuses** to store, unless the user explicitly accepts the insecure file (`acceptInsecureStorage()`): it then writes plain text to `secrets.json` (0600), with a warning inside the file |
| `command` | the value is an executable's output (no shell). This is how a user who already had `openrouter-key` keeps working without copying the key |
| `env` | the value is an environment variable |

Nothing returns a value except `resolve()`, and its callers hand it straight to a child process or an HTTP header. `list()` and `check()` never return it. An export never includes secrets.

### Export and import

Format (`src/shared/config/transfer.ts`): `{ format: "coxia-workspace-config", formatVersion: 1, exportedAt, app, workspace: { name }, requiredSecrets: [{ ref, usedBy, label }], config }`. A bare `config` of any earlier schema is accepted too (it is migrated). A secret value in the file (`apiKey`, `token`...) makes the import refuse it.

Channels (`configModule.ts`; those that write or touch files are **desktop only**, see `webPolicy.ts`):

| Channel | What it does | Web |
|---|---|---|
| `config:get` | `{ config, secrets, storage, requirements, claudeSdk, workspaceId }` | allowed |
| `config:schema`, `config:validate` | the JSON Schema; validates a document | allowed |
| `config:save` | validates and writes the whole config | desktop only |
| `config:secret-set` / `-remove` / `-check`, `config:secrets-accept-insecure` | manages the secret sources | desktop only |
| `config:export` | opens "save as" and writes the file | desktop only |
| `config:import-pick` | opens "open file" | desktop only |
| `config:import-preview` | validates, shows the diff, the secrets asked for (and which already exist), the **programs the config would run** and the paths missing on this machine; writes nothing | desktop only |
| `config:import-apply` | stores the secrets provided and the config, into a new or existing workspace (the previous config is kept as `config.pre-import.json`) | desktop only |

### For the next agents

- **Read configuration through `rc()`** (`src/main/workspaceConfig.ts`), at call time, never at module import. `rc()` gives absolute paths and the integrations that are on: `projectsRoot`, `repos`, `primaryVcs`, `vcsHost`, `issues`, `qaUser`, `specsDir`, `specLayout`, `stages`, `cardSource`, `releaseSync`, `claudeCli`, `role(role)`. Shortcuts: `vcsCliEnv()`, `issueProjectRef()`, `issueWebUrl()`, `isIssueRef()`, `gitlabCliReady()`, `docsSources()`. To write, `saveConfig` / `updateConfig` (validates and persists); `onConfigChange` notifies.
- **Wizard:** `config:get` already carries everything; `setupComplete` is the flag. Documentation source detection: `resolveDocs` (`config-resolve.ts`). Connection test of an open provider: `probeOpenAIProvider` (store the result in `llm.providers[].capabilities`). `SecretRequirement` labels are in English: translate them in the screen.
- **VCS providers:** `src/main/vcs/` (GitLab, GitHub, Bitbucket Cloud) behind a neutral interface: `vcsProvider()` returns the primary integration's, `vcsReady()` says whether it is usable (the jobs that read the host only run with it, `Job.enabled`), `probeVcs(integration)` feeds the wizard's "Test" button. Writes only through `proposeVcsAction` + the confirmation in Actions. Details, token permissions and what each feature uses: [`vcs-providers.md`](vcs-providers.md).
- **Dev-cycle templates:** a template is a patch (`DeepPartial<WorkspaceConfig>`) over `devCycle` (+ `docs`, `projects.issues`) applied with `mergeDeep`; the `sz-sdd` profile in `legacy.ts` (`legacyProfile().devCycle`) is a complete example. Still to do: wire `ceremonies` to the screens and `stages` to the dashboard and the regexes in the inventory.
- **Engines:** `engineFor(role)` (`engine/registry.ts`) returns provider, model and engine; `agents.ts` dispatches through `registerEngine(id, runner)`. The open engine is registered, and `openSelection()` builds its selection from the config (key through `providerSecret`, `capabilities`, `structured`, `docs` from `docsSources()`). The `COXIA_ENGINE=open` hook still works and beats the config.
- **Optional voice:** `voice.enabled` is stored but **nothing reads it yet**.
- **i18n:** `t(key, params)` in `src/shared/i18n` (renderer and main), `pt-BR.json` and `en.json` catalogs with flat keys; a missing key falls back to pt-BR, then to the key itself. In the renderer: `useT()` and `initLanguage()`. The Settings screen uses `t()` for its headings. `npm run i18n:lint` (`scripts/i18n-lint.mjs`) lists literal strings per file (`--file`, `--json`, `--max N` to ratchet in CI, `--keys` checks both catalogs).
- **Tests:** `test/setup.ts` gives every test file its own data folder (neutral config). To simulate an old install: `installLegacyConfig()` and `installEnvSecret()` from `test/helpers/config.ts`.

### Setup wizard

`setupComplete: false` (a fresh install, or a new workspace) opens the wizard instead of the app; a migrated config (`true`) never sees it unless it is opened from Settings → "Settings and workspaces" → "Open the wizard". Nine steps (language and name, models, Claude Agent SDK, projects, integrations, agent documentation, cycle, voice, review); all but the first and the last can be skipped, and the current step is kept in `<workspace>/wizard.json` so it resumes. Every "Continue" saves the whole config (`config:save`).

- Code: `src/renderer/src/wizard/` (screen, steps, import and export), `src/main/wizard.ts` (`wizard:*` channels, **desktop only**; a browser only gets the "finish it on the computer" notice), `src/main/wizard-core.ts` (repository and documentation scans, the SDK installer, the minimal VCS call), `src/shared/wizard.ts` (steps, presets, recommendations, shapes). Strings live in `src/shared/i18n/wizard.*.json`.
- Secrets: typed in the desktop only, sent to `config:secret-set` (stored, environment variable or command); the value never comes back to the screen.
- Connection test: open providers use `probeOpenAIProvider` (capabilities are stored on the provider); Claude-family ones make a short call through the Claude Agent SDK with the environment the agents would get.
- SDK: installed with `npm` into `<data>/claude-sdk` after Anthropic's terms; records `claudeSdk`. `COXIA_SDK_BUNDLED=0` simulates a build that does not bundle the SDK; `COXIA_NPM` overrides the npm executable.
- Pieces from other work, looked up at run time (the wizard works without them): `src/main/vcs` (`probeVcs`, which the wizard now uses; without it, a GET of the current user through the REST API), `src/shared/cycles` (cycle templates and the "prepare agents" scan, else a placeholder list and a simple search for `.claude/`, `CLAUDE.md`, `.mcp.json`), `voice:check|install|test` channels (else "coming soon").
- `userName` (what the agents call the person) is stored and already used in the Today greeting; the agent prompts still say "Luiz" and will use it in the prompts phase.

### Not verified

- The Bedrock, Vertex and Foundry environment variables (`llm-core.ts`) were written from the Claude Code documentation, with no cloud account to test against.
- Keychain: tested with a mocked `safeStorage` and, on the development machine, with the `gnome_libsecret` backend; macOS and Windows were not exercised.
- The full settings UI (providers, projects, secrets, import) belongs to the wizard phase: only the channels exist here.
