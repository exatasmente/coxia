# Memória do ciclo

## Decisões

- Resposta de quem abriu: o custo do SDK não vira o preço da etapa fora da API própria da Anthropic, em nenhum outro provedor (inclusive Bedrock, Vertex, Foundry); sem cobrança real do provedor, a etapa mostra o valor marcado como estimativa, nunca "desconhecido". <!-- answer:12 -->
- Tipo: bug, com escopo já reduzido por quem abriu: saiu o total único de cerimônias e execuções (ficou com outro número, citado na issue); ficam não mostrar o preço de lista fora da Anthropic e levar a marca de estimativa até a tela.
- Decisões fixadas no plano, todas implementadas: (1) "API própria da Anthropic" é `kind: anthropic` com `baseUrl` casando `/^https:\/\/api\.anthropic\.com\/?$/`, o mesmo teste que o runtime já usa para autenticar; todo o resto marca o custo como estimativa; (2) o motor aberto não muda (lá o custo só existe quando o provedor informa); (3) a decisão fica no caminho do SDK (`src/main/agents.ts`), não no runner; (4) a procedência combina com regra explícita: a etapa é estimada só se houver custo e nenhum valor cobrado tiver entrado; um lado sem custo é neutro; (5) a marca nasce com o relatório de uso no caminho do SDK; (6) a marca de custo estimado ganhou campo próprio (`costEstimated`), separada do `estimated` que só diz que os tokens foram estimados; (7) a procedência é opcional no arquivo, `RUN_VERSION` não mudou e não há passo em `STEPS`; (8) o esquema do arquivo aceita o campo novo.
- Prioridade: a issue está em `priority:high`; a triagem sugeriu `priority:medium`. Não foi decidido nesta etapa; é decisão da pessoa.
- Squad: `plataforma` (o comportamento vive em `src/main/agents.ts`, `src/shared/runs`).

## Restrições

- Implementação feita no worktree, sem commit (o app commita). Nenhum modelo de verdade, host real ou rede foi alcançado: os testes do SDK usam o SDK simulado e os do runner usam os motores falsos.
- A origem do preço da estimativa continua não decidida (ver "Perguntas abertas"): a implementação manteve o valor existente marcado como estimativa e não inventou preço.
- Marco não proposto: é decisão da pessoa.

## Tentado e descartado

- Ler as referências do workspace fora do worktree: recusado pela ferramenta; a leitura ficou no repositório.
- Estender a marca de custo estimado ao painel de custo e à retenção das sessões das execuções: fora do escopo.
- Tratar como "não Anthropic" por comparação nova de endereço: descartado; o teste reusa o regex que o runtime já usa.
- No teste do caminho do SDK, salvar a configuração com id de provedor contendo ponto: recusado pelo padrão de id; trocado por um id sem ponto.

## Perguntas abertas

- De onde vem o preço usado na estimativa quando o provedor não informa a cobrança: não existe tabela de preços no repositório para o caminho do SDK e a issue não decide a origem. É decisão da pessoa; registrada no `1_SPEC.md`, no `2_PLAN.md` e no `3_IMPLEMENTATION.md`, sem pausar a etapa.
- Marco: a issue não traz marco visível; a pessoa decide.

## Onde o trabalho está

- Triagem em `0_TRIAGE.md`, especificação em `1_SPEC.md`, plano em `2_PLAN.md`, implementação em `3_IMPLEMENTATION.md`. O código já está mudado; a próxima etapa revisa e testa.
- A decisão sobre o custo está no caminho do SDK (`src/main/agents.ts`, função `isAnthropicApi`, usada ao ler `total_cost_usd` no fim da chamada).
- `src/shared/runs/usage.ts` ganhou `costEstimated` no `UsageReport` e no total; `addReport`/`mergeUsage` aplicam a regra de combinação. `StageUsage` (`src/shared/runs/types.ts`) e `RUN_SCHEMA` (`src/shared/runs/schema.ts`) aceitam o campo opcional.
- `src/shared/runs/view.ts` (`usageParams` devolve `estimated`) e `StageTimeline.tsx` escolhem entre a frase de valor cobrado e a de estimativa; chave nova `ui.cycle.stage.usageCostEstimated` nos dois catálogos.
- Documentação ajustada: `docs/llm-providers.md`, `docs/runner.md`, `CHANGELOG.md` (linha sob `## [Unreleased]`).
- Testes acrescentados/ajustados: `test/runner-agent.test.ts` (API própria vs. endereço próprio/Bedrock/Vertex/Foundry), `test/runs-usage.test.ts`, `test/run-view.test.ts`, `test/runner-lifecycle.test.ts`.
- Verificado nesta etapa: suíte inteira (222 arquivos, 3671 testes), `npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` e `node scripts/public-audit.mjs` passaram. Não verificado: o comportamento numa execução real contra um provedor que não seja a API própria da Anthropic.
- Passagem product-owner → pessoa: Plano e implementação a partir de `1_SPEC.md`. O que a leitura desta etapa fixou e o plano precisa carregar: - O custo da etapa é gravado no caminho do `claude-sdk` (`src/main/agents.ts:574` lê `m.total_cost_usd` e manda como custo sem olhar o provedor; `:496` já repassa `estimated` do motor aberto). O `ResolvedRole` (`src/main/config-resolve.ts:52-71`) carrega `providerId`, `kind`, `baseUrl` e `legacyCustomEndpoint`, mas o `EngineRequest` (`src/main/engine/contract.ts:70-113`) não os leva ao runner: a decisão de aceitar, marcar ou descartar o número tem de ser tomada no próprio caminho do SDK… <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementar a partir de `2_PLAN.md`. Ordem sugerida: (1) o caminho do SDK em `src/main/agents.ts` decide pelo alvo resolvido (`target.kind === 'anthropic'` e `target.baseUrl` casando com o teste de endereço que o runtime já usa em `src/main/llm-core.ts` e `src/main/config/validate.ts`), emitindo o custo com marca de estimativa quando não for a API própria; (2) `UsageReport` ganha um campo próprio para custo estimado em `src/shared/runs/usage.ts` (não sobrecarregar o `estimated` que hoje só fala de tokens), com regra explícita de combinação entre tentativas (estimada só se o custo existir e nen… <!-- handoff:32 -->
- Passagem support → product-owner: A triagem está fechada e a pergunta de quem abriu foi respondida; nenhuma pendência de esclarecimento fica para trás. O refinamento do produto decide escopo e prioridade a partir do documento: a sugestão registrada é `priority:medium`, com o motivo. O comportamento pedido: fora da API própria da Anthropic — em nenhum outro provedor, inclusive Bedrock, Vertex e Foundry — o número de custo que o SDK devolve não pode virar o preço da etapa, e quando o provedor em uso não oferece a cobrança real a etapa mostra o valor marcado como estimativa, não \"desconhecido\". Ficam anotados para quem for muda… <!-- handoff:15 -->
