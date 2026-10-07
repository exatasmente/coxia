# O time ainda não conversa durante a etapa, e uma mensagem já na fila pode não chegar

## O que se pede e o que existe

A issue pede três coisas: uma mensagem escrita para o agente que trabalha chega a ele durante a etapa, sem recomeçá-la; o agente que trabalha manda mensagem sem terminar a etapa; e ele chama outro agente, que responde e discute com ele.

O que existe na árvore:

- A porta pela qual o motor recebe uma mensagem entre dois passos do modelo, e o pedido de resposta final que a acompanha.
- A caixa da etapa, que guarda a fila de mensagens, avisa que a etapa começou a fechar e escreve na conversa as linhas de espera, de entrega e de "não deu tempo".
- A entrada da mensagem que cita o agente que trabalha na fila daquela etapa, com a linha de espera na mensagem.
- O enquadramento da mensagem entre as marcas de material, com o lembrete de que o resultado continua sendo o da etapa, nos dois motores.

O que não existe no código, e é a maior parte do que a issue pede: as três ferramentas, a conversa do agente chamado, o dono único do worktree, o uso contado na etapa de quem chamou e o bloco de limites na configuração. Os três critérios de aceite principais (o desenvolvedor manda a nota de andamento; o desenvolvedor chama o QA numa conversa nova e o QA roda comando; o agente chamado com permissão de escrever muda arquivo sem dois escritores ao mesmo tempo) **não podem ser satisfeitos** por esta árvore.

## O que foi conferido, e como

Por execução, na cópia de trabalho:

- A verificação de tipos **passa** (saída 0); era vermelha, com sete erros, todos no arquivo de teste novo, e nenhum deles no código de produção.
- O teste novo do motor **passa inteiro** (sete casos), incluindo o que fixa a coleta: o roteiro do modelo devolve primeiro um texto que responde à mensagem, fora do esquema, e depois a resposta boa; o resultado da etapa só pode sair da terceira chamada, que não oferece ferramenta alguma.
- A **suíte completa passa**: 3671 casos em 223 arquivos. A instabilidade que as duas revisões anteriores viram (falhas em arquivos que a branch não toca, sob carga) **não apareceu** nesta execução.
- O motor aberto, as menções com comandos, o sandbox, a casca do host, o endereçamento de sandbox, as dependências ligadas, o esquema de configuração, a cerimônia de ponta a ponta e o agente do pacote passam.
- O lint das duas línguas (4061 chaves em cada uma), a auditoria de tema e a auditoria pública (913 arquivos) passam.
- O texto que o app manda ao modelo na coleta é o pedido de resposta final; conferido por execução, na língua da instalação.

Por leitura: o código que a branch mudou, o que a mudança atravessa (o laço do motor aberto, a sessão, a caixa da etapa, a fiação da mensagem, o executor e o sandbox) e o pacote do modelo instalado. Nenhum modelo real foi chamado.

## O que a rodada anterior pediu, e como ficou

1. **A verificação de tipos**: atendida. Passa por execução.
2. **A coleta do motor aberto não pedia nada ao modelo**: atendida. A coleta faz uma chamada de verdade, **sem nenhuma ferramenta**, com o formato do esquema, e só o que sai dela é o resultado da etapa; um texto fora do esquema ali vira erro de formato, não resultado.
3. **A menção repetida ao mesmo agente perdia a segunda chamada**: atendida. Uma ocorrência vai para a fila da etapa e o resto da lista segue para o caminho de hoje, sem mexer no comportamento atual.
4. **O enquadramento da mensagem sem os dois-pontos do título**: atendida nos dois motores.

As duas sugestões sobre o plano (onde a sessão de uma menção com comandos realmente abre, e o que fica fora do commit por nome de pasta) nunca foram bloqueantes e continuam valendo para quem implementar os commits 4 e 5.

## A entrega volta

1. **Uma mensagem que já estava na fila pode não ser entregue nem anunciada.** A porta é consultada **só** quando o modelo devolve um texto que não segue o esquema. Num passo em que o modelo já termina respondendo ao formato (uma situação comum), a etapa acaba ali mesmo: a fila daquela etapa é fechada, o que sobrou volta como linha de "não deu tempo" — e o que já tinha entrado na fila antes disso **nem é entregue ao agente, nem é anunciado na conversa**: a etapa termina com um resultado que não considerou a mensagem, e nada diz que ela chegou. O teste novo cobre o caminho em que o modelo responde fora do esquema antes de responder ao formato; a outra ordem, que é a do uso real, não é exercitada.
2. **A coleta também pede à porta uma mensagem para entregar.** A chamada que pede a resposta final é feita antes de a porta ser consultada, mas logo depois o laço volta ao começo, o modelo responde ao esquema e a porta é consultada de novo. Uma mensagem que chegue nessa janela é tratada como mensagem a entregar e entra na sessão **depois** de o modelo já ter dado a resposta final — direção contrária à que o plano fixa (mensagem antes, coleta depois). Não foi exercitado o efeito disso sobre o texto que o agente escreve.
3. **Um passo que espera o "sim" da pessoa pode travar a etapa.** Enquanto um comando que precisa da autorização da pessoa espera a resposta, o relógio de ociosidade da etapa não é batido; o sandbox **pausa** o relógio daquele passo, mas essa pausa não chega ao relógio da etapa. O trabalho da etapa passa a parecer parado durante todo o tempo em que o agente espera a pessoa responder, e, quando o limite de ociosidade termina, a etapa é encerrada como se o agente tivesse ficado sem dar sinal. O que isso muda em relação a hoje: a mensagem agora pode entrar num ponto do passo em que a sessão da etapa está sob a pausa do "sim", e é a mensagem que empurra o laço adiante enquanto essa pausa vale.
4. **A etapa pode terminar sem satisfazer o formato, e sem um último pedido de resposta em muitos casos.** Quando uma mensagem chega no meio, o texto do passo seguinte vira o resultado candidato; se ele não seguir o esquema, a coleta pede a resposta final, e um erro no caminho reprova a tentativa. Mas, depois de a porta ser consultada pela primeira vez (e não ter nada), o laço volta a chamar o modelo com a resposta final apenas como pedido em texto — sem formato de resposta, sem ferramenta e sem rodada de correção —, e um texto que não siga o esquema encerra a tentativa como erro. É um caminho novo, que hoje não existe, e nada o exercita.
5. **A tela mostra a entrega com o texto do usuário.** Cada mensagem entregue escreve na conversa a linha de entrega com a mensagem dentro, e essa linha fica gravada também no arquivo da conversa, que é o que a próxima tentativa da mesma etapa relê inteiro. Uma mensagem escrita para o agente reaparece como histórico do passo seguinte. Não é só o aviso: o texto entra no que o agente lê depois.

## O que não foi verificado

- Se o modelo real aceita uma mensagem numa sessão em andamento e se a saída estruturada sobrevive: não verificado. A conferência foi a documentação e o código do pacote instalado; nenhum modelo real foi chamado. O teste do SDK usa um dublê que entrega o turno antes de o código de produção pedir a entrega, então o verde dele cobre a mecânica do arquivo de teste, não o encaixe no pacote real.
- O dono único do worktree, a execução de comandos do agente chamado, a corrida entre escritores, o uso contado na etapa e os limites de rodadas e de conversas: não existem no código, então não há o que exercitar.
- O caminho em que o modelo responde ao formato **antes** de a porta ser consultada, e a mensagem que chega durante a coleta: lidos no código, não exercitados.
- Se os relógios da etapa andam enquanto o agente espera o "sim" da pessoa no meio de um passo em que uma mensagem pode entrar: não exercitado.
