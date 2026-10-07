# A verificação de tipos e o teste novo do motor ainda não passam, e a conversa durante a etapa segue sem existir

## O que se pede e o que existe

A issue pede três coisas: uma mensagem escrita para o agente que trabalha chega a ele durante a etapa, sem recomeçá-la; o agente que trabalha manda mensagem sem terminar a etapa; e ele chama outro agente, que responde e discute com ele.

O que existe na árvore:

- A porta pela qual o motor recebe uma mensagem entre dois passos do modelo, e o pedido de resposta final que a acompanha.
- A caixa da etapa, que guarda a fila de mensagens, avisa que a etapa começou a fechar e escreve na conversa as linhas de espera, de entrega e de "não deu tempo".
- A entrada da mensagem que cita o agente que trabalha na fila daquela etapa, com a linha de espera na mensagem.
- O enquadramento da mensagem entre as marcas de material, com o lembrete de que o resultado continua sendo o da etapa, nos dois motores.

O que não existe no código, e é a maior parte do que a issue pede: as três ferramentas, a conversa do agente chamado, o dono único do worktree, o uso contado na etapa de quem chamou e o bloco de limites na configuração. Os três critérios de aceite principais (o desenvolvedor manda a nota de andamento; o desenvolvedor chama o QA numa conversa nova e o QA roda comando; o agente chamado com permissão de escrever muda arquivo sem dois escritores ao mesmo tempo) **não podem ser satisfeitos** por esta árvore.

## O que foi conferido, e como

Por execução, nesta cópia de trabalho:

- A verificação de tipos **falha**: saída 1, com 5 erros, todos em `test/engine-incoming.test.ts`, todos do mesmo tipo — um texto simples passado onde o roteiro do servidor de mentira exige um passo.
- O teste novo do motor fica **10 de 12**: os dois casos que não passam estouram no próprio servidor de mentira, ao receber esse roteiro em texto puro (o código de produção não é exercitado por eles).
- A **suíte completa fica 3674 de 3676** em 223 arquivos, com as duas mesmas falhas; nenhuma outra falha apareceu nesta execução.
- A auditoria de tema **passa** (55 pares de contraste em cada tema, 8 cores literais, todas em um arquivo que a branch não toca).
- O lint das duas línguas **passa**: 4061 chaves em cada uma.
- A auditoria pública **passa**: 913 arquivos, nada de empresa ou de pessoa.

Por leitura: o código que a branch mudou, o que a mudança atravessa (o laço dos dois motores, a sessão, a caixa da etapa, a fiação da mensagem, o executor, o sandbox e o relógio da etapa) e o pacote do modelo instalado. Nenhum modelo real foi chamado.

## O que a rodada anterior pediu, e como ficou

1. **Uma mensagem já na fila pode não ser entregue nem anunciada**: atendido no código de produção. A porta é consultada ao fim de cada passo do modelo, antes de qualquer conclusão, nos dois motores, e a mensagem que está na fila entra na sessão e é anunciada antes de a etapa fechar. O caso de teste que fixa isso não roda (ver abaixo), então o comportamento não ficou confirmado por execução.
2. **A coleta também pedia à porta uma mensagem**: atendido. A coleta é uma chamada só, sem ferramenta alguma, com o formato do esquema, e é ela que fecha o diálogo; o laço não consulta mais a porta depois dela, e no ramo do motor do SDK a sessão de entrada é fechada quando a instrução de resposta final entra.
3. **O relógio de ociosidade da etapa não era batido na espera do "sim"**: atendido. A entrega de uma mensagem bate o relógio do passo e o relógio de ociosidade da etapa; um comando que espera a pessoa pausa os dois e a pausa volta a valer no fim da espera (conferido por leitura do relógio e do embrulho do sinal de vida).
4. **A etapa podia terminar sem formato**: em parte. No motor aberto, quando o texto não segue o esquema, erro nenhum é lançado dentro da coleta: os erros voltam ao modelo no diálogo, com uma rodada para corrigir, e a chamada seguinte traz o formato na própria requisição. Resta a questão do passo seguinte contar para o teto de rodadas (apontada como sugestão, porque o teto zero já existia).
5. **A linha de entrega gravava o texto do usuário**: atendido no que a linha é; o texto continua voltando ao prompt na tentativa seguinte. Por decisão registrada na memória, isso fica como está nesta fase de escopo, e o custo (janela de 40 mensagens) segue anotado para quem escrever a conversa.

As duas sugestões sobre o plano (onde a sessão de uma menção com comandos realmente abre, e o que fica fora do commit por nome de pasta) nunca foram bloqueantes e continuam valendo para quem implementar os commits 4 e 5.

## O que a entrega precisa antes de voltar

1. **A verificação de tipos não passa, e todos os 5 erros estão no arquivo de teste novo.** Nenhum deles é no código de produção, mas o gate do repositório fica vermelho e a entrega não pode seguir assim. O mesmo roteiro malformado derruba os dois casos novos do motor aberto, que é justamente o teste que fixa os dois primeiros achados da rodada anterior — enquanto ele não rodar, esses dois consertos seguem sem confirmação por execução.
2. **A maior parte da issue continua sem código.** As três ferramentas (`SendMessage`, `CallAgent` e a do agente chamado), a conversa do agente chamado, o dono único do worktree com o trabalho do chamado commitado com a etapa, o uso contado na etapa de quem chamou e o bloco de limites na configuração não existem. Sem eles, os critérios de aceite principais não podem ser satisfeitos.

## O que não foi verificado

- Se o modelo real aceita uma mensagem numa sessão em andamento e se a saída estruturada sobrevive: não verificado. A conferência foi a documentação e o código do pacote instalado; nenhum modelo real foi chamado. O teste do motor do SDK usa um dublê cuja forma não corresponde exatamente à forma do pacote que o código usa, então o verde dele cobre a mecânica do arquivo de teste, não o encaixe real.
- O dono único do worktree, a execução de comandos do agente chamado, a corrida entre escritores, o uso contado na etapa e os limites de rodadas e de conversas: não existem no código, então não há o que exercitar.
- O comportamento que os dois casos de teste que não rodam deveriam fixar (a mensagem já na fila entregue ao fim do passo que responde ao formato, e a rodada de correção): lidos no código, não exercitados.
- O relógio da etapa no meio de um passo em que o agente espera o "sim" da pessoa: lido no código, não exercitado.
