# O time ainda não conversa durante a etapa, e a resposta final da etapa deixou de ser a pedida

## O que se pede e o que existe

A issue pede três coisas: uma mensagem escrita para o agente que trabalha chega a ele durante a etapa, sem recomeçá-la; o agente que trabalha manda mensagem sem terminar a etapa; e ele chama outro agente, que responde e discute com ele.

O que existe na árvore:

- A porta pela qual o motor recebe uma mensagem entre dois passos do modelo, e o pedido de resposta final que a acompanha.
- A caixa da etapa, que guarda a fila de mensagens, avisa que a etapa começou a fechar e escreve na conversa as linhas de espera, de entrega e de "não deu tempo".
- A entrada da mensagem que cita o agente que trabalha na fila daquela etapa, com a linha de espera na mensagem.

O que não existe no código, e é a maior parte do que a issue pede: as três ferramentas, a conversa do agente chamado, o dono único do worktree, o uso contado na etapa de quem chamou e o bloco de limites na configuração. Os três critérios de aceite principais (o desenvolvedor manda a nota de andamento; o desenvolvedor chama o QA numa conversa nova e o QA roda comando; o agente chamado com permissão de escrever muda arquivo sem dois escritores ao mesmo tempo) **não podem ser satisfeitos** por esta árvore.

## O que foi conferido, e como

Por execução, na cópia de trabalho: a verificação de tipos, o teste novo do motor, o lint das duas línguas, a auditoria pública (o repositório é público) e os arquivos que a branch toca e os vizinhos de motor, menções, sandbox, host e esquema de configuração. Por leitura: o código que a branch mudou, o que a mudança atravessa e o pacote do modelo instalado.

1. **A verificação de tipos não passa:** 7 erros, todos no arquivo de teste novo (os dois dublês de turnos do pacote e o objeto de papel resolvido da chamada). Nenhum é do código de produção, mas o gate fica vermelho.
2. **O teste novo do motor passa sozinho** (6 de 6). O verde não diz nada sobre o motor real: o dublê do teste puxa o primeiro turno no início da iteração, antes de o código de produção pedir a entrega, então ele faz o trabalho que no motor real o próprio motor faria.
3. **O que passa por execução:** o motor aberto (35 arquivos de teste… o arquivo de laço com 35 casos, o de ferramentas com 27), as menções com comandos (6), o sandbox (15), a casca do host (4 arquivos, 6 casos), o endereçamento de sandbox (test/sandbox-hardening), a cópia de árvore, as dependências ligadas, o esquema de configuração, a cerimônia de ponta a ponta (runner-golden, 6 casos) e o agente do pacote (11). O lint das duas línguas e a auditoria pública também passam.
4. **A suíte inteira não foi rodada nesta etapa.** A revisão anterior a viu passar numa execução e falhar em duas seguintes, com poucas falhas em arquivos que a branch não toca; rodando só esses arquivos, a suíte passa. O resultado da suíte completa não permite dizer se a branch quebrou alguma coisa, e não foi conferido contra a base.
5. **Por leitura do pacote do modelo instalado:** o caminho de entrada contínua que o código usa é o documentado pelo próprio pacote, e cada turno tem um resultado próprio, que é o que o código consome; a saída estruturada também é do pacote. Nenhum modelo real foi chamado.

## A entrega volta

1. **A resposta final da etapa pode virar o texto que a mensagem pediu, não o que a etapa pede.** No motor aberto, quando o modelo termina um passo sem responder ao formato pedido e não há mais mensagem a entregar, o laço não pede nada: ele repete a **mesma** resposta, agora sem ferramentas, e é esse texto que passa a valer como resultado da etapa. Com as ferramentas de volta no passo seguinte, um texto que descreva o pedido da mensagem em vez de responder ao formato da etapa termina como o resultado dela. O plano diz que a passada de coleta é "inegociável" e é ela que garante que uma mensagem no meio nunca faça a etapa terminar com um texto solto — essa garantia não está no código.
2. **O que a mensagem diz chega ao modelo sem o enquadramento que o plano fixa.** Do jeito que está, o texto da pessoa entra como material bruto; o lembrete de que aquilo é informação e de que o resultado continua sendo o da etapa só existe no ramo do fechamento.
3. **O caminho de hoje muda para uma mensagem duplicada.** A fiação guarda a citação para a fila da etapa e depois remove da chamada paralela aquilo que já foi para a fila. Hoje uma menção repetida ao mesmo agente abre uma chamada para cada uma; com a mudança, a segunda é descartada em silêncio.
4. **A revisão do plano sobre o que o agente chamado pode fazer tem um caminho que não confere.** O plano afirma que um agente que só lê recebe uma cópia descartável e que o que escreve não recebe nenhuma, e usa isso para decidir que o agente chamado que só lê não precisa de dono do worktree. No código, a sessão de comandos de uma menção numa conversa de execução abre sobre o worktree, nunca sobre uma cópia, porque o leitor é forçado; o que decide a cópia, nas outras conversas, é a pasta de onde o agente fala, não a permissão dele. Quem implementar a partir dessa frase desenha o dono errado.
5. **O commit do trabalho do agente chamado apaga o que ele escreveu.** O plano decide que o commit do fim da conversa usa o mesmo caminho de sempre, e esse caminho ignora toda pasta que o nome sigiloso alcance. Um arquivo chamado como as pastas ignoradas, num diretório ligado da execução, não entra no commit e o trabalho do agente chamado some.
6. **A auditoria e o "sobe" da instalação de dependências não batem.** A limpeza do arquivo de configuração do host de código, no plano, roda para todo comando com identidade, sem depender da autonomia; a frase de hoje diz "um agente que escreve". As duas leituras dão resultados diferentes sobre quando essa limpeza acontece.

## O que não foi verificado

- Se o modelo real aceita uma mensagem numa sessão em andamento e se a saída estruturada sobrevive: não verificado. A conferência foi a documentação do pacote instalado; nenhum modelo real foi chamado.
- O dono único do worktree, a execução de comandos do agente chamado, a corrida entre escritores, o uso contado na etapa e os limites de rodadas e de conversas: não existem no código, então não há o que exercitar.
- O motor com a mensagem entregue de verdade: o teste novo usa um dublê que puxa o turno antes da hora, então o que ele cobre é a mecânica do arquivo de teste, não o encaixe no pacote real.
- Se a suíte completa tem falhas intermitentes também fora desta branch: não foi conferido contra a base.
