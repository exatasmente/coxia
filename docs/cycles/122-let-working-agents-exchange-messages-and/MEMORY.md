# Memória do ciclo

## Decisões

- Issue 122 é um pedido de funcionalidade (`enhancement`), não um defeito, não uma pergunta e não uma duplicata: um agente que trabalha uma etapa deve poder receber mensagem durante a etapa sem reiniciá-la, mandar mensagem sem terminar a etapa e chamar outro agente para discutir um ponto.
- A triagem não fez pergunta a quem abriu nem pausou a etapa: a issue é uma especificação funcional completa e diz que o desenho da solução pertence ao refino e ao planejamento. Não falta nada que só quem abriu possa dizer.
- Sugestão de prioridade `priority:high` no documento da triagem (não preenchida): hoje a única forma de o time trocar informação numa execução é a pergunta que para a etapa, a menção que responde numa cópia descartável ou esperar o fim da etapa; e a issue entra na autonomia e na lista de comandos por agente.
- Proposta de squad: `plataforma` (o pedido é do runtime). A fatia de tela (aviso de entrega, link entre a execução e a conversa do fórum, o `@` da pessoa) pertence a `experiencia`, mas quem leva a issue é o runtime.

## Restrições

- Correção ao texto da issue, conferida por leitura: hoje uma mensagem com `@` a um agente que trabalha **já é atendida em paralelo**, mas como uma execução separada, sempre somente leitura (sem `Edit` nem `Write`, qualquer que seja a permissão), numa sessão sobre uma **cópia descartável** do código (`src/main/mentions/answer.ts`). O que a seção 1 pede é diferente: a mensagem entrar na sessão da **própria etapa**, entre dois passos do modelo, nos dois motores, sem reiniciar a etapa.
- Uma pergunta continua parando a etapa (`ask`, `src/main/runner/service.ts:479-486`) e a etapa seguinte recebe pergunta e resposta no prompt (`pendingAnswer`, `src/main/runner/executor.ts:116-124`). `turnsTo` só serve para pergunta; só mensagem de pessoa chama agente (`src/main/runner/service.ts:894-898`), até três por mensagem, em fila serial por execução.
- Não existe ferramenta `SendMessage` nem `CallAgent` hoje (busca no código): as ferramentas de um agente são leitura, escrita confinada, shell e as do app (`src/main/engine/contract.ts`, `src/main/agents.ts`).
- A issue cita o limite de rodadas por conversa (configuração do workspace), o teto de conversas por etapa, o uso do modelo da chamada contando na etapa de quem chamou, os relógios da etapa andando, a recusa de um ciclo de chamadas e a exigência de um escritor por vez no worktree. Agentes de execuções diferentes conversando entre si estão fora de escopo.
- Um agente chamado por `@` usa o mesmo limite de turnos de uma etapa que só lê (`runner.turns.read`), com a retomada de uma vez sem ferramentas; hoje isso está em `docs/runner.md` (\"Perguntas e menções\").
- A issue cita a issue 118 (autonomia e a lista de comandos por agente) como dependência, e a aceitação cobra que o comando de um agente chamado apareça na lista de comandos da execução sob ele.

## Tentado e descartado

- Perguntar a quem abriu algo que a triagem precisa ouvir: nada foi encontrado que falte, então não houve pergunta.
- Tratar o pedido como bug: o que a issue descreve como estado atual confere com o código; não há comportamento errado a reproduzir.
- Tratar as issues de menção (o `@` em qualquer lugar onde a pessoa escreve; o aviso de que um agente chamado está trabalhando) como duplicatas: são relacionadas — uma compartilha o ponto de partida, a outra é o aviso de tela que a seção 1 reaproveita — mas pedem coisas diferentes.

## Perguntas abertas

- Quantas rodadas por conversa e quantas conversas por etapa um workspace ganha por padrão (decisão de refino; o teto por conversa já vem de configuração do workspace).
- O que uma etapa faz com uma mensagem que chega quando ela está prestes a terminar.
- Não verificado nesta etapa: a forma exata como cada motor aceita uma mensagem no meio de uma sessão (Claude Agent SDK e motor aberto). O refino precisa conferir isso na leitura.

## Onde o trabalho está

- Etapa de triagem concluída, sem pausa em pergunta. Documento produzido: `docs/cycles/[redacted]/0_TRIAGE.md` (tipo, entendimento, o que falta, issues relacionadas e a sugestão de prioridade).
- A etapa seguinte (refino do produto, `1_SPEC.md`) escreve a especificação; o desenho da solução e o plano vêm depois.
- Nada foi executado nesta etapa: a issue, os documentos do ciclo, `docs/runner.md`, `docs/cycles.md`, `docs/configuration.md`, `CONTRIBUTING.md` e o código citado foram lidos.
