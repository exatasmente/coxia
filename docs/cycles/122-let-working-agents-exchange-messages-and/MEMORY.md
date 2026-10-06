# Memória do ciclo

## Decisões

- Issue 122 é um pedido de funcionalidade (`enhancement`): um agente que trabalha uma etapa deve poder receber mensagem durante a etapa sem reiniciá-la, mandar mensagem sem terminar a etapa e chamar outro agente para discutir um ponto. A triagem não pausou em pergunta; o refino também não: nada aqui é decisão de quem abriu.
- A especificação funcional está escrita em `docs/cycles/[redacted]/1_SPEC.md`, nas palavras do produto e citando a issue em bloco. Ela cobre receber/ mandar/ chamar, os limites, o que muda para quem usa, fora de escopo, critérios de aceite e o que ficou em aberto. Não projeta solução.
- Proposta de prioridade mantida: `priority:high` (não preenchida). Motivo: hoje o time só troca informação por uma pergunta que para a etapa, uma menção que responde numa cópia descartável, ou esperando o fim da etapa; e a issue entra na autonomia e na lista de comandos por agente. Sem marco: o repositório não declara marcos e a issue não cita um.
- Squad: `plataforma` (o pedido é do runtime). A fatia de tela (aviso de entrega, link entre a execução e a conversa do fórum, o `@` da pessoa) pertence a `experiencia`.

## Restrições

- Correção ao texto da issue, conferida por leitura: uma mensagem com `@` a um agente que trabalha **já é atendida em paralelo**, mas como execução separada, sempre somente leitura, numa sessão sobre **cópia descartável** do código quando roda comandos (`src/main/mentions/answer.ts`). A seção 1 pede outra coisa: a mensagem entrar na sessão da **própria etapa**, entre dois passos do modelo, nos dois motores, sem reiniciar.
- Uma pergunta continua parando a etapa; a etapa seguinte recebe pergunta e resposta no prompt (`pendingAnswer`, `src/main/runner/executor.ts`). Só mensagem de pessoa chama agente (`src/main/runner/service.ts:894-898`), com fila serial por execução.
- Não existe ferramenta `SendMessage` nem `CallAgent` hoje (busca no código): as ferramentas do agente são leitura, escrita confinada ao worktree, shell e as do app (`src/main/engine/contract.ts`).
- A issue cita: limite de rodadas por conversa (configuração do workspace), teto de conversas por etapa, uso do modelo contando na etapa de quem chamou, relógios da etapa andando, recusa de ciclo de chamadas e um escritor por vez no worktree. Agentes de execuções diferentes conversando está fora de escopo.
- A issue cita a 118 (autonomia e lista de comandos por agente) como dependência; a aceitação cobra que o comando de um agente chamado apareça na lista de comandos da execução sob ele.
- Toda especificação só afirma o conferido: nesta etapa tudo foi por leitura; nada foi executado quanto ao comportamento novo.

## Tentado e descartado

- Perguntar a quem abriu: nada falta que só ele saiba; a issue é especificação funcional completa e adia o desenho.
- Tratar como bug: o estado atual que a issue descreve confere; não há defeito a reproduzir.
- Tratar as issues de menção como duplicatas: são relacionadas, pedem coisas diferentes.
- Deixar a spec escolher os padrões e o encaixe entre passos: pertence ao plano, não ao produto.

## Perguntas abertas

- Quantas rodadas por conversa e quantas conversas por etapa um workspace ganha por padrão (decisão de refino/plano).
- O que uma etapa faz com uma mensagem que chega quando ela está prestes a terminar.
- Não verificado: a forma exata como cada motor (Claude Agent SDK e motor aberto) aceita uma mensagem no meio de uma sessão já em andamento. O plano precisa conferir.

## Onde o trabalho está

- Triagem (`0_TRIAGE.md`) e refino do produto (`1_SPEC.md`) concluídos, sem pausa em pergunta. O documento do refino cita a issue em bloco nas seções de comportamento e nos aceites.
- A etapa seguinte (plano técnico, `2_PLAN.md`) resolve o desenho: o encaixe da mensagem entre dois passos nos dois motores, um escritor por vez no worktree, onde rodam os comandos de um agente chamado e como entram na lista de comandos sob ele, o que é commitado e com que etapa, a autonomia para host/escrita externa/push, e os padrões de rodadas e de conversas.
- Nada foi executado nesta etapa. Verificação: `node scripts/public-audit.mjs` passou (908 arquivos, nada que pertença a empresa ou pessoa). Conferido por leitura: docs/runner.md, docs/cycles.md, docs/configuration.md, src/main/mentions/answer.ts, src/main/engine/contract.ts, src/main/runner/executor.ts e src/main/runner/service.ts.
- Passagem support → product-owner: A issue é um pedido de funcionalidade claro e completo: o refino pode seguir sem perguntar a quem abriu. Ao escrever a especificação, partir da correção da triagem: hoje a menção a um agente que trabalha já é atendida em paralelo, mas numa execução separada e somente leitura, numa cópia descartável do código — o que a seção 1 pede é diferente, é a mensagem entrar na sessão da etapa, entre dois passos do modelo, nos dois motores, sem reiniciar a etapa. O desenho precisa dizer o que a issue já cobra: um escritor por vez no worktree (e o que o outro vê), onde rodam os comandos de um agente chamad… <!-- handoff:7 -->
