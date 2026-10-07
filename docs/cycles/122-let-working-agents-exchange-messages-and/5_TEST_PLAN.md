# Como se confere que uma etapa conversa, manda mensagem e chama outro agente enquanto trabalha

Este plano diz, cenário a cenário, o que se quer saber de cada comportamento novo e
como exercitá-lo. O que envolve a sessão de um modelo ou o sandbox de verdade é
conferido por teste automatizado com dublês (nenhum modelo real e nenhum sandbox real);
o que envolve uma tela é conferido por uma pessoa com o aplicativo aberto, e fica
marcado como **não exercitado** quando esta etapa não o rodou.

## Como cada coisa é exercitada

- **Motor (a mensagem entra no meio da etapa sem reiniciar):** testes de motor, nos dois
  motores, com um modelo roteirizado. O que querem saber é que uma mensagem entregue
  entre dois passos entra na sessão como mensagem de usuário, que o passo seguinte é uma
  chamada a mais no mesmo diálogo (a etapa não recomeça), que a resposta final é pedida
  ao fim **sem ferramentas** (a fase de coleta), e que uma chamada sem a porta de entrada
  é exatamente a de hoje.
- **A fila da etapa e a entrega:** testes de fluxo que exercitam a caixa de entrada de uma
  etapa que conversa: a mensagem que chega quando a etapa já está concluindo volta como
  mensagem, e as linhas de espera e de entrega na conversa.
- **As duas ferramentas:** testes de fluxo que exercitam a publicação de uma nota com a
  ferramenta de mensagem (a etapa segue) e a abertura de uma conversa com outro agente
  (na conversa da execução ou numa conversa nova do fórum), com a recusa do ciclo de
  chamadas, do teto por etapa e do teto de rodadas.
- **O agente chamado que escreve:** testes de fluxo e da conversa que exercitam um chamado
  com permissão de escrita mudando um arquivo no worktree, com o trabalho commitado com a
  etapa que chamou e sem dois escritores ao mesmo tempo; e um teste de campo desta etapa
  que confere a fronteira do commit (que o commit da conversa agrega também o trabalho
  pendente da etapa que a chamou).
- **A configuração:** teste de deriva que confere os padrões, a ausência do bloco lendo os
  padrões e a faixa recusando 0 e 51.
- **O caminho de hoje que não pode mudar:** o teste do comportamento de menção a agente
  que não trabalha, o teste do sandbox e o teste de ouro (a execução sem as duas
  ferramentas e sem mensagens entregues continua a de hoje) seguem passando sem edição.
- **Portões do repositório:** tipos, a suíte inteira, a auditoria de tema, o lint de
  catálogos, a auditoria pública e a construção do aplicativo.

## Cenários

### 1. A mensagem à etapa chega entre dois passos, nos dois motores, sem recomeçar

- **Como:** com a porta de entrada ligada, um teste de motor entrega uma mensagem entre o
  primeiro e o segundo passo do modelo, nos dois motores, e confere a segunda chamada no
  mesmo diálogo.
- **Aprovado:** a mensagem entra na sessão como mensagem de usuário; o passo seguinte é
  uma chamada a mais no mesmo diálogo (uma sessão, sem reinício); a resposta final sai
  pelo esquema de sempre; a linha de entrega é registrada.
- **Exercitado:** sim, pelo teste de motor, e **aprovado**. Tanto no motor aberto quanto
  no do SDK a mensagem entregue entre dois passos vira uma chamada a mais no mesmo
  diálogo/sessão, e o resultado final continua saindo pelo esquema, sem a etapa recomeçar.
  Uma chamada sem a porta de entrada continua a de hoje (sem passo extra e sem coleta).
- **Critério:** 1.

### 2. Uma mensagem no meio nunca encerra a etapa com um texto solto

- **Como:** um teste de motor entrega uma mensagem e o modelo responde antes com um texto
  em prosa que não é o formato; outro teste entrega quando o passo já respondeu o esquema.
- **Aprovado:** a fase de coleta pede a resposta final **sem** nenhuma ferramenta, e só o
  que sai dela vira o resultado da etapa — tanto quando o texto do meio não segue o
  esquema (o erro volta ao diálogo e o passo seguinte tem uma rodada para corrigir) quanto
  quando a mensagem chega depois de o passo já ter respondido o esquema (ela é entregue
  mesmo assim, antes de qualquer encerramento).
- **Exercitado:** sim, pelo teste de motor, e **aprovado** nos dois casos.
- **Critério:** 1 (o resultado da etapa continua o de sempre).

### 3. Uma mensagem que chega depois de a etapa começar a concluir volta como mensagem

- **Como:** um teste de fluxo entrega uma mensagem quando a etapa já está concluindo.
- **Aprovado:** a etapa fecha com o que já tem; a mensagem não entra na sessão e volta no
  fórum com o motivo; a etapa não recomeça.
- **Exercitado:** sim, pelo fluxo da caixa de entrada, e **aprovado**.
- **Critério:** a seção de receber (a etapa não recomeça).

### 4. Uma nota com a ferramenta de mensagem sai sem encerrar a etapa

- **Como:** um teste de fluxo faz o agente da etapa publicar uma nota com a ferramenta de
  mensagem e conferir que a etapa segue e termina o seu trabalho.
- **Aprovado:** a nota aparece na conversa da execução como mensagem interna do agente; a
  etapa continua e conclui o próprio trabalho; um destinatário fora do time é recusado com
  a lista.
- **Exercitado:** sim, pelo teste das ferramentas, e **aprovado**.
- **Critério:** 2.

### 5. Uma chamada abre conversa na execução ou num fórum novo, ligada à execução

- **Como:** um teste de fluxo faz o agente da etapa chamar outro com a ferramenta de
  chamada, numa conversa nova, e outro teste usa a conversa da execução.
- **Aprovado:** o chamado abre uma conversa própria ligada à execução (a execução e a
  conversa se ligam nos dois sentidos) ou conversa na própria conversa da execução; o
  chamado responde; as respostas entram na sessão de quem chamou como mensagens; o comando
  do chamado aparece na conversa da execução sob o nome dele.
- **Exercitado:** sim, pelo teste das ferramentas, e **aprovado**.
- **Critério:** 1 e 3.

### 6. O teto de rodadas encerra a conversa e diz por quê

- **Como:** um teste da conversa roda com o teto de rodadas baixo e mais mensagens do que
  ele.
- **Aprovado:** ao alcançar o teto, a conversa encerra, o chamado tem uma resposta final
  com o que já leu, a thread diz que o teto foi alcançado, e quem chamou é avisado por
  mensagem.
- **Exercitado:** sim, pelo teste da conversa, e **aprovado**.
- **Critério:** 5.

### 7. Um ciclo de chamadas e o teto por etapa são recusados

- **Como:** um teste de unidade e um teste de fluxo conferem a recusa de chamar um agente
  que já está na cadeia (o ciclo) e de abrir mais conversas do que o teto por tentativa.
- **Aprovado:** a chamada que fecha um ciclo ou que estoura o teto da tentativa é recusada
  com o motivo, e as demais abrem.
- **Exercitado:** sim, e **aprovado**.
- **Critério:** 3 (limite) e 5.

### 8. O chamado que escreve muda um arquivo no worktree, um escritor por vez

- **Como:** um teste da conversa faz um chamado com permissão de escrita mudar um arquivo
  e um teste de fluxo faz o mesmo junto de um comando rodado na sessão dele.
- **Aprovado:** o chamado com permissão de escrita ganha a confinação ao worktree da
  execução e pode mudar arquivo; o trabalho dele aparece no worktree; e a etapa espera a
  conversa que escreve antes de voltar a trabalhar, então nunca há dois escritores no
  mesmo worktree ao mesmo tempo.
- **Exercitado:** sim, e **aprovado**. O teste de fluxo confere o arquivo mudado e o
  comando do chamado na conversa sob o nome dele; por leitura do código, a conversa com um
  escritor é aguardada (não roda ao lado da etapa), o que impede dois escritores.
- **Critério:** 3 e 4.

### 9. O trabalho do chamado é commitado com a etapa que chamou

- **Como:** um teste da conversa confessou o commit no fecho, e um teste de fluxo roda o
  caminho inteiro com um chamado que escreve.
- **Aprovado:** no fecho da conversa, o que o chamado mudou é commitado com a identidade
  da etapa que chamou, antes de a própria etapa commit; uma conversa que não mudou nada não
  commita; o resultado da branch engloba o trabalho do chamado.
- **Exercitado:** sim, e **aprovado**.
- **Critério:** 3.

### 10. O uso do modelo de uma conversa conta na etapa de quem chamou

- **Como:** um teste da conversa anota as chamadas de modelo e confere que todas reportam
  no mesmo acumulador que a etapa que chamou lê.
- **Aprovado:** toda chamada de modelo da conversa soma no uso da etapa de quem chamou
  (pela mesma função acumuladora), por construção e por teste.
- **Exercitado:** sim, pelo teste da conversa, e **aprovado**. A tela do uso não foi
  aberta.
- **Critério:** o limite de uso da issue (mostrado no uso da etapa).

### 11. Uma conversa sem mudança não commita

- **Como:** um teste da conversa roda um chamado que só responde, sem mudar arquivo.
- **Aprovado:** nenhum commit é feito pela conversa.
- **Exercitado:** sim, pelo teste da conversa, e **aprovado**.
- **Critério:** 3 (o que é commitado e com que etapa).

### 12. Um arquivo sem o bloco de conversas lê os padrões, e a faixa recusa extremos

- **Como:** o teste de deriva da configuração guarda um arquivo sem o bloco
  `runner.conversations`, e valores fora da faixa.
- **Aprovado:** o arquivo sem o bloco abre com os padrões (6 rodadas por conversa, 3
  conversas por etapa); 0 e 51 são recusados; um campo extra é recusado. Não há passo de
  migração: um arquivo sem o bloco já lê os padrões.
- **Exercitado:** sim, pelo teste de deriva, e **aprovado**.
- **Critério:** o item da configuração da feature.

### 13. O caminho de hoje de uma menção a quem não trabalha não muda

- **Como:** o teste do comportamento atual de menção segue passando sem edição, e um teste
  de fluxo confirma que uma menção a um agente que trabalha entra na fila da etapa em vez
  de abrir a chamada paralela.
- **Aprovado:** uma menção a um agente que não trabalha continua somente leitura, sobre
  cópia descartável; uma menção ao agente da etapa que trabalha entra na fila da etapa (a
  tela diz que espera o próximo passo); uma menção repetida a um agente que trabalha não
  perde a segunda chamada.
- **Exercitado:** em parte. O comportamento de menção a quem não trabalha está coberto
  pelo teste de menções e **aprovado**; o roteamento de uma menção ao agente da etapa para
  a fila foi lido no código (a mensagem entra na caixa de entrada em vez de abrir a chamada
  paralela), e a linha de espera lida no código, mas **não** há um teste de fluxo que
  exercite de ponta a ponta o `@` a um agente trabalhando e confira as linhas
  `runner.message.waiting`/`delivered`. Ver "O que não é exercitado".
- **Critério:** 1 e a restrição de não mexer no caminho paralelo.

## A fronteira do commit da conversa (achado desta etapa)

Um teste de campo desta etapa roda o caminho inteiro em que a etapa que chama **já mudou
um arquivo** antes de chamar o outro agente, e o chamado muda outro arquivo. O primeiro
commit da branch que toca código (fora dos documentos) carrega **tanto** o arquivo do
chamado quanto o arquivo que a etapa já havia mudado: o commit da conversa usa o mesmo
caminho do repositório, que agrega tudo o que o worktree tem de diferente, sem escopo ao
que a conversa mudou. O resultado líquido da branch está correto, mas a contabilidade "o
que é de quem" fica misturada — a mudança que a etapa fez antes da chamada sai sob a
mensagem de commit da conversa, e o commit da própria etapa depois só pega o que mudou
depois dela. É observação de qualidade, não de correção: nenhum critério de aceite deixa
de passar. **Exercitado** por um teste desta etapa, e **confirmado**.

## O que não é exercitado por estes cenários

- **O modelo real aceitando uma mensagem numa sessão já em andamento e a saída
  estruturada sobrevivendo a isso, nos dois motores:** não há teste que alcance um modelo
  real; o mecanismo foi exercitado com dublês. É a conferência que a fase de implementação
  deixou marcada como não verificada, e esta etapa confirma que segue **não verificada**.
- **O sandbox real (bubblewrap) para uma conversa com comandos sobre o worktree:** os
  comandos do chamado rodaram num sandbox de mentira nos testes; o sandbox de verdade não
  foi exercitado para a conversa.
- **A corrida dos escritores com o aplicativo em execução:** o "um escritor por vez" está
  provado por leitura (a etapa espera a conversa que escreve) e por teste, mas não foi
  visto com o aplicativo aberto e a sessão de sandbox de verdade.
- **A tela do uso** (a soma do uso da conversa na etapa está provada por teste e por
  construção, mas a tela não foi aberta) **e a tela da revisão** (a revisão continua lendo
  a mudança da branch pelo caminho de hoje; o diff que separa "o que a etapa fez" do resto
  não foi implementado).
- **De ponta a ponta, em uma execução: a pessoa escreve `@` ao agente que está
  trabalhando e a mensagem é entregue no meio da etapa, com as linhas de espera e de
  entrega na conversa.** O mecanismo entre dois passos está coberto pelos testes de motor,
  e o roteamento foi lido no código, mas não existe um teste de fluxo completo que traga a
  mensagem de uma pessoa até a sessão de um agente que trabalha e confira as linhas na
  conversa; a conferência em tela (abrir o aplicativo, escrever `@`, ver a mensagem
  chegando) não foi feita.
