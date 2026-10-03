# Configuração / Configuration

[Português](#português) | [English](#english)

---

## Português

Esta é a fundação de configuração do Coxia (fase 0). Tudo que antes estava fixo no código (a empresa, a máquina, o fluxo de trabalho) vive agora em um documento versionado por workspace: o `WorkspaceConfig` (versão do esquema 5). Provedores e motores de agente: [`llm-providers.md`](llm-providers.md). Provedores de VCS (GitLab, GitHub, Bitbucket): [`vcs-providers.md`](vcs-providers.md).

### Onde as coisas moram

| O quê | Onde | Escopo |
|---|---|---|
| Configuração | `<dados>/workspaces/<id>/config.json` (`schemaVersion: 8`) | por workspace |
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
| `userName`, `userArticle` | como os agentes chamam a pessoa e o artigo português que acompanha o nome (`o`, `a` ou vazio) |
| `devCycle` | o ciclo de desenvolvimento: `templateId`, `ceremonies`, `ceremonyParams`, `stages[]`, `stageMapping[]`, `meanings`, `enrichment`, `specLayout`, `comments`, `prompts`, `promptOverrides`, `priority`, `pipelineSkill`, `qa.user`, `releaseLabelPattern`. Tudo em [`cycles.md`](cycles.md) |
| `agents` | `tools`, `extraInstructions` e `persona` (todos), `roles[papel]` = `{ modelRole, extraInstructions, promptOverride, persona, maxTurns, docs }` (`docs`: quais fontes de `docs` o papel lê), `team[]` = o time de agentes (veja abaixo) |
| `voice` | `enabled`, `engine`, `sttModel`, `depsInstalled` e os ajustes que já existiam |
| `claudeSdk` | `{ installed, version, path }`: de onde sai o Claude Agent SDK |
| `externalTools` | integrações **opcionais**, todas desligadas até serem configuradas: `cardSource` (comando que lista os cartões do dia), `releaseSync`, `timeExport`, `terminal`, `claudeCli` |
| `runner` | o que leva uma issue pelo ciclo de agentes sozinho: `enabled`, `triggerLabel`, `maxConcurrentRuns`, `worktreesDir`, `commands`, `stageIdleMs`, `stageMaxMs`, `turns`, `identity`, `commitMessage` (veja abaixo) |

Caminhos usam `~/` quando estão sob a home, para a configuração ser portátil. O acesso pelo navegador (host, porta, URL pública) é da máquina e fica em `web.json`.

Histórico do esquema: **v1** (sem `schemaVersion`) eram as configurações soltas do app antes da configuração existir; **v2** é o `WorkspaceConfig`; **v3** acrescenta `devCycle.priority` e os campos de cartão `priority` e `milestone`; **v4** acrescenta `agents.team` e, em uma etapa, `agentId`, `artifacts` e `human`; **v5** acrescenta `runner`; **v6** acrescenta `devCycle.comments`; **v7** faz das etapas de um ciclo de agentes um fluxo (`type`, `produces`, `reads`, `next`, `returnsTo`, `roundLimit`, `waitsFor`, `comment`, `trackerStatus`) e acrescenta `turnsTo` aos agentes; **v8** troca `runner.stageTimeoutMs` por `runner.stageIdleMs` e `runner.stageMaxMs`. A migração de v2 para v3 (`v2ToV3` em `migrations.ts`) cria `priority: { labels: [] }` e acrescenta os dois campos à lista `enrichment.cardFields` que o arquivo já tinha, sem tocar no resto. A migração de v3 para v4 (`v3ToV4`) cria o time com os cinco agentes nativos, tirando de `agents.roles` o papel de modelo e as instruções extras de cada um, e não toca no resto. A migração de v4 para v5 (`v4ToV5`) cria `runner` desligado, com os padrões, e não toca no resto. A migração de v5 para v6 (`v5ToV6`) dá a um workspace no ciclo de agentes os modelos de comentário desse ciclo e a qualquer outro ciclo nenhum (sem modelo, nada é postado), e não toca no resto; um arquivo que já traz `comments` os mantém. A migração de v6 para v7 (`v6ToV7`) passa `human` a `type: 'gate'` e as outras etapas a `type: 'work'`, `artifacts` a `produces`, põe a ordem da lista na ordem em que o runner percorria (era o `rank`), tira o agente da última etapa (que nunca o teve na prática) e escreve como campos o que o runner fazia sozinho: a revisão devolve à etapa de trabalho anterior e o QA à primeira etapa cujo agente altera arquivos (`returnsTo`), as duas com `roundLimit: 2`. Um ciclo sem nenhum campo de agente (os das cerimônias) não é tocado. Um workspace cujo ciclo de agentes ainda é **exatamente o padrão que o app entregou** ganha o novo padrão (triagem, Product Owner, Tech Lead, Sucesso do Cliente e a comunicação depois do merge): os agentes que o app acrescenta entram por `id`, os agentes da pessoa **não são renomeados nem tocados** (Refiner, Planner e Reviewer continuam no time, só que as etapas passam a nomear o Product Owner e o Tech Lead; o Refiner passa a ser o Product Owner, o Planner e o Reviewer o Tech Lead), o `developer` e o `qa` entregues passam a recorrer ao Tech Lead e os modelos de comentário de triage e communicate são acrescentados (os que a pessoa editou ficam). Um ciclo que a pessoa alterou fica como está e a migração avisa, nas notas, que o novo padrão existe (aplicar o modelo `agent-flow` o traz). A migração de v7 para v8 (`v7ToV8`) transforma `runner.stageTimeoutMs` (um limite de relógio, 30 min por padrão) em `runner.stageIdleMs` (o agente sem dar sinal, padrão 10 min) e `runner.stageMaxMs` (o teto de relógio da etapa, padrão 2 h): o valor padrão antigo vira os dois padrões novos, e um valor que a pessoa tinha posto vira o teto (e também o limite de silêncio, quando é menor que o padrão); o resto não é tocado. Um `config.json` v8 não abre em um app que só conhece o v7 (ele recusa, como qualquer arquivo de um app mais novo).

#### O time de agentes (`agents.team`)

Cada item é um agente: `{ id, name, job, model, stages, permission, autonomous, turnsTo, instructions, system }`. O `id` é também o nome que uma menção usa (`@developer`). `name`, `job` e `instructions` são chave de catálogo ou texto livre. `model` é `{ role, provider, model }`: com `role` preenchido o agente usa o provedor e o modelo daquele papel de `llm.roles`; com `role: null` precisa de um provedor que exista e de um modelo. `stages` lista as etapas do `devCycle` que ele trabalha e `permission` diz o que ele pode fazer nos arquivos da sua execução: `read` (só lê) ou `worktree` (também altera arquivos dentro do worktree da execução, e em nenhum outro lugar; quem aplica isso é o executor, veja [`runner.md`](runner.md)).

`autonomous` diz se o agente anda sozinho: ligado, a etapa dele começa quando a execução chega nela, os comentários e revisões dele no tracker saem automaticamente (e ficam no registro de auditoria) e o resultado segue para a etapa seguinte sem esperar; desligado (o padrão), a etapa espera a pessoa iniciar, os comentários esperam um "sim" em Ações e o resultado espera a pessoa aceitar (ou devolver com uma nota). Empurrar a branch e abrir o pull request esperam a pessoa de qualquer jeito, e um workspace de teste continua recusando toda escrita externa. A mudança do campo vale na próxima partida de etapa ou publicação, nunca no meio de uma etapa. As cerimônias ignoram o campo. Um agente autônomo que não trabalha etapa nenhuma gera um aviso na validação. O time padrão do ciclo de agentes é autônomo; os cinco agentes nativos não.

`turnsTo` é o `id` de outro agente do time, ou `null` (a pessoa): é a quem o agente recorre quando não pode decidir. Uma pergunta dele vai primeiro a esse agente, na conversa da execução, que responde lendo ou repassa; a cadeia termina na pessoa, e uma volta (`a` recorre a `b` que recorre a `a`), um agente que recorre a si mesmo ou a quem não existe é recusado pela validação (e o runner tem um limite de passos também). Os agentes nativos recorrem à pessoa. O modelo `agent-flow` traz: suporte e sucesso do cliente ao Product Owner, o desenvolvedor e o QA ao Tech Lead, o Tech Lead ao Product Owner (escopo) e o Product Owner à pessoa. Veja [`cycles.md`](cycles.md).

Os cinco agentes nativos (`system: true`) têm os ids dos papéis de modelo (`turn`, `reply`, `deep`, `teams`, `fix`), são os que as cerimônias chamam hoje, podem ser editados e nunca removidos: um arquivo que os deixe de fora recebe-os de volta ao ser lido. Editar um agente nativo pelas funções de `src/shared/config/team.ts` (`updateAgent`) grava também `agents.roles[papel]` (`modelRole`, `extraInstructions`), que é o que as cerimônias leem. A validação recusa ids repetidos, o id de um agente nativo em um agente comum, etapa inexistente em `stages`, `stage.agentId` que não aponta para um agente (e etapa que não é de trabalho, um gate ou uma espera, que aponte para um) e um modelo sem provedor conhecido. O agente de uma etapa é o que `stage.agentId` nomeia; sem ele, o primeiro agente do time que lista a etapa; sem nenhum, a etapa não começa e diz isso.

#### As etapas de um ciclo de agentes (`devCycle.stages`)

Além dos campos que as cerimônias usam (`id`, `label`, `match`, `kind`, `rank`), uma etapa de um ciclo de agentes tem os campos do fluxo: `type` (`work`, `gate` ou `wait`), `agentId`, `produces`, `reads`, `next`, `returnsTo`, `roundLimit`, `waitsFor`, `comment` e `trackerStatus`, descritos em [`cycles.md`](cycles.md). O ciclo é um fluxo quando alguma etapa tem um desses campos; a ordem é a da lista. A validação roda a verificação do fluxo (`checkFlow`): os erros (etapa de trabalho sem agente, `next` ou `returnsTo` para lugar nenhum, etapa que nada alcança, fluxo sem fim, gate primeiro, artefato lido que ninguém produz, dois produzindo o mesmo arquivo, espera sem evento, volta em `turnsTo`) impedem **salvar** uma mudança no fluxo, e os avisos (agente autônomo sem etapa, gate depois da última etapa de trabalho, etapa final sem agente) não; um fluxo com problema que já estava guardado abre como estava, e uma mudança em outra coisa salva.

#### O runner (`runner`)

Ligado só quando a pessoa liga: `enabled` faz o app iniciar execuções sozinho para as issues que levam o rótulo `triggerLabel` (padrão `coxia`, caixa não importa), até `maxConcurrentRuns` execuções trabalhando ao mesmo tempo (padrão 1; uma execução que a pessoa inicia nunca espera). `worktreesDir` é onde os worktrees nascem (`null`: a pasta `worktrees` dos dados do workspace). `commands` são os **únicos** comandos que um agente com permissão `worktree` pode rodar, cada um exatamente como escrito e sem pipe, `;`, `&&` ou redirecionamento: `null` usa os scripts de teste e typecheck que o repositório declara (`npm test`, `npm run typecheck`), `[]` não permite nenhum. `stageIdleMs` é quanto o agente pode ficar sem dar sinal (texto, ferramenta ou uso do modelo) antes de a etapa falhar e poder ser repetida (padrão 10 min), e `stageMaxMs` é o teto de relógio da etapa, falando ou não (padrão 2 h); a migração do esquema 7 para o 8 transformou o antigo `stageTimeoutMs` nos dois. `turns` são os passos (voltas do modelo) que um agente tem numa passada: `read` para quem só lê e escreve os documentos da etapa (padrão 30) e `write` para quem altera arquivos (padrão 80), os valores que o runner sempre teve; esgotados, a etapa falha. Um arquivo sem `turns` ganha esses padrões, sem passo de migração. `identity` é quem assina os commits do app no worktree (os dois campos vazios: a identidade que o repositório já tem; o app nunca grava `git config`) e `commitMessage` é o molde da mensagem (`{summary}` e `{iid}`), onde entra a convenção do repositório. O que o runner faz está em [`runner.md`](runner.md).

#### Squads (`squads`, `agents.team[].squad`, `devCycle.flows`)

Opcionais, sem migração (o esquema continua v7: um arquivo sem eles abre como sempre, como um time só). Um squad é `{ id, name, mission, scope, liaison, autonomy, label }`. O `scope` diz de quem é o trabalho: `repos` (ids de `projects.repos`), `labels` (rótulos de issue, caixa não importa), `paths` (`{ repo, prefix }`: uma pasta de um repositório, para um monorepo dividido por pastas) e `unclaimed` (o squad pega o que ninguém reivindica). `liaison` é o `id` do membro que fala pelo squad com os outros; `autonomy` é a chave do squad inteiro (desligada, todo membro espera a pessoa; cada agente continua com a sua chave quando ligada); `label` é o rótulo que a issue ganha no tracker quando uma execução começa no squad. Um agente pertence a **um** squad pelo campo `squad` (ausente ou `null`: compartilhado, trabalha para todos); um fluxo próprio do squad fica em `devCycle.flows[<id do squad>]` (sem entrada, o squad segue `devCycle.stages`). Os agentes do fluxo de um squad são os membros dele e os compartilhados.

A validação roda a verificação dos squads (`checkSquads`, `src/shared/runs/squadCheck.ts`; os textos saem de `squadIssueText`). Erros, que impedem **salvar**: agente em squad que não existe (`agent-squad-missing`), squad com membros e sem contato (`no-liaison`), contato que não existe ou não é membro (`liaison-unknown`, `liaison-not-member`), contato que recorre a um membro do próprio squad (`liaison-turns-inside`), agente que recorre a alguém de outro squad (`turns-other-squad`: a conversa entre squads passa pelos contatos), círculo na cadeia que o runtime realmente percorre (`chain-loop`), id de squad repetido (`squad-duplicate`), fluxo de um squad que não existe (`flow-unknown-squad`) e tudo que a verificação do fluxo acha no fluxo de cada squad olhando só os membros e os compartilhados (`agent-unknown`, `work-no-agent`...). Avisos: escopos que se sobrepõem (`scope-overlap`: permitido, a issue nesse escopo vai para a triagem), squad sem escopo ou sem membros, escopo com repositório que o workspace não lista, dois squads que pegam o que ninguém reivindica e pergunta de um membro que sai do squad sem passar pelo contato (`chain-skips-liaison`). A cadeia `turnsTo` de um squad termina no contato e depois na pessoa: um membro cujo `turnsTo` é a pessoa passa pelo contato primeiro. Um arquivo guardado com problema nos squads abre como estava e o runner não inicia execução nele. Veja [`cycles.md`](cycles.md) e [`runner.md`](runner.md).

Tudo isto se edita em **Configurações › Time e ciclo** (time, squads, fluxo, comentários e execuções); ver [`cycles.md`](cycles.md#editar-o-time-e-o-ciclo-no-app).

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

This is the configuration foundation of Coxia (phase 0). What used to be hardcoded (the company, the machine, the workflow) now lives in one versioned document per workspace: `WorkspaceConfig` (schema version 5). Providers and agent engines: [`llm-providers.md`](llm-providers.md). VCS providers (GitLab, GitHub, Bitbucket): [`vcs-providers.md`](vcs-providers.md).

### Where things live

| What | Where | Scope |
|---|---|---|
| Configuration | `<data>/workspaces/<id>/config.json` (`schemaVersion: 8`) | per workspace |
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
| `userName`, `userArticle` | what the agents call the person, and the Portuguese article that goes with the name (`o`, `a` or empty) |
| `devCycle` | the development cycle: `templateId`, `ceremonies`, `ceremonyParams`, `stages[]`, `stageMapping[]`, `meanings`, `enrichment`, `specLayout`, `comments`, `prompts`, `promptOverrides`, `priority`, `pipelineSkill`, `qa.user`, `releaseLabelPattern`. All in [`cycles.md`](cycles.md) |
| `agents` | `tools`, `extraInstructions` and `persona` (all), `roles[role]` = `{ modelRole, extraInstructions, promptOverride, persona, maxTurns, docs }` (`docs`: which `docs` sources the role reads), `team[]` = the agent team (below) |
| `voice` | `enabled`, `engine`, `sttModel`, `depsInstalled`, plus the settings that already existed |
| `claudeSdk` | `{ installed, version, path }`: where the Claude Agent SDK comes from |
| `externalTools` | **optional** integrations, all off until configured: `cardSource` (command that lists the day's cards), `releaseSync`, `timeExport`, `terminal`, `claudeCli` |
| `runner` | what takes an issue through the agent cycle by itself: `enabled`, `triggerLabel`, `maxConcurrentRuns`, `worktreesDir`, `commands`, `stageIdleMs`, `stageMaxMs`, `turns`, `identity`, `commitMessage` (below) |

Paths use `~/` when under the home folder, so a config is portable. Browser access (host, port, public URL) belongs to the machine and stays in `web.json`.

Schema history: **v1** (no `schemaVersion`) was the app's loose settings before configuration existed; **v2** is `WorkspaceConfig`; **v3** adds `devCycle.priority` and the card fields `priority` and `milestone`; **v4** adds `agents.team` and, on a stage, `agentId`, `artifacts` and `human`; **v5** adds `runner`; **v6** adds `devCycle.comments`; **v7** makes the stages of an agent cycle a flow (`type`, `produces`, `reads`, `next`, `returnsTo`, `roundLimit`, `waitsFor`, `comment`, `trackerStatus`) and adds `turnsTo` to the agents; **v8** replaces `runner.stageTimeoutMs` with `runner.stageIdleMs` and `runner.stageMaxMs`. The v2 to v3 migration (`v2ToV3` in `migrations.ts`) creates `priority: { labels: [] }` and appends the two fields to the `enrichment.cardFields` list the file already had, touching nothing else. The v3 to v4 migration (`v3ToV4`) creates the team with the five built-in agents, taking each one's model role and extra instructions from `agents.roles`, and touches nothing else. The v4 to v5 migration (`v4ToV5`) creates `runner` switched off with its defaults and touches nothing else. The v5 to v6 migration (`v5ToV6`) gives a workspace on the agent cycle that cycle's comment templates and any other cycle none (no template, nothing is posted), and touches nothing else; a file that already carries `comments` keeps them. The v6 to v7 migration (`v6ToV7`) turns `human` into `type: 'gate'` and the other stages into `type: 'work'`, `artifacts` into `produces`, puts the list in the order the runner used to walk it (it was `rank`), takes the agent off the last stage (which never had one in practice) and writes as fields what the runner used to do by itself: the review sends work back to the work stage before it and QA to the first stage whose agent changes files (`returnsTo`), both with `roundLimit: 2`. A cycle with none of the agent fields (the ceremonies' ones) is left alone. A workspace whose agent cycle is still **exactly the default the app delivered** gets the new default (triage, Product Owner, Tech Lead, Customer Success and the communication after the merge): the agents the app adds come in by `id`, the person's agents are **not renamed or touched** (Refiner, Planner and Reviewer stay in the team, only now the stages name the Product Owner and the Tech Lead; Refiner is now the Product Owner, Planner and Reviewer the Tech Lead), the delivered `developer` and `qa` turn to the Tech Lead and the triage and communicate comment templates are added (the ones the person edited stay). A cycle the person changed is left as it is and the migration notes say the new default exists (applying the `agent-flow` template brings it). The v7 to v8 migration (`v7ToV8`) turns `runner.stageTimeoutMs` (one wall-clock limit, 30 min by default) into `runner.stageIdleMs` (the agent showing no sign of life, default 10 min) and `runner.stageMaxMs` (the stage's wall-clock cap, default 2 h): the old default becomes the two new defaults, and a value the person had set becomes the cap (and the silence limit too, when it is shorter than the default one); nothing else is touched. A v8 `config.json` does not open in an app that only knows v7 (it refuses, like any file from a newer app).

#### The agent team (`agents.team`)

Each item is an agent: `{ id, name, job, model, stages, permission, autonomous, turnsTo, instructions, system }`. The `id` is also the name a mention uses (`@developer`). `name`, `job` and `instructions` are a catalog key or free text. `model` is `{ role, provider, model }`: with `role` set the agent uses the provider and model of that `llm.roles` entry; with `role: null` it needs a provider that exists and a model. `stages` lists the `devCycle` stages it works, and `permission` says what it may do to the files of its run: `read` (only reads) or `worktree` (also changes files inside the run's worktree, nowhere else; the executor enforces this, see [`runner.md`](runner.md)).

`autonomous` says whether the agent runs by itself: on, its stage starts when the run reaches it, its tracker comments and reviews are posted automatically (and recorded in the audit log) and its result goes to the next stage without waiting; off (the default), the stage waits for the person to start it, its comments wait in Actions for a "yes" and its result waits for the person to accept it (or send it back with a note). Pushing the branch and opening the pull request wait for the person either way, and a test workspace still refuses every external write. A change of the field takes effect at the next stage start or publication, never in the middle of a stage. The ceremonies ignore it. An autonomous agent that works no stage draws a validation warning. The default team of the agent cycle is autonomous; the five built-in agents are not.

`turnsTo` is the `id` of another agent of the team, or `null` (the person): who the agent turns to when it cannot decide. A question of its goes first to that agent, in the run's thread, which answers by reading or passes it on; the chain ends at the person, and a circle (`a` turns to `b` who turns to `a`), an agent that turns to itself or to one that does not exist is refused by validation (and the runner has a hop limit too). The built-in agents turn to the person. The `agent-flow` template brings: support and customer success to the Product Owner, the developer and QA to the Tech Lead, the Tech Lead to the Product Owner (scope) and the Product Owner to the person. See [`cycles.md`](cycles.md).

The five built-in agents (`system: true`) have the ids of the model roles (`turn`, `reply`, `deep`, `teams`, `fix`), are what the ceremonies call today, and can be edited but never removed: a file that leaves them out gets them back when it is read. Editing a built-in agent through the functions of `src/shared/config/team.ts` (`updateAgent`) also writes `agents.roles[role]` (`modelRole`, `extraInstructions`), which is what the ceremonies read. Validation refuses repeated ids, a built-in id on an ordinary agent, a stage in `stages` that does not exist, a `stage.agentId` that names no agent (and a stage that is not work, a gate or a wait, that names one) and a model with no known provider. The agent of a stage is the one `stage.agentId` names; without it, the first agent of the team that lists the stage; with none, the stage cannot start and says so.

#### The stages of an agent cycle (`devCycle.stages`)

Besides the fields the ceremonies use (`id`, `label`, `match`, `kind`, `rank`), a stage of an agent cycle has the flow fields: `type` (`work`, `gate` or `wait`), `agentId`, `produces`, `reads`, `next`, `returnsTo`, `roundLimit`, `waitsFor`, `comment` and `trackerStatus`, described in [`cycles.md`](cycles.md). The cycle is a flow when some stage has one of those fields; the order is the list's. Validation runs the flow check (`checkFlow`): the errors (a work stage with no agent, a `next` or `returnsTo` that points nowhere, a stage nothing reaches, a flow with no end, a gate first, an artifact that is read and not produced, two stages producing the same file, a wait with no event, a loop in `turnsTo`) stop a change to the flow from being **saved**, and the warnings (an autonomous agent working no stage, a gate after the last work stage, an end stage with no agent) do not; a flow with a problem that was already stored opens as it was, and a change to anything else saves.

#### The runner (`runner`)

Switched on only by the person: `enabled` makes the app start runs by itself for the issues that carry the `triggerLabel` label (default `coxia`, case does not matter), up to `maxConcurrentRuns` runs working at the same time (default 1; a run the person starts never waits). `worktreesDir` is where worktrees are made (`null`: the `worktrees` folder of the workspace's data folder). `commands` are the **only** commands an agent with the `worktree` permission may run, each exactly as written and with no pipe, `;`, `&&` or redirect: `null` uses the test and typecheck scripts the repository declares (`npm test`, `npm run typecheck`), `[]` allows none. `stageIdleMs` is how long the agent may go with no sign of life (text, a tool or model usage) before the stage fails and can be retried (default 10 min), and `stageMaxMs` is the stage's wall-clock cap, talking or not (default 2 h); the migration from schema 7 to 8 turned the old `stageTimeoutMs` into the two. `turns` are the steps (model turns) an agent has in one pass: `read` for one that only reads and writes the stage's documents (default 30) and `write` for one that changes files (default 80), the values the runner always had; when they run out, the stage fails. A file with no `turns` gets those defaults, with no migration step. `identity` is who the app's commits in the worktree are made as (both fields empty: the identity the repository already has; the app never writes `git config`) and `commitMessage` is the message template (`{summary}` and `{iid}`), where the repository's convention goes. What the runner does is in [`runner.md`](runner.md).

#### Squads (`squads`, `agents.team[].squad`, `devCycle.flows`)

Optional, with no migration (the schema stays v7: a file without them opens as it always did, as one team). A squad is `{ id, name, mission, scope, liaison, autonomy, label }`. The `scope` says whose work it is: `repos` (`projects.repos` ids), `labels` (issue labels, case does not matter), `paths` (`{ repo, prefix }`: a folder of a repository, for a monorepo split by folders) and `unclaimed` (the squad takes what nobody claims). `liaison` is the `id` of the member that speaks for the squad to the others; `autonomy` is the switch of the whole squad (off, every member waits for the person; each agent keeps its own switch when it is on); `label` is the label the issue gets on the tracker when a run starts in the squad. An agent belongs to **one** squad through its `squad` field (absent or `null`: shared, it works for every squad); a squad's own flow is in `devCycle.flows[<squad id>]` (no entry: the squad follows `devCycle.stages`). The agents of a squad's flow are its members and the shared ones.

Validation runs the squad check (`checkSquads`, `src/shared/runs/squadCheck.ts`; the texts come from `squadIssueText`). Errors, which stop a change from being **saved**: an agent in a squad that does not exist (`agent-squad-missing`), a squad with members and no liaison (`no-liaison`), a liaison that does not exist or is not a member (`liaison-unknown`, `liaison-not-member`), a liaison that turns to a member of its own squad (`liaison-turns-inside`), an agent that turns to someone of another squad (`turns-other-squad`: talk between squads goes through the liaisons), a circle in the chain the runtime really walks (`chain-loop`), a squad id used twice (`squad-duplicate`), a flow for a squad that does not exist (`flow-unknown-squad`) and everything the flow check finds in each squad's flow looking only at its members and the shared agents (`agent-unknown`, `work-no-agent`...). Warnings: scopes that overlap (`scope-overlap`: allowed, an issue in that scope goes to triage), a squad with no scope or no members, a scope that names a repository the workspace does not list, two squads that take what nobody claims, and a member's question that leaves the squad without passing through the liaison (`chain-skips-liaison`). A squad's `turnsTo` chain ends at the liaison and then the person: a member whose `turnsTo` is the person goes through the liaison first. A stored file with a problem in its squads opens as it was and the runner does not start a run on it. See [`cycles.md`](cycles.md) and [`runner.md`](runner.md).

All of this is edited in **Settings › Team and cycle** (team, squads, flow, comments and runner); see [`cycles.md`](cycles.md#editing-the-team-and-the-cycle-in-the-app).

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
