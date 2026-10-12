# Implementação: o chamado lê a mensagem e a conversa não trava mais

Nenhum comando foi permitido a quem implementou: typecheck, vitest e os demais gates **não foram rodados** por esta etapa. A revisão anterior rodou tsc, i18n:lint e public-audit (passam) e o vitest da área (só `activity-calls` falhava).

## O que mudou

- `src/main/runner/conversation.ts`
  - A primeira mensagem do chamador (e cada seguinte) entra no prompt do chamado, cercada por `fence`. Turnos seguintes continuam a sessão (`resume`).
  - Turno sem `AskConversation` encerra a conversa; outro turno só começa se `ex.pendingFromCaller()` tiver mensagem. O limite de rodadas continua contando turnos.
  - `askConversation`: se `ex.callerWaiting()` e nada pendente, volta na hora com `callerWaiting`.
  - Abort local ligado ao da execução; tempo limite sem progresso = metade de `stageIdleMs` (piso de 30 s), sem campo novo de configuração.
  - Registro em `callStops` (thread da execução, thread própria se `place` for `new`, id do chamado), desregistro no `finally`.
  - `reason` ganha `stalled` e `stopped`, com linhas de sistema antes de `ended`.
  - **Nesta passada:** o `resume` do turno seguinte passa `mode: 'conversation'`. Causa lida em `agents.ts` (~:1762): sem `mode`, uma chamada com `resume` deixa a atividade em `started` (é o modo "rodada de etapa"), o que abria um segundo `started` no nó do chamado. Com `conversation`, a resposta fecha o nó como qualquer chamada, e a sessão chega ao motor por `extra` (~:1675).
- `src/main/runner/executor.ts` (`callAgent`): `pendingFromCaller`, `callerWaiting` (`writes`), retorno por `reason`, entrada de `conversationOf` removida ao fim; `forget()` retira o chamado da `chain` (a revisão confirmou que `runner-send-call` passa).
- i18n (en e pt-BR), `CHANGELOG.md` (Fixed).

## Testes

- `test/runner-conversation.test.ts`: assunto no prompt, um turno só, aviso imediato, mensagem seguinte na mesma sessão.
- `test/runner-conversation-stall.test.ts` (novo): limite, rearme por evento do modelo, parada por `callStops`.
- `test/runner-conversation-screen.test.ts` e `test/activity-calls.test.ts`: ajustados ao novo laço.
- `test/runner-send-call.test.ts`: `CallAgent` de chamado que escreve e pergunta no 1º turno volta sem travar; a chamada seguinte abre conversa nova.
- `test/activity-calls.test.ts` ("keeps one node for several rounds…"): expectativa `['started','finished']` mantida; a correção está no código (`mode: 'conversation'`), não no teste.

## Verificado

Pela revisão anterior (rodado): tsc, i18n:lint, public-audit; vitest da área 45 ok e 1 falha (`activity-calls`). Nesta passada **nada rodou**: que `mode: 'conversation'` remove o segundo `started` é leitura do código, **não verificado** por execução.

## Não verificado / em aberto

- `activity-calls` com a correção, vitest completo (e o `runner-send-call` junto), theme-audit.
- Caracterização do relógio de ociosidade (critério 8): teste não escrito; a causa dos 70 min segue hipótese.
- Teste do retorno `stalled`/`stopped` por `callAgent`: não escrito.
- Chave de `screenApi.stop(thread, agent)` contra `callStops`: não conferida.
- Duplicadas no tracker: não pesquisadas.
