# Conversa com um agente e a resposta que propõe o que fazer

## O que se pede

Duas coisas que hoje não existem, nas palavras da issue:

> **A direct chat with an agent of the team.** A conversation that belongs to one agent: every message of the person goes to it, with no `@` needed, and it answers there with the conversation as its context. It is listed with the forum's conversations and works from the paired phone too.

> **An agent proposes actions wherever it answers.** From a direct chat, a channel, a general conversation or a run's thread, an answer may carry proposed writes on the code host: comment on an issue, add or remove labels (priority, milestone label), change an issue's status or close it with a comment that says why. Each one is checked like any other proposal and waits in Actions with the exact command.

E o que a issue observa do lado de hoje:

> **Outside a run, an agent proposes nothing.** A mention answer may carry a proposed issue only in a run's thread … In the general conversation, a squad channel or a conversation the person opened, the answer is text and nothing else.

> **There is no direct conversation with an agent.** To talk to the product owner the person writes `@product-owner` in every message of a shared thread, and nothing ties that conversation to the agent.

E o pedido que a pessoa acrescentou ao refino, nas palavras dela:

> O Agente também poderar criar issues que lhe for permitido [, deve ter nas configurações do agente a opão de ajustar as permissões de uso de comandos e tools por agente ale do que já é permitido nas configurações

## O que muda para quem usa

- Existe uma **conversa direta** com um agente do time. Ela se abre pelo agente e é dele: o que a pessoa escreve ali vai para ele sem precisar de `@`, e ele responde ali, com a conversa como contexto. Ela aparece na lista de conversas do fórum, como uma conversa geral, e funciona também no telefone pareado.
- Uma conversa direta é uma conversa; não é rascunho, nem caixa de entrada, nem substituto de uma execução. Como a conversa geral de hoje, ela é interna: nada dela é publicado no rastreador por si.
- A resposta de um agente deixa de ser só texto. Onde ele responde — a conversa direta, um canal, a conversa geral, a conversa de uma execução — a resposta pode trazer **propostas de escrita no rastreador**: comentar uma issue, pôr ou tirar rótulos (a prioridade, e o rótulo que nomeia um marco), mudar o estado de uma issue, fechá-la, e abrir uma issue nova quando a pessoa permitiu isso àquele agente.
- Cada proposta que o agente levanta é uma proposta como as de hoje: ela espera em Ações com o comando que vai rodar à vista. O que a mudança acrescenta é que, no mesmo lugar, as propostas de uma mesma resposta aparecem juntas e podem ser decididas em lote — sim a todas, a algumas ou a nenhuma — com cada escrita decidida por si.
- Toda escrita que roda fica auditada, uma linha por escrita, como hoje. Um espaço de trabalho de teste continua recusando todas.
- A **autonomia** continua sendo uma escolha da pessoa, por agente, e estreita. Por padrão nada roda sem o "sim". Um agente pode ser autorizado a rodar sozinho as escritas de baixo risco — um comentário, um rótulo —, auditadas, como o agente autônomo de uma execução já faz. **Fechar uma issue e mudar o estado dela sempre esperam a pessoa**, qualquer que seja o interruptor.
- **As permissões daquele agente ficam ajustáveis no próprio agente.** O que ele pode ler do rastreador, o que ele pode rodar e **todas as ferramentas** que pode usar deixam de ser só uma escolha do espaço de trabalho e passam a poder ser ditas uma a uma por agente, na configuração do agente, sem afetar os outros. O que vale para todos continua sendo o ponto de partida, e a escolha daquele agente pode ir além dele: um agente pode usar uma ferramenta que o espaço de trabalho desligou.
- **Abrir uma issue é uma proposta como as outras, e depende de permissão.** Um agente a quem a pessoa não deu a leitura do rastreador não propõe issue; um a quem deu propõe, onde ele responde, e a issue espera em Ações.
- O agente continua **somente leitura no código**: nenhuma conversa altera o repositório nem o ramo. Mesmo que aquele agente passe a usar, só para ele, uma ferramenta de escrita em arquivos que o espaço de trabalho desligou, mudar código continua sendo trabalho de uma execução; quando o agente diz que algo precisa de código, o que ele propõe é uma issue.

## Regras

1. **A conversa pertence a um agente.** A conversa direta é de um agente do time; o que a pessoa escreve nela vai para aquele agente, sem `@`. A conversa pertence a um agente de cada vez, e a pessoa pode ter uma conversa direta com cada agente da equipe.
2. **Cada mensagem é respondida, uma após a outra.** Cada mensagem da pessoa na conversa direta é atendida pelo agente dono. As respostas saem na ordem das mensagens, uma por vez, para a conversa ler em ordem.
3. **Ela é listada com as conversas do fórum.** A conversa direta aparece na lista do fórum, como uma conversa, e se abre pelo agente a que pertence; no telefone pareado ela aparece e funciona como as demais conversas.
4. **O contexto é a conversa.** O agente responde com a conversa como contexto, como hoje um agente chamado numa conversa. O que mais ele lê continua sendo o de uma menção fora de uma execução: os repositórios do espaço de trabalho, para leitura.
5. **Ela não guarda memória entre conversas.** Não nasce um arquivo de memória da conversa: o contexto é o que está na conversa, recortado pela mesma janela de mensagens recentes que vale para uma menção — as últimas 40 mensagens.
6. **Ela é interna.** A conversa direta não é publicada no rastreador: o que sai para o rastreador é só o que a pessoa aprovar em Ações, a partir das propostas de uma resposta.
7. **Onde um agente responde, ele pode propor.** Numa resposta — numa conversa direta, num canal, na conversa geral ou na conversa de uma execução — o agente pode levantar uma ou mais propostas de escrita no rastreador. São as operações que o app já usa para escrever: comentar uma issue, pôr ou tirar rótulos, mudar o estado de uma issue e fechar uma issue.
8. **Abrir uma issue é uma proposta, e depende de permissão.** Um agente a quem a pessoa deu a leitura do rastreador pode propor a abertura de uma issue onde ele responde, e ela espera em Ações como qualquer proposta. Um agente a quem a permissão não foi dada não a propõe. Isto vale onde o agente responde, não só na conversa de uma execução, como hoje.
9. **Cada proposta espera em Ações, com o comando à vista.** A forma do comando é validada na proposta, e de novo quando a pessoa aprova. Ela espera em Ações como qualquer proposta do app, com o que vai escrever à mostra, e é decidida por si: um "sim" aplica aquela escrita; recusar ou pular não escreve nada.
10. **A aprovação é individual.** Uma mensagem pode trazer várias propostas ao mesmo tempo; se o "sim" em Ações for dado uma proposta por vez, são escritas separadas, cada uma com o seu registro. Se a pessoa aprovar um lote, cada escrita do lote é registrada por si, e nada é escrito antes do "sim".
11. **A autonomia, por agente, e estreita.** Por padrão, nada roda sem o "sim". Um agente pode ser autorizado a rodar sozinho as escritas de baixo risco — um comentário e uma mudança de rótulo —, cada uma auditada. **Fechar uma issue e mudar o estado dela sempre esperam a pessoa**, mesmo com a autorização ligada. A autorização é por agente e é a que já existe para o agente.
12. **As permissões de um agente são ajustáveis por agente.** O que um agente pode ler do rastreador, o que ele pode rodar (nenhum comando, os comandos permitidos, um ambiente isolado, ou este computador) e **todas as ferramentas que pode usar** são dizíveis na configuração daquele agente, e valem só para ele. O que está definido para o espaço de trabalho continua sendo o ponto de partida de todos; a escolha daquele agente a sobrepõe para aquele agente, e pode ir além dela: **um agente pode usar uma ferramenta que o espaço de trabalho desligou**, dita só naquele agente. Ajustar a permissão de um agente não muda a dos outros, e um agente não ganha, por isso, escrita em arquivos de um ramo.
13. **O agente fica somente leitura no código.** Nenhuma conversa altera o repositório nem o ramo, nem mesmo quando aquele agente passa a usar, só para ele, uma ferramenta de escrita em arquivos que o espaço de trabalho desligou; o trabalho não volta por uma conversa. Quando o que o agente recomenda precisa de código, ele propõe uma issue.
14. **A escrita continua passando por uma porta só.** Toda proposta é julgada contra a forma que o app aceita, passa pelo caminho de sempre (proposta, validação, confirmação, execução auditada), é auditada com uma linha por escrita e é recusada num espaço de trabalho de teste.
15. **O que o host não tem é dito, não inventado.** Um host que não tem uma operação (os rótulos de uma issue não existem no Bitbucket) ou que não tem um conceito igual (o estado de uma issue difere entre os hosts) faz a proposta ser dita como indisponível ali, com o motivo, em vez de tentar uma forma parecida.
16. **O que já funciona não muda.** A conversa de uma execução continua com o comportamento de hoje; a menção com `@` continua chamando um agente onde a pessoa escreve; uma proposta de issue continua esperando em Ações, como hoje.

## Fora do escopo

- **Uma proposta de simples anotação.** O que uma resposta propõe são as escritas que o app já sabe fazer no rastreador; não entra aqui inventar uma escrita nova.
- **O rastreador como fonte das opções de escrita.** Quais rótulos a conversa pode pôr ou tirar e quais nomes de estado o host aceita são decisão de quem monta a proposta, no plano técnico, a partir do que o app e o host já oferecem; a especificação não fixa uma lista nova de opções.
- **Uma permissão nova de escrita em arquivos por conversa.** As permissões ajustáveis por agente não criam um caminho para um agente editar código a partir de uma conversa: mesmo que aquele agente passe a usar, só para ele, uma ferramenta de escrita em arquivos que o espaço de trabalho desligou, o que existe de escrita em arquivos continua sendo o de uma execução, e uma conversa não altera o repositório nem o ramo.
- **Mudar a leitura do host por um agente.** O que um agente pode ler do rastreador continua como hoje, apenas dizível por agente; esta mudança só acrescenta o que ele pode propor.
- **Encerrar o `@` como forma de chamar um agente.** O `@` continua chamando um agente onde a pessoa escreve; a conversa direta é uma forma a mais, não a que substitui as outras.
- **Aprovar uma escrita fora de Ações.** Não nasce um caminho novo de confirmação: a decisão continua na tela de Ações.
- **Apagar ou desfazer uma conversa direta sem uma ação da pessoa:** apagar continua sendo uma decisão dela, pelo caminho de sempre.
- **Um canal de squads entre dois agentes.** A conversa é entre um agente e a pessoa.
- **Memória entre conversas**, um resumo da conversa ou um arquivo que a guarde.
- **Empacotar o Claude Agent SDK** (`npm run dist`), como sempre.

## Critérios de aceite

1. Uma conversa direta com um agente do time existe, é listada junto das conversas do fórum e identificada pelo agente; no telefone pareado, ela aparece e responde como as demais.
2. Numa conversa direta, a mensagem da pessoa vai para o agente dono sem `@`, e ele responde naquela conversa, com a conversa como contexto.
3. Duas mensagens seguidas na conversa direta são respondidas na ordem, uma após a outra.
4. Uma conversa direta não publica nada no rastreador por si: nada do que se fala nela chega à issue sem um "sim" em Ações.
5. O agente responde com a janela de mensagens recentes da conversa (as últimas 40), sem guardar memória de uma conversa para outra.
6. Numa conversa direta, num canal, na conversa geral e na conversa de uma execução, uma resposta de agente pode trazer propostas de escrita no rastreador; cada uma é uma proposta em Ações com a escrita à vista.
7. Aprovar uma proposta de comentário escreve o comentário na issue; aprovar a de rótulos põe e tira os rótulos ditos; aprovar a de fechar fecha a issue; cada uma é executada por si, com o seu registro de auditoria.
8. Recusar (ou pular) uma proposta não escreve nada.
9. Uma proposta cujo host não tem a operação (os rótulos de uma issue no Bitbucket) é dita indisponível ali, com o motivo, e nada é escrito.
10. Com a autonomia de um agente ligada, um comentário e uma mudança de rótulo que ele propôs podem rodar sozinhos, cada um auditado; **fechar uma issue e mudar o estado dela continuam esperando a pessoa**.
11. Num espaço de trabalho de teste, toda proposta dessas aparece e a confirmação é recusada.
12. A conversa de uma execução e a menção com `@` continuam funcionando como antes; uma proposta de issue continua esperando em Ações.
13. O agente de uma conversa não ganha a escrita em arquivos: nenhuma conversa altera o repositório nem o ramo.
14. Um agente com a leitura do rastreador permitida propõe a abertura de uma issue numa conversa direta, num canal ou na conversa geral, e ela espera em Ações; um agente sem essa permissão não a propõe.
15. A configuração de um agente permite dizer, só para ele, o que ele lê do rastreador, o que pode rodar e quais de **todas** as ferramentas usa; mudar isso não muda a permissão dos outros agentes, e a ferramenta que ele passa a usar pode ser uma que o espaço de trabalho desligou.

## Como foi conferido

Nesta etapa o código foi lido; nada foi executado e nada foi visto funcionando no aplicativo. Conferido por leitura, nesta árvore de trabalho:

- **Fora de uma execução o agente não propõe escrita no rastreador.** `proposesIssue` devolve `false` quando o lugar não é a conversa de uma execução (`src/main/mentions/answer.ts:77-81`), e a resposta de uma menção sai interna (`:152`). O publicador que de fato propõe só existe para uma execução (`src/main/runner/service.ts:1052`); o módulo que atende as outras conversas não passa nenhum (`src/main/mentions/module.ts:38-44`), e o próprio módulo diz, no comentário de topo, que "nothing here writes to the code host" (`:12-14`).
- **A única operação proposta hoje é uma issue nova.** `planWrite` é chamado com `createIssue` para a issue pedida entre squads (`src/main/runner/publish.ts:990`) e para a issue de uma resposta de menção (`:1306`); as outras escritas propostas são as do app na execução, como um rótulo de etapa (`:924`) e o fechamento da issue de acompanhamento de uma release (`:1306`).
- **As quatro escritas que a issue pede existem na porta e passam pelo mesmo caminho.** `commentIssue`, `setIssueLabels`, `setIssueStatus` e `closeIssue` estão no tipo das operações (`src/main/vcs/types.ts:191`, `:196`, `:198`, `:220`); cada provedor descreve os comandos (`src/main/vcs/bitbucket.ts:447-488`, `github.ts:516-540`, `gitlab.ts:500-528`), a forma é validada na proposta e de novo na aprovação e a execução fica auditada (`src/main/actions.ts:167-197`, `:274-276`).
- **O que cada host suporta.** Os rótulos de uma issue não existem no Bitbucket: `setIssueLabels` é recusado com `unsupported` (`src/main/vcs/bitbucket.ts:463-464`), e o dado do host diz `issueLabels: false` (`src/shared/vcsCaps.ts:25`). Mudar o estado é diferente do que fechar significa em cada host: o Bitbucket só aceita os seus estados de issue (`bitbucket.ts:465-467`), o GitHub só `open` ou `closed` e nega um estado próprio (`github.ts:538-540`, `issueStatus: false` em `vcsCaps.ts:24`), e o GitLab precisa dos ids numéricos de estado e do id global do item (`gitlab.ts:516-528`).
- **O teto de menções e a resposta interna.** No máximo três agentes por mensagem são atendidos (`src/shared/forum.ts:157-158`), e a conversa entregue ao agente é a janela das últimas 40 mensagens do lugar (`src/main/mentions/call.ts:90`).
- **As conversas que existem hoje são threads.** O tipo da conversa é `run`, `general` ou `channel` (`src/shared/forum.ts:80-81`); o fórum tem a conversa geral, o canal dos squads e um canal por squad (`src/main/forum.ts:44`, `:55`), e as conversas gerais que a pessoa abre nascem com um id a partir do título e o tipo `general` (`src/main/forum-core.ts:278-286`). O arquivo de uma conversa é um JSONL cuja primeira linha é o cabeçalho (`kind`, `runId`, `squad`, `title`), e o formato recusa o que não está na forma (`forum-core.ts:80-94`). Nada numa conversa pertence a um agente.
- **O que o agente recebe por lugar.** O texto de sistema diz o lugar, a missão do squad e os repositórios para leitura (`src/main/mentions/call.ts:59-89`), e o repositório de uma conversa é o do espaço de trabalho (`src/main/mentions/place.ts:31`, `:38`, `:45`). A mensagem do sistema diz ao agente que ele "só lê: não altere nada" (`prompt.sdd.runner.mention.system` nos catálogos, `src/shared/i18n/main.pt-BR.json:851`), e o esquema do que a resposta pode conter só carrega um campo de issue quando o lugar é uma execução (`src/main/mentions/call.ts:94`).
- **A autonomia de hoje pertence à execução.** O `autonomous` de um agente governa o que o runner publica por ele (`src/shared/config/schema.ts:203`, `src/main/runner/publish.ts:930`, `:1011`, `:1308`) e as escritas diretas auditadas (`src/main/actions.ts:461-476`). Nesta árvore, a autonomia não governa nenhuma escrita que nasça de uma resposta de agente fora de uma execução.
- **As permissões de um agente são por agente, mas as ferramentas são do espaço de trabalho.** Cada agente já traz o que lê do rastreador (`tracker`), o que pode rodar (`shell`) e os comandos que a pessoa liberou sempre (`allowedCommands`) (`src/shared/config/types.ts:492-501`, `:524-533`), e a tela do agente oferece esses três campos (`src/renderer/src/screens/team/TeamSection.tsx:172-180`, `:235-259`). Já as ferramentas — arquivos, skills, as ferramentas do rastreador, o uso do CLI do host e subagentes — estão definidas uma vez para o espaço de trabalho, não por agente (`AgentToolsConfig`, `src/shared/config/types.ts:475-485`, campo `tools` em `:593`; valores em `src/shared/config/defaults.ts:54`; uso em `src/main/agents.ts:56-66`). Ou seja: o pedido de ajustar as permissões de uso de comandos e de ferramentas por agente é parcialmente verdadeiro hoje (comandos e leitura já são por agente) e ainda não é verdadeiro para as ferramentas. A decisão da pessoa no refino (todas as ferramentas, e uma ferramenta desligada no espaço de trabalho podendo ser ligada só para um agente) aponta para um ajuste que sobrepõe o do espaço de trabalho, inclusive acrescentando; o como é do plano, e o que a leitura mostrou é que hoje não há campo por agente para as ferramentas.

Não verificado nesta etapa (não lido): se a proposta de escrita ou a conversa direta passa pelo telefone pareado — a política do navegador (`src/main/webPolicy.ts`) e os alvos de notificação (`src/shared/push.ts`). Foi lido apenas que o fórum inteiro (`forum:list`, `forum:read`, `forum:post`, `forum:create`) é aberto ao navegador pareado e que aprovar uma proposta é efeito externo (`src/main/webPolicy.ts:20`, `:22-25`). Também não foi exercitada nenhuma chamada de agente.

## Prioridade e marco propostos

- **Prioridade: P1.** Motivo: é o que dá utilidade ao `@` que já responde em qualquer lugar — hoje o agente opina onde a pessoa escreve e a pessoa refaz à mão, no rastreador, a lista que ele devolveu. Não é perder dado nem furar uma fronteira de segurança (o que seria P0), e é maior do que um ajuste de conforto, porque é o pedido que a issue descreve com um caso real de cinco fechamentos escritos à mão, e a pessoa acrescentou ao refino um pedido de controle (as permissões por agente) que hoje só existe pela metade. A entrega é a issue inteira mais o pedido do refino, numa entrega só, como a pessoa decidiu.
- **Marco: a próxima versão menor (a seguinte à última lançada), em vez de uma correção de versão.** Motivo: é uma funcionalidade nova e visível, que acrescenta um tipo de conversa, um tipo de proposta e um ajuste de permissões por agente; a lista de marcos do repositório não foi lida nesta etapa, então o marco fica como a proposta de "a próxima versão menor da linha atual", a confirmar pela pessoa.

## Perguntas em aberto

1. **O escopo é o da issue inteira, com autonomia e permissões por agente junto?** Resolvido pela pessoa: autonomia por agente e o ajuste das permissões de comandos e ferramentas por agente entram **na mesma entrega**, e o ajuste cobre **todas as ferramentas**, podendo um agente usar uma ferramenta que o espaço de trabalho desligou. Não trava mais o começo do desenvolvimento.
2. **Quais escritas contam como de baixo risco, para a autonomia.** A especificação fixa as que **nunca** rodam sozinhas (fechar e mudar o estado). O que fica aberto é se um comentário e uma mudança de rótulo bastam como a lista fechada das de baixo risco, ou se algo mais entra (por exemplo, tirar um rótulo ou abrir uma issue). A issue só exemplifica ("a comment, a label"). É decisão da pessoa.
3. **O que "fechar" significa em cada host.** A issue manda decidir no refino "whether closing an issue is `setIssueStatus` on every provider or needs an operation of its own". A recomendação é: fechar é a operação de fechar a issue, e ela é oferecida onde existe; o estado próprio da issue é outra coisa e é oferecido onde o host tem um, com os nomes do host. Fechar igual em todo host **não** é possível com o que o app tem, e a decisão de aceitar isso é da pessoa.
4. **A conversa no telefone pareado.** A issue pede que ela "works from the paired phone too"; o que foi lido nesta etapa é que as conversas do fórum e a leitura delas são abertas ao navegador pareado, mas a tela da conversa direta não existiu para ser vista. Não verificado, e é o que a verificação precisa fechar.

Do plano técnico, não da pessoa: se fechar uma issue já fechada, ou mudar o estado para o mesmo estado, é recusado na hora ou vira uma proposta sem efeito; a chave que torna as propostas de uma resposta distintas entre si em Ações; e como as permissões por agente convivem com o que o espaço de trabalho já define, inclusive ao ligar, só para aquele agente, uma ferramenta que o espaço de trabalho desligou.
