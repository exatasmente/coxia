# Memória do ciclo

## Decisões

- Resposta de quem abriu: o custo do SDK não vira o preço da etapa fora da API própria da Anthropic, em nenhum outro provedor (inclusive Bedrock, Vertex, Foundry); sem cobrança real do provedor, a etapa mostra o valor marcado como estimativa, nunca "desconhecido". <!-- answer:12 -->
- Tipo: bug, com escopo já reduzido por quem abriu: saiu o total único de cerimônias e execuções (ficou com outro número, citado na issue); ficam não mostrar o preço de lista fora da Anthropic e levar a marca de estimativa até a tela.
- Refinamento escreveu `1_SPEC.md`: comportamento nas palavras do produto, 5 regras, fora de escopo, pergunta em aberto e 10 critérios de aceite.
- Plano (esta etapa) escreveu `2_PLAN.md`: abordagem, áreas, 8 decisões fixadas, onde cada mudança entra, riscos, testes e o que fica em aberto.
- Decisões fixadas no plano: (1) "API própria da Anthropic" é `kind: anthropic` com o endereço exato da API — o mesmo teste que o runtime já usa para autenticar; todo o resto (bedrock, vertex, foundry, endereço próprio legado, outro tipo de provedor) marca o custo como estimativa; (2) o motor aberto não muda (lá o custo só existe quando o provedor informa); (3) a decisão fica no caminho do SDK (`src/main/agents.ts`), não no runner, que não passa a estimar preço; (4) a procedência combina entre tentativas com regra explícita: a etapa é estimada só se o custo existir e nenhum valor cobrado tiver entrado; (5) a marca nasce com o relatório de uso no caminho do SDK; (6) a marca de custo estimado ganha campo próprio, separada do `estimated` que hoje só diz que os tokens foram estimados; (7) a procedência é opcional no arquivo da execução, `RUN_VERSION` não muda e não há passo em `STEPS` (a mudança não toca a configuração); (8) o esquema do arquivo precisa aceitar o campo novo.
- Proposta de prioridade: `priority:high` (a issue já está em `priority:high`); a triagem sugeriu `priority:medium`. É proposta: a pessoa aceita ou recusa.
- Squad: `plataforma` (o comportamento vive em `src/main/agents.ts`, `src/main/engine` e `src/shared/runs`).

## Restrições

- Nada foi executado (nenhum teste, nenhum comando), a distorção não foi reproduzida e nada foi alterado além de `1_SPEC.md`, `2_PLAN.md` e desta memória; tudo é leitura de código, da issue e da documentação. Afirmação sobre comportamento em execução é não verificada.
- A origem do preço da estimativa não foi decidida (ver "Perguntas abertas"): enquanto isso a implementação mantém o valor existente marcado como estimativa e não inventa preço.
- Marco não proposto: nenhum marco está visível nesta etapa; é decisão da pessoa.

## Tentado e descartado

- Perguntar de novo o critério de provedor e o que a tela mostra: descartado, a resposta chegou.
- Buscar duplicata no rastreador: descartado; a busca foi por leitura dos arquivos do repositório.
- Ler as referências do workspace fora do worktree: recusado pela ferramenta; a leitura ficou no repositório.
- Estender a marca de custo estimado ao painel de custo e à retenção das sessões das execuções: descartado, fora do escopo (o painel lê o custo real do provedor reconhecido pelo endereço, não o registro da etapa).

## Perguntas abertas

- De onde vem o preço usado na estimativa quando o provedor não informa a cobrança: não existe tabela de preços no repositório para o caminho do SDK e a issue não decide a origem. É decisão da pessoa; registrada no `1_SPEC.md` e no `2_PLAN.md`, sem pausar a etapa.
- Marco: a issue não traz marco visível; a pessoa decide.

## Onde o trabalho está

- Triagem em `0_TRIAGE.md`, especificação em `1_SPEC.md`, plano em `2_PLAN.md` (esta etapa). A implementação entra a partir do plano.
- O resultado de uma chamada do SDK vira o custo da etapa sem olhar o provedor (`src/main/agents.ts:574`), somado a um total que nunca é zerado por provedor (`src/shared/runs/usage.ts:23-39`); os tokens já são contados por resposta (`:553`) e o motor aberto já repassa `estimated` (`:496`).
- O provedor da chamada não chega ao runner: `ResolvedRole` carrega `providerId`/`kind`/`baseUrl`/`legacyCustomEndpoint` (`src/main/config-resolve.ts:52-71`), mas `EngineRequest` (`src/main/engine/contract.ts:70-113`) não os leva. A decisão fica no `claude-sdk`; o runner (`src/main/runner/service.ts:414-429`) não deve passar a estimar preço.
- A marca de estimativa existe no motor aberto (`src/main/engine/open/loop.ts:337-348`, `session.ts:8-16`) e no contrato de uso (`src/shared/runs/usage.ts:15`), mas não chega a `StageUsage` (`src/shared/runs/types.ts:39-47`) nem ao esquema (`src/shared/runs/schema.ts:32-42`, a lista de campos obrigatórios): `addReport`/`mergeUsage`/`emptyUsage` a descartam e `recordUsage` (`src/shared/runs/transitions.ts:959-965`) grava por `mergeUsage`. A tela decide pelo custo ser nulo (`src/shared/runs/view.ts:260-264`, `StageTimeline.tsx:102-107`) e diz "informados pelo provedor" para qualquer valor (`ui-cycle.pt-BR.json:206`, `ui-cycle.en.json:206`).
- Testes que vão precisar de ajuste: `test/runs-usage.test.ts:10-41` (totais exatos e campos do registro), `test/run-view.test.ts:301-309` (`usageParams`), `test/runner-agent.test.ts:52-71` (o caminho do SDK fixa o custo 0.0123 do `total_cost_usd` no caso da API própria) e `test/runner-lifecycle.test.ts:177-199` (uso somado nas tentativas).
- Documentação a ajustar junto: `docs/llm-providers.md:107` (pt-BR) e `:211` (en) ficam imprecisos; `docs/runner.md:197` (pt-BR) e `:415` (en) dizem que "o app não estima preço"; mais uma linha sob `## [Unreleased]` em `CHANGELOG.md`.
- Não verificado: nada disto foi executado; falta reproduzir a distorção e cobrir o comportamento com teste na implementação.
- Passagem support → product-owner: A triagem está fechada e a pergunta de quem abriu foi respondida; nenhuma pendência de esclarecimento fica para trás. O refinamento do produto decide escopo e prioridade a partir do documento: a sugestão registrada é `priority:medium`, com o motivo. O comportamento pedido: fora da API própria da Anthropic — em nenhum outro provedor, inclusive Bedrock, Vertex e Foundry — o número de custo que o SDK devolve não pode virar o preço da etapa, e quando o provedor em uso não oferece a cobrança real a etapa mostra o valor marcado como estimativa, não \"desconhecido\". Ficam anotados para quem for muda… <!-- handoff:15 -->
- Passagem product-owner → pessoa: Plano e implementação a partir de `1_SPEC.md`. O que a leitura desta etapa fixou e o plano precisa carregar: - O custo da etapa é gravado no caminho do `claude-sdk` (`src/main/agents.ts:574` lê `m.total_cost_usd` e manda como custo sem olhar o provedor; `:496` já repassa `estimated` do motor aberto). O `ResolvedRole` (`src/main/config-resolve.ts:52-71`) carrega `providerId`, `kind`, `baseUrl` e `legacyCustomEndpoint`, mas o `EngineRequest` (`src/main/engine/contract.ts:70-113`) não os leva ao runner: a decisão de aceitar, marcar ou descartar o número tem de ser tomada no próprio caminho do SDK… <!-- handoff:22 -->
