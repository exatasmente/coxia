# Memória do ciclo

## Decisões

- Resposta de quem abriu: o custo do SDK não vira o preço da etapa fora da API própria da Anthropic, em nenhum outro provedor (inclusive Bedrock, Vertex, Foundry); sem cobrança real do provedor, a etapa mostra o valor marcado como estimativa, nunca "desconhecido". <!-- answer:12 -->
- Tipo: bug, com escopo já reduzido por quem abriu: saiu o total único de cerimônias e execuções (ficou com outro número, citado na issue); ficam não mostrar o preço de lista fora da Anthropic e levar a marca de estimativa até a tela.
- Refinamento (esta etapa) escreveu `1_SPEC.md`: comportamento nas palavras do produto, 5 regras, fora de escopo, pergunta em aberto e 10 critérios de aceite. O que muda para quem usa: o valor da etapa corresponde ao provedor que atendeu a chamada; fora da API própria da Anthropic o preço de lista não aparece; com cobrança informada, o valor cobrado; sem ela, um valor marcado como estimativa; os tokens registrados não mudam.
- Proposta de prioridade desta etapa: `priority:high` (a issue já está em `priority:high`, por proposta do estágio de produto); a triagem sugeriu `priority:medium`. É proposta: a pessoa aceita ou recusa.
- Squad proposto: `plataforma` (o comportamento vive em `src/main/agents.ts`, `src/main/engine` e `src/shared/runs`).

## Restrições

- Nada foi executado (nenhum teste, nenhum comando), a distorção não foi reproduzida e nada foi alterado além de `1_SPEC.md` e desta memória; tudo é leitura de código, da issue e da documentação. Afirmação sobre comportamento em execução é não verificada.
- A origem do preço da estimativa não foi decidida (ver "Perguntas abertas" e o próprio `1_SPEC.md`): sem ela o critério 3 do documento não fecha. Quem for implementar leva a decisão à pessoa.
- Marco não proposto: nenhum marco está visível nesta etapa e não se afirma qual versão receberia a mudança; é decisão da pessoa.

## Tentado e descartado

- Perguntar de novo o critério de provedor e o que a tela mostra: descartado, a resposta chegou.
- Buscar duplicata no rastreador: descartado; a busca foi por leitura dos arquivos do repositório (nenhuma outra issue na pasta de ciclos repete o pedido).
- Ler as referências do workspace fora do worktree: recusado pela ferramenta (caminho fora da pasta da atividade); a leitura ficou no repositório.

## Perguntas abertas

- De onde vem o preço usado na estimativa quando o provedor não informa a cobrança: não localizei nenhuma tabela de preços no repositório e a issue não decide a origem. É decisão da pessoa; a etapa não pausou nela, ficou registrada no `1_SPEC.md` e no handoff.
- Marco: a issue não traz marco visível; a pessoa decide.

## Onde o trabalho está

- Triagem fechada em `0_TRIAGE.md`; especificação funcional em `1_SPEC.md` (esta etapa).
- O resultado de uma chamada do SDK vira o custo da etapa sem olhar o provedor (`src/main/agents.ts:574`), somado a um total que nunca é zerado por provedor (`src/shared/runs/usage.ts:23-39`); os tokens já são contados por resposta (`src/main/agents.ts:553`).
- O provedor da chamada não chega ao runner: `ResolvedRole` carrega `providerId`/`kind`/`baseUrl`/`legacyCustomEndpoint` (`src/main/config-resolve.ts:52-71`), mas `EngineRequest` (`src/main/engine/contract.ts:70-113`) não os leva. Decidir se o número do SDK vale acontece antes do runner, no `claude-sdk`; o `AgentCall` (`src/main/agents.ts:968`, montado em `runAgent`) é o pedido do runner ao motor e já carrega o agente.
- A marca de estimativa existe no motor aberto (`src/main/engine/open/loop.ts:337-348`, `src/main/engine/open/session.ts:8-16`) e no contrato de uso (`src/shared/runs/usage.ts:15`), mas não sobrevive até `StageUsage` (`src/shared/runs/types.ts:39-47`): `addReport`/`mergeUsage`/`emptyUsage` a descartam e o runner grava só custo e tokens (`src/main/runner/service.ts:414-429`, `src/shared/runs/transitions.ts:959-965`). A tela decide pelo custo ser nulo (`src/shared/runs/view.ts:260-264`, `src/renderer/src/screens/cycle/StageTimeline.tsx:102-107`) e diz "informados pelo provedor" para qualquer valor (`src/shared/i18n/ui-cycle.pt-BR.json:206`, `ui-cycle.en.json:206`); os dois catálogos só têm `{cost}`, sem campo de procedência.
- Consequências a confirmar na implementação: sem custo do provedor, o custo estimado precisa de um preço de origem ainda não definida; a marca de estimativa hoje vale para tokens estimados quando o servidor não informa uso e passará a cobrir custo sem preço confirmado, e as duas origens precisam ser distinguíveis pelo texto da tela; a combinação entre tentativas de uma etapa precisa de regra explícita e `test/runs-usage.test.ts:10-29` fixa os totais exatos — vai precisar de ajuste.
- ``docs/llm-providers.md:107`` (pt-BR) e `:211` (en) ficam imprecisos, e `docs/runner.md:197` (pt-BR) e `:415` (en) dizem que "o app não estima preço"; os três precisam de ajuste junto, mais uma linha sob `## [Unreleased]` em `CHANGELOG.md`.
- Não verificado: nada disto foi executado; falta reproduzir a distorção e cobrir o comportamento com teste.
- Passagem product-owner → plano/implementação: `1_SPEC.md` está fechado em escopo, regras e critérios de aceite, com a origem do preço da estimativa em aberto para a pessoa. A decisão de quem abriu está registrada e não se abre de novo.
- Passagem support → product-owner: A triagem está fechada e a pergunta de quem abriu foi respondida; nenhuma pendência de esclarecimento fica para trás. O refinamento do produto decide escopo e prioridade a partir do documento: a sugestão registrada é `priority:medium`, com o motivo. O comportamento pedido: fora da API própria da Anthropic — em nenhum outro provedor, inclusive Bedrock, Vertex e Foundry — o número de custo que o SDK devolve não pode virar o preço da etapa, e quando o provedor em uso não oferece a cobrança real a etapa mostra o valor marcado como estimativa, não \"desconhecido\". Ficam anotados para quem for muda… <!-- handoff:15 -->
