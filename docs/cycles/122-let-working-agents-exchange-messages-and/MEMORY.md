# Memória do ciclo

## Decisões

- Issue 122 é pedido de funcionalidade (`enhancement`): um agente que trabalha uma etapa deve poder receber mensagem durante a etapa sem reiniciá-la, mandar mensagem sem terminar a etapa e chamar outro agente para discutir um ponto.
- A especificação funcional está em `1_SPEC.md`; o desenho em `2_PLAN.md` (aprovado no Gate 2). O plano fixa: a porta `EngineRequest.incoming` e a chamada em duas passadas (trabalho + coleta sem ferramentas); o fecho com a mensagem voltando no fórum (`closing`); um dono do worktree de cada vez; o trabalho do agente chamado commitado com a etapa que chamou e lido pela revisão por `git diff <from>..<head>`; padrões 6 rodadas por conversa e 3 conversas por etapa num bloco `runner.conversations` **sem passo de migração** (campo opcional com padrão) — implementado nesta passada.
- As três ferramentas: `SendMessage` (interno, não pausa), `CallAgent` (recusa ciclo, agente fora do time e teto de conversas) e `AskConversation` (a do agente chamado) — implementadas como `ToolImpl` neutro de motor, oferecidas pelos dois motores pelo mesmo nome.
- O desenho aceito da estratégia `prompt` do motor aberto: o texto do passo é um candidato a resultado, a porta é consultada ao fim do passo e a coleta é pedida antes de qualquer conclusão; se o texto da coleta não seguir o esquema, os erros voltam ao diálogo e o passo seguinte (com as ferramentas da etapa) tem uma rodada para corrigir.
- O uso do modelo da conversa é ligado à mesma função acumuladora da etapa (`onUsage: usage` na etapa e na conversa), então a soma acontece por construção; nenhum teste a prova, e a tela do uso não foi aberta.
- Resposta: o que se espera <!-- answer:124 -->
- Resposta: Volta pro dev corrigir <!-- answer:166 -->
- Resposta: Volta e pede as correções <!-- answer:294 -->

## Restrições

- Uma menção a um agente que **já trabalha** entra na fila da etapa; uma menção a agente que **não** trabalha continua a chamada paralela de hoje, somente leitura e sobre cópia descartável. Não mexer nesse segundo caminho (`test/runner-mention-actions.test.ts`) — e uma menção **repetida** ao mesmo agente não pode perder a segunda chamada.
- Uma pergunta continua parando a etapa; só mensagem de pessoa chama agente, com fila serial por execução.
- O agente chamado não ganha CLI do host nem MCP; escritas externas e push seguem esperando a pessoa por `Actions`.
- A lista de comandos por agente é a linha `runner.exec` de hoje + auditoria com `by`, sem campo novo no arquivo da execução.
- Os gates: `nvm use`, `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`, e `electron-vite build` no CI. `runner-golden` não pode mover.
- A mensagem que entra na sessão vai entre as marcas `data`, com o lembrete de que o resultado continua sendo o da etapa (**nos dois motores**).
- A linha de entrega gravada na conversa carrega o texto do usuário e volta ao prompt da tentativa seguinte (a janela é de 40 mensagens); fica como está nesta fase de escopo.

## Tentado e descartado

- Reiniciar a etapa para entregar a mensagem; pegar a última resposta antes de fechar em vez da fase de coleta; guardar a lista de comandos por agente no arquivo da execução; commit a cada conversa; teto global de rodadas da etapa; a tela (aviso de entrega, link execução ↔ conversa) é de `experiencia`.
- Consultar a porta em passos que chamaram ferramenta, ou em laço aberto.
- Marca de "espera resposta" por mensagem com `replyTo` e linha duplicada de "não deu tempo".

## Perguntas abertas

- Nenhuma bloqueia. Depois de usar: se o fecho (mensagem voltando no fórum com o motivo) é o que a pessoa espera, ou se preferiria devolver a etapa — o critério de aceite 1 não é atendido quando a mensagem chega num passo que já vai terminar.
- **Não verificado** (fica para o QA): se o modelo real aceita uma mensagem de usuário numa sessão já em andamento e se a saída estruturada sobrevive; o sandbox real sobre o worktree para uma conversa; a corrida entre a etapa e o trabalho do agente chamado com o app em execução.

## Onde o trabalho está

- Triagem, refino, plano e **seis revisões** concluídos. A árvore tem os commits 1, 2, 3 e 6 do plano (a porta `EngineRequest.incoming`, a fase de coleta nos dois motores, a caixa da etapa em `src/main/runner/inbox.ts`, a fiação da mensagem à etapa, as linhas do fórum, as três ferramentas em `src/main/runner/tools.ts`, a conversa em `src/main/runner/conversation.ts`, o `runnerTools` nos dois motores e o bloco `runner.conversations` no esquema e no documento).
- **Verificado por execução na rodada 6 (esta):** `npx tsc --noEmit` **falha** em `test/runner-conversation.test.ts:93` (o auxiliar devolve a lista de respostas no lugar da função que as recebe); `test/engine-incoming.test.ts` **12 de 12**; `test/runner-send-call.test.ts` **5 de 5**; `test/config-schema.test.ts` e `test/team-runner-edit.test.ts` **34 de 34**; `i18n:lint` passa (4080 chaves); `theme-audit` passa; `public-audit` passa (917 arquivos). **Nova regressão:** `test/runner-config.test.ts:12` quebra porque o bloco `conversations` entrou nos padrões sem o teste do objeto padrão ser atualizado. A suíte inteira não terminou a tempo; numa rodada agrupada das regiões de runner e engine ficou 496 de 499 (as duas falhas reais acima, mais uma de tempo que não se repetiu sozinha).
- **Não escritos:** o dono do worktree (`lend`/`take`) — a conversa roda solta ao lado da etapa com a sessão sobre o mesmo worktree, então dois agentes podem escrever juntos; o commit do trabalho do agente chamado no fecho da conversa, e a revisão por `<from>..<head>` (a revisão segue lendo pela base da branch, e o `commitAll` da etapa varre o que ficou solto); e o comando do agente chamado na lista de comandos da execução sob o nome dele (`ranInSandbox` só lê o log da sessão da própria etapa). Os critérios de aceite 3, 4 e 5 da issue **não existem no código**.
- **Achados do plano que seguem valendo:** numa conversa de execução a sessão de um agente que roda comandos abre **sobre o worktree**, nunca sobre cópia; o commit do fim da conversa, sendo `git add -A` com exclusões por nome, não pega arquivo sob pasta ignorada; e o enquadramento `data` da mensagem no ramo do SDK está escrito, mas não exercitado contra o pacote real.
- **Não verificado:** o modelo real, o sandbox real e a corrida entre escritores. O teste do motor do SDK usa um dublê cuja forma não corresponde exatamente à que o código usa.
- Passagem support → product-owner: a issue é um pedido de funcionalidade claro e completo; partir da correção da triagem. <!-- handoff:7 -->
- Passagem product-owner → pessoa: a especificação está escrita (`1_SPEC.md`). <!-- handoff:16 -->
- Passagem tl-plataforma → pessoa: começar pelo commit 1; conferir no SDK se aceita mensagem de usuário numa sessão viva. <!-- handoff:28 -->
- Passagem developer → revisor-plataforma: retomar de onde parou — tipar o teste novo, rodar os gates, seguir os commits 3 a 6. <!-- handoff:79 -->
- Passagem revisor-plataforma → developer (rodada 1): tipos vermelhos no teste novo; a coleta do motor aberto não pedia nada; a deduplicação mudou o comportamento da menção duplicada. <!-- handoff:190 -->
- Passagem developer → revisor-plataforma (rodada 2): fechou os tipos, a coleta e a menção repetida; a suíte seguia instável. <!-- handoff:215 -->
- Passagem revisor-plataforma → developer (rodada 3): cinco achados no motor e no relógio da etapa. <!-- handoff:216 -->
- Passagem pessoa → developer: Volta e pede as correções <!-- handoff:295 -->
- Passagem developer → revisor-plataforma: Terminar os commits 3 a 6 do plano, que são a maior parte da issue. <!-- handoff:330 -->
- Passagem revisor-plataforma → developer (rodada 4): os 5 erros de tipo de `test/engine-incoming.test.ts`, a suíte vermelha e os commits 3 a 6 do plano. <!-- handoff:361 -->
- Passagem revisor-plataforma → developer (rodada 5): a entrega volta; o gate de tipos vermelho e a maior parte da issue sem código. <!-- handoff:372 -->
- Passagem developer → revisão (rodada 6): tipos passavam e os commits 3 e 6 existiam; faltava o dono do worktree, o commit do chamado com a etapa, o uso contado e o teste da conversa com um caso vermelho.
- Passagem revisor-plataforma → developer (rodada 6, esta): **changes**. O teste da conversa não foi corrigido (`npx tsc` vermelho em `test/runner-conversation.test.ts:93`), o teste existente do padrão da configuração quebrou com o bloco novo (`test/runner-config.test.ts:12`), e seguem sem código: o dono único do worktree (dois escritores podem agir juntos — critério 4), o commit da conversa com a revisão por `<from>..<head>` (o `commitAll` da etapa varre o que ficou solto), o comando do chamado na lista por agente e o teste do chamado com `permission: worktree`. O uso da conversa ficou ligado por construção à função acumuladora da etapa, sem teste. <!-- handoff:... -->
- Passagem developer → revisor-plataforma: Fechar o que falta dos commits 3 a 6 do plano: (1) corrigir o caso que falha em `test/runner-conversation.test.ts` (o auxiliar de apoio devolve a lista de respostas no lugar da função que as recebe) e rodar a suíte inteira; (2) o dono único do worktree (`lend`/`take`), com a etapa largando o worktree ao fim de cada passo de escrita e esperando a conversa; (3) o commit do trabalho do agente chamado no fecho da conversa, com a etapa que chamou, e `readDiff` lendo `git diff <from>..<head>`; (4) o uso do modelo da conversa somado ao da etapa de quem chamou; (5) o teste do agente chamado com `permi… <!-- handoff:402 -->
