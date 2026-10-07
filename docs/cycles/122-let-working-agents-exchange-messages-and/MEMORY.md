# Memória do ciclo

## Decisões

- Issue 122 é pedido de funcionalidade (`enhancement`): um agente que trabalha uma etapa deve poder receber mensagem durante a etapa sem reiniciá-la, mandar mensagem sem terminar a etapa e chamar outro agente para discutir um ponto.
- A especificação funcional está em `1_SPEC.md`; o desenho em `2_PLAN.md` (aprovado no Gate 2). O plano fixa: a porta `EngineRequest.incoming` e a chamada em duas passadas (trabalho + coleta sem ferramentas); o fecho com a mensagem voltando no fórum (`closing`); um dono do worktree de cada vez; o trabalho do agente chamado commitado com a etapa que chamou e lido pela revisão por `git diff <from>..<head>`; padrões 6 rodadas por conversa e 3 conversas por etapa num bloco `runner.conversations` **sem passo de migração** (campo opcional com padrão) — implementado nesta passada.
- As três ferramentas: `SendMessage` (interno, não pausa), `CallAgent` (recusa ciclo, agente fora do time e teto de conversas) e `AskConversation` (a do agente chamado) — implementadas nesta passada como `ToolImpl` neutro de motor, oferecidas pelos dois motores pelo mesmo nome.
- O desenho aceito da estratégia `prompt` do motor aberto: o texto do passo é um candidato a resultado, a porta é consultada ao fim do passo e a coleta é pedida antes de qualquer conclusão; se o texto da coleta não seguir o esquema, os erros voltam ao diálogo e o passo seguinte (com as ferramentas da etapa) tem uma rodada para corrigir. Fixado em comentário junto do caso de teste.
- A entrega voltou nas revisões 1, 2, 3, 4 e 5.
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

- Triagem, refino, plano e **cinco revisões** concluídos. **Implementação em andamento**: a árvore tem os commits 1 e 2 do plano (a porta `EngineRequest.incoming`, a fase de coleta nos dois motores, a caixa da etapa em `src/main/runner/inbox.ts`, a fiação da mensagem à etapa, as linhas do fórum), o bloco `runner.conversations` nos três arquivos do esquema mais o documento da configuração (commit 6) e a maior parte do commit 3 (as três ferramentas em `src/main/runner/tools.ts`, a conversa em `src/main/runner/conversation.ts`, a fiação na chamada da etapa e o `runnerTools` nos dois motores).
- **Verificado por execução nesta passada:** `npx tsc --noEmit` **passa** (antes falhava com 5 erros em `test/engine-incoming.test.ts`); `test/engine-incoming.test.ts` **12 de 12** (antes 10 de 12); `test/runner-send-call.test.ts` **5 de 5**; `test/config-schema.test.ts` e `test/team-runner-edit.test.ts` **34 de 34**; `i18n:lint` passa (4080 chaves); `theme-audit` passa; `public-audit` passa (916 arquivos). A suíte inteira foi rodada antes destas últimas mudanças e ficou **3674 de 3676** (duas falhas de tempo, alheias à issue).
- **Vermelho nesta passada:** um dos três casos de `test/runner-conversation.test.ts` não passa — o auxiliar de apoio da conversa devolve a lista de respostas no lugar da função que as recebe (defeito do teste, não do código de produção); os outros dois passam.
- **Não escritos:** o dono do worktree (`lend`/`take`), o commit do trabalho do agente chamado com a etapa, o uso da conversa somado ao da etapa de quem chamou, e a revisão por `<from>..<head>`. Os critérios de aceite 3, 4 e 5 da issue **não existem no código**.
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
- Passagem developer → revisão (rodada 6, esta): tipos passam, o arquivo do motor fica 12 de 12, as ferramentas e o bloco de configuração existem; falta o dono do worktree, o commit do agente chamado com a etapa, o uso contado e o teste da conversa com um caso vermelho.
