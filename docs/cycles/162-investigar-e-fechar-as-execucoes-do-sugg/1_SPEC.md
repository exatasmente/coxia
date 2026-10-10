# Decidir as sugestões do suggest-agent que estão à espera

## O que muda para quem usa

O app gera sugestões de novos agentes (nome, papel, etapa, rascunho de prompt e a evidência por trás) e as mostra em cartões na tela de sugestões, onde cada uma espera uma decisão: aceitar (cria o agente), editar (abre o editor já preenchido) ou recusar (guarda o motivo). Hoje há uma fila desses cartões acumulada: cerca de dez sugestões sem decisão — seis geradas em 07/10 (worktree-gate, pr-opener, ambient, fechamento, test-runner, checker) e quatro em 09/10 (review-unifier, re-revisor, despachante, reparo). O que muda é a fila: cada sugestão pendente recebe uma decisão registrada, e ao fim a tela de sugestões não mostra mais nenhuma dessas esperando. Nenhuma sugestão é deixada à espera; o que não servir a evolução do app é recusado com motivo, e o que servir é aceito (ou editado e aceito).

## Regras

1. Toda sugestão do lote de 07/10 listada acima recebe exatamente uma decisão: aceitar, editar ou recusar, feita na tela de sugestões.
2. Toda sugestão do lote de 09/10 (review-unifier, re-revisor, despachante, reparo) recebe a mesma decisão, um cartão por vez.
3. Antes de decidir em bloco, a contagem atual de cartões pendentes é confirmada na tela: a issue falava de 6 e o esclarecimento de 10; o número que vale é o que a tela mostra no momento do fechamento.
4. Cada recusa registra um motivo curto (o que a sugestão propunha e por que não serve agora); cada aceite segue o fluxo normal da tela, criando (ou editando e criando) o agente proposto.
5. A decisão de cada cartão fica registrada no app, junto da sugestão a que corresponde.

## Fora do escopo

- As 8 execuções `failed` de 07/10 (todas com o motivo "a sugestão não está mais esperando") já têm causa conhecida e estão cobertas pela issue #188; aqui elas não são investigadas nem reexecutadas.
- Mudanças de comportamento no fluxo de sugestão do app (o que gera cartões, quando, e como uma decisão é gravada) ficam de fora: esta mudança usa o fluxo como ele é hoje.
- Retomar ou reexecutar qualquer execução do suggest-agent.

## Critérios de aceite

1. Abrir a tela de sugestões: nenhuma das sugestões dos lotes de 07/10 e 09/10 listadas nas regras aparece mais como à espera de decisão.
2. Cada uma dessas sugestões tem uma decisão visível (aceite, edição ou recusa com motivo) no registro de sugestões do app.
3. As sugestões aceitas, se houver, aparecem como resultado do fluxo normal (agente criado ou editor aberto a partir do cartão).
4. A contagem de pendentes confirmada na tela antes do fechamento está registrada junto do resultado do fechamento.

## Perguntas em aberto

Nenhuma que bloqueie: a contagem exata se confirma na tela no momento do fechamento (regra 3) e quem decide cada cartão é o mantenedor, na tela.
