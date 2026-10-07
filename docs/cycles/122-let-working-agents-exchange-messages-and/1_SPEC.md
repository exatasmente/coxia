# Trocar mensagens durante a execução de uma etapa

## O que se pede

Uma etapa que está sendo trabalhada por um agente deixa de ser um bloco fechado. Hoje o time só troca informação por três caminhos: a pergunta que para a etapa, a menção que responde numa cópia descartável do código, ou esperar o fim da etapa. O pedido é que o agente que trabalha possa **receber** mensagem enquanto trabalha, **mandar** mensagem sem terminar o trabalho e **chamar outro agente** para discutir um ponto.

Nas palavras da issue:

> An agent that is working a stage can **receive messages while it works** and **send messages without stopping**, and it can **call another agent** and discuss a point with it, in the run's conversation or in a conversation of their own in the forum, so the team exchanges information during a run instead of only through the end of a stage.

### Receber enquanto trabalha

> A message written to the working agent (an `@` to it in the run's conversation, from the person or from another agent) is delivered to it **during** its stage: at the next point between two steps of the model, as a message in its session, on both engines. The stage does not restart.

Regras:

- A mensagem escrita para o agente que trabalha chega a ele **durante** a etapa, no próximo ponto entre dois passos do modelo, como uma mensagem na sessão dele, nos dois motores. A etapa **não recomeça**.
- A tela da execução mostra que a mensagem foi entregue (e quando), ou que ela espera o próximo passo.
- Uma mensagem a um agente que **não** está trabalhando mantém o comportamento de hoje: a menção continua chamando aquele agente.

### Mandar enquanto trabalha

> A tool, **`SendMessage`**, lets the working agent post to the run's conversation (to the person, to an agent, or to everyone), without ending its stage: a progress note, a finding, a question that does not need to block.

Regras:

- A ferramenta `SendMessage` deixa o agente publicar na conversa da execução (para a pessoa, para um agente ou para todos) **sem terminar a etapa**: uma nota de andamento, uma descoberta, uma pergunta que não precisa bloquear.
- Uma pergunta que bloqueia continua pelo caminho de hoje (a etapa pausa). Um `SendMessage` com pergunta para a pessoa **não** pausa, e o agente é avisado de que a resposta pode chegar como mensagem.
- O que for enviado por esse caminho é interno à execução, a menos que a saída da etapa o publique; nada disso vai ao host de código por si.

### Chamar outro agente

> A tool, **`CallAgent`**, lets the working agent start a conversation with another agent of the team, about a point, in the run's conversation or in a new conversation of the forum linked to the run (the caller chooses; the run's screen links both ways).

Regras:

- A ferramenta `CallAgent` deixa o agente que trabalha iniciar uma conversa com outro agente do time, sobre um ponto, na conversa da execução **ou** numa conversa nova do fórum ligada à execução — quem chama escolhe, e a tela da execução liga as duas nos dois sentidos.
- O agente chamado responde naquela conversa; os dois podem ir e voltar, dentro de um limite de rodadas por conversa (configuração do workspace), e qualquer um dos dois pode encerrar.
- O agente que chamou recebe cada resposta como uma mensagem (a seção de receber).
- **O que o agente chamado pode fazer depende da conversa**: ele começa lendo; quando o ponto exige (reproduzir algo, mudar um arquivo), ele pode usar **as próprias permissões no time** (comandos conforme o `shell`, escritas conforme a `permission`), nunca mais que isso. O pedido diz o que o desenho precisa dizer:
  - como dois agentes nunca escrevem no mesmo worktree ao mesmo tempo (um escritor por vez, e o que o outro vê);
  - onde rodam os comandos de um agente chamado (a sandbox da execução, uma cópia descartável) e que eles aparecem na lista de comandos da execução **sob** aquele agente;
  - o que disso é commitado, e com que etapa.
- Uma chamada segue a autonomia da execução: comandos no computador, escritas externas e push esperam a pessoa exatamente como esperariam numa etapa.
- A pessoa vê ao vivo cada mensagem dessas conversas e pode escrever nelas; o `@` da pessoa continua funcionando.

### Limites

> Rounds per conversation, conversations per stage and the model use of a call count against the caller's stage (shown in its usage), and the stage clocks keep running.

- Rodadas por conversa, conversas por etapa e o uso do modelo de uma chamada contam na etapa de **quem chamou** (aparecem no uso dela), e os relógios da etapa continuam andando.
- Um ciclo de agentes que se chamam é recusado (uma cadeia de chamadas que volta a um agente que já está nela).

## O que muda para quem usa

Hoje, quando o desenvolvedor está trabalhando uma etapa, uma mensagem escrita para ele na conversa da execução só chega se for a resposta de uma pergunta que **parou** a etapa; fora disso, o agente chamado responde numa execução separada, que nunca escreve no trabalho em andamento e olha uma cópia descartável do código. Com esta mudança:

- Escrever para o agente que está trabalhando o alcança **durante** o trabalho, entre dois passos dele, sem a etapa recomeçar, e a tela mostra que a mensagem chegou (ou que está esperando o próximo passo).
- O agente que trabalha consegue avisar o que encontrou ou perguntar algo que não bloqueia sem encerrar a etapa; a conversa da execução recebe esse aviso na hora.
- O agente que trabalha consegue abrir uma conversa com outro agente do time, na conversa da execução ou numa conversa própria ligada a ela, e os dois discutem; a tela liga a execução e essa conversa nos dois sentidos.
- O agente chamado pode fazer, naquela conversa, o que as permissões dele no time permitem, não mais; o que ele rodar aparece na execução sob o nome dele; e nunca há dois agentes escrevendo no mesmo worktree ao mesmo tempo.
- O que exige a decisão da pessoa (comando no computador, escrita externa, push) continua esperando a pessoa, como numa etapa.
- Uma conversa que passa do limite de rodadas ou um ciclo de chamadas param, e a própria conversa diz por quê.
- O fórum continua sendo o lugar onde a pessoa lê e escreve, e o `@` dela continua chamando quem não está trabalhando, como hoje.

## Fora do escopo

- Agentes de execuções diferentes conversando entre si: pedidos entre squads mantêm o caminho próprio deles.
- O desenho da solução: como a mensagem entra numa sessão de modelo, como as ferramentas são oferecidas, os nomes internos — pertencem ao refino técnico e ao planejamento, não a esta especificação.
- A pergunta que bloqueia continua exatamente como é hoje: ela para a etapa e a etapa seguinte recomeça com a pergunta e a resposta no prompt.

## Critérios de aceite

Nas palavras da própria issue:

> - While the developer works a stage, the person writes `@developer use the existing helper`; the developer receives it before its next step, without the stage restarting, and its work shows it.
> - The developer sends a progress note with `SendMessage`; the stage goes on.
> - The developer calls QA with `CallAgent` in a new forum conversation to ask how to reproduce a scenario; QA runs a command in its sandbox to check, answers, and the developer continues with the answer; the conversation is linked from the run, and QA's command is in the run's list of commands under QA.
> - When the called agent needs to change a file and has `permission: worktree`, it does, without two writers at the same time.
> - A loop of calls and a conversation over the round limit are stopped, and the conversation says why.

Conferências que uma pessoa consegue fazer:

1. Com a etapa de desenvolvimento em andamento, a pessoa escreve `@developer use the existing helper` na conversa da execução; o desenvolvedor recebe a mensagem antes do passo seguinte dele, sem a etapa recomeçar, e o trabalho dele mostra isso.
2. O desenvolvedor manda uma nota de andamento com `SendMessage` e a etapa continua.
3. O desenvolvedor chama o QA com `CallAgent` numa conversa nova do fórum para perguntar como reproduzir um cenário; o QA roda um comando na sandbox dele para conferir, responde, e o desenvolvedor segue com a resposta; a conversa aparece ligada à execução, e o comando do QA aparece na lista de comandos da execução **sob o QA**.
4. Quando o agente chamado precisa mudar um arquivo e tem `permission: worktree`, ele muda, sem dois escritores ao mesmo tempo no mesmo worktree.
5. Um ciclo de chamadas e uma conversa acima do limite de rodadas são interrompidos, e a conversa diz por quê.

## O que ficou em aberto

Sobreviveram decisões de refino, não de quem abriu a issue:

- Quantas rodadas por conversa e quantas conversas por etapa um workspace ganha **por padrão** (o teto de rodadas por conversa já vem de configuração do workspace; o padrão e o teto de conversas por etapa precisam ser escolhidos).
- O que uma etapa faz com uma mensagem que chega quando ela está prestes a terminar (perto do último passo, ou já produzindo a resposta final).
- Não verificado no refino: a forma exata como cada motor (o Claude Agent SDK e o motor aberto) aceita uma mensagem no meio de uma sessão já em andamento. Foi conferido por leitura que hoje uma sessão de etapa nasce, roda e morre dentro de uma chamada; o encaixe da mensagem entre dois passos é o ponto que o desenho precisa resolver, e não foi exercitado.

## Como foi conferido

Por leitura, nesta etapa: a issue e a triagem já registradas, o documento do runner e o documento dos ciclos, a configuração do workspace (a seção do runner e o time de agentes) e o código que hoje trata menções, perguntas, etapas e as ferramentas de um agente. Confirmado por leitura que:

- Hoje uma pergunta do agente pausa a etapa e a etapa seguinte recebe a pergunta e a resposta; uma mensagem que cita um agente continua chamando aquele agente, que responde somente leitura, sobre uma cópia descartável do código quando ele roda comandos; e só a mensagem de uma pessoa chama um agente.
- Não existe hoje nenhuma ferramenta pela qual um agente mande mensagem ou chame outro durante a etapa: as ferramentas que o modelo recebe são as de leitura, as de escrita confinada ao worktree, o shell e as do app.
- Os limites que a issue cita existem e vêm de configuração do workspace (o limite de rodadas/ passo de uma chamada, o teto de chamadas por mensagem, o uso do modelo contando no papel que o gastou), e o roteamento de uma chamada segue a autonomia do agente e da execução.

Nada foi executado e nenhum comportamento novo foi visto funcionando: tudo o que está nesta especificação sobre o estado atual foi lido; o que a mudança passa a fazer é o que a issue pede, e o encaixe entre dois passos do modelo nos dois motores ficou registrado como não verificado.
