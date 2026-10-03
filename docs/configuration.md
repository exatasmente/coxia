# Configuração / Configuration

[Português](#português) | [English](#english)

---

## Português

Esta é a fundação de configuração do Coxia (fase 0). Tudo que antes estava fixo no código (a empresa, a máquina, o fluxo de trabalho) vive agora em um documento versionado por workspace: o `WorkspaceConfig` (versão do esquema 3). Provedores e motores de agente: [`llm-providers.md`](llm-providers.md). Provedores de VCS (GitLab, GitHub, Bitbucket): [`vcs-providers.md`](vcs-providers.md).

### Onde as coisas moram

| O quê | Onde | Escopo |
|---|---|---|
| Configuração | `<dados>/workspaces/<id>/config.json` (`schemaVersion: 3`) | por workspace |
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
| `projects` | `roots[]`, `repos[]` (`id`, `path`, `remoteUrl`, `vcsId`, `projectPath`), `autoDiscover`, `issues` (projeto de issues, prefixo dos cartões, `cardScope` e `cardLabels`: quais issues viram cartões) |
| `vcs[]` | integrações `gitlab` / `github` / `bitbucket`: `host`, `apiUrl`, `user`, `secretRef`, `cliPreference`, `cliCommand` |
| `docs` | fontes de contexto no estilo Claude Code: `claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`, `mcpConfigFiles`, `specsDir`; `autoDetect` acrescenta `~/.claude` e `<projeto>/.claude` |
| `userName`, `userArticle` | como os agentes chamam a pessoa e o artigo português que acompanha o nome (`o`, `a` ou vazio) |
| `devCycle` | o ciclo de desenvolvimento: `templateId`, `ceremonies`, `ceremonyParams`, `stages[]`, `stageMapping[]`, `meanings`, `enrichment`, `specLayout`, `prompts`, `promptOverrides`, `priority`, `pipelineSkill`, `qa.user`, `releaseLabelPattern`. Tudo em [`cycles.md`](cycles.md) |
| `agents` | `tools`, `extraInstructions` e `persona` (todos), `roles[papel]` = `{ modelRole, extraInstructions, promptOverride, persona, maxTurns, docs }` (`docs`: quais fontes de `docs` o papel lê) |
| `voice` | `enabled`, `engine`, `sttModel`, `depsInstalled` e os ajustes que já existiam |
| `claudeSdk` | `{ installed, version, path }`: de onde sai o Claude Agent SDK |
| `externalTools` | integrações **opcionais**, todas desligadas até serem configuradas: `cardSource` (comando que lista os cartões do dia), `releaseSync`, `timeExport`, `terminal`, `claudeCli` |

Caminhos usam `~/` quando estão sob a home, para a configuração ser portátil. O acesso pelo navegador (host, porta, URL pública) é da máquina e fica em `web.json`.

Histórico do esquema: **v1** (sem `schemaVersion`) eram as configurações soltas do app antes da configuração existir; **v2** é o `WorkspaceConfig`; **v3** acrescenta `devCycle.priority` e os campos de cartão `priority` e `milestone`. A migração de v2 para v3 (`v2ToV3` em `migrations.ts`) cria `priority: { labels: [] }` e acrescenta os dois campos à lista `enrichment.cardFields` que o arquivo já tinha, sem tocar no resto. **v4** acrescenta `projects.issues.cardScope` e `cardLabels` (quais issues viram cartões). A migração de v3 para v4 (`v3ToV4`) escreve `cardScope: 'assigned'` e `cardLabels: []` quando faltam e não toca no resto; é idempotente e mantém uma escolha que já exista. Um `config.json` v3 não abre em um app que só conhece o v2, nem um v4 em um que só conhece o v3 (ele recusa, como qualquer arquivo de um app mais novo, em vez de reparar e regravar um bloco que não sabe ler).

**Quais issues viram cartões** (`projects.issues.cardScope`): `assigned` (as atribuídas a você, o padrão e o que todo workspace fazia), `all` (todas as issues abertas do projeto de issues) ou `labels` (as abertas do projeto de issues que têm qualquer uma de `cardLabels`, até 10 nomes sem vírgula, aspas nem barra invertida). São campos com padrão (esquema **v4**; a migração só escreve o padrão): um arquivo sem os campos abre como `assigned`, e um valor inválido volta sozinho ao padrão sem mexer no resto do bloco `issues`. Um app anterior (0.2.2 ou menos) recusa o arquivo v4. `all` e `labels` precisam do projeto de issues; sem ele, ou com `labels` sem nenhuma label, ou no Bitbucket (cujas issues não têm labels), valem as issues atribuídas a você, e o assistente e a validação dizem isso. O comando de fonte de cartões (`externalTools.cardSource`) define os seus próprios cartões e ignora a escolha. Edição: etapa de integrações do assistente, no bloco "Onde ficam as issues". Detalhes por host em [`vcs-providers.md`](vcs-providers.md#cartões-e-estágios).

### Instalação nova × instalação existente

- **Nova** (pasta de dados vazia): configuração neutra, `setupComplete: false`. Nenhum host, repositório, usuário de QA, ferramenta externa ou caminho de projeto. O modelo padrão é a API da Anthropic (`haiku`/`sonnet`), com a chave referenciada por `llm.anthropic`. Sem projeto configurado, o agente trabalha na pasta do workspace, nunca na home.
- **Existente** (uma instalação anterior à configuração, com `config.json` v1): a migração (`src/shared/config/migrations.ts`, `legacy.ts`) constrói a configuração atual a partir das configurações antigas (agenda, voz, ferramentas, notificações). Vale para **todos** os workspaces que existiam, mesmo sem `config.json`. O arquivo antigo fica em `config.v1.json`. O que o app antigo tinha fixo no código (host, repositórios, ferramentas, prompts) o app novo não conhece: quem quiser levar isso junto aponta a variável `COXIA_LEGACY_PROFILE` para um arquivo JSON **fora do repositório** (formato em [`examples/legacy-profile.example.json`](examples/legacy-profile.example.json): `config` é um patch sobre os padrões neutros, `web` vai para o `web.json` se ele não existir, `secrets` registra fontes `command`, `migratedModels` diz a que provedor pertencem os modelos do arquivo v1). Sem esse arquivo a instalação migra para os padrões neutros com `setupComplete: false` e o assistente roda. Workspaces criados depois da atualização são neutros.
- Um campo inválido num arquivo antigo é trocado pelo padrão (com nota no log), nunca trava o workspace. Um arquivo escrito por uma versão mais nova do app é recusado.

Decisões do produto já refletidas:

1. **Dois motores.** `claude-sdk` só para modelos Claude (Anthropic, Bedrock, Vertex, Foundry); `open` para OpenAI-compatível e local. Login de assinatura do claude.ai nunca é oferecido: só chave de API ou credenciais de nuvem.
2. **Config migrada mantém o comportamento de hoje:** OpenRouter + deepseek pelo SDK, marcado `engine: 'claude-sdk'` e `legacyCustomEndpoint: true`. Uma instalação nova não oferece essa combinação (a validação avisa).
3. **O SDK não vem junto nos pacotes públicos:** `claudeSdk` registra a instalação e `src/main/claudeSdk.ts` (`locateSdk`, `loadClaudeQuery`) procura primeiro a instalação local (`claudeSdk.path`) e depois a cópia embutida. `npm run dist:public` (`electron-builder.public.yml`) deixa o SDK fora do pacote, e `locateSdk` o dá como ausente quando o app empacotado não tem o binário do SDK ao lado do `app.asar`; `npm run dist` (build pessoal, do código-fonte) continua embutindo.

### Segredos

`src/main/secrets-core.ts` (puro, testável) e `secrets.ts` (Electron). Chave `secretRef` (`^[a-z0-9][a-z0-9._-]{0,63}$`); o config guarda só a referência. Três origens:

| Origem | Como funciona |
|---|---|
| `stored` | valor cifrado com o chaveiro do sistema (`safeStorage`). Sem chaveiro (no Linux, backend `basic_text` não conta), **recusa** gravar, a menos que o usuário aceite explicitamente o arquivo inseguro (`acceptInsecureStorage()`): então grava texto puro em `secrets.json` (0600) com aviso no próprio arquivo |
| `command` | o valor é a saída de um executável (sem shell). É assim que quem já tem um script de chave continua sem copiar a chave |
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
- **Ciclos de desenvolvimento:** [`cycles.md`](cycles.md). `devCycle` é o que as cerimônias seguem; um modelo (`src/shared/cycles/`) o preenche, `cycle:apply` o aplica, e o perfil migrado (`legacyCycle()` em `legacy.ts`) é o SDD com as especificidades do autor. As telas leem `cycle:view` (`useCycle()`), os jobs leem `cycleOn(cerimônia)` (`main/cycle-core.ts`), os textos vêm de `prompt()` (`main/cyclePrompts.ts`). A varredura de documentação do assistente é `prepareAgents` (`main/cycles.ts`).
- **Motores:** `engineFor(papel)` (`engine/registry.ts`) devolve provedor, modelo e motor; `agents.ts` despacha por `registerEngine(id, runner)`. O motor aberto está registrado, e `openSelection()` monta a seleção dele a partir do config (chave via `providerSecret`, `capabilities`, `structured`, `docs` de `docsSources()`). O gancho `COXIA_ENGINE=open` continua valendo e vence o config.
- **Voz opcional:** `voice.enabled` desliga tudo: sem sidecar, sem microfone, sem síntese; e "call" vira "conversa" (`tv()`). A instalação e o teste são os canais `voice:*`. Veja `docs/voice.md`.
- **i18n:** `t(chave, params)` em `src/shared/i18n` (renderer e main), catálogos `pt-BR.json` e `en.json` com chaves planas; falta de chave cai no pt-BR e depois na própria chave. No renderer: `useT()` e `initLanguage()`. Todas as telas do renderer passam por `t()`, com os textos em `ui-<área>.*.json` ([`i18n.md`](i18n.md)). `npm run i18n:lint` (`scripts/i18n-lint.mjs`) lista os textos literais por arquivo (`--file`, `--json`, `--max N` para travar em CI, `--keys` confere os dois catálogos, `--scope <área>` escolhe renderer, main, shared ou all — o CI roda `--keys --scope renderer --max 0`). Os textos do processo principal e dos módulos compartilhados (erros, notificações, bandeja, Saúde, arquivos que o app escreve, prompts novos) ficam em `main.pt-BR.json` e `main.en.json` (chaves `main.*` e `prompt.sdd.*`); o assistente em `wizard.*.json`. Em `src/main` e `src/shared` o lint chega a zero: o que não é texto para pessoas (comandos, consultas do host de código, descrições de ferramentas que o motor aberto manda ao modelo, textos de log) leva `// i18n-ignore: <motivo>` (na linha ou na de cima, ou `i18n-ignore-start`/`-end`), e um arquivo que é dado em língua fixa leva `// i18n-lint: allow-file <motivo>` nas primeiras linhas. O prompt em pt-BR é comparado byte a byte com `test/golden/legacy-prompts*.json`; o inglês tem os seus em `test/golden/en-prompts*.json` (`UPDATE_GOLDEN=1` reescreve).
- **Testes:** `test/setup.ts` dá a cada arquivo de teste uma pasta de dados própria (config neutra). Para simular uma instalação antiga: `installLegacyConfig()` e `installEnvSecret()` de `test/helpers/config.ts`.

### Assistente de configuração

`setupComplete: false` (instalação nova, ou um workspace novo) abre o assistente em vez do app; uma configuração migrada (`true`) nunca o vê, a não ser em Configurações → "Configurações e workspaces" → "Abrir o assistente". Nove passos (idioma e nome, modelos, Claude Agent SDK, projetos, integrações, documentação dos agentes, ciclo, voz, revisão); todos menos o primeiro e o último podem ser pulados, e o passo atual fica em `<workspace>/wizard.json` para retomar. Cada "Continuar" grava a configuração inteira (`config:save`).

- Código: `src/renderer/src/wizard/` (tela, passos, importação e exportação), `src/main/wizard.ts` (canais `wizard:*`, **só desktop**; um navegador recebe só o aviso "termine no computador"), `src/main/wizard-core.ts` (varredura de repositórios e de documentação, instalador do SDK, chamada mínima de VCS), `src/shared/wizard.ts` (passos, presets, recomendações, formatos). Textos em `src/shared/i18n/wizard.*.json`.
- Segredos: digitados só no desktop, vão para `config:secret-set` (guardado, variável de ambiente ou comando); o valor nunca volta para a tela.
- Teste de conexão: provedores abertos usam `probeOpenAIProvider` (capacidades gravadas no provedor); os da família Claude fazem uma chamada curta pelo Claude Agent SDK, com o mesmo ambiente dos agentes.
- SDK: instalado com `npm` em `<dados>/claude-sdk` depois dos termos da Anthropic; registra `claudeSdk`. `COXIA_SDK_BUNDLED=0` simula uma build sem o SDK embutido; `COXIA_NPM` troca o executável do npm.
- Peças de outros trabalhos, procuradas em tempo de execução: `src/main/vcs` (`probeVcs`, que o assistente já usa; sem ela, um GET do usuário atual pela API REST) e os canais `voice:check|install|test` (senão "em breve"). Os modelos de ciclo e a varredura "Preparar agentes" fazem parte do app (`src/main/cycles.ts`, ver [`cycles.md`](cycles.md)).
- `userName` (e `userArticle`, só para o português) é o que os prompts dos agentes e a saudação do Hoje dizem; sem nome, "o usuário".

### Não verificado

- Variáveis de ambiente de Bedrock, Vertex e Foundry (`llm-core.ts`) foram escritas pela documentação do Claude Code, sem conta de nuvem para testar.
- Chaveiro: testado com `safeStorage` simulado e, na máquina de desenvolvimento, com backend `gnome_libsecret`; macOS e Windows não foram exercitados.
- A tela de configurações completa (provedores, projetos, segredos, importação) é da fase do assistente: aqui só existem os canais.

---

## English

This is the configuration foundation of Coxia (phase 0). What used to be hardcoded (the company, the machine, the workflow) now lives in one versioned document per workspace: `WorkspaceConfig` (schema version 3). Providers and agent engines: [`llm-providers.md`](llm-providers.md). VCS providers (GitLab, GitHub, Bitbucket): [`vcs-providers.md`](vcs-providers.md).

### Where things live

| What | Where | Scope |
|---|---|---|
| Configuration | `<data>/workspaces/<id>/config.json` (`schemaVersion: 3`) | per workspace |
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
| `projects` | `roots[]`, `repos[]` (`id`, `path`, `remoteUrl`, `vcsId`, `projectPath`), `autoDiscover`, `issues` (the issue project, card ref prefix, `cardScope` and `cardLabels`: which issues become cards) |
| `vcs[]` | `gitlab` / `github` / `bitbucket` integrations: `host`, `apiUrl`, `user`, `secretRef`, `cliPreference`, `cliCommand` |
| `docs` | Claude Code style context sources: `claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`, `mcpConfigFiles`, `specsDir`; `autoDetect` adds `~/.claude` and `<project>/.claude` |
| `userName`, `userArticle` | what the agents call the person, and the Portuguese article that goes with the name (`o`, `a` or empty) |
| `devCycle` | the development cycle: `templateId`, `ceremonies`, `ceremonyParams`, `stages[]`, `stageMapping[]`, `meanings`, `enrichment`, `specLayout`, `prompts`, `promptOverrides`, `priority`, `pipelineSkill`, `qa.user`, `releaseLabelPattern`. All in [`cycles.md`](cycles.md) |
| `agents` | `tools`, `extraInstructions` and `persona` (all), `roles[role]` = `{ modelRole, extraInstructions, promptOverride, persona, maxTurns, docs }` (`docs`: which `docs` sources the role reads) |
| `voice` | `enabled`, `engine`, `sttModel`, `depsInstalled`, plus the settings that already existed |
| `claudeSdk` | `{ installed, version, path }`: where the Claude Agent SDK comes from |
| `externalTools` | **optional** integrations, all off until configured: `cardSource` (command that lists the day's cards), `releaseSync`, `timeExport`, `terminal`, `claudeCli` |

Paths use `~/` when under the home folder, so a config is portable. Browser access (host, port, public URL) belongs to the machine and stays in `web.json`.

Schema history: **v1** (no `schemaVersion`) was the app's loose settings before configuration existed; **v2** is `WorkspaceConfig`; **v3** adds `devCycle.priority` and the card fields `priority` and `milestone`. The v2 to v3 migration (`v2ToV3` in `migrations.ts`) creates `priority: { labels: [] }` and appends the two fields to the `enrichment.cardFields` list the file already had, touching nothing else. **v4** adds `projects.issues.cardScope` and `cardLabels` (which issues become cards). The v3 to v4 migration (`v3ToV4`) writes `cardScope: 'assigned'` and `cardLabels: []` when they are missing and touches nothing else; it is idempotent and keeps a choice that is already there. A v3 `config.json` does not open in an app that only knows v2, nor a v4 one in an app that only knows v3 (it refuses, like any file from a newer app, instead of repairing and re-saving a block it cannot read).

**Which issues become cards** (`projects.issues.cardScope`): `assigned` (the ones assigned to you, the default and what every workspace did), `all` (every open issue of the issue project) or `labels` (the open issues of the issue project that carry any of `cardLabels`: up to 10 names with no comma, quote or backslash). They are fields with a default (schema **v4**; the migration only writes the default): a file without the fields opens as `assigned`, and an invalid value is reset on its own without touching the rest of the `issues` block. An earlier app (0.2.2 or older) refuses the v4 file. `all` and `labels` need the issue project; without it, or with `labels` and no label, or on Bitbucket (whose issues have no labels), the issues assigned to you apply, and the wizard and the validation say so. The card source command (`externalTools.cardSource`) defines its own cards and ignores the choice. Edited in the wizard's integrations step, in the "Where the issues live" block. Per-host details in [`vcs-providers.md`](vcs-providers.md#cards-and-stages).

### Fresh install vs existing install

- **Fresh** (empty data folder): neutral config, `setupComplete: false`. No host, repository, QA user, external tool or project path. The default model is the Anthropic API (`haiku`/`sonnet`), with the key referenced as `llm.anthropic`. With no project configured the agent works in the workspace folder, never in the home folder.
- **Existing** (an install that predates the configuration, with a v1 `config.json`): the migration (`src/shared/config/migrations.ts`, `legacy.ts`) builds the current configuration from the old settings (schedule, voice, tools, notifications). It covers **every** workspace that existed, even one with no `config.json`. The old file is kept as `config.v1.json`. What the old app hardcoded (host, repositories, tools, prompts) the new app does not know: to carry it along, point the `COXIA_LEGACY_PROFILE` variable at a JSON file **outside the repository** (shape in [`examples/legacy-profile.example.json`](examples/legacy-profile.example.json): `config` is a patch over the neutral defaults, `web` goes to `web.json` when that file does not exist, `secrets` registers `command` sources, `migratedModels` says which provider the models of the v1 file belong to). Without that file the install migrates to the neutral defaults with `setupComplete: false` and the setup assistant runs. Workspaces created after the update are neutral.
- An invalid field in an old file is replaced by its default (with a note in the log) and never locks a workspace out. A file written by a newer app is refused.

Product decisions reflected here:

1. **Two engines.** `claude-sdk` only for Claude models (Anthropic, Bedrock, Vertex, Foundry); `open` for OpenAI-compatible and local. A claude.ai subscription login is never offered: API keys or cloud credentials only.
2. **A migrated config keeps today's behavior:** OpenRouter + deepseek through the SDK, marked `engine: 'claude-sdk'` and `legacyCustomEndpoint: true`. A fresh install does not offer that combination (validation warns).
3. **Public packages do not bundle the SDK:** `claudeSdk` records the install and `src/main/claudeSdk.ts` (`locateSdk`, `loadClaudeQuery`) looks for a user-local install (`claudeSdk.path`) first, then the bundled copy. `npm run dist:public` (`electron-builder.public.yml`) leaves the SDK out of the package, and `locateSdk` reports it missing when the packaged app has no SDK binary next to `app.asar`; `npm run dist` (a personal build from source) still bundles it.

### Secrets

`src/main/secrets-core.ts` (pure, testable) and `secrets.ts` (Electron). Keyed by `secretRef` (`^[a-z0-9][a-z0-9._-]{0,63}$`); the config holds only the reference. Three sources:

| Source | How it works |
|---|---|
| `stored` | value encrypted with the OS keychain (`safeStorage`). Without a keychain (on Linux the `basic_text` backend does not count) it **refuses** to store, unless the user explicitly accepts the insecure file (`acceptInsecureStorage()`): it then writes plain text to `secrets.json` (0600), with a warning inside the file |
| `command` | the value is an executable's output (no shell). This is how a user who already has a key script keeps working without copying the key |
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
- **Development cycles:** [`cycles.md`](cycles.md). `devCycle` is what the ceremonies follow; a template (`src/shared/cycles/`) fills it, `cycle:apply` applies it, and the migrated profile (`legacyCycle()` in `legacy.ts`) is SDD with the author's specifics. Screens read `cycle:view` (`useCycle()`), jobs read `cycleOn(ceremony)` (`main/cycle-core.ts`), texts come from `prompt()` (`main/cyclePrompts.ts`). The wizard's documentation scan is `prepareAgents` (`main/cycles.ts`).
- **Engines:** `engineFor(role)` (`engine/registry.ts`) returns provider, model and engine; `agents.ts` dispatches through `registerEngine(id, runner)`. The open engine is registered, and `openSelection()` builds its selection from the config (key through `providerSecret`, `capabilities`, `structured`, `docs` from `docsSources()`). The `COXIA_ENGINE=open` hook still works and beats the config.
- **Optional voice:** `voice.enabled` turns everything off: no sidecar, no microphone, no synthesis; and "call" becomes "chat" (`tv()`). Installing and testing are the `voice:*` channels. See `docs/voice.md`.
- **i18n:** `t(key, params)` in `src/shared/i18n` (renderer and main), `pt-BR.json` and `en.json` catalogs with flat keys; a missing key falls back to pt-BR, then to the key itself. In the renderer: `useT()` and `initLanguage()`. Every renderer screen goes through `t()`, with the strings in `ui-<area>.*.json` ([`i18n.md`](i18n.md)). `npm run i18n:lint` (`scripts/i18n-lint.mjs`) lists literal strings per file (`--file`, `--json`, `--max N` to ratchet in CI, `--keys` checks both catalogs, `--scope <area>` picks renderer, main, shared or all — CI runs `--keys --scope renderer --max 0`). The texts of the main process and the shared modules (errors, notifications, tray, Health, the files the app writes, newer prompts) live in `main.pt-BR.json` and `main.en.json` (keys `main.*` and `prompt.sdd.*`); the wizard's in `wizard.*.json`. The lint reaches zero in `src/main` and `src/shared`: what is not text for people (commands, code host queries, tool descriptions the open engine sends the model, log text) carries `// i18n-ignore: <why>` (on the line, the line above, or `i18n-ignore-start`/`-end`), and a file that is data in a fixed language carries `// i18n-lint: allow-file <why>` in its first lines. The pt-BR prompts are compared byte for byte with `test/golden/legacy-prompts*.json`; English has its own in `test/golden/en-prompts*.json` (`UPDATE_GOLDEN=1` rewrites them).
- **Tests:** `test/setup.ts` gives every test file its own data folder (neutral config). To simulate an old install: `installLegacyConfig()` and `installEnvSecret()` from `test/helpers/config.ts`.

### Setup wizard

`setupComplete: false` (a fresh install, or a new workspace) opens the wizard instead of the app; a migrated config (`true`) never sees it unless it is opened from Settings → "Settings and workspaces" → "Open the wizard". Nine steps (language and name, models, Claude Agent SDK, projects, integrations, agent documentation, cycle, voice, review); all but the first and the last can be skipped, and the current step is kept in `<workspace>/wizard.json` so it resumes. Every "Continue" saves the whole config (`config:save`).

- Code: `src/renderer/src/wizard/` (screen, steps, import and export), `src/main/wizard.ts` (`wizard:*` channels, **desktop only**; a browser only gets the "finish it on the computer" notice), `src/main/wizard-core.ts` (repository and documentation scans, the SDK installer, the minimal VCS call), `src/shared/wizard.ts` (steps, presets, recommendations, shapes). Strings live in `src/shared/i18n/wizard.*.json`.
- Secrets: typed in the desktop only, sent to `config:secret-set` (stored, environment variable or command); the value never comes back to the screen.
- Connection test: open providers use `probeOpenAIProvider` (capabilities are stored on the provider); Claude-family ones make a short call through the Claude Agent SDK with the environment the agents would get.
- SDK: installed with `npm` into `<data>/claude-sdk` after Anthropic's terms; records `claudeSdk`. `COXIA_SDK_BUNDLED=0` simulates a build that does not bundle the SDK; `COXIA_NPM` overrides the npm executable.
- Pieces from other work, looked up at run time: `src/main/vcs` (`probeVcs`, which the wizard now uses; without it, a GET of the current user through the REST API) and the `voice:check|install|test` channels (else "coming soon"). The cycle templates and the "prepare agents" scan are part of the app (`src/main/cycles.ts`, see [`cycles.md`](cycles.md)).
- `userName` (and `userArticle`, for Portuguese only) is what the agent prompts and the Today greeting say; with no name, "the user".

### Not verified

- The Bedrock, Vertex and Foundry environment variables (`llm-core.ts`) were written from the Claude Code documentation, with no cloud account to test against.
- Keychain: tested with a mocked `safeStorage` and, on the development machine, with the `gnome_libsecret` backend; macOS and Windows were not exercised.
- The full settings UI (providers, projects, secrets, import) belongs to the wizard phase: only the channels exist here.
