# Memória do ciclo

## Decisões

- Issue 122 é pedido de funcionalidade (`enhancement`): um agente que trabalha uma etapa deve poder receber mensagem durante a etapa sem reiniciá-la, mandar mensagem sem terminar a etapa e chamar outro agente para discutir um ponto.
- A especificação funcional está em `1_SPEC.md`; o desenho em `2_PLAN.md` (aprovado no Gate 2). O plano fixa: a porta `EngineRequest.incoming` e a chamada em duas passadas (trabalho + coleta sem ferramentas); o fecho com a mensagem voltando no fórum (`closing`); um dono do worktree de cada vez; o trabalho do agente chamado commitado com a etapa que chamou e lido pela revisão por `git diff <from>..<head>`; padrões 6 rodadas por conversa e 3 conversas por etapa num bloco `runner.conversations` **sem passo de migração** (campo opcional com padrão).
- As três ferramentas: `SendMessage` (interno, não pausa), `CallAgent` (recusa ciclo, agente fora do time e teto de conversas) e `askConversation` (a do agente chamado).
- A entrega voltou nas revisões 1, 2, 3 e 4. No que já existe de código, os cinco achados da revisão 3 foram fechados por leitura na 4ª rodada (porta consultada ao fim de cada passo nos dois motores; coleta como última palavra do diálogo; relógio de ociosidade da etapa batido na entrega de mensagem; rodada de correção do motor aberto sem erro lançado dentro da coleta; linha de "não deu tempo" com a variante de pergunta), mas **nada disso ficou confirmado por execução**: os dois casos de teste que o fixariam não rodam.
- Resposta: o que se espera <!-- answer:124 -->
- Resposta: Volta pro dev corrigir <!-- answer:166 -->
- Resposta: Volta e pede as correções <!-- answer:294 -->
- Resposta: Volta e pede as correções <!-- answer:295 -->

## Restrições

- Uma menção a um agente que **já trabalha** entra na fila da etapa; uma menção a agente que **não** trabalha continua a chamada paralela de hoje, somente leitura e sobre cópia descartável. Não mexer nesse segundo caminho (`test/runner-mention-actions.test.ts`) — e uma menção **repetida** ao mesmo agente não pode perder a segunda chamada.
- Uma pergunta continua parando a etapa; só mensagem de pessoa chama agente, com fila serial por execução.
- O agente chamado não ganha CLI do host nem MCP; escritas externas e push seguem esperando a pessoa por `Actions`.
- A lista de comandos por agente é a linha `runner.exec` de hoje + auditoria com `by`, sem campo novo no arquivo da execução.
- Os gates: `nvm use`, `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`, e `electron-vite build` no CI. `runner-golden` não pode mover.
- A mensagem que entra na sessão vai entre as marcas `data`, com o lembrete de que o resultado continua sendo o da etapa (**nos dois motores**).
- A linha de entrega gravada na conversa carrega o texto do usuário e volta ao prompt da tentativa seguinte (a janela é de 40 mensagens); fica como está nesta fase de escopo — o custo está anotado para quem escrever a conversa.

## Tentado e descartado

- Reiniciar a etapa para entregar a mensagem; pegar a última resposta antes de fechar em vez da fase de coleta; guardar a lista de comandos por agente no arquivo da execução; commit a cada conversa; teto global de rodadas da etapa; a tela (aviso de entrega, link execução ↔ conversa) é de `experiencia`.
- Consultar a porta em passos que chamaram ferramenta, ou em laço aberto. Com porta, o motor aberto usa `response_format` quando o servidor tem, senão o caminho de texto com uma rodada de correção — nunca o caminho da ferramenta `final_answer`.
- Marca de "espera resposta" por mensagem com `replyTo` e linha duplicada de "não deu tempo".

## Perguntas abertas

- Nenhuma bloqueia. Depois de usar: se o fecho (mensagem voltando no fórum com o motivo) é o que a pessoa espera, ou se preferiria devolver a etapa — o critério de aceite 1 não é atendido quando a mensagem chega num passo que já vai terminar.
- **Não verificado** (fica para o QA): se o modelo real aceita uma mensagem de usuário numa sessão já em andamento e se a saída estruturada sobrevive; o sandbox real sobre o worktree para uma conversa; a corrida entre a etapa e o trabalho do agente chamado com o app em execução.

## Onde o trabalho está

- Triagem, refino, plano e **quatro revisões** concluídos. **Implementação em andamento**: a árvore tem os commits 1 e 2 do plano (a porta `EngineRequest.incoming`, a fase de coleta nos dois motores, a caixa da etapa em `src/main/runner/inbox.ts`, a fiação da mensagem à etapa, as linhas do fórum).
- **Verificado por execução na revisão 4:** `theme-audit` passa, `i18n:lint` passa (4061 chaves nas duas línguas), `public-audit` passa (913 arquivos), `test/runner-lifecycle.test.ts` passa, e um teste temporário próprio mostrou o motor aberto entregando a mensagem antes da coleta. **Vermelho:** `npx tsc --noEmit` falha (5 erros de tipo, todos em `test/engine-incoming.test.ts`, linhas 208 e 233); `npx vitest run test/engine-incoming.test.ts` fica **10 de 12**; a suíte inteira fica **3674 de 3676** em 223 arquivos. Os dois casos que não passam estouram no servidor de mentira (`Cannot use 'in' operator ...`), porque o roteiro desses casos é texto puro e não um passo — o código de produção não é exercitado por eles.
- **Não escritos:** os commits 3 a 6 do plano (as três ferramentas, `runner/conversation.ts`, o dono do worktree, o uso contado, o bloco `runner.conversations`) e os testes correspondentes — os três critérios de aceite principais **não existem no código**.
- **Achados do plano que seguem valendo para os commits 4 e 5 (não mexidos):** numa conversa de execução a sessão de um agente que roda comandos abre **sobre o worktree**, nunca sobre cópia (`src/main/runner/service.ts:1059-1066`); o commit do fim da conversa, sendo `git add -A` com exclusões por nome, não pega arquivo sob pasta ignorada; e o enquadramento `data` da mensagem no ramo do SDK está escrito, mas não exercitado contra o pacote real.
- **Não verificado:** o modelo real, o sandbox real e a corrida entre escritores. O teste do motor do SDK usa um dublê cuja forma não corresponde exatamente à que o código usa, então o verde dele cobre a mecânica do arquivo de teste, não o encaixe real.
- Passagem support → product-owner: a issue é um pedido de funcionalidade claro e completo; partir da correção da triagem: hoje a menção a um agente que trabalha é atendida em paralelo, somente leitura, sobre cópia descartável. <!-- handoff:7 -->
- Passagem product-owner → pessoa: a especificação está escrita (`1_SPEC.md`). <!-- handoff:16 -->
- Passagem tl-plataforma → pessoa: começar pelo commit 1; conferir no SDK se aceita mensagem de usuário numa sessão viva, senão usar a retomada de 2.3.1. <!-- handoff:28 -->
- Passagem developer → revisor-plataforma: retomar de onde parou — tipar o teste novo, rodar os gates, seguir os commits 3 a 6. <!-- handoff:79 -->
- Passagem revisor-plataforma → developer (rodada 1): tipos vermelhos no teste novo; a coleta do motor aberto não pedia nada; a deduplicação mudou o comportamento da menção duplicada. <!-- handoff:190 -->
- Passagem developer → revisor-plataforma (rodada 2): fechou os tipos, a coleta e a menção repetida; a suíte seguia instável. <!-- handoff:215 -->
- Passagem revisor-plataforma → developer (rodada 3): cinco achados — a porta só consultada com texto fora do esquema; a coleta pedida antes da porta e o laço consultando-a depois; o relógio da etapa não batido na espera do "sim"; a etapa podendo terminar sem formato e sem pedido final; a linha de entrega gravando o texto do usuário. <!-- handoff:216 -->
- Passagem pessoa → developer: Volta e pede as correções <!-- handoff:295 -->
- Passagem developer → revisor-plataforma: Terminar os commits 3 a 6 do plano, que são a maior parte da issue. <!-- handoff:330 -->
- Passagem revisor-plataforma → developer (rodada 4): os 5 erros de tipo de `test/engine-incoming.test.ts` (roteiro do servidor de mentira em texto puro), a suíte vermelha (10/12 no arquivo do motor, 3674/3676 na suíte), e os commits 3 a 6 do plano. <!-- handoff:361 -->
