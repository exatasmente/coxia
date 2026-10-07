# Uma execução do ciclo de ponta a ponta sozinha, com a sandbox na rede e a lista dos comandos de cada agente

O pedido tem três partes: uma execução pode ir da primeira etapa ao fim **sozinha**, com os agentes dela rodando comandos, e a pessoa sempre vê **quais comandos cada agente rodou**, enquanto a execução anda e depois que ela termina. Para isso, a sandbox ganha uma terceira escolha de rede, e o que hoje sempre espera a pessoa (o comando no computador, o gate, o push e o pull request) passa a poder andar sem ela, por escolha explícita de quem usa o app.

Este documento é a especificação funcional: o comportamento e as regras. O plano cuida do desenho da solução.

## 1. O que muda para quem usa

Hoje, uma execução para na pessoa em três lugares mesmo com todo agente marcado como autônomo: **cada comando de um agente que roda no computador espera "Permitir"**, **cada gate espera uma decisão** e **o push e a abertura do pull request esperam sempre um "sim"**. A sandbox não alcança a rede além do registro de pacotes, e os comandos que os agentes rodaram só aparecem soltos, um a um, na conversa da execução.

Depois desta mudança:

- Quem quiser liga, num bloco de autonomia, que a execução ande sozinha: as etapas começam e entregam o resultado sem esperar, os comandos no computador rodam sem a pergunta, os gates passam sozinhos (aprovados pelo app, com o motivo registrado), o push sai sozinho e o pull request abre sozinho — cada uma dessas quatro coisas ligada ou desligada em separado.
- O bloco existe em dois lugares: um do espaço de trabalho e um de cada fluxo (o principal e o de cada squad). Cada fluxo tem, ligado por padrão, um interruptor **"Usar a configuração do espaço de trabalho"**; enquanto ele está ligado, o bloco do espaço de trabalho decide e os campos do fluxo ficam desligados e com uma dica dizendo isso; desligado, o bloco do fluxo decide e o do espaço de trabalho não tem efeito naquele fluxo.
- Só o computador liga qualquer um desses campos (e a rede aberta); um navegador pareado só desliga. Um espaço de trabalho marcado como teste continua recusando toda escrita externa, diga o bloco o que disser.
- A sandbox ganha a terceira escolha de rede, **aberta**: compartilha a rede do computador, sem proxy e sem lista de endereços, e o texto que a etapa entrega ao agente diz que ele tem rede. Continua valendo só no desktop, e continua desligada por padrão.
- A tela da execução ganha a seção **Comandos**, por agente e por etapa: cada comando com o número, onde rodou (sandbox ou este computador), como terminou (código de saída, estouro do tempo, recusado, não permitido) e quanto durou, atualizando ao vivo. Quando a execução termina (concluída, cancelada ou falhou), o app posta **uma** mensagem na conversa da execução com a mesma lista, por agente.
- A lista nunca vai ao host de código, nem é escrita nenhuma a mais por causa dela.

Quem não liga nada fica como está hoje: os campos nascem desligados e o espaço de trabalho existente continua com a rede que tinha.

## 2. O pedido, nas palavras da issue

> A run of an agent cycle can go from the first stage to the end **on its own**, with its agents allowed to run commands, and the person can always see **which commands each agent ran**, while the run works and once it ends.

> - **Workspace** (Settings › Runner): one autonomy block.
> - **Flow**: the main flow (`devCycle.stages`) and each squad's own flow (`devCycle.flows[squad]`) has its own block, with a switch **"Use the workspace's setting"**, on by default.
>   - While it is on, the workspace's block decides for that flow, and the flow's fields are shown disabled, with a tooltip that says the workspace decides.
>   - While it is off, the flow's block decides, and the workspace's block has no effect on runs of that flow.
> - **What a block holds**, every field off by default:
>   - **Autonomous cycle**: every stage of the run starts by itself and hands its result on without waiting, whatever each agent's own `autonomous` is; comments go out the way an autonomous agent's do.
>   - Under it, four separate choices, each only meaningful while "Autonomous cycle" is on:
>     - **Host commands without asking**: the commands of an agent with `shell: host` run without the "Allow" question.
>     - **Gates pass by themselves**: a gate of the flow is approved by the app, recorded as an automatic approval with the reason.
>     - **Push without a "yes"**: the run's push goes through the door of Actions by itself, audited.
>     - **Pull request without a "yes"**: the pull request is opened by itself, audited.
> - Only the computer may turn any of these on; a paired browser may only turn them off. A workspace marked as test keeps refusing every external write, whatever the block says.
> - A change takes effect at the next decision (the next stage start, command, gate, push or pull request), never in the middle of one.
> - The run's screen says, in its header, that the run is autonomous and which of the four choices are on, and where they come from (workspace or flow).

> `runner.sandbox.network` gets a third value, **`open`**: the sandbox shares the computer's network, with no proxy and no host list. Desktop only, off by default (existing workspaces keep what they have). Name resolution must work inside (the system's resolver configuration is often a link outside `/etc`). The stage prompt tells the agent that it has the network.

> - On the run's screen, a **Commands** section: by agent, then by stage, every command with its number, where it ran (sandbox or this computer), its result (exit code, timeout, refused, not allowed) and how long it took. It updates live while the run works.
> - When the run ends (done, cancelled or failed), the app posts one message in the run's conversation with the same list, by agent.
> - The list is built from what the run already records; it is never posted to the code host.

> - Answering a question that reached the person, a plugin's request, a provider out of budget and `wait` stages: they keep waiting for their event.
> - Any per-run override at start time.

## 3. Regras

### 3.1 Os dois blocos e a precedência

1. **Um bloco é um conjunto de cinco campos.** **Ciclo autônomo** (a chave geral) e, sob ele, **Comandos no computador sem perguntar**, **Gates passam sozinhos**, **Push sem "sim"** e **Pull request sem "sim"**. Os cinco nascem **desligados**; os quatro de baixo só têm efeito enquanto **Ciclo autônomo** está ligado (com ele desligado eles podem ficar marcados, e não mudam nada).
2. **O bloco do espaço de trabalho** fica em Configurações › Runner, ao lado do que já existe do runner.
3. **O bloco do fluxo** fica em Configurações › Time e ciclo, na edição de cada fluxo: um para o fluxo principal e um para o fluxo próprio de cada squad. O bloco do fluxo começa com o interruptor **"Usar a configuração do espaço de trabalho"** ligado; enquanto ele está ligado, os campos do bloco do fluxo ficam desligados (na tela) e uma dica diz que o espaço de trabalho decide. Desligado, o bloco do fluxo decide e o do espaço de trabalho não tem efeito nas execuções daquele fluxo.
4. **A execução guarda a decisão quando começa.** Uma execução criada com o fluxo principal ou com o fluxo de um squad usa o bloco daquele fluxo; uma execução de release usa o bloco do fluxo de release. Trocar qualquer campo vale a partir da **próxima decisão** (o próximo início de etapa, comando, gate, push ou pull request), nunca no meio de uma; em particular, uma etapa que já começou termina com a decisão que valia quando ela começou.
5. **O que "Ciclo autônomo" ligado muda:** toda etapa da execução começa quando a execução chega nela e o resultado segue adiante sem esperar, **qualquer que seja a chave `autonomous` de cada agente**, e os comentários e a revisão saem ao host como saem os de um agente autônomo (pela porta, auditados). A chave `autonomous` de cada agente e a do squad continuam existindo e valendo para quem **não** usa o ciclo autônomo.
6. **As quatro escolhas, uma a uma.**
   - **Comandos no computador sem perguntar:** um comando de um agente com `shell: host` roda sem a pergunta "Permitir"/"Não permitir". A conversa registra que o comando rodou neste computador e que rodou sob a autonomia do ciclo; nada muda nos comandos da sandbox (que já não perguntam nada).
   - **Gates passam sozinhos:** ao chegar num gate, o app o aprova sozinho e a execução segue. O gate fica registrado como **aprovação automática**, com o motivo em palavras simples dizendo que a autonomia do ciclo o aprovou (e de onde ela veio: espaço de trabalho ou fluxo), no histórico da execução e na conversa; o comentário do gate no host sai pela autonomia da execução (a mesma regra de 5).
   - **Push sem "sim":** no fim da etapa que muda o código, o push da branch sai pela porta de Ações sem esperar um "sim", **auditado** (uma linha por chamada, como as outras escritas autônomas).
   - **Pull request sem "sim":** quando o push foi feito, o pull request é aberto sem esperar um "sim", **auditado**. Com o push ligado e o pull request desligado, o "sim" do push continua sendo pedido, e o pull request espera o próximo.
7. **Com um campo desligado, aquele passo espera como hoje:** o comando `host` pergunta; o gate espera a decisão; o push e o pull request viram propostas em Ações.
8. **O que "Ciclo autônomo" desligado não muda:** a chave `autonomous` de cada agente continua valendo como sempre (etapa que espera para iniciar, comentário que espera, resultado que espera aceitar), e o bloco não decide nada.
9. **Só o computador eleva.** Nenhum campo do bloco, em nenhum dos dois lugares, pode ser **ligado** de um navegador pareado; ele pode ser **desligado** de lá. A configuração que o navegador grava já recusa caminhos fora de uma lista; o bloco do espaço de trabalho fica fora dessa lista, e o do fluxo, se estiver nela, aceita só a descida.
10. **Espaço de trabalho de teste:** recusa o push e o pull request mesmo com os dois campos ligados (a confirmação é recusada, como hoje), e o gate aprovado sozinho e os comandos `host` sem pergunta continuam valendo — são coisas locais. A recusa é a mesma de sempre, dita na conversa.
11. **O cabeçalho da execução** diz, na tela da execução, que a execução é autônoma, quais das quatro escolhas estão ligadas e **de onde vem a decisão** (o espaço de trabalho ou o fluxo, e qual fluxo).

### 3.2 Rede aberta na sandbox

12. **Um terceiro valor.** A rede da sandbox passa a ser `off` (padrão), `registry` (só o registro, pelo proxy do app) ou **`open`**: a sandbox **compartilha a rede do computador**, sem proxy e sem lista de endereços.
13. **Só no desktop.** Como hoje, só uma máquina Linux com a sandbox funcionando oferece `off` e `registry`; `open` também é só aí. Onde não há sandbox, nada muda.
14. **Desligada por padrão, e o espaço de trabalho existente fica como estava:** a migração da configuração não liga a rede em ninguém.
15. **Resolver nomes dentro.** Com `open`, resolver um nome de rede funciona dentro da sandbox; a montagem precisa incluir o que o sistema usa para resolver (a configuração do resolvedor costuma ser um link para fora de `/etc`), sem abrir o resto do sistema: nada da pasta pessoal, dos sockets do agente ou do contêiner, nem das outras pastas que a sandbox não monta hoje.
16. **O texto da etapa diz ao agente que ele tem rede.** Com `open`, o que a etapa entrega ao agente diz que ele alcança a rede; com `off` e `registry` continua dizendo o que já diz. O mesmo vale para as chamadas de um agente com comandos fora de uma etapa (uma menção).
17. **O que a escolha significa.** `open` é a rede do computador inteira: os serviços da própria máquina, a rede local e a internet, sem filtro. A documentação do runner passa a dizer isso, e a tela repete o aviso; o padrão continua fechado.

### 3.3 A lista dos comandos que cada agente rodou

18. **A seção "Comandos", na tela da execução**, agrupa por **agente** e, dentro dele, por **etapa**, e lista cada comando com: o número, o comando, **onde rodou** (sandbox ou este computador), **como terminou** (o código de saída; estourado o tempo; recusado — comando vazio, longo demais, orçamento da etapa esgotado, sandbox encerrada ou não permitido; ou não terminou com código) e **quanto durou**.
19. **Ela anda ao vivo** enquanto a execução trabalha, e continua disponível depois que a execução termina.
20. **Ela é feita do que a execução já registra.** O que entra na lista é o que já foi registrado quando cada comando rodou (a conversa e o histórico da execução); nada novo é gravado no host de código por causa dela. Quando a execução termina — **concluída, cancelada ou falhou** —, o app posta **uma mensagem** na conversa da execução com a mesma lista, por agente.
21. **Comandos que não rodaram** (recusados, não permitidos, barrados) aparecem na lista com o resultado que tiveram, e não com um código de saída.

### 3.4 Onde a regra de hoje muda

22. A regra "o push e o pull request esperam sempre um 'sim'" deixa de ser absoluta: passa a valer **enquanto a escolha correspondente não estiver ligada** no bloco que decide a execução, com as exceções de 3.5. Os três lugares onde a regra está escrita passam a dizer isso: o resumo do runner, a seção "O que fica no host de código" (o parágrafo do push e do pull request) e a lista de canais do navegador pareado; e o contrato do campo `autonomous` de um agente deixa de dizer que o push e o pull request esperam de qualquer jeito, para dizer que quem decide isso é o bloco de autonomia.
23. O contrato de `shell: host` ("cada comando espera você permitir") passa a ter a exceção da escolha "Comandos no computador sem perguntar"; e o comando `host` **de uma menção pelo celular** continua exigindo a chave de efeitos externos, que o novo bloco não contorna.
24. A seção "Não verificado" do runner passa a dizer que a rede `open` nasce **não exercitada**, como o modo do registro hoje.
25. **A migração da configuração** acrescenta o bloco do espaço de trabalho, com os cinco campos desligados, e não mexe na rede de quem já existia; ela **nunca eleva** nada. O histórico do esquema na documentação da configuração ganha o passo novo.

### 3.5 Uma execução de release

26. **As escolhas de push e de pull request não alcançam uma execução de release.** Os passos de uma release (`beta`, `stable`, `push-branch`, `push-tag`) **continuam sempre esperando o "sim" da pessoa**, mesmo com o ciclo autônomo ligado; o motivo é o mesmo de hoje: um corte roda o script do próprio repositório e o código dos pull requests integrados, sem sandbox, como a pessoa. Os outros quatro campos não tocam os passos de release.
27. **Se o "Ciclo autônomo" alcança o resto de uma execução de release** (as etapas dela seguirem sozinhas, o gate do plano passar sozinho) é decisão da pessoa, registrada em 4; até ela decidir, esta especificação trata a release como está hoje (as etapas seguem a chave de cada agente e o bloco não decide nada nela), e nada muda nela.

## 4. Decisões que são da pessoa

1. **O push e o pull request de uma execução de release** ficam fora das duas escolhas (3.5, item 26) ou o bloco alcança também uma release? A recomendação é **ficar fora**: D18 já decidiu isso para os cortes e os envios, pelo mesmo motivo, e revogá-la é uma decisão de risco.
2. **O que a tela mostra quando um comando `host` roda sem a pergunta.** A recomendação é uma linha na conversa e na lista de comandos dizendo que o comando rodou **neste computador, sob a autonomia do ciclo**, com a escolha que o liberou. A alternativa (não registrar nada além do comando) tira da pessoa a única marca de que um agente teve a máquina nas mãos sem ela.
3. **Para onde vai o bloco do fluxo** (a tela de Time e ciclo é a candidata natural, na edição do fluxo): a escolha de lugar é da pessoa, e o app pode pôr uma cópia em Configurações › Runner.
4. **A rede `open` como padrão de uma instalação nova**: hoje toda instalação nova nasce com a rede `off`; a recomendação é manter `off` até que a pessoa peça, porque `open` é a rede do computador inteira sem filtro nenhum.

## 5. Fora do escopo

- Responder uma pergunta que chegou à pessoa, o pedido de um plugin, um provedor sem orçamento e as etapas de espera: continuam esperando o evento deles.
- Qualquer ajuste por execução na hora de iniciar (um interruptor no momento de começar, um campo que valha só para aquela execução).
- Ligar qualquer campo do bloco pelo celular, ou a rede `open` pelo celular.
- Filtrar, limitar ou listar endereços na rede `open`: ela é a rede do computador.
- Alcançar o push e o pull request de uma **release** pelas duas escolhas (recomendação de 4, item 1).
- Mudar o que um agente pode ler ou escrever (`permission`, `tracker`, `shell`): esta mudança mexe em **quando** um passo espera a pessoa, não no que o agente pode fazer.
- Uma lista de comandos que saia para o host de código, ou um documento da pasta do ciclo com essa lista.

## 6. Critérios de aceite

1. Com **Ciclo autônomo** ligado no espaço de trabalho e o fluxo em "Usar a configuração do espaço de trabalho", uma execução com gates, um agente que escreve e uma QA na sandbox vai do começo ao pull request **sem esperar a pessoa**, exatamente para as escolhas que estão ligadas; com uma escolha desligada, aquele passo espera como hoje.
2. Com o interruptor do fluxo desligado, o bloco **do fluxo** decide e o do espaço de trabalho é ignorado; os campos do bloco do fluxo aparecem desligados enquanto o interruptor está ligado, com a dica de que o espaço de trabalho decide.
3. Um espaço de trabalho de teste recusa o push e o pull request mesmo com as duas escolhas ligadas.
4. Um navegador pareado não consegue **ligar** nenhum campo do bloco nem a rede `open` (e consegue desligar).
5. Um comando numa sandbox com `network: open` **resolve um nome público e o alcança**; com `off` continua sem alcançar; com a rede `open` o texto da etapa diz ao agente que ele tem rede.
6. A tela da execução lista **todos** os comandos da execução por agente e por etapa, ao vivo; o fim da execução (concluída, cancelada ou falhou) posta a mesma lista na conversa.
7. A migração da configuração deixa todo espaço de trabalho existente com **os cinco campos desligados** e a rede **como estava**, e não eleva nada.
8. Um gate aprovado pela autonomia aparece como **aprovação automática**, com o motivo e a origem da decisão, no histórico e na conversa; o cabeçalho da execução diz que ela é autônoma, quais das quatro escolhas estão ligadas e de onde vem a decisão.
9. Desligar um campo vale a partir da **próxima** decisão: um gate que já esperava continua esperando, um comando que já esperava continua esperando, e a escolha só pega no próximo.
10. Uma execução de release continua esperando o "sim" nos quatro passos, com qualquer bloco ligado (recomendação de 4, item 1).

## 7. Como foi conferido

Leitura da issue, da triagem e da conversa da atividade; leitura do runner e da configuração na documentação do repositório; leitura das especificações já aprovadas do processo de release, das permissões dos agentes e da sandbox; e leitura do código citado, para conferir que o comportamento de hoje é o que a issue diz: a rede da sandbox tem dois valores, a sandbox desliga a rede de propósito, o comando `host` espera uma resposta, o push e o pull request sempre esperam, e cada comando já é registrado com agente, número, onde rodou, resultado e duração, sem uma lista por agente.

**Nada foi executado**: nenhum comando foi rodado, nenhum gate ou pergunta foi exercitado no aplicativo e nenhum comportamento novo foi visto funcionando — nem o bloco de autonomia, nem a rede aberta, nem a lista de comandos. O que este documento diz de hoje é o que o código e a documentação dizem, não o que se viu. Os nomes dos campos, das telas e das seções estão nas palavras da issue; o desenho da solução (onde cada coisa mora no código e como ela é feita) é do plano.
