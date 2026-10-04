# Triagem: @ chamando um agente onde a pessoa escreve

## Tipo

Pedido de funcionalidade (enhancement). Não relata defeito, não é pergunta e não repete outra issue: pede que `@agente` deixe de só chamar um agente do time dentro da thread de uma execução e passe a valer em todo lugar onde a pessoa escreve.

## Dá para entender como está escrita

Dá. É um pedido de comportamento novo; não há defeito a reproduzir. O que a issue descreve do estado atual confere com o código:

- As menções são resolvidas em toda thread, não só na de uma execução: `personPost` chama `parseMentions` sobre qualquer texto postado (`src/main/forum.ts:33-38`, no tratador `forum:post` em `src/main/forum.ts:62-65`).
- Mesmo assim, só uma thread de execução é atendida: a assinatura de mensagens do runner descarta tudo que não começa com `run-` (`src/main/runner/service.ts:851-861`) antes de enfileirar `answerMention` (`src/main/runner/service.ts:938`).
- A tela mostra o rótulo de chamada a partir das menções da mensagem, sem olhar se algum agente foi de fato acionado (`src/renderer/src/screens/cycle/Thread.tsx:78`, texto em `src/shared/i18n/ui-cycle.en.json:269`).
- O aviso do compositor diz que, num canal, o `@` não chama agente (`src/renderer/src/screens/cycle/Thread.tsx:254,282`; texto em `src/shared/i18n/ui-cycle.en.json:277`).
- As cerimônias mandam o texto digitado direto ao agente do sistema, sem tratar menção: retro (`src/renderer/src/screens/RetroScreen.tsx:86`), reentrada (`src/renderer/src/screens/Reentry.tsx:170`), handoff de QA (`src/renderer/src/screens/QaHandoff.tsx:173`), resposta livre de gate (`src/renderer/src/screens/Gate.tsx:136`). Nenhuma tela fora da thread usa `parseMentions`.
- Um `@nome` que não corresponde a nenhum agente do time fica como texto comum: `parseMentions` só guarda ids que o time tem (`src/shared/forum.ts:147-155`). Hoje não há como dizer que o nome é desconhecido.

Verificação: leitura da issue, do código e dos documentos do ciclo. Nada foi executado no aplicativo e o comportamento novo não foi visto funcionando; o estado atual foi conferido apenas por leitura.

## O que falta

Nada que a triagem precise ouvir de quem abriu para seguir. As decisões que a própria issue adia (se um nome falado numa cerimônia de voz chama um agente ou se só o `@` digitado chama; o que um agente lê num canal sem squad; e se respostas num canal são alguma vez espelhadas no rastreador) são de refino, não de quem abriu.

## Issues relacionadas

- A issue citada no próprio pedido, sobre o lugar mostrar que o agente está trabalhando enquanto responde: é a peça que este pedido quer levar a todos os lugares. Não é duplicata.
- O ciclo anterior deste repositório sobre permissões de agente, que fixa que um agente chamado por `@` responde somente leitura, sem shell próprio: este pedido mantém esse mesmo limite. Não é duplicata.
- Nenhuma issue parece duplicar esta.
