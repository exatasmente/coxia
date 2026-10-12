# Implementação: o chamado lê a mensagem e a conversa não trava mais

Nenhum comando foi permitido a quem implementou: typecheck, vitest e os demais gates **não foram rodados** nesta passada. A revisão anterior rodou tsc, vitest completo, i18n:lint e public-audit.

## O que mudou

- `src/main/runner/conversation.ts`
  - A primeira mensagem do chamador (e cada seguinte) entra no prompt do chamado, cercada por `fence`. Turnos seguintes continuam a sessão (`resume`).
  - Turno sem `AskConversation` encerra a conversa; outro turno só começa se `ex.pendingFromCaller()` tiver mensagem. O limite de rodadas continua contando turnos.
  - `askConversation`: se `ex.callerWaiting()` e nada pendente, volta na hora com `callerWaiting`.
  - Abort local ligado ao da execução; tempo limite sem progresso = metade de `stageIdleMs` (piso de 30 s), sem campo novo de configuração.
  - Registro em `callStops` (thread da execução, thread própria se `place` for `new`, id do chamado), desregistro no `finally`.
  - `reason` ganha `stalled` e `stopped`, com linhas de sistema antes de `ended`.
- `src/main/runner/executor.ts` (`callAgent`): `pendingFromCaller`, `callerWaiting` (`writes`), retorno por `reason`, entrada de `conversationOf` removida ao fim.
  - **Nesta passada:** `forget()` também retira o chamado da `chain` (`lastIndexOf` + `splice`, nunca o índice 0, que é o chamador). Antes, `chain.push(to)` nunca era desfeito e a segunda chamada ao mesmo agente era recusada como ciclo; isso deixava o teste novo de `callAgent` vermelho e falsa a nota do CHANGELOG.
- i18n (en e pt-BR), `CHANGELOG.md` (Fixed).

## Testes

- `test/runner-conversation.test.ts`: assunto no prompt, um turno só, aviso imediato, mensagem seguinte na mesma sessão.
- `test/runner-conversation-stall.test.ts` (novo): limite, rearme por evento do modelo, parada por `callStops`.
- `test/runner-conversation-screen.test.ts` e `test/activity-calls.test.ts`: ajustados ao novo laço.
- `test/runner-send-call.test.ts`: `CallAgent` de chamado que escreve e pergunta no 1º turno volta sem travar; a chamada seguinte abre conversa nova (dois turnos, cada prompt com seu assunto). Esse teste não mudou; a correção está no código.

## Verificado

Pela revisão anterior: tsc, i18n:lint e public-audit passam; vitest completo tinha só a falha de `runner-send-call` (causa lida: a cadeia). Nesta passada, **nada rodou**; que a correção da cadeia faz o teste passar é **não verificado**.

## Não verificado / em aberto

- `runner-send-call.test.ts` com a correção, tsc e vitest completo depois dela; theme-audit.
- Caracterização do relógio de ociosidade (critério 8): teste não escrito; a causa dos 70 min segue hipótese.
- Teste do retorno `stalled`/`stopped` por `callAgent`: não escrito.
- Chave de `screenApi.stop(thread, agent)` contra `callStops`: não conferida.
- Duplicadas no tracker: não pesquisadas.
