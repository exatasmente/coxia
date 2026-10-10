# Revisão: a fila de sugestões fica pendente de um conserto do app

## O que foi revisado

Esta revisão conferiu a entrega de fechamento das sugestões pendentes contra a especificação, o plano e a nota de implementação, e confirmou no código da worktree o mecanismo do defeito que impede cumprir os critérios 1 e 2 da especificação. A entrega não mudou nenhuma linha de código: é uma operação de condução no app, e o que ela registra está correto.

## O que confere

- Contagem confirmada: exatamente 10 cartões de sugestão à espera (6 do lote de 07/10, 4 do de 09/10), lidos do arquivo de ações do espaço de trabalho; a contagem da issue (6) ficou desatualizada.
- Decisão de fechamento confirmada pela pessoa: recusar as 10 em bloco, cada uma com o motivo fixo já registrado na nota de implementação; nenhuma aceita ou editada.
- Caminho de gravação correto: a decisão só se grava pela tela de sugestões do app; editar o arquivo de sugestões à mão é proibido, e a entrega não o usou.
- A parte das 8 execuções `failed` de 07/10 está de fora, coberta pela issue #188, conforme a especificação e o plano.
- Critério 4 (contagem registrada junto do resultado) está cumprido na nota de implementação.
- Nenhuma linha de código mudou na entrega, e os portões do repositório seguem desnecessários.

## Defeito confirmado no código

Os três caminhos de decisão consultam apenas um registro em memória: recusar (`src/main/suggestionsModule.ts:214`), editar (`:225`) e aceitar (`:235`) fazem `waiting.get(suggestionId)` e, sem registro, lançam o erro `main.suggestions.unknown` — "suggestion {id} is not waiting any more" (`i18n/main.en.json`), exatamente o erro visto na tentava de execução. O registro em memória é preenchido na geração da proposta e se perde quando o app reinicia; os cartões, porém, persistem no arquivo de ações. Todo cartão pendente de sessão anterior fica indeterminado por qualquer caminho da tela, e a fila não fecha.

Não há fallback ao cartão: o único uso secundário é em `rejectSuggestion` (linhas 218–219), para marcar a ação como dispensada. O conserto é viável no código atual: o cartão de ação do tipo `suggest-agent` carrega a proposta completa — `suggestionId`, nome, papel, etapa, prompt, evidência, `rejectedBefore` — acessível por `suggestionOf` (`src/shared/suggestions.ts:28`); o renderer já a lê em `SuggestionCard.tsx`; e `acceptWaiting` já recebe a ação inteira. Esse defeito é a mesma família do erro das 8 execuções `failed` que a issue #188 investiga.

## Encaminhamento confirmado

Confirmado que não existe hoje, no app, outro caminho para decidir cartões de sessões anteriores. O caminho acordado é: registrar uma issue nova para o conserto (reaver a proposta do próprio cartão de ação via `suggestionOf` quando o registro em memória não a tiver, cobrindo recusa, edição e aceite, e relacionar com a #188), deixar o fechamento da fila desta issue esperando esse conserto e encerrar a issue pendente, com a nota de fechamento dizendo a contagem confirmada (10), a decisão confirmada (recusar em bloco, motivo fixo), o bloqueante confirmado no código e o encaminhamento na issue nova. Depois do conserto, o caminho já aprovado vale sem mudança: recusar os 10, um por vez, e reabrir a tela conferindo que nenhum segue à espera; o critério 3 da especificação (sugestões aceitas aparecem como resultado do fluxo) se cumpre trivialmente no desfecho decidido, pois todas são recusadas e nada é criado.

## Não verificado nesta revisão

- A tela viva do app contra os dados reais: tudo sobre ela vem do relato da pessoa e das leituras de arquivo.
- Se a tela de Ações permite dispensar (skip) um cartão diretamente; mesmo que permita, dispensa sem gravar decisão com motivo, então não fecha os critérios 1 e 2 por aí.
- O conteúdo completo de prompt e evidência de cada cartão (visível só na tela).

## Veredito

Aprovado. Nada da entrega bloqueia: a entrega registra corretamente o fechamento e não mudou código. O bloqueio que impediu a execução das recusas é um defeito do app, externo à entrega, e segue o encaminhamento acordado: issue nova do conserto, fechamento da fila pendente até ele. O fechamento do ciclo depende, porém, de ação fora da entrega: a criação da issue nova e o encerramento pendente da issue; se a issue nova não for criada, o rastro do encaminhamento fica incompleto.
