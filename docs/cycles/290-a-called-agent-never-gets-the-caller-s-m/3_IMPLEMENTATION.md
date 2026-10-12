# Implementação: o chamado lê a mensagem e a conversa não trava mais

Nada foi executado nesta etapa (sem comandos permitidos): typecheck, testes e os demais gates **não foram rodados**. O que segue é o que foi escrito e lido.

## O que mudou

- `src/main/runner/conversation.ts`
  - A primeira mensagem do chamador (e cada seguinte) entra no prompt do chamado, cercada por `fence`. Turnos seguintes continuam a sessão (`resume`) e recebem só a mensagem.
  - Turno sem `AskConversation` encerra a conversa; outro turno só começa se `ex.pendingFromCaller()` já tiver mensagem. O limite de rodadas continua contando turnos.
  - `askConversation` do chamado: usa mensagem pendente, e se `ex.callerWaiting()` e nada pendente volta na hora com `callerWaiting`.
  - Abort local ligado ao da execução; tempo limite sem progresso = `stallLimitMs` (metade de `stageIdleMs`, piso de 30 s), rearmado por evento do modelo (`beat`), comando (`clock.beat`), mensagem do chamador e `AskConversation`; `pause` (comando esperando a pessoa, pergunta de limite de turnos) para o relógio. Sem campo novo de configuração.
  - Registro em `callStops` sob a thread da execução, a thread própria (se `place` for `new`) e o id do chamado; desregistro no `finally`. `deps.stops` permite injetar nos testes.
  - `reason` ganha `stalled` e `stopped`, com linhas de sistema `runner.conversation.stalled|stopped` antes de `ended`. O turno corre contra a parada, para soltar o chamador mesmo se o motor ignorar o abort.
- `src/main/runner/executor.ts` (`callAgent`): `pendingFromCaller` (lê `pending` sem esperar) e `callerWaiting` (`writes`); chamado que escreve devolve o aviso de falta de progresso ou de parada conforme `reason`; chamado que só lê posta o aviso na inbox; a entrada de `conversationOf` é removida ao fim (conversa nova na chamada seguinte).
- i18n (en e pt-BR): `main.runner.conversation.message|callerWaiting|reason.stalled|reason.stopped`, `main.runner.tools.conversationStalled|conversationStopped`, `main.forum.code.runner.conversation.stalled|stopped`.
- `CHANGELOG.md`: entrada em Fixed.
- Testes: `test/runner-conversation.test.ts` (helper `exchange` ganhou `pendingFromCaller`/`callerWaiting`; casos de assunto no prompt, um turno só, aviso imediato, mensagem seguinte na mesma sessão) e novo `test/runner-conversation-stall.test.ts` (limite, rearme por `beat`, parada por `callStops`).

## Verificado

Só por leitura do código. Nenhum teste, typecheck ou gate rodou.

## Não verificado / em aberto

- Todos os cinco gates do AGENTS.md (`tsc`, `vitest`, `theme-audit`, `i18n:lint`, `public-audit`) e o comportamento dos testes novos e dos existentes.
- Causa de o relógio de ociosidade não disparar em 70 min: o teste de caracterização (critério 8) **não foi escrito**; `answered` continua rearmando o relógio como antes. O tempo limite da conversa (menor que a ociosidade) cobre o travamento, mas a causa não está confirmada.
- Se a chave de `screenApi.stop(thread, agent)` bate com o registro (thread da execução + id do chamado): não conferido.
- Teste de `callAgent` (retorno de falta de progresso e conversa nova na chamada seguinte) em `runner-send-call.test.ts`: não escrito.
- Duplicadas no tracker: não pesquisadas.
