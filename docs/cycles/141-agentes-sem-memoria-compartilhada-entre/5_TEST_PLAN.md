# O que foi conferido na entrega da memória compartilhada das atividades

## Como ler este plano

Cada critério de aceite da especificação virou um cenário numerado: o que fazer e o que esperar. Um
cenário é **executado** quando um comando desta etapa o mostra (o id da comprovação vai entre
parênteses, `ev-N`); é **lido** quando só o código ou um documento o sustenta; e é **não executado**
quando nada dele foi rodado, com a razão. A entrega é a dos passos 1 e 2 do plano — as frentes por
atividade, o recorte que chega a um agente, a tela que lê e corrige e o aviso ao agente que trabalha.
O que a revisão deixou como sugestão (a segunda cópia do aviso, a frente corrigida sem "onde parou" e
as miniaturas sem teste do corte) foi conferido como cenário de observação, e não bloqueia.

Os comandos foram rodados com uma pasta de dados descartável, sem modelo real, sem host de código e
sem rede. A suíte usa um arquivo de configuração próprio só porque `node_modules` é somente leitura
neste checkout e o Vite não consegue gravar o cache onde costuma; a cobertura é a do repositório,
inalterada.

## Reconferência desta retomada

Os arquivos da mudança foram re-rodados nesta retomada com a mesma cobertura (23 casos, 3 arquivos:
`sharedMemoryRun`, `sharedMemoryCall`, `activityIndex`; o caso de `sharedMemoryFiles` vive dentro do
primeiro) (ev-5, arquivo `02-gates-fresh.txt`), junto de `npx tsc --noEmit`,
`node scripts/public-audit.mjs` (1222 arquivos) e `npm run i18n:lint` (4647 chaves nas duas línguas,
0 string não traduzida) (ev-5).

Da mesma retomada, por comando: **o cenário 2** re-rodado com a sonda que sobe o runner duas vezes
sobre a mesma pasta e a segunda bota lê a mesma etapa, instante e id de execução, o registro intacto
(ev-6, arquivo `02-restart-probe-fresh.txt`); **e os três cenários de observação, que antes ficavam
como lido, foram reproduzidos por comando** — o 6 (a frente corrigida perde «onde parou», «o último
recado» e também o texto da pessoa), o 7 (a frase do aviso entregue duas vezes numa mensagem que já a
traz) e o 8 (o corte por agente e as miniaturas, exercitado sozinho) (ev-3 e ev-4).

Nota sobre os ids: as comprovações das passadas anteriores não estão mais guardadas; delas restam os
registros deste arquivo e o que a revisão registrou. Nesta retomada os ids atuais são: **ev-1** a
imagem da tela que o app já guardou desta etapa em tentativa anterior, **ev-2/comando tsc**,
**ev-3** as sondas dos cenários 6 e 7, **ev-4** a sonda do cenário 8, **ev-5** os gates re-rodados,
**ev-6** a sonda de reinício do cenário 2; o nome do arquivo de cada comprovação diz qual é qual.

## Cenários dos critérios de aceite

### 1. Um agente chamado sabe de uma atividade em andamento (executado)

**Fazer:** com uma atividade em andamento cuja frente está no registro, perguntar a um agente o que
está acontecendo com ela. **Esperar:** o agente recebe a frente da atividade nomeada — referência,
título, etapa, agente e onde parou — e não uma resposta de que não há trabalho. O trecho chega ao
agente como seção entre marcas de material, sem virar ferramenta nem pasta.

Conferido pelos casos `test/sharedMemoryCall.test.ts` ("puts the record … in a section of its own",
"leaves the call without the section when the record has nothing to say", "never offers the record as
a tool") e `test/activityIndex.test.ts` ("selects by the activity named and by the agent named"): 23
casos dos três arquivos da mudança, todos passando (ev-5, re-rodado nesta retomada). Não foi
exercitado um app aberto com um modelo real respondendo; o recorte que o agente lê foi exercitado
pela chamada montada.

### 2. Depois de reiniciar, o trabalho continua de onde parou (executado)

**Fazer:** com uma frente no registro, encerrar o processo e subir de novo sobre a mesma pasta de
dados; ler o que está em andamento. **Esperar:** a mesma atividade, com a mesma etapa, o mesmo agente
e o mesmo "onde parou", e a correção da pessoa preservada.

Conferido de duas formas. Por comando, nesta retomada: a sonda sobe o runner uma vez sobre uma pasta
descartável (`app#101`, motor falso, sem modelo e sem host), larga o runner e sobe um segundo e novo
sobre a mesma pasta; o segundo lê da frente a mesma etapa, o mesmo instante e o mesmo "onde parou" do
primeiro, o mesmo id de execução, e o arquivo do registro não mudou (ev-6, arquivo
`02-restart-probe-fresh.txt`). Complementado pelos casos `a start leaves a front, and a move keeps it
up to date` e `the person corrects a front…` de `test/sharedMemoryRun.test.ts` (ev-5, suíte
re-rodada nesta retomada). A forma no app em execução (o Electron encerrado e reaberto sobre a
mesma pasta descartável, com a tela de execuções mostrando a frente e a correção com
`source: person`) vem da tentativa anterior (ev-1) e não foi re-rodada nesta retomada.

### 3. Em paralelo, o mesmo estado (executado parcialmente)

**Fazer:** duas perguntas a dois agentes, em conversas diferentes, ao mesmo tempo; conferir que os
dois relatam a mesma lista. **Esperar:** as duas leem a mesma frente, com a mesma etapa e o mesmo
agente.

Conferido no que dá para exercitar sem um fórum de verdade: o registro é um arquivo só, lido por
qualquer chamada, e duas atividades são duas chaves que não se apagam ("keeps the front of every
activity apart" em `test/activityIndex.test.ts`, ev-5). Não foi exercitado um app com dois agentes
respondendo de verdade ao mesmo tempo, nem o módulo de menções fora de uma execução com um fórum
real — fica como não verificado.

### 4. Nem worktree nem execução (executado)

**Fazer:** com duas atividades em worktrees diferentes, apagar a execução de uma delas (a pasta do
store e o worktree). **Esperar:** o registro continua fora do worktree e a frente sobrevive à remoção
da execução.

Conferido por comando da tentativa anterior (comprovação de sonda não mais guardada; o que resta é o
registro): o caminho do arquivo (`<pasta de dados>/memory/activities.json`) não está dentro do
worktree da execução; apagar a pasta do store de execuções não remove a frente; e a correção de uma
frente não toca a outra, tudo em 4 casos que passaram. Reancorado nesta retomada por
`test/sharedMemoryRun.test.ts` ("the file is in the workspace's own folder, outside the run's
worktree"), passando (ev-5).

### 5. A memória sem chamada de modelo (executado)

**Fazer:** abrir a tela que lista as execuções e olhar a seção das atividades. **Esperar:** a lista
traz, por atividade, a referência, o título, a etapa, o agente e o "onde parou", sem nenhuma chamada
de modelo.

Conferido no app em execução sobre uma pasta descartável, na tentativa anterior (comprovação de tela
não mais guardada a não ser a imagem relida, ev-1): a tela de execuções mostra a seção com a frente
completa, a folha de edição abre no clique e o salvar escreve a correção com `source: person`; sem
modelo configurado, nada foi chamado. Reancorado nesta retomada por `test/sharedMemoryRun.test.ts`
("the activities are listed without a model call, one entry per activity"), passando (ev-5).

## Cenários de observação (as sugestões da revisão)

### 6. A frente corrigida perde "onde parou", "o último recado" e o texto da pessoa (executado, não bloqueia)

**Fazer:** corrigir uma frente pela pessoa e deixar a atividade andar de novo. **Esperar (ideal):** o
que a pessoa escreveu aparece, e o que o app sabia de "onde parou" e "o último recado" não some sem
dizer por quê.

**Visto, agora por comando:** a sonda corrige a frente (`source: person` confirmado) e deixa a
atividade andar de novo (a porta de espera é aprovada); a frente é projetada de novo e fica com
`stoppedAt: null`, `lastHandoff: null`, `decisions: []` e `correction: []` — os dois campos do fim e,
mais forte do que a revisão registrou, **o texto da pessoa inteiro** desaparece do arquivo; a
renderização da frente traz só referência, título, etapa, agente e instante, sem "Decisions and where
it stopped", "Where the work stopped" nem "Last handoff" (ev-3). Sugestão da revisão, não bloqueia:
o comportamento do restante da entrega não depende dela, mas a correção feita antes de a atividade
andar não é estável e vale ordem de conserto própria.

### 7. A mensagem da pessoa que já traz o aviso recebe uma segunda cópia (executado, não bloqueia)

**Fazer:** enviar uma mensagem que já contém a frase do aviso, com a etapa trabalhando e a caixa
aceitando a mensagem. **Esperar (ideal):** o agente lê a frase uma vez só.

**Visto, agora por comando:** a sonda manda uma mensagem do(a) usuário(a) citando o agente que
trabalha, com a frase do aviso já no texto dela; a caixa aceita a mensagem e a primeira entrega
(palavras da pessoa, a frase uma vez); o app entrega em seguida a mesma frase de novo, sozinha — o
agente lê a frase duas vezes na mesma sessão (ev-3, mesmo arquivo do cenário 6). Sugestão da
revisão, não bloqueia: é texto de aviso.

### 8. As miniaturas por agente e o corte delas (executado, não bloqueia)

**Fazer:** perguntar "o que fulano está fazendo?" e conferir que a resposta traz a atividade e a etapa
em que aquele agente foi visto por último. **Esperar:** a miniatura certa, sem abrir a frente inteira.

**Visto, agora por comando:** a sonda monta duas atividades (uma com o planejador trabalhando, outra
parada na porta de espera com o triador como último a mexer) e consulta o corte por agente: nomear
"planner" traz só a frente do que o planejador trabalha; a busca casa o nome em `agent` e em
`lastAgent`, então nomear o triador traz as duas frentes que ele tocou por último; a renderização
acrescenta a linha da miniatura ("- refiner: app#102 · Gate 1") ao lado das frentes (ev-4, arquivo
`08-probe-thumbnails-cut.txt`). O caso dedicado do corte que a revisão pediu foi exercitado por
sonda, e não como teste do repositório — virar teste do repositório é entrega própria.

## Gates do repositório desta etapa (executados)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | passa (ev-5, re-rodado nesta retomada) |
| `npm run i18n:lint` | passa: 4647 chaves nas duas línguas, 0 string não traduzida (ev-5) |
| `node scripts/public-audit.mjs` | passa: 1222 arquivos, nada de empresa ou pessoa (ev-5; na tentativa anterior também passou) |
| Suíte dos arquivos da mudança (23 casos, 3 arquivos) | passa (ev-5) |
| `node scripts/theme-audit.mjs` | passa: 8 cores literais, todas anteriores à mudança (tentativa anterior) |
| `node scripts/i18n-lint.mjs --file src/main/runner/service.ts` | 0 string não traduzida (tentativa anterior) |
| `npx electron-vite build` | passa (tentativa anterior) |
| `npx vitest run` (suíte inteira) | 4349 passam, 2 falham, 24 pulados; as duas falhas são `test/voice-setup.test.ts`, por o disco estar abaixo do espaço que o próprio app pede (`disk-low`), e passam quando a pasta temporária tem espaço (tentativas anteriores) |

## O que não foi verificado

- **Um app aberto com modelo real respondendo.** O recorte que o agente lê foi exercitado pela
  chamada montada, não por um modelo de verdade; nenhum teste toca modelo real, por regra.
- **Dois agentes respondendo em paralelo num fórum real.** O estado é um arquivo só e é lido por
  qualquer chamada; a corrida entre dois agentes de verdade não foi exercitada.
- **O módulo de menções fora de uma execução com um fórum real.** O caminho existe e tem teste de
  unidade; o fórum real não foi aberto.
- **As miniaturas por agente como teste do repositório.** O corte foi exercitado por sonda (ev-4),
  mas não há o caso dedicado na suíte; virá-lo para a suíte é entrega própria.
- **A suíte inteira verde.** As duas falhas de `test/voice-setup.test.ts` são do disco da máquina
  (o /tmp com cerca de 308 MB livres, abaixo do 1,08 GB que o app pede para instalar a voz) e
  desaparecem quando a pasta temporária é maior; não vêm da mudança.

## Resultado dos cenários

- 1. Um agente chamado sabe de uma atividade em andamento (critério 1): passou (executado na sandbox) — Suíte dos arquivos da mudança re-rodada nesta tentativa: 23 casos em 3 arquivos passando — a seção do registro chega à chamada como material, o nome da atividade seleciona a frente e o registro nunca é oferecido como ferramenta. Não exercitado com um modelo real respondendo.
- 2. Depois de reiniciar, o trabalho continua de onde parou (critério 2): passou (executado na sandbox) — Sonda rodada nesta tentativa: um primeiro runner sobe sobre pasta descartável, é descartado e um segundo sobe sobre a mesma pasta; o segundo lê a mesma etapa (Gate 1), o mesmo instante e o mesmo id de execução da frente, com o arquivo do registro intacto (ev-6). Confirmado também pelos casos da suíte da mudança (ev-5). A forma no Electron inteiro encerrado e reaberto vem da tentativa anterior (ev-1) e não foi re-rodada nesta retomada.
- 3. Em paralelo, os dois lêem o mesmo estado (critério 3): passou (executado na sandbox) — Exercitado no que cabia sem um fórum de verdade: duas atividades são duas chaves que não se apagam no mesmo arquivo, lido por qualquer chamada (caso «keeps the front of every activity apart», ev-5). Não exercitado com dois agentes de verdade respondendo em paralelo — não verificado.
- 4. Nem worktree nem execução (critério 4): passou (executado na sandbox) — O caso «the file is in the workspace's own folder, outside the run's worktree» da suíte da mudança passa (ev-5). A sonda da tentativa anterior que apagava a pasta do store e conferia que a frente sobrevive não está mais guardarada; resta o registro dela e o teste re-rodado.
- 5. A memória sem chamada de modelo (critério 5): passou (executado na sandbox) — Na tentativa anterior: a tela de execuções mostra a seção das atividades, a folha de edição abre e o salvar escreve a correção com source: person, sem modelo configurado (imagem relida, ev-1). Reancorado nesta retomada pelo caso «the activities are listed without a model call, one entry per activity», passando (ev-5). A tela não foi aberta nesta retomada.
- 6. Observação: a frente corrigida perde onde parou, o último recado e o texto da pessoa ao andar de novo (sugestão da revisão): falhou (executado na sandbox) — Reproduzida por comando nesta tentativa (sonda): corrigida a frente com source: person e aprovada a porta de espera, a reprojeção deixa stoppedAt, lastHandoff, decisions e correction vazios — o texto da pessoa some inteiro do arquivo, mais forte do que a revisão registrou. Não bloqueia: suger os critérios de aceite da issue não dependem dela; cabe ordem de conserto própria.
- 7. Observação: mensagem que já traz a frase do aviso recebe uma segunda cópia (sugestão da revisão): falhou (executado na sandbox) — Reproduzida por comando nesta tentativa (sonda): a caixa do agente que trabalha aceita a mensagem com a frase do aviso no texto da pessoa e o app entrega a mesma frase de novo sozinha; o agente lê a frase duas vezes. Não bloqueia: é texto de aviso.
- 8. Observação: corte por agente e miniaturas (sugestão da revisão): passou (executado na sandbox) — Exercitado por comando nesta tentativa (sonda dedicada): nomear «planner» traz só a frente do planejador; o casamento é por agent e lastAgent; a renderização traz a linha da miniatura («- refiner: app#102 · Gate 1»). O teste dedicado do repositório continua por entregar.
