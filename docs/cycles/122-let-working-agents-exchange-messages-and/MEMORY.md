# Memória do ciclo

## Decisões

- Issue 122 é pedido de funcionalidade (`enhancement`): um agente que trabalha uma etapa deve poder receber mensagem durante a etapa sem reiniciá-la, mandar mensagem sem terminar a etapa e chamar outro agente para discutir um ponto. Triagem e refino não pausaram em pergunta; nenhuma decisão é de quem abriu.
- A especificação funcional está em `1_SPEC.md` (receber/ mandar/ chamar, os limites, o que muda para quem usa, fora de escopo, aceites e o que ficou em aberto). Não projeta solução.
- Prioridade sugerida `priority:high`, não preenchida (a issue entra na autonomia e na lista de comandos por agente). Sem marco. Squad `plataforma`; a fatia de tela pertence a `experiencia`.
- **Plano técnico concluído (`2_PLAN.md`, esta etapa).** O desenho: uma porta de entrada nova no contrato do motor (`EngineRequest.incoming`) e a chamada de uma etapa em **duas passadas** — o laço de trabalho entrega a mensagem entre dois passos (motor aberto: mensagem de usuário + mais uma chamada; Claude Agent SDK: a sessão viva) e depois uma **fase de coleta** pede a resposta final **sem nenhuma ferramenta** no mesmo diálogo, para uma mensagem no meio nunca quebrar o `summary`/`artifacts`. Se o SDK recusar a mensagem em sessão viva, a retomada pelo `sessionId` (que o motor aberto já usa) é a alternativa, decidida na fase 1.
- As três ferramentas: `SendMessage` (publica na conversa da execução, interno, não pausa), `CallAgent` (abre a conversa na conversa da execução ou numa nova ligada a ela; recusa ciclo, agente fora do time e teto de conversas) e `askConversation` (a do agente **chamado**, para continuar falando; se ele termina o passo sem chamá-la, a conversa acabou).
- Um dono do worktree de cada vez: a etapa larga o worktree no fim de cada passo de escrita e uma conversa de um agente chamado com `permission: worktree` é a única dona; a etapa espera a conversa (teto de rodadas + relógio próprios). O trabalho do agente chamado é **commitado com a etapa que chamou**, e a revisão lê `git diff <from>..<head>` por etapa para ver essa mudança.
- Padrões escolhidos: 6 rodadas por conversa e 3 conversas por tentativa de etapa, num bloco novo `runner.conversations` nos três arquivos de config, **sem passo de migração** (campo opcional lido com padrão; subir o esquema só para escrever o padrão não tem ganho e não dá para testar contra arquivo real aqui).
- Mensagem que chega quando a etapa está fechando: a etapa fecha com o que tem e a mensagem volta no fórum com o motivo (`closing` no porteiro); nada reinicia. Quem espera resposta decide se devolve a etapa com a mensagem como nota (`runs:sendBack`).

## Restrições

- Correção da triagem, conferida por leitura: hoje uma menção a um agente que trabalha **já é atendida em paralelo**, mas como execução separada, sempre somente leitura, sobre **cópia descartável** quando roda comandos (`src/main/mentions/answer.ts:103,180-189`). O que a 122 pede é outra coisa: a mensagem entrar na **sessão da própria etapa**, entre dois passos, nos dois motores. Uma menção a um agente que **não** trabalha continua como hoje.
- Uma pergunta continua parando a etapa (`pendingAnswer`, `src/main/runner/executor.ts`); só mensagem de pessoa chama agente (`src/main/runner/service.ts:894-898`), com fila serial por execução.
- Não existia ferramenta `SendMessage` nem `CallAgent`; as ferramentas do agente são leitura, escrita confinada, shell e as do app (`src/main/engine/contract.ts`). O `Shell` do sandbox só existe no Claude SDK (servidor MCP em processo) e por `extraTools` no motor aberto — daí a lista de ferramentas ser montada por uma função pura para os dois motores.
- Toda escrita externa sai por `Actions`; push e escrita externa sempre esperam a pessoa. O agente chamado não ganha CLI do host nem MCP.
- A lista de comandos **por agente** da execução não existia: `Run` não guarda comandos e o log do sandbox é descartado no fim da etapa. O plano resolveu pela linha `runner.exec` (que já leva o agente) + auditoria com `by`, sem campo novo no arquivo da execução.

## Tentado e descartado

- Perguntar a quem abriu (nada falta que só ele saiba); tratar como bug (o estado descrito confere); tratar as issues de menção como duplicatas.
- Reiniciar a etapa para entregar a mensagem (é o comportamento que a issue existe para tirar).
- Pegar a última resposta antes de fechar em vez da fase de coleta (quebraria `summary`/`artifacts`).
- Guardar a lista de comandos por agente no arquivo da execução; commit a cada conversa em vez de com a etapa que chamou; um teto global de rodadas da etapa em vez do teto por conversa; um assunto novo no armazém do fórum em vez da fiação em `onMessage`.
- Deixar o plano escolher a tela (aviso de entrega, link execução ↔ conversa do fórum, `@` da pessoa): pertence a `experiencia`.

## Perguntas abertas

- Nenhuma bloqueia a implementação. Fica para depois de usar: se o fecho de 2.2 (mensagem voltando no fórum com o motivo) é o que a pessoa espera, ou se ela preferiria devolver a etapa.
- Não verificado: a forma exata como o Claude Agent SDK aceita uma mensagem de usuário numa sessão já em andamento (e se a saída estruturada sobrevive a isso); o sandbox real sobre o worktree para uma conversa; a corrida entre a etapa e o trabalho do agente chamado com o app em execução. A fase 1 confere o primeiro antes de escrever o resto.

## Onde o trabalho está

- Triagem (`0_TRIAGE.md`) e refino (`1_SPEC.md`) concluídos; **plano técnico (`2_PLAN.md`) escrito nesta etapa**, com: as quatro decisões do desenho (o encaixe nos dois motores, o fim de etapa, os padrões, a config sem migração), a ordem de trabalho em seis commits, os contratos (`EngineRequest.incoming`, `StageInbox`, `runnerTools`, `ConversationDeps`, `WorktreeOwner`, `runner.conversations`), os testes e a verificação, os riscos e o registro de decisões.
- Gate 1 aprovado. A etapa seguinte (implementação) começa pelo commit 1 e confere primeiro o que o SDK aceita.
- Nada foi executado quanto ao comportamento novo. Verificação desta etapa: `node scripts/public-audit.mjs` passou (909 arquivos, nada que pertença a empresa ou pessoa). Conferido por leitura: docs/runner.md, docs/configuration.md, docs/cycles/9, 30, 53 e 58 (planos), src/main/engine/contract.ts, engine/open/{loop,session,client,bridge}.ts, agents.ts, runner/{executor,service,hooks,prompt,commands,module}.ts, mentions/answer.ts, shared/runs/flow.ts, shared/config/{migrations,schema}.ts.
- Passagem plano → implementação: começar pelo commit 1 (o motor e a porta de entrada, a fase de coleta inegociável, `inbox.ts`); antes do resto, conferir em `node_modules` o que o Claude Agent SDK aceita de mensagem em sessão viva e cair no caminho de retomada de 2.3.1 se recusar. Não mexer no caminho de uma menção a um agente que não trabalha e manter o `runner-golden` parado. <!-- handoff:31 -->
- Passagem support → product-owner: A issue é um pedido de funcionalidade claro e completo: o refino pode seguir sem perguntar a quem abriu. Ao escrever a especificação, partir da correção da triagem: hoje a menção a um agente que trabalha já é atendida em paralelo, mas numa execução separada e somente leitura, numa cópia descartável do código — o que a seção 1 pede é diferente, é a mensagem entrar na sessão da etapa, entre dois passos do modelo, nos dois motores, sem reiniciar a etapa. O desenho precisa dizer o que a issue já cobra: um escritor por vez no worktree (e o que o outro vê), onde rodam os comandos de um agente chamad… <!-- handoff:7 -->
- Passagem product-owner → pessoa: A especificação está escrita (1_SPEC.md). O plano técnico deve partir dela e resolver o que a issue cobrou do desenho, sem que a spec escolha por ele: (1) como uma mensagem entra na sessão de uma etapa entre dois passos do modelo, nos dois motores (Claude Agent SDK e motor aberto) — a triagem não verificou e esta etapa também não: uma sessão de etapa hoje nasce, roda e morre dentro de uma chamada, então o plano precisa conferir por leitura/experimento o que cada motor aceita; (2) um escritor por vez no mesmo worktree (e o que o outro agente vê) quando o agente chamado tem permission: worktree;… <!-- handoff:16 -->
