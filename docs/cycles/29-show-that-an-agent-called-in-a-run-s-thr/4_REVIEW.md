# A revisão do aviso de que um agente chamado está trabalhando

## O que foi revisado

A revisão leu a mudança inteira — o registro de atividade compartilhado e o do processo
principal, o motor, a chamada por `@`, o seletor de linhas de chamado, a conversa, o painel
de atividade, a tela da execução, o quadro de tarefas, os catálogos e a nota de lançamento
— e comparou o que o código faz com o que a especificação e o plano descrevem.

O desenho confere. O chamado ganha identidade própria (agente, conversa e a mensagem que
chamou) no registro de atividade, que é o que o quadro de tarefas não tinha; um estado novo
("na fila") marca o chamado que ainda espera a vez, e a checagem de execução viva passa a
tratá-lo como vivo. Com essa identidade, as quatro superfícies mostram o aviso sem que
nenhuma delas precise adivinhar de qual chamado é cada linha: a conversa filtra pelo campo
do chamado, e o mesmo seletor alimenta o quadro. Nenhuma linha sem chamado entra num grupo,
então o trabalho próprio da execução não vaza para a conversa nem para o quadro.

**O aviso chega antes de o agente começar.** O chamado é aberto quando a mensagem é aceita,
antes da fila, e a linha de chegada já diz "trabalhando" ou "esperando a vez"; é o que faz
o segundo chamado aparecer dizendo que espera o primeiro em vez de nada. O caminho de falha
fecha o chamado tanto no fim como antes de o motor rodar, de modo que a linha não fica presa
na tela. O teste do ciclo do chamado confere, no próprio armazenamento de atividade, que as
duas linhas existem antes de o motor rodar, com estados "trabalhando" e "esperando", e que
cada chamado depois roda sob a atividade da sua própria linha.

**A leitura de recuperação.** A leitura por contexto passou a trazer também os chamados em
andamento, e não só a execução mais recente daquele contexto; sem isso a linha de um chamado
enfileirado não reapareceria ao abrir a conversa no meio dele. O teste cobre esse caso: um
chamado enfileirado convive na leitura com uma invocação posterior já terminada.

## O que foi rodado

Rodado nesta revisão, no worktree, com os portões do repositório:

- `npx tsc --noEmit` — sem erro.
- `npx vitest run` — 212 arquivos, 3533 testes, todos passando.
- `node scripts/theme-audit.mjs` — 55 pares de contraste em cada tema, o pior 4,58 no claro
  e 8,06 no escuro; nenhuma cor literal nova (o único arquivo com cores literais é
  `src/renderer/src/api.ts`, que já as tinha).
- `npm run i18n:lint` — 3995 chaves nos dois idiomas, nenhuma faltando ou sobrando.
- `node scripts/public-audit.mjs` — 856 arquivos, nada de empresa, pessoa ou host.
- `npx electron-vite build` — passou a construção inteira (a implementação não a havia
  rodado; a CI a roda).

Além disso, a revisão conferiu por leitura: as chaves novas (`activity.queued`,
`activity.call.title`, `activity.call.working`, `activity.call.entry`) existem nos dois
idiomas e em ambos os modos de voz (nenhuma chave `.novoice` foi referenciada sem o
correspondente), e os testes que mais tocam a mudança (`activity-store`,
`agent-activity-core`, `runner-lifecycle`, `ui-i18n`, `cycle-prompts`) passam.

## O que não foi verificado

O comportamento em tela: nenhuma tela foi aberta e nenhum fluxo de chamada foi executado à
mão. Ficam por conferir na etapa de teste a linha transitória na conversa abaixo da mensagem
que chamou (e a sua saída na resposta e na falha), o painel de atividade na tela da execução
com ela parada num portão, a entrada nomeada no quadro de tarefas abrindo a conversa e o
mesmo no navegador pareado — com a voz ligada e desligada. O aviso dentro do painel do
quadro de tarefas quando o texto do passo cresce não foi visto em tela.

## Um ponto de teste

Falta um teste de tela que renderize a linha do chamado e o painel do quadro com um chamado
conhecido. Hoje o seletor tem teste direto e o fluxo do chamado tem teste no motor, mas "a
linha aparece abaixo da mensagem e sai quando o chamado termina" e "a entrada do quadro
traz o nome do agente e da execução" são conferidos pela leitura do componente, não por um
teste que falhe se a ligação se perder. É sugestão, não bloqueio: a inspeção do componente
não encontrou erro na ligação.
