# Memória do ciclo

## Decisões

- Issue 122 é pedido de funcionalidade (`enhancement`): um agente que trabalha uma etapa deve poder receber mensagem durante a etapa sem reiniciá-la, mandar mensagem sem terminar a etapa e chamar outro agente para discutir um ponto.
- A especificação funcional está em `1_SPEC.md`; o desenho em `2_PLAN.md` (aprovado no Gate 2). O plano fixa: a porta `EngineRequest.incoming` e a chamada em duas passadas (trabalho + coleta sem ferramentas); o fecho com a mensagem voltando no fórum (`closing`); um dono do worktree de cada vez; o trabalho do agente chamado commitado com a etapa que chamou e lido pela revisão; padrões 6 rodadas por conversa e 3 conversas por etapa num bloco `runner.conversations` **sem passo de migração** (campo opcional com padrão).
- As três ferramentas: `SendMessage` (interno, não pausa), `CallAgent` (recusa ciclo, agente fora do time e teto de conversas) e `AskConversation` (a do agente chamado) — implementadas como `ToolImpl` neutro de motor, oferecidas pelos dois motores pelo mesmo nome.
- O desenho aceito da estratégia `prompt` do motor aberto: o texto do passo é um candidato a resultado, a porta é consultada ao fim do passo e a coleta é pedida antes de qualquer conclusão; se o texto da coleta não seguir o esquema, os erros voltam ao diálogo e o passo seguinte tem uma rodada para corrigir.
- O uso do modelo da conversa é ligado à mesma função acumuladora da etapa (`onUsage: usage` na etapa e na conversa), então a soma acontece por construção; um teste a prova agora, e a tela do uso não foi aberta.
- O trabalho do agente chamado que escreve é commitado **no fecho da conversa, com a etapa que o chamou** (antes do commit da própria etapa), pela identidade do runner; uma conversa sem mudança não commita. Quem impede dois escritores ao mesmo tempo é a etapa **esperar** a conversa que escreve (a conversa roda em paralelo com a etapa só quando o chamado é leitor).
- Resposta: o que se espera <!-- answer:124 -->
- Resposta: Volta pro dev corrigir <!-- answer:166 -->
- Resposta: Volta e pede as correções <!-- answer:294 -->
- Resposta: Volta e solicita a correção <!-- answer:432 -->

## Restrições

- Uma menção a um agente que **já trabalha** entra na fila da etapa; uma menção a agente que **não** trabalha continua a chamada paralela de hoje, somente leitura e sobre cópia descartável. Não mexer nesse segundo caminho (`test/runner-mention-actions.test.ts`) — e uma menção **repetida** ao mesmo agente não pode perder a segunda chamada.
- Uma pergunta continua parando a etapa; só mensagem de pessoa chama agente, com fila serial por execução.
- O agente chamado não ganha CLI do host nem MCP; escritas externas e push seguem esperando a pessoa por `Actions`.
- A lista de comandos por agente é a linha `runner.exec` de hoje + auditoria com `by`, sem campo novo no arquivo da execução. O registro persistido da lista guarda só `by: 'app'|'agent'` (enum fechado do esquema), sem o id; o "sob o nome" é a linha da thread e a auditoria.
- Os gates: `nvm use`, `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`, e `electron-vite build` no CI. `runner-golden` não pode mover.
- A mensagem que entra na sessão vai entre as marcas `data`, com o lembrete de que o resultado continua sendo o da etapa (**nos dois motores**).
- A linha de entrega gravada na conversa carrega o texto do usuário e volta ao prompt da tentativa seguinte (a janela é de 40 mensagens); fica como está nesta fase de escopo.

## Tentado e descartado

- Reiniciar a etapa para entregar a mensagem; pegar a última resposta antes de fechar em vez da fase de coleta; guardar a lista de comandos por agente no arquivo da execução; commit a cada conversa; teto global de rodadas da etapa.
- Consultar a porta em passos que chamaram ferramenta, ou em laço aberto.
- Marca de "espera resposta" por mensagem com `replyTo` e linha duplicada de "não deu tempo".
- O `lend`/`take` literal de fechar e reabrir a sessão da etapa entre passos de escrita: **não implementado**; o "um escritor por vez" foi alcançado fazendo a etapa esperar a conversa que escreve, não fechando a sessão. A leitura da revisão por `git diff <from>..<head>` também não foi feita.

## Perguntas abertas

- Nenhuma bloqueia. Depois de usar: se o fecho (mensagem voltando no fórum com o motivo) é o que a pessoa espera, ou se preferiria devolver a etapa — o critério de aceite 1 não é atendido quando a mensagem chega num passo que já vai terminar.
- **Não verificado** (fica para o QA): se o modelo real aceita uma mensagem de usuário numa sessão já em andamento e se a saída estruturada sobrevive; o sandbox real sobre o worktree para uma conversa; a corrida entre a etapa e o trabalho do agente chamado com o app em execução; a tela do uso e a tela da revisão (o diff estreito não foi implementado).

## Onde o trabalho está

- **Implementação (rodada 5, esta):** os dois gates vermelhos da revisão foram fechados — o defeito de tipo em `test/runner-conversation.test.ts` (auxiliar passava a lista no lugar da função `answered`) e o teste do padrão da configuração que quebrou com o bloco novo. **Verificado por execução:** `npx tsc --noEmit` passa; a suíte inteira **3688 de 3688**; `test/runner-conversation.test.ts` 5 de 5; `engine-incoming` 12 de 12; `runner-send-call` 6 de 6; `theme-audit`, `i18n:lint` (4080) e `public-audit` (917 arquivos) passam.
- **Nesta passada entrou código:** o commit do trabalho do agente chamado que escreve com a etapa que o chamou, no fecho da conversa (`deps.commit`, mensagem "apply the conversation between X and Y", `commitAll` com a identidade do runner); a confinação do chamado que escreve ao worktree (+ ferramentas de escrita por `confinedHooks`); a etapa esperando a conversa que escreve (e rodando a de leitor em paralelo); os comandos do chamado entrando na lista de comandos da etapa; os testes de commit, confinação, uso somado e o caminho inteiro de escrita/comando.
- **Não existe no código:** o diff da revisão por `git diff <from>..<head>` (a revisão segue lendo da base da branch; o que põe o trabalho do chamado no diff é o commit dele com a etapa); o `lend`/`take` literal de fechar a sessão entre passos; o id do agente no campo persistido da lista de comandos.
- **Handoffs:** esta passada partiu da revisão (rodada 6 do tl) que pediu os itens acima; o `3_IMPLEMENTATION.md` e esta memória resumem o que foi e o que não foi feito nesta rodada. <!-- handoff:... -->
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
- Passagem revisor-plataforma → developer (rodada 6): changes — o teste da conversa (tipo) e o teste do padrão da config quebrados, e sem código: dono único do worktree, commit da conversa com `readDiff <from>..<head>`, comando do chamado na lista e teste do chamado com `permission: worktree`. <!-- handoff:... -->
- Passagem pessoa → developer: Volta e solicita a correção <!-- handoff:433 -->
- Passagem developer → revisor-plataforma: Fechar o que falta dos commits 3 a 6 do plano: (1) corrigir o caso que falha em `test/runner-conversation.test.ts` (o auxiliar de apoio devolve a lista de respostas no lugar da função que as recebe) e rodar a suíte inteira; (2) o dono único do worktree (`lend`/`take`), com a etapa largando o worktree ao fim de cada passo de escrita e esperando a conversa; (3) o commit do trabalho do agente chamado no fecho da conversa, com a etapa que chamou, e `readDiff` lendo `git diff <from>..<head>`; (4) o uso do modelo da conversa somado ao da etapa de quem chamou; (5) o teste do agente chamado com `permi… <!-- handoff:402 -->
