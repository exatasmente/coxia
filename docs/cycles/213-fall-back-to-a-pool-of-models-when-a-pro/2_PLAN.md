# Plano: conjunto de modelos por papel, com troca na mesma sessão

Tudo abaixo foi lido no código da `release/0.9.0` (0.9.0-beta.12). O que o plano supõe e não conferiu está em **Riscos**. Nada foi executado nesta etapa.

## O que será construído

| Funcionalidade | Onde cai |
|---|---|
| Correção do `Retry-After` no cliente | `src/main/engine/open/client.ts:270` |
| Tipos `ModelRef`, `Activity`, `fallbacks`, `activities`, `scoreOverrides` | `src/shared/config/types.ts` (`RoleModel` :90, `LlmConfig` :96, `AgentModel` :517) |
| Esquema 25, defaults, validação, migração | `types.ts:5`, `defaults.ts:124`, `schema.ts:403/208`, `validate.ts:271`, `migrations.ts:374/379` |
| Conjunto resolvido | `src/main/config-resolve.ts:60-78` (`ResolvedRole.pool`), `:172`, `:177` |
| Registro de descanso, app inteiro | novo `src/main/engine/open/rest.ts` |
| Escolha de candidato e classificação da atividade (puras) | novo `src/main/engine/open/pool.ts` |
| Cliente do conjunto usado pelo laço | `pool.ts` (`PoolClient`), `loop.ts:64,239,284,302,360`, `bridge.ts:38,81` |
| Etiqueta de atividade nas ferramentas | `ToolImpl.activity` em `tools/types.ts`; `read`, `search`, `write`, `bash`; `sandbox/tool.ts`; `browser/engineTool.ts:158`; `vcs/engineTool.ts` |
| Erro "conjunto ocupado" e falha da etapa | `engine/contract.ts` (`ProviderBusyError`), `executor.ts:69` (`pool-busy`), `service.ts:682` |
| Troca dita na conversa | `AgentCall.onPool` em `agents.ts:1163`, `executor.ts` (`forum.append`), catálogos |
| Escolha no começo da etapa (SDK incluído) | `agents.ts:776`, `:1269`, `executor.ts:1131` |
| Leitor do catálogo, custo, piso por atividade | novos `src/shared/modelCatalog.ts`, `modelScores.ts`, `modelPools.ts`; `probe.ts`; `wizard.ts:131` |
| Eco do raciocínio por modelo | `client.ts:220,282`, `bridge.ts:38`, `pool.ts` |
| Interface | `ModelsStep.tsx`, novo `PoolEditor.tsx`, `team/TeamSection.tsx:485`, `agentEdit.ts:88-117` |
| Documentos | `docs/llm-providers.md` (PT :18, :87; EN :130, :199), `docs/configuration.md`, `docs/runner.md`, `CHANGELOG.md` |

## Dados

```ts
export const ACTIVITIES = ['explore', 'edit', 'shell', 'screen', 'write'] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** Uma entrada de conjunto: um modelo de um provedor cadastrado, com o que se sabe dele. */
export interface ModelRef {
  provider: string;           // LlmProvider id
  model: string;
  images?: boolean;           // este modelo aceita imagem (o provedor pode ter modelos que não)
  contextWindow?: number;
  echoReasoning?: boolean;    // devolver reasoning_content ao próprio modelo desde a primeira chamada
}
export interface ModelPool { fallbacks?: ModelRef[]; activities?: Partial<Record<Activity, ModelRef[]>> }
export interface RoleModel extends ModelRef, ModelPool {}      // provider/model = 1ª entrada do papel
export interface AgentModel { role, provider, model, ... } & ModelPool & Pick<ModelRef,'images'|'contextWindow'|'echoReasoning'>
export interface LlmConfig { providers; roles; scoreOverrides?: ScoreOverrides }
```

- **Por que `fallbacks` + `activities` e não uma lista só.** `provider`/`model` continuam sendo a primeira entrada, então todo código que lê `llm.roles[r].model` segue certo (`wizard.ts:modelFor`, `saude.ts:200`, `recommendRoles`). `fallbacks` são as reservas do papel; `activities[a]` é uma lista **completa** (a primeira entrada pode ser outra), que substitui a do papel naquela atividade.
- **`images`, `contextWindow` e `echoReasoning` por entrada.** `ProviderCapabilities` é do provedor (`types.ts:40`), mas um provedor mistura modelos com e sem imagem; o filtro de `screen` precisa do fato por modelo. A sugestão os preenche do catálogo; sem eles vale o do provedor.
- **`AgentModel` com `role` preenchido ignora os campos** (usa o conjunto do papel); a validação avisa se vierem juntos.
- **`scoreOverrides`** = `{ floors?: Partial<Record<ScoredActivity, number>>; models?: Record<string, Partial<Record<ScoredActivity, number>>> }`, `ScoredActivity = 'shell'|'edit'|'screen'`. É o jeito de a pessoa sobrescrever a tabela que o app traz.
- **Limites (schema e `validate.ts`):** até 8 entradas por lista; sem repetir provedor+modelo na mesma lista; provedor tem de existir (erro); `contextWindow` inteiro de 1.000 a 10.000.000; `scores` de 0 a 100; aviso se a entrada de `screen` tem `images === false`. Campos inválidos são repostos pelo neutro (`repair`), nunca travam o workspace.
- **Formato do run não muda** (`RUN_VERSION` 6 fica). O modelo de cada resposta já é gravado em cada linha `msg` da sessão (`session.ts:19-23`, `loop.ts:259-262`); a troca e a falha de conjunto vão para a conversa (que é do run, mas texto) e para a linha `meta` da sessão (uma linha `switch` nova do `.jsonl`, que não faz parte do run). Pôr `model` em `StageUsage` (`runs/types.ts:84`) exigiria subir o formato do run para 7 e o teste de recusa, por um dado que a sessão e a conversa já guardam.

## Configuração e migração

- `CONFIG_SCHEMA_VERSION` 24 → **25** (`types.ts:5`). `v24ToV25` em `migrations.ts` só sobe a versão e deixa uma nota ("model pools were added; absent = no fallbacks"), no padrão da v20→v21. Entra em `STEPS` (`:379`) e o comentário do cabeçalho de `types.ts:1` passa a "schema 25". Sem a subida, um app que não conhece os campos os repararia e regravaria (`config-schema.md`, regra 3).
- **Nenhum passo sobe permissão.** Sem `fallbacks` nem `activities` o comportamento é idêntico; o conjunto só existe depois que a pessoa o salva.
- `types.ts`, `defaults.ts`, `schema.ts` e `validate.ts` precisam concordar (`test/config-schema.test.ts`); o neutro não traz nenhum dos campos (ausente = sem reservas), como `screen`.
- **Deriva a corrigir ao passar:** a rule `config-schema.md` diz esquema 23 e a tabela de `docs/configuration.md` (:15 PT, :167 EN) diz `schemaVersion: 22`, mas o código está em 24. A tabela do doc vai para 25; a rule fica para o mantenedor (vive fora do repositório).
- Colisão: nenhuma branch remota aberta está acima de 24 hoje (conferido); reconferir antes do pull request.
- `transfer.ts`/`templateFromConfig` (`apply.ts`): um modelo de ciclo **não** leva `fallbacks` nem `activities` (não é permissão, mas é endereço de provedor); conferir e travar com teste.

## Fluxo

**Resolução.** `rc().role(r)` e `rc().agentModel(m)` ganham `pool?: { fallbacks: ResolvedRole[]; activities: Partial<Record<Activity, ResolvedRole[]>> }` dentro de `ResolvedRole` (ausente sem reservas, então nada muda para quem não usa). Cada entrada passa por `target()` (`:124`), que já lança se o provedor não existe.

**Cliente do conjunto (`PoolClient`, em `pool.ts`).** O laço (`loop.ts`) hoje recebe um `client` e um `capabilities` (`:64`, `:284`, `:302`, `:361`). Passa a receber um `ModelPool` normalizado: sem reservas, um conjunto de um membro (o mesmo comportamento). `PoolClient.complete(opts, activity)`:
1. monta a lista de candidatos da atividade (lista da atividade, ou a do papel; uma ferramenta sem etiqueta usa a do papel);
2. filtra por capacidade: `screen` exige `images !== false` (entrada, depois provedor); o resto, `tools !== false` quando a sessão tem ferramentas e janela suficiente para o histórico atual;
3. **fica onde está**: se o membro em uso está na lista da atividade e não descansa, usa-o (evita perder o cache por uma mudança de atividade); senão, o primeiro da lista que não descansa; depois os anteriores cujo descanso acabou;
4. chama o cliente do membro (as repetições dele continuam: `maxRetries ?? 2`). Em `rate_limit`, `overloaded` ou `server` (5xx) esgotados (decisão 3 da spec; `timeout` não troca): `rest(chave, err.restMs ?? 5 min)`, evento de troca, próximo candidato. `no_tools` num membro que não é o primeiro tira o membro da sessão. Outro erro sobe como hoje (`context` ainda faz a compactação do laço);
5. esgotados: `ProviderBusyError` com o nome do conjunto, os modelos e quando o primeiro volta.

Antes de chamar um membro com `images === false`, as imagens do histórico passam por `withoutImages` (`errors.ts:183`). A compactação do laço (`loop.ts:361`) lê a janela do membro que **vai** responder (`peek`).

**Classificação da atividade.** `ToolImpl` ganha `activity?: Activity`: `explore` em `Read`, `Grep`, `Glob`, `Skill`, `Agent`, `VcsRead`; `edit` em `Write`, `Edit`; `shell` em `Bash` e `Shell`; `screen` nas ferramentas do navegador do app, `screen_confirm`, `screen_handoff` e `ViewImage`. Sem etiqueta (MCP, evidência, release, anexos, procedimentos): conjunto do papel. `activityOf(tools, hadImages)` é pura: ignora as sem etiqueta; resultado com imagem (qualquer ferramenta) é `screen`; precedência **screen > edit > shell > explore**, porque o turno tem de poder responder ao resultado mais exigente. O primeiro turno, uma mensagem entregue pela porta e as chamadas de fechamento da resposta (`loop.ts:456`, `:552`) são `write`. Um subagente (`runAgent` do laço) começa em `explore`.

**Descanso.** `rest.ts` guarda `Map<chave, até>`; a chave é `baseUrl|modelo|secretRef` (a identidade real do que recusa; o mesmo cuidado de `clientFor`, `bridge.ts:38`). `EngineError` ganha `restMs` (o `Retry-After` sem o teto de 60 s do `retryAfterMs`, com teto de 15 min; `errors.ts:80`); o `retryAfterMs` de 60 s segue valendo para o sono do cliente. Sem cabeçalho: 5 min. Na memória; `clear()` para os testes.

**Eco do raciocínio por modelo.** Hoje o cliente tira `reasoning_content` a menos que `learned.echoReasoning` seja verdadeiro, e só o aprende depois da **primeira resposta** que trouxe o campo (`client.ts:220`, `:282`); reiniciar o app esquece, e a primeira rodada de um modelo que exige o eco já sai sem ele. Passa a ser: `ProviderConfig.echoReasoning` semeia `learned.echoReasoning` ao criar o cliente; `bridge.ts` o lê da entrada (`echoReasoning`), e a chave de `clientFor` passa a incluí-lo. Quem grava a marca é a interface (o catálogo traz a etiqueta `reasoning`, ou o teste detectou raciocínio). O que o cliente aprende em execução continua valendo no processo. Para a troca: o laço carimba cada mensagem do assistente com a chave do membro que a escreveu (`WeakMap` em `PoolClient`); ao montar o pedido para o membro M, o `reasoning_content` carimbado por **outro** membro é descartado, mesmo que M ecoe. Mensagem sem carimbo (sessão retomada) conta como do próprio, como hoje.

**Escolha no começo da etapa.** `runAgent` (`agents.ts:1269`) e `runOnce` (`:776`) escolhem o alvo inicial na lista `write`: o primeiro membro que não descansa (e, numa rodada retomada, do motor que guarda a sessão, `:1273`). Entrada do SDK só vale aqui. Uma recusa do SDK por taxa ou sobrecarga lida do texto (`readTextRefusal`, `budget.ts`, `agents.ts:732`) que **não** é orçamento faz o membro descansar; se ainda não houve nenhum uso de ferramenta, a chamada recomeça no próximo membro; depois disso a tentativa falha como hoje. `runAgent` devolve também o motor que respondeu, e `executor.ts:1131` usa esse (hoje assume o do primeiro modelo).

**Falha.** `ProviderBusyError` (como `ProviderBudgetError`, `contract.ts`) vira `StageError('pool-busy', { pool, models, until })` no executor (`:1185`, ao lado de `budget`), com `main.runner.error.pool-busy` nos dois catálogos; `service.ts:682` o trata como falha comum (há "Tentar de novo"). Em cerimônia, a mensagem sobe como a de hoje, citando o conjunto.

**Mensagens.** `AgentCall.onPool?(e)` (evento `{ from, to, reason, until, activity }`), ligado pelo executor a `forum.append(thread, { kind:'system', code:'runner.model.switched', ... })` (padrão de `runner.artifactStray`, `executor.ts:1283`) e pelas menções/conversas ao mesmo código; cerimônia sem conversa usa `activity.text`. Chaves: `main.forum.code.runner.model.switched` (ocupado + assumiu + até quando), `...runner.model.allBusy`, `main.runner.error.pool-busy`; sem a palavra proibida do teste de voz.

## Catálogo, custo e piso por atividade (puro, em `src/shared/`)

- `modelCatalog.ts`: `parseCatalog(raw: Json[]): CatalogModel[]` com `{ id, contextWindow, price: { input, output, cacheRead|null }|null, vision, tools, structured, reasoning, cache }`, cada fato `boolean|null` (null = não sabido). Lê `metadata.context_length`, `metadata.pricing.{input_tokens,output_tokens,cache_read_tokens}` (US$ por milhão) e `metadata.tags` (`vision`, `prompt_cache`, `reasoning`; `tools`/`structured-output` só se vierem). **Segundo leitor (decisão 6):** o formato de agregador, detectado pela forma (`pricing.prompt`/`pricing.completion`/`pricing.input_cache_read` em US$ por token, como texto; `context_length` na raiz; `architecture.input_modalities` com `image`; `supported_parameters` com `tools`, `structured_outputs`/`response_format`, `reasoning`). Converte para US$ por milhão. Escrito pela documentação pública, com comentário de "não conferido contra o serviço" e teste só com fixture neutra. Sem nenhum dos dois formatos, o modelo entra com tudo `null`.
- `estimateStageCost(m, profile)`: `profile = { cachedIn: 2.05, freshIn: 0.06, out: 0.0157 }` (milhões de tokens, de uma etapa de implementação real). Custo = `cachedIn × (cacheRead ?? input) + freshIn × input + out × output`. Sem preço: `null`, ordena por último. Exemplo de teste: entrada 0,30, saída 1,20, cache 0,06 → 0,15984; entrada 0,10, saída 0,40, sem cache → 0,21728 (o de preço de lista menor fica atrás).
- `modelScores.ts`: **dados versionados** (`SCORE_TABLE_VERSION`, `FLOORS` por atividade, `ENTRIES: { names: string[]; scores: Partial<Record<ScoredActivity, number>>; source: string }[]`), com a fonte nomeada ("autodeclarado pelo fornecedor", nome do teste e versão). Casamento pelo id normalizado (minúsculas, sem prefixo de organização, sem sufixo de variante). Nunca buscada em rede; nenhuma chamada a endereço de provedor. Conteúdo inicial e pisos: decisão 1 da spec (shell 85, edit 65, screen 70; três modelos, a fonte de cada nota nomeada, o GLM marcado como comparativo de terceiros).
- `modelPools.ts`: `rankForActivity(models, activity, opts)` e `suggestPools(catalog, opts)`. Elegível: `tools !== false`, `structured !== false`, contexto ≥ 32.000 (conhecido; decisão 5), e para `screen` `vision === true`. Ordem: (1) com nota ≥ piso, por custo; (2) com nota < piso, por custo (ou fora, com `dropBelowFloor`); (3) sem nota (`edit`, `shell`, `screen`), por custo; `explore` e `write`: só custo. Empate: id. Notas e pisos já passam pelo `scoreOverrides`. Devolve para cada modelo `{ ref, cost, score, source, unverified: ('tools'|'structured')[] }`. Resultado: um conjunto por papel (a lista de `write`) mais uma lista por atividade quando difere da do papel.
- **Teste de conexão.** `probe.ts:75-86` guarda `raw` do `listModels`, chama `parseCatalog` e põe `catalog` (até 300) no `ProbeResult`; `testOpen` (`wizard.ts:131`) o repassa em `ProviderTestResult.catalog` (`shared/wizard.ts:225`). O que o probe verifica (ferramentas, `json_schema`, imagem, raciocínio) vale **só para o modelo testado** e fica gravado nele; os outros ficam `null` e marcados "não verificado" até a pessoa usar o botão "Testar este modelo" (o `testProvider` de hoje, por modelo). Ninguém chama o modelo em massa.

## Interface

- `PoolEditor.tsx` (novo, usado nos dois lugares): lista ordenada com subir/descer/remover, seletor de provedor + campo de modelo com `datalist` (como `ModelsStep.tsx:333`), e por linha o preço, o contexto e a nota com a fonte ("90,6 · Terminal-Bench 2.1, autodeclarado"). Cinco `<details>` por atividade, vazios = "usa a lista do papel". Tokens de tema; `aria-label`s por `t()`.
- `ModelsStep.tsx` (`:318-345`): `PoolEditor` abaixo do seletor de cada papel; quadro "Conjunto sugerido" depois do `TestResultView` (`:35-61`) com "Usar a sugestão" (só muda `cfg` em memória; o salvar é o do assistente, `wizardApi.save`), edição do piso e das notas (grava `scoreOverrides`) e "Testar este modelo".
- `TeamSection.tsx:485` / `agentEdit.ts:88-117`: com modelo próprio, o mesmo `PoolEditor`; `fieldsOf` grava `fallbacks`/`activities` só quando há (ausente = sem reservas, como `screen`); `agentProblems` valida provedor e repetição.
- Chaves novas nos dois catálogos (`wizard.pool.*`, `wizard.activity.<atividade>`, `ui.team.pool.*`); a família `wizard.activity.` entra em `FAMILIES` de `test/wizard-i18n.test.ts`. Sem cor literal.

## Ordem dos commits

Cada um passa em: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`. Mensagens em inglês, minúsculas, imperativo.

0. **`feat: add the spec and plan for model pools`** — só `docs/cycles/213-…/`. Gate 1 (spec) e gate 2 (plano) esperam o mantenedor.
1. **`fix: count a retry-after as an attempt in the open client`** — `client.ts:270` (`const wait = err.retryAfterMs ?? delay * 2 ** transient; transient++`). Teste em `engine-open-client.test.ts`: 429 com `Retry-After: 0` repetido para sempre faz exatamente `maxRetries + 1` chamadas e termina em `rate_limit`; o caso sem cabeçalho não muda. CHANGELOG › Fixed.
2. **`feat: add model pools to the config`** — `types.ts`, `defaults.ts`, `schema.ts`, `validate.ts`, `migrations.ts` (`v24ToV25`), `config-resolve.ts` (`pool`), `docs/configuration.md`. Testes: `config-schema` (aceita, recusa tipo errado, neutro sem os campos), `config-migrations` (v24→25 só sobe a versão e mantém o resto; 26 recusado; v1→atual), `config-resolve` (conjunto resolvido; provedor inexistente lança), `config-transfer`/`cycle-templates` (modelo não leva reservas), `team-agent-edit`.
3. **`feat: rest a busy model across the app`** — `rest.ts`, `EngineError.restMs` (`errors.ts`), `ProviderBusyError` (`contract.ts`), `pool.ts` só com as funções puras: candidatos, ficar onde está, `activityOf`, filtros. Testes `engine-open-rest.test.ts`, `engine-open-pool-pure.test.ts` (relógio injetado: descanso por `Retry-After`, padrão de 5 min, teto de 15; precedência das atividades; `screen` filtra sem imagem; fica onde está).
4. **`feat: switch models inside an open-engine session`** — `PoolClient`, `loop.ts`, `bridge.ts`, `agents.ts` (`openSelection`), etiquetas `ToolImpl.activity`, linha `switch` da sessão, `echoReasoning` por modelo e o carimbo de mensagens, `pool-busy` no executor e nos catálogos. Testes (`fakeOpenAI` com dois servidores): ocupado no primeiro → termina no segundo com a mesma sessão e o histórico inteiro; segundo corpo contém as mensagens do primeiro; cooldown pulado numa segunda execução; todos ocupados → `ProviderBusyError`/`pool-busy` com o nome do conjunto; captura de tela só vai a modelo com imagem; `no_tools` fora do primeiro; eco: mesmo modelo devolve o `reasoning_content`, modelo trocado não; cliente semeado ecoa na primeira chamada; sem reservas o comportamento é o de `engine-open-loop`/`runner-agent-open`, inalterados.
5. **`feat: say every model switch in the run thread`** — `AgentCall.onPool`, `executor.ts`, `mentions/answer.ts`, `activity` das cerimônias, chaves `main.forum.code.runner.model.*`, `docs/runner.md` (seção da etapa, PT e EN). Testes: `runner-lifecycle`/`runner-agent-open` (mensagem na conversa com os dois modelos e a hora), `i18n`, `main-catalogs`, `gitlab-catalogs-unchanged` (chave nova fora do snapshot), `host-terms-leak`, `voice-terminology`.
6. **`feat: pick the model of a stage start from the pool`** — `agents.ts` (`runAgent`, `runOnce`), SDK incluído, recusa por texto, `engine` devolvido, `executor.ts:1131`. Testes: início pula o que descansa; rodada retomada fica no motor da sessão; recusa 429 do SDK antes de ferramenta passa ao próximo, depois falha; orçamento esgotado continua sendo espera (`budget`).
7. **`feat: read pricing and capabilities from the provider catalog`** — `modelCatalog.ts`, `modelScores.ts`, `modelPools.ts`, `probe.ts`, `wizard.ts`, `shared/wizard.ts`. Testes `model-catalog.test.ts`, `model-pools.test.ts`, `engine-open-probe.test.ts` com fixtures neutras (`model-a`, `model-b`, `example.com`): custo (os dois exemplos acima), cache ausente, piso por atividade (A 90,6 contra B 87,6 com B mais barato: A primeiro em `shell`/`edit`; `screen` só com imagem; sem nota depois; `explore` por preço), sobrescrita, contexto mínimo, `tools` nulo marcado, catálogo vazio ou fora de formato não derruba o teste.
8. **`feat: review and save a model pool in the wizard`** — `PoolEditor.tsx`, `ModelsStep.tsx`, `wizard.pt-BR.json`/`wizard.en.json`, `test/wizard-i18n.test.ts`, `docs/llm-providers.md`, CHANGELOG › Added. Testes: `wizard-core`, `wizard-shared`, novo `pool-editor.test.ts` (funções puras de edição: mover, remover, repetição, "usar a sugestão" não salva), `wizard-i18n`, `i18n`, `theme-audit`.
9. **`feat: edit the model pool of an agent`** — `TeamSection.tsx`, `agentEdit.ts`, `ui.pt-BR`/`ui.en`. Testes `team-agent-edit` (ausente quando vazio, valida), `agent-roles`, `config-web-scope` (o celular não edita).

## Plano de teste

Arquivos afetados: `engine-open-client`, `engine-open-loop`, `engine-open-e2e`, `engine-open-probe`, `runner-agent-open`, `runner-agent`, `runner-lifecycle`, `config-schema`, `config-migrations`, `config-resolve`, `config-transfer`, `cycle-templates`, `team-agent-edit`, `wizard-*`, `i18n*`, `main-catalogs`, `host-terms-leak`, `voice-terminology`, `gitlab-catalogs-unchanged`. **Goldens de prompt não mudam** (nenhum texto enviado ao modelo é tocado; o prompt do sistema e as ferramentas só ganham um campo interno). Nenhum teste chama a rede: servidores falsos de `test/helpers/fakeOpenAI.ts` (`Step.headers` já aceita `retry-after`; `opts.models` já devolve `metadata`). Verificação manual da etapa de teste, com chave de verdade e `CERIMONIAS_DATA_DIR` vazio: dois modelos de um provedor, o primeiro forçado a recusar, a conversa e o `.jsonl`.

## Riscos

| Risco | Como é coberto |
|---|---|
| Janela menor no reserva: o histórico não cabe | O filtro olha a janela conhecida; o `context` do servidor cai na compactação do laço (`loop.ts:385`); sem janela conhecida, tenta. |
| Id de chamada de ferramenta ou formato de `tool_calls` diferente entre servidores | Mesmo provedor, mesmo formato; entre provedores o ChatClient já normaliza (`ChunkFolder`); teste com dois servidores falsos. **Não verificado** contra dois servidores reais. |
| Perda do cache a cada troca (uma etapa real: ~2 M de tokens de entrada em cache) | "Fica onde está" por atividade; sem voltar ao mais barato na sessão (pergunta 2); o custo estimado mostra a diferença. Trocar de modelo por atividade perde o cache do mesmo jeito: só vale quando as listas diferem. |
| Raciocínio de um modelo enviado a outro | Carimbo por mensagem e descarte; teste. |
| Eco na primeira chamada contra servidor que recusa o campo | Só com a marca da entrada; o 400 hoje cai em `adaptBodyForError` (`errors.ts`), que não aprende a tirar o campo: **conferir** e, se preciso, soltar o eco no primeiro 400. |
| Parâmetros aprendidos por cliente (`learned`) | Um cliente por provedor+modelo (`bridge.ts:38`), cada membro com o seu; a chave inclui o eco. |
| Vai e vem entre dois modelos (flapping) | Descanso mínimo (padrão de 5 min), sem retorno na sessão; o `Retry-After` curto descansa pouco. |
| O descanso esconde um erro permanente (modelo some) | Só `rate_limit`/`overloaded` descansam; `not_found` sobe como hoje. |
| Notas autodeclaradas induzem a escolha | Fonte e "autodeclarado" ao lado da nota; a pessoa reordena e sobrescreve; a tabela é dado, não código. |
| Catálogo de outro provedor sem `metadata` | Tudo `null`, nada é sugerido além de "adicionar à mão"; teste. |
| `ToolImpl.activity` esquecido numa ferramenta nova | Teste lista todas as ferramentas de `buildTools` e exige etiqueta ou isenção explícita. |
| Subagente herda o conjunto e troca de modelo no meio do trabalho do pai | Compartilha o `PoolClient` e a posição; teste. |
| Importar uma config com reservas aponta uso de outro provedor | Os provedores já são listados na prévia (`transfer.ts:185`); conferir se basta. **Não verificado.** |
| O SDK pode refazer a chamada com texto de 429 diferente | `readTextRefusal` só reconhece o que já reconhece; fora disso falha como hoje. |

## Registro de decisões

| Decisão | Alternativa rejeitada |
|---|---|
| Conjunto por papel, `provider`/`model` como 1ª entrada, `fallbacks`/`activities` opcionais | Conjunto global (decidido pelo mantenedor); lista única `models[]` (quebraria todo leitor de `llm.roles[r].model`) |
| Troca dentro do laço, por um cliente do conjunto | Trocar fora, relançando a etapa (perde a sessão e o trabalho) |
| `images`/`contextWindow`/`echoReasoning` por entrada | Só o do provedor (um provedor mistura modelos com e sem imagem) |
| Fica onde está quando o membro serve à atividade | Sempre o primeiro da lista da atividade (perde o cache a cada mudança de atividade) |
| Descanso na memória, chave `baseUrl\|modelo\|secretRef` | Em disco (estado que sobra de um erro de ontem); por id de provedor do workspace (outro workspace com a mesma chave não vê) |
| Não subir `RUN_VERSION`; modelo na sessão e na conversa | `model` em `StageUsage` (formato 7 por um dado que já existe) |
| Piso por atividade vindo de tabela versionada que o app traz, sobrescrita pela pessoa | Buscar notas na rede ou no endereço do provedor (fora do desenho, e específico dele); ordenar só por preço |
| Sugestão lê só o `/models` | A listagem específica do provedor |
| Eco do raciocínio por entrada, descartado ao trocar de modelo | Eco global do provedor; reaproveitar o raciocínio entre modelos |
| `pool-busy` é falha comum, com "Tentar de novo" | Espera como a de orçamento (o descanso é curto; a espera esconderia o problema) |
| `v24ToV25` só sobe a versão | Deixar o campo opcional sem passo (um app antigo repararia e regravaria o bloco) |

# Parte 2: modos de uso do conjunto

Conferido em `wt-213` (`8c687829`, `feat-model-pool`). Escopo: os três modos da seção "Modos de uso do conjunto" da spec. Nada foi executado; o que não foi conferido está em **Riscos da parte 2**.

## O que o código mostra e muda o desenho

1. **O subagente de hoje não é somente leitura.** `runAgent` do laço (`loop.ts:297-318`) repassa `...p` (ferramentas extras, `writeRoot`, hooks, `events`, `docs`) e só tira `Agent` da lista; "read-only" é só o texto da descrição (`loop.ts:177-180`). Delegar por tipo é, portanto, **restringir** (filtro por `ToolImpl.activity`), não ampliar.
2. **`Agent` não é oferecido a quem escreve.** Com `confine`, `toolsOf` devolve só `Read, Grep, Glob, Edit, Write` (`agents.ts:1278-1283`); `allowedFor` dá `Agent` só com `tools.subagents` e papel `deep` (`agents.ts:82`). Delegar exige oferecê-la, e só no motor aberto (no SDK, `Agent` é outra ferramenta).
3. **O uso já soma.** `events` herdado dispara `onUsage` do pai (`agents.ts:589`); o `usage` do resultado é descartado por `bridge.ts` (`runOpenOnce` devolve só `data`, `sessionId`, `sources`). Nada a construir; um teste trava a soma.
4. **Nenhum golden grava o texto de `Agent` nem o prompt de sistema do motor aberto.** `test/golden/*.json` só trazem o nome `Agent` na lista do SDK; só `engine-open-loop.test.ts:460` e `engine-open-pool.test.ts:288` usam a ferramenta. **Os goldens de prompt não mudam**, desde que o texto novo entre no `loop.ts` (`append` de `buildSystemPrompt`), não no `system` do runner, e que sem lista de atividade nada mude. O que muda: o teste de ferramentas/e2e de `delegate` (novos).
5. **A tela é do run, não do agente que a usa.** `screenToolImpls(req.screen)` (`agents.ts:562`) são fechos sobre a sessão da etapa (`run:<id>`); o subagente os herda e **não abre sessão** (rule `agent-screen`, item 7: uma chave por sessão). O intermediário atende uma chamada por vez, e espera, passe, entrega (`screen_handoff`) e máscara valem iguais. Logo `screen` fica no subagente; sem sessão aninhada.

## O que será construído

| Funcionalidade | Onde cai |
|---|---|
| Tipo, resolução pura (agente > etapa > workspace > `delegate`) e `effectivePoolMode` | novo `src/shared/config/poolMode.ts`; `types.ts` (`POOL_MODES`, `LlmConfig.poolMode`, `AgentDef.poolMode`, `StageDef.poolMode`) |
| Esquema, defaults, reparo | `schema.ts` (`stage` :136-162, agente :271, `llm` :433), `defaults.ts`, `migrations.ts:402` (`POOL_KEYS`/`poolKeyAt`), `validate.ts` (nada novo: o enum do esquema basta) |
| Modelo de ciclo | `apply.ts:68,112` (o modo do agente e da etapa **viaja**, não é endereço), `flowFile.ts`, testes |
| Modo até o laço | `EngineRequest.poolMode`, `AgentCall.stagePoolMode` (`agents.ts:1213`), `runAgent` (:1321) e `runOnce` (:822) resolvem; `openSelection` (:507) → `SelectionPool.mode` → `OpenPool.mode` (`bridge.ts:30,89`); `executor.ts:1136` e o `round` (:695) levam `stage.poolMode` |
| Roteamento fixo | `PoolClient` (`pool.ts`): `route: 'activity' \| 'fixed'` |
| `Agent` por tipo | `loop.ts:174-198,297-318`; `OpenRunParams.kinds`; novo `src/main/engine/open/subagent.ts` (tabela de tipos, filtro, trava, texto) |
| Oferecer `Agent` a quem escreve; aviso no prompt | `agents.ts:1278,1330-1344` (no `withPool`, com `picked.engine === 'open'`); `loop.ts:381` (`append`) |
| Aviso na conversa | `contract.ts:109-125` (`PoolNotice.reason: 'delegate'`), `poolNoticeCode` → `runner.model.delegated`; catálogos |
| Interface | `ModelsStep.tsx` (padrão), `TeamSection.tsx:556` (agente), `StagePanel.tsx:207`/`flowEdit.ts` (etapa); `ui.*`, `wizard.*` |
| Documentos | `docs/runner.md`, `docs/llm-providers.md` ("Conjunto de modelos"), `docs/configuration.md`, `docs/cycles.md` (tabela de campos da etapa :82 PT, :335 EN), `CHANGELOG.md` |

## Dados e esquema

```ts
export const POOL_MODES = ['fallback', 'switch', 'delegate'] as const;
export type PoolMode = (typeof POOL_MODES)[number];
export const DEFAULT_POOL_MODE: PoolMode = 'delegate';
// LlmConfig.poolMode?  (padrão do workspace)   AgentDef.poolMode?   StageDef.poolMode? (só etapa de trabalho)
export function resolvePoolMode(s: { agent?: PoolMode; stage?: PoolMode; workspace?: PoolMode }): PoolMode  // agent ?? stage ?? workspace ?? DEFAULT
export function effectivePoolMode(mode: PoolMode, lists: Partial<Record<Activity, unknown[]>>): PoolMode    // sem lista de explore/edit/shell/screen: 'fallback'
```

- **Esquema 25, sem segundo salto.** O 25 ainda não saiu: a `0.9.0-beta.12` está em 24 (`git show a1a7e6f7:src/shared/config/types.ts`), e o `[Unreleased]` do CHANGELOG já descreve o 25. A regra 3 de `config-schema.md` pede um passo quando o arquivo guardado não pega o campo sozinho e quando um app que não o conhece repararia e regravaria o bloco; os dois casos já são cobertos pela subida 24→25 (`v24ToV25`, `migrations.ts:381`), e nenhum arquivo gravado como 25 existe fora desta branch. Os três campos entram **no mesmo passo**; só a nota da migração (`:382`) ganha "and the pool mode". Nenhum passo sobe permissão (regra 5): o campo não é permissão.
- **"Ausente = `delegate`" por `withConfigDefaults`.** `defaults.ts` põe `llm.poolMode: 'delegate'` no neutro (workspace novo grava; o existente o recebe em memória, `config-schema.md`, seção `withConfigDefaults`). No tipo o campo é opcional e toda leitura passa por `resolvePoolMode`, então uma config montada à mão num teste segue valendo. `AgentDef.poolMode` e `StageDef.poolMode` ficam **ausentes** (= herda); `newAgent` só grava quando presente (como `screen`, `team.ts:59-61`).
- **Por que `llm.poolMode` e não `runner.*`.** O conjunto mora em `llm` (`roles`, `scoreOverrides`); as cerimônias leem o modo e `runner.*` é do run; o passo "Modelos" já edita `llm`. Fora de `WEB_EDITABLE`, o celular não o muda sem código novo.
- **Reparo.** `POOL_KEYS` ganha `poolMode`, e `poolKeyAt` reconhece `llm.poolMode`, `agents.team[i].poolMode` e `devCycle.stages[i].poolMode`: um valor inválido é descartado sozinho, nunca o bloco ao redor (padrão do commit 2).
- **Modelo de ciclo.** `applyTemplate`/`templateFromConfig`/`parseTemplate` (`apply.ts:68,112,186-210`) não tiram o campo: modo não é endereço de provedor nem permissão, e o conjunto continua sem viajar. `devCycle.stages` é validado pelo mesmo esquema, então a etapa com `poolMode` passa por `parseTemplate`. O formato do arquivo de modelo não muda (campo opcional).
- **Celular (`paired-phone.md`).** `agents.team` e `devCycle.stages` já estão em `WEB_EDITABLE` (`configScope.ts:15-18`): o celular muda o modo de um agente e de uma etapa. Não dá alcance: o subagente usa o subconjunto das ferramentas do principal e as listas que a pessoa salvou no computador (`poolRaised` continua recusando entrada nova). `llm.poolMode` fica negado por não estar na lista. Travar com teste em `config-web-scope`. `RUN_VERSION` fica 6 (nada de modo no run).

## Fluxo

**Do config ao laço.** `runAgent` resolve `resolvePoolMode({ agent: call.agent.poolMode, stage: call.stagePoolMode, workspace: getConfig().llm.poolMode })`; `runOnce`, `{ agent: <agente de sistema do papel>?.poolMode, workspace }` (`agents.ts:836` já o acha). `openSelection(t, cwd, isolated, bare, mode)` guarda o modo em `SelectionPool.mode`, e o `bridge` em `OpenPool.mode`. **No motor, `mode` ausente em `OpenPool` vale `switch`** (os testes dos commits 4–9 montam `OpenPool` sem modo e continuam valendo); o app sempre o escreve. O laço calcula `effectivePoolMode(mode, <listas de atividade do conjunto>)` uma vez.

**`fixed` (fallback e delegate, para o principal).** `new PoolClient(primary, pool, { route: 'fixed' })`: os candidatos são os da **lista `write`** (a de `write` se existe, senão a do papel, `listFor(lists,'write')`) com o filtro de capacidade da atividade **real** (`eligible(list, need)`; volta de `screen` só em quem não é `images === false`, e sem nenhum que veja cai na mesma lista, como hoje); `fits` é sempre verdadeiro (sem piso); fica no modelo em uso enquanto ele não recusa; ocupado → descanso e próximo da lista, com o aviso `switched` de hoje. `pooled` olha só essa lista (um modelo só continua passagem direta). Em `fixed` a lista `write` é a do principal em todo modo; as listas das outras atividades só servem aos subagentes. `switch` não muda uma linha. O começo da etapa (`modelPick.startList`) já usa a lista `write`; fica como está.

**`delegate`: a ferramenta `Agent`.** `buildTools` recebe o modo efetivo e as listas. Tipos oferecidos (`kind`, enum **dinâmico**, constante na sessão): `explore` sempre; `edit`, `shell`, `screen` se `pool.activities[a]` existe **e** o principal tem ao menos uma ferramenta com aquela `ToolImpl.activity`. Esquema: `description`, `prompt`, `kind` (obrigatório em `delegate`), `subagent_type` (igual). Descrição em inglês, no `loop.ts` com `i18n-ignore`; esboço: "Hands a task to a sub-agent of the given kind, which starts with an empty history, has only the tools of that kind and returns only its final answer. Write the complete task: it sees nothing of this conversation. kind: explore (read and search), edit (change files), shell (run commands), screen (the virtual screen)." Um `kind` fora do enum é recusado pela checagem de argumentos que já existe (`badArgs`, lista os valores); `run` repete a checagem com mensagem própria.

| `kind` | Ferramentas (por `ToolImpl.activity`, `tools/types.ts`) | Voltas |
|---|---|---|
| `explore` | `explore`: `Read`, `Grep`, `Glob`, `Skill`, `VcsRead` | 12 (como hoje) |
| `edit` | `explore` + `edit`: `Write`, `Edit` (só existem se o principal as tem: `writeRoot`) | 30 |
| `shell` | `explore` + `shell`: `Bash` ou `Shell` (sandbox ou computador, pela política do agente) | 20 |
| `screen` | `explore` + `screen`: ferramentas do navegador do app, `screen_confirm`, `screen_handoff`, `ViewImage` | 30 |

Sem etiqueta (MCP, evidência, release, anexos, procedimentos, `SendMessage`, `CallAgent`) fica no principal; nunca `Agent`. O filtro é `impls.filter(i => kindSet.has(i.activity))` **sobre as ferramentas que o principal já tem**, então a interseção é por construção; `hooks`, `writeRoot`, `writeReserved`, `isSecret` e `shellEnv` vêm de `...p` como hoje.

**Modelo do subagente.** `subagent.ts` monta `OpenPool` com `activities[a]` como lista (`fallbacks = lista.slice(1)`, `primary` = o primeiro com `tools !== false`) e chama `runOpen` com `client` e `capabilities` desse membro, `route: 'fixed'`, `depth + 1`, `sessionsDir: null`, `schema: undefined`. Sem `poolClient` do pai: ele tem o próprio `PoolClient`, com `onSwitch` ligado a `events.onSwitch` (a troca por ocupado dentro da lista se diz como hoje). `explore` sem lista própria usa o modelo do principal (como hoje). `switch` e `fallback` seguem compartilhando o `PoolClient` do pai.

**Concorrência e erro.** Uma corrente de promessas por laço serializa `edit`/`shell`/`screen`; `explore` roda solto (as chamadas do mesmo turno já correm em `Promise.all`, `loop.ts:534`). `OpenMaxTurnsError` do subagente vira erro de ferramenta (`main.engine.text.subTurns`: o tipo, as voltas, "o trabalho já feito em disco fica; divida a tarefa ou faça você") e não derruba o principal. Uma linha `sub` (tipo, modelo, voltas, tokens) vai ao `.jsonl` do principal (`session.ts`, ignorada por `messagesOf`).

**Prompt do principal** (só em `delegate` efetivo, em `append`, antes do `structuredNote`): delegar edição, comando e tela ao subagente do tipo certo, uma tarefa completa por vez, sem editar os arquivos que um subagente edita, e ler a resposta final dele em vez de refazer. Lista só os tipos oferecidos.

**Oferecer `Agent`.** No `withPool` de `runAgent`, `picked.engine === 'open'` e `mode` efetivo `delegate` e `tools.subagents` ligado (o `tools` que `toolsOf` devolve): `allowedTools` ganha `Agent`, também para quem escreve e sem a restrição ao papel `deep`. Cerimônia: `allowedFor` como hoje (só `deep`). `procedureOnly`/`bare`: nunca. A chave `tools.subagents` ("Subagentes na cerimônia de desbloqueio") passa a cobrir isto; os textos `ui.settings.tool.subagents.*` e `ui.team.tools.subagents.hint` dizem isso nos dois catálogos.

**Aviso.** O subagente que abre num modelo diferente do atual do principal dispara `PoolNotice { reason: 'delegate', from: principal, to: subagente, activity: tipo }`, uma vez por (tipo, modelo) na sessão (um aviso por subagente seria ruído). Código `runner.model.delegated`, chaves `main.forum.code.runner.model.delegated` e `main.engine.pool.delegated` nos dois catálogos (`engine-pool-notice.test.ts` exige os mesmos campos). Mesmo modelo: sem aviso.

## Ordem dos commits (a partir do 10)

Cada um passa em `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

10. **`feat: add the pool mode to the config`** — `poolMode.ts`, `types.ts`, `schema.ts`, `defaults.ts`, `migrations.ts` (nota e `POOL_KEYS`), `docs/configuration.md` (campos e histórico do 25). Testes: `config-schema` (aceita/recusa, neutro traz o padrão, isenção de deriva só para agente e etapa), `config-migrations` (v24→25 intacto, valor inválido descartado sozinho, em `llm`, agente e etapa), novo `pool-mode.test.ts` (precedência; `effectivePoolMode`), `cycle-templates` (o modo do agente e da etapa viaja e volta), `config-web-scope` (celular muda agente e etapa, não `llm.poolMode`), `team-agent-edit` (`fieldsOf` preserva).
11. **`feat: use a pool by mode in the open engine`** — `PoolClient.route`, `OpenPool.mode`, `SelectionPool.mode`, `openSelection`, `EngineRequest.poolMode`, `AgentCall.stagePoolMode`, `runAgent`/`runOnce`, `executor.ts`. Testes em `engine-open-pool` (`fallback`: volta de `shell` com lista de `shell` fica; ocupado passa à reserva; tela só em quem vê; `switch`: os testes de hoje sem mudança), `engine-open-pool-pure` (candidatos em `fixed`), `engine-seam`, `runner-agent-open` (o modo chega do agente, da etapa e do workspace).
12. **`feat: run a sub-agent of a kind on its own pool`** — `subagent.ts`, `loop.ts` (`Agent` com `kind`, trava, `OpenMaxTurnsError`, linha `sub`), `session.ts`, `main.engine.text.subTurns` nos catálogos. Testes (`fakeOpenAI` com dois servidores): subagente `shell` roda no segundo servidor, só com `Bash`/leitura, e o principal recebe só a resposta final; `edit` sem `writeRoot` não é oferecido; tipo fora do enum recusado; `edit` e `shell` simultâneos correm um de cada vez, `explore` juntos; ocupado na lista da atividade passa ao seguinte; uso soma uma vez (`onUsage`); `engine-open-activity` (todo tipo tem ferramenta etiquetada); `engine-open-loop` (sub-agente de hoje, sem `kind`, igual em `switch`/`fallback`).
13. **`feat: offer delegation to the agents of a run`** — `agents.ts` (`Agent` no `withPool`), o aviso no prompt, `PoolNotice.reason: 'delegate'`, `runner.model.delegated`, textos de `tools.subagents`. Testes: `runner-agent-open` (escritor com lista de `shell` recebe `Agent`, sem lista não; `tools.subagents` desligado não; motor Claude não), `engine-pool-notice`, `runner-lifecycle` (linha na conversa), `i18n`, `main-catalogs`, `gitlab-catalogs-unchanged`, `host-terms-leak`, `voice-terminology`, `runner-stage-screen` (subagente `screen` usa a sessão da etapa; `held` e entrega valem).
14. **`feat: choose how a pool is used`** — `ModelsStep.tsx` (três opções com a explicação, sob o conjunto), `TeamSection.tsx` (agente: "Usar o da etapa ou do workspace" + três), `StagePanel.tsx`/`flowEdit.ts` (etapa de trabalho), `wizard.*`/`ui.*`, `docs/runner.md`, `docs/llm-providers.md`, `docs/cycles.md` (PT e EN), CHANGELOG › Added (um parágrafo: o padrão `delegate`, que só age com lista por atividade). Testes: `team-flow-edit`, `team-agent-edit`, `team-pool-ui` e `pool-editor` (renderização nos dois idiomas), `wizard-i18n`, `theme-audit`.

## Plano de teste (resumo)

Arquivos afetados: `config-schema`, `config-migrations`, `config-web-scope`, `cycle-templates`, `engine-open-pool`, `engine-open-pool-pure`, `engine-open-loop`, `engine-open-activity`, `engine-seam`, `runner-agent-open`, `runner-lifecycle`, `runner-stage-screen`, `engine-pool-notice`, `team-*`, `wizard-i18n`, catálogos. Goldens: **nenhum muda** (item 4 acima). Sem rede (`fakeOpenAI`). Manual, na etapa de teste, com `CERIMONIAS_DATA_DIR` vazio e dois modelos de um provedor: uma etapa em `delegate` com lista de `shell`, a conversa, o `.jsonl` (linha `sub`) e a tela.

## Riscos da parte 2

| Risco | Como é coberto |
|---|---|
| Subagente sem o contexto do principal entrega pouco ou refaz leitura (qualidade e custo) | Tarefa completa exigida no texto da ferramenta e no prompt; `explore` primeiro; o custo da releitura é do modelo barato. **Não verificado com modelo de verdade.** |
| Subagente `edit` e o principal editando o mesmo arquivo no mesmo turno | Só os subagentes mutantes são serializados; o turno do principal corre em paralelo (`Promise.all`); o prompt manda não editar o que um subagente edita. Risco aceito, a verificar na etapa de teste. |
| Voltas pequenas para a tarefa (12/20/30 são propostas) | Erro claro devolvido ao principal, que divide ou faz; constantes em `subagent.ts`. |
| Sessão de tela aninhada | Não existe: a ferramenta é o fecho da sessão da etapa; um teste prende que o subagente não abre outra. Um `screen_handoff` do subagente segura o principal (a chamada espera dentro da ferramenta). |
| **`delegate` por padrão muda comportamento de workspace existente** | Só age com lista por atividade (`effectivePoolMode`); o recurso não saiu, então nenhum workspace publicado tem lista e atualizar não muda nada. Quem salvar uma lista de atividade passa a ter `delegate` (e a ferramenta `Agent` para quem escreve) sem escolher: o texto do passo "Modelos" e o CHANGELOG dizem isso. |
| `tools.subagents` desligado deixa `delegate` inerte sem a pessoa saber | A interface do agente mostra "Subagentes desligado: o modo vale só reserva" (chave nos dois catálogos). |
| Ferramentas sem etiqueta (MCP de tracker) deixam de chegar ao subagente `explore` | Mudança de hoje (herdava tudo); só em `delegate` efetivo. VcsRead cobre a leitura do host. Aviso na doc. |
| Lista de atividade com modelo sem ferramentas ou sem imagem | `eligible` e `tools !== false` já filtram; o subagente de `screen` numa lista sem imagem cai na lista do papel (como hoje). |
| `PoolClient` em `fixed` e `pooled` com listas só de atividade | `pooled` olha só a lista do principal; um teste cobre o modelo único com listas de atividade. |

## Registro de decisões da parte 2

| Decisão | Alternativa rejeitada |
|---|---|
| Os três campos entram no 25 ainda não publicado, sem 26 | Um `v25ToV26` só para o modo (uma subida a mais sem arquivo gravado que a justifique) |
| Padrão do workspace em `llm.poolMode`, com `delegate` no neutro | `runner.poolMode` (o conjunto é de `llm`; cerimônias não são do runner; entraria em `WEB_EDITABLE` por engano) |
| `switch`/`delegate` sem lista por atividade valem `fallback`; `Agent` fica como hoje | `delegate` sempre (subagente no mesmo modelo só perde histórico) |
| `kind` do subagente restringe as ferramentas por `ToolImpl.activity` do que o principal já tem | Tabela de nomes à parte (duplica a classificação das atividades; um nome novo escaparia) |
| Tipos oferecidos dinâmicos (`explore` sempre; os outros com lista e ferramenta) | Enum fixo de quatro com recusa em tempo de execução (o modelo pediria o que não funciona) |
| Cada subagente com `PoolClient` próprio, da lista da atividade | Compartilhar o do pai (trocaria o modelo do principal e perderia o cache) |
| Principal fixo na lista `write`; as outras listas só servem aos subagentes | Ignorar também `write` no `fixed` (mexeria em `startList` sem ganho) |
| Subagentes mutantes um de cada vez | Livres (dois editores no mesmo worktree) |
| `Agent` para quem escreve só no motor aberto, com `tools.subagents` ligado | Ligar sem a chave (contornaria uma escolha da pessoa); no SDK (outra ferramenta) |
| Celular muda o modo de agente e etapa, e os dois viajam no modelo de ciclo | Recusar como `screenRaised` e tirar como o conjunto (o modo não dá alcance nem é endereço) |

## Perguntas abertas (respondidas no gate da parte 2)

1. **Confirmado:** `delegate` (e `switch`) são inertes sem lista por atividade: valem `fallback`.
2. **Confirmado:** a chave `tools.subagents` governa também `Agent` em `delegate`; os textos dela passam a explicar o uso nas execuções.
