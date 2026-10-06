## Tipo

Pedido de funcionalidade, com o rótulo `enhancement`. Não relata defeito, não é pergunta e não repete outra issue. Pede que um agente que trabalha uma etapa troque mensagens **enquanto trabalha**: que uma mensagem a ele chegue durante a etapa sem reiniciá-la, que ele possa mandar mensagem sem terminar a etapa e que possa chamar outro agente para discutir um ponto, na conversa da execução ou numa conversa própria do fórum ligada à execução.

## Dá para entender como está escrita

Dá. É um pedido de comportamento novo e não há defeito a reproduzir; a conferência foi por leitura da issue, dos documentos do runner e das cerimônias e do código citado — nada foi executado e nenhuma tela foi aberta. O estado atual que a issue descreve confere, com uma correção.

Confere:

- Uma pergunta encerra a etapa: a resposta da etapa pausa a execução (`ask`/`stageWaitingOnBudget` em `src/shared/runs/transitions.ts`, chamado em `src/main/runner/service.ts:479-486`) e a etapa seguinte recebe a pergunta e a resposta no prompt (`pendingAnswer`, `src/main/runner/executor.ts:116-124,397`).
- Um agente só recorre a outro com uma pergunta (`turnsTo`, `src/main/runner/executor.ts:405`; a caminhada da pergunta em `src/main/runner/service.ts:1093-1141`), e o outro só pode responder.
- Só a mensagem de uma pessoa chama um agente: a assinatura de mensagens só olha mensagem de pessoa, com menção e em conversa de execução (`src/main/runner/service.ts:894-898`), o máximo é de três agentes por mensagem (`MAX_MENTIONS`) e as chamadas da mesma execução esperam a vez (`src/main/runner/service.ts:905-911`).
- Não existe ferramenta alguma para um agente mandar mensagem ou chamar outro durante a etapa: as ferramentas que o modelo recebe são leitura, escrita confinada, shell e as do app (`src/main/engine/contract.ts:70-113`; `src/main/agents.ts:1000-1066`), e uma busca por `SendMessage` e `CallAgent` não encontra nada além do registro da própria issue.
- O que a issue cita sobre a execução de uma chamada de `@` também confere no limite: quando o agente tem comandos, a resposta pode ser uma sessão de sandbox ou de host (`src/main/mentions/answer.ts:180-216`) e o limite de turnos das chamadas é o mesmo de uma etapa que só lê, com a retomada de uma vez sem ferramentas (`docs/runner.md`, "Perguntas e menções", e "Limite de passos dessas chamadas").

Correção (o estado atual é mais estreito do que "a mensagem não chega"):

- Hoje a mensagem com `@` a um agente **não espera a etapa terminar para ser atendida** — ela é atendida em paralelo, mas como uma execução nova e independente, que não é a sessão da etapa: é sempre somente leitura, qualquer que seja a permissão do agente, sem `Edit` nem `Write`; quando o agente tem comandos, eles rodam numa sessão aberta sobre uma **cópia descartável** do código e a cópia é apagada no fim da resposta (`src/main/mentions/answer.ts:103,180-216`; o comentário em `src/main/runner/service.ts:1016-1018`). O que a issue quer é outra coisa: a mensagem entrar **na sessão da própria etapa**, como mensagem entre dois passos do modelo, nos dois motores. O que a issue diz do agente que **não** está trabalhando confere: aí a menção continua chamando o agente, como hoje.

O que a issue já resolve sozinha e não precisa de pergunta:

- Ela diz que é especificação funcional e que o desenho da solução pertence ao refino e ao planejamento, e lista o que o desenho precisa dizer: um escritor por vez no worktree, onde rodam os comandos de um agente chamado e que eles aparecem na lista de comandos da execução sob o agente, o que é commitado e com que etapa.
- Diz o limite de rodadas por conversa (configuração do workspace), o teto de conversas por etapa, que o uso do modelo da chamada conta na etapa de quem chamou, que os relógios da etapa continuam andando e que um ciclo de agentes que volte a um agente que já está na cadeia é recusado.
- Diz o que fica de fora: agentes de execuções diferentes conversando entre si.

Verificação: leitura da issue, dos documentos do ciclo, de `docs/runner.md`, `docs/cycles.md`, `docs/configuration.md`, `CONTRIBUTING.md` e do código citado. Nada foi executado e nenhum comportamento foi visto funcionando.

## O que falta

Nada que só quem abriu possa dizer. Os pontos de comportamento que existem hoje e prendem o desenho estão na issue e nos documentos, e as decisões que sobraram são de refino, não de quem abriu: quantas rodadas por conversa e quantas conversas por etapa um workspace ganha por padrão, o que uma etapa faz com uma mensagem que chega quando ela está prestes a terminar, e como a mensagem entra numa sessão de modelo que hoje nasce e morre inteira num único passo (não verificado: a forma exata como cada motor aceita uma mensagem no meio da sessão).

## Issues relacionadas

- A issue que a própria 122 cita (autonomia e a lista de comandos por agente): define a autonomia que uma chamada passa a seguir e a lista de comandos por agente que a aceitação desta issue cobra. É dependência, não duplicata.
- O pedido de `@` em qualquer lugar onde a pessoa escreve: mexe no mesmo ponto de partida (menções e agentes chamados) por outro ângulo, de quem pode chamar e onde. Toca a seção 1, mas pede outra coisa; não é duplicata.
- A issue do aviso de que um agente chamado pela conversa está trabalhando: é o aviso de tela que a seção 1 desta issue reaproveita ("o que foi entregue, e quando, ou o que espera o próximo passo"). Reaproveita, não repete.

Nenhuma issue parece duplicar esta.

## Sugestão de prioridade

`priority:high`, como sugestão que não foi preenchida. Não é um defeito e não corrige erro de dados, mas hoje a única forma de o time trocar informação durante uma execução é a pergunta que para a etapa, a menção que responde numa cópia descartável ou esperar o fim da etapa — e a issue entra na autonomia e na lista de comandos por agente, que é o que permite um agente chamado mudar arquivo e rodar comando. Quem decide a prioridade é a etapa de refino do produto.
