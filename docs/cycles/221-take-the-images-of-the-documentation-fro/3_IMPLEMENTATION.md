# O campo de tela por etapa fecha, a semente perde os nomes reais e as capturas ganham rotas próprias

Esta tentativa responde aos achados bloqueantes da revisão. O que ela mudou está abaixo, com o resultado de cada comando que correu. Os passos 1 a 7 do plano continuam nesta árvore como estavam.

## O que mudou

### O campo de tela por etapa passa a valer sozinho (aceitação 4)

Antes, a sandbox só abria a tela virtual com `opts.display === true && opts.config.display === true`: o campo da etapa não bastava, o interruptor do espaço de trabalho `runner.sandbox.display` também tinha de estar ligado.

- `src/main/sandbox/index.ts` — `OpenOptions` ganha `stageDisplay?: boolean`, `HostOpenOptions` inclui-o, e as duas conjunções (a da sandbox e a do computador) passam a
  `const askedDisplay = opts.display === true && (opts.stageDisplay === true || opts.config.display === true);`.
  O caminho da etapa de QA não muda: continua a pedir a tela pelo `opts.display` e a exigi-la pelo interruptor do espaço de trabalho.
- `src/main/runner/executor.ts` — as duas aberturas (sandbox e computador) passam `stageDisplay`, que já era resolvido para o veredito da tela.
- `test/runner-stage-screen.test.ts` — os dois casos do campo passam a desligar `runner.sandbox.display` e afirmam que a etapa sozinha pede a tela ao sandbox (e continua sem o navegador, que é do interruptor do agente).

### A semente deixa de escrever nomes reais

- `scripts/seed-docs-workspace.mjs` — o workspace semeado tem `vcs: []` e `projects.issues.vcsId: null`, então o app resolve os seus próprios textos de host pelo vocabulário neutro ("provedor de código" / "the code host") em vez do nome de uma empresa; o repositório semeado passa a `docs` e o prefixo das referências a `docs#`; os cartões do quadro (que são o `iid` que as telas escrevem como `#<id>`) usam o placeholder neutro `docs#123`, `#124` e `#125`; a chave de um procedimento aprendido passa de um host real para `example.com`.
- O mesmo script passa a escrever a cerimónia do dia em `historico/`, o `falas.json` vazio, e a pasta `phone-data/` (registry, `web.json` no formato do app e a sessão de um celular pareado com um token escrito só no hash).
- `test/seed-docs-workspace.test.ts` — os números das atividades passam a `123/124/125` e um caso novo afirma que a configuração não traz integração nenhuma e que os cartões apontam para um host de tipo fictício.

### As capturas

- `scripts/captures/actions.mjs` — chega à fila pelo endereço da própria tela (`#acoes`) e espera pelo cabeçalho dela; o rótulo da navegação, que nomeia várias entradas, levava a captura à tela de conflito de release.
- `scripts/captures/run.mjs` — a janela da captura esconde com uma folha de estilo o relógio da cerimónia e a linha de atividade de um turno que ninguém preparou; essa linha diz onde o modelo viria, e um repositório público não pode levar esse nome dentro de um PNG. A captura do celular passa a subir o app no modo web e a conduzir o companheiro num navegador a 390 px.
- `scripts/captures/phone.mjs` — escrito de novo: abre `http://127.0.0.1:4330/cerimonias/` com a sessão pareada que a semente escreveu, em vez de reduzir a janela do app de secretária.

## O que foi verificado, com o comando

- `npx tsc --noEmit` — sai 0.
- `npx vitest run test/runner-stage-screen.test.ts` — 29 testes passam.
- `npx vitest run test/seed-docs-workspace.test.ts` — 9 testes passam.
- `npx vitest run test/captures-index.test.ts test/docs-images-check.test.ts` — 17 testes passam.
- `node scripts/seed-docs-workspace.mjs <pasta vazia>` — sai 0, escreve 17 ficheiros; a segunda execução sobre a mesma pasta continua recusada.
- `node scripts/public-audit.mjs --root <pasta semeada>` — sai 0, "16 files, nothing that belongs to a company or a person".
- `npx electron-vite build` — sai 0.
- `node scripts/captures/run.mjs --only actions --lang pt-BR` — sai 0 e escreve `docs/images/actions.png`; a imagem foi aberta e mostra a fila de ações ("Ações de release", "1 ação de release aguardando o seu 'seguir'", o botão "Atualizar do provedor de código" e a execução `docs#124`).

## O que não foi verificado

- A captura de `call`: as corridas de `node scripts/captures/run.mjs --only call` terminam sem escrever `docs/images/call.png`, que continua a ser a imagem antiga — a cerimónia falhada, com o nome do provedor do modelo e as referências antigas. A tela da cerimónia abre no workspace semeado (conferido abrindo a janela à mão), mas a escrita da imagem não foi obtida nesta tentativa.
- A captura de `today`, `wizard` e `phone` com a semente nova: as imagens dessas telas continuam as antigas, e por isso continuam com os nomes reais que a revisão achou.
- Os gates `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` (sobre a árvore) e `node scripts/docs-images-check.mjs` não foram corridos nesta tentativa.
- As aceitações 1 (a app abrir o workspace semeado sem aviso de migração) e 6 (um release refazer as imagens e o pull request mostrar só o que mudou) seguem sem verificação.
