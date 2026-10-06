# Memória do ciclo

## Decisões

- Resposta de quem abriu: o custo do SDK não vira o preço da etapa fora da API própria da Anthropic, em nenhum outro provedor (inclusive Bedrock, Vertex, Foundry); sem cobrança real do provedor, a etapa mostra o valor marcado como estimativa, nunca "desconhecido". <!-- answer:12 -->
- Tipo: bug, com escopo já reduzido por quem abriu: saiu o total único de cerimônias e execuções (ficou com outro número, citado na issue); ficam não mostrar o preço de lista fora da Anthropic e levar a marca de estimativa até a tela.
- Decisões fixadas no plano, todas implementadas: (1) "API própria da Anthropic" é `kind: anthropic` com `baseUrl` casando `/^https:\/\/api\.anthropic\.com\/?$/`, o mesmo teste que o runtime já usa; todo o resto marca o custo como estimativa; (2) o motor aberto não muda; (3) a decisão fica no caminho do SDK (`src/main/agents.ts`), não no runner; (4) a procedência combina com regra explícita: a etapa é estimada só se houver custo e nenhum valor cobrado tiver entrado; um lado sem custo é neutro; (5) a marca nasce com o relatório de uso no caminho do SDK; (6) `costEstimated` é campo próprio, separado do `estimated` que só diz que os tokens foram estimados; (7) a procedência é opcional no arquivo, `RUN_VERSION` não mudou e não há passo em `STEPS`; (8) o esquema do arquivo aceita o campo novo.
- Revisão (esta etapa) aprovou com sugestões. Achados: o critério 3 da spec (provedor não informa custo → mostra valor estimado, nunca vazio) não tem teste para um resultado do SDK sem `total_cost_usd` — o código só relabela um custo que já veio; pelos tipos do SDK `total_cost_usd` é obrigatório, então o caso pode ser inalcançável. A marca de tokens estimados continua descartada por `addReport`, então o critério 6 se apoia na ausência de texto para esse caso. O número marcado como estimativa continua sendo o preço de lista da Anthropic (~30× o cobrado, a magnitude que a issue mediu): a marca corrige a honestidade da exibição, não o valor — é a pergunta aberta.
- Prioridade: a issue está em `priority:high`; a triagem sugeriu `priority:medium`. É decisão da pessoa.
- Squad: `plataforma`.

## Restrições

- Nenhum modelo de verdade, host real ou rede foi alcançado: os testes do SDK usam o SDK simulado e os do runner usam os motores falsos.
- A origem do preço da estimativa continua não decidida.
- Marco não proposto: é decisão da pessoa.

## Tentado e descartado

- Ler as referências do workspace fora do worktree: recusado pela ferramenta; a leitura ficou no repositório.
- Estender a marca de custo estimado ao painel de custo e à retenção das sessões das execuções: fora do escopo.
- Tratar como "não Anthropic" por comparação nova de endereço: descartado; o teste reusa o regex que o runtime já usa.
- Na revisão, ler as 21 falhas da suíte inteira como regressão: descartado; são estouros de tempo em testes que dependem de git, de arquivos não relacionados, e passam isoladamente — ambientais.

## Perguntas abertas

- De onde vem o preço usado na estimativa quando o provedor não informa a cobrança: não existe tabela de preços no repositório para o caminho do SDK e a issue não decide a origem. É decisão da pessoa; registrada no `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e `4_REVIEW.md`.
- Marco: a issue não traz marco visível; a pessoa decide.

## Onde o trabalho está

- `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e `4_REVIEW.md` na pasta do ciclo. O código está no worktree, já commitado (`82a5452 feat: apply the implement changes #57`).
- Decisão do provedor em `src/main/agents.ts` (`isAnthropicApi`, usada ao ler `total_cost_usd` no fim da chamada).
- `src/shared/runs/usage.ts` tem `costEstimated` no `UsageReport` e no total, e a regra de combinação em `provenance`/`addReport`/`mergeUsage`; `StageUsage` (`types.ts`) e `RUN_SCHEMA` (`schema.ts`) aceitam o campo opcional; `view.ts` (`usageParams`) e `StageTimeline.tsx` escolhem a frase; chave `ui.cycle.stage.usageCostEstimated` nos dois catálogos.
- `docs/llm-providers.md`, `docs/runner.md` e `CHANGELOG.md` ajustados.
- Verificado nesta etapa: `npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` e os cinco arquivos de teste tocados (117 testes) passaram. A suíte inteira teve 21 falhas por estouro de tempo em testes de git, não relacionadas (ambientais). Não verificado: o comportamento numa execução real contra um provedor que não seja a API própria da Anthropic.
- Passagem support → product-owner: A triagem está fechada e a pergunta de quem abriu foi respondida; nenhuma pendência de esclarecimento fica para trás. O refinamento do produto decide escopo e prioridade a partir do documento: a sugestão registrada é `priority:medium`, com o motivo. O comportamento pedido: fora da API própria da Anthropic — em nenhum outro provedor, inclusive Bedrock, Vertex e Foundry — o número de custo que o SDK devolve não pode virar o preço da etapa, e quando o provedor em uso não oferece a cobrança real a etapa mostra o valor marcado como estimativa, não \"desconhecido\". Ficam anotados para quem for muda… <!-- handoff:15 -->
- Passagem product-owner → pessoa: Plano e implementação a partir de `1_SPEC.md`. O que a leitura desta etapa fixou e o plano precisa carregar: - O custo da etapa é gravado no caminho do `claude-sdk` (`src/main/agents.ts:574` lê `m.total_cost_usd` e manda como custo sem olhar o provedor; `:496` já repassa `estimated` do motor aberto). O `ResolvedRole` (`src/main/config-resolve.ts:52-71`) carrega `providerId`, `kind`, `baseUrl` e `legacyCustomEndpoint`, mas o `EngineRequest` (`src/main/engine/contract.ts:70-113`) não os leva ao runner: a decisão de aceitar, marcar ou descartar o número tem de ser tomada no próprio caminho do SDK… <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementar a partir de `2_PLAN.md`. Ordem sugerida: (1) o caminho do SDK em `src/main/agents.ts` decide pelo alvo resolvido (`target.kind === 'anthropic'` e `target.baseUrl` casando com o teste de endereço que o runtime já usa em `src/main/llm-core.ts` e `src/main/config/validate.ts`), emitindo o custo com marca de estimativa quando não for a API própria; (2) `UsageReport` ganha um campo próprio para custo estimado em `src/shared/runs/usage.ts` (não sobrecarregar o `estimated` que hoje só fala de tokens), com regra explícita de combinação entre tentativas (estimada só se o custo existir e nen… <!-- handoff:32 -->
- Passagem developer → revisor-plataforma: A implementação está no worktree, sem commit. A próxima etapa revisa o código e roda as validações. Os pontos a olhar: (1) a decisão do provedor está em `src/main/agents.ts` (`isAnthropicApi`), reusando o regex de `src/main/llm-core.ts`; (2) a regra de combinação em `src/shared/runs/usage.ts` (`addReport`/`mergeUsage`/`provenance`), coberta por test/runs-usage.test.ts; (3) o campo opcional `costEstimated` em `StageUsage`/`RUN_SCHEMA` e a leitura de um arquivo sem ele; (4) a tela em `usageParams` e `StageTimeline.tsx`, com a chave nova nos dois catálogos. Verificado nesta etapa: tsc, suíte inte… <!-- handoff:88 -->
