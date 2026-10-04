# O aviso de que um agente chamado está trabalhando

## O que foi construído

O chamado de um agente pelo `@` na conversa de uma execução passa a ter uma
identidade própria no registro de atividade — agente, conversa e a mensagem que chamou
— e um estado novo, "na fila". Com essa identidade, quatro superfícies mostram que o
chamado está vivo: a linha transitória na conversa, o painel de atividade na tela da
execução, a entrada nomeada no quadro de tarefas e o mesmo no navegador pareado, que
usa os mesmos componentes.

O chamado continua somente leitura e mantém os limites de silêncio e de tempo da
etapa: o aviso só relata o que o agente já fazia, sem mudar o que ele pode fazer nem
por quanto tempo.

## O que mudou, por peça

**Registro de atividade (compartilhado).** A linha ganhou um campo opcional de chamado
(`agent`, `thread`, `message`) e um estado novo, `queued`. A checagem de execução viva
passou a tratar "na fila" como viva: um chamado que espera a vez está vivo, ainda que
não tenha começado.

**Registro de atividade (principal).** Um construtor de chamado cria a execução do
chamado com o contexto da execução e a identidade recebida, para a linha existir antes
de o agente começar. A leitura de recuperação de um contexto passou a incluir os
chamados em andamento além da execução mais recente, para que a linha de um chamado
enfileirado reapareça quando a conversa é aberta no meio dele.

**Motor.** O pedido de execução de um agente ganhou o campo opcional da atividade já
criada; quando ele vem preenchido, o motor não cria outra atividade nem repete o estado
de começo, só relata o fim (concluído ou falha).

**Chamada por `@`.** Ao aceitar a mensagem, cada agente chamado ganha o seu chamado e a
linha de chegada — "na fila" quando já há outro chamado daquela execução em andamento,
"trabalhando" caso contrário. Ao começar de fato, a linha de fila vira "trabalhando". O
fim por resposta e o fim por falha fecham o chamado; o caminho de falha antes de o motor
rodar também fecha. A ordem é a da chegada e o limite de três agentes por mensagem
continua.

**Seletor de linhas de chamado (renderer, sem DOM).** Agrupa as linhas por chamado,
escolhe a mais nova de cada grupo e descarta os grupos terminados. É a peça que a
conversa e o quadro compartilham e que os testes cobrem diretamente.

**Conversa.** Abaixo da mensagem que chamou, uma linha por chamado, numa região viva
educada para quem usa leitor de tela. Ela diz que o agente está trabalhando (ou que
espera a vez) e depois mostra o passo ao vivo; sai quando o grupo termina. Uma conversa
sem execução (canal ou geral) não mostra nada disso: lá o `@` continua texto comum.

**Tela da execução.** O painel de atividade passa a aparecer também quando há chamado
em andamento, qualquer que seja a situação da execução, com o nome do agente chamado no
título e o tempo contado desde o começo do chamado. O painel não ganha conteúdo novo:
mostra os mesmos rótulos curtos de sempre.

**Quadro de tarefas.** Cada chamado vira uma entrada com o nome do agente e a referência
da execução, e abrir a entrada leva à conversa daquela execução. Os trabalhos que não
são chamado de conversa continuam na entrada genérica de hoje, e os contadores do botão
flutuante passam a contar também as entradas nomeadas.

**Catálogos.** As chaves novas entraram nos dois idiomas (pt-BR e en): o rótulo do
estado de fila, o título do painel com o nome do agente, o rótulo de "trabalhando" e o
rótulo da entrada do quadro.

**Registro de lançamento.** Uma entrada em `CHANGELOG.md` descreve, para quem usa, o
aviso nas quatro superfícies.

## O que foi conferido nesta etapa

Rodado nesta etapa, no worktree:

- `npx tsc --noEmit` — sem erro.
- `npx vitest run` — 212 arquivos, 3533 testes, todos passando (a suíte inteira).
- `node scripts/theme-audit.mjs` — 55 pares de contraste em cada tema, o pior 4,58 no
  claro e 8,06 no escuro; nenhum arquivo novo com cor literal.
- `npm run i18n:lint` — 3995 chaves nos dois idiomas, nenhuma faltando ou sobrando.
- `node scripts/public-audit.mjs` — 856 arquivos, nada de empresa, pessoa ou host.

Cobertura de teste dos pontos novos: o seletor agrupa por chamado, mostra a linha mais
nova e descarta o grupo terminado; "na fila" conta como execução viva; a leitura de
recuperação de um contexto traz um chamado enfileirado junto da execução mais recente;
o fluxo do chamado cria a linha de cada agente nomeado (a segunda como "esperando"),
roda cada chamado sob a atividade da sua própria linha, e o fim por resposta fecha o
chamado.

Não verificado nesta etapa: o comportamento real em tela — a linha na conversa, o
painel com a execução num portão, a entrada nomeada no quadro e o mesmo no navegador
pareado. Nenhuma tela foi aberta e nenhum fluxo foi executado à mão; também não foi
conferido o `electron-vite build`, que a CI roda além dos portões acima.

## Arquivos tocados

- `src/shared/activity.ts` — campo do chamado na linha, estado `queued`, execução viva.
- `src/main/activity.ts` — construtor do chamado e leitura de recuperação com chamados
  em andamento.
- `src/main/agents.ts` — atividade já criada no pedido de execução.
- `src/main/runner/service.ts` — abertura, virada para "trabalhando" e fechamento do
  chamado em `onMessage`/`answerMention`.
- `src/renderer/src/activity.ts` — seletor `callGroups`.
- `src/renderer/src/screens/cycle/Thread.tsx` — a linha transitória na conversa.
- `src/renderer/src/AgentActivity.tsx` — título com o nome do agente.
- `src/renderer/src/screens/cycle/RunScreen.tsx` — a condição do painel e o rótulo.
- `src/renderer/src/JobsDock.tsx` — uma entrada por chamado, abrindo a conversa.
- `src/renderer/src/screens/cycle/cycle.css` — a linha do chamado, só com tokens.
- `src/shared/i18n/en.json`, `src/shared/i18n/pt-BR.json` — as chaves novas.
- `CHANGELOG.md` — a entrada da versão.
- `test/activity-store.test.ts`, `test/agent-activity-core.test.ts`,
  `test/runner-lifecycle.test.ts` — os testes dos pontos acima.

## Fora do escopo, como no plano

A dica no campo de escrita quando o `@` é digitado num canal ou numa conversa geral;
chamados em paralelo e mais de três agentes por mensagem; guardar o aviso no histórico;
o aviso de fim de chamado fora da tela; e qualquer mudança no que o chamado pode fazer.
