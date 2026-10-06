# A documentação padrão do projeto: formato, entrega aos agentes, conferência e a execução que a cria

Este plano decide o *como* do que a especificação aprovou no gate 1: a pasta `.coxia/` de cada repositório, o que os agentes do app leem (e o que deixam de ler), a
conferência do que ficou velho, a execução que rascunha a documentação, a manutenção dentro das execuções comuns, a verificação de texto antes do push e a tela em
Configurações. Ele não reabre o comportamento: cada regra e cada recomendação P1 a P8 aprovadas são tratadas como dadas. Onde o plano precisa de uma escolha que a
especificação não fez, ela está na tabela "Decisões para o gate 2", no fim, com a recomendação e a alternativa.

Todo `arquivo:linha` abaixo foi lido nesta árvore de trabalho (`release/0.7.0`, 0.7.0-beta.4). O que o plano supõe e não conseguiu verificar vai nos riscos.

## O que será construído

| Funcionalidade (spec) | Onde cai |
|---|---|
| O formato de `.coxia/` e o cabeçalho de cada arquivo (P1) | `src/shared/harness/format.ts`, `evidence.ts` (puro, com testes); `docs/harness.md` descreve o formato |
| Achar a documentação em cada repositório, sem lista nova (P1) | `src/main/harness/scan.ts`; `resolveDocs` ganha uma opção (§2) |
| Agentes do app não leem nada do Claude Code (P2, critérios 6 e 7) | `src/main/agents.ts` (`sdkOptions`, `openDocs`, `runAgent`), `src/main/engine/contract.ts` (`isolated`), `src/main/engine/open/bridge.ts` (§3) |
| O que cada agente recebe, com orçamento e marca (P5, critérios 8 e 9) | `src/shared/harness/select.ts` (puro), `src/main/harness/deliver.ts`, chaves de prompt novas, `AgentCall.docs` (§4) |
| "Não conferida" (P4, critério 10) | `src/main/harness/stale.ts` (git), usado pela tela e pela entrega (§5) |
| Criar e atualizar a documentação por uma execução própria (P3, critérios 1 a 5) | `src/shared/cycles/templates/docsFlow.ts`, `Run.docs`, `startDocs` no runner, `Confinement.writeRoot`, canais `docs:*` (§6) |
| Manter a documentação nas execuções comuns (P4, critério 11) | `src/main/runner/executor.ts`, `prompt.ts` (seção e instruções), `src/main/harness/finalize.ts` (§7) |
| Verificação de texto antes do push (P7, critério 13) | `rewriteLocal` extraído de `src/shared/runs/comment.ts`; `src/main/harness/finalize.ts` (§8) |
| Configurações › Documentação, só no desktop (P6, critério 12) | `src/renderer/src/screens/DocsSection.tsx`, `docsApi.ts`, lista de fontes extras compartilhada com o assistente (§9) |
| Documentos e CHANGELOG | `docs/harness.md` (novo), `docs/configuration.md`, `docs/runner.md`, `docs/llm-providers.md`, `docs/cycles.md`, `docs/README.md`, `CHANGELOG.md` (§10) |

## 1. O formato de `.coxia/` e o analisador

**O que existe hoje:** nada. O único analisador de cabeçalho de arquivo do app é o das skills e definições de agente do motor aberto
(`parseFrontmatter`, `src/main/engine/open/context.ts:26`), que lê só pares `chave: valor` de uma linha e mora em `src/main`, longe do que a tela e os testes
puros usam. O app não tem dependência de YAML (`package.json` não lista nenhuma) e este plano não acrescenta uma.

**Decisão.**

- A pasta é a constante `HARNESS_DIR = '.coxia'`. Os arquivos que o app entende, e só eles:
  `README.md`; `rules/<id>.md`; `skills/<id>.md`; `roles/<id>.md`, com `<id>` no padrão de id do resto da configuração (`^[a-z0-9][a-z0-9_-]{0,47}$`, o `ID` de
  `src/shared/config/schema.ts`). Um nível só: `rules/a/b.md` não é lido. O tipo do arquivo (`overview`, `rule`, `skill`, `role`) vem do caminho, nunca do conteúdo.
  `.coxia/.run/` e `.coxia/.gitignore` são do app (§6) e ficam fora da contagem; qualquer outro arquivo é listado em Configurações como "ignorado" e nada mais.
- **O cabeçalho** é um bloco entre duas linhas `---` no início do arquivo, num subconjunto de YAML que o analisador entende sozinho: `chave: valor` e listas, em
  linha (`[a, b]`) ou em bloco (`- a`). Os campos, com os nomes exatos:

  | Campo | Valor | Obrigatório |
  |---|---|---|
  | `checked-commit` | hexadecimal de 7 a 40 caracteres: o commit contra o qual o arquivo foi conferido | sim, em todo arquivo |
  | `checked-date` | `AAAA-MM-DD` | sim, em todo arquivo |
  | `evidence` | lista de caminhos relativos à raiz do repositório, cada um com `:linha` ou `:linha-linha` opcional; `pasta/` com barra final vale a pasta inteira | a chave é obrigatória em `rules/`, e a lista não pode ser vazia; opcional nos demais |
  | `stages` | lista de ids de etapa **ou** tipos de etapa (`development`, `review`, `qa`…, os de `STAGE_KINDS`, `src/shared/config/types.ts:175`) a que o arquivo se destina | não |
  | `roles` | lista de ids de agente do time a que o arquivo se destina | não |
  | `summary` | uma linha, até 160 caracteres, que aparece no índice | não (recomendado) |

  Chave desconhecida é guardada e ignorada (um app mais novo pode acrescentar campos sem quebrar este). Caminho absoluto, com `..` ou com `~` em `evidence` torna o
  cabeçalho inválido: a evidência é do repositório, e isso impede que um caminho local entre num arquivo versionado.
- **Arquivo sem cabeçalho válido** não é descartado nem confiado: ele tem o estado `invalid` (com o motivo: `no-header`, `bad-commit`, `bad-date`, `no-evidence`,
  `bad-evidence`), conta como **não conferido** em Configurações, e na entrega (§4) só vai quando é o `README.md` (sempre) ou `roles/<id do agente>.md` (pelo nome),
  sempre com a marca. Os outros aparecem só no índice, com a marca, porque sem cabeçalho nem etapa, nem papel, nem evidência há como escolhê-los.
- O analisador é puro e mora em `src/shared/harness/format.ts`: `parseHarnessFile(path, text)` devolve `{ ok: true, file }` (`kind`, `id`, `header`, `body`) ou
  `{ ok: false, kind, id, reason }`; `evidence.ts` tem `parseEvidence(entry)` (caminho, linhas) e `coversPath(entry, path)` (igual ou prefixo de pasta). Nada lê o
  disco nem o git ali: o mesmo código serve à tela, ao motor de seleção e aos testes.
- **Quem escreve o `checked-commit` e o `checked-date` é o app, não o agente** (§8): o agente não sabe o commit que ainda vai existir.

**Testes:** `test/harness-format.test.ts` (cabeçalho válido nas duas formas de lista; cada motivo de `invalid`; chave desconhecida; evidência com linha, com pasta, com
caminho absoluto; tipo e id pelo caminho; arquivo fora do layout).

## 2. Detecção por repositório, e o que acontece com `autoDetect`

**O que existe hoje.** `resolveDocs` devolve listas de pastas do espaço de trabalho inteiro (`src/main/config-resolve.ts:187-238`) e, com `autoDetect`, acrescenta o
`~/.claude` da pessoa e, por raiz e por repositório, `CLAUDE.md`, `.claude/{skills,agents,rules,knowledge-base}` e `.mcp.json`. `docsSources()` o chama com a
configuração atual (`src/main/workspaceConfig.ts:63-65`). Duas coisas o consomem: `docsFor` (`src/main/agents.ts:365`), que sai em `extraDirs` e `openDocs`, e o texto
das cerimônias (`src/main/cyclePrompts.ts:135-136`).

**Decisão.**

- **A documentação padrão não passa por `ResolvedDocs`.** Aquilo é "listas de pastas que a pessoa aponta"; `.coxia/` tem estrutura própria (arquivos, cabeçalho,
  estado). `scanHarness(repoPath)` (`src/main/harness/scan.ts`) lê `<repo>/.coxia/` e devolve `HarnessState`: os arquivos já analisados e os ignorados. Os
  repositórios são os de `rc().repos` (`id`, `path`; `src/main/workspaceConfig.ts:58-61`). Nenhuma lista nova na configuração: o nome da pasta é uma constante.
- **`resolveDocs` ganha o parâmetro `opts?: { claude?: boolean }`, com `claude: true` por padrão** (o comportamento de hoje, intocado). Com `claude: false`, `autoDetect`
  acrescenta só o `.mcp.json` de cada projeto (o MCP fica como está: P8) e nunca o `~/.claude` nem o `.claude/` e o `CLAUDE.md` de um projeto. `docsSources(opts)`
  repassa. Os agentes do time (`runAgent`) usam `claude: false`; as cerimônias (`runOnce`, `cyclePrompts.ts`) seguem como estão, **de propósito**: a especificação deixa
  fora "mudar as cerimônias dos cinco agentes de sistema" e diz que "o que elas leem hoje continua como está" (decisão D6 do gate 2).
- **O significado de `autoDetect` muda; o formato não.** O campo continua `boolean`, no mesmo lugar (`src/shared/config/types.ts:159`, padrão em
  `src/shared/config/defaults.ts:51`); só a descrição do esquema (`src/shared/config/schema.ts:354`) e o texto do assistente (`wizard.docs.autoDetect*`) passam a dizer
  que ele vale para as cerimônias e para o `.mcp.json`, e que os agentes das execuções, menções e conversas leem a `.coxia/`.
- **Sem migração: `CONFIG_SCHEMA_VERSION` fica em 13** (`src/shared/config/types.ts:5`). A regra de `rules/config-schema.md` pede um passo em `STEPS`
  (`src/shared/config/migrations.ts:270`) quando o **formato** muda: campo novo, campo que some, valor que passa a ter outro tipo ou outro valor padrão. Nenhuma dessas
  coisas acontece: o arquivo de um espaço de trabalho existente é válido antes e depois, e um app anterior o lê sem recusar. O que muda é o que o app faz com o valor. Um
  passo `v13ToV14` que não altera o documento só faria um app 0.6 recusar o arquivo (`validate.ts:283-284`) sem ganho. As listas que a pessoa já preencheu em `docs`
  continuam valendo para os agentes (são as "fontes extras de propósito") e a tela de Configurações marca as que apontam para o `.claude/` ou o `CLAUDE.md` do Claude
  Code (§9) para ela decidir.
- **Testes:** `test/config-resolve.test.ts` ganha um caso com `claude: false` (o existente, `:216`, segue valendo para o padrão) e um caso do repositório sem `.mcp.json`;
  `test/config-schema.test.ts` e `test/config-migrations.test.ts` ganham um caso cada, que **fixa a ausência de mudança**: um arquivo v13 com `docs.autoDetect: true` e
  listas preenchidas passa por `migrateConfig` sem notas e sai igual, e `CONFIG_SCHEMA_VERSION` continua 13. `test/harness-scan.test.ts` cobre `scanHarness`
  (repositório sem `.coxia/`, com arquivos bons, com cabeçalho inválido, com arquivo fora do layout, com `.run/`).

## 3. O isolamento nos dois motores

**O que existe hoje.**

- **Motor do SDK.** `sdkOptions` (`src/main/agents.ts:389-418`; `permissionMode` em `:400`) monta `permissionMode: 'dontAsk'`, `allowedTools`, `disallowedTools`, `hooks`, `systemPrompt` com o preset
  `claude_code` e `append: req.system`, e não define `settingSources`. O único lugar do código que define é o assistente inicial, com `settingSources: []`
  (`src/main/wizard.ts:173`). Pela documentação de tipos do SDK (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2237-2250`, versão 0.3.287), "quando omitido, todas
  as fontes são carregadas (como a CLI)" e "`'project'` é preciso para carregar os `CLAUDE.md`": ou seja, hoje o Claude Code carrega o `CLAUDE.md` e o `.claude/` da pasta de
  trabalho, o `~/.claude/CLAUDE.md` e os `settings.json` da pessoa. **Isto vem só dos tipos; nenhuma execução real o confirmou** (risco R1 e verificação à mão M1).
- **Motor aberto.** `openDocs` (`src/main/agents.ts:421-425`) devolve as listas da configuração e, com todas vazias, `defaultDocSources(cwd)`
  (`src/main/engine/open/bridge.ts:49-58`): `CLAUDE.md` subindo a árvore, `.claude/*` do `cwd` e da pasta pessoal. Além disso, `runOpenOnce` usa
  `selection.docs ?? defaultDocSources(cwd)` (`bridge.ts:99`), o que atinge o gancho de teste `openEngineFromEnv` (que não traz `docs`), e `runOpen` cai em
  `discoverClaudeMd(cwd)` quando `docs.claudeMd` é `undefined` (`src/main/engine/open/loop.ts:226`).
- **Quem chama.** Toda chamada de um agente do time (etapa de uma execução, menção, pergunta da cadeia, pedido entre squads, a execução de documentação) passa por
  `runAgent` (`src/main/agents.ts:1041`). As cerimônias passam por `runOnce` (`:625`), que monta o pedido sem passar por `runAgent`.

**Decisão.**

- `EngineRequest` ganha `isolated?: boolean` (`src/main/engine/contract.ts`, ao lado de `tracker`): "a chamada não lê documentação do Claude Code". `runAgent` o põe `true`; `runOnce`
  não o define (as cerimônias ficam como estão).
- **SDK.** `sdkOptions` acrescenta, quando `req.isolated`, `settingSources: []` e `settings: { autoMemoryEnabled: false }`. O segundo é para a "memória automática" do Claude
  Code (`sdk.d.ts:9114`: lê e escreve em `~/.claude/projects/<pasta>/memory/`), que é conteúdo da pessoa, não do projeto; se a memória for carregada mesmo com `[]`, a
  verificação M1 diz e o plano cai para a variável de ambiente da própria CLI (a confirmar na mesma verificação).
- **O que `settingSources: []` desliga, conferido contra o que o app já passa por conta própria** (para não perder nada que o runner usa):

  | Deixa de valer (vinha do disco) | O app já passa por conta própria? |
  |---|---|
  | `CLAUDE.md` e `.claude/rules` do projeto e do `~/.claude` | **sim, é o objetivo**: a entrega do §4 o substitui por `.coxia/` |
  | skills e subagentes de `~/.claude` e `<projeto>/.claude` (a ferramenta `Skill` e `Agent` não os acham) | não, e fica assim: `skills/` de `.coxia/` são procedimentos lidos como texto; o interruptor `tools.skills` continua existindo e só deixa de achar skills no caminho do SDK (documentado em `docs/llm-providers.md`) |
  | `settings.json` do usuário e do projeto: `env`, `permissions`, `hooks`, `model` | permissões: `permissionMode: 'dontAsk'` + `allowedTools`/`disallowedTools` explícitos (`agents.ts:400-410`); hooks: `hooks` explícito (`:411`); modelo e ambiente: `model` e `env` explícitos (`:536-537`) |
  | servidores MCP declarados em `.mcp.json` ou em `~/.claude.json` | os que o app usa são passados em `mcpServers` (`:535`); o servidor MCP de issues (`tools.trackerMcp`) **nunca** vale para um agente do time: `trackerOf` devolve `none` ou `tool` (`:1016-1019`), "never a tracker MCP server". As cerimônias o usam e ficam sem isolamento |
  | a política gerenciada (empresa) | continua lida (os tipos dizem que `[]` não a desliga) |

- **Motor aberto.** Para `req.isolated`, `runOpenEngine` (`agents.ts:467`) monta `selection.docs` explícito, sobrepondo o da seleção (também o do gancho de teste):
  `{ claudeMd: <docs.claudeMdRoots explícitos>, skillDirs: <skillsDirs>, agentDirs: <agentsDirs>, docDirs: <rulesDirs + knowledgeDirs + as pastas .coxia dos repositórios do
  chamado>, mcpConfigs: <mcpConfigFiles> }`, **sempre com listas definidas** (vazias quando não há nada), o que impede `defaultDocSources` (`bridge.ts:99`) e
  `discoverClaudeMd` (`loop.ts:226`) de entrarem: um `[]` não é `undefined`. As listas vêm de `docsSources({ claude: false })` (§2). `defaultDocSources` continua no
  código, para as cerimônias (`openDocs`) e para os testes do motor.
- **Leitura da própria `.coxia/`.** As pastas `.coxia/` dos repositórios do chamado entram em `extraDirs` quando ficam fora do `cwd` (uma menção na conversa geral roda
  com o `cwd` na raiz dos projetos, `src/main/mentions/answer.ts:141`); numa etapa de execução o `cwd` é o worktree e ela já está lá. `runAgent` já faz
  `extraDirs: call.confine ? [] : extraDirs(call.cwd, modelRole)` (`agents.ts:1059`); passa a somar essas pastas.
- **Como se verifica com um motor falso, sem rede e sem Claude real** (nenhum teste alcança um modelo ou o Claude de verdade):
  1. `test/agent-isolation.test.ts` mocka `@anthropic-ai/claude-agent-sdk` como `test/agent-activity-sdk.test.ts:6-17` e captura as `options`: uma chamada de `runAgent`
     (etapa e menção) leva `settingSources: []` e `settings.autoMemoryEnabled === false`; uma chamada de `askAgent` (cerimônia) **não** leva `settingSources`.
  2. No motor aberto, com `fakeOpenAI` (`test/helpers/fakeOpenAI.ts`), `HOME` e `cwd` apontados para pastas temporárias que têm um `CLAUDE.md`, um `.claude/rules/x.md` e um
     `~/.claude/CLAUDE.md` com um texto-marca: o texto de sistema que o servidor falso recebe **não contém a marca** numa chamada de `runAgent`, **contém a marca** numa
     chamada de cerimônia (fixa "as cerimônias seguem como estão") e contém o `README.md` da `.coxia/` do repositório quando ele existe.
  3. O mesmo, com `COXIA_ENGINE=open` (o gancho `openEngineFromEnv`), para pegar o caminho de `selection.docs` ausente.
  A verificação com o Claude de verdade é à mão (M1), porque o comportamento padrão do SDK só se conhece pelos tipos.

## 4. A entrega e o orçamento

**O que existe hoje.** No SDK as pastas de `docs` só viram legíveis (`additionalDirectories`, `agents.ts:414`); no motor aberto o `CLAUDE.md` entra inteiro no texto de
sistema (teto de 60.000 caracteres, `src/main/engine/open/context.ts:65`), as skills por nome e descrição, e os documentos como índice de nomes (120 arquivos,
`context.ts:168`). O app não tem orçamento próprio no caminho do SDK, e nenhum filtro por etapa, caminho ou agente: só os booleanos do papel de modelo
(`docsFor`, `agents.ts:365-377`).

**Decisão: um texto só, anexado ao texto de sistema, igual nos dois motores.** `runAgent` soma ao `call.system` uma seção montada pelo app. No SDK ela vai em
`systemPrompt.append`; no motor aberto, em `systemAppend` (`bridge.ts:63`, `:92`): o mesmo texto chega por um caminho que os dois motores já têm, e o que entra no
contexto é decidido pelo app, não pelo que cada motor descobre no disco. Os arquivos continuam legíveis (§3), para o agente aprofundar com `Read`.

- **O pedido.** `AgentCall` ganha `docs?: DocsAsk` (`src/main/agents.ts:971`): `{ repos: string[]; stage: { id: string; kind: StageKind } | null; paths: string[] }`
  (o agente é `call.agent.id`). Quem monta cada chamada o preenche; uma chamada sem `docs` não recebe seção (e continua isolada):

  | Chamada | `repos` | `stage` | `paths` |
  |---|---|---|---|
  | etapa de uma execução (`runStage`, `executor.ts:330`) | o worktree da execução | a etapa (id e tipo) | `workPaths` (abaixo) |
  | menção na conversa de uma execução (`service.ts:992`, `answer.ts:141`) | o worktree (ou a pasta do repositório se o worktree sumiu) | a etapa da execução | `workPaths` |
  | pergunta da cadeia e pedido entre squads (`service.ts:1100`, `:1176`) | o worktree da execução (o pedido: a pasta do squad que recebe) | a etapa da execução, ou nenhuma | `workPaths` quando há worktree |
  | menção em canal, conversa geral ou conversa direta (`answer.ts:141`) | `reposOnDisk(place)` (`src/main/mentions/place.ts:61`) | nenhuma | `[]` |

- **`workPaths(run)`: os caminhos que o trabalho toca**, sem chamar modelo. Para uma execução: a união de (a) `git diff --name-only --no-renames <run.base>` no worktree
  (o que o ramo já mudou, mais o que ainda não foi commitado), fora da pasta do ciclo, e (b) os caminhos que o texto dos documentos do ciclo cita (a spec e o plano, que
  `runStage` já leu em `files`, `executor.ts:392`), os que existem no worktree, até 200. A parte (b) é o que dá ao desenvolvedor, na primeira passada, as regras dos arquivos que
  o plano nomeia, antes de ele ter tocado em qualquer um.
- **A seleção** (`src/shared/harness/select.ts`, pura): `selectDocs(files, ask, agent)` devolve `{ overview, picked, indexed }`. Entra sempre o `README.md` (a visão geral). Um
  arquivo de `rules/`, `skills/` ou `roles/` é **escolhido** quando (1) o seu `stages` contém o id ou o tipo da etapa, ou (2) o seu `roles` contém o id do agente (e
  `roles/<id do agente>.md` vale pelo nome), ou (3) alguma entrada de `evidence` cobre um caminho de `paths`. Os não escolhidos entram no **índice** (nome e `summary`), para o
  agente saber o que existe e poder abrir. Ordem de prioridade quando o orçamento aperta: as notas do papel do agente, as regras com mais caminhos cobertos, as escolhidas
  por etapa, as skills.
- **O orçamento por chamada: 24.000 caracteres** (cerca de 6 mil tokens), **reduzido pela janela de contexto quando o provedor a declara**: `min(24.000, 3 × janela × 0,15)`,
  com piso de 3.000 (`target.capabilities?.contextWindow`, o mesmo campo que `openSelection` já passa, `agents.ts:441`); um modelo de 8 mil tokens fica com 3.600 caracteres.
  Fica abaixo do teto de 60.000 do `CLAUDE.md` do motor aberto e da faixa de 10 mil tokens a partir da qual `docs/llm-providers.md:100` (en: `:204`) já avisa que um modelo
  pequeno não dá conta (decisão D1). Dentro dele: a visão geral ocupa no máximo 40%; um arquivo que não cabe inteiro entra cortado, com a nota do corte, se couberem 600
  caracteres; o que não coube vira uma linha **"não coube"**, com os nomes, que diz que os arquivos estão em `.coxia/` e podem ser lidos. **Nada é cortado em silêncio** (critério 9).
- **A marca "não conferida"** acompanha o arquivo no texto: `[não conferida: N arquivo(s) citado(s) mudaram desde <commit curto> (<até 3 nomes>)]`, ou `[não conferida: não deu
  para verificar no repositório]`, ou `[não conferida: sem cabeçalho válido]`. A seção abre dizendo ao agente que uma regra assim pode estar velha, que ele a confirme no código
  antes de apoiar-se nela e que diga quando o fez. Um agente que lê uma regra marcada a recebe marcada: é o que o critério 10 pede.
- **Sem `.coxia/`, nenhum texto novo.** Um repositório sem a pasta não acrescenta nada ao texto de sistema (nem uma linha "não há documentação"): a tela diz isso (critério 15),
  e os goldens do runner (`test/runner-golden.test.ts`) continuam byte a byte iguais.
- **Os textos** são chaves de prompt novas da família base (`prompt.sdd.runner.docs.head`, `.overview`, `.item`, `.index`, `.notIncluded`, `.clipped`, `.mark.stale`,
  `.mark.unverified`, `.mark.invalid`) nos **dois** catálogos (`src/shared/i18n/main.en.json`, `main.pt-BR.json`), usadas por chave literal em `deliver.ts` (o teste
  `test/cycle-prompts.test.ts:120-137` falha com chave sem uso) e sem palavra de host: `{cr}`, `{crLong}` onde for preciso (`test/host-terms-leak.test.ts`). Chaves novas entram
  nos fixtures de `test/fixtures/catalogs-main` pelo caminho de atualização do próprio teste `gitlab-catalogs-unchanged`, que as lista como intencionais.
- **Testes:** `test/harness-select.test.ts` (visão geral sempre; escolha por etapa, por tipo de etapa, por papel, por evidência; índice dos não escolhidos; orçamento com
  corte, com "não coube", com janela pequena; marcas), `test/harness-deliver.test.ts` (o texto montado nos dois idiomas, repositório sem `.coxia/` devolve vazio, vários
  repositórios dividem o orçamento) e os de §3 (o texto chega ao motor falso nos dois caminhos).

## 5. A conferência: "não conferida"

**Algoritmo** (`src/main/harness/stale.ts`, com os utilitários de git de `src/main/conflictGit.ts` que `src/main/runner/git.ts:3` já usa; só leitura):

1. Para cada arquivo válido com `evidence` não vazio: o **ponto de referência** `ref` é o `checked-commit` do cabeçalho **se** ele é antepassado de `HEAD`
   (`git merge-base --is-ancestor <commit> HEAD`; `cat-file -e <commit>^{commit}` antes, que também resolve hash curto). Se não é (o commit sumiu por um squash ou um rebase
   do pull request), o `ref` é **o commit mais antigo que introduziu aquele valor no cabeçalho do arquivo**: `git log -S<commit> --reverse --format=%H -- <arquivo>`, o primeiro.
   Em uma história com squash esse commit é o da mesclagem, que contém a regra e a mudança de código juntas, e o que veio depois é o que conta. Se nada o acha, o estado é
   `unverified` ("commit fora da história": não conferida, como a especificação manda).
2. Os arquivos que mudaram: `git diff --name-only --no-renames <ref> -- <caminhos de evidência> ':(exclude).coxia'`. Sem `HEAD` no comando, o diff é contra a **árvore de
   trabalho**, então uma mudança ainda não commitada também conta. `--no-renames` faz um arquivo renomeado aparecer pelo nome velho e pelo novo: nada some por ter mudado de
   lugar; um arquivo apagado conta como mudado. Entradas de `evidence` viram caminhos (`:linha` cortado; `pasta/` vale como pasta); globos não existem.
3. Qualquer arquivo na saída: estado `stale`, com a lista (guardada até 5 para a tela e a marca). Vazio: `checked`.
4. Um arquivo sem `evidence` (visão geral, skill, papel) é sempre `checked`: não há o que comparar. Falha de git ou limite de tempo (5 s por repositório): `unverified`.

**Onde roda.** (a) Quando a tela de Configurações › Documentação abre (e no botão "Reler"), para cada repositório em paralelo; (b) antes da entrega a um agente (§4), sobre o
`repos` do pedido. **Custo:** o diff é um por `ref` distinto, e não por arquivo (arquivos conferidos no mesmo commit compartilham o resultado); um repositório com 40 arquivos e
poucos commits de conferência são alguns `git` de leitura, na casa das dezenas de milissegundos cada. **Cache** por `(raiz do repositório, HEAD, assinatura dos arquivos de
`.coxia/`: nome, tamanho e mtime)`: a segunda chamada de uma execução, com o mesmo `HEAD`, custa um `rev-parse`. Mudou o `HEAD` ou um arquivo, o cache daquele repositório se refaz.

**A marca só sai por uma mudança aprovada que atualiza o cabeçalho** (decisão do gate 1): o app **não** tem botão de "marcar como conferida" (a especificação fechou isso). O que
atualiza o cabeçalho é o carimbo do §8, escrito pelo app na mesma execução que mudou o arquivo e aprovado na revisão do pull request.

**Testes:** `test/harness-stale.test.ts`, com repositórios temporários criados por `git` (como `test/release-git.test.ts`): referência antepassada; commit que sumiu e é achado
pelo `-S` (squash simulado); commit que não existe; arquivo citado apagado e renomeado; mudança não commitada; evidência com pasta; visão geral sem evidência; falha de git
(`unverified`); cache reaproveitado e invalidado por `HEAD`.

## 6. A execução de documentação (P3)

**O que existe hoje.** Uma execução começa de uma issue (`create`, `src/main/runner/service.ts:571-646`) ou, a exceção, de uma versão (`createRelease`, `:662-720`, assunto
`RunSubject` com `kind: 'release'`, fluxo em `devCycle.flows.release`, de `src/shared/cycles/templates/releaseFlow.ts`). Uma execução escreve no seu worktree e termina em um
push e um pull request, cada um esperando o "sim" em Ações (`proposePush`, `publish.ts:659-676`; `pullRequest`, `:678-698`); o corpo termina com `Closes #<n>` (`closesOf`,
`publish.ts:653-656`).

**Decisões.**

- **Um campo `docs` em `Run`, e não um segundo tipo de `RunSubject`.** `run.subject` é lido como "é uma release" em cerca de 50 pontos (`transitions.ts`, `view.ts:284`,
  `executor.ts:412,436`, `publish.ts`, `module.ts:101`, `service.ts:847,1357`, `RunScreen.tsx:104`); tornar `RunSubject` uma união obrigaria a tocar em todos, com risco para o
  fluxo de release que já funciona. `Run.docs?: { mode: 'create' | 'update' }` (`src/shared/runs/types.ts`, ao lado de `subject`, `:395`) e o objeto correspondente em
  `RUN_SCHEMA` (`src/shared/runs/schema.ts:217-270`); `RUN_VERSION` fica em 1 (o `subject` entrou do mesmo modo). A execução leva a issue sintetizada `docs:<repo>`, número 0
  (como `release:X.Y.Z`), o que mantém "uma por vez" (`runs.activeFor`, `service.ts:665`) por repositório.
- **O fluxo é um modelo de ciclo ao lado do de release** (`src/shared/cycles/templates/docsFlow.ts`, `runKind: 'docs'`): cinco etapas, `docs-draft` (trabalho, agente
  `docs-writer`, produz `IMPORT_NOTES.md`), `docs-gate` (**o gate da pessoa sobre o rascunho**, devolve a `docs-draft` com o motivo), `docs-publish` (trabalho, o mesmo
  agente: aplica o que a pessoa pediu no gate e escreve a descrição do pull request), `docs-ready` (espera `pr-merged`) e `docs-done` (fim). **Por que duas etapas que escrevem:**
  `pushStagesOf` propõe o push ao fim da última etapa cujo agente altera o worktree (`src/shared/runs/flow.ts:107-114`); com só `docs-draft` escrevendo, o push seria proposto
  **antes** do gate. Com `docs-publish` depois do gate, o push só nasce depois que a pessoa aprovou o rascunho, como a especificação pede. Não há etapa de revisão: a revisão é
  a do pull request, pela pessoa.
- **Aplicar o modelo.** `RELEASE_FLOW_KEY` (`src/shared/config/squads.ts:48-57`) vira um par de chaves de "tipo de execução" (`'release'`, `'docs'`) e `docsFlowOf(config)` o
  lê; o que nomeia a chave de release e precisa conhecer a segunda: `src/shared/cycles/apply.ts:29-43` (`applyRunKind` escolhe a chave por `runKind`; `parseTemplate`, `:168`,
  aceita `'docs'`), `src/shared/cycles/types.ts:32` (`runKind?: 'release' | 'docs'`), `src/shared/config/validate.ts:96-103` e `:181-185` (a verificação do fluxo e os
  eventos de comentário, com o evento `docs-pr`), `:111-114` (`docs` não pode ser id de squad), `src/shared/runs/squadCheck.ts:162`, `src/renderer/src/screens/team/flowEdit.ts:198`
  e `src/renderer/src/screens/cycle/RunScreen.tsx:104`. `listCycleTemplates` já esconde modelos com `runKind` (`src/main/cycles.ts:45`): o assistente não o oferece.
  O modelo é aplicado **na primeira vez que a pessoa clica em Criar**, depois de uma confirmação que diz o que entra (o agente "Redator da documentação" e o fluxo), pelo
  `updateConfig(applyTemplate(...))` do módulo (D11).
- **O agente que rascunha** é `docs-writer`, um agente comum do time criado pelo modelo (`newAgent`, como `releaseManager`): `permission: 'worktree'`, `shell: 'none'`,
  `tracker: 'none'`, `autonomous: true` (o gate e o "sim" do push são o freio; sem isso a pessoa aceitaria o resultado e aprovaria o gate, duas vezes), modelo `deep`. A pessoa o
  vê e edita em Configurações › Time como qualquer outro, inclusive trocando o modelo. As instruções (chave `cycle.docsFlow.team.docsWriter.instructions`, nos dois idiomas)
  dizem: o formato do §1 com um exemplo; que cada `evidence` é um `arquivo:linha` **lido** no código, nunca inventado; **o que é fato do projeto** (arquitetura, regras de
  domínio, comandos de construir e testar) e **o que é regra de sessão ou de outro sistema** (quem faz push, papéis de subagente, procedimentos de merge, identidade de commit de
  uma ferramenta), com exemplos de cada um; que o que fica de fora vai para `IMPORT_NOTES.md` com o motivo; que o `CLAUDE.md` e o `.claude/` do repositório se leem para
  importar e nunca se alteram; e que não se escreve credencial, host, caminho local nem nome de pessoa.
- **Onde o agente só escreve em `.coxia/`.** `Confinement` (`src/main/engine/contract.ts:55-62`) ganha `writeRoot?: string`; `confinedHooks` (`src/main/runner/hooks.ts:41`)
  recebe `writeRoot` e o `writeGuard` (`:47-53`) passa a usar `checkPath(o.writeRoot ?? o.root, …)`, enquanto o `readGuard` (`:55-67`) continua no worktree inteiro (o agente
  precisa ler o código). O motor aberto recebe `writeRoot: req.confine?.writeRoot ?? req.confine?.root` (`agents.ts:483`). `runStage` monta, para uma execução de
  documentação, `confine: { root: wt, writeRoot: join(wt, '.coxia'), hooks: confinedHooks({ root: wt, writeRoot, commands: [], onDenied }) }` (`executor.ts:430`) e cria a
  pasta `.coxia/` vazia antes da etapa (`checkPath` exige que a raiz exista, `src/main/engine/guard.ts:83`). Uma escrita fora dela é recusada pelo mesmo código nos dois motores, com a
  mensagem de sempre (`runner.denied.outside`). Sem comandos: `commands` é vazio e o agente lê pelo `Read`, `Grep` e `Glob`.
- **A pasta do ciclo dessa execução não vai no pull request.** O runner escreve a pasta do ciclo (o registro, a memória, os documentos das etapas) no worktree e o `commitAll`
  versiona tudo (`src/main/runner/git.ts:150-156`). Numa execução de issue isso é desejado (a spec e o plano seguem com o pull request); numa de documentação seria ruído em
  qualquer repositório. A pasta é `.coxia/.run/` (`run.cycleFolder`) e o app escreve `.coxia/.gitignore` com `.run/` antes do primeiro commit: o `git add -A` não a vê, o
  `readFolder`/`writeArtifact` funcionam em disco como sempre, `editMemory` não encontra o que commitar (`commitAll` devolve `null`) e `branchDiff` já exclui a pasta do ciclo
  (`git.ts:163-167`). O pull request leva `.coxia/**` e o `.gitignore` de uma linha (D7).
- **A descrição do pull request** vem de um modelo `docs-pr` em `devCycle.comments` (a chave `pr` é a do fluxo de issue e a do espaço de trabalho vence quando já existe,
  `apply.ts:35`): `executor.ts:366` passa a pedir `askOf(run.docs ? 'docs-pr' : 'pr')` e `publish.ts:664` lê a mesma chave; o registro continua em `run.comments.pr`
  (`recordCommentDraft(r, 'pr', …)`), então `prOf`, `pullRequestOpened` e a espera `pr-merged` não mudam. As seções do `docs-pr` (chaves `cycle.docsFlow.comment.docs-pr.*`):
  o que isto acrescenta; o que foi importado do Claude Code; **o que ficou de fora e por quê** (critério 4; o agente do `docs-publish` lê o `IMPORT_NOTES.md`, que está em
  `files`); o que conferir ao revisar. **Sem `Closes #<n>`:** `closesOf` não é chamado para uma execução de documentação (`publish.ts:665` e `:688`) e o corpo de reserva é o
  resumo (`:689`). O título é `run.issue.title` (`Documentation of <repo>`) ou o que o agente deu.
- **O que o publicador não faz numa execução de documentação**, porque não há issue (iid 0): `deliver` (`publish.ts:298-377`) retorna sem escrever quando `x.target === 'issue'` e
  `run.docs` (a conversa da execução é o registro; o que seria comentário na issue fica no fórum, e o texto "sem issue" não é dito como falha); `prOf` (`:281-296`) e
  `prState` (`:867-873`) só usam o `noteId` gravado, nunca `linkedMrs(issue, 0)` (`:286`, `:871`); `reporter` (`executor.ts:359`) é falso, para o agente não oferecer perguntar
  a quem "reportou". Ações mostra o push e o pull request com o título da execução (`issueTitle`); o número 0 não deve aparecer: verificação M5.
- **Como se inicia.** `Runner.startDocs(repoId, mode)` (`service.ts`, depois de `startRelease`): confere duplicata (`activeFor('docs:<repo>')`), o fluxo (`docsFlowOf`), a identidade
  de commit (`commitIdentity`, `no-identity`), resolve o repositório (`repoFor`, `:544-557`, já devolve `repo-ambiguous` e `no-clone`), cria o worktree com `createWorktree`
  (`git.ts:64-78`, que já busca a ponta do remoto), escreve `.coxia/.gitignore`, o resumo da tarefa como `0_ISSUE.md` na pasta do ciclo (o modo, o que existe em `.coxia/` com o
  estado de cada arquivo, e **os candidatos à importação**: os caminhos do `CLAUDE.md` e de `.claude/**` do **próprio repositório**) e `commitAll`. **Ramo:**
  `cycle/docs-<repo>-<AAAAMMDD>` e pasta `docs-<AAAAMMDD>` no worktrees-dir (D3); um segundo no mesmo dia dá `branch-exists`, o erro de sempre (`git.ts:66-68`). Não chama
  `ensureDependencies` (o rascunho não roda código). Canais: `docs:status` (leitura, §9) e `docs:start(repo, mode)`, ambos negados ao navegador pareado por um
  `/^docs:/` em `src/main/webPolicy.ts` (ao lado de `WIZARD`, `:49-55`); `docs:start` fica registrado em `src/main/runner/module.ts`, junto de `runs:startRelease`, por precisar do
  runner.
- **Espaço de trabalho de teste.** A execução inicia (só escreve no worktree, como qualquer uma), o rascunho e o gate funcionam, e o push e o pull request são **propostos e
  recusados na confirmação** pelo guarda de sempre (`externalRefusal`, `src/main/runner/door.ts:19`); nada novo (critério 5).
- **Atualizar** é a mesma execução com `mode: 'update'`: o resumo lista os arquivos `stale`, `unverified` e `invalid` com o motivo, e o agente os verifica contra o código,
  corrige o corpo, tira o que deixou de ser verdade e acrescenta o que falta de óbvio. O carimbo (§8) atualiza o cabeçalho do que ele mexeu.
- **Testes:** `test/runner-docs.test.ts` com o motor falso do runner (`test/helpers/runner.ts`) e o forge falso (`test/helpers/fakeForge.ts`): a execução inicia no repositório
  temporário, `docs-draft` escreve `.coxia/rules/x.md` e uma escrita fora de `.coxia/` é recusada nos dois motores (como `test/runner-agent-open.test.ts`), o gate segura o push
  até a aprovação, o push proposto depois do gate, o corpo do pull request sem `Closes`, com a seção do que ficou de fora, o `.run/` fora do commit, rejeitar o gate volta a
  `docs-draft`; `test/runner-release.test.ts` e `test/runner-golden.test.ts` seguem verdes (a execução de release e a de issue não mudam); `test/cycle-templates.test.ts`
  (o modelo é válido, é aplicado ao lado do fluxo da pessoa sem tocá-lo, não é oferecido pelo assistente); `test/flow-check.test.ts` (o fluxo passa pela verificação);
  `test/docs-policy.test.ts` (`docs:*` negados ao navegador pareado, como `test/runs-policy.test.ts` faz com os de `runs:*`).

## 7. A manutenção nas execuções comuns (P4)

**O que existe hoje.** O push leva o ramo inteiro da execução (`proposePush`, `publish.ts:673`: `HEAD:refs/heads/<ramo>`), e `pushStagesOf` escolhe a etapa em que ele é
proposto (`flow.ts:107`). Logo, **uma mudança de documentação feita no mesmo ramo segue no mesmo pull request sem tocar em `pushStagesOf`**: o plano não o altera.

**Decisão.**

- **A etapa que muda código** (o agente com `permission: 'worktree'` que não é a execução de documentação) recebe, em `StageInput`, a mesma seção do §4 (já escolhida por
  etapa, papel e `workPaths`), mais uma instrução em `systemText` (`prompt.ts:89`), chave `prompt.sdd.runner.docs.keep`: "se a sua mudança torna falsa uma regra de `.coxia/`, edite a
  regra neste ramo; não escreva `checked-commit` nem `checked-date` (o app os registra); se uma regra citada por você não cobre a sua mudança, não a toque". Uma regra marcada
  como não conferida que a mudança confirma é conferida pelo agente lendo-a contra o código; o carimbo do §8 é o que atualiza o cabeçalho.
- **A etapa de revisão aponta a regra deixada para trás.** No começo da etapa de revisão (`kind === 'review'`), `runStage` calcula (`src/main/harness/stale.ts`,
  `behindOf(wt, base)`) as regras `stale` cujo `evidence` cobre um arquivo que **o ramo mudou** (`git diff --name-only <base>`) e que o ramo **não atualizou** (o arquivo da regra
  não está no diff, ou o cabeçalho continua o mesmo). Regras já velhas antes do ramo (nenhum arquivo do ramo as cobre) não são cobradas desta execução. A lista entra em
  `StageInput.behind` e vira uma seção do prompt (`prompt.sdd.runner.section.docsBehind`) e uma instrução de saída (`prompt.sdd.runner.output.docsBehind`): cada regra
  esquecida é **um achado** da revisão, de gravidade não bloqueante por padrão, com o arquivo da regra e o arquivo de código que mudou (a revisão é leitora: nada é escrito por
  ela). O revisor pode julgá-la bloqueante se a regra ficou falsa e perigosa; a devolução ao desenvolvedor segue as regras de sempre de `roundLimit`.
- **Sem `.coxia/` não há nada disto:** nem seção, nem instrução, nem achado (a execução do repositório sem documentação segue como antes).
- **Testes:** `test/runner-docs-keep.test.ts`: o desenvolvedor recebe a regra cuja evidência o plano cita (antes de tocar em nada) e a que o ramo já tocou; uma regra com mudança
  de código no ramo e sem mudança no arquivo dela aparece na seção da revisão; uma regra que o ramo também atualizou não aparece; uma regra velha antes do ramo não aparece; a
  chamada de uma menção na conversa da execução recebe a mesma seleção; o `pushStagesOf` não muda (`test/runs-flow.test.ts`).

## 8. A verificação de texto antes do push (P7) e o carimbo

**O que existe hoje.** Comentários, revisões e a descrição do pull request passam por `checkText`/`checkComment` (`src/shared/runs/comment.ts:170-215`, `:222`): caminhos
locais reescritos (`ABSOLUTE`, `HOME_RELATIVE`, `:131-132`), credenciais mascaradas por `redact` (`src/main/errorlog-core.ts:29-34`, passado em `checkOptions`,
`publish.ts:254`), menção, id de execução, e **problemas** (nome de agente, "Claude Code", "fórum", primeira pessoa). O conteúdo de arquivo versionado não é verificado antes
do push.

**Decisão.**

- **Reusar só a parte de reescrita, não a de problemas.** Os problemas de `checkText` são regras de comentário para quem não é engenheiro (`TOOL` proíbe "Claude Code",
  "Anthropic"; `FIRST_*` proíbe "eu" e "nós"): uma documentação de projeto cita essas palavras legitimamente. Extrai-se `rewriteLocal(raw, { worktree, redact })` de
  `checkText` (`comment.ts:176-188`), que devolve `{ body, paths, secret }` e é o que `checkText` passa a chamar; o comportamento de `checkText` não muda (`test/runs-comment.test.ts`
  o fixa). A documentação usa `rewriteLocal`, sem menção, sem id de execução e sem problemas.
- **O que muda e o que se recusa.** Reescreve-se (caminho local → caminho no repositório ou último nome; credencial → `[redacted]`, `[key]`, `[email]`…) o **corpo** dos
  arquivos `.coxia/**/*.md` que a passada alterou, nunca o cabeçalho (o `checked-commit` tem 40 hexadecimais e a regra de "cadeia opaca" de `redact`, `errorlog-core.ts:26`, o
  mascararia; o cabeçalho é validado pelo analisador: `evidence` com caminho absoluto é `invalid`, §1). **Nada é recusado nem bloqueia**: a revisão da pessoa no pull request
  é o gate. A verificação `redact` também mascara e-mails e cadeias longas no corpo: por isso hashes de commit só vão no cabeçalho (documentado em `docs/harness.md`).
- **Onde corre.** Em `runStage` (`executor.ts`), depois que o agente respondeu e **antes** de `commitAll` (`:492`): se a passada mexeu em `.coxia/` (`git status --porcelain --
  .coxia`), `finalizeHarness(wt, …)` reescreve o que há a reescrever. É antes do push ser proposto, porque o push só é proposto depois do fim da etapa (`publish.ts:1405`).
- **O que a pessoa fica sabendo.** Uma linha de sistema no fórum da execução (`main.forum.code.runner.docs.checked`, nos dois catálogos): "N caminho(s) local(is) reescrito(s) e M
  credencial(is) mascarada(s) em `<arquivos>`". Sem reescrita, nenhuma linha. Um arquivo cujo cabeçalho ficou inválido também é dito (`runner.docs.invalidHeader`), com o motivo.
- **O carimbo.** Depois do commit `A` da passada, se `A` mexeu em arquivos `.coxia/**/*.md` com cabeçalho analisável, o app escreve neles `checked-commit: A` (40 hexadecimais) e
  `checked-date: <hoje, UTC>` e faz um segundo commit `B` ("update the documentation check") com a mesma identidade. O carimbo vai **só** nos arquivos que a passada mexeu: "uma mudança
  aprovada que atualiza o cabeçalho" é exatamente isto. `B` só toca `.coxia/`, que `stale.ts` exclui da comparação, então a regra não nasce velha. Como o app (e não o agente)
  escreve o commit, a regra do passo 1 do §5 resolve os três modos de mesclar o pull request: com merge `A` é antepassado; com rebase `A'` é achado pelo `-S`; com squash o commit
  da mesclagem é.
- **Testes:** `test/harness-finalize.test.ts`: caminho local e credencial reescritos no corpo e nunca no cabeçalho; o hash de 40 caracteres do cabeçalho intacto; a linha no fórum
  só quando algo mudou; o carimbo só nos arquivos mexidos e em dois commits; arquivo sem cabeçalho analisável não é carimbado e é dito; `test/runs-comment.test.ts` segue
  verde com `rewriteLocal` extraído.

## 9. Configurações › Documentação (P6)

**O que existe hoje.** Não há seção de documentação em Configurações (`src/renderer/src/screens/Settings.tsx`, seções de `:132` a `:384`); `docs` só se edita no passo do assistente
(`src/renderer/src/wizard/steps/DocsStep.tsx`, `DOCS_KEYS` de `src/shared/wizard.ts`), que se reabre por "Abrir o assistente". Seções de desktop se escondem por `isWeb()`
(`src/renderer/src/platform.ts:2`, como `UpdateSection`), e o canal precisa estar na política (`webPolicy.ts`).

**Decisão.**

- **O componente** `DocsSection` (`src/renderer/src/screens/DocsSection.tsx`), entre `TeamSettings` e a seção de modelos em `Settings.tsx:133`, escondido com `isWeb()`. Estilo pelas
  classes existentes (`panel`, `btn`, `badge badge-ask`, `badge badge-block`) e variáveis de tema; nenhuma cor literal (`node scripts/theme-audit.mjs`).
- **O que mostra, por repositório de `rc().repos`:** se `.coxia/` existe (senão: "não há documentação padrão" e o botão **Criar a documentação**); quantas regras, skills e papéis
  (`roles/`), e a visão geral; os arquivos **não conferidos** com o motivo (`stale` e os arquivos citados que mudaram, `unverified`, `invalid`), cada um com a data e o commit curto do
  cabeçalho; os arquivos ignorados; se há uma execução de documentação ativa (com o atalho para a execução); o botão **Atualizar a documentação** quando há algo não conferido (ou
  **Criar**, quando não há `.coxia/`); e um aviso, quando o repositório tem `CLAUDE.md` ou `.claude/`, de que **eles são do Claude Code e os agentes do app não os leem**, com a
  oferta de importar (o próprio botão de criar/atualizar, que os lê). A leitura é `docs:status` (que roda §5 para cada repositório em paralelo, com o cache), e o botão chama `docs:start`.
- **As fontes extras.** O editor das listas de `docs` (`DocsStep.tsx:57-131`) é extraído para um componente `DocsSourceLists`, usado pelo assistente e por esta seção (as listas, o
  campo de caminho, "escolher", o aviso de que não existe); o assistente mantém o que é só dele (o "reler" e as propostas `found`). Na seção, uma entrada que aponta para o
  `.claude/` ou para o `CLAUDE.md` do Claude Code leva o selo "do Claude Code" e um botão de remover. Salvar usa o caminho de `config:save` da área de trabalho (como o assistente),
  que o navegador pareado não alcança.
- **Textos:** chaves `ui.settings.docs.*` nos dois catálogos de `ui-settings` (`src/shared/i18n/ui-settings.pt-BR.json`, `ui-settings.en.json`), por `t()` (`useT`). O hint do
  `autoDetect` do assistente muda nos catálogos do assistente (`wizard.pt-BR.json`, `wizard.en.json`) e nos fixtures de `test/fixtures/catalogs-main/wizard.*.json`.
- **Testes:** `test/docs-status.test.ts` (o `docs:status` por repositório: sem `.coxia/`, com arquivos bons, `stale`, `invalid`, com `CLAUDE.md`), `test/docs-policy.test.ts`
  (negado ao navegador); a tela é verificada à mão (M3, M4), porque o projeto não tem teste de componente (`test/ui-i18n.test.ts` só confere as chaves).

## 10. Documentos a atualizar

Cada um nos dois idiomas onde já tem os dois (as páginas têm uma seção em português e uma em inglês no mesmo arquivo):

- **`docs/harness.md` (novo)**: o formato (§1), o que os agentes leem e o que deixam de ler, a entrega e o orçamento, a conferência, a execução de documentação, as
  limitações (hash só no cabeçalho, o carimbo, o motor do SDK e as skills). Indexado em `docs/README.md`. É a casa do fato; os outros apontam para ela.
- **`docs/configuration.md`** (`:35`, `:183`): `docs` e `autoDetect` com o novo significado e a nota de que não houve mudança de formato (a versão do esquema segue 13).
- **`docs/runner.md`**: a execução de documentação (início, fluxo, o agente, onde escreve, o pull request sem `Closes`) e a seção de documentação na etapa de código e na revisão.
- **`docs/llm-providers.md`** (`:76`, `:100` e as de `:180`, `:204`): o motor aberto e o SDK entregam a `.coxia/` por texto de sistema com orçamento; `defaultDocSources` fica só para as
  cerimônias e os testes; a ferramenta `Skill` no SDK.
- **`docs/cycles.md`**: o modelo `docs-flow` (ao lado do de release), a chave de comentário `docs-pr`.
- **`CHANGELOG.md`**, em `## [Unreleased]`: uma entrada em *Added* (a documentação padrão e a execução que a cria) e uma em *Changed* (os agentes do app deixam de ler
  `.claude/` e `CLAUDE.md`; o `autoDetect` passa a valer só para as cerimônias e o `.mcp.json`).

## Ordem dos commits

Plano sozinho no primeiro. Cada commit compila e passa nos cinco portões (`npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`,
`node scripts/public-audit.mjs`), com os testes dele:

1. `feat: add the plan for the project documentation` (este arquivo, sozinho).
2. `feat: add the format of the project documentation` (§1: `src/shared/harness/`, `test/harness-format.test.ts`).
3. `feat: find and check the project documentation of each repository` (§2 e §5: `scanHarness`, `stale.ts`, a opção de `resolveDocs`, `test/harness-scan.test.ts`,
   `test/harness-stale.test.ts`, os casos de `config-resolve`, `config-schema` e `config-migrations`). Sem mudança de comportamento para os agentes.
4. `feat: give the agents of the app the project documentation and nothing of Claude Code` (§3 e §4: `isolated`, `settingSources`, o motor aberto, `AgentCall.docs`,
   `workPaths`, `select.ts`, `deliver.ts`, as chaves de prompt, os fixtures de catálogo, `test/harness-select.test.ts`, `test/harness-deliver.test.ts`, `test/agent-isolation.test.ts`).
5. `feat: check the text of the documentation and record when it was checked` (§8: `rewriteLocal`, `finalize.ts`, o gancho em `runStage`, as linhas do fórum,
   `test/harness-finalize.test.ts`).
6. `feat: draft the project documentation in a run of its own` (§6: `Run.docs`, o modelo, `startDocs`, `Confinement.writeRoot`, as guardas do publicador, `docs:start`,
   `webPolicy`, `test/runner-docs.test.ts`, `test/docs-policy.test.ts`, `test/cycle-templates.test.ts`).
7. `feat: keep the documentation true in the runs that change code` (§7: a seção e a instrução do desenvolvedor, o `behind` da revisão, `test/runner-docs-keep.test.ts`).
8. `feat: show the project documentation in Settings` (§9: `docs:status`, `DocsSection`, `DocsSourceLists`, as chaves de interface, `test/docs-status.test.ts`).
9. `feat: document the project documentation` (§10: as páginas e o CHANGELOG).

A ordem põe a conferência (3) antes da entrega (4), que a usa para a marca, e o carimbo (5) antes da execução de documentação (6), que depende dele; a manutenção (7) vem depois
que existe o que manter, e a tela (8) por último, quando há o que mostrar.

## Plano de teste

Nenhum teste alcança modelo real, host real ou rede; os falsos estão em `test/helpers/` (`fakeOpenAI`, `fakeForge`, `runner`). Os arquivos novos estão listados em cada seção.
**Pastas, dados e repositórios de teste** são temporários, com `CERIMONIAS_DATA_DIR` apontado para uma pasta vazia; nada toca os dados reais do app.

**O que os testes existentes vigiam e este plano não deve mudar:**

- `test/runner-golden.test.ts` e `test/fixtures/runner-golden/`: o texto de sistema de uma etapa de um repositório **sem `.coxia/`** não muda (a seção é vazia, §4); um
  `UPDATE_GOLDEN=1` aqui seria sinal de erro.
- `test/cycle-parity*.test.ts` e `test/golden/*.json`: o parity compara os prompts renderizados do ciclo legado; as chaves novas são acrescentadas e **nenhum texto existente é
  alterado**. Se o dump listar por família, a atualização é a do próprio teste e só acrescenta linhas.
- `test/cycle-prompts.test.ts:120-137` (chave de prompt sem uso falha): cada chave nova é usada por literal. `test/host-terms-leak.test.ts`: sem palavra de host nos textos novos.
  `test/gitlab-catalogs-unchanged.test.ts` e `test/main-catalogs.test.ts`/`test/i18n.test.ts`: as chaves novas nos dois catálogos, mesmos marcadores, e entradas novas nos fixtures.
- `test/config-resolve.test.ts:216` (o caso de hoje de `resolveDocs`) segue verde, pois o padrão é o de hoje; `test/agent-roles.test.ts` (seleção de documentação por papel de
  modelo) segue verde, pois `runOnce` não muda; `test/runner-release.test.ts` e `test/runs-subject.test.ts` seguem verdes (o assunto de release não muda).

**O que se confere à mão** (alimenta o plano de teste, `3_TEST_PLAN.md`):

- **M1. Uma execução real com o Claude, para o ponto de que o plano só tem os tipos do SDK.** Numa pasta de dados vazia (`CERIMONIAS_DATA_DIR`), com um repositório de teste
  que tem um `CLAUDE.md` com uma frase-marca ("sempre responda com a palavra-marca") e um `.claude/rules/x.md` com outra, e `~/.claude/CLAUDE.md` do usuário de teste com uma terceira:
  (a) **antes** da mudança (build de `main`): uma menção a um agente do time responde obedecendo à marca (confirma que o SDK carrega hoje); (b) **depois**: a mesma menção não
  obedece a nenhuma das três marcas, e uma execução de uma issue de teste não as cita. Também: o agente **não** carrega a memória automática do usuário de teste. Se (b) ainda
  mostrar uma marca, o plano volta ao §3 (`settings`, a variável de ambiente da CLI) antes de seguir.
- **M2. O motor aberto com um servidor local**, os mesmos três arquivos-marca: nenhum aparece no texto de sistema (o servidor falso do teste já prova; aqui com um modelo pequeno de
  verdade, para ver o orçamento reduzido pela janela cumprido).
- **M3. Criar a documentação de um repositório de teste, de ponta a ponta:** Configurações › Documentação num repositório sem `.coxia/` diz que não há e oferece criar; o clique
  pede a confirmação e aplica o modelo; o rascunho aparece no gate; recusar o gate com um motivo refaz; aprovar propõe o push depois (não antes); o pull request, num forge de
  teste, não termina com `Closes`, traz a lista do que a importação deixou de fora, e `.run/` não está nele; num espaço de trabalho de teste o push é recusado.
- **M4. A conferência:** mudar um arquivo citado por uma regra (num ramo mesclado por squash, por rebase e por merge, nos três) e ver a regra como não conferida em Configurações e
  chegar marcada ao agente; um pull request que atualiza a regra a devolve a conferida nos três modos de mesclar (é o que prova o `-S` do §5 e o carimbo do §8).
- **M5. Ações com a execução de documentação:** o push e o pull request aparecem sem "#0" ou outro rótulo sem sentido; a execução aparece na lista de execuções com o título certo.
- **M6. O telefone pareado:** a seção não aparece e `docs:*` é recusado pelo navegador.
- **M7. A pergunta do caso real:** numa execução, perguntar ao desenvolvedor onde está o pull request: ele responde com o que o runner faz (propõe o push e o pull request em Ações) e
  não com uma regra de sessão do Claude Code.

## Riscos

| Risco | Cobertura |
|---|---|
| **R1.** O SDK carrega o `CLAUDE.md` e o `.claude/` por padrão **só pelos tipos**: se não carregava, a mudança é inócua para o SDK (e o caso real foi no motor aberto); se `settingSources: []` não cobre a memória automática, ela passa | M1 mede os dois, antes e depois; `settings.autoMemoryEnabled: false` já vai; o resultado de M1 decide o ajuste |
| **R2.** `settingSources: []` tira também as skills e subagentes de `~/.claude` do alcance do SDK; quem dependia da ferramenta `Skill` perde isso para os agentes do time | Dito em `docs/llm-providers.md` e `docs/harness.md`; `skills/` de `.coxia/` as substituem como texto; a ferramenta continua existindo para as cerimônias |
| **R3.** O carimbo e a conferência por `-S` supõem que o valor do `checked-commit` aparece no histórico do arquivo; um repositório com histórico reescrito ou raso (clone `--depth`) pode não achar | O estado é `unverified` (não conferida), nunca "conferida"; M4 exercita squash, rebase e merge; a tela diz o motivo |
| **R4.** O `HEAD` do checkout da pessoa pode estar num ramo de trabalho, ou desatualizado em relação ao remoto, e a tela e as menções fora de execução leem esse checkout | O worktree de uma execução parte da ponta do remoto (`createWorktree`, `git.ts:70-72`) e o que o agente de uma etapa lê é o dele; a tela diz a data e o commit curto do `HEAD` lido e que, depois de mesclar o rascunho, o checkout precisa ser atualizado (o app não faz `pull`) |
| **R5.** `redact` (`errorlog-core.ts:29`) mascara e-mails e qualquer cadeia de 32 ou mais caracteres com letra e dígito: um hash de commit ou um identificador longo no corpo de uma regra vira `[redacted]` | Documentado; hashes só no cabeçalho, que é validado por outra via; a linha no fórum diz quando algo foi mascarado, e a pessoa vê o resultado no pull request |
| **R6.** A execução de documentação passa pelo publicador, que pressupõe uma issue em vários pontos; um ponto não coberto escreveria no iid 0 | As guardas do §6 (`deliver`, `prOf`, `prState`, `reporter`) e um teste que **falha se qualquer `provider.planWrite` com `iid: 0` for chamado** numa execução de documentação, no `test/runner-docs.test.ts` |
| **R7.** A pasta do ciclo em `.coxia/.run/` ignorada pelo git: um comando do app que `git add` com `-f`, ou uma mudança futura que a versione, a poria no pull request | `commitAll` usa `add -A` (respeita o ignore); o teste de `runner-docs` confere que o pull request não a contém |
| **R8.** O modelo `docs-flow` aplicado em silêncio mexe na configuração (um agente e um fluxo novos); uma configuração com id `docs-writer` do próprio usuário não é tocada (`mergeTemplateTeam` acrescenta por `id` e nunca altera, `apply.ts:58-71`), mas o fluxo apontaria para o agente dele | A confirmação do clique diz o que entra; um teste cobre o id já existente (a execução usa o agente que a pessoa tem, e a verificação do fluxo diz se ele não lista as etapas) |
| **R9.** O que o agente do rascunho "importa" pode ser classificado errado (um fato tratado como regra de sessão e deixado de fora, ou o contrário) | A descrição do pull request lista o que foi deixado de fora e o motivo de cada item, para a pessoa discordar; a revisão no pull request é o gate; as instruções trazem exemplos dos dois lados |
| **R10.** As notas do Claude Code mantidas **acima** do repositório (numa pasta que guarda vários repositórios) não são lidas pelo agente do rascunho, que só lê dentro do worktree (`readGuard`, `hooks.ts:55-67`) | Fora do escopo desta entrega: a importação cobre o `CLAUDE.md` e o `.claude/` do próprio repositório; dito na tela e em `docs/harness.md` |
| **R11.** O texto da seção cresce com o número de repositórios de uma conversa geral | O orçamento é por chamada, dividido entre os repositórios; o que não coube vira "não coube" |
| **R12.** Muito a verificar à mão, e a spec #8 do ciclo já mostrou que o que só se lê no código falha em uso | M1 a M7 são o plano de teste da etapa de validação e não se dispensam |

## O que fica fora deste plano, de propósito

- O catálogo de skills do Coxia (#85), a estrutura de plugin (#86) e qualquer formato para elas lerem `.coxia/skills/`.
- A configuração de MCP (`mcpConfigFiles`, `.mcp.json`) e o `AGENTS.md` ou o formato de outras ferramentas.
- Mudar as cerimônias dos cinco agentes de sistema, o que elas leem e o isolamento delas (D6).
- Escrever em `.claude/` ou em `CLAUDE.md` de qualquer repositório; documentação fora do repositório; globos em `evidence`.
- Um botão de "marcar como conferida" sem mudança aprovada (o gate 1 fechou: só a mudança aprovada que atualiza o cabeçalho).
- A `.coxia/` do próprio repositório do Coxia: é o primeiro uso real do botão pelo mantenedor (M3 pode usar este repositório), não parte desta entrega.
- A auditoria própria de um repositório público (`scripts/public-audit.mjs` de quem a tiver): a verificação do §8 é a do app; a do projeto continua sendo a do CI dele.

## Onde o plano encosta no que já existe (arquivos, funções)

- Config: `src/shared/config/types.ts` (`DocsConfig`, `CONFIG_SCHEMA_VERSION`), `schema.ts:354` (descrição), `defaults.ts:51`, `migrations.ts` (**sem passo novo**),
  `squads.ts:48-57` (chave de fluxo por tipo de execução), `validate.ts:96-126,181`, `src/main/config-resolve.ts:187-238`, `src/main/workspaceConfig.ts:63`.
- Agentes: `src/main/agents.ts` (`docsFor`, `extraDirs`, `sdkOptions`, `openDocs`, `runOpenEngine`, `AgentCall`, `runAgent`), `src/main/engine/contract.ts`
  (`EngineRequest.isolated`, `Confinement.writeRoot`), `src/main/engine/open/bridge.ts`, `loop.ts:226`, `context.ts`.
- Runner: `src/main/runner/executor.ts` (`runStage`: confinamento, `pr`, `reporter`, a seção, `finalize`), `prompt.ts` (`StageInput`, `systemText`, `stagePrompt`), `hooks.ts`,
  `service.ts` (`startDocs`, `openCalls`, a cadeia, os pedidos), `publish.ts` (`deliver`, `prOf`, `prState`, `pushStage`, `pullRequest`), `module.ts` (`docs:start`),
  `src/shared/runs/{types,schema,flow}.ts`, `src/shared/cycles/{apply,types}.ts`, `src/shared/cycles/templates/docsFlow.ts` (novo).
- Mentions: `src/main/mentions/answer.ts` (o `docs` da chamada), `place.ts` (`reposOnDisk`).
- Novo: `src/shared/harness/{format,evidence,select}.ts`, `src/main/harness/{scan,stale,deliver,finalize}.ts`.
- Texto: `src/shared/runs/comment.ts` (`rewriteLocal`), `src/main/errorlog-core.ts` (`redact`, só leitura), `src/main/webPolicy.ts`.
- Tela: `src/renderer/src/screens/{Settings,DocsSection}.tsx`, `src/renderer/src/wizard/steps/DocsStep.tsx` (lista extraída), `docsApi.ts`, `ui-settings.*.json`, `wizard.*.json`.

## Estado do que foi conferido nesta etapa

Todo o levantamento é **leitura do código desta árvore de trabalho** (`release/0.7.0`, 0.7.0-beta.4) e dos tipos do SDK instalado (0.3.287); nada foi executado e nada foi visto
funcionando no aplicativo. **Não verificado:** o comportamento padrão do SDK sobre `CLAUDE.md`, `.claude/` e a memória automática (R1, M1); o comportamento de
`git log -S` num histórico que passou por squash e por rebase (R3, M4); como a tela de Ações mostra uma proposta de issue 0 (R6, M5); se a divisão do orçamento por janela de
contexto é a certa para os modelos pequenos (M2); e se algum outro ponto do código lê `.claude/` além de `resolveDocs`, `defaultDocSources` e `discoverClaudeMd`
(`grep` por `\.claude` em `src/main` e `src/shared` deve ser refeito no começo do commit 4).

## Registro de decisões

| # | Decisão | Alternativa rejeitada, e por quê |
|---|---|---|
| 1 | O formato é Markdown com um cabeçalho num subconjunto de YAML analisado por um código próprio e puro, em `src/shared/harness/` | Uma biblioteca de YAML: um pacote a mais para dois tipos de lista e uma data; e o analisador do motor aberto (`context.ts:26`) é de uma linha só e mora em `src/main` |
| 2 | `stages` aceita id **ou tipo** de etapa; `roles` são ids de agente, e `roles/<id>.md` vale pelo nome | Só ids de etapa: o id é renomeável pela pessoa, e a regra "só do que revisa" se quebraria; papéis por texto livre: o app não sabe o que "revisor" é num time que a pessoa montou |
| 3 | O app escreve o `checked-commit` e o `checked-date` (carimbo, em dois commits); o agente nunca | O agente escrever o hash: ele não conhece o commit que ainda vai existir; carimbar com o `HEAD` do começo da etapa: a própria mudança de código da etapa já tornaria a regra velha |
| 4 | A referência de um commit sumido é o commit que introduziu o valor no cabeçalho (`git log -S`); sem achar, `unverified` | Comparar por data: um squash tem data posterior ao carimbo e deixaria toda regra atualizada num pull request como velha |
| 5 | Sem migração de configuração; `autoDetect` muda de significado | `v13ToV14` sem mudar o documento: só faria um app anterior recusar o arquivo |
| 6 | `resolveDocs(…, { claude })` com o padrão de hoje; os agentes do time usam `claude: false`; as cerimônias seguem como estão | Isolar as cerimônias também: contra a especificação ("o que elas leem hoje continua como está") e quebra o MCP de issues que só elas usam (D6) |
| 7 | Um texto de sistema montado pelo app, igual nos dois motores | Deixar cada motor descobrir os arquivos: o orçamento, a marca e a seleção não existiriam no SDK, e o app não saberia o que o modelo viu |
| 8 | Orçamento de 24.000 caracteres, reduzido pela janela de contexto declarada, piso de 3.000 | 60.000 como o `CLAUDE.md` do motor aberto: um modelo pequeno não o comporta; um número fixo menor: desperdiça o contexto de um modelo grande |
| 9 | O fluxo tem duas etapas que escrevem (`docs-draft` e `docs-publish`) com o gate no meio | Uma etapa só: `pushStagesOf` proporia o push antes do gate; mudar `pushStagesOf` para "depois do gate": altera o fluxo de issue |
| 10 | `Run.docs` como campo novo, `RunSubject` continua o da release | Uma união em `RunSubject`: cerca de 50 pontos que leem `subject` como release |
| 11 | O modelo `docs-flow` é aplicado no primeiro clique, com confirmação | A pessoa aplicar o modelo em outra tela antes: o botão existiria sem poder ser usado |
| 12 | A pasta do ciclo da execução em `.coxia/.run/`, ignorada por um `.coxia/.gitignore` | Versionar a pasta do ciclo no pull request: ruído (registro, memória) em todo repositório; uma pasta fora do worktree: `readFolder`, `commitAll` e `editMemory` pressupõem estar dentro |
| 13 | Os problemas de `checkText` não se aplicam à documentação; só a reescrita | Passar a documentação por `checkText` inteiro: proíbe "Claude Code" e a primeira pessoa, que uma documentação cita legitimamente |
| 14 | A verificação reescreve e conta; nunca bloqueia | Recusar o arquivo com credencial: a pessoa não teria como aprovar, e a revisão do pull request já é o gate |
| 15 | A regra deixada para trás é achado da revisão, não bloqueio por padrão | Bloquear o pull request: uma regra que o ramo não tocou mas cuja evidência mudou nem sempre ficou falsa |

## Decisões para o gate 2

Cada ponto é uma escolha que o mantenedor confirma ou muda; a coluna "recomendação" é o que este plano escreveu.

| # | Ponto | Recomendação | Alternativa |
|---|---|---|---|
| D1 | O orçamento por chamada (§4) | **24.000 caracteres** (cerca de 6 mil tokens), `min(24.000, 3 × janela × 0,15)` quando o provedor declara a janela, piso de 3.000; a visão geral até 40% | 12.000 fixos (mais barato, mas corta regras de um projeto grande); 40.000 (cabe quase tudo, mas aproxima-se dos 10 mil tokens que o `docs/llm-providers.md` já diz que um modelo pequeno não dá conta) |
| D2 | Os nomes dos campos do cabeçalho (§1) | `checked-commit`, `checked-date`, `evidence`, `stages`, `roles`, `summary` | `commit` e `date`: mais curtos, mas ambíguos num arquivo que também cita commits de outra forma |
| D3 | O nome do ramo e do worktree da execução de documentação (§6) | `cycle/docs-<repo>-<AAAAMMDD>` (a convenção `cycle/…` das outras execuções, com a data para uma segunda tentativa) | `docs/coxia` ou `cycle/docs-<repo>` fixo: curto, mas um segundo rascunho depois de um merge esbarra em `branch-exists` |
| D4 | Migração de configuração (§2) | **Nenhuma**: `CONFIG_SCHEMA_VERSION` fica em 13; só o significado de `autoDetect` muda | Subir para 14 com um passo que não altera o documento: sinaliza a mudança, mas um app 0.6 passa a recusar o arquivo sem ganho |
| D5 | Quem rascunha (§6) | Um agente próprio, `docs-writer` (permissão `worktree`, sem shell nem rastreador, autônomo), criado pelo modelo e editável em Configurações › Time | Reusar o `developer`: sem agente novo, mas o desenvolvedor tem comandos e instruções de código e o time precisaria ter um para o botão funcionar |
| D6 | As cerimônias (§2 e §3) | Seguem como estão (leem o `.claude/` como hoje; `settingSources` não é definido), como a especificação deixa fora do escopo | Isolá-las também (uma linha, `runOnce` com `isolated`): resolve o mesmo problema nelas, mas muda o que a especificação disse que não muda, e tira delas o servidor MCP de issues; fica para uma issue própria |
| D7 | A pasta do ciclo da execução de documentação (§6) | `.coxia/.run/`, ignorada por um `.coxia/.gitignore` de uma linha que vai no pull request | Versioná-la no pull request: a pessoa vê tudo o que o agente escreveu, ao custo do registro e da memória em todo repositório |
| D8 | Como a conferência trata um commit que o squash apagou (§5) | O commit que introduziu o valor no cabeçalho (`git log -S`); sem achar, não conferida | Só o hash do cabeçalho: mais simples, mas todo pull request mesclado por squash faria suas regras nascerem "não conferidas" |
| D9 | O assunto da execução de documentação (§6) | Um campo novo `Run.docs`; `RunSubject` continua o da release | Generalizar `RunSubject` numa união: mais "certo", com cerca de 50 pontos a tocar no fluxo de release que funciona |
| D10 | O que a verificação de texto faz com o que acha (§8) | Reescreve e diz o que mudou; nunca recusa; só o corpo, nunca o cabeçalho | Recusar o arquivo com credencial até a pessoa corrigir: mais rígido, sem saída para quem só quer revisar |
| D11 | Aplicar o modelo `docs-flow` (§6) | No primeiro clique em Criar, depois de uma confirmação que diz o que entra | A pessoa aplica o modelo antes, na tela de ciclos: menos mágica, mais um passo antes de um botão que parece pronto |
| D12 | A regra esquecida na revisão (§7) | Um achado não bloqueante por padrão, que o revisor pode elevar | Sempre bloqueante: força a atualização, mas barra pull requests cuja regra não ficou falsa |
