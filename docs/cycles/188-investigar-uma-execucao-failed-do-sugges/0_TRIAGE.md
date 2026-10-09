# Triage of the request to investigate a failed agent run

## Tipo

Tarefa operacional de investigação (pergunta/limpeza de execução), não um bug confirmado do produto nem um pedido de funcionalidade. A issue pedia duas coisas: (1) abrir o registro de uma execução com estado `failed` de um agente de sugestões, decidir a causa ou retomar, e (2) resolver em bloco seis execuções com estado `pending` da semana, que não tiveram nenhuma execução `done`. Nenhum comportamento do código é apontado como errado.

Com o esclarecimento do autor, o item (1) já tem dona: a investigação da #162. A issue passa a ser a ponte para decidir o encaminhamento do lote aqui e na #162.

## Dá para entender?

Sim, após um esclarecimento do autor. Verificado por leitura da issue, da conversa e do schema de execuções do app:

- As 8 execuções `failed` são ações do suggest-agent das ~14:46:47–48 de 07/10/2026 (plan-refresher, typecheck, tsc-audit, gatekeeper, feedback-driver, preflight, criterios, verifier), todas com o mesmo motivo: "a sugestão não está mais esperando". Nenhuma outra `failed` aparece no feed da semana.
- A causa é a mesma para todas: a decisão do gate já tinha caído antes das execuções rodarem. O registro discriminado fica na #162, não aberto aqui.
- Os estados `failed` e `pending` existem no modelo de dados do app (`src/shared/runs/schema.ts`); a execução falhada carrega código de causa com etapa e detalhe, e a pendente carrega a pergunta e quem está com ela.
- Antes do esclarecimento, o faltava tudo: qual execução investigar, em qual repositório/ciclo, e como tratar as pendentes. Agora resolvido pelos itens abaixo.

## O que falta

Nada que impeça a decisão. O próprio esclarecimento do autor já traz a proposta de encaminhamento:

- Tratar o lote de 8 falhadas como **descartado** — não é falha de agente a corrigir, pois a causa está fora das execuções (a decisão do gate já tinha caído).
- Resolver as 6 `pending` **em bloco, na #162**, sob a mesma investigação.

Se essa decisão for aceita, esta issue pode ser fechada como resolvida lá (ou como duplicada/relacionada da #162); não há trabalho de código a fazer aqui.

Sugestão de prioridade: `priority:medium` — higiene operacional real (lote de falhas e pendências sem registro), mas sem bloqueio de entrega em curso.

## Issues duplicadas ou relacionadas

- **#162** — investigação onde o lote de 8 execuções `failed` já foi detalhado e onde o autor propõe resolver as pendências em bloco; esta issue repete esse escopo para a semana e pode ser resolvida por ela.
- Nota de contexto: um ciclo anterior (`docs/cycles/5-…`) criou o agente de sugestões; já confirmado pelo esclarecimento que a falha não é de comportamento daquela entrega, então não há volta a essas notas para corrigi-la.
