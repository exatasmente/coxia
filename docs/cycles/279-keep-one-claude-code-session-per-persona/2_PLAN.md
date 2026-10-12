# Plano: retomar a sessão do Claude Code na conversa com a persona

Tudo abaixo vem de leitura do código. Nada foi executado nesta etapa. O que depende do comportamento real do SDK está marcado como **não verificado**.

## O que a leitura mostrou

- Todo caminho que faz a persona responder passa por `chain` em `src/main/mentions/module.ts`, que chama `answerMentions` (`src/main/mentions/answer.ts`): mensagem da pessoa (`accept`), acordar agendado (`wake` -> `accept`) e mensagem segurada pela parada (`personaStop().hold({ start: () => chain(...) })`, que reentra em `chain`). Um único ponto de mudança cobre as regras 1, 4 e 5 da spec.
- A chamada ao motor é `deps.engine(call, [])` (`answer.ts` ~468). `mentionCall` (`src/main/mentions/call.ts`) não define `resume`, e o prompt da persona leva `thread.slice(-40)` inteiro (~218). O id da sessão volta em `r.sessionId`.
- `AgentCall.resume?: { session, engine }` já existe (`agents.ts` ~1518) e vira `request.resume` (~1658), `withBudgetFallback.resumeEngine` e `withPool.resume`. Hoje só o uso de "rodada" o preenche, e por isso `runAgent` deixa a atividade em `started` quando há `call.resume` (~1727). **Uma conversa retomada precisa terminar `finished`**; sem isso a linha da persona ficaria "trabalhando" para sempre.
- `runClaudeSdk` (`agents.ts` ~783) passa `resume` ao SDK por `sdkOptions`/`extra` (não confirmei a linha exata do repasse). `noteSession` já ignora sessão retomada (`resumed = req.resume !== undefined`), então o índice de sessões não duplica.
- Já existe precedente de estado da persona em arquivo na pasta do workspace, fora da configuração: `persona-latch.json` (`src/main/persona/latch.ts`, escrita atômica, versão, leitura tolerante). Segui esse molde.
- Não verificado: o que o SDK real devolve para um id inexistente (provavelmente um resultado de erro antes de qualquer mensagem do assistente). O plano não depende do texto do erro, só de _quando_ ele aparece (ver Decisão 4).

## Decisões

1. **Guardar por conversa, em arquivo próprio, sobrevivendo ao reinício.** Novo `src/main/persona/sessionKeep.ts`, arquivo `persona-sessions.json` ao lado do latch, `{ v: 1, threads: { [thread]: { session, engine, provider, upTo } } }`. Motivo: a spec sugere sobreviver; um arquivo à parte não mexe em `types.ts`/`defaults.ts`/`schema.ts` nem exige passo em `STEPS` (não é configuração), e um app mais antigo ignora o arquivo. Arquivo ausente, corrompido ou de outra versão = nenhuma sessão guardada (cai em sessão nova, nunca erro). Escrita atômica (temporário + rename); falha de disco só é logada.
2. **Só persona real e só o motor `claude-sdk`.** A sessão é guardada quando `persona && !isDraft(def)` e a resposta veio de `claude-sdk`. A cópia de teste da persona, as outras conversas e o motor `open` não mudam (regra 6; o `open` já tem transcrição própria e não ganha nada barato aqui: fica fora).
3. **Quando retomar.** A sessão guardada só é usada se `provider` guardado == provedor resolvido da persona agora e `engine` == `claude-sdk` (critério 3: trocar o provedor abre sessão nova). Também não é usada se `upTo` for maior que o último `seq` da conversa (conversa esvaziada). A comparação usa a mesma resolução que `runAgent` faz (`rc().agentModel(call.agent.model)`): exportar de `agents.ts` um auxiliar pequeno `engineTargetOf(agent)` com `{ engine, providerId }`, em vez de duplicar a lógica.
4. **Cair em sessão nova dentro de `runAgent`, não em `answer.ts`.** Motivo: `runAgent` marca a atividade como `failed` ao capturar um erro, e uma segunda tentativa feita por fora ficaria sob um nó já falho. Desenho:
   - `runClaudeSdk`: se `req.resume` está definido e a chamada falha **antes de qualquer mensagem `assistant` ou uso de ferramenta** (erro do `query`, ou resultado que não é sucesso sem texto/ferramenta), lança o novo `SessionGoneError` (`engine/contract.ts`). Orçamento e limite de uso continuam lançando `ProviderBudgetError`, e `EngineBusyError` continua como está (ambos já são tratados antes). Depois que o modelo escreveu ou usou ferramenta, o erro segue como hoje e **nunca** se repete, porque a persona age por ferramentas e repetir duplicaria atos.
   - `runAgent`: em `attempt`, o `runnerFor(picked)(current)` captura `SessionGoneError` quando `call.resume.fallback` existe e roda uma vez mais sem `resume`, com `call.resume.fallback.prompt`. `call.text?.restart()` já limpa o texto ao vivo.
   - `AgentCall.resume` ganha `mode?: 'round' | 'conversation'` (padrão `round`, o uso atual) e `fallback?: { prompt: string }`. No `mode: 'conversation'` a atividade termina `finished` (ajuste em ~1727) e a falha da retomada não aparece em lugar nenhum. `withBudgetFallback`/`withPool` continuam recebendo `resume.engine`.
   - Efeito colateral aceito: um erro de rede real antes de qualquer saída também gera uma segunda tentativa em sessão nova. É inofensivo (nada foi feito) e, se a segunda também falha, o erro dela é o que a conversa mostra, como hoje.
5. **O que o prompt envia com sessão retomada.** A sessão já contém o que foi dito até a última resposta; reenviar as 40 mensagens duplicaria o contexto e o custo. Com `resume`, a seção da conversa leva só as mensagens com `seq > upTo` e diferentes da mensagem atual (falas de outros, linhas do app, botões, a parada). O restante do prompt (arquivos, memória, procedimentos, a mensagem) segue igual, e o `system` é reenviado a cada chamada como hoje. O prompt de reserva (`fallback.prompt`) é montado com a conversa completa de hoje (`slice(-40)`), o que cumpre a regra 8. Em `answer.ts`, montar o input uma vez e chamar `mentionCall` duas vezes (uma por prompt); a função é pura. Texto novo da seção "desde a sua última resposta" entra nos dois catálogos de prompts (`cp`) e no de i18n se a chave for de interface; sem cor nem texto solto.
6. **Quando guardar.** Só depois que a resposta foi postada (`posted`), com `{ session: r.sessionId, engine, provider, upTo: seq da resposta postada }`. Uma resposta interrompida pela parada ou que falhou não troca a sessão guardada: a mensagem seguinte retoma a anterior e recebe, na seção da conversa, o que veio depois dela (inclusive a fala parada). `deps.forum.append` devolve a mensagem postada, de onde sai o `seq`.
7. **Sem limite novo de contexto.** A issue não pede. O CLI compacta a conversa sozinho (comportamento do Claude Code, **não verificado** aqui). Um limite fica para outra entrega se aparecer custo ou lentidão.
8. **Segurança e auditoria.** `resume` só repete o transcrito; as ferramentas, a porta, a parada e a auditoria continuam entrando por `call.runnerTools`/`actSession` montados a cada chamada, como hoje. Nenhum caminho novo de escrita no host de código (tudo continua por Actions). Nenhum id de sessão vai a log, a texto da conversa ou a fixture.

## Mudanças, por arquivo e função, na ordem

1. `src/main/engine/contract.ts`: classe `SessionGoneError` (sem dado sensível) ao lado de `MaxTurnsError`.
2. `src/main/agents.ts`:
   - `AgentCall.resume`: campos `mode` e `fallback`.
   - `runClaudeSdk`: lançar `SessionGoneError` quando há `req.resume` e a falha vem antes de qualquer saída do modelo (acompanhar um `sawOutput` ligado em `assistant`/uso de ferramenta).
   - `runAgent` (`attempt`): reexecução única sem `resume`; `activity.status` final conforme `mode`.
   - Exportar `engineTargetOf`.
3. `src/main/persona/sessionKeep.ts` (novo): `readSessions(file)`, `createSessionKeep(file)` com `get(thread)`, `set(thread, entry)`, `clear(thread)`; escrita atômica; tolerante a arquivo ruim. `src/main/persona/runtime.ts`: acessor `personaSessions()` como `personaStop()` (`join(ATAS, 'persona-sessions.json')`).
4. `src/main/mentions/call.ts`: `mentionCall` aceita a conversa já filtrada e um rótulo de seção "desde a última resposta" quando retomada.
5. `src/main/mentions/answer.ts`: antes de `mentionCall` (~346), decidir se há sessão válida (Decisão 3) e calcular a conversa filtrada; definir `call.resume = { session, engine, mode: 'conversation', fallback: { prompt } }`; depois de `posted` (~477), gravar a sessão nova. Fica dentro do bloco `persona && !isDraft(def)`.
6. `CHANGELOG.md` (`Unreleased`): uma linha. `AGENTS.md`: sem mudança prevista (nenhuma instrução universal fica falsa).

Não há mudança em `src/main/schedules/fire.ts`, `src/main/persona/stop.ts` nem `src/main/mentions/module.ts`: a regra vive no ponto único de resposta.

## Testes (um por comportamento)

Todos com SDK falso (padrão de `test/persona-stream-sdk.test.ts`) ou motor falso, ids de sessão inventados (`s-a`, `s-b`), nada de `~/.claude`.

- `test/persona-session-keep.test.ts` (novo): guarda e relê por conversa; sobrevive a recriar o objeto (reinício); conversas distintas não se misturam; arquivo ausente, corrompido ou de versão desconhecida vira "nenhuma"; falha de escrita não lança.
- `test/persona-session-resume.test.ts` (novo, motor falso por `answerMentions`):
  - **Linha de base**: sem a mudança, três mensagens geram três chamadas sem `resume` (este teste, escrito primeiro, mostra a situação de hoje e falha depois da mudança; mostra a causa do relato). Com a mudança: a primeira sem `resume`, a segunda e a terceira com o id da primeira (critério 1).
  - Duas conversas, duas sessões (regra 2).
  - Provedor trocado: a mensagem seguinte não leva `resume` (critério 3).
  - Com sessão retomada, a seção da conversa leva só o que veio depois da última resposta; sem sessão, leva a conversa inteira (regra 8).
  - Uma resposta que falha ou é parada não troca a sessão guardada.
  - `upTo` maior que o último `seq`: sessão nova.
  - O motor `open` não recebe `resume` e nada é guardado (critério 6); os testes existentes ficam sem alteração.
- `test/engine-session-gone.test.ts` (novo, SDK falso de `runAgent`): com `resume`, resultado de erro antes de qualquer saída = nova tentativa sem `resume`, resposta normal, atividade `finished`, nenhum erro na conversa (critério 2); com ferramenta já usada, o erro **não** é repetido; erro de orçamento não é tratado como sessão perdida; `mode: 'round'` continua deixando a atividade em `started` (regressão do uso atual).
- `test/persona-schedules.test.ts` (existente, acrescentar): um acordar agendado continua a sessão da conversa e, sem sessão válida, abre nova sem erro (critério 4).
- `test/persona-stop.test.ts` ou `test/mentions-stop.test.ts` (existente, acrescentar): mensagem segurada pela parada e retomada segue a regra 1 e 3 (critério 5).
- Regressão: `test/persona-tools.test.ts`, `test/persona-audit.test.ts`, `test/persona-door.test.ts`, `test/persona-stop.test.ts`, `test/mentions-*.test.ts` e `test/persona-stream-sdk.test.ts` rodam sem alteração (critério 8).

## Riscos e como se evitam

- **Repetir um ato da persona** (a nova tentativa refaria uma ferramenta): a repetição só ocorre antes de qualquer saída do modelo ou uso de ferramenta; teste dedicado.
- **Linha da persona presa em "trabalhando"** por causa do `started` do modo rodada: o modo `conversation` termina `finished`; teste de regressão do modo `round`.
- **Erro do SDK real para sessão inexistente diferente do suposto**: a detecção depende só do momento da falha, não do texto. **Não verificado** contra o SDK real; a validação manual (ver abaixo) fica para a etapa de implementação/QA, fora da suíte, como já se fez para o limite de turnos.
- **Perder contexto** (mensagens entre respostas): a seção da conversa leva tudo o que passou de `upTo`; em sessão nova leva a conversa de hoje.
- **Sessão crescendo sem limite**: aceito (Decisão 7), citado como pergunta aberta, sem bloqueio.
- **Sessão removida pela retenção ou pela pessoa**: cai no fallback (critério 2).
- **Queda para o CLI quando o orçamento acaba** (`withBudgetFallback`): a sessão guardada pode passar a ser a do provedor de reserva; como `provider` é guardado, o próximo turno com provedor diferente abre nova sessão. Confirmar na implementação que o `provider` guardado é o do provedor que de fato respondeu.
- **Arquivo novo na pasta do workspace**: nenhuma migração e nenhum dado pessoal; contém só ids de sessão, que não entram em log, fixture nem conversa.

## Critérios da spec e cobertura

Todos os 8 critérios têm teste acima. O critério 1 ("contar sessões criadas na máquina") é coberto contando chamadas sem `resume` no SDK falso; a contagem em disco real é **não verificada** e fica para conferência manual com o Claude Code logado.

## Ordem de trabalho

1. Teste de linha de base (falha depois). 2. `SessionGoneError` + `runClaudeSdk` + `runAgent` com seus testes. 3. `sessionKeep` + `runtime`. 4. `call.ts` e `answer.ts`. 5. Testes de wake e de parada. 6. `CHANGELOG`. 7. Os cinco comandos de `AGENTS.md` (`tsc`, `vitest`, `theme-audit`, `i18n:lint`, `public-audit`), mais `electron-vite build`.

## Perguntas abertas

Nenhuma para a pessoa. Para a implementação conferir: o repasse de `extra.resume` em `sdkOptions` e o formato real do erro do SDK para sessão ausente.
