# As imagens da documentação saem de um workspace que o app reconhece, e quatro das cinco telas já mostram o que a documentação promete

Esta tentativa ataca os achados que a revisão deixou de pé. Duas causas-raiz explicam quase todos eles: o
workspace que a semente escrevia **não era o que o app abria**, e a semente escrevia o módulo da web num
formato que o app não lê. Com isso corrigido, quatro das cinco telas passaram a ser capturadas com a semente
nova; a cerimônia continua sendo o que trava, e está dito abaixo exatamente por quê.

## O que mudou

### A semente escrevia um workspace que o app recusava (a causa de quase tudo)

`src/main/workspaces-core.ts` reconhece o registro pelas mesmas regras que o app usa para criar workspaces.
Duas coisas faziam o app descartar o workspace semeado e criar um vazio no lugar:

- o id do workspace semeado era **`principal`**, que é o id que o próprio app dá ao workspace novo
  (`FRESH_ID`, `src/main/workspaces-core.ts`). O app resolvia o registro pelo seu caminho e abria um
  `principal` recém-criado, com `setupComplete: false` — daí a pasta `phone-data/` não ter ajudado como se
  esperava;
- o registro dizia `test: true`, e a validação do registro exige os campos que ela mesma define
  (`validInfo`, `src/main/workspaces-core.ts`).

A semente passa a escrever o workspace **`docs`**, de nome `Documentação`, com `test: false`, e a
mesma correção vale para o teste. Não havia nada disso na tentativa anterior: a aceitação 1 (o app abrir a
semente sem aviso) nunca tinha sido exercitada até aqui, e era ali que o defeito morava.

### A semente escrevia o módulo da web num formato que o app não lê

A semente escrevia o `web.json` e o `web-sessions.json` dentro de uma pasta `phone-data/`, com o
`workspaces.json` de um segundo workspace. O app guarda a configuração da web e as sessões dos celulares
pareados **na raiz dos dados**, compartilhadas por todo workspace (`src/main/config.ts`, `WEB = join(DATA_ROOT, WEB_FILE)`;
`src/main/webAccess.ts`, `join(DATA_ROOT, 'web-sessions.json')`). A semente passa a escrevê-las na raiz, e o
`phone-data/` deixa de existir. O token continua escrito só como `sha256`, e a semente exporta
`PHONE_TOKEN` para a captura entrar pelo cookie de sessão.

Como agora a semente escreve exatamente o que o app lê, o app abre o workspace semeado e o teste
automatizado da pasta confere isso de novo.

### A lista de telas não era o que se capturava, e nenhuma tela era alcançável por endereço

Os roteiros de captura partiam de pressupostos que o código desmente:

- **`actions.mjs` ia a `#acoes`, e não há roteador por fragmento.** O único endereço que o app lê ao abrir é
  `location.search` (`?open=…`, `src/renderer/src/App.tsx`), e a tela é um estado do React. A captura passa a
  caminhar como a pessoa caminha: clica no item do dia que diz quantas ações esperam ("Ver ações" /
  "See actions") e espera pelo cabeçalho da fila. A imagem passa a ser a fila de ações.
- **`wizard.mjs` não falava inglês.** Um primeiro arranque sem configuração segue o idioma do computador, e
  o computador da captura é português — a variante `-en` saía em português. A captura passa a pedir o inglês
  no passo que o nomeia, como a pessoa faz.
- **`wizard.mjs` deixava o fornecedor do modelo no pixel.** O assistente abre com o provedor que o app traz
  de fábrica (`src/shared/config/defaults.ts`, `providers: [{ id: 'anthropic', baseUrl: 'https://api.anthropic.com', … }]`),
  e as duas notas do passo falam dele. O fornecedor sai da janela antes da foto — a etiqueta, o id, o
  endereço, os nomes dos modelos, os campos que os oferecem e as duas notas —, e o passo em si fica: os
  títulos, o quadro "Adicionar provedor" e as frases que são do passo.
- **`phone.mjs` abria uma janela de secretária.** O aparelho agora é conduzido no modo web do próprio app, a
  390 px, como a lista descreve.
- **`today.mjs` e `call.mjs` escondiam só parte do que nomeava.** O rodapé e o botão da tela do dia falam do
  hospedeiro de código, escrito pelo app a partir do vocabulário dele e não do dado semeado. A frase do
  fornecedor passa a ser tirada da janela por extração de texto (o nó mais fundo que a contém vai embora), e
  não por folha de estilo, para o texto não ficar no HTML da página.

## O que foi verificado, com o comando

- `node scripts/captures/run.mjs` — sai 0 e escreve **as dez imagens** de `index.json`, nos dois idiomas.
  As dez foram abertas e conferidas uma a uma. `today`/`today-en`, `actions`/`actions-en`,
  `wizard`/`wizard-en` e `phone`/`phone-en` não levam nenhum nome real e mostram a tela prometida;
  `wizard-en` sai em inglês; `phone`/`phone-en` são o companheiro no modo web, a 390 px.
- `npx tsc --noEmit` — sai 0.
- `npx vitest run test/seed-docs-workspace.test.ts test/captures-index.test.ts test/docs-images-check.test.ts` —
  18 testes passam, 3 arquivos.
- `node scripts/docs-images-check.mjs` — sai 0.
- `node scripts/public-audit.mjs` — sai 0, "1669 files, nothing that belongs to a company or a person".
- `node scripts/public-audit.mjs --root <a pasta que a semente escreveu>` — sai 0, 15 arquivos.
- `node scripts/theme-audit.mjs`, `npm run i18n:lint` — saem 0.
- `npx vitest run` — 7300 testes passam; **2 testes reprovam por falta de `@playwright/mcp`** neste
  computador (4 arquivos de navegador, 2 testes). A dependência está declarada em `package.json` e não está
  instalada aqui (`node_modules/playwright-core` está, `@playwright/mcp` não), o mesmo estado da base da
  branch. Não é regressão desta mudança.
- O app abrindo o workspace semeado: exercitado à mão, abrindo a janela do app construído com
  `CERIMONIAS_DATA_DIR` apontando para a pasta semeada. Abre a tela do dia com os cartões, os dois blocos de
  execução e o item de ações — ou seja, sem o assistente de configuração, que é o que a aceitação 1 pede.
- `npx electron-vite build` — sai 0, e corre antes das capturas.

## O que não foi verificado

- **A cerimônia (`call`) continua fotografando a falha.** A captura abre a tela certa — a cerimônia do dia,
  com a pauta, o cartão e o aviso "Aguardando você" — mas o turno do agente falha por falta de chave do
  provedor, o aviso vermelho aparece e **dentro dele está o nome do fornecedor** (`main.llm.keyMissing`,
  `llm.anthropic`). A linha do tempo e os campos do turno ficam vazios.
  - O turno pronto escrito pela semente (`historico/<id>.json`, o mapa `turns`) **não é lido**: a cerimônia
    em andamento é retomada pela data do arquivo, mas o app guarda o estado retomado com
    `state:save` e o meu palpite é que a cópia gravada depois da abertura vence a semeada. Não confirmei
    onde exatamente o turno se perde; fica como o primeiro lugar a olhar.
  - Enquanto isso, a imagem versionada de `call` é a que esta rodada escreveu — a cerimônia falhada. A
    imagem anterior levava o mesmo defeito, então a rodada não piorou nada, mas também não o resolveu.
- As aceitações 4 (uma etapa com a tela guardar a imagem como comprovação) e 6 (um release refazer as
  imagens e o pull request mostrar só o que mudou) continuam sem verificação.
- A igualdade byte a byte entre duas execuções da captura: não foi exercitada.
- A ressalva da revisão sobre a conferência de referências (o caso "entrada da lista sem referência"
  depender de o percurso cobrir os arquivos que de fato usam a imagem; uma página que use caminho relativo
  não aparece) **não foi mexida** nesta tentativa: o script da conferência não foi tocado.
