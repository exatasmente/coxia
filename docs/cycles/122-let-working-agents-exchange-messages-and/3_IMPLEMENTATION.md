# Trocar mensagens durante a etapa: o que foi implementado

> Nota de implementação **parcial**. Uma parte do plano está no worktree e foi exercitada; o resto não foi escrito. Tudo o que não foi exercitado está dito como **não verificado**.

## O que mudou

### A porta de entrada do motor (commit 1 do plano)

O contrato do motor ganhou uma porta de entrada nova. Uma etapa que conversa chama o motor passando uma função que, quando o modelo termina um passo, devolve a próxima mensagem a entregar ou nada. A mensagem entra na sessão como material de fora (entre as marcas `data`), com o lembrete de que o resultado pedido no início continua sendo o da etapa.

Nos dois motores:

- No motor aberto, quando o modelo termina um passo sem resposta final, a mensagem é escrita no diálogo como mensagem de usuário e o laço faz mais uma chamada. Quando a porta não tem mais nada, uma chamada final é pedida **sem nenhuma ferramenta**, com o formato do esquema: é essa resposta que vira o resultado da etapa. Sem a porta, a chamada é exatamente a de hoje, uma passada só.
- No Claude Agent SDK, a sessão passa a ficar aberta (entrada em fluxo) e a mensagem entra como turno de usuário da mesma sessão; a coleta acontece no mesmo id de sessão.

### A caixa da etapa (commit 1)

Um módulo novo guarda a fila de mensagens de cada etapa que trabalha: a próxima mensagem a entregar, a entrega, o interruptor de fecho e o registro no fórum. A entrega escreve na conversa da execução uma linha com o agente e a hora; uma mensagem que chega quando a etapa já está fechando não é entregue e volta na conversa com o motivo. O executor abre a caixa com a tentativa, pendura-a na chamada do motor e fecha-a antes do sandbox, sempre.

### A fiação da mensagem à etapa (commit 2, em parte)

Quando uma pessoa escreve na conversa da execução citando o agente que **está** trabalhando a etapa, a mensagem entra na fila daquela etapa, e a mensagem ganha a linha de que espera o próximo passo. Todo o resto mantém o comportamento de hoje: uma citação a um agente que não está trabalhando (ou a uma execução que não está trabalhando) continua chamando o agente em paralelo.

## O que foi conferido

- **Por execução**: o teste novo do motor cobre os dois motores com um modelo roteirizado — a mensagem entregue entre dois passos vira uma chamada a mais no mesmo diálogo, a coleta pede a resposta final sem ferramentas, e sem a porta a chamada é a de hoje. Rodou e passou (6 de 6) com o código de produção desta árvore.
- **Por leitura**: o SDK em `node_modules` oferece entrada em fluxo (um fluxo de mensagens de usuário) e mantém a sessão entre turnos; a implementação usa esse caminho e cai no comportamento de hoje quando a porta está ausente.
- `npx tsc --noEmit` passou antes das últimas edições feitas no arquivo de teste.

## O que não foi verificado

- O SDK real aceitar uma mensagem no meio de uma sessão em andamento: a conferência foi pelos tipos, pelo código do SDK e por um dublê no teste. **Nenhum modelo real foi chamado.**
- Os gates completos do repositório (a suíte inteira, o tema, o i18n, o audit público, o build): não foram rodados.
- As ferramentas `SendMessage`, `CallAgent` e `askConversation`, a conversa do agente chamado, o dono único do worktree, o uso contado na etapa e o bloco de configuração dos limites: **não foram implementados** (os commits 3 a 6 do plano). Nada do comportamento de ponta a ponta que a issue pede foi visto funcionando.
