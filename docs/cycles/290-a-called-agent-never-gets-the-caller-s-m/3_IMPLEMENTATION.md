# Implementação: o chamado lê a mensagem e a conversa não trava mais

Nenhum comando foi permitido a quem implementou: typecheck, vitest e os demais gates **não foram rodados** por esta etapa. A revisão anterior rodou tsc, vitest completo (9155 ok), i18n:lint e public-audit (passam); o theme-audit mostrou 17 ocorrências fora do diff.

## O que mudou

- `src/main/runner/conversation.ts`
  - A primeira mensagem do chamador (e cada seguinte) entra no prompt do chamado, cercada por `fence`. Turnos seguintes continuam a sessão (`resume`, com `mode: 'conversation'` para o nó do chamado não abrir um segundo `started`).
  - Turno sem `AskConversation` encerra a conversa; outro turno só começa se `ex.pendingFromCaller()` tiver mensagem. O limite de rodadas continua contando turnos.
  - `askConversation`: se `ex.callerWaiting()` e nada pendente, volta na hora com `callerWaiting`.
  - Abort local ligado ao da execução; tempo limite sem progresso = metade de `stageIdleMs` (piso de 30 s), sem campo novo de configuração.
  - Registro em `callStops` (thread da execução, thread própria se `place` for `new`, id do chamado), desregistro no `finally`.
  - `reason` ganha `stalled` e `stopped`, com linhas de sistema antes de `ended`.
- `src/main/runner/executor.ts` (`callAgent`): `pendingFromCaller`, `callerWaiting` (`writes`), retorno por `reason`, entrada de `conversationOf` removida ao fim; `forget()` retira o chamado da `chain`.
- i18n (en e pt-BR).
- `CHANGELOG.md`: **nesta passada**, a nota foi movida de `[0.11.0-beta.5] / Fixed` (versão já cortada) para `[Unreleased] / Fixed`; o texto não mudou.

## Testes

- `test/runner-conversation.test.ts`: assunto no prompt, um turno só, aviso imediato, mensagem seguinte na mesma sessão.
- `test/runner-conversation-stall.test.ts` (novo): limite, rearme por evento do modelo, parada por `callStops`.
- `test/runner-conversation-screen.test.ts` e `test/activity-calls.test.ts`: ajustados ao novo laço.
- `test/runner-send-call.test.ts`: `CallAgent` de chamado que escreve e pergunta no 1º turno volta sem travar; a chamada seguinte abre conversa nova.

## Verificado

Pela revisão anterior (rodado): tsc, vitest completo, i18n:lint, public-audit. Nesta passada só o CHANGELOG mudou; nada rodou. Que a nota está sob `[Unreleased]` foi conferido ao reler o arquivo editado.

## Não verificado / em aberto

- Gates desta passada (só documentação mudou).
- Caracterização do relógio de ociosidade (critério 8): teste não escrito; a causa dos 70 min segue hipótese.
- Teste do retorno `stalled`/`stopped` por `callAgent`: não escrito.
- Chave de `screenApi.stop(thread, agent)` contra `callStops`: não conferida.
- Duplicadas no tracker: não pesquisadas.
