# Spec: lote de falhas do agente de sugestões e pendências baixam na investigação já aberta

## O que muda para quem usa

Nada no produto muda. O pedido é de higiene operacional sobre execuções de agentes da semana: um lote de oito execuções com estado `failed` do agente de sugestões e seis execuções `pending`, sem nenhuma `done` na semana. O autor já esclareceu, citando: "Como a causa é a mesma (a decisão do gate já tinha caído antes da execução), o registro discriminado fica na #162; a decisão aqui é tratar o lote como descartado (não é falha de agente a corrigir) e resolver as pendências em bloco lá na #162.", e "a execução failed está identificada pela investigação da #162: as 8 ações suggest-agent das ~14:46:47–48 de 07/10 (plan-refresher, typecheck, tsc-audit, gatekeeper, feedback-driver, preflight, criterios, verifier), todas com o mesmo motivo 'a sugestão não está mais esperando'. Nenhuma outra failed aparece no feed da semana.", e o pedido original pedia "Abrir o registro de uma execução failed, decidir causa ou retomada, e resolver as 6 pending em bloco".

Em palavras: a investigação da causa já existe e tem dona (a #162); o registro da execução falhada, a causa e a decisão de descarte ficam lá; as seis perguntas pendentes são respondidas ou encerradas junto com ela; esta issue é então fechada como resolvida por aquela investigação, e nenhuma investigação nova é aberta aqui.

## Regras

1. O lote de 8 execuções `failed` do agente de sugestões (~14:46:47–48 de 07/10/2026; plan-refresher, typecheck, tsc-audit, gatekeeper, feedback-driver, preflight, criterios, verifier) é tratado como **descartado**: não é falha de comportamento do agente a corrigir, pois a causa está fora das execuções (a decisão do gate já tinha caído quando elas rodaram).
2. O registro discriminado das 8 falhas não é reaberto neste registro; fica na #162.
3. As 6 execuções `pending` da semana são resolvidas **em bloco, na #162**: cada uma respondida ou explicitamente encerrada, sem ficar em espera indefinida.
4. Esta issue é fechada como **resolvida pela #162** quando o registro do lote e o encaminhamento das pendências estiverem lá.
5. Nenhuma mudança de código, de comportamento do agente ou de produto deriva desta issue.

## Fora do escopo

- Qualquer correção no agente de sugestões ou no runner: a causa determinada não é do agente.
- Mudanças nos estados `failed`/`pending` do app: existem no modelo de dados (verificado por leitura do schema de execuções) e não foram apontados como errados.
- Investigação técnica nova neste registro: ela já existe na #162.

## Critérios de aceite

1. Na #162, o lote de 8 falhadas aparece registrado com a causa determinada e a decisão de descarte, sem necessidade de nova investigação.
2. As 6 pendências da semana têm, na #162, um encaminhamento: respondidas ou encerradas em bloco.
3. Esta issue está fechada, apontando para a #162.
4. Nenhum arquivo do produto foi alterado por esta issue.

## Perguntas em aberto

- Nenhuma bloqueante. O encaminhamento é o que o autor propôs e o que não foi verificado nesta etapa é apenas a aceitação formal dele no rastreador.
