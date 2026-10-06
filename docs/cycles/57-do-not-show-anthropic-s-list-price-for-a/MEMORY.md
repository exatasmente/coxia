# Memória do ciclo

## Decisões

- Resposta de quem abriu: o custo do SDK não vira o preço da etapa fora da API própria da Anthropic, em nenhum outro provedor (inclusive Bedrock, Vertex, Foundry); sem cobrança real do provedor, a etapa mostra o valor marcado como estimativa, nunca "desconhecido". Fecha o "O que falta" da triagem. <!-- answer:12 -->
- Tipo: bug. Escopo reduzido por quem abriu: saiu o total único de cerimônias e execuções (#104); ficam não mostrar o preço de lista fora da Anthropic e levar a marca de estimativa até a tela.
- Squad proposto: `plataforma` (o comportamento vive em `src/main/agents.ts`, `src/main/engine` e `src/shared/runs`). Prioridade sugerida: `priority:medium`; a issue está em `priority:high` por proposta do produto, e a decisão é do refinamento.

## Restrições

- Nada foi executado (nenhum teste, nenhum comando) e nada foi alterado; tudo o que segue é leitura de código, da issue e da documentação. Qualquer afirmação sobre comportamento em execução é não verificada.
- A pasta do ciclo não pode abrir a pergunta de novo: ela foi respondida.

## Tentado e descartado

- Perguntar de novo o critério de provedor e o que a tela mostra: descartado, a resposta chegou.
- Buscar duplicata no rastreador: descartado; a busca foi por leitura dos arquivos do repositório (nenhuma outra issue na pasta de ciclos repete o pedido).

## Perguntas abertas

- Nenhuma pendente de resposta. As consequências abertas da resposta (ver "Onde o trabalho está") são de refino e de implementação, não perguntas a alguém.

## Onde o trabalho está

- Triagem fechada em `0_TRIAGE.md` (tipo, entendimento, decisão de quem abriu, relacionadas, squad, prioridade).

- O resultado de uma chamada do SDK vira o custo da etapa sem olhar o provedor (`src/main/agents.ts:574`), somado a um total que nunca é zerado por provedor (`src/shared/runs/usage.ts:23-39`); os tokens já são contados por resposta (`src/main/agents.ts:553`).
- O provedor da chamada não chega ao runner: `ResolvedRole` carrega `providerId`/`kind`/`baseUrl`/`legacyCustomEndpoint` (`src/main/config-resolve.ts:52-71`), mas `EngineRequest` (`src/main/engine/contract.ts:70-113`) não os leva. Decidir se o número do SDK vale acontece antes do runner, no `claude-sdk`.
- A marca de estimativa existe no motor aberto (`src/main/engine/open/loop.ts:337-348`, `src/main/engine/open/session.ts:8-16`) e no contrato de uso (`src/shared/runs/usage.ts:15`), mas não sobrevive até `StageUsage` (`src/shared/runs/types.ts:39-47`): `addReport`/`mergeUsage`/`emptyUsage` a descartam e o runner grava só custo e tokens (`src/main/runner/service.ts:414-429`, `src/shared/runs/transitions.ts:959-965`). A tela decide pelo custo ser nulo (`src/shared/runs/view.ts:260-264`, `src/renderer/src/screens/cycle/StageTimeline.tsx:102-107`) e diz "informados pelo provedor" para qualquer valor (`src/shared/i18n/ui-cycle.pt-BR.json:206`, `ui-cycle.en.json:206`).
- Consequências da resposta a confirmar na implementação: sem custo do provedor, um custo estimado precisaria vir de um preço cuja origem ainda não está definida; a marca de estimativa hoje vale para tokens estimados quando o servidor não informa uso e passará a cobrir custo sem preço confirmado, e as duas origens precisam ser distinguíveis pelo texto da tela; `docs/llm-providers.md:211` precisará ser ajustado junto.
- Nenhum pedido de custo ao provedor em uso a partir da chamada do SDK existe hoje; o único é feito a um provedor específico, para as cerimônias.
- Não verificado: nada disto foi executado; falta reproduzir a distorção e cobrir o comportamento com teste.
