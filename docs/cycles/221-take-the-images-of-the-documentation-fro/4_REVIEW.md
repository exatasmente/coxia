# As imagens entregues continuam a não mostrar o que a documentação diz, e ainda levam nomes reais para o repositório público

A revisão conferiu, antes de tudo, os achados bloqueantes da rodada anterior. Metade
deles foi tratada: o campo de tela por etapa passou a valer sozinho. A outra metade não
andou: as dez imagens de `docs/images/` são os mesmos arquivos lidos na rodada
anterior, e continuam a mostrar outra tela e a levar nomes reais dentro do pixel para
um repositório público.

## O veredito

**Mudanças pedidas.** Quatro achados bloqueantes da rodada anterior seguem de pé
(imagens com nomes reais; imagens que não são a tela prometida; o texto de
`docs/images/README.md` a descrever uma lista que não existe; a captura da cerimônia
que fotografa a falha), confirmados nesta rodada com cada arquivo aberto. A estes
soma-se um achado novo, introduzido por esta rodada: a pasta do perfil do navegador que
a captura do celular cria dentro de `docs/images/`.

## O que a rodada anterior pediu, e o que se apurou

### O campo de tela por etapa — tratado

A sandbox decide a tela por `opts.display === true && (opts.stageDisplay === true ||
opts.config.display === true)` (`src/main/sandbox/index.ts:273`, e o mesmo no caminho
do computador, `:305`); o executor passa `stageDisplay` nas duas aberturas
(`src/main/runner/executor.ts:453-454`), resolvido uma vez por etapa (`:377`). Os dois
casos de `test/runner-stage-screen.test.ts` passam a desligar
`runner.sandbox.display` (`test/runner-stage-screen.test.ts:270,295`). O caminho da
etapa de QA e as guardas do projeto continuam iguais: o Xvfb é sempre o da etapa, em
socket e sem TCP (`src/main/sandbox/display.ts:21`; `src/main/sandbox/policy.ts:136-142`),
e o caminho do computador nunca usa a tela da pessoa. O modelo do fluxo foi respeitado:
`release-images` é `type: 'work'` com agente próprio, `display: true`, antes da espera
`release-approved` (`src/shared/cycles/templates/releaseFlow.ts:23-25`), o comentário
tem duas seções (`:95`), as chaves novas estão nos dois catálogos, e as duas descrições
do fluxo em `docs/runner.md` falam da etapa nova.

### A semente neutra — tratada, e não é o suficiente

O workspace semeado deixou de configurar integração alguma (`vcs: []`,
`projects.issues.vcsId: null`) e os cartões passaram a `123/124/125` com o prefixo
`docs#`, o que as telas passam a mostrar quando a imagem é refeita. Mas isso só governa
o que vem do dado: as telas desenham nomes que não vêm dele.

### As imagens — não andou

Os dez arquivos de `docs/images/` estão com a data de gravação da rodada anterior; só
`actions.png` foi reescrito depois disso. O que está versionado hoje continua sendo o
que a rodada anterior leu.

## Achados bloqueantes

### 1. As imagens levam nomes reais para dentro de um repositório público

A auditoria pública confere binário só pelo caminho e nunca pelos pixels
(`scripts/public-audit.mjs:109-111`, `isBinary(buf)` continua), então ela passa com
esses nomes dentro dos PNGs. Lidas nesta rodada:

- `docs/images/wizard.png` mostra, no bloco de provedores, o nome do fornecedor do
  modelo, o nome do produto dele e o endereço da API dele, e ainda as opções do
  seletor de modelo. Nada disso vem da semente: é o provedor que o próprio assistente
  de configuração do aplicativo traz, e a captura o abre com uma pasta de dados vazia.
- `docs/images/today.png` mostra o botão “Atualizar do GitHub” e a linha de rodapé
  “Cada agente é montado a cada cerimônia a partir do cartão do GitHub”, e a referência
  `app#102`.
- `docs/images/actions.png` mostra as mesmas duas frases com o nome do host e a
  referência `app#102`.
- `docs/images/call.png` mostra o nome do fornecedor do modelo dentro do aviso de erro
  do agente (`llm.anthropic`) e a referência `#c103token`.
- `docs/images/phone.png` mostra o botão “Atualizar do GitHub” e `app#102`.

Os dois READMEs exibem essas imagens, então elas vão para a documentação pública assim
que a branch for integrada.

### 2. Quatro das cinco telas continuam a não ser o que a documentação promete

A `index.json`, os dois READMEs e `docs/images/README.md` dizem o que cada imagem
mostra. Lidas uma a uma nesta rodada:

- **`actions.png` não é a fila de ações.** É a tela de conflito de release (“Conflito na
  #102 ao sincronizar com a main”, com “Seguir” e “Ver o comentário”). O roteiro que a
  captura descreve (`#acoes`, cabeçalho “Ações de release”, “Aguardando você”) não é o
  que a imagem mostra.
- **`call.png` não é “uma cerimônia em andamento”.** É a cerimônia em estado de falha:
  um aviso vermelho diz que o agente falhou porque a chave do provedor não está
  configurada, e os campos do turno estão vazios.
- **`phone.png` não é o companheiro no celular.** É a janela de secretária reduzida a
  390 px, com a barra de navegação de baixo e os mesmos textos e referências da tela
  Hoje.
- **`wizard.png`** mostra o assistente de configuração, mas com o achado 1 dentro.

### 3. O texto de `docs/images/README.md` descreve uma lista que não existe

O parágrafo de `docs/images/README.md:26-28` diz que “uma captura que a lista conhece e
a pasta não tem continua listada como pendente, para a lista e a pasta nunca divergirem
em silêncio”. A tabela de pendências não existe no arquivo desde que as imagens
entraram: a tabela que está lá agora (`:18-24`) lista as imagens reais, sem coluna de
estado e sem dizer que coisa alguma está pendente. Quem lê a página fica com a
impressão de que uma pendência é acompanhada em algum lugar, e não é.

### 4. A captura da cerimônia fotografa a falha que ela devia evitar

O próprio roteiro da captura diz que a linha de atividade da tela é escondida “porque
nomeia o provedor do modelo” (`scripts/captures/call.mjs:15-19`), que ela esconde o
relógio do turno (`:17-19`) e que prende o relógio da página (`:21`). Nada disso
corresponde à imagem entregue, e uma falha mais abaixo — o aviso vermelho com o nome do
fornecedor do modelo, que diz que o agente falhou por falta de chave — não é coberta
por nenhuma dessas regras.

Repeti, nesta rodada, o comando que o relato da implementação diz que não escrevia a
imagem, sobre um workspace semeado na hora, e ele **escreveu**. A imagem nova mostra a
cerimônia com o aviso de falha do agente (“O agente da #125 falhou: Chave de provedor
não configurada”), os campos do turno vazios e, na coluna da direita, o rodapé com o
nome do produto do fornecedor do modelo. Ou seja: a captura corre, mas fotografa o
o posto do que a documentação promete (“uma cerimônia em andamento, por voz ou texto,
com as fontes do agente”), e a única coisa que impede hoje o nome real de entrar no
arquivo versionado é o arquivo versionado ainda ser o antigo.

### 5. A captura do celular deixa a pasta do perfil do navegador dentro de `docs/images/`

A captura do celular sobe um navegador com o perfil em `docs/images/.phone-profile`
(`scripts/captures/phone.mjs:12`), e o bloco `finally` só apaga a pasta temporária da
semente, nunca o perfil (`scripts/captures/run.mjs:118-121`). O `.gitignore` não cobre
nada disso, e a conferência de referências só enxerga arquivos terminados em `.png`
(`scripts/docs-images-check.mjs:55`), então nem ela nem o estado da árvore avisam: um
`git add` depois de uma captura leva o perfil do navegador para dentro do repositório
público. A pasta não existe nesta árvore porque nenhuma captura de celular correu aqui.

## O que segue sem verificação

- O aplicativo abrindo o workspace semeado sem aviso de migração (aceitação 1): não foi
  exercitado nesta revisão.
- Uma etapa com o campo ligado guardar cada imagem como comprovação e conseguir olhá-la
  (aceitação 4): o runtime está fechado e testado, mas a comprovação em si não foi vista.
- Um release refazendo as imagens e o pull request mostrando só o que mudou (aceitação
  6): não foi exercitado.
- As imagens em `en`: não foram abertas nesta rodada.
- Duas execuções escreverem os mesmos arquivos byte a byte (aceitação 3): não foi
  exercitado.

## O que a revisão fez

Leu o plano, a spec e as notas da implementação; leu o diff da branch contra a base, com
atenção ao que mudou depois da rodada anterior (`src/main/sandbox/index.ts`,
`src/main/runner/executor.ts`, `scripts/seed-docs-workspace.mjs`, `scripts/captures/*.mjs`,
`test/runner-stage-screen.test.ts`); abriu as cinco imagens versionadas de `docs/images/`
uma a uma; rodou `npx tsc --noEmit`, `node scripts/theme-audit.mjs`,
`npm run i18n:lint`, `node scripts/public-audit.mjs` (1669 arquivos) e
`node scripts/docs-images-check.mjs`, todos com saída 0; rodou `npx vitest run` (435
arquivos e 7299 testes passam; 2 testes de navegador real falham por faltar
`@playwright/mcp` neste computador, dependência que também falta na base da branch); e
repetiu a captura da cerimônia sobre uma semente nova, que escreveu a imagem — a nova
mostra a cerimônia falhada. A imagem gerada foi descartada e a versionada ficou
intacta.

## O que fica como sugestão

- O caso “entrada da lista sem referência” da conferência depende do percurso dos
documentos cobrir os arquivos que de fato usam a imagem: o registro de referências só
reconhece o caminho literal `docs/images/...` dentro de um texto
(`scripts/docs-images-check.mjs:40`), então uma página que use um caminho relativo
(`images/today.png`) não aparece; é por isso que as variantes `-en`, que nenhuma página
referencia, não reprovam nada.
- `entryReferenced` materializa um vetor do conjunto a cada chamada
  (`scripts/docs-images-check.mjs:63`) e a cadeia de `listed` carrega um termo que o
  primeiro já decide (`:74`); com dez imagens, é custo que não se mede.
- `stageDisplayOf` é chamado até três vezes por etapa e resolve a lista viva do fluxo a
  cada chamada (`src/main/runner/executor.ts:191`, `:622`, `:664`); é o mesmo padrão do
  `stagePoolModeOf` ao lado.
- A expressão do veredito de tela está escrita duas vezes, palavra por palavra
  (`src/main/sandbox/index.ts:273` e `:305`), e a condição da oferta de passagem
  (`src/main/runner/executor.ts:622`) repete as mesmas alternativas da linha `:451`; um
  predicado com nome serviria aos dois.
- O `walk` da conferência lê o diretório uma vez por entrada
  (`scripts/docs-images-check.mjs:26`), e cada um dos quatro percursos varre a mesma
  lista.
- `scripts/seed-docs-workspace.mjs:27` diz que o dia fixo é um sábado, e a data
  (`2026-06-15`) é uma segunda-feira.
- O roteiro da captura de `call` carrega dois `addStyleTag` e um `page.clock.pauseAt`
  (`scripts/captures/call.mjs:16-21`) que a folha de estilo central (`run.mjs:47`)
  cobre em parte; são três donos da mesma regra.
- A conferência deriva os ids válidos só de `scripts/captures/index.json`, e
  `docs/images/README.md` repete os mesmos nomes de arquivo à mão: são duas fontes da
  mesma lista, sem nada que as compare.
