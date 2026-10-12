# Plano técnico: chamada entre agentes que entrega a mensagem e nunca trava a etapa

Base: 1_SPEC.md (regras 1 a 8, critérios 1 a 8). Tudo abaixo foi lido no código; nada foi executado. O que depende de teste está marcado como **não verificado**.

## O que existe hoje (lido)

- `src/main/runner/conversation.ts`, `runConversation`: pega a primeira mensagem (`nextFromCaller`, ~:188), só a posta na thread (~:190) e entra num laço (~:220-243) que chama `turnOf` até o limite de rodadas, sem esperar o chamador. `turnOf` (~:278) monta o prompt só com `main.runner.conversation.system|systemWrite` e os índices (~:331); a mensagem não entra. Mensagens seguintes chegam como retorno de `askConversation` (~:294-303). O relógio da conversa (`clock`, ~:153) é todo no-op.
- `src/main/runner/executor.ts`, `callAgent` (~:1119-1205): `incoming` (~:1137) só devolve o que `entry.say` (chamada seguinte do chamador) empilhou, ou `null` se abort/`inbox.isClosing`. Com chamado que escreve (`writes`), `callAgent` faz `await runConversation(...)` (~:1190): o chamador fica dentro da ferramenta e nunca chama de novo, então o `AskConversation` do chamado espera para sempre. `answered` = `inbox.post`.
- `watchdog` (~:300): o relógio de ociosidade rearma em `beat()` e para em `pause()`. `call.beat` do estágio é chamado por eventos do modelo e pela entrega de mensagem (`call.incoming` -> `delivered`, e `agents.ts` ~:838 escreve atividade). **Hipótese não verificada:** as respostas repetidas do chamado entram na inbox do chamador e a entrega delas conta como sinal de vida.
- `src/main/mentions/stop.ts` (`callStops`) só tem o que menções/persona registram (`mentions/answer.ts:280`). `runs:callStop` (`runner/module.ts:381`) usa só ele; a tela chama `screenApi.stop(thread, agent)` (`renderer/.../screenApi.ts:19`, `Thread.tsx:79`).
- Testes: `test/runner-conversation.test.ts` (round limit, fim sem resposta, thread nova; helper `exchange`), `test/runner-conversation-screen.test.ts`, `test/qa-conversation-commit.test.ts`, `test/runner-send-call.test.ts`, `test/activity-calls.test.ts`.

## Decisões

1. **Primeira mensagem no prompt.** `turnOf` recebe a mensagem a entregar e a coloca no prompt (cercada por `fence`) depois do texto de sistema. Motivo: é o que o chamado lê; não depende da ferramenta.
2. **Turno sem `AskConversation` encerra a conversa** (regra 3). Só começa outro turno se já houver mensagem do chamador pendente (sem esperar): `ConversationExchange` ganha `pendingFromCaller?(): string | null` (não bloqueia). O novo turno recebe a mensagem no prompt e **continua a sessão** (`resume: { session, engine }`, como `askAgain` faz em `executor.ts:733`) em vez de repetir o histórico. O limite de rodadas continua contando turnos.
3. **Anti-espera circular por aviso imediato, não por responder ao chamador.** Motivo: o chamador está dentro da ferramenta e só tem texto de ferramenta para receber; responder por ele exigiria um segundo agente. `ConversationExchange` ganha `callerWaiting?(): boolean`; o executor devolve `true` para chamado que escreve. Em `askConversation`, depois de postar o texto, se `callerWaiting()` e não há mensagem pendente, retorna na hora `t('main.runner.conversation.callerWaiting')` ("o chamador está esperando a sua resposta; dê-a agora") sem esperar. O turno então termina com a resposta e a conversa encerra (decisão 2). Chamado que só lê segue como hoje (o chamador roda ao lado), coberto pelo tempo limite.
4. **Tempo limite sem progresso fixo, derivado:** metade de `config.runner.stageIdleMs` (5 min no padrão de 10), com piso de 30 s. Motivo: menor que a ociosidade da etapa, como pede o refino; **sem campo novo de configuração**, o que evita migração (`STEPS`) e os três arquivos (`types.ts`, `defaults.ts`, `schema.ts`). Se a pessoa quiser configurável, é outro ciclo. Progresso = evento do modelo do chamado (`call.beat` do `AgentCall`), comando na sessão (o `clock.beat` do `ConversationClock`, hoje no-op, passa a rearmar), mensagem nova do chamador, ou `AskConversation`. Esperar o chamador sem mensagem não é progresso.
5. **Parada.** `runConversation` cria um `AbortController` local ligado ao `deps.abort`; ele é o abort dos turnos, da sessão e do relógio. A conversa se registra em `callStops` (injetável por `deps.stops`, padrão `callStops`) sob a thread da execução e o id do chamado (e também sob a thread própria quando `place` é `new`) e se desregistra no `finally`. Assim `runs:callStop` e a tela passam a achar a conversa e respondem `true`.
6. **Fim distinto.** `ConversationResult.reason` ganha `'stalled'` e `'stopped'`, cada um com linha de sistema (`runner.conversation.stalled` com o motivo e os minutos) antes de `runner.conversation.ended`. O `ended` continua sendo escrito, com `why` novo (`main.runner.conversation.reason.stalled|stopped`). A confirmação do trabalho do chamado (`deps.commit`) segue o fim normal (regra 6). O turno corre contra uma promessa de parada, para soltar o chamador mesmo se o motor do chamado ignorar o abort.
7. **Retorno ao chamador.** No `callAgent` do executor, para chamado que escreve, o texto devolvido depende de `r.reason`: `stalled` -> `main.runner.tools.conversationStalled` (diz que a conversa terminou por falta de progresso); `stopped` -> `conversationStopped`; demais -> o texto atual. Para o chamado que só lê, o `.then` já existente passa o mesmo aviso como mensagem na inbox (`inbox.post`).
8. **Entrada de conversa terminada.** Hoje `conversationOf` guarda `say` de uma conversa já encerrada e a mensagem seguinte some em `pending`. Passa a remover a entrada ao fim, para a chamada seguinte abrir conversa nova (conta no limite por etapa). Pequena correção na mesma área, necessária para a regra 2 não perder mensagem.
9. **Relógio de ociosidade (regra 8).** Primeiro passo é o teste de caracterização (abaixo). Com o tempo limite da decisão 4 (< ociosidade) a conversa termina antes de a etapa expirar, então o travamento sai por esse caminho, qualquer que seja a causa. Se o teste confirmar que a entrega das respostas do chamado (`inbox.post` -> `call.incoming`) rearma o relógio sem trabalho do chamador, o `answered` do chamado que escreve deixa de contar como sinal de vida (a mensagem entra, o relógio não é rearmado). **Não verificado**; decide-se no teste, não por suposição.

## Mudanças (arquivo e função), na ordem

1. `test/runner-conversation.test.ts`, `test/runner-send-call.test.ts` (ou arquivo novo `test/runner-conversation-stall.test.ts`): escrever primeiro os testes vermelhos da seção seguinte, incluindo a caracterização do relógio (critério 8) para fechar a hipótese.
2. `src/main/runner/conversation.ts`:
   - `ConversationExchange`: `pendingFromCaller?`, `callerWaiting?`.
   - `ConversationResult.reason`: `'ended' | 'rounds' | 'stalled' | 'stopped'`.
   - `runConversation`: abort local, registro em `callStops`, temporizador de progresso (`progress()` rearma; `clock.beat` e `call.beat` ligados a ele), corrida do turno com a parada, linhas de sistema, laço novo (decisão 2) com `resume`.
   - `turnOf`: parâmetro da mensagem a entregar no prompt; `askConversation` com `callerWaiting`; devolver a sessão (`r.sessionId`, `r.engine`) para o próximo turno.
3. `src/main/runner/executor.ts`, `callAgent`: passar `callerWaiting: () => writes` e `pendingFromCaller` (lê `pending` sem esperar); retorno por `r.reason`; remover a entrada de `conversationOf` ao fim; ajuste de `beat` só se o teste da decisão 9 mandar.
4. i18n nos dois catálogos (`src/shared/i18n/main.en.json` e `main.pt-BR.json`): `main.runner.conversation.callerWaiting`, `.message` (cabeçalho da mensagem no prompt), `.reason.stalled`, `.reason.stopped`, `main.runner.tools.conversationStalled`, `.conversationStopped`, `main.forum.code.runner.conversation.stalled`, `.stopped`. Ajustar `systemWrite`/`system` para dizer que a mensagem vem abaixo.
5. `CHANGELOG.md` (Unreleased, seção de correções): chamado recebe a mensagem, conversa não espera por si mesma, tempo limite sem progresso, parada da conversa.
6. `AGENTS.md`: sem mudança prevista (nenhuma instrução universal fica falsa).
7. Verificar a tela: `Thread.tsx` agrupa por thread/agente; conferir se a chave usada em `screenApi.stop` bate com o registro da decisão 5 (**não verificado**; se não bater, ajustar o registro, não a tela). Textos novos de tela, se houver, via `t()`.

## Testes (um por comportamento)

Todos com motor de mentira e `createForumStore` real, como o arquivo existente.

| Critério | Teste | Arquivo |
|---|---|---|
| 1 | chamado que escreve com assunto: o prompt do primeiro turno contém o assunto | `test/runner-conversation.test.ts` |
| 2 | chamado que escreve chama `AskConversation` no 1º turno com chamador aguardando: retorna na hora com o aviso, a conversa encerra e `runConversation` resolve (sem timers longos) | `test/runner-conversation.test.ts` |
| 3 | chamado que responde sem pedir mais: exatamente 1 chamada do motor, linha `ended`; com mensagem pendente, 2º turno com `resume` da sessão | `test/runner-conversation.test.ts` (ajusta o teste de limite de rodadas para ter mensagem pendente) |
| 4 | sem progresso: timers falsos avançam o limite; `reason: 'stalled'`, linha de sistema `runner.conversation.stalled`, `ended` escrito, motor que ignora o abort é solto | `test/runner-conversation-stall.test.ts` |
| 4b | evento do modelo (`call.beat`) e comando rearmam o limite | idem |
| 5 | conversa travada + `callStops.stop(thread, agent)`: responde `true`, conversa termina `stopped`; depois responde `false`; registro some no fim | idem |
| 6 | mensagem seguinte vira retorno de `AskConversation` na mesma sessão e a conversa continua | `test/runner-conversation.test.ts` |
| 7 | chamado que só lê: segue ao lado da etapa; suítes existentes (`runner-send-call`, `activity-calls`, `qa-conversation-commit`, `runner-conversation-screen`) continuam verdes | arquivos existentes |
| 8 | etapa com chamado travado expira no limite de ociosidade configurado (timers falsos); caracteriza se a entrega das respostas rearma o relógio | `test/runner-send-call.test.ts` |
| callAgent | `CallAgent` de chamado que escreve devolve a mensagem de falta de progresso; chamada seguinte a uma conversa terminada abre conversa nova | `test/runner-send-call.test.ts` |
| i18n | `npm run i18n:lint` com as chaves novas nos dois catálogos | gate |

## Riscos e como se evitam

- **O tempo limite corta conversa de chamado lento que está trabalhando.** Rearmar por evento do modelo e por comando; teste 4b. Piso de 30 s.
- **Chamado que só lê e espera o chamador por mais de 5 min é encerrado.** Aceito pela regra 5; a próxima chamada abre conversa nova (decisão 8). Registrado como comportamento novo no CHANGELOG.
- **Mudar o laço quebra testes de limite de rodadas e de conversa por menção.** O limite continua contando turnos; os testes existentes são ajustados só onde dependiam do laço sem espera (um teste), os demais rodam sem mudança. `mentions/*` não usa `runConversation` (conferido por busca em `callStops`/`runConversation`; **não verificado** em profundidade).
- **Corrida entre parada e fim normal** (duplo `ended`). Uma bandeira `finished` no `runConversation` garante uma só linha de fim.
- **Registro em `callStops` vaza** se a conversa lançar. Desregistro no `finally`, coberto no teste 5.
- **Fronteira de segurança:** nenhuma escrita nova no host de código; o commit continua pelo mesmo `deps.commit`. `actions.ts` e `webPolicy.ts` não mudam.
- **Repositório público:** testes e textos sem nomes reais; agentes de exemplo (`developer`, `qa`).

## Critérios que o plano não cobre

- Causa exata de o relógio não disparar em 70 min: só a hipótese; o teste da decisão 9 decide. Se a causa for outra, o plano precisa de um passo a mais (volta ao tech lead).
- Tempo limite configurável: fora (decisão 4).
- Issues duplicadas no tracker: não pesquisadas.
- Interface: nenhuma tela nova; a parada pela tela depende do item 7 (não verificado).

## Gates antes de concluir

`npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`. Nenhum foi rodado nesta etapa.
