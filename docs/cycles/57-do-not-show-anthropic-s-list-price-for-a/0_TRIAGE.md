# Preço de lista da Anthropic em chamada que foi para outro provedor

## Tipo

Bug. O rótulo é `bug` e o que a issue descreve é um comportamento observado: uma execução apareceu como US$ 51,55 no app quando o provedor cobrou cerca de US$ 1,5 — um número que não corresponde ao que foi gasto. Já houve redução de escopo: o total único de cerimônias e execuções saiu daqui e virou #104, restando não mostrar o preço de lista da Anthropic fora dela e levar a marca de estimativa até a tela.

## Dá para reproduzir ou entender

Dá para entender como está escrita, e a citação de código confere. Não houve reprodução: nada foi executado nesta etapa; o que segue é leitura da issue, dos trechos de código citados e da documentação.

- O resultado de uma chamada do SDK entrega o custo da chamada inteira sem tokens, e esse número vira o custo da etapa sem que o provedor seja olhado (`src/main/agents.ts:574`), somado a um total que nunca é zerado por provedor (`src/shared/runs/usage.ts:23-39`). O mesmo caminho já conta os tokens por resposta (`src/main/agents.ts:553`), o que bate com o comentário de quem abriu de que a contagem de tokens já está feita.
- A marca de estimativa existe no motor aberto e sobe até a interface do motor (`src/main/engine/open/loop.ts:337-348`, `src/main/engine/open/session.ts:8-16`), mas não chega ao registro da etapa: o campo existe no contrato de uso (`src/shared/runs/usage.ts:15`), porém o total da etapa (`src/shared/runs/types.ts:39-47`) não o tem, `addReport`/`mergeUsage`/`emptyUsage` (`src/shared/runs/usage.ts:18-39`) o descartam, e o runner só grava o custo e os tokens (`src/main/runner/service.ts:414-429`, `src/shared/runs/transitions.ts:959-965`). A tela decide mostrar ou não o custo apenas pelo valor ser nulo (`src/shared/runs/view.ts:260-264`, `src/renderer/src/screens/cycle/StageTimeline.tsx:102-107`), o que a marcaria como "informados pelo provedor" (`src/shared/i18n/ui-cycle.pt-BR.json:206`, `src/shared/i18n/ui-cycle.en.json:206`), inclusive para um valor que não é o preço pago.
- O provedor da chamada não chega ao runner: o alvo resolvido carrega `providerId`, `kind`, `baseUrl` e `legacyCustomEndpoint` (`src/main/config-resolve.ts:52-71`), mas o pedido ao motor (`src/main/engine/contract.ts:70-113`) não os leva. Decidir se o número do SDK vale depende de saber qual provedor atendeu a chamada, e esse dado só existe antes do runner, no caminho do `claude-sdk`. Nesta etapa isso fica registrado como onde a informação falta, sem projetar solução.
- Não existe hoje um pedido de custo ao provedor em uso a partir da chamada do SDK: o único pedido de custo por geração é feito a um provedor específico, reconhecido pelo endereço, para as cerimônias.
- A documentação afirma que o custo só aparece quando o provedor ou o SDK informou (`docs/llm-providers.md:211`); a mudança pedida torna essa frase imprecisa e ela precisará ser ajustada quando o comportamento mudar.

## Decisão de quem abriu

A pergunta da triagem foi respondida: o número de custo do SDK não vira o preço da etapa fora da API própria da Anthropic — em nenhum outro provedor, inclusive Bedrock, Vertex e Foundry, onde o modelo é Claude; e quando o provedor em uso não oferece a cobrança real da chamada, a tela da etapa mostra o valor marcado como estimativa, não nenhum valor. A decisão foi registrada mesmo sem justificativa; as leituras abaixo não a contrariam.

Duas consequências ficam anotadas porque não são afirmações, e sim o que será preciso confirmar contra o código quando o comportamento for mudado:

- No caminho do SDK os tokens passam a ser registrados por resposta, com custo nenhum; um custo estimado teria de ser derivado de um preço, e de onde esse preço vem não está definido.
- A marca de estimativa existe hoje para tokens estimados quando o servidor não informa uso, e a mudança a estende a custo sem preço confirmado; as duas origens se distinguem pelo texto da tela.

## Issues relacionadas

- O total único de cerimônias e execuções: saiu desta issue por decisão de quem abriu e ficou com outro número, citado na própria issue. Não é duplicata; é o que sobrou depois do corte de escopo.
- Nenhuma outra issue entre as guardadas na pasta de ciclos do repositório repete este pedido; a busca foi por leitura dos arquivos do repositório, sem varredura do rastreador.

## Sugestão de squad

`plataforma`. O comportamento pedido vive nos motores de agente, na camada de provedores e no registro de uso que o runner grava — `src/main/agents.ts`, `src/main/engine` e `src/shared/runs` —, que caem no escopo desse squad. A tela da etapa apenas reflete a marca uma vez que o registro a carregue.

## Sugestão de prioridade

`priority:medium`. A distorção é real e medida (cerca de 30 vezes, no relato), mas não há evidência nesta etapa de perda de trabalho, de bloqueio de execução ou de frequência: é um número errado numa tela de custo, e a rotina segue. O rótulo atual é `priority:high`, de uma proposta do estágio de produto; se ele for mantido, a justificativa deveria constar da issue. A decisão não é desta etapa.
