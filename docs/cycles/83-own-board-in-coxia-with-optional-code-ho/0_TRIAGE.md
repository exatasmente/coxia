# Quadro próprio no Coxia, com a integração de host opcional

## Tipo

Pedido de funcionalidade. Não relata defeito, não é pergunta e não repete outra issue: pede que uma integração de host de código deixe de ser necessária e que o Coxia ganhe um quadro que funcione sozinho e, com um host ligado, siga em passo com ele. É capacidade nova, não há defeito a reproduzir, e o que restou em aberto na issue é de desenho, não de relato.

## Dá para entender como está escrita

Dá. A leitura desta árvore confirma o que a issue afirma do estado atual: hoje há cartões, mas não há quadro no Coxia — os cartões nascem de uma leitura do host, e nada no app cria, move ou guarda um cartão que não exista no host.

O que a issue diz e confere:

- **Os cartões vêm do host.** A fonte de cartões do dia é o provedor do host quando a pessoa não configurou um comando próprio: sem comando externo, o relatório é montado a partir das issues abertas que o escopo do espaço de trabalho escolhe, mais os pedidos de revisão, o CI e as aprovações (`buildCardReport`, `src/main/vcs/cards.ts`; `providerReport`, `src/main/vcs/cardSource.ts`; `spawnOnce`, `src/main/report.ts`). Os cartões do dia saem desse relatório (`loadCards`, `src/main/cards.ts`).
- **Não existe no app nenhuma escrita de cartão da fonte interna.** Toda escrita que sai da máquina passa por uma porta única de proposta e confirmação (`proposeVcsAction` em `src/main/actions.ts`, com a execução só em `src/main/vcs/runtime.ts`), e o registro de notas do quadro é um comando externo: `externalTools.cardSource.noteArgs` (`writeDailyNote`, `src/main/store.ts`); sem ele, a nota fica só na ata.
- **Sem host, a fonte de cartões não é usada.** A fonte interna devolve nada quando a integração primária não está utilizável (`vcsReady()`, `src/main/vcs/index.ts`; `providerReport` devolve `null`) e o relatório do dia fica vazio, o que as telas mostram como um dia sem atividades, não como erro (`EMPTY`, `src/main/report.ts`).
- **O ciclo pode viver sem host, em parte.** A memória do ciclo é declaradamente sem host de código (`docs/cycles.md`, «Sem host de código»), mas o resto do fluxo de execução depende dele: o gatilho do runner lista issues do host (`triggered`, `src/main/runner/module.ts`) e o job só roda com a integração utilizável (`scanIssues` exige `deps.issues.ready()`, que é `vcsReady()`, `src/main/runner/service.ts`; `source.ready`, `src/main/runner/module.ts`); abrir uma issue para outro squad ou a partir de uma retro passa por uma operação do provedor (`createIssue`, `src/main/mentions/propose.ts`, `src/main/retroIssues.ts`, que recusa sem host de issues ou sem projeto de issues); o texto de fallback para espaço sem integração já existe (`cycle.vcs.fallback`, «the code host», `src/shared/i18n/en.json`).

O que a resposta de quem abriu fecha (o quadro espelhando o host):

- **A fonte da verdade já foi decidida por quem abriu**, e a decisão está na conversa, não na descrição: o comentário de quem abriu diz que o quadro do Coxia é sincronizado com o host, o que só faz sentido com o host como canônico (o comentário nomeia as duas opções e diz «sincronizado com»). É a mesma leitura que os dois critérios de aceite pedem: o cartão aparece dos dois lados sem virar dois registros concorrentes.
- **A leitura do host continua no ritmo do app** (a resposta: «junto com o app»). Hoje isso quer dizer **sob demanda**: o quadro é montado quando alguém pede os cartões — a cerimônia do dia carrega os cartões ao abrir e cai no que está em disco quando a cerimônia do dia já existe (`src/renderer/src/ceremony.ts`: `loadCards()` no `useEffect`; o comentário lá diz «otherwise the cards are built from GitLab»), o botão de atualizar força uma nova leitura (`c.loadCards(true)`, `src/renderer/src/screens/Today.tsx`), e o relatório em memória dura cinco minutos (`REPORT_TTL_MS`, `src/main/report.ts`), com uma leitura em voo sendo aproveitada por quem chega logo depois (`readReport`, `src/main/report.ts`).
- **O quadro já sabe dizer de onde os cartões vêm e quando foram conferidos**, que é o que ele tem hoje para dizer entre uma leitura e outra: o botão de atualizar diz «Atualizar de {vcsName}» e o rodapé diz «Status conferido às {time}» (`ui.today.refresh`, `ui.today.footStatus`, `src/shared/i18n/ui-today.en.json`; usado em `src/renderer/src/screens/Today.tsx`).
- **A comparação de um dia para o outro não depende de relógio.** O que a leitura do host devolve de mudanças (`changes`) sai da comparação com o que os cartões eram quando o dia começou (o «baseline»), guardado em `src/main/vcs/cards.ts` e escrito só quando a fonte interna roda (`writeState`, `src/main/vcs/cardSource.ts`); é isso que o cartão do dia mostra depois de um intervalo ou de uma atualização à mão, não uma diferença entre duas leituras seguidas.

O que a resposta ainda não decide, e que é do refino, não da triagem: com leitura sob demanda, o intervalo que o app já oferece (a conferência de status de fundo, `statusEveryMin`, 30 min por padrão, `src/shared/config/defaults.ts`, `src/main/scheduler.ts`) hoje **não** puxa a fonte interna: ele só roda quando existe um comando externo de cartões (`if (rc().cardSource)`, `src/main/scheduler.ts`), e quando roda também dispara avisos de bloqueio novo e de etapa movida (`checkStatus`, `src/main/scheduler.ts`). Num quadro espelhado, o rótulo de bloqueado — que só existe quando os cartões vêm do provedor (`providerReport` chama `buildCardReport` só com `vcsReady()`; `providerReport` devolve `null` caso contrário) e que exigiria ler o host por outro caminho — é o que decide se a «fotografia do dia anterior» continua a existir. Quem responde isso é o refino; a triagem não decide.

O que a primeira metade da issue ainda prende (o quadro sozinho, sem host):

- **Hoje um cartão sem host não tem dono.** O escopo de uma cerimônia por squad (o único recorte de leitura) supõe um host: os rótulos vêm do rastreador e o vínculo por projeto usa o caminho do projeto no host (`src/shared/squadCards.ts`), e o ref é montado do projeto do host (`src/main/vcs/cards.ts`), que num espaço sem host não existe; os cartões de uma execução de agente de documentação, que não passam pelo provedor, usam o rótulo `docs/<squadId>` (`docsFlowOf`, `src/shared/config/squads.ts`) — é o precedente mais próximo de identificar um cartão local.
- **O histórico de mudanças que os vigias e a retro leem não tem fonte.** Nenhuma fonte alimenta esse histórico fora do comando externo (`rc().cardSource.historyFile`, `src/main/watchers.ts`; `stateFile` também é lido em `src/main/watchers.ts` e `src/main/store.ts`) — ou seja, sem host ou sem comando externo o quadro não teria nem o que o vigia e a retro já consomem desse histórico.
- **A tela de Hoje supõe que algo pode estar atrasado.** O botão de atualizar e o rodapé dizem, por exemplo, «Atualizar de {vcsName}» e «Status conferido às {time}» (`src/shared/i18n/ui-today.en.json`, usado em `src/renderer/src/screens/Today.tsx`).
- **Os textos de bloqueio do cartão existem em duas formas por host.** O bloqueio por CI tem variante «checks» no GitHub e «pipeline» nos demais (`vcs.card.ciFailed.on-github`, `vcs.card.ciRunning.on-github`, `src/shared/i18n/en.json` e `pt-BR.json`), então um cartão que nasce no quadro não tem host de onde tirar o vocabulário.
- **Sem host, a leitura do host pelo agente não tem regra.** Um agente de execução lê o host pelo caminho do espaço de trabalho, nunca pela CLI nem por um servidor MCP, e cai numa política vazia quando a integração está desligada ou inexistente (`readPolicyFor`, `src/main/vcs/readPolicy.ts`; `trackerOf`, `src/main/agents.ts`; a política lê a integração primária, `rc().primaryVcs`, `vcsReadPolicy` no mesmo arquivo).

Verificação: leitura da issue, dos documentos do repositório (`docs/vcs-providers.md`, `docs/cycles.md`, `docs/runner.md`, `docs/configuration.md`) e do código citado acima. Nada foi executado e nenhuma tela foi aberta; o estado atual é o que o código diz, não algo visto funcionando.

## O que falta

Nada falta de quem abriu. As duas decisões que a issue deixava em aberto estão fechadas: a fonte da verdade é o host, com o quadro do Coxia espelhando-o, e a leitura do host continua **junto com o app**, no ritmo que o app já tem — ou seja, o quadro do Coxia é montado quando alguém pede os cartões, como hoje. Não se pergunta a mesma coisa de novo.

O que a resposta deixa para o refino, e não para quem abriu: como o quadro se comporta entre uma leitura e outra (o que ele diz, e o que continua a ser lido no intervalo que o app já tem, que hoje não puxa a fonte interna) e como o quadro funciona sem host (onde um cartão vive, como é identificado e como chega ao recorte por squad).

Sugestão de prioridade, como sugestão e não como decisão (a prioridade é da etapa de refino do produto): `priority:low`, o mesmo nível que o rótulo de hoje. É capacidade nova e grande — um quadro com armazenamento próprio, uma leitura do host que o alimenta, uma comparação de dois lados e telas novas — e nada nela conserta algo quebrado nem destrava outra entrega; o app já funciona sem integração na parte que não depende do host. O que a torna grande é a segunda metade (o passo com o host), não a primeira.

## Issues relacionadas

Nenhuma issue parece duplicar esta. O que se leu descreve o mesmo terreno, sem pedir a mesma coisa:

- A issue do ciclo de agentes e do runner define a execução por issue, o gatilho por rótulo no host e o que vai para o host; o quadro do Coxia teria de alimentar o gatilho e o cartão de uma execução, e é onde a segunda metade desta issue tem de caber. Relacionada, não duplicata.
- A issue das permissões por agente fixa o que um agente lê do host e a porta única de escrita; o quadro novo teria de respeitar as duas. Relacionada, não duplicata.
- A issue da memória do ciclo já trata um arquivo que vive sem host de código; é o precedente de «isto vive no espaço de trabalho e não no tracker», que o quadro local reusa. Relacionada, não duplicata.
- A issue do processo de release e a dos vigias leem do host o que aconteceu (pull request mergeado, histórico de mudanças do comando externo). Sem host, esses vigias ficam sem história; é uma consequência desta issue a tratar no refino. Relacionada, não duplicata.

A busca por issues parecidas foi feita nos documentos de ciclo desta árvore; ela não alcança o tracker além do que a pasta do ciclo trouxe.
