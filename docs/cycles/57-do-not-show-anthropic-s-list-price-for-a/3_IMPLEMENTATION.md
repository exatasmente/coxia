# O custo da etapa passa a dizer de onde veio o número

## O que mudou

Numa etapa que roda pelo caminho do SDK do Claude, o número de custo que o SDK devolve
deixa de virar o preço cobrado quando a chamada não foi para a API própria da Anthropic.
A decisão é tomada onde o provedor da chamada é conhecido, no próprio caminho do SDK, com
o mesmo teste de endereço que o resto do runtime usa para decidir como autenticar: o
provedor de tipo `anthropic` cujo endereço é exatamente `https://api.anthropic.com`.

- Na API própria da Anthropic o valor do SDK continua sendo o custo cobrado da etapa.
- Em qualquer outro provedor — Bedrock, Vertex, Foundry, um endereço próprio — o mesmo
  valor passa a ser marcado como estimativa. O número não desaparece: a etapa continua
  mostrando um valor, agora dito como estimativa, nunca "desconhecido" e nunca uma célula
  vazia.
- O motor aberto não mudou: quando o provedor informa o custo, ele continua sendo o valor
  cobrado; os tokens estimados quando o servidor não informa uso continuam marcados como
  tokens estimados, num campo próprio, sem se confundir com o custo.

Os tokens continuam sendo registrados por resposta, como antes, e os totais de enviados,
recebidos e servidos do cache não mudam.

## Como ficou por dentro

- `src/main/agents.ts`: o caminho do SDK decide pelo alvo resolvido da chamada. O
  relatório final (`total_cost_usd`) leva a marca de custo estimado quando o alvo não é a
  API própria da Anthropic.
- `src/shared/runs/usage.ts`: o contrato de uso ganhou um campo próprio para o custo
  estimado (`costEstimated`), separado do `estimated`, que continua falando só de tokens.
  A regra de combinação ficou explícita: um valor cobrado, em qualquer relatório ou
  tentativa, torna a etapa cobrada; a etapa é estimada só quando há custo e nenhum valor
  cobrado entrou; um relatório ou uma tentativa sem custo não mexe na procedência.
- `src/shared/runs/types.ts` e `src/shared/runs/schema.ts`: o registro da etapa e o
  esquema do arquivo aceitam o campo novo, opcional. `RUN_VERSION` não mudou e não há
  passo em `STEPS`; uma execução gravada sem o campo abre como antes e um registro sem
  ele é lido como cobrado, que era o significado do valor na época.
- `src/main/runner/service.ts` e `src/shared/runs/transitions.ts`: não mudaram de forma; a
  procedência vem dentro do valor somado por `addReport`/`mergeUsage`.
- `src/shared/runs/view.ts` e `src/renderer/src/screens/cycle/StageTimeline.tsx`: a
  linha de uso do modelo ganhou o booleano que diz se o valor é estimado, e a tela escolhe
  entre a frase de valor cobrado e a de valor estimado.
- `src/shared/i18n/ui-cycle.pt-BR.json` e `ui-cycle.en.json`: uma chave nova em cada
  catálogo (`ui.cycle.stage.usageCostEstimated`), dizendo que o provedor não informou o
  custo da chamada. A chave antiga (`ui.cycle.stage.usageCost`) deixou de ser usada para
  todo valor presente.
- `docs/llm-providers.md`, `docs/runner.md` e `CHANGELOG.md`: a documentação deixou de
  afirmar que o custo só aparece quando o provedor o informa, e o changelog ganhou uma
  linha sob `## [Unreleased]`.

## O que fica em aberto

A origem do preço usado na estimativa continua não decidida: fora da API própria da
Anthropic o valor existente é mantido com a marca de estimativa, e nenhum preço novo foi
inventado. Enquanto essa origem não for definida, a etapa continua mostrando o número que
o SDK calcula, agora marcado como estimativa, e nunca o apresenta como o valor cobrado.

## Como foi verificado

Nada foi executado antes das mudanças: a leitura do código foi por leitura dos arquivos.
Depois das mudanças, a suíte inteira, o typecheck, a auditoria de tema, o lint de i18n e a
auditoria pública foram rodados neste worktree e passaram. O que foi conferido por teste:

- o caminho do SDK na API própria da Anthropic mantém o valor do SDK como custo cobrado,
  sem marca de estimativa;
- o caminho do SDK em um endereço próprio `anthropic`, e em Bedrock, Vertex e Foundry,
  marca o mesmo valor como estimativa;
- a soma e o registro: `addReport`/`mergeUsage` combinam a procedência pela regra fixada
  (estimada só se há custo e nenhum valor cobrado entrou), os totais de tokens continuam
  iguais aos de antes, e a leitura do arquivo aceita um registro com o campo e um sem ele
  (lido como cobrado);
- o runner grava a procedência no registro da etapa, e uma tentativa estimada seguida de
  uma estimada continua estimada;
- a tela: `usageParams` distingue valor cobrado de estimativa.

O comportamento em execução fora dos testes — uma execução real contra um provedor que não
seja a API própria da Anthropic — não foi verificado: nenhum modelo de verdade, host real
ou rede foi alcançado, como manda o repositório.

## Riscos que o plano apontava

- O teste do endereço usa o mesmo regex que `src/main/llm-core.ts` já usava para
  autenticar, e não uma comparação nova. Coberto pelo caso da API própria e pelos casos
  dos outros provedores.
- Uma execução com mais de um provedor nas mesmas tentativas: a regra de combinação é
  explícita e coberta por teste com uma tentativa estimada e uma cobrada.
- O esquema do arquivo aceita o campo novo, coberto pelo teste de leitura.
