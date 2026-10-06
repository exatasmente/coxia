# Memória do ciclo

## Decisões

- Issue 122 é pedido de funcionalidade (`enhancement`): um agente que trabalha uma etapa deve poder receber mensagem durante a etapa sem reiniciá-la, mandar mensagem sem terminar a etapa e chamar outro agente para discutir um ponto. Triagem e refino não pausaram em pergunta.
- A especificação funcional está em `1_SPEC.md`; o desenho em `2_PLAN.md` (aprovado no Gate 2). O plano fixa: a porta `EngineRequest.incoming` e a chamada em duas passadas (trabalho + coleta sem ferramentas); o fecho com a mensagem voltando no fórum (`closing`); um dono do worktree de cada vez; o trabalho do agente chamado commitado com a etapa que chamou e lido pela revisão por `git diff <from>..<head>`; padrões 6 rodadas por conversa e 3 conversas por etapa num bloco `runner.conversations` **sem passo de migração** (campo opcional com padrão).
- As três ferramentas: `SendMessage` (interno, não pausa), `CallAgent` (recusa ciclo, agente fora do time e teto de conversas) e `askConversation` (a do agente chamado).

## Restrições

- Uma menção a um agente que **já trabalha** entra na fila da etapa (a sessão da própria etapa, entre dois passos, nos dois motores); uma menção a agente que **não** trabalha continua a chamada paralela de hoje, somente leitura e sobre cópia descartável. Não mexer nesse segundo caminho (`test/runner-mention-actions.test.ts`).
- Uma pergunta continua parando a etapa; só mensagem de pessoa chama agente, com fila serial por execução.
- O agente chamado não ganha CLI do host nem MCP; escritas externas e push seguem esperando a pessoa por `Actions`.
- A lista de comandos por agente é a linha `runner.exec` de hoje + auditoria com `by`, sem campo novo no arquivo da execução.
- Os gates: `nvm use`, `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`, e `electron-vite build` no CI. `runner-golden` não pode mover.

## Tentado e descartado

- Reiniciar a etapa para entregar a mensagem; pegar a última resposta antes de fechar em vez da fase de coleta; guardar a lista de comandos por agente no arquivo da execução; commit a cada conversa; teto global de rodadas da etapa; um assunto novo no armazém do fórum em vez da fiação em `onMessage`; a tela (aviso de entrega, link execução ↔ conversa) é de `experiencia`.

## Perguntas abertas

- Nenhuma bloqueia. Depois de usar: se o fecho (mensagem voltando no fórum com o motivo) é o que a pessoa espera, ou se preferiria devolver a etapa.
- **Não verificado** (fica para o QA): se o Claude Agent SDK real aceita uma mensagem de usuário numa sessão já em andamento e se a saída estruturada sobrevive; o sandbox real sobre o worktree para uma conversa; a corrida entre a etapa e o trabalho do agente chamado com o app em execução.

## Onde o trabalho está

- Triagem, refino e plano concluídos. **Implementação em andamento (tentativa 1), interrompida no meio.**
- No worktree, com teste novo passando (`test/engine-incoming.test.ts`, 6/6 com o código de produção): commit 1 do plano completo — `EngineRequest.incoming`, a fase de coleta no motor aberto (`src/main/engine/open/loop.ts`), a sessão viva do SDK (`runClaudeSdk` com `streamInput`), a caixa `src/main/runner/inbox.ts`, e a fiação no executor (`call.incoming`, fecho no `finally`). Começo do commit 2: `onMessage` manda para a fila da etapa o `@` ao agente que trabalha e as linhas `runner.message.waiting|delivered|afterClose`; catálogos en/pt atualizados.
- O arquivo de teste tem erros de **tipo** (`sdkTurns`, o `ResolvedRole` do `request()`) na última revisão; a árvore pode não passar `tsc`/`vitest` neste instante. Os gates completos não foram rodados.
- Não escritos: commits 3 a 6 do plano (as três ferramentas, `runner/conversation.ts`, o dono do worktree, o uso contado, o bloco `runner.conversations`) e os testes correspondentes. Nada do comportamento de ponta a ponta da issue foi visto funcionando.
- Passagem support → product-owner: A issue é um pedido de funcionalidade claro e completo: o refino pode seguir sem perguntar a quem abriu. Ao escrever a especificação, partir da correção da triagem: hoje a menção a um agente que trabalha já é atendida em paralelo, mas numa execução separada e somente leitura, numa cópia descartável do código — o que a seção 1 pede é diferente, é a mensagem entrar na sessão da etapa, entre dois passos do modelo, nos dois motores, sem reiniciar a etapa. O desenho precisa dizer o que a issue já cobra: um escritor por vez no worktree (e o que o outro vê), onde rodam os comandos de um agente chamad… <!-- handoff:7 -->
- Passagem product-owner → pessoa: A especificação está escrita (1_SPEC.md). O plano técnico deve partir dela e resolver o que a issue cobrou do desenho, sem que a spec escolha por ele: (1) como uma mensagem entra na sessão de uma etapa entre dois passos do modelo, nos dois motores (Claude Agent SDK e motor aberto) — a triagem não verificou e esta etapa também não: uma sessão de etapa hoje nasce, roda e morre dentro de uma chamada, então o plano precisa conferir por leitura/experimento o que cada motor aceita; (2) um escritor por vez no mesmo worktree (e o que o outro agente vê) quando o agente chamado tem permission: worktree;… <!-- handoff:16 -->
- Passagem tl-plataforma → pessoa: A implementação começa pelo commit 1 (o motor e a porta de entrada `EngineRequest.incoming`, a fase de coleta da resposta final sem ferramentas, a caixa da etapa em `src/main/runner/inbox.ts`). A primeira coisa a fazer na árvore, antes de escrever o resto, é conferir em `node_modules` se o Claude Agent SDK aceita uma mensagem de usuário numa sessão viva entre duas chamadas e se a saída estruturada sobrevive a ela: se recusar, usar o caminho de retomada de 2.3.1 (um `query()` novo com `resume: <sessionId>` e só a mensagem no prompt), que o motor aberto já usa. Depois seguem os commits 2 a 6 na … <!-- handoff:28 -->
