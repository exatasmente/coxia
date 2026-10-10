# As imagens da documentação nascem de um workspace fictício, e o release as refaz

O trabalho tem quatro peças que se apoiam uma na outra, na ordem em que se podem
conferir sozinhas: o **workspace fictício** que um comando escreve num folder; os
**scripts de captura**, um por funcionalidade, que abrem o aplicativo construído sobre
esse workspace e escrevem a imagem; a **lista** que diz o que existe e onde cada imagem é
usada, com a **conferência** que recusa divergência; e, por fim, o **campo de tela por
etapa** e a **etapa do release** que refaz as imagens pela rota do pull request. A semente
e a captura vêm primeiro porque a lista e a conferência só têm o que comparar depois que
as imagens existem.

A ordem abaixo é a de implementação e a de commit: cada passo é uma mudança lógica.

## Mudanças, na ordem

### 1. O campo de tela por etapa (`display`)

Uma etapa de um fluxo passa a poder dizer `display: true` e receber a mesma tela virtual
que a etapa de QA já recebe. O campo é opcional e ausente vale `false`, então nenhum fluxo
já salvo muda de comportamento. Quatro arquivos mudam, e o plano explica por que o
`defaults.ts` não entra.

- **`src/shared/config/types.ts`** — acrescentar `display?: boolean` a `StageDef`
  (`interface StageDef`, linha 302-337), ao lado de `testEnv`, com um comentário que diz
  ser opcional, desligado, e que dá a etapa a mesma tela da etapa de QA. Não é preciso
  tocar em `isFlowCycle` (`src/shared/runs/flow.ts:13`): o campo sozinho não transforma um
  ciclo de cerimônia em fluxo, e a etapa que o usa já carrega `type`.
- **`src/shared/config/types.ts`** — acrescentar `display?: boolean` a `FlowStage`
  (`src/shared/runs/types.ts:503-528`), porque é o `FlowStage` que chega ao executor. Sem
  esse campo o veredito do passo 4 não compila.
- **`src/shared/runs/flow.ts`** — em `flowOf` (linha 30-54), copiar o campo para o
  `FlowStage` resolvido: `display: s.display === true` (ou `...(s.display ? { display: true } : {})`,
  para não mudar o objeto quando o campo está ausente). Uma linha na construção do objeto.
  Consequência a assumir: `flowHash` (linha 65-66) serializa todos os campos menos
  `autonomous`, então um fluxo com `display` ganha um hash novo e uma execução iniciada
  antes leria outro `hash` — é o mesmo que qualquer campo novo de fluxo já faz, e não há
  migração de execução (o `flowHash` diz qual versão a execução segue, não a invalida).
- **`src/shared/config/schema.ts`** — acrescentar
  `display: boolean('This stage gets the same virtual display a QA stage gets (Xvfb, no TCP, never the person\'s screen). Left out: off.')`
  ao objeto `stage` (linha 148-170), ao lado de `testEnv`. É obrigatório declarar aqui:
  `object()` põe `additionalProperties: false` (`schema.ts:26-28`), então um `display` não
  declarado é recusado pelo schema, que é o que valida o que se importa e o que o editor
  salva.
- **`src/shared/runner/executor.ts`** — duas linhas, não uma:
  - a linha 440 (o veredito da tela) ganha `|| stage.display === true`;
  - a linha 611 (a oferta de passagem de tela, o "beginHandoff") usa o mesmo veredito de QA
    separadamente: hoje é `run.docs || !(agent.screen === true || outputKindOf(stage.kind) === 'qa') ? null : beginHandoff(...)`.
    Uma etapa não-QA com `display` teria tela e **nenhuma** oferta de passagem, o que
    contraria o sentido do campo. A condição passa a incluir `stage.display === true`.
    É a segunda leitura da mesma decisão; sem ela o campo fica pela metade.
  O `stage` já chega aos dois pontos (é `FlowStage`), então não há mudança de assinatura.
  As guardas de sandbox/host e o "nunca a tela da pessoa" ficam onde estão
  (`src/main/sandbox/index.ts`, `host.ts`), intocados: o que chega até eles continua sendo
  o `display` resolvido, sem TCP.
- **`src/shared/config/defaults.ts`** — **nenhuma mudança**, e o plano o diz para não
  inventar uma chave: `withConfigDefaults` (`defaults.ts:126-137`) funde o config neutro e
  pós-processa `stageMapping`, `comments`, `squads` e `agents.team` — **não** há tabela de
  padrão por etapa, e o ciclo neutro tem `stages: []` (`src/shared/cycles/neutral.ts`).
  O mesmo vale para `testEnv` e `poolMode`: campos de etapa são resolvidos no uso
  (`s.display === true`), nunca gravados por padrão. O trio de esquema da regra do squad é
  aqui `types.ts` + `schema.ts`; o `defaults.ts` não tem o que receber, e forçar uma chave
  nele seria escrever uma etapa que não existe.
- **Migração:** nenhum passo novo em `STEPS`. Um config guardado sem o campo continua
  válido (`tolerateFlow` cobre o fluxo em `validate.ts`, e não há chave a converter), como
  `testEnv` e `poolMode`. `CONFIG_SCHEMA_VERSION` **não** sobe. Se um dia o campo passar a
  ser gravado por padrão, aí sim entra um passo no padrão de `v25ToV26`
  (`migrations.ts:390-393`, só move a versão).

Não há mudança de interface além do editor de fluxo: se a etapa é editada à mão, o campo
vem do schema; o editor de fluxo não precisa de campo novo nesta mudança (uma etapa que o
peça é do release, posta pelo template, não pela pessoa).

### 2. O workspace semeado

- **`scripts/seed-docs-workspace.mjs`** (novo) — um script Node ESM, um comando, que
  recebe um folder na linha de comando. Escreve ali um workspace completo e fictício e
  nada fora dele:
  - o registro de workspaces (`workspaces.json`) e a pasta do workspace, no layout que
    `src/main/workspaces-core.ts` define: `REGISTRY_FILE = 'workspaces.json'`, com
    `{ current, list: [{ id, name, createdAt, test }] }` (`readRegistry`/`validInfo`,
    linhas 70-83), a pasta em `workspaces/<id>/` (`WORKSPACES_DIR`, linha 34);
  - o `config.json` dentro de `workspaces/<id>/` (`CONFIG_FILE`, `config-bootstrap.ts:11`),
    na versão de esquema do aplicativo em execução (`CONFIG_SCHEMA_VERSION = 26`,
    `types.ts:5`), montado com `withConfigDefaults` (`defaults.ts:126`) para completar o
    documento — o mesmo ponto que o app usa;
  - as telas que a regra 1 pede, cada uma no arquivo que o módulo correspondente lê:
    o time de agentes (`agents.team`, os cinco de sistema por `systemAgents`,
    `src/config/team.ts:35`, mais um time de produto: o agente de documentação que o
    passo 5 usa); duas execuções em `workspaces/<id>/runs/<id>.json` (`runs-core.ts:5-6`,
    uma terminada com documentos por etapa e comprovação, uma parada num gate humano); as
    atividades num `board.json` (`src/main/boardSource.ts:13`); a conversa, a gravação, os
    procedimentos e o celular pareado no arquivo que cada módulo lê; a ata de um dia no
    formato `ATA_FILE = /^\d{4}-\d{2}-\d{2}-pre-daily\.md$/` (`workspaces-core.ts:25`).
  - **datas relativas a um dia fixo** (o relógio do app fica fora, pela spec): a semente
    escreve as datas a partir de um dia fixo, e é a captura que falsifica o relógio.
  - recusa-se a escrever num folder que já guarda um workspace — existe `config.json` ou
    `workspaces.json`, ou já há entradas de `WORKSPACE_FILES`/`WORKSPACE_DIRS`/`ATA_FILE`
    (`detectExistingInstall`, `config-bootstrap.ts:35-46`) —, com uma mensagem clara, e não
    toca em nada do que estava lá. Depois de escrever, não pode restar nada a migrar: a
    escrita passa por `writeConfigFile` (`config-bootstrap.ts:56`) com um config já na
    versão corrente, para o app abrir sem aviso.
  O script é Node puro, sem `t()`: as mensagens dele são diagnóstico de quem mantém o
  repositório, escritas em inglês, no mesmo estilo de `scripts/release.sh` e dos outros
  scripts (a regra de `t()` é para string de interface, e não há interface aqui).
- **Onde a semente fica:** o folder semeado é **fora do repositório**, descartável, e não
  entra na árvore nem no `.gitignore` (a decisão já registrada na memória). Quem usa aponta
  `CERIMONIAS_DATA_DIR` (e `CERIMONIAS_SPECS_DIR`) para ele (`src/main/env.ts:10`). Por isso
  a auditoria pública é conferida **apontada** para a pasta com
  `node scripts/public-audit.mjs --root <dir>` (uso que o próprio script documenta,
  `scripts/public-audit.mjs:6`). O repositório versiona só a semente e os scripts de
  captura.

### 3. Os scripts de captura e a lista

- **`scripts/captures/<funcionalidade>.mjs`** (novos) — um por funcionalidade. Cada um
  abre o aplicativo **construído** sobre o workspace semeado, com o `_electron` do
  `playwright-core` (já nas dependências), numa janela de tamanho fixo, num tema fixo, com
  as animações desligadas e o relógio falsificado; caminha até a tela, espera ela assentar
  e escreve `docs/images/<funcionalidade>[-<idioma>].png`. Como o app em teste é o
  construído, a captura exige `npx electron-vite build` antes (o build não entra na
  captura: quem chama garante). Um script pode chamar a ferramenta de marcação (retângulo,
  rótulo) e guardar também a imagem sem marca. Tela de celular sai do **modo web do próprio
  app** a 390 px de largura (`src/main/web.ts` sobe em `127.0.0.1:4330`; o layout de celular
  começa por `useIsPhone.ts`) — é o caminho que não depende de nada fora do app construído,
  e a spec o aceita.
- **`scripts/captures/run.mjs`** (novo) — o comando que roda a lista inteira nos dois
  idiomas; é o que a etapa do release e a aceitação chamam.
- **`scripts/captures/index.json`** (novo) — por funcionalidade: `id`, título nos dois
  idiomas, o script, quais telas, em que idiomas sai, o tema, e onde a imagem é usada
  (os dois READMEs, uma página de `docs/`, o site). A primeira lista cobre no mínimo as
  cinco capturas que os READMEs já prometem (`README.md:9-17`, `README.pt-BR.md:9-17`,
  `docs/images/README.md:5-11`): `today`, `call`, `actions`, `wizard`, `phone`. A captura
  do assistente de configuração serve também para mostrar que uma pasta de dados vazia abre
  nele.

### 4. A conferência de referências

- **`scripts/docs-images-check.mjs`** (novo) — lê `scripts/captures/index.json`, a lista
  de arquivos em `docs/images/` e as referências dos READMEs e das páginas de `docs/`, e
  falha quando: uma imagem referenciada não tem script; um script não tem referência; uma
  entrada da lista não tem imagem; ou há uma imagem sem entrada na lista. É um script Node
  com a forma dos outros (`scripts/public-audit.mjs` por modelo: sem dependência de
  Electron, exportado para o teste, com um `main()` que decide o código de saída).
- **`.github/workflows/ci.yml`** — um passo novo dentro do job `check`
  (`ci.yml:17-52`), depois do `Public audit` (linha 33-34), rodando o script. É o "mesmo
  trabalho em que já correm a auditoria pública, os tipos, os testes e a compilação"
  (regra 7 da spec). O passo não precisa do app construído: lê a lista e os arquivos.

### 5. A etapa do release

- **`src/shared/cycles/templates/releaseFlow.ts`** — acrescentar uma etapa de trabalho ao
  `RELEASE_FLOW_STAGES`, **entre `release-assemble` (linha 18, rank 3) e `release-merged`
  (linha 20, rank 4, o wait `release-approved`)** — é o ponto "depois de as atividades da
  versão estarem na branch e antes de o corte ser pedido" (regra 6). A etapa é um
  `type: 'work'`, `kind: 'development'`, com `display: true`, o seu `agentId` e o seu
  `produces`; os `rank` seguintes sobem um. A ordem do array é a ordem do fluxo
  (`nextOf`, `flowCheck.ts:57`), então a etapa roda antes do wait sem `next` explícito.
  `match` distinto de `^Merges` (por exemplo `^Refresh the images$`).
- **O agente da etapa** é um agente que roda comando (`shell: 'sandbox'` ou `'host'`,
  `permission: 'worktree'`), novo no `team` do template, com o seu bloco de textos nos dois
  catálogos. **Não** é o Release manager: ele tem `shell: 'none'` e `permission: 'read'`
  (`releaseFlow.ts:36-49`) e a etapa precisa rodar `node scripts/captures/run.mjs` e
  escrever em `docs/images/`. O `stages` do agente novo lista a etapa; o do Release manager
  é montado por filtro (`releaseFlow.ts:42`) e não a recebe, porque o `agentId` não é dele.
- **Os comentários e os textos:** um `type: 'work'` com agente tem comentário pelo
  `RELEASE_COMMENT_SHAPE` (`releaseFlow.ts:67`) — a etapa nova entra ali com a sua contagem
  de seções, mais o `label`, o `name`/`job`/`instructions` do agente e as seções do
  comentário, todos nos dois catálogos (`src/shared/i18n/pt-BR.json` e `en.json`), com a
  mesma chave nos dois — é o que `npm run i18n:lint -- --keys` confere
  (`scripts/i18n-lint.mjs:196-229`).
- **A etapa guarda o que escreveu** como comprovação (uma imagem por captura, pela
  ferramenta de comprovação que a etapa já tem) e deixa o que mudou em `docs/images/`
  seguir para o pull request do release, pela revisão normal. Nada de commit fora do pull
  request: o corte continua um passo único, atrás do "sim" (D18), e nada em
  `src/shared/release.ts`, `RELEASE_OPS` ou `scripts/release.sh` muda.
- **`docs/runner.md`** — a descrição do fluxo `release-flow` ganha a etapa nova nas **duas**
  passagens que a descrevem (a em português, linha 228, e a em inglês, linha 523). A tabela
  dos passos da release (`docs/runner.md:502-511`) **não muda**: a etapa nova não pede
  nenhum passo de release novo.

### 6. As imagens nos textos

- **`docs/images/README.md`** e os dois READMEs (`README.md:9-17`, `README.pt-BR.md:9-17`)
  — a tabela de pendências vira referência às imagens reais, por caminho relativo e com
  texto alternativo, e o `TODO` sai. O `docs/README.md:35` ("as capturas planejadas") ganha
  a mesma correção. O que a lista conheça e a pasta ainda não tenha continua listado como
  pendente, para lista e pasta não divergirem em silêncio.

### 7. Notas de lançamento e instruções

- **`CHANGELOG.md`** (seção `Unreleased`) — a mudança é visível a quem usa: as páginas
  passam a mostrar telas, uma etapa pode pedir tela e o release refaz as imagens.
- **`AGENTS.md`** — conferir na implementação se a receita de captura exige uma linha nova
  nas instruções de "antes de dar por pronto" (a captura precisa do app construído); se
  exigir, atualizar na mesma mudança; se não, não tocar.

## Ordem de implementação

1. O campo `display` (types de etapa e de fluxo, `flow.ts` do mapeamento, schema,
   executor nas duas linhas) e os seus testes — é a menor mudança e destrava a etapa do
   release.
2. A semente e o seu teste de recusa e de auditoria.
3. Os scripts de captura, o `index.json` e o `run.mjs`.
4. A conferência de referências e o passo da CI.
5. A etapa do release no template, o agente novo, os textos e os testes do template.
6. As imagens geradas e a atualização dos READMEs/páginas.
7. A entrada no `CHANGELOG.md`.

Cada passo é um commit lógico, na ordem do plano.

## Testes

Um teste por comportamento novo, no arquivo indicado:

- **`test/config-schema.test.ts`** — o schema aceita `display: true` numa etapa e continua
  recusando um campo desconhecido (`additionalProperties: false`). (passo 1)
- **`test/runner-stage-screen.test.ts`** — acrescentar linhas à tabela
  (`describe('what a stage is offered of the screen')`, linha 212) com uma coluna
  `stageDisplay`: uma etapa **não-QA sem `screen` mas com `display: true`** na etapa do
  fluxo recebe tela e o navegador do app; uma etapa sem o campo continua sem tela (as
  linhas de hoje continuam passando). O `configure` do helper escreve `display` na etapa.
  É o teste que falharia sem o código dos passos 1 e 4. (passo 1)
- **`test/cycle-templates.test.ts`** — atualizar a lista ordenada de `describe('the
  release-flow template')` (linha 523-548) com a etapa nova (id, tipo, agente) na posição
  certa, e afirmar `display === true` nela; `checkFlow` passa com a etapa (linha 517). O
  `returnsTo` do `release-stable-gate` (linha 546) **não** muda: a etapa nova fica depois
  da beta no array, e o gate da estável continua voltando à beta. (passo 5)
- **`test/seed-docs-workspace.test.ts`** (novo) — num folder temporário: a semente escreve
  um workspace cujo `config.json` está em `CONFIG_SCHEMA_VERSION` e que `migrateConfig`
  aceita sem nota nova; rodar de novo é recusado e nada muda; `auditRoot(dir)` (de
  `scripts/public-audit.mjs`, já usado em `test/public-audit.test.ts:87`) não acha nada na
  pasta semeada. Não abre o app nem rede. (passo 2)
- **`test/captures-index.test.ts`** (novo) — o `index.json` é válido, cada `id` tem script
  em `scripts/captures/`, e a lista cobre as cinco funcionalidades do README. (passo 3)
- **`test/docs-images-check.test.ts`** (novo) — o script de conferência: passa quando
  imagem, script e referência se correspondem; falha com referência órfã, com script sem
  referência, com entrada da lista sem imagem e com imagem sem entrada. (passo 4)

O que **não** é teste automatizado (é condição de aceitação de quem implementa, verificada
à mão e registrada, porque precisa do app construído, dos navegadores e da tela virtual, e
não pode entrar na suíte que não pode tocar rede nem modelo):
- a semente abrir no app da versão atual sem aviso de migração (aceitação 1);
- duas execuções de `run.mjs` produzirem arquivos iguais byte a byte (aceitação 3);
- uma etapa com `display` guardar cada imagem como comprovação e poder olhá-la (aceitação
  4);
- o release refazer as imagens e o pull request mostrar só o que mudou (aceitação 6).

Nenhum teste novo toca modelo real, host de código real ou a rede.

## Riscos e como se evitam

- **O campo novo quebrar um fluxo já salvo.** O campo é opcional e ausente vale `false`; o
  `schema` recusa chave desconhecida, então declarar `display` nele é o que deixa um fluxo
  que o use passar. Nenhum passo de migração, `CONFIG_SCHEMA_VERSION` parado — como
  `testEnv` e `poolMode`. Coberto pelos testes de schema e pelo teste de tela.
- **O `flowHash` mudar por causa do campo.** Um fluxo com `display` tem hash novo, e uma
  execução antiga leria outro hash. Isso é o que o hash significa (qual versão do fluxo a
  execução segue), não invalida execução nenhuma, e é o mesmo que qualquer campo novo de
  fluxo faz. Dito aqui para não surpreender quem implementa.
- **A tela pedida pela etapa e a oferta de passagem.** Duas leituras da mesma decisão
  (`executor.ts:440` e `:611`); mudar só a primeira daria tela sem oferta de passagem.
  Coberto pelo teste de tela, que afirma a oferta.
- **A etapa nova do release colidir com o corte (D18).** A etapa é do fluxo, roda os
  scripts de captura e não pede passo de release; o corte continua um passo único, atrás do
  "sim", sem tocar `push`/`beta`/`stable`. O wait `release-approved` fica depois dela.
  Nada em `src/shared/release.ts`, `RELEASE_OPS` ou `scripts/release.sh` muda.
- **Os testes do template quebram ao inserir a etapa.** `test/cycle-templates.test.ts`
  afirma a lista ordenada exata e os `waitsFor`; a etapa nova muda a lista e o teste é
  atualizado na mesma mudança. O `returnsTo` da estável não muda pelo lugar escolhido, e
  isso é conferido no próprio teste.
- **`docs/images/` com dado real dentro de uma imagem.** A auditoria confere um binário só
  pelo caminho, nunca pelo conteúdo (`scripts/public-audit.mjs:109-131`, `isBinary` pula o
  conteúdo), então uma imagem com dado real **não** é pega pela auditoria. A guarda é a
  semente com placeholders neutros e a regra 8 da spec; a revisão das imagens é a do pull
  request. Risco dito em voz alta: a auditoria não lê pixels.
- **A captura tocar o mundo.** Os scripts abrem o app construído sobre dados fictícios,
  sem hosts reais; o `phone` usa o modo web local (`127.0.0.1`). Nada de rede externa,
  modelo ou host de código. Coberto por construção e pela aceitação 9 (conferida na
  revisão, lendo a semente e os scripts).
- **Igualdade byte a byte entre duas execuções.** Depende de relógio falso, tamanho fixo,
  tema fixo e animações desligadas; um PNG pode variar por metadado. Mitigação no plano: a
  captura fixa o relógio e o resto; se o formato variar por metadado, compara-se o conteúdo
  da imagem — a decidir na implementação, e a aceitação 3 registra o que se conseguiu.
- **Um caminho novo de escrita fora do portão.** Nada nesta mudança escreve no host de
  código fora de Actions; a etapa do release só roda scripts locais e deixa o diff seguir
  para o pull request que já existe. É a fronteira do squad, e o plano a mantém.
- **O relógio falso alcançar o app inteiro.** A captura falsifica o relógio **só** na
  janela do app em teste; não muda o app nem o workspace da pessoa.
- **Uma imagem sem referência ficar para trás.** A conferência de referências (passo 4)
  recusa os quatro casos; é o que impede lista e pasta de divergirem em silêncio.

## Decisões e por quê

- **O `display` é campo da etapa do fluxo, não do agente.** A issue pede no fluxo; o agente
  já tem `screen` para outra coisa (o navegador do app e a tela ao vivo), e misturar os
  dois faria a etapa do release depender de uma escolha de agente. O campo é aditivo e
  desligado.
- **O campo vai também no `FlowStage`.** O executor lê o `FlowStage`, não o `StageDef`;
  sem o mapeamento em `flowOf` o campo nunca chegaria ao veredito.
- **A segunda leitura do veredito (a oferta de passagem) é mudada junto.** Senão a etapa
  teria tela e nenhuma passagem, o oposto do que o campo quer dizer.
- **A conferência é um script Node dentro do job `check`**, não um teste da suíte. Ela lê a
  lista e os arquivos, não precisa do app, e o job `check` já roda a auditoria pública — é
  o mesmo trabalho que a regra 7 nomeia. Fica também rodável à mão.
- **A etapa do release usa um agente que roda comando**, não o Release manager. O Release
  manager não tem shell nem escreve; a etapa precisa rodar os scripts e guardar comprovação.
- **A semente fica fora do repositório** (decisão já da memória): descartável, conferida
  por `--root`. Não entra na árvore nem no `.gitignore`; o repositório versiona só a
  semente e os scripts de captura.
- **O `phone` sai do modo web do próprio app**, não de um navegador externo: é o caminho
  que não depende de nada fora do app construído, e a spec o aceita.
- **Não há alvo novo de manutenção** ("refazer tudo"): quem quiser roda `run.mjs`; a spec
  deixa isso fora de escopo.

## Critérios de aceite que o plano cobre, e o que fica para a implementação

- **Aceitações 1, 2, 3, 5, 7, 8, 9:** cobertas pelos passos e testes acima, e pelas
  verificações à mão que a própria spec nomeia. A 2 (a semente não escreve duas vezes) tem
  teste de recusa.
- **Aceitações 4 e 6** (a etapa com tela guarda comprovação e o release refaz as imagens)
  ficam como verificação à mão de quem implementa, porque exigem o app construído e a tela
  virtual; o plano as nomeia para não serem dadas como feitas sem que alguém as veja.
- **Aceitação 9** (nenhuma execução alcança o mundo) é conferida na revisão, lendo os
  scripts e a semente.
- Um critério de aceite que o plano **não** fecha sozinho: o "byte a byte" da aceitação 3
  depende do formato do PNG produzido; o plano o cobre com relógio, tamanho, tema e
  animações fixos, e deixa a comparação de conteúdo como reserva declarada.

## Perguntas em aberto

1. **O que fazer se as telas mudarem durante o ciclo de um release.** Já registrada na
   spec: quem decide reabrir a etapa é a pessoa; a etapa só não pode seguir calada. O plano
   não muda isso.
2. **Quem fecha o ciclo de uma imagem órfã.** A spec deixou em aberto se a etapa do release
   apaga as que sobram ou se isso é da pessoa. O plano **escolhe não recolher** na etapa do
   release: apagar arquivos que ninguém referenciou é decisão da pessoa, e a conferência já
   reprova a CI enquanto a órfã existir — a etapa do release não a esconde. Se o product
   owner quiser o contrário, é uma linha a mais na etapa.
