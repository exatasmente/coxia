# Criar e ajustar um agente com a ajuda da IA — plano técnico

Este plano decide o *como* do que a especificação fixou: um assistente que escreve perguntas, refina um
rascunho de agente, deixa a pessoa testá-lo numa conversa e entrega o resultado ao editor. Ele não reabre o
comportamento: as 18 regras, os critérios de aceite e as três decisões do refino são tratados como dados.
Tudo abaixo vem da leitura do código desta árvore (`release/0.8.0`, 0.8.0-beta.7); nada foi executado.

**Revisado no gate 2 (2026-10-07).** O mantenedor respondeu a quatro perguntas (duas das sete do primeiro texto, a 2 e a 7, e duas
novas: a release e o que Concluir faz) e três das respostas mudaram o plano em relação a ele: (a) o trabalho entraria **na 0.8.0, em beta**, com o
esquema 19 ali (D1, risco 3; a 0.8.0 foi lançada durante a implementação, ver 2.1); (b) o assistente **pode propor `permission: worktree`**, com motivo e botão de voltar
(2.4, D7); (c) **Concluir mantém o rascunho no time até a pessoa salvar no editor**, e cancelar o editor volta ao
assistente (2.5, D4, 2.9); (d) o uso do assistente **entra** na tela de custo e na retenção (commit 11, já não
opcional). As outras cinco perguntas (1, 3, 4, 5 e 6) não foram feitas: ficou a recomendação do plano, que o
mantenedor pode trocar. Tudo isso está na seção 10.

## Respostas às cinco perguntas que a spec deixou para o plano

| Pergunta da spec | Resposta | Decisão |
|---|---|---|
| Como marcar o rascunho e a versão do esquema | Campo opcional `draft` no `AgentDef`, com **subida do esquema 18 → 19** e um passo `v18ToV19` que só muda a versão | D1 |
| Como apagar uma thread inteira; e a órfã de `removeAgent` | Capacidade nova do armazém (`deleteThread`) e dos anexos (`dropThread`), usada só para o rascunho. A órfã que `removeAgent` deixa **fica de fora** (seção 10, decisão 5); o rascunho nunca herda uma órfã porque escolhe um id que nenhuma thread usa | D8, D9 |
| Como a chamada sai sem ferramenta nos dois engines | Hoje **não** sai: falta uma chamada que desligue também os `allowedTools`, os MCP do usuário, a documentação e o diretório de trabalho. Entra `askBare` e um interruptor `bare` no pedido ao engine | D5 |
| Formato do que o modelo devolve e o leitor leniente | `src/shared/agentAssist.ts`, no padrão de `readProposedWrites`; os valores propostos passam por um único `clampSettings` | D6, D7 |
| O canal que cria o rascunho e o que o `Thread` precisa | Canais `agentAssist:*` no main (o main é quem monta o rascunho inerte); o `Thread` entra sem mudar de props | D10, D13 |

## 1. O que será construído

| Funcionalidade | Onde cai |
|---|---|
| Marca de rascunho no agente, esquema 19 | `src/shared/config/types.ts`, `schema.ts`, `migrations.ts`, `team.ts` (`newAgent`, `isDraft`, `workingTeam`), `docs/configuration.md` |
| Um rascunho não trabalha etapa, não é "pergunta a", não é chamado | `team.ts` (`stageAgent`), `squads.ts` (`effectiveTeam`, `turnTarget`), `runs/flowCheck.ts`, `runs/squadCheck.ts`, `workspaceConfig.ts` (`flowInputs`), `forum.ts`, `mentions/answer.ts`, `mentions/ceremony.ts`, `runner/executor.ts`, `runner/service.ts`, `cycles/apply.ts` (tabela da seção 2.2) |
| Chamada ao modelo sem ferramenta, sem documentação e sem repositório | `src/main/engine/contract.ts` (`bare`), `src/main/agents.ts` (`askBare`) |
| Tipos, limites e leitor leniente do que o modelo devolve | `src/shared/agentAssist.ts` (novo) |
| Prompts do assistente (pt-BR e en) | `src/shared/i18n/en.json`, `pt-BR.json` (`prompt.sdd.assist.*`), montagem em `src/main/agentAssist-core.ts` (novo) |
| Canais do assistente, rascunho de teste, descarte | `src/main/agentAssist.ts` (novo), `src/main/modules.ts`, `src/main/webPolicy.ts` |
| Apagar uma conversa e seus anexos | `src/main/forum-core.ts`, `src/main/attachments.ts`, `src/main/forum-channels.ts` |
| Id do agente derivado no main | `slugOf` e `uniqueId` passam de `agentEdit.ts` para `src/shared/config/team.ts` (o editor reexporta) |
| Estado do assistente (funções puras) | `src/renderer/src/screens/team/assistEdit.ts` (novo), ao lado de `agentEdit.ts` |
| Tela do assistente no painel lateral | `src/renderer/src/screens/team/AgentAssist.tsx`, `AssistQuestion.tsx`, `AssistReview.tsx` (novos), `labels.ts`, `team.css`, `ui-team.*.json` |
| **Criar com IA** e **Ajustar com IA** | `TeamSection.tsx` (cabeçalho da lista e `AgentPanel`) |
| Controle de etapas no editor, só quando ele veio do assistente | `TeamSection.tsx` (`AgentPanel`) |
| Cartão **Rascunho** com **Descartar** | `TeamSection.tsx` (lista do time) |
| O assistente fora das listas que só valem para agentes de verdade | `SquadsSection.tsx`, `FlowEditor.tsx`, `ForumScreen.tsx`, `Thread.tsx` (completar `@`) |
| Uso das chamadas na tela de custo (seção 10, decisão 7) | `src/main/custo-core.ts`, `retention-core.ts`, `src/shared/custo.ts` |
| CHANGELOG e documentação | `CHANGELOG.md` (`[Unreleased]`), `docs/runner.md`, `docs/configuration.md` |

## 2. O que o plano decide, e com quê

### 2.1 A marca do rascunho e a versão do esquema (D1)

**Decisão.** `AgentDef` ganha `draft?: boolean` (`src/shared/config/types.ts:520`, junto de `squad?`, `:563`),
`agentDef` ganha `draft: boolean(...)` (`src/shared/config/schema.ts:217`), `newAgent` o carrega só quando
`true` (`src/shared/config/team.ts:39`; é por `newAgent` que `withConfigDefaults` passa todo agente,
`src/shared/config/defaults.ts:127`, então sem isso o campo se perde ao ler). `CONFIG_SCHEMA_VERSION` sobe de 18
para 19 (`types.ts:5`) e entra `v18ToV19` em `STEPS` (`migrations.ts:323`), sem mexer no documento: só a versão e
uma nota, como `v12ToV13` fez para o campo `tools` do agente (`migrations.ts:274-278`).

**Por que subir a versão, e não só um campo opcional.** A regra de `config-schema.md` (item 3) pede um passo
quando o arquivo guardado "não pega sozinho" o formato novo; aqui o que decide é o outro sentido, o de um app
anterior ler um arquivo com `draft`:

- `object()` fecha o agente com `additionalProperties: false` (`schema.ts:26-28`) e o validador responde a um
  campo desconhecido com `is not a known field` (`src/shared/config/jsonSchema.ts:80`).
- Um arquivo v18 com `draft` é "atual" para um app 0.8.0-beta.7: `bootstrapConfigs` o pula
  (`src/main/config-bootstrap.ts:73`, `:95`), `load()` falha na validação e cai em `migrateConfig`
  (`src/main/workspaceConfig.ts:34-36`), que não tem passo a rodar e chama `repair` com o neutro
  (`migrations.ts:338-350`, `:378`). `repair` sobe o caminho `agents.team[i].draft` até achar algo que a base
  neutra tem (`agents.team`) e, no caso comum (o agente de fora dos cinco de sistema), **repõe o time inteiro
  pelos cinco agentes de sistema**. Isso é leitura do código; o próximo `config:save` do app antigo gravaria o
  resultado em disco.
- Com a subida, o mesmo app antigo recusa o arquivo ("escrito por um app mais novo",
  `migrations.ts:368`, `validate.ts:305-306`), que é o contrato da regra 4.

**Colisão de versão.** Conferido agora com `git for-each-ref` e `git diff`: nenhuma branch local ou remota está
em 19 nem tem `v18ToV19`; as que estão em 18 são a `release/0.8.0`, esta, as já mescladas e duas de ciclos
que só têm documentos (nenhuma toca `src/shared/config`; o plano de uma delas diz "sem config nova"); a branch
da única PR aberta também não toca. **Refazer a conferência antes de abrir a PR** (o mantenedor já teve colisão).
O mantenedor decidiu que o trabalho entraria **na 0.8.0, em beta**. A 0.8.0 estável foi lançada em 2026-10-08, durante a
implementação, e a `release/0.8.0` deixou de existir: a branch recebeu a `main` (merge, ainda no esquema 18) e a PR tem
como base a `main`, para a versão menor seguinte. Quem salvar com a build nova não volta à anterior (o app anterior
recusa o arquivo, em vez de perder o time).

**Testes que mudam por causa da subida.** Doze arquivos fixam o número 18 (em `config-migrations` e `config-schema`, o 19 é o "esquema mais novo", que passa a ser 20):
`config-migrations`, `config-schema`, `agent-team`, `agent-permissions-config`, `wizard-shared`,
`ceremony-commands`, `config-transfer`, `runner-config`, `card-scope`, `config-getters`, `comment-config`,
`flow-model`. Na troca, onde o teste quer dizer "a versão atual", usar `CONFIG_SCHEMA_VERSION`, para que a
próxima subida não toque em vinte linhas.

### 2.2 Onde o rascunho é filtrado: o levantamento completo (D2)

Um rascunho nasce com `stages: []`, sem squad, `autonomous: false`, `turnsTo: null`; isso o torna inerte *por
construção*, mas a pessoa, o editor de fluxo ou um arquivo escrito à mão podem dar etapas a ele ou apontar
para ele. Por isso o filtro fica nos pontos de **decisão**, em funções puras compartilhadas, e não em cada
leitor. O ponto de partida são `isDraft(a)` e `workingTeam(team)` em `team.ts` (o time sem rascunhos).

Levantamento por `grep` de `agents.team` (e dos `team` de entrada) em `src/`; só o que **decide quem** trabalha,
é chamado ou é oferecido filtra:

| Lugar | O que faz com o time | Filtra? |
|---|---|---|
| `shared/config/team.ts:71` `stageAgent` | escolhe o agente de uma etapa (o nomeado, senão o primeiro que a lista) | **sim**, nos dois `find` |
| `shared/config/squads.ts:42` `effectiveTeam` | o time que o runner lê (`scopedTeam` `:45`, `squadView` `:87`, `flowOfRun` `shared/runs/flow.ts:91`) | **sim**: sem rascunhos |
| `shared/config/squads.ts:112` `turnTarget` | a quem a pergunta de um agente vai primeiro | **sim**: um rascunho como alvo não conta |
| `shared/runs/flowCheck.ts:167` `checkFlow` | erros do fluxo e do time (`agent-unknown`, `turns-unknown`, `work-no-agent`) | **sim**, na entrada: `agentId` ou `turnsTo` que aponte para um rascunho vira `agent-unknown`/`turns-unknown` |
| `shared/runs/squadCheck.ts:184` `checkSquads` | membros, liaison e correntes dos squads | **sim**, na entrada |
| `shared/config/validate.ts:54` `teamRules` | regras por agente (etapa existe, `allowlist` exige `worktree`, modelo) | não: valem para o rascunho como para qualquer um; `:88`, `:99`, `:117` passam o time às checagens acima |
| `shared/runs/flow.ts:34` `flowOf` (e o autostart do runner, que lê `FlowStage.autonomous`) | agente e autonomia de cada etapa, via `stageAgent` | não precisa: herda o filtro de `stageAgent` |
| `shared/runs/flow.ts:120` `pushStagesOf` | quem escreve, só entre agentes de etapas | não precisa |
| `main/workspaceConfig.ts:67` `flowInputs` | decide se uma troca é "do fluxo" e portanto sem a tolerância de `:79` | **sim**: salvar ou apagar um rascunho não pode contar como mexer no fluxo, ou quem tem um problema antigo no fluxo não consegue testar |
| `main/forum.ts:99` `forum:list` | cria a conversa direta de cada agente | **sim**: não cria nem lista a do rascunho (o assistente a cria, D12) |
| `main/forum.ts:110`, `:151` | ids para `parseMentions` / `unknownMentions` | **sim** (helper `mentionableIds`, abaixo) |
| `main/mentions/ceremony.ts:47` | ids para as menções de uma cerimônia | **sim** (`mentionableIds`) |
| `main/runner/service.ts:1229` | uma menção no texto não responde a pergunta da execução | **sim** (`mentionableIds`) |
| `main/mentions/answer.ts:208` | quem `CallAgent` alcança numa conversa | **sim**: `workingTeam` |
| `main/runner/executor.ts:661`, `:675` | idem, numa etapa | **sim** |
| `main/mentions/answer.ts:136`, `module.ts:75` | quem responde (o dono da conversa direta) | **não**: o dono da conversa de um rascunho **é** o rascunho |
| `main/runner/executor.ts:133` `pickAgent` | o agente que o fluxo nomeou | não precisa: o fluxo já vem filtrado |
| `main/runner/executor.ts:390` | destinatários de `SendMessage` a "todos" | não precisa: só quem trabalha a execução tem caixa |
| `main/runner/service.ts:767` | agentes `sandbox` com etapas, para checar a sandbox antes de iniciar | **sim** (`workingTeam`, uma linha), para um arquivo à mão não travar o início |
| `main/runner/service.ts:775`, `:858`, `:952`, `:1176`, `:778` | `flowErrors` / `squadErrors` antes de iniciar | não precisa: herdam `checkFlow` e `checkSquads` |
| `main/runner/service.ts:1208` `setAutonomous` | liga a autonomia de um agente | **sim**: um rascunho é "agente desconhecido" (e o cartão esconde o interruptor) |
| `main/runner/service.ts:1020`, `:1160`, `:1358`, `:1448`, `:1470`, `:1478`, `:1547`, `runner/module.ts:204`, `runner/publish.ts:300`, `:1267` | busca por id de quem já está num estado da execução (pergunta, liaison, autoria) | não precisa |
| `main/suggestionsModule.ts:204` `agentIdFor` | id livre para o agente sugerido | **não deve**: o id de um rascunho continua tomado |
| `main/configScope.ts:66-78` | o que o celular pode subir | não muda (D11) |
| `shared/cycles/apply.ts:99` `templateFromConfig` | agentes que vão para um modelo de ciclo exportado | **sim**: sem rascunhos |
| `shared/config/transfer.ts:152` | poderes listados na exportação da config | não: a exportação é a config inteira, rascunho incluso |
| `renderer/.../agentEdit.ts:90` `idTaken` | id já usado | **não deve**: o id de um rascunho continua tomado |
| `renderer/.../agentEdit.ts:169` `turnsToChoices` | opções de "pergunta a" | **sim** |
| `renderer/.../agentEdit.ts:125`, `:136`, `:161` | `teamIssues` / `stagesLosingAgent` | herdam os filtros compartilhados |
| `renderer/.../SquadsSection.tsx:217` | quem pode ser membro | **sim** |
| `renderer/.../FlowEditor.tsx:78` | quem pode trabalhar uma etapa | **sim**; `:317` (`takenIds`) não |
| `renderer/.../Thread.tsx:288` | completar `@agente` | **sim**, exceto o dono daquela conversa |
| `renderer/.../ForumScreen.tsx:63`, `:109` | atalhos de conversa direta | **sim** |
| `renderer/.../TeamSection.tsx:83` | a lista do time | mostra, com a marca (D12) |
| `renderer/src/{wizard/steps/CycleStep,ceremony,JobsDock}`, `screens/cycle/{RunActions,ReviewRounds,RunsScreen,StageTimeline,RunScreen}`, `team/text.ts` | nomes por id | não precisa |

`mentionableIds(team, thread)` fica em `shared/forum.ts` (ao lado de `parseMentions`, `:186`): os ids dos
agentes de verdade mais, na conversa direta de um rascunho, o id dele (para `@` do dono não virar "agente
desconhecido" na própria conversa).

### 2.3 A chamada sem ferramenta, nos dois engines (D5)

**O que existe.** `askAgent` é `run` (`agents.ts:765`), que chama `runOnce` (`:743-762`). Esse caminho é o das
cerimônias: monta `allowedTools` com `allowedFor` (leitura de arquivos, `Skill`, `Agent`, as regras de leitura
do host, os MCP do rastreador), liga `ask` (o `Bash` inteiro, `sdkOptions` `:418`, `:426`), usa `rc().projectsRoot`
como diretório de trabalho e **não** é `isolated`, então o SDK ainda carrega os `CLAUDE.md`, as configurações e
os servidores MCP do usuário. `extra` entra por último em `sdkOptions` (`:443`), por isso quem passa
`{ tools: [] }` (a correção de diagrama, `diagramFix.ts:15-21`; o efeito, `efeitos.ts:154`) desliga as
ferramentas nativas, mas deixa de pé o resto. Só a retomada de uma chamada sem turnos (`agents.ts:796`) e o
teste de saldo (`:718-740`: `allowedTools: []`, `extraDirs: []`, `extra: { maxTurns: 1, tools: [] }`) chegam
perto, e o teste de saldo só pergunta uma palavra e também deixa de pé o diretório, os MCP do usuário e a
documentação. A chamada de teste do assistente de configuração (`wizard.ts:173`) é a única que zera `tools`,
`allowedTools` e `settingSources` juntas.

**O que cada engine faz com `tools: []`** (verificado na leitura):

- **claude-sdk.** Na documentação de tipos instalada, `tools: []` "desativa todas as ferramentas nativas"
  (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, opção `tools`). `wantsVcsTool` devolve `false` quando
  `extra.tools` é vazio (`agents.ts:477`), então nem o servidor MCP in-process do `VcsRead` sobe; os outros
  servidores in-process só sobem com campos do pedido que a chamada não tem (`runClaudeSdk`, `:595-609`).
  Sobram dois furos: `allowedTools` continua levando nomes `mcp__<servidor>__…` de `allowedFor`, e o SDK, sem
  `settingSources: []` nem `strictMcpConfig`, ainda lê o `.mcp.json` e a configuração do usuário.
- **open.** `noTools: Array.isArray(o.tools) && o.tools.length === 0` (`engine/open/bridge.ts:98`) e
  `buildTools` devolve `[]` antes de qualquer outra coisa (`engine/open/loop.ts:145`), inclusive para as
  `extraTools`. A resposta estruturada ainda pode ir por uma função `final_answer` (`loop.ts:123`, `:320`); ela é o
  *transporte* da resposta, não uma capacidade do agente. O que **não** some é a documentação: o `CLAUDE.md`
  e o índice das pastas de documentação entram no texto de sistema (`loop.ts:248-251`, `openDocs`,
  `agents.ts:449-454`).

**Decisão.** Um interruptor só, `bare?: boolean` em `EngineRequest` (`engine/contract.ts:89`, ao lado de
`isolated`, `:126`), e uma função `askBare` em `agents.ts`, exportada junto de `askAgent`:

```
askBare<T>(role, prompt, schema, { system, maxTurns = 2 }) → Run<T>
```

`askBare` faz o que `run` faz em volta (`beginActivity`, estados `started`/`finished`/`failed`) e monta o
pedido sem passar por `runOnce`: `allowedTools: []`, `extraDirs: []`, `shell` vazio, `tracker: 'none'`,
`isolated: true`, `bare: true`, `ask` ausente, `cwd` = a pasta de dados do workspace (`ATAS`, como o teste do
assistente de configuração: um lugar que não é repositório e não tem `CLAUDE.md`, em vez de `projectsRoot`),
`system` = o texto do próprio assistente (não o do papel `deep`, que traz persona e instruções de cerimônia).
O modelo e o provedor são os do papel `deep` (`engineFor('deep')`, `registry.ts:19`), com o gancho de teste
`COXIA_ENGINE=open` respeitado como em `runOnce`. Com `bare`:

1. `sdkOptions` junta `tools: []`, `allowedTools: []` e `strictMcpConfig: true` (e `isolated` já dá
   `settingSources: []` e memória automática desligada, `:440`).
2. `wantsVcsTool` devolve `false` (`:476`).
3. `runOpenEngine` passa listas de documentação **todas vazias e definidas** (um `claudeMd: []` definido evita
   a descoberta de `CLAUDE.md` do `cwd`, `loop.ts:248`), no caminho normal e no do gancho (`:498-499`).

O modelo recebe, então, o texto de sistema do assistente, o pedido, as respostas, o rascunho e o contexto que o
main monta; nada mais. O texto de sistema continua sendo o preset `claude_code` com o texto do assistente
anexado (`agents.ts:425`), como em toda chamada; trocá-lo por um texto só nosso seria uma otimização que não
foi medida nem verificada (risco 13). Erros: `ProviderBudgetError` e os demais sobem como em `run`; quem traduz para a tela é
o main do assistente (D10). Sem retomada por `error_max_turns` (um `MaxTurnsError` vira "tente de novo").

**Uso e atividade.** `askBare` abre a atividade do papel `deep` (`beginActivity`, `agents.ts:772`), com o id do
job se a chamada vier de um (o renderer não registra um job aqui: a tela mostra só o *spinner*). Ambos os
engines chamam `noteSession` (`agents.ts:523`, `:660`), que grava a sessão em `sessions.jsonl`, mas a tela de
custo só conta a sessão cujo primeiro prompt casa com um abridor de `FIRST_PROMPTS` (`custo-core.ts:10-22`, a
classificação é por `openersOf`, `shared/cycles/prompts.ts`), e a retenção só lista as de `APP_PROMPTS`
(`retention-core.ts:12`, `:33`). Os prompts de `suggest.main` e das menções não estão em nenhuma das duas
tabelas hoje; os do assistente também não estariam. **Decidido (commit 11, seção 10, decisão 7):** um tipo
`assist` na tela de custo e na retenção. Sem ele, o gasto do assistente não aparece em Custo, e a transcrição
do pedido da pessoa não é varrida pela retenção.

### 2.4 O que o modelo devolve e o leitor leniente (D6, D7)

Tudo em `src/shared/agentAssist.ts` (puro, sem Electron), como `readProposedWrites` (`mentions/call.ts:73`):
lê `unknown`, descarta o inválido sem perder o válido, nunca lança.

**Duas chamadas, dois formatos.**

```
round  → { draft: { name, job, instructions },
           questions: [{ text, kind: 'open'|'single'|'multi', options: string[], why }],
           enough: boolean }

review → { draft: { name, job, instructions },
           permission: { value: 'read'|'worktree',     reason },
           tracker: { value: 'none'|'read',            reason },
           shell:   { value: 'none'|'sandbox'|'allowlist', reason },
           tools:   { files, skills, vcsCli, subagents: boolean|null, reason },
           stages:  { ids: string[],                    reason },
           squad:   { id: string|null,                  reason },
           turnsTo: { id: string|null,                  reason } }
```

O esquema JSON leva só `type`, `properties`, `required`, `additionalProperties: false` e `enum` (de
`kind`, e das listas que existem: o `value` de `shell` só com o que a máquina oferece, `ids`/`id` só entre as
etapas, os squads e os agentes do contexto). **Sem `minItems`/`maxItems`/`minLength`** no esquema: alguns
servidores do motor aberto recusam esses termos no modo estrito (não verificado); os limites ficam no leitor.

**Leitor das perguntas (`readQuestions`).**

- Uma pergunta sem texto, de `kind` desconhecido, ou de escolha com menos de 2 opções úteis é **descartada**
  (regra 5 da spec); as opções são aparadas (120 caracteres, repetidas e vazias saem, no máximo 6); `why` até 200.
- No máximo **6** perguntas passam. O mínimo de 3 é pedido no prompt, **não imposto**: com 1 ou 2 válidas, a
  pessoa vê as válidas; com nenhuma, a tela diz que nada veio e oferece "Tentar de novo" e "Seguir com o que
  existe" (regra 5).
- O id é do app (`q1…q6`, pela posição), não do modelo: respostas e perguntas se casam sem confiar em ids que o
  modelo pode repetir. A opção **Outro** não vem do modelo: a tela a acrescenta a toda pergunta de escolha.

**Leitor do rascunho (`readAssistDraft`).** `name` até **80** (o esquema, `schema.ts:221`; o editor deixa 100,
`TeamSection.tsx:179`, e o 81–100 que a pessoa digitar é recusado no salvar, pelo `maxLength` do esquema,
`jsonSchema.ts:61`), `job` até 1000 (`:196`), `instructions` até 4000 (`:199`); texto passa por `redact`
(`errorlog-core`) antes de chegar à tela. `name` vazio mantém o anterior; sem nenhum, a revisão avisa e o
editor é quem recusa (regra 15). O id do agente sai do nome (D14). `enough: true`, ou nenhuma pergunta válida
com `enough`, esconde **Próxima rodada** e destaca **Terminar**.

**Os valores propostos nunca vêm soltos do modelo: `clampSettings(raw, offers, base)`.**

| Campo | Aceito | Recusado (fica o `base`) |
|---|---|---|
| `permission` | `read`, `worktree` (decisão do mantenedor no gate 2) | qualquer outro. É o **primeiro** campo a ser limpo: o `shell` abaixo olha o valor já limpo |
| `tracker` | `none`, `read` | qualquer outro |
| `shell` | `none`; `sandbox` só se `offers.sandbox`; `allowlist` só se o `permission` **já limpo** for `worktree` | `host` **nunca** (só se mantém quando o `base` já era `host` e o modelo não o mexeu); qualquer outro |
| `tools` | os booleanos `files`, `skills`, `vcsCli`, `subagents`, sobre o `base.tools` ou, sem ele, sobre `agents.tools` do espaço; igual ao do espaço vira `null` | `trackerMcp` e `trackerMcpServer` **nunca** do modelo (copiados do `base`/espaço) |
| `stages` | ids de `offers.stages` (etapas de trabalho do fluxo do espaço e, com squad, as do fluxo dele), sem repetir, até 60 | id que não existe |
| `squad` | um id de `offers.squads` ou `null` | id que não existe |
| `turnsTo` | um agente de `offers.turnsTo` (do time, **não** rascunho, **não** o próprio) ou `null` | id que não existe, o próprio, um rascunho |
| `autonomous`, `allowedCommands`, `model`, `id` | **não existem** no esquema nem no leitor | — |

Um valor **acima do mínimo sem motivo é descartado** (volta ao mínimo): nenhum privilégio sem a explicação que a
revisão mostra (regra 10). O motivo é aparado em 300 caracteres. O mínimo é o de `blankAgent()`
(`agentEdit.ts:61`): `permission: read`, `tracker: none`, `shell: none`, `tools: null`, `stages: []`, `squad: null`,
`turnsTo: null`. Ao ajustar, o `base` é o agente como está no formulário, e "acima do mínimo" quer dizer "diferente
do que está".

**`permission: worktree` e o teste.** Uma conversa nunca recebe `Edit` nem `Write`, qualquer que seja a permissão do
agente (`agents.ts:1136-1140`), então o teste **não mostra** o que o agente faz com os arquivos de uma execução. A
revisão diz isso ao lado do valor (chave `ui.team.assist.worktreeNote`), para a pessoa não achar que o teste o
validou. Um `permission: worktree` junto de `shell: allowlist` é a combinação que o editor já aceita; `allowlist` só
sobrevive no `clampSettings` com o `worktree` já aceito.

**Limites de entrada** (o main os impõe de novo, o renderer só os respeita): pedido 2000 caracteres; resposta
aberta 600; no máximo 4 rodadas e 6 respostas por rodada; rascunho nos limites do editor; conversa de teste
as últimas 40 mensagens, 12 000 caracteres no total; o contexto do espaço com listas capadas (60 etapas, 20
squads, 40 agentes, texto aparado). A ordem de grandeza é de dezenas de milhares de caracteres por rodada;
**não foi medida** (risco 1).

### 2.5 O estado do assistente e o modo Ajustar (D3, D4)

O estado vive no renderer (regra 3): `assistEdit.ts` guarda `mode`, `base`, `step`
(`request → questions → review → test`), `request`, as rodadas respondidas, a rodada aberta, o rascunho, as
configurações com os motivos, `enough`, o id do rascunho de teste. Cada chamada leva **o pedido, as rodadas, o
rascunho de agora** e, depois de um teste, o id do rascunho (o main lê a conversa; o renderer não a reenvia).

Funções puras (testáveis sem tela), ao lado de `agentEdit.ts`: `startAssist`, `answerOf` /
`withAnswer` (uma pergunta sem resposta é "pulada" e o prompt diz isso, regra 4), `roundsLeft` /
`canAskAnotherRound` (a quinta rodada não existe, regra 5, também recusada no main; a rodada que nasce de um
teste conta como qualquer outra, seção 10, decisão 1), `toInput` (corta os
tamanhos), `reviewRows` (só o que passa do mínimo, com o motivo), `resetField`, `diffAgent` (antes → depois, ao
ajustar), `toAgentDraft` (o `AgentDraft` que o editor abre).

**A cópia de teste ao ajustar.** `agentAssist:saveDraft` recebe o id do original (`from`). O main busca o
original **na config guardada**, nunca no corpo da chamada, e cria a cópia com: nome, papel e instruções
propostos; `permission`, `tracker`, `shell`, `tools` do `clampSettings`; e, do original, `model` e
`allowedCommands` (e o `shell: host`, se já era `host` e o modelo não o mexeu) para que o teste tenha "as
permissões que o agente terá". Sempre `stages: []`, sem squad, `autonomous: false`, `turnsTo: null`,
`draft: true`. O id da cópia é `<id do original>-draft` (até 40+6 caracteres), com `uniqueId` (D8). O original
não é tocado.

**Concluir (decisão do mantenedor no gate 2: o rascunho fica no time até a pessoa salvar no editor).**

- *Criar, com um rascunho de teste salvo:* `agentAssist:conclude` (id) limpa a conversa do rascunho (`deleteThread` e
  `ensureAgentThread`) e recusa o que não é rascunho; o agente que a pessoa salvar nasce com a conversa direta
  vazia (regra 14). Em seguida o editor abre em **modo de promoção** sobre o próprio rascunho: `AgentPanel` ganha
  `promote?: { id: string }`, abre com `isNew: false`, o id aparece fixo (o do rascunho, `ui.team.f.idFixed`) e **não**
  mostra **Excluir**. O formulário vem do `toAgentDraft`. Salvar é o `save` de sempre, com a config de
  `promoteDraft(config, draft)`, função pura nova em `agentEdit.ts`: o `updateAgent` de sempre com
  `draft: undefined` (`team.ts:105-106` já descarta a chave) e o squad pelo `setAgentSquad`. As etapas, o squad e o
  `turnsTo` só passam a valer aqui. `agentProblems` e `teamIssues` avaliam a config **já promovida**; sem isso
  `checkFlow` filtraria o rascunho e a pessoa não veria um problema do agente que ela está prestes a salvar.
- *Criar, sem rascunho* (a pessoa não testou): nada foi salvo no time. O editor abre com `isNew: true` e o
  `AgentDraft`; salvar é o `addAgent` de sempre.
- *Ajustar:* o editor abre no **original** com `isNew: false` e as mudanças ainda não salvas (`toAgentDraft` = o
  `AgentDraft` do formulário + os campos propostos). Nada do original muda até salvar. A cópia de teste (se há)
  fica até o original ser salvo; então o renderer chama `agentAssist:discard` com o id da cópia. Se isso falhar, a
  cópia continua visível como **Rascunho** e a pessoa a descarta.
- *Cancelar o editor* (qualquer um dos três): **volta ao assistente, na revisão**, com o estado intacto. O estado
  do assistente vive no `TeamSection`, acima dos dois painéis, e não no painel que se fecha. O rascunho do time
  não se mexe. Descartar o assistente é que o apaga (D16).
- O `AgentPanel` ganha `assisted?: boolean` (D15); só com ele mostra um controle de **Etapas** (caixas de seleção
  entre as etapas de trabalho oferecidas). Hoje o editor **não tem** controle de etapas (as etapas vêm do editor
  de fluxo, `agentEdit.ts:29-30`, `flowEdit.ts:229`); sem isso a pessoa aplicaria etapas que não viu (regra 15).
  Seção 10, decisão 6.
- Como o id do rascunho **continua o mesmo** ao salvar (e o rascunho nunca é apagado antes de abrir o editor),
  `useConfigView.reload` **não** precisa devolver a promessa: essa mudança do primeiro texto do plano saiu.

**Fechar o painel (D16).** Com progresso a perder (alguma rodada respondida, ou um rascunho de teste salvo), fechar
(o botão, o `Esc` do `SidePanel`, `ui.tsx:43`) pede confirmação com o `Confirm` do time; confirmar apaga o
rascunho de teste e a conversa. Sem progresso, fecha direto. Cancelar o **editor** aberto por Concluir não passa por
aqui: ele volta ao assistente.

### 2.6 Os canais, quem salva o rascunho e a política do celular (D10, D11)

**Quem salva: o main, por um canal próprio, e não o renderer por `config:save`.** O rascunho tem permissões
reais (`tracker`, `shell`, `tools`) e precisa ser inerte; se o renderer o montasse e mandasse a config inteira
(`teamApi.save`, `teamApi.ts:12`), uma config velha na tela (`config` é a de quando o painel abriu)
sobrescreveria o que mudou depois, e a regra 12 dependeria do que o renderer enviou. O main parte de
`updateConfig(c => …)` sobre a config de agora (`workspaceConfig.ts:103`), monta o `AgentDef` inerte por
`newAgent` e **reaplica o `clampSettings`** com o que a máquina oferece de verdade
(`sandbox.status()`, `sandbox/workspace.ts`).

| Canal | Entrada (lida sem confiar) | Faz |
|---|---|---|
| `agentAssist:round` | modo, pedido, rodadas, rascunho, base, id do rascunho de teste, observação | uma chamada `askBare('deep')`; devolve `{ questions, draft, enough }` |
| `agentAssist:review` | o mesmo | outra chamada; devolve `{ draft, settings, reasons }` já no `clampSettings` |
| `agentAssist:saveDraft` | `{ id?, from?, draft, settings }` | cria ou atualiza o rascunho de teste, garante a conversa direta, devolve `{ id }` |
| `agentAssist:conclude` | `id` | recusa o que não é rascunho; limpa a conversa do rascunho (apaga e recria vazia), sem tocar na config: o rascunho fica no time até o editor salvar |
| `agentAssist:discard` | `id` | recusa o que não é rascunho; tira o agente da config, **depois** apaga a conversa e os anexos |

- `saveDraft`, ao **atualizar** um rascunho depois de uma rodada nova, também **recomeça a conversa**
  (`deleteThread` e `ensureAgentThread`): as respostas dadas com as instruções antigas entrariam nas últimas
  40 mensagens que o agente lê (`mentions/call.ts`, `thread.slice(-40)`) e contaminariam o novo teste. O
  renderer chama `forgetNow()` e `reloadThreads()` (`forumApi.ts:30`, `:47`) depois, como o apagar-mensagem.
- `saveDraft` dá ao rascunho um nome de reserva (`main.assist.draftName`) quando o modelo não trouxe nome: a
  config sempre valida (nome com 1 a 80 caracteres, `schema.ts:221`).
- `discard` só age sobre `draft === true`; um id de agente de verdade, de sistema ou desconhecido é recusado
  (`main.assist.error.notDraft`). É a salvaguarda de que "Descartar" nunca apaga um agente da pessoa. As
  propostas que o rascunho deixou em Ações ficam onde estão (seção 10, decisão 4).
- A ordem do descarte é **config primeiro, conversa depois**: `forum:list` recriaria a conversa de um agente
  que ainda estivesse no time.
- Uma resposta em andamento quando se descarta termina e tenta escrever numa conversa que não existe
  (`unknown-thread`); o erro cai no `catch` da cadeia (`mentions/module.ts:96`) e a linha da chamada falha.
  Custo de uma chamada, sem estrago (risco 5).
- Os erros viram texto para a pessoa no main: `ProviderBudgetError` →
  `main.assist.error.budget` com o provedor e o texto do provedor já redigido (`detail`, `contract.ts`); o
  resto → `main.assist.error.failed` com a razão redigida (`redact`, aparada). A tela mostra o motivo e
  "Tentar de novo" (regra 17).

**Política do celular.** `agentAssist:*` entra em `webPolicy.ts` como um padrão (`AGENT_ASSIST = /^agentAssist:/`,
ao lado de `DOCS` e `WIZARD`), e não como quatro nomes em `DESKTOP_ONLY`: o resultado é o mesmo (`deny`, com
ou sem a chave de efeitos externos, regra 16 e `paired-phone.md`), e um canal acrescentado depois nasce
fechado. O conjunto `DESKTOP_ONLY` **não muda**, então o golden de `test/web-server.test.ts:333` fica como está.
Um teste novo, no molde de `docs-policy.test.ts`, lê o código do módulo e exige que **todo** `ctx.handle('agentAssist:…')`
seja negado. A mudança de palavras em relação à spec ("entram ali") é só de mecanismo.

**O celular e a lista do time.** O cartão **Rascunho** aparece também no celular (a config é lida lá), mas o
**Descartar** só na janela (`isWeb()`, como o **Sugerir agentes**, `TeamSection.tsx:75`), porque o canal é só do
computador. `config:cycle-save` do celular continua como é: `agents.team` é um caminho editável e nada nele
sobe sem checagem (`configScope.ts:66-78`); limpar o `draft` de um agente pelo celular não dá poder novo (o
celular já pode dar etapas a qualquer agente existente, com as permissões que ele já tem).

### 2.7 Apagar uma conversa inteira (D8)

- `ForumStore.deleteThread(thread): ThreadHeader | null` (`forum-core.ts:47-62`; o armazém é o único que sabe
  de arquivo e cache): `rmSync` do `.jsonl`, `cache.delete`, devolve o cabeçalho que havia ou `null`; idempotente;
  um id que não passa em `THREAD_ID` lança `bad-thread` como os demais (`path`, `:246`). Não emite evento (o
  armazém só emite mensagens); a tela usa `forgetNow()` e `reloadThreads()`.
- `AttachmentStore.dropThread(thread)` (ao lado de `dropFile`, `attachments.ts:134`, e no objeto devolvido em
  `:216`): `rmSync(dirOf(thread), { recursive, force })`. A
  pasta é por conversa (`anexos/<thread>/`), então é uma chamada; o resto que a retenção varreria (`retention.ts:73`)
  já não existe depois.
- `deleteAgentThread(forum, attachments, agentId)` em `forum-channels.ts:19` (ao lado de `ensureAgentThread`),
  que só apaga uma conversa de tipo `agent` — a trava de que a capacidade nova do armazém, que é geral, não é
  chamada para uma execução ou uma conversa geral.
- **A órfã de `removeAgent` fica de fora.** `removeAgent` (`team.ts:117`) só mexe na config, é chamado pelo
  renderer (`TeamSection.tsx:169`) e nada no main reage; remover um agente de verdade deixa `agent-<id>`
  órfã, que continua listada no fórum. Mudar isso é apagar o histórico de uma pessoa sem a confirmação dizer
  que o apaga: é decisão de produto (seção 10, decisão 5). O que este plano garante é que o **rascunho** nunca
  herde uma órfã: o id do rascunho é escolhido com `uniqueId` entre os ids do time **e** os ids de toda
  conversa direta existente (`forum.list()`, `kind: 'agent'`), então `agent-<id>` do rascunho sempre nasce
  vazia e a regra 14 vale. Nenhuma varredura de órfãs antigas.
- O `mentionsModule` já resolve o dono pelo cabeçalho (`ownerOfThread`, `module.ts:45`); apagada a conversa, o
  `forum.summary` devolve `null` e nada responde mais nela.

### 2.8 O teste é uma conversa direta de verdade (D12)

Nada novo no lado da conversa: `saveDraft` garante `agent-<id>` por `ensureAgentThread` (a conversa só nascia no
`forum:list`, `forum.ts:99`), e o dono responde sem `@` por `callsOf`/`ownerOfThread`
(`mentions/module.ts:38-47`). As regras 11–13 se cumprem por construção, e cada uma ganha um teste:

- as instruções e o `job` do rascunho entram no texto do agente (`mentionCall`, `mentions/call.ts:160`, `:173`);
- `tools` do rascunho valem (`toolsOf`, `agents.ts:1136-1140`);
- uma menção nunca recebe `Edit`/`Write`, qualquer que seja a permissão (`agents.ts:429`, `:1136-1140`,
  `mentions/call.ts`, comentário de topo); por isso `permission: worktree` **não é validado** por uma conversa
  de teste: o assistente pode propô-lo (decisão do mantenedor) e a revisão diz isso ao lado do valor (2.4, risco 15);
- a proposta de escrita espera em Ações, o comando espera o "sim" e o espaço de teste recusa, tudo pelos
  caminhos que já existem (`mentions/answer.ts:121`, `mentions/module.ts:58`, `actions.ts:501`, `:543`);
  `autonomous: false` garante que nada sai sozinho (`autonomyOf`, `answer.ts:249`).
- o `Thread` entra no painel com `thread={agentThreadId(id)}`, `team={config.agents.team}` e `title`. Não muda
  de props. Dois ajustes: o `@` completa sem rascunhos (menos o dono daquela conversa, `Thread.tsx:288`), e o
  CSS do fórum (`cycle.css`, importado por `ForumScreen.tsx`) é importado também por `AgentAssist.tsx`, para não
  depender da ordem em que a tela do fórum foi carregada.
- `forum:list` **não lista** a conversa de um rascunho: sem ruído de "não lido" no fórum e no resto do app
  enquanto se testa. `forum:read` e o `Thread` por id continuam funcionando.

### 2.9 Limpeza, e se o app fecha no meio (D9)

| Momento | O que acontece |
|---|---|
| Descartar o assistente (com confirmação, se há progresso) | `discard`: o agente sai da config, depois a conversa e os anexos |
| Concluir | `conclude`: a conversa do rascunho é apagada e recriada vazia; o rascunho **fica** no time e o editor abre sobre ele |
| Salvar no editor (criar, com rascunho) | o rascunho é promovido na mesma gravação do editor: sai a marca, entram etapas, squad e `turnsTo`; nada a apagar |
| Salvar no editor (ajustar) | o original é salvo; depois o renderer descarta a cópia (`discard`), que sai da config e leva a conversa |
| Cancelar o editor | volta ao assistente, na revisão; o rascunho e a cópia seguem no time, o estado do assistente intacto |
| Fechar a janela com um rascunho salvo, ou com o editor aberto sobre ele | nada pode ser feito a tempo; o rascunho fica no time com a marca **Rascunho** (e, depois de Concluir, com a conversa já vazia) |
| Abrir o app depois | o cartão **Rascunho** e o **Descartar** (com `Confirm` e o aviso de que apaga o agente e a conversa) |
| Rascunho órfão e `forum:list` | a conversa dele continua escondida; `discard` a apaga (se existe) |
| Fechou entre salvar o rascunho e criar a conversa | `saveDraft` salva a config **e** garante a conversa na mesma chamada; se a segunda metade falhar, a próxima abertura do assistente ou o `discard` a refazem/ignoram (`deleteThread` é idempotente) |
| Fechou depois de apagar a config e antes de apagar a conversa | sobra uma conversa `agent-<id>` órfã, escondida de `forum:list` só enquanto existisse o rascunho: ela volta a ser listada. Pelo desenho do id (2.7), nenhum rascunho novo a herda |

O cartão de um rascunho não tem **Editar** nem o interruptor de autonomia (`TeamSection.tsx:97`, `:108`):
retomar um assistente interrompido é fora do escopo, e a autonomia de um rascunho tem de continuar desligada
(`runs:setAutonomous` o recusa, 2.2).

## 3. Dados

- `AgentDef.draft?: boolean` (D1). Ausente: um agente de verdade. `true`: o rascunho de um assistente.
- `AgentDraft` (a forma do formulário, `agentEdit.ts:13`) **não** ganha `draft`: o editor nunca edita um
  rascunho.
- Em `src/shared/agentAssist.ts`: `AssistMode`, `AssistQuestion { id, text, kind, options, why }`,
  `AssistAnswer { question, picked, other, text }` (tudo vazio = pulada), `AssistRound { questions, answers }`,
  `AssistDraft { name, job, instructions }`, `AssistSettings { permission, tracker, shell, tools, stages, squad, turnsTo }`
  (`tools: AgentToolsConfig | null`), `AssistReasons`, `AssistOffers { sandbox, permission, stages, squads,
  turnsTo, workspaceTools }`, `ASSIST_LIMITS`, `readQuestions`, `readAssistDraft`, `clampSettings`,
  `isAboveMinimum`.
- Nada novo em disco: o rascunho é uma entrada de `agents.team` em `config.json`, a conversa é
  `forum/agent-<id>.jsonl`, os anexos `anexos/agent-<id>/` (`data-layout.md`). Nenhum segredo, nenhum dado de
  pessoa em teste.

## 4. Configuração e migração

- **Esquema 19** (D1). Arquivos: `types.ts:5` (`19` e o cabeçalho "schema 19", `:1`), `schema.ts` (`draft` em
  `agentDef` e o comentário `schema 18`, `:6`), `migrations.ts` (a linha `v19` na lista do cabeçalho, `:37`;
  `v18ToV19`; `STEPS` com `18: v18ToV19`).
- `v18ToV19` devolve `{ ...old, schemaVersion: 19 }` e uma nota; não lê disco nem a máquina e é idempotente
  (`migrations.ts:38-39`). Não levanta nada: um agente sem `draft` é um agente de verdade.
- `defaults.ts`: nenhuma entrada nova (o campo é opcional e ausente nos cinco agentes de sistema); o teste de
  deriva (`config-schema.test.ts:70`) aceita o campo porque o caminho `agents.team[].draft` tem `[]`.
- Quem abre um arquivo v19 num app v18 o recusa, sem repor o time (seção 2.1).
- Documentação: `docs/configuration.md` (a linha da versão, `:15`, e o histórico, `:48`: "v19 acrescenta
  `draft`, a marca do agente que um assistente salvou para ser testado").

## 5. Fluxo e prompts

**Criar com IA.** 1 pedido livre → `agentAssist:round` → 2 rodada de 3–6 perguntas (aberta, escolha única,
múltipla; **Outro** sempre; cada uma pode ficar sem resposta) com a prévia do rascunho ao lado → 3 próxima
rodada (até 4) ou **Terminar** → `agentAssist:review` → 4 revisão: nome, papel, instruções e, para cada valor
acima do mínimo, o valor, o motivo e **Voltar ao mínimo** → 5 **Testar em conversa** (`saveDraft` + `Thread`)
→ **Ajustar a partir desta conversa** (observação opcional + a conversa do teste volta numa rodada) → 6
**Concluir** (`conclude`, editor em modo de promoção, cancelar volta ao assistente). **Ajustar com IA** é o mesmo, com "O que você quer mudar?", o
agente do formulário como base, e a revisão em *antes → depois*; "voltar" desfaz a mudança do campo (pergunta
aberta 3).

**Prompts** (todos em `prompt.sdd.assist.*`, nos dois catálogos, escritos por `cp()` em
`src/main/cyclePrompts.ts` e usados por literal em `agentAssist-core.ts`, como `suggest.main`):

| Id | Papel |
|---|---|
| `assist.system` | quem é o assistente, o que nunca faz (inventar etapas, squads, agentes, comandos), a regra de língua |
| `assist.round` | gera a rodada: pedido, rodadas anteriores, rascunho, o que existe, quantas rodadas restam |
| `assist.review` | gera a revisão: o que propor acima do mínimo, só entre o que existe, sempre com motivo |
| `assist.task.create`, `assist.task.adjust` | a frase do que se pede, por modo |
| `assist.section.*` | pedido, rodadas (com "pulada" e "Outro: …"), rascunho, agente original, conversa de teste, contexto |

- Língua (regra 6): perguntas, nome e papel "na língua do workspace"; instruções **em inglês**, como o `prompt`
  do #5 (`prompt.sdd.suggest.main`).
- A fala da pessoa vai entre `<data>` (`fence`, `runner/prompt.ts:97`); as respostas do modelo nunca são
  executadas.
- Em inglês e em português, sem palavras do host fixas (`{vcsName}`): `host-terms-leak.test.ts` renderiza todo
  prompt para GitHub e Bitbucket. Os textos de interface evitam "chamada"/"call" (senão pedem `.novoice`,
  `docs/i18n.md`).
- O primeiro parágrafo de `assist.round` e o de `assist.review` precisam ser distintos e longos o bastante para
  `openersOf` (`shared/cycles/prompts.ts`) reconhecê-los (commit 11).
- Chaves: `ui.team.assist.*`, `ui.team.draft.*`, `ui.team.f.stages*` em `ui-team.en.json` / `ui-team.pt-BR.json`;
  `main.assist.*` em `main.*.json`. Toda chave aparece **escrita por extenso** em arquivos de
  `screens/team/` (`test/team-catalog.test.ts` varre só essa pasta), e as tabelas de valores ficam em
  `labels.ts`.
- Tema: classes `tm-assist-*` em `team.css` com tokens, nunca cor literal (`theme-audit`).

## 6. Ordem dos commits

Cada um em inglês, `feat:`/`fix:` minúsculo, imperativo, sem ponto final, **sem** trailer de coautoria nem texto
de ferramenta (regra do repositório). Antes de cada commit: `npx tsc --noEmit`, `npx vitest run`,
`node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

| # | Mensagem | Conteúdo | Testes do commit |
|---|---|---|---|
| 0 | `feat: add the plan documents #145` | **só** `0_ISSUE.md`, `1_SPEC.md`, `2_PLAN.md` | — |
| 1 | `feat: mark an agent as a draft` | esquema 19, `draft`, `v18ToV19`, `isDraft`/`workingTeam`, `newAgent`, `docs/configuration.md` | migração, esquema, `agent-team`, os doze arquivos do 18 → 19 |
| 2 | `feat: keep a draft agent out of the flow and the mentions` | filtros compartilhados e do main (2.2), `mentionableIds`, `flowInputs`, `runs:setAutonomous`, `templateFromConfig` | `agent-draft-isolation` e extensões |
| 3 | `feat: delete a whole conversation and its files` | `deleteThread`, `dropThread`, `deleteAgentThread` | `forum-store`, `attachments-store`, `forum-channels` |
| 4 | `feat: let a call carry no tool and no documentation` | `bare`, `askBare` | `agent-bare-claude`, `agent-bare-open` |
| 5 | `feat: read what the agent assistant asks of a model` | `shared/agentAssist.ts`, mover `slugOf`/`uniqueId` | `agent-assist-schema` |
| 6 | `feat: add the prompts of the agent assistant` | catálogos `prompt.sdd.assist.*`, montagem em `agentAssist-core.ts` (só a parte pura) | `agent-assist-prompts` e os testes de catálogo |
| 7 | `feat: add the channels of the agent assistant` | `agentAssist.ts` (`round`, `review`, `saveDraft`, `conclude`, `discard`), `agentAssist-core.ts`, `modules.ts`, `webPolicy.ts`, `forum:list`, `main.assist.*` | `agent-assist-module`, `agent-assist-draft`, `agent-assist-policy`, `mentions-agent-chat` |
| 8 | `feat: keep the state of the agent assistant` | `assistEdit.ts` | `agent-assist-state`, `team-agent-edit` |
| 9 | `feat: add the agent assistant to the team screen` | `AgentAssist.tsx`, `AssistQuestion.tsx`, `AssistReview.tsx`, `TeamSection.tsx` (estado do assistente acima dos painéis), `team.css`, catálogos de interface, controle de etapas e modo de promoção do editor (`promoteDraft`) | marcação estática dos cartões, `team-catalog`, `ui-i18n` |
| 10 | `feat: show a draft agent in the team list` | cartão, **Descartar**, listas que não oferecem rascunho (`SquadsSection`, `FlowEditor`, `ForumScreen`, `Thread`) | `team-agent-edit`, `forum-view` |
| 11 | `feat: count the agent assistant in the usage screen` | `custo-core`, `retention-core`, `shared/custo.ts`, `main.custo.kind.assist`, `main.retention.app.assist` | `custo-scope`, `main-catalogs`, `voice-terminology` |
| 12 | `feat: document the agent assistant` | `CHANGELOG.md` (`[Unreleased]`), `docs/runner.md` | — |

Os commits 1–7 não mudam o que a pessoa vê; a tela só entra no 9. O commit 11 entra (decisão do mantenedor): é ele
que põe o assistente na tela de custo e na retenção. O `askBare` **não** passa `persistSession: false`, porque a
sessão gravada é o que o custo e a retenção leem.

## 7. Plano de teste

Nada alcança um modelo real, um host real nem a rede; as falsas são as de `test/helpers/` (o SDK com
`vi.mock`, como `agent-resume.test.ts:1-20`; o servidor OpenAI de `fakeOpenAI.ts`; `askBare` com `vi.mock` de
`../src/main/agents`, como `suggestions-module.test.ts:12-19`; `fakeGitlabRuntime` para Ações, como
`mentions-agent-chat.test.ts`). Pasta de dados vazia (`CERIMONIAS_DATA_DIR`), nenhum dado real.

| Arquivo (`test/`) | Casos |
|---|---|
| `agent-assist-schema.test.ts` (novo) | `readQuestions`: descarta o inválido e guarda o válido; teto de 6; escolha com menos de 2 opções cai; ids `q1…`; 3 não é imposto. `readAssistDraft`: 80/1000/4000; `redact`. `clampSettings`: `permission` só `read`/`worktree`; `sandbox` sem sandbox, `allowlist` num leitor (e com `worktree` aceito), `host` nunca (e mantido só quando já era), etapa/squad/`turnsTo` inexistentes, `turnsTo` = ele mesmo ou um rascunho, `trackerMcp*` nunca; `autonomous`/`allowedCommands`/`model`/`id` não passam; sem motivo, volta ao mínimo; entrada que não é objeto |
| `agent-assist-state.test.ts` (novo) | a 5ª rodada não existe; resposta pulada marcada; `Outro` com texto; `toInput` corta; `reviewRows` só acima do mínimo; `resetField`; ajustar: *antes → depois* e "voltar" ao original; `toAgentDraft` em criar e em ajustar |
| `agent-assist-prompts.test.ts` (novo) | cada `assist.*` renderiza nos dois idiomas sem `{…}` sobrando, cita 3 a 6, 4 rodadas, "instruções em inglês", e não deixa o modelo decidir host/autonomia |
| `agent-bare-claude.test.ts` (novo) | com o SDK falso: `tools: []`, `allowedTools: []`, `settingSources: []`, `strictMcpConfig`, sem `mcpServers`, `cwd` = a pasta de dados, `outputFormat: json_schema`, papel `deep`, `Bash`/`Edit`/`Write` negados |
| `agent-bare-open.test.ts` (novo) | com `fakeOpenAI` e `COXIA_ENGINE=open`: o pedido não leva ferramenta nenhuma além de `final_answer`; o texto de sistema não leva o `CLAUDE.md` posto na pasta de trabalho nem o índice de documentação |
| `agent-assist-module.test.ts` (novo) | `round`/`review` com `askBare` falso: contexto só com o que existe; 5ª rodada recusada; orçamento/erro/resposta vazia viram texto; nenhum canal chama o fórum nem Ações |
| `agent-assist-draft.test.ts` (novo) | `conclude` limpa só a conversa e deixa o rascunho (e recusa o que não é rascunho); `saveDraft` cria **inerte** (`stages: []`, sem squad, `autonomous: false`, `turnsTo: null`, `draft: true`) mesmo que a entrada traga o contrário; `host` e `allowedCommands` só vêm do original; id livre também de conversas órfãs; conversa criada; atualizar recomeça a conversa; `discard` recusa agente de verdade e de sistema; apaga config, conversa e anexos; com um problema antigo no fluxo, salvar e apagar o rascunho funcionam (`flowInputs`) |
| `agent-assist-policy.test.ts` (novo) | todo `agentAssist:*` servido é `deny` com ou sem efeitos externos; o módulo está em `moduleList()`; nenhum canal fora do padrão (molde de `docs-policy.test.ts`) |
| `agent-draft-isolation.test.ts` (novo) | com um rascunho que tenha etapas à mão: `stageAgent`, `flowOf`, `effectiveTeam`, `turnTarget` o ignoram; `agentId` ou `turnsTo` apontando para ele é `agent-unknown`/`turns-unknown`; `checkSquads`; `mentionableIds`; `runs:setAutonomous` recusa; `templateFromConfig` o omite |
| `forum-store.test.ts` | `deleteThread`: remove o arquivo e o cache; idempotente; `append` depois dá `unknown-thread`; id inválido |
| `attachments-store.test.ts` | `dropThread` apaga a pasta; outra conversa fica |
| `forum-channels` (em `forum-store` ou novo) | `deleteAgentThread` só apaga `kind: 'agent'` |
| `mentions-agent-chat.test.ts` | numa conversa de rascunho: o dono responde sem `@`; a escrita proposta espera em Ações; com `autonomous: false` nada sai; num espaço de teste a aprovação é recusada |
| `mentions-call-agent.test.ts` | `CallAgent` não alcança um rascunho |
| `team-agent-edit.test.ts` | `promoteDraft` tira a marca e aplica etapas, squad e `turnsTo`, e `agentProblems`/`teamIssues` avaliam a config promovida; `turnsToChoices` sem rascunhos; `idTaken` com eles; `slugOf`/`uniqueId` ainda exportados de `agentEdit` |
| `config-migrations.test.ts`, `config-schema.test.ts`, `agent-team.test.ts` | "esquema 18 para 19" (nada se move; um agente com `draft` sobrevive); o campo aceito e `draft: 'sim'` recusado; os literais 18/19 trocados |
| `config-web-scope.test.ts` | o celular salva o time com um rascunho que não mexeu; `draft` não vira caminho recusado |
| `forum-view.test.ts` / `forum-policy.test.ts` | os canais do fórum seguem abertos ao celular; `forum:list` omite a conversa do rascunho |
| `custo-scope.test.ts`, `main-catalogs.test.ts`, `voice-terminology.test.ts` | só no commit 11: `assist` nas tabelas e nos dois catálogos |

**Goldens e testes existentes que tocam:** `test/web-server.test.ts:333` (a lista exata de `DESKTOP_ONLY`)
**não muda** porque o padrão fica fora do conjunto; `test/cycle-prompts.test.ts` (base completa nos dois idiomas,
"nenhum prompt sem uso", "nenhum copiado sem tradução"), `test/host-terms-leak.test.ts`,
`test/gitlab-catalogs-unchanged.test.ts` (lê só as chaves do `main` antigo, então chaves novas não o alteram),
`test/team-catalog.test.ts`, `test/ui-i18n.test.ts`, `test/main-catalogs.test.ts`. O formulário em branco, o
**Sugerir agentes** e a conversa direta (regra 18) seguem cobertos por `team-agent-edit`, `suggestions-module`,
`team-suggestion-edit`, `mentions-agent-chat` **sem alteração** nos casos que já existem.

**O que os testes não cobrem** (não há biblioteca de DOM no repositório; só `renderToStaticMarkup`): a tela em
movimento, o `Thread` dentro do painel e do painel estreito, e o que um modelo de verdade devolve. Isso fica
para o plano de teste humano (`5_TEST_PLAN.md`): o fluxo inteiro num espaço de teste com a pasta de dados vazia
(`CERIMONIAS_DATA_DIR`), nos dois motores, fechando o app no meio para ver o rascunho órfão.

## 8. Riscos

| # | Risco | Cobertura |
|---|---|---|
| 1 | O tamanho e a qualidade de uma rodada (e a forma estruturada) **não foram medidos** nos dois motores; servidores do motor aberto podem recusar o esquema, e `maxTurns: 2` não foi testado com um modelo | esquema mínimo, sem limites de tamanho; o leitor leniente; erro dito com "Tentar de novo"; verificar no teste humano nos dois motores |
| 2 | `strictMcpConfig`/`settingSources` num SDK local de versão diferente (`locateSdk`) podem ser ignorados | a garantia de "nenhuma ferramenta" é `tools: []` (documentado no SDK instalado) e `allowedTools: []`; o resto reduz exposição |
| 3 | Subir o esquema para 19 numa release em beta: quem salvar com 0.8.0-beta.8 não volta à beta.7 | o app anterior recusa em vez de perder o time; **decidido pelo mantenedor no gate 2** (0.8.0 em beta); a 0.8.0 foi lançada durante a implementação e o alvo passou a ser a `main`; conferir de novo a colisão de versão antes da PR |
| 4 | Outro ciclo subir o esquema antes deste chegar à `release` | conferir de novo antes da PR; o passo é de uma linha |
| 5 | Descartar com uma resposta em andamento; fechar o painel com uma chamada no ar | o erro cai na cadeia; custo de uma chamada; sem cancelamento (o IPC não tem) |
| 6 | O app fecha no meio, ou com o editor aberto sobre o rascunho: rascunho órfão | visível, descartável com confirmação; sem varredura automática (regra 14). Como o rascunho agora vive até o salvar, a janela em que ele existe é maior (do teste até o salvar) |
| 7 | `Thread` dentro do `Sheet` (janela estreita) e o CSS do fórum | importar `cycle.css`; **não verificado** (a spec também não) |
| 8 | Um modelo propõe mais permissão do que o trabalho pede | cada valor acima do mínimo tem motivo e botão; sem motivo, volta ao mínimo; o editor é o portão |
| 9 | O rascunho no time durante o teste: outro código que escolha agente por "o primeiro que lista a etapa" | a tabela de 2.2 e o teste de isolamento; o rascunho nasce sem etapas |
| 10 | O texto do pedido (e de segredo colado nele) vai ao provedor e fica na transcrição | igual a qualquer conversa; `redact` na saída; o commit 11 ou `persistSession: false` decidem a transcrição |
| 11 | O sandbox de um rascunho com `shell: sandbox` copia repositórios a cada resposta | é o que a conversa direta de qualquer agente faz hoje (`mentions/answer.ts:297-305`) |
| 12 | O plano mexe em código de uso geral: `stageAgent`, `effectiveTeam`, `checkFlow`, `flowInputs`, o editor em modo de promoção | testes novos em cada um (`agent-draft-isolation`); sem rascunho no time, as funções devolvem o que devolviam |
| 13 | O preset `claude_code` ainda acrescenta ao texto de sistema o que for do ambiente (o diretório de trabalho, a plataforma) | o diretório é a pasta de dados, que não é repositório; **não verificado** o que mais o SDK acrescenta |
| 14 | O modo de promoção: `teamIssues`/`agentProblems` avaliam a config promovida; se avaliassem o rascunho, `checkFlow` o filtraria e esconderia um problema | `promoteDraft` é o único caminho da config do editor em modo de promoção; teste em `team-agent-edit` |
| 15 | `permission: worktree` proposto pelo modelo: o teste não mostra o que o agente faz com arquivos (uma conversa nunca escreve) | motivo e botão de voltar como qualquer valor acima do mínimo; a revisão diz que o teste não o valida (`ui.team.assist.worktreeNote`); o editor é o portão |

## 9. Registro de decisões

| # | Decisão | Alternativa rejeitada, e por quê |
|---|---|---|
| D1 | `draft?: boolean` no `AgentDef` e esquema 19 com passo vazio | **Campo opcional sem subir a versão**: o app anterior leria `draft` como campo desconhecido e repuria o time pelos cinco de sistema (2.1). **Guardar rascunhos fora da config**: tudo (menção, conversa direta, `runAgent`) lê `agents.team`; seriam dois armazéns. **Marcar por convenção de id**: frágil e o id sai do nome |
| D2 | Filtrar nas funções de decisão compartilhadas (`stageAgent`, `effectiveTeam`, `checkFlow`, `checkSquads`, `turnTarget`) e nas listas de oferta | **Filtrar em cada leitor** (≈40 lugares): um novo leitor esqueceria. **Confiar só no rascunho inerte**: o editor de fluxo e um arquivo à mão desfazem a inércia |
| D3 | Estado só no renderer; cada chamada leva tudo e o main relê limites | **Sessão no main**: guardaria o pedido da pessoa em memória sem dono, contra a regra 3 |
| D4 | **Revisada no gate 2.** Concluir mantém o rascunho e abre o editor em modo de promoção; salvar tira a marca; cancelar volta ao assistente. A conversa é limpa no `conclude` | **Apagar o rascunho ao Concluir e abrir o editor `isNew`** (o primeiro texto do plano): cancelar o editor perdia tudo o que o assistente produziu. O mantenedor preferiu manter o rascunho; o custo é o rascunho viver no time até o salvar (risco 6) |
| D5 | `askBare` + `bare`, cwd neutro, sem documentação | **Reusar `askAgent` com `tools: []`** (como o `diagramFix`): deixa `allowedTools`, MCP do usuário, `CLAUDE.md` e `projectsRoot` |
| D6 | Duas chamadas (`round`, `review`) com esquema mínimo | **Uma chamada que devolve tudo a cada rodada**: gasta tokens e mostra permissões antes de a pessoa terminar. **Esquema com `minItems`/`maxItems`**: servidores do motor aberto podem recusar |
| D7 | `clampSettings` único, valor sem motivo volta ao mínimo, `shell: host` nunca; `permission: worktree` aceito com motivo (**revisada no gate 2**) | **Clampar na tela**: um renderer comprometido poderia mandar `host`. **Aceitar o valor sem motivo**: privilégio sem explicação |
| D8 | `deleteThread` geral no armazém, trava de `kind: 'agent'` no `deleteAgentThread`; id do rascunho evita conversas existentes | **Apagar tudo com um `remove` por mensagem**: o arquivo é append-only, sobraria o cabeçalho. **Varrer as órfãs antigas**: apagaria histórico sem aviso |
| D9 | Descarte: config primeiro, conversa depois; rascunho órfão só pela pessoa | **Varredura na abertura do app**: apaga trabalho da pessoa sem pedir (regra 14) |
| D10 | O main monta, reclampa e salva o rascunho (`updateConfig`); o renderer só pede | **`config:save` do renderer**: sobrescreve com config velha e a inércia depende do que a tela mandou |
| D11 | `agentAssist:*` como padrão em `webPolicy.ts` | **Quatro nomes em `DESKTOP_ONLY`**: um canal novo nasceria aberto |
| D12 | Rascunho escondido de `forum:list`, ausente das listas de oferta; cartão sem **Editar** nem autonomia | **Mostrar a conversa no fórum**: ruído de "não lido" durante o teste |
| D13 | `Thread` embutido como está (props iguais), recomeçar a conversa ao atualizar o rascunho | **Manter a conversa antiga**: as 40 mensagens de contexto trariam respostas das instruções velhas |
| D14 | `slugOf`/`uniqueId` vão para `shared/config/team.ts`; o editor reexporta | **O renderer calcula o id e o main confia**: o main não vê as conversas órfãs |
| D15 | O `AgentPanel` mostra Etapas só quando veio do assistente | **Mostrar sempre**: muda o formulário de todo agente (regra 18) |
| D16 | Fechar o painel com progresso pede confirmação; confirmar apaga o rascunho. Cancelar o **editor** não é fechar o assistente: volta a ele | **Fechar direto**: um `Esc` perderia quatro rodadas de respostas |

## 10. Decisões do gate 2 sobre as perguntas abertas

O plano chegou ao gate com sete perguntas e uma recomendação para cada. O mantenedor respondeu à 2 e à 7 e a duas
perguntas novas (a release e o que Concluir faz, linhas 8 e 9); as outras cinco (1, 3, 4, 5 e 6) ficaram na
recomendação e podem ser trocadas.

| # | Pergunta | Resposta | Quem decidiu |
|---|---|---|---|
| 1 | A rodada de "Ajustar a partir desta conversa" conta nas quatro? | **Sim**; esgotadas as quatro, o botão continua levando ao editor | recomendação do plano, não perguntada |
| 2 | O assistente pode propor `permission: worktree`? | **Sim**, com motivo, botão de voltar e o aviso de que o teste não o valida (2.4, risco 15) | mantenedor (contra a recomendação do plano) |
| 3 | Ao ajustar, "voltar ao mínimo" desfaz para o valor do original ou para o de um agente novo? | **O valor do original** | recomendação do plano, não perguntada |
| 4 | Descartar um rascunho que deixou propostas esperando em Ações: pular ou deixar? | **Deixar**: a pessoa as vê, com o nome do agente que as fez, e decide | recomendação do plano, não perguntada |
| 5 | Remover um agente de verdade deve apagar a conversa direta dele? | **Ciclo à parte**, com a confirmação dizendo isso; este plano só evita que um rascunho a herde | recomendação do plano, não perguntada |
| 6 | O controle de etapas do editor aparece só vindo do assistente, ou para todo agente? | **Só vindo do assistente** nesta entrega | recomendação do plano, não perguntada |
| 7 | A tela de custo e a retenção contam as chamadas do assistente (commit 11)? | **Sim**: o commit 11 entra | mantenedor |
| 8 | Em qual release entra? | **Na 0.8.0, em beta**; esquema 19 ali. A 0.8.0 foi lançada durante a implementação: passa a ser a versão menor seguinte, pela `main` | mantenedor (contra a recomendação do plano, que era a próxima versão menor) |
| 9 | Concluir apaga o rascunho ou o mantém até salvar? | **Mantém até salvar**; cancelar o editor volta ao assistente (2.5, D4) | mantenedor (contra a recomendação do plano) |

## 11. O que fica fora deste plano, de propósito

- Mexer em `removeAgent`, na conversa de um agente de verdade ou numa varredura de órfãs antigas.
- Cancelar uma chamada em voo; retomar um assistente interrompido; guardar o histórico das perguntas.
- Mudar o editor para quem não veio do assistente, ou subir o limite do nome de 80 (o campo do editor deixa 100:
  `maxLength={100}`, `TeamSection.tsx:179`, e o esquema recusa; é um defeito antigo, de uma linha, que cabe num
  `fix:` à parte se o mantenedor quiser).
- O assistente no celular, `shell: host`, autonomia, comandos sempre permitidos e o modelo do agente.
- Empacotar o SDK (`npm run dist`).

## 12. Onde o plano encosta no que existe

- Config: `src/shared/config/{types,schema,migrations,team,squads,defaults}.ts`, `src/main/workspaceConfig.ts`.
- Fluxo e squads: `src/shared/runs/{flow,flowCheck,squadCheck}.ts`, `src/main/runner/{service,executor}.ts`.
- Fórum e conversa direta: `src/shared/forum.ts`, `src/main/{forum,forum-core,forum-channels,attachments}.ts`,
  `src/main/mentions/{module,answer,call,ceremony,place}.ts`.
- Engines: `src/main/agents.ts`, `src/main/engine/contract.ts`, `src/main/engine/open/{bridge,loop}.ts`.
- Segurança: `src/main/webPolicy.ts`, `src/main/configScope.ts`, `src/main/actions.ts` (sem mudança).
- Telas: `src/renderer/src/screens/team/*`, `src/renderer/src/screens/cycle/{Thread,ForumScreen}.tsx`.
- Regras do repositório que o plano respeita: `agent-roles`, `agent-read-only`, `external-effects`,
  `paired-phone`, `test-workspace`, `config-schema`, `i18n`, `theme`, `public-repo`, `data-layout`,
  e `CONTRIBUTING.md`/`CLAUDE.md` (inglês no código, `t()` nos dois catálogos, sem cor literal, sem rede nos testes).

## 13. Estado do que foi conferido nesta etapa

**Conferido por leitura do código desta árvore** (`release/0.8.0`, `c3652ba`, schema 18): o editor
(`TeamSection.tsx`, `agentEdit.ts`, `teamApi.ts`, `ui.tsx`); o esquema, as migrações, `repair` e o carregamento
(`schema.ts`, `jsonSchema.ts`, `validate.ts`, `migrations.ts`, `workspaceConfig.ts`, `config-bootstrap.ts`); a cadeia
de chamadas ao modelo (`agents.ts`, `engine/contract.ts`, `engine/open/{bridge,loop}.ts`, a documentação de tipos
do SDK instalado); o fórum, os anexos e as menções (`forum-core.ts`, `forum.ts`, `forum-channels.ts`,
`attachments.ts`, `mentions/*`); todos os leitores de `agents.team` (2.2); a política do celular (`webPolicy.ts`,
`configScope.ts`, `configModule.ts`); os catálogos e os testes que os travam; as outras branches e a única PR
aberta, quanto ao esquema.

**Não conferido** (fica para a implementação e para o teste humano):

- Nada foi executado: nem o app, nem um teste, nem o `tsc`. A leitura de que um app anterior repõe o time
  (2.1) vem de `repair` e de `load()`, não de uma execução.
- Se os dois motores devolvem uma rodada estruturada com `tools: []`, `maxTurns: 2` e o texto de sistema próprio;
  o tamanho e o custo de uma rodada; se o motor aberto aceita o esquema sem limites de tamanho.
- Se `strictMcpConfig` existe no SDK que a pessoa aponta (`locateSdk`); o que o SDK ainda acrescenta ao texto de
  sistema do preset `claude_code` (diretório de trabalho, sistema).
- O painel lateral e o `Thread` embutido em janela estreita; a volta do editor ao assistente (o estado do assistente acima dos dois painéis).
- A qualidade dos prompts nos dois idiomas.
- Da lista de PRs abertas: foi **uma** consulta de leitura ao GitHub (`gh pr list`), feita antes de se reparar
  que esta etapa pede para não usar rede; nenhum dado foi escrito. O resto das conferências de branch é de `git`
  local, e a de que a branch da PR aberta não toca `src/shared/config` também.
- Os gates do repositório (`tsc`, `vitest`, `theme-audit`, `i18n:lint`) **não foram rodados**: esta etapa só
  escreve o plano. O `node scripts/public-audit.mjs` foi rodado na árvore de trabalho com este documento e passou
  ("nothing that belongs to a company or a person").
