# Como o aviso de que um agente chamado está trabalhando é conferido

O que se quer saber, em cada cenário, é se a pessoa vê que o chamado dela foi
recebido: na conversa, na tela da execução, no quadro de tarefas e no navegador
pareado. Cada cenário diz como exercitá-lo e o que conta como aprovado.

## Como cada coisa é exercitada

- **Unitários sem tela (Vitest, ambiente Node):** a linha carrega a identidade do
  chamado; "na fila" conta como execução viva; o seletor agrupa por chamado, mostra a
  linha mais nova e descarta o grupo terminado; a leitura de recuperação traz um
  chamado enfileirado junto da execução mais recente.
- **Fluxo do chamado no motor:** uma mensagem que nomeia um agente abre o chamado com
  a conversa e a mensagem certas; uma segunda mensagem enquanto a primeira roda abre a
  linha de fila; o fim por resposta e o fim por falha fecham o chamado; cada chamado
  roda sob a atividade da sua própria linha.
- **Portões do repositório:** tipos, a suíte inteira, a auditoria de tema, o lint de
  catálogos, a auditoria pública e a construção do aplicativo.
- **Conferência em tela:** abrir o aplicativo de desenvolvimento com dados de teste
  (`CERIMONIAS_DATA_DIR` numa pasta vazia) não é parte da suíte; é o que uma pessoa faz
  à mão para ver a linha, o painel e a entrada do quadro. Fica registrado em cada
  cenário como **não exercitado** quando não for rodado.

## Cenários

### 1. A linha aparece embaixo da mensagem que chamou

- **Como:** com a execução parada num portão, enviar uma mensagem que nomeia um agente
  com `@`.
- **Aprovado:** logo abaixo da mensagem aparece uma linha dizendo que aquele agente
  está trabalhando, com o nome que a equipe usa para ele.
- **Critério:** 1.

### 2. A linha mostra o passo ao vivo

- **Como:** continuar o cenário anterior e observar a linha enquanto o agente trabalha.
- **Aprovado:** a linha é substituída pelo passo ao vivo (por exemplo, um arquivo sendo
  lido, uma ferramenta em uso), com os mesmos rótulos curtos que o painel e o quadro já
  mostram.
- **Critério:** 2, 10.

### 3. A linha sai quando a resposta chega

- **Como:** deixar o agente responder.
- **Aprovado:** a linha transitória some e a resposta do agente fica na conversa como
  sempre.
- **Critério:** 3.

### 4. A linha sai quando o chamado falha

- **Como:** fazer o chamado falhar (por exemplo, o agente não pode responder) e observar
  a conversa.
- **Aprovado:** a linha some e o aviso de falha da chamada fica na conversa.
- **Critério:** 4.

### 5. Uma linha por agente da mensagem

- **Como:** enviar uma mensagem que nomeia dois agentes.
- **Aprovado:** cada agente ganha a sua própria linha, e cada linha some com a resposta
  ou a falha do seu agente.
- **Critério:** 5.

### 6. O segundo chamado diz que espera a vez

- **Como:** enviar uma segunda mensagem que nomeia um agente enquanto o primeiro chamado
  da mesma execução ainda roda.
- **Aprovado:** a linha do segundo diz que ele espera o chamado anterior; ele só começa
  quando o primeiro termina, e nesse momento a linha passa a dizer que está trabalhando.
- **Critério:** 6.

### 7. O painel da execução aparece com o nome do agente

- **Como:** com a execução parada num portão (ou numa pergunta), chamar um agente e olhar
  a tela da execução.
- **Aprovado:** o painel de atividade ao vivo aparece enquanto o chamado roda, qualquer
  que seja a situação da execução, com o nome do agente chamado à frente; o painel não
  mostra mais do que os rótulos curtos de sempre.
- **Critério:** 7, 10.

### 8. A entrada do quadro nomeia o agente e a execução

- **Como:** com um chamado em andamento, abrir o quadro de tarefas.
- **Aprovado:** a entrada daquele chamado traz o nome do agente e a referência da
  execução (não o "Agente" genérico), e abrir a entrada leva à conversa daquela execução.
  Os trabalhos que não são chamado de conversa continuam na entrada genérica.
- **Critério:** 8.

### 9. O mesmo no navegador pareado

- **Como:** repetir os cenários 1 a 8 no navegador pareado.
- **Aprovado:** a conversa, a tela da execução e o quadro se comportam como no aplicativo
  de computador.
- **Critério:** 9.

### 10. Com a voz desligada

- **Como:** repetir os cenários 1 a 8 com a voz desligada (`.novoice`).
- **Aprovado:** o aviso é visual e funciona igual; nenhuma chave nova depende da voz.
- **Nota:** os rótulos novos não dizem "call" (o conceito de voz), então não pedem a
  variante `.novoice`.

### 11. O chamado continua somente leitura e respeita os limites

- **Como:** acompanhar o chamado e conferir que ele não escreve no repositório, e que
  termina dentro dos limites de silêncio e de tempo já configurados.
- **Aprovado:** nenhuma escrita no repositório; o chamado termina como sempre, sem que os
  limites sejam estendidos ou suspensos.
- **Critério:** 11.

### 12. `@` num canal ou conversa geral continua texto comum

- **Como:** digitar `@` num canal ou numa conversa geral.
- **Aprovado:** nenhum agente é chamado e nada do aviso aparece; o `@` é texto comum,
  como hoje.
- **Critério:** 6 (restrição da especificação).

## O que não é conferido por estes cenários

- A dica no campo de escrita quando o `@` é digitado num canal ou numa conversa geral
  (fora do escopo desta mudança).
- Chamados em paralelo e mais de três agentes por mensagem (fora do escopo).
- Guardar o aviso no histórico e o aviso de fim de chamado fora da tela (fora do escopo).
- O aviso dentro do painel do quadro de tarefas quando o texto do passo cresce: é preciso
  ver em tela.
