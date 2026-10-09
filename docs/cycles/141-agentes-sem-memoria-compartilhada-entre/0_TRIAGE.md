# Triagem

## Tipo

Pedido de funcionalidade. A issue descreve um comportamento que falta hoje e pede que ele passe a existir; não relata uma falha isolada nem é uma dúvida.

## Dá para entender ou reproduzir

Dá para entender como está escrita. A leitura foi feita sobre a issue e sobre o código que ela cita:

- O relato de abertura é um caso concreto: uma atividade estava em teste e o agente de QA, ao ser chamado, respondeu que não havia teste em andamento. A issue já diz a causa que atribui a isso.
- Confere com o que existe: a memória do ciclo é um arquivo de nome fixo dentro da pasta do ciclo, no worktree daquela execução, lida e reescrita por cada etapa daquela execução; um agente chamado fora de uma etapa recebe apenas o fio da conversa em que foi chamado e os arquivos que o chamador passa, com uma cópia descartável do código. Não há, hoje, um estado das atividades que atravesse execuções, sobreviva a um reinício do app e seja lido por um agente de fora daquela execução.
- Os critérios de aceite da issue são verificáveis um a um: um agente chamado durante outra atividade informa o que está acontecendo com ela; após reiniciar o app o trabalho continua de onde parou; agentes chamados em paralelo leem o mesmo estado; a memória não depende de uma execução ou worktree específica.

Não foi reproduzido: nenhuma execução foi iniciada nem o comportamento foi exercitado. A conferência acima foi feita lendo a issue e o código que ela cita, não rodando o app.

## O que falta

Nada que impeça o trabalho seguir. A issue já traz o problema, as regras e os critérios de aceite.

## Issues relacionadas

- **#52** (memória do ciclo que os agentes de uma execução longa leem e atualizam) — é a base sobre a qual esta issue constrói. A #52 criou a memória presa a uma execução; esta pede que ela deixe de ser por execução. Não é duplicata: o escopo é outro (compartilhamento entre atividades, persistência entre reinícios).
- **#122** (agentes em trabalho trocam mensagens e se chamam durante uma execução) — vizinha e relacionada, porque toca em como um agente sabe o que outro está fazendo durante uma execução. O fora de escopo da #122 exclui explicitamente agentes de execuções diferentes falando entre si, que é justamente o que esta issue pede. Não é duplicata.
- **#71** (conversar direto com um agente) — relacionada de forma mais fraca: as notas da #71 já levantam como questão em aberto se a conversa direta de um agente guarda memória entre conversas. Parte do mesmo tema, escopo diferente.
- **#29** (mostrar que um agente chamado no fio de uma execução está trabalhando) — relacionada apenas por tocar no mesmo caminho de chamada de agente; não é duplicata.

## Sugestão de prioridade e squad

Sugestão de prioridade: `priority:high`. A justificativa da issue se sustenta no que foi lido: a desinformação vai direto ao usuário e a memória entre atividades é condição para agentes chamados em paralelo funcionarem. É sugestão; a prioridade é proposta pela etapa de refinamento.

Squad sugerido: **plataforma**. O núcleo do que a issue pede é o runtime do runner — como o estado de uma atividade é guardado, lido e compartilhado entre execuções —, que é o escopo de plataforma (a memória vive no runner e é montada no prompt das etapas). Uma parte da entrega pode acabar tocando a tela de execução, mas a decisão e a implementação são do runtime.
