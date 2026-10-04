# Chamado de um agente pela conversa: o que falta mostrar

## Que tipo de issue é

Pedido de funcionalidade, com o rótulo `enhancement`. Não é um defeito: o que a issue
aponta não é um comportamento errado, e sim um aviso que não existe. O que se pede é
que o sistema mostre, enquanto um agente chamado com `@` na conversa de um ciclo
trabalha, que o chamado foi recebido — na própria conversa, na tela do ciclo, no dock de
tarefas e no PWA.

## Dá para entender como está escrita

Dá para entender, e cada afirmação foi conferida no código. Só foi lido o código: nenhuma
tela foi aberta e nenhum fluxo foi executado nesta conferência.

Conferido na leitura:

- O chamado por `@` dentro da conversa de um ciclo roda sob o contexto de atividade
  `run:<runId>` (`answerMention`, `src/main/runner/service.ts:968`), e o dock mostra os
  chamados que nenhuma tarefa nomeada possui como uma única entrada com o rótulo genérico
  "Agente" (`activity.generic`, `src/shared/i18n/en.json:206`; `src/renderer/src/JobsDock.tsx:130`,
  `:254-259`; `src/renderer/src/useActivity.ts:40-49`), sem o nome do agente e sem vínculo
  com o ciclo.
- O painel de atividade ao vivo da tela do ciclo só aparece quando `run.status === 'working'`
  (`src/renderer/src/screens/cycle/RunScreen.tsx:170`).
- Os chamados de um mesmo ciclo esperam a vez, um por vez, e no máximo três agentes por
  mensagem: a fila serializa por `runId` (`src/main/runner/service.ts:854-857`) e o laço
  corta em `message.mentions.slice(0, 3)` (`src/main/runner/service.ts:944`).

Não verificado: se esse aviso transitório já existe sob alguma outra forma em outro lugar;
a busca não encontrou nada parecido. Também não verificado o comportamento real em tela
(conversa, tela do ciclo, dock e PWA).

## O que falta

Nada que só quem abriu possa dizer. A issue traz o problema, o que existe hoje com
evidência e o comportamento esperado nas quatro superfícies, além das restrições a
respeitar (o chamado continua somente leitura e mantém os limites de tempo e de silêncio
já existentes).

## O que parece duplicada ou relacionada

Nenhuma. A única outra issue registrada na pasta de ciclos deste repositório de trabalho
trata das propostas de melhoria da retro e não tem relação com este aviso.
