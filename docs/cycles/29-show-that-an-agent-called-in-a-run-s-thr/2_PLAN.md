# Como o aviso de que um agente chamado está trabalhando será construído

## O que passa a acontecer

Entre a mensagem que chama um agente com `@` na conversa de uma execução e a resposta
dele, a tela passa a dizer que o chamado foi recebido, que passos o agente está dando e
se um chamado espera a vez do anterior. O aviso existe em quatro lugares ao mesmo tempo e
não vira mensagem: ele desaparece quando chega a resposta ou o aviso de falha.

- **Na conversa:** logo abaixo da mensagem que chamou, uma linha por agente chamado. Ela
  começa dizendo que aquele agente está trabalhando (ou que está esperando o chamado
  anterior, quando já há um em andamento naquela execução), é substituída pelo passo ao
  vivo enquanto o agente trabalha, e sai quando chega a resposta ou a falha daquele
  agente. Uma mensagem que chama dois ou três agentes ganha uma linha para cada, cada uma
  com o seu fim.
- **Na tela da execução:** o painel de atividade ao vivo passa a aparecer enquanto um
  chamado roda, qualquer que seja a situação da execução — inclusive quando ela espera num
  portão ou numa pergunta —, com o nome do agente chamado no lugar do título genérico.
- **No quadro de tarefas:** a entrada do chamado deixa de ser o "Agente" genérico; ela
  nomeia o agente e a execução, e abrir a entrada leva à conversa daquela execução.
- **No navegador pareado:** o mesmo, porque a conversa, a tela da execução e o quadro são
  os mesmos componentes; nenhuma tela nova é escrita para isso.

## A identidade de um chamado no registro de atividade

O registro de atividade já guarda, por linha, o contexto da execução (`run:<id>`), o papel
(o id do agente que atende) e um identificador único de cada execução de agente. O que ele
não guarda é de qual mensagem o chamado veio nem para qual conversa ele deve aparecer; por
isso, hoje, o chamado chega ao quadro como um único "Agente" sem nome e sem vínculo, e a
conversa não teria como saber quais linhas são de qual chamado.

A mudança acrescenta à linha um campo opcional que diz o agente, a conversa e a mensagem
que chamou. A identidade de um chamado passa a ser a execução de agente que o atende, que
já existe e é única por chamado; a conversa filtra as linhas por esse campo, e o quadro
agrupa por ele. Um estado novo, "na fila", entra no registro para o chamado que ainda
espera a vez; os estados de começo, fim e falha já existem. A leitura de recuperação
(quando a conversa é aberta no meio de um chamado, ou depois de a conexão cair e voltar)
passa a trazer também os chamados em andamento, mesmo quando outra execução de agente é a
mais recente daquele contexto — sem isso, a linha de um chamado que espera na fila não
reapareceria ao abrir a conversa.

## Ciclo de vida de um chamado

1. **Chegada.** Assim que a mensagem é aceita, cada agente chamado ganha o seu chamado no
   registro. Se já há um chamado daquela execução em andamento, a primeira linha diz que
   ele espera o anterior; senão, diz que está trabalhando.
2. **Passos.** Enquanto o agente trabalha, a mesma linha é substituída pelo passo ao vivo,
   os mesmos rótulos curtos e já redigidos que o painel e o quadro mostram hoje.
3. **Fim.** Na resposta, a linha sai e a resposta fica na conversa; na falha, a linha sai e
   o aviso de falha fica na conversa. Nos dois casos o chamado termina.
4. **Fila.** Um segundo chamado da mesma execução só começa quando o primeiro termina; a
   linha dele troca "esperando" por "trabalhando" nesse momento. A ordem é a da chegada e o
   limite de três agentes por mensagem continua.

O chamado continua somente leitura e mantém os limites de silêncio e de tempo da etapa: o
aviso relata o que já acontece, não muda o que o agente pode fazer nem quanto tempo tem.

## Por superfície

### Conversa

A conversa lê a atividade da sua execução e seleciona as linhas que carregam o chamado
daquela conversa, agrupadas por agente e mensagem; de cada grupo mostra só a linha mais
nova, ao lado do nome do agente. A linha fica logo abaixo da mensagem que chamou e some
quando o grupo termina. O aviso é anunciado como estado educado (uma região viva), para
quem usa leitor de tela, sem repetir cada passo: só o texto da linha muda.

A conversa de um canal ou geral não tem execução e não mostra nada disso; o `@` continua
texto comum ali, como hoje.

### Tela da execução

O painel de atividade ao vivo, que hoje só aparece com a execução em `trabalhando`, passa
a aparecer também quando há chamado em andamento, com o nome do agente chamado à frente e o
tempo contado desde o começo do chamado. Quando a execução está trabalhando por conta
própria, o painel continua como está. O painel não ganha nenhum conteúdo novo: ele mostra
os mesmos rótulos curtos de sempre.

### Quadro de tarefas

As linhas de chamado que hoje formam a única entrada "Agente" passam a formar uma entrada
por chamado, com o nome do agente e a referência da execução, e abrir a entrada leva à
conversa daquela execução. Os trabalhos que não são chamado de conversa — o que o
agendador roda sem ninguém ter pedido — continuam na entrada genérica de hoje. Os
contadores do botão flutuante passam a contar também essas entradas nomeadas.

### Textos e aparência

Todo texto novo sai do catálogo, com a chave nos dois idiomas (pt-BR e en): o rótulo do
estado de fila, o título do painel com o nome do agente e o rótulo da entrada do quadro.
Nomes de agente continuam vindo do catálogo pelo nome do próprio agente, como já acontece
nas outras telas.

A aparência usa só os tokens do tema já usados nessas telas (texto apagado, girador,
rótulos de mensagem); nenhuma cor literal entra. O contraste de 4,5:1 é conferido na
auditoria de tema. Nada aqui depende do áudio: o aviso é visual e funciona igual com a voz
desligada.

## Peças tocadas

- **Registro de atividade (compartilhado):** o tipo da linha ganha o campo do chamado e o
  estado de fila; a checagem de execução viva passa a tratar "na fila" como viva.
- **Registro de atividade (principal):** a linha nasce com o campo do chamado; a leitura de
  recuperação de um contexto inclui os chamados em andamento além da execução mais recente;
  um construtor de chamado cria a execução do chamado com o contexto da execução e a
  identidade recebida, para o aviso existir antes de o agente começar.
- **Chamado do motor:** o pedido de execução de um agente ganha o campo opcional da
  atividade já criada; quando ele vem preenchido, o motor não cria outra nem repete o
  começo, só relata o fim (concluído ou falha).
- **Chamada por `@`:** ao aceitar a mensagem, cada agente chamado ganha o seu chamado e a
  linha de chegada (fila ou trabalhando); ao começar de fato, a linha de fila vira
  trabalhando; o fim por falha antes do motor também fecha o chamado.
- **Seletor de linhas de chamado (renderer, sem DOM):** agrupa as linhas por chamado,
  escolhe a mais nova de cada grupo e descarta os grupos terminados; é a peça que a
  conversa e o quadro compartilham e a que os testes cobrem diretamente.
- **Conversa:** a linha transitória abaixo da mensagem que chamou.
- **Painel de atividade:** o título passa a aceitar o nome do agente.
- **Tela da execução:** a condição do painel e o rótulo.
- **Quadro de tarefas:** uma entrada por chamado, com o nome do agente e da execução, e a
  abertura da conversa da execução.
- **Catálogos:** as chaves novas em pt-BR e en.

## Riscos e como são cobertos

- **Misturar o trabalho da etapa com o chamado no mesmo contexto.** O painel da tela da
  execução usa o mesmo balde de atividade para os dois; por isso o rótulo com o nome do
  agente só entra quando há chamado vivo, e a conversa filtra pelo campo do chamado, que a
  execução da etapa não carrega. Quem monta a lista da conversa nunca olha para as linhas
  sem chamado.
- **Chamado que nunca começa** (a execução é cancelada enquanto ele espera, ou o agente
  deixa de existir). Sem tratamento, a linha ficaria "esperando" para sempre. O caminho de
  falha fecha o chamado, e o reinício do app esvazia o registro em memória; o teste cobre o
  fechamento por falha.
- **Duas chamadas do mesmo agente** em mensagens diferentes não podem virar uma linha só. A
  identidade inclui a mensagem que chamou, então os grupos são distintos; o teste cobre.
- **Recuperação incompleta** ao abrir a conversa no meio de um chamado enfileirado. A
  leitura de recuperação inclui os chamados em andamento; o teste cobre a leitura de um
  contexto com dois chamados, um deles na fila.
- **Ruído para leitor de tela** com a linha mudando de passo em passo. A região é educada e
  só o texto da linha muda; nenhum anúncio é pedido por passo.
- **Vazamento de conteúdo.** A linha mostra apenas os rótulos curtos que o registro já
  redige; nenhum conteúdo de arquivo, resultado de ferramenta ou ambiente entra.

## Como será conferido

Ainda não verificado nesta etapa: tudo o que segue é o que a implementação e a revisão
devem rodar.

- Testes de unidade sem tela: a linha carrega o chamado; "na fila" conta como execução
  viva; o seletor agrupa por chamado, mostra a linha mais nova e descarta o grupo terminado;
  a leitura de recuperação de um contexto traz um chamado enfileirado junto da execução mais
  recente.
- Teste do fluxo do chamado: uma mensagem que chama um agente produz o chamado com a
  conversa e a mensagem certas; uma segunda mensagem enquanto o primeiro roda produz a linha
  de fila e só começa depois que o primeiro termina; o fim por resposta e o fim por falha
  fecham o chamado; a atividade do motor carrega o mesmo chamado.
- Varredura de tela pareada: nenhum caminho exclusivo do aplicativo de computador entra nas
  telas, e os canais usados continuam permitidos no navegador.
- Portões do repositório: tipos, a suíte inteira, a auditoria de tema, o lint de catálogos
  e a auditoria pública.
- Conferência na tela, na revisão: a linha na conversa, o painel com a execução num portão,
  a entrada nomeada no quadro e o mesmo no navegador pareado — com a voz ligada e desligada.

## Fora do escopo

- A dica no campo de escrita quando o `@` é digitado num canal ou numa conversa geral.
- Chamados em paralelo e mais de três agentes por mensagem.
- Guardar o aviso no histórico: ele é transitório e não vira mensagem.
- Aviso de fim de chamado fora da tela (notificação do sistema, aviso passageiro).
- Qualquer mudança no que o chamado pode fazer: ele segue somente leitura, com os limites
  de silêncio e de tempo já configurados.

## O que foi conferido nesta etapa

Só o código foi lido: nenhuma tela foi aberta, nenhum fluxo foi executado e nenhum comando
foi rodado. Conferido na leitura: o chamado por `@` roda sob o contexto de atividade da
execução e chega ao quadro como uma única entrada genérica; o painel da tela da execução só
aparece com a execução trabalhando; a linha de atividade já carrega o id do agente que
atende e um identificador único por execução de agente; a leitura de recuperação de um
contexto, hoje, escolhe a execução mais recente e por isso não devolveria um chamado
enfileirado. Não verificado: o comportamento real em tela (conversa, tela da execução,
quadro e navegador pareado) e o resultado dos portões, que esta etapa não rodou.
