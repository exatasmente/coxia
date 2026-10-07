# Memória do ciclo

## Decisões

- Issue 122 é pedido de funcionalidade (`enhancement`): um agente que trabalha uma etapa deve poder receber mensagem durante a etapa sem reiniciá-la, mandar mensagem sem terminar a etapa e chamar outro agente para discutir um ponto.
- A especificação funcional está em `1_SPEC.md`; o desenho em `2_PLAN.md` (aprovado no Gate 2). O plano fixa: a porta `EngineRequest.incoming` e a chamada em duas passadas (trabalho + coleta sem ferramentas); o fecho com a mensagem voltando no fórum (`closing`); um dono do worktree de cada vez; o trabalho do agente chamado commitado com a etapa que chamou e lido pela revisão por `git diff <from>..<head>`; padrões 6 rodadas por conversa e 3 conversas por etapa num bloco `runner.conversations` **sem passo de migração** (campo opcional com padrão).
- As três ferramentas: `SendMessage` (interno, não pausa), `CallAgent` (recusa ciclo, agente fora do time e teto de conversas) e `askConversation` (a do agente chamado).
- A entrega voltou nas revisões 1, 2 e 3. Nesta tentativa (4ª rodada de implementação) foram fechados: a porta consultada ao fim de **cada** passo do modelo (não só com texto fora do esquema), nos dois motores; a coleta como última palavra do diálogo (uma chamada, sem ferramenta, com o formato); o relógio de ociosidade da etapa batido quando a espera do "sim" da pessoa entrega uma mensagem; a linha de "não deu tempo" que se distingue de pergunta e indica devolver a etapa; e a rodada de correção do motor aberto quando o texto não segue o esquema (com porta, o motor não oferece mais a ferramenta `final_answer`).
- Resposta: o que se espera <!-- answer:124 -->
- Resposta: Volta pro dev corrigir <!-- answer:166 -->
- Resposta: Volta e pede as correções <!-- answer:294 -->
- Resposta: Volta e pede as correções <!-- answer:295 -->

## Restrições

- Uma menção a um agente que **já trabalha** entra na fila da etapa (a sessão da própria etapa, entre dois passos, nos dois motores); uma menção a agente que **não** trabalha continua a chamada paralela de hoje, somente leitura e sobre cópia descartável. Não mexer nesse segundo caminho (`test/runner-mention-actions.test.ts`) — e uma menção **repetida** ao mesmo agente não pode perder a segunda chamada.
- Uma pergunta continua parando a etapa; só mensagem de pessoa chama agente, com fila serial por execução.
- O agente chamado não ganha CLI do host nem MCP; escritas externas e push seguem esperando a pessoa por `Actions`.
- A lista de comandos por agente é a linha `runner.exec` de hoje + auditoria com `by`, sem campo novo no arquivo da execução.
- Os gates: `nvm use`, `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`, e `electron-vite build` no CI. `runner-golden` não pode mover.
- A mensagem que entra na sessão vai entre as marcas `data`, com o lembrete de que o resultado continua sendo o da etapa (**nos dois motores**).

## Tentado e descartado

- Reiniciar a etapa para entregar a mensagem; pegar a última resposta antes de fechar em vez da fase de coleta; guardar a lista de comandos por agente no arquivo da execução; commit a cada conversa; teto global de rodadas da etapa; a tela (aviso de entrega, link execução ↔ conversa) é de `experiencia`.
- Consultar a porta em passos que chamaram ferramenta, ou em laço aberto (o modelo devolveria texto solto). Com porta, o motor aberto usa `response_format` quando o servidor tem, senão o caminho de texto com uma rodada de correção — nunca o caminho da ferramenta `final_answer`.
- Marca de "espera resposta" por mensagem com `replyTo` (colide com a semântica de respostas do fórum) e linha duplicada de "não deu tempo" (a caixa escreve, o serviço não repete).

## Perguntas abertas

- Nenhuma bloqueia. Depois de usar: se o fecho (mensagem voltando no fórum com o motivo) é o que a pessoa espera, ou se preferiria devolver a etapa — o critério de aceite 1 não é atendido quando a mensagem chega num passo que já vai terminar.
- **Não verificado** (fica para o QA): se o Claude Agent SDK real aceita uma mensagem de usuário numa sessão já em andamento e se a saída estruturada sobrevive; o sandbox real sobre o worktree para uma conversa; a corrida entre a etapa e o trabalho do agente chamado com o app em execução.

## Onde o trabalho está

- Triagem, refino, plano e quatro revisões concluídos. **Implementação em andamento**: a árvore tem os commits 1 e 2 do plano (a porta `EngineRequest.incoming`, a fase de coleta nos dois motores, a caixa da etapa em `src/main/runner/inbox.ts`, a fiação da mensagem à etapa e as linhas do fórum).
- **Atendido no que existe de código, nesta rodada:** (1) a porta é consultada ao fim de cada passo do modelo, nos dois motores, e uma mensagem já na fila é entregue e anunciada antes de a etapa concluir; (2) a coleta é uma chamada só, sem ferramenta, com o formato do esquema, e é a última palavra do diálogo (o laço não consulta mais a porta depois dela; no SDK a sessão de entrada fecha ao entrar a instrução de resposta final); (3) com porta, o motor aberto não oferece a ferramenta de resposta final e, quando o texto não segue o esquema, os erros voltam ao modelo com uma rodada de correção; (4) `StageClock.beat()` e o `call.beat` embrulhado fazem o relógio de ociosidade da etapa ser batido quando a espera do "sim" da pessoa entrega uma mensagem; (5) a linha de "não deu tempo" ganhou a variante de pergunta (`runner.message.afterCloseAsk`) a partir de `waitsForAnswer` (marca calculada no fórum para mensagem de pessoa que termina em interrogação), e a de entrega continua carregando o texto.
- **Verificado por execução nesta árvore:** `npx tsc --noEmit` **passa** (saída 0). `test/runner-mention-actions.test.ts` **6/6** (o caminho de hoje de uma menção a um agente que não trabalha não mudou).
- **Não verificado / vermelho:** `test/engine-incoming.test.ts` ficou **10 de 12** — os dois casos novos do motor aberto (entrega de mensagem já na fila; rodada de correção) estouram por tempo limite porque o servidor de mentira do teste responde em fluxo a uma chamada pedida sem fluxo (defeito do roteiro do teste, não do código de produção; o comportamento que eles fixariam não está confirmado). A suíte completa, `theme-audit`, `i18n:lint` e `public-audit` **não foram rodados** depois destas mudanças.
- **Não escritos:** os commits 3 a 6 do plano (as três ferramentas, `runner/conversation.ts`, o dono do worktree, o uso contado, o bloco `runner.conversations`) e os testes correspondentes — os três critérios de aceite principais **não existem no código**.
- **Achados do plano que seguem valendo para os commits 4 e 5 (não mexidos):** numa conversa de execução a sessão de um agente que roda comandos abre **sobre o worktree**, nunca sobre cópia (`src/main/runner/service.ts:1059-1066`); o commit do fim da conversa, sendo `git add -A` com exclusões por nome, não pega arquivo sob pasta ignorada; e falta o enquadramento `data` da mensagem no ramo do SDK (o irmão do que já está no motor aberto) — se o SDK real aceitar a mensagem na sessão viva.
- **Não verificado:** o SDK real, o sandbox real e a corrida entre escritores. O teste do motor usa um dublê que entrega o turno antes de o código de produção pedir a entrega, então o verde dele cobre a mecânica do teste, não o encaixe real.
- Passagem support → product-owner: a issue é um pedido de funcionalidade claro e completo; partir da correção da triagem: hoje a menção a um agente que trabalha é atendida em paralelo, somente leitura, sobre cópia descartável. <!-- handoff:7 -->
- Passagem product-owner → pessoa: a especificação está escrita (`1_SPEC.md`). <!-- handoff:16 -->
- Passagem tl-plataforma → pessoa: começar pelo commit 1; conferir no SDK se aceita mensagem de usuário numa sessão viva, senão usar a retomada de 2.3.1. <!-- handoff:28 -->
- Passagem developer → revisor-plataforma: retomar de onde parou — tipar o teste novo, rodar os gates, seguir os commits 3 a 6. <!-- handoff:79 -->
- Passagem revisor-plataforma → developer (rodada 1): tipos vermelhos no teste novo; a coleta do motor aberto não pedia nada; a deduplicação mudou o comportamento da menção duplicada. <!-- handoff:190 -->
- Passagem developer → revisor-plataforma (rodada 2): fechou os tipos, a coleta e a menção repetida; a suíte seguia instável. <!-- handoff:215 -->
- Passagem revisor-plataforma → developer (rodada 3): cinco achados — a porta só consultada com texto fora do esquema; a coleta pedida antes da porta e o laço consultando-a depois; o relógio da etapa não batido na espera do "sim"; a etapa podendo terminar sem formato e sem pedido final; a linha de entrega gravando o texto do usuário. <!-- handoff:216 -->
- Passagem pessoa → developer: Volta e pede as correções <!-- handoff:295 -->
