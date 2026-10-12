# Implementação: o chamado lê a mensagem e a conversa não trava mais

Nada foi executado nesta etapa nem na anterior por quem implementou (sem comandos permitidos): typecheck, testes e os demais gates **não foram rodados** por ela. A revisão rodou tsc, parte do vitest, i18n:lint e public-audit; esta passada corrigiu os testes apontados, só por leitura e edição.

## O que mudou

- `src/main/runner/conversation.ts`
  - A primeira mensagem do chamador (e cada seguinte) entra no prompt do chamado, cercada por `fence`. Turnos seguintes continuam a sessão (`resume`) e recebem só a mensagem.
  - Turno sem `AskConversation` encerra a conversa; outro turno só começa se `ex.pendingFromCaller()` já tiver mensagem. O limite de rodadas continua contando turnos.
  - `askConversation` do chamado: usa mensagem pendente, e se `ex.callerWaiting()` e nada pendente volta na hora com `callerWaiting`.
  - Abort local ligado ao da execução; tempo limite sem sinal de progresso = metade de `stageIdleMs` (piso de 30 s), rearmado por evento do modelo, comando, mensagem do chamador e `AskConversation`; pausa para comando esperando a pessoa. Sem campo novo de configuração.
  - Registro em `callStops` sob a thread da execução, a thread própria (se `place` for `new`) e o id do chamado; desregistro no `finally`.
  - `reason` ganha `stalled` e `stopped`, com linhas de sistema antes de `ended`.
- `src/main/runner/executor.ts` (`callAgent`): `pendingFromCaller`, `callerWaiting` (`writes`), retorno por `reason`, entrada de `conversationOf` removida ao fim.
- i18n (en e pt-BR), `CHANGELOG.md` (Fixed).

## Testes

- `test/runner-conversation.test.ts`: casos de assunto no prompt, um turno só, aviso imediato, mensagem seguinte na mesma sessão. Corrigido nesta passada: o teste do aviso imediato lê `.response` do resultado da ferramenta (antes comparava objeto com string, erro TS2352).
- `test/runner-conversation-stall.test.ts` (novo): limite, rearme por evento do modelo, parada por `callStops`. A revisão viu os 3 testes passarem.
- `test/runner-conversation-screen.test.ts`: a expectativa agora diz que o turno ouve o abort local (diferente do da execução, ainda não abortado).
- `test/activity-calls.test.ts`: o exchange do teste ganhou `pendingFromCaller` e o caso de várias rodadas passa uma segunda mensagem já pendente, pois turno sem pedido agora encerra.
- `test/runner-send-call.test.ts`: novo caso de `CallAgent` para chamado que escreve e pergunta no primeiro turno: a chamada volta sem travar, e a chamada seguinte abre conversa nova (o motor do chamado roda duas vezes, cada prompt com seu assunto).

## Verificado

Pela revisão anterior (não por esta passada): i18n:lint e public-audit passam. Nesta passada, nada rodou.

## Não verificado / em aberto

- Que os testes corrigidos e o novo passam, e tsc, vitest completo, theme-audit (17 ocorrências, sem comparação com a base).
- Caracterização do relógio de ociosidade (critério 8) e a causa dos 70 min: teste **não escrito**; o tempo limite da conversa, menor que a ociosidade, cobre o travamento, mas a causa segue hipótese.
- Teste do retorno de `stalled`/`stopped` por `callAgent` (exige timers falsos no executor): não escrito.
- Chave de `screenApi.stop(thread, agent)` contra o registro em `callStops`: não conferida.
- Duplicadas no tracker: não pesquisadas.
