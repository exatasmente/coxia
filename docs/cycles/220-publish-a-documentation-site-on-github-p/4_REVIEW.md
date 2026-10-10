# A checagem ainda não pega a página de referência que perdeu uma língua, e a mudança deixa a suíte e os tipos vermelhos

## Veredito

**Mudanças pedidas.** Dois bloqueantes.

O primeiro é o bloqueante da rodada 3, que continua não atendido: a checagem de línguas ainda não pega uma página de referência que perca uma língua. Ela deixou de pular a pasta `generated/`, mas **continua julgando as fontes geradas por si mesmas**, pelo nome e pelo link que cada uma carrega, e nunca lê o documento de `docs/` de que a página veio. Como um documento que perde a metade portuguesa é escrito pelo gerador como uma página de **uma língua só** (com a marca `site: one-language`), a checagem dispensa a página — e as duas situações bem diferentes, "documento bilíngue com uma metade a menos" e "documento realmente de uma língua só", ficam indistinguíveis. Conferido: removendo a metade `## Português` de `docs/memory.md` e construindo o site com o endereço de publicação, a construção sai 0, `reference/memory.html` existe e `reference/memory.pt-br.html` **não** existe, e `npm run docs:check` imprime que toda página carrega as duas línguas, saída 0. É exatamente a falha que o critério de aceitação 13 diz que a checagem existe para pegar.

O segundo é novo desta rodada e vem da tentativa de fechar o primeiro: a mudança deixa o repositório com **os tipos vermelhos** (`npx tsc --noEmit` sai 1) e com **2 dos 3 casos do teste novo vermelhos** (`npx vitest run` inteiro: 2 falham, 7674 passam). Os portões do repositório exigem o typecheck e a suíte verdes, e o próprio pedido desta passada listava os dois.

## Como esta revisão foi feita

Rodada 4. O que a passada anterior pediu como bloqueante era fechar o teste da página de referência que perde uma língua e rodar todos os portões e a construção com o endereço de publicação. Foi conferido primeiro se isso foi feito, e depois o efeito real da correção sobre a falha que ela deveria pegar. Lido: a checagem, o gerador das fontes, o caminho de linha de comando, a configuração do site e o teste novo. Executado nesta máquina, na árvore de trabalho e numa cópia descartável dela:

| O que se rodou | O que aconteceu |
|---|---|
| reproduzir a falha do critério 13: remover a metade `## Português` de `docs/memory.md`, `SITE_BASE=/cerimonias/ npm run docs:build`, `npm run docs:check` | construção sai 0, `reference/memory.html` existe, `reference/memory.pt-br.html` **não** existe, e a checagem imprime que toda página carrega as duas línguas — saída 0 |
| o mesmo caso, com o gerador e a checagem chamados sobre uma cópia do repositório | a página gerada de `memory` nasce marcada `site: one-language`, `generatedPages` pula a marca e a checagem devolve **zero** achados |
| controle: apagar à mão só o arquivo gerado `reference/memory.pt-br.md`, deixando a página inglesa bilíngue | a checagem **pega**: "`/reference/memory` has no no page is served at `/reference/memory.pt-br`", saída 1 |
| controle: injetar um link para uma página que o site não tem, sobre a construção publicada | a checagem **pega** e nomeia `reference/nowhere`, saída 1 |
| `npx vitest run test/site-reference-languages.test.ts` | 2 falham, 1 passa (3 casos) |
| `npx vitest run` | 1 arquivo falha, 456 passam, 1 pulado; 2 casos falham, 7674 passam, 3 pulados |
| `npx tsc --noEmit` | **sai 1**: `test/site-reference-languages.test.ts(42,62): error TS7006: Parameter 'path' implicitly has an 'any' type.` |
| `node scripts/theme-audit.mjs` | sai 0 |
| `npm run i18n:lint` | sai 0 |
| `node scripts/public-audit.mjs` | 1734 arquivos, nada, sai 0 |
| `SITE_BASE=/cerimonias/ npm run docs:build` e `npm run docs:check` | construção e checagem saem 0 sobre a árvore sem defeito |
| estado da árvore depois | nada de `site/generated/` nem `site/.vitepress/dist/` está versionado (ambos ignorados); `site/.vitepress/cache/` não existe |

O que não foi verificado: a publicação no host e o site no ar; o Pages ligado na configuração do repositório; uma mudança posterior em `docs/` ou no `CHANGELOG.md` atualizando o site na mesclagem; e o agente de documentação construindo o site com um modelo de verdade.

## Os bloqueantes

### 1. A checagem de línguas continua sem pegar a página de referência que perdeu uma língua

A checagem deixou de pular `generated/`, mas o que ela faz com as fontes geradas é julgá-las **por si mesmas**: `generatedPages` lê o nome do arquivo e o link de outra língua que a página carrega, e **nunca lê o documento de `docs/`** de que a página veio. Não há em `site/scripts/check.mjs` nenhuma leitura de `docs/` — as únicas fontes que o arquivo lê são as páginas sob a raiz que recebe.

O gerador escreve a marca `<!-- site: one-language -->` na página de um documento que o repositório escreve numa língua só (`site/.vitepress/build-sources.mjs:127`), e `generatedPages` pula toda página marcada (`site/scripts/check.mjs:188`). Acontece que **um documento bilíngue que perde a metade portuguesa passa a ser, para o gerador, um documento de uma língua só** — então ele também ganha a marca, e a checagem o dispensa. As duas situações que o critério manda distinguir ficam iguais.

Reproduzido nesta revisão: removendo a metade `## Português` de `docs/memory.md` e construindo com `SITE_BASE=/cerimonias/`, a construção sai 0, `reference/memory.html` existe e `reference/memory.pt-br.html` não existe, e `npm run docs:check` sai 0 dizendo que toda página carrega as duas línguas. O arquivo foi restaurado na cópia descartável; a árvore de trabalho não foi tocada.

O contraste prova o ponto: apagando à mão **só o arquivo gerado** `reference/memory.pt-br.md` (deixando a página inglesa ainda com o par), a checagem pega, saída 1; no caso real — o documento perdendo a língua — não pega. Ou seja, a correção cobre a forma que o teste monta, não a falha que o critério descreve.

**Correção sugerida:** a checagem precisa decidir pela **fonte de verdade**, não pela forma da página gerada: para cada documento de `docs/` que o repositório escreve em duas línguas, exigir que a página em português exista na construção. Quem sabe se um documento é bilíngue é o próprio gerador (`blocksOf`, `pageFor` em `site/scripts/docs-pages.mjs`), então `checkLanguages` deve ler `docs/` com a mesma regra e comparar com o que foi escrito — em vez de aceitar a marca `site: one-language` como prova de que a ausência de par é legítima. Sem isso, a marca e a ausência real ficam indistinguíveis, e o critério 13 continua não atendido.

### 2. O typecheck e a suíte ficam vermelhos

`npx tsc --noEmit` sai 1: `test/site-reference-languages.test.ts(42,62): error TS7006: Parameter 'path' implicitly has an 'any' type.` O callback `.find((path) => …)` sobre o retorno de `referencePages`, um módulo `.mjs` sem declaração de tipos, deixa o parâmetro implícito. O `CONTRIBUTING.md` do repositório lista o typecheck entre os portões, e o próprio pedido desta passada o mandava rodar; ele não passa.

E `npx vitest run` inteiro sai com **2 falhas**, ambas no arquivo novo: os dois casos que o pedido desta passada mandava fechar continuam vermelhos. O terceiro caso chega a fazer a asserção errada: a substituição monta o texto `[$1]` e afirma que a mensagem contém `$1`, o que a checagem nunca produz (o `$1` chega como o próprio literal do texto da página, não como endereço). Rodando o arquivo: 2 falham, 1 passa.

## Sugestões

### O caso do link no teste novo afirma uma mensagem que o código nunca imprime

`test/site-reference-languages.test.ts:63` afirma `missing: 'the link to the other language points at $1, not at /reference/runner.pt-br'`. A asserção nunca pode ser verdadeira: a substituição de `[Português](/reference/runner.pt-br "Português")` por `[$1]` deixa o rótulo `[$1]` como texto, e a mensagem real nomeia o endereço que o link de fato carrega. O caso precisa ser reescrito para o formato real da mensagem, como o próprio pedido desta passada indicava.

### O endereço da linha de status dos README não é conferido entre os dois arquivos

`test/readme-status.test.ts:31` aceita qualquer endereço externo (`/https:\/\/[a-z0-9.-]+\/[^\s)]+/`). Um endereço trocado ou velho mantém a suíte verde, enquanto a pessoa cai noutro lugar. Comparar o endereço dos dois README entre si diria o que o teste quer dizer. É sugestão desde a rodada 1; não bloqueia.

### A checagem de links não lê o que a página carrega

`linksOf` (`site/scripts/check.mjs:42`) lê os `href` e os links em Markdown, não os `src`. Nenhuma página carrega imagem hoje, então nada está errado; mas um endereço errado de imagem não seria pego quando o pedido das imagens chegar. É sugestão desde a rodada 3; não bloqueia.

### Nenhum link próprio liga as duas línguas nas páginas escritas à mão

A regra 3 pede que a página em inglês e a em português sejam alcançáveis uma da outra. Nas páginas de referência o gerador escreve esse link; nas escritas à mão (abertura, guia, casos de uso, blog) não há link entre as duas versões. O par existe e a navegação leva, mas quem chega à abertura em inglês só chega ao português pela URL. Sugestão desde rodadas anteriores; não bloqueia.

## Critérios de aceitação

| Critério | Onde se confere |
|---|---|
| A mudança traz o site, o fluxo e a checagem; os portões passam | **Não atendido nesta rodada**: `npx tsc --noEmit` sai 1 e a suíte tem 2 falhas (ver bloqueante 2) |
| O site constrói, os links resolvem e as duas línguas têm todas as páginas | **Não atendido**: a construção e a checagem saem 0 sobre a árvore sem defeito, mas a checagem de línguas não pega uma página de referência que perca uma língua (ver bloqueante 1) |
| Abertura, guia, referência, casos de uso, blog e histórico existem nas duas línguas | Atendido para existir: as páginas de referência saem como par quando o documento tem as duas línguas; as escritas à mão têm o par na pasta `pt-br/` |
| Cada documento da referência é alcançável do site | Atendido: a lista é a travessia de `docs/`, e cada documento ganha endereço pelo próprio caminho |
| A página do histórico segue o arquivo | Atendido: é montada na construção a partir do histórico, sem segunda cópia versionada |
| O blog abre com o texto da versão estável | Atendido: a versão estável mais recente é a que tem seção; as betas não viram texto |
| O site não usa imagem real nenhuma | Atendido: as páginas que pedem imagem mostram texto e espaço reservado |
| A publicação está declarada e o aplicativo não mexeu em configuração de repositório | Atendido: o fluxo de publicação está no repositório e nenhum arquivo escreve configuração no host |
| A linha de status dos dois README diz a versão atual e leva ao site | Atendido: os dois citam a versão do arquivo de versão e trazem o endereço publicado |
| O site responde no endereço dentro da execução do fluxo | Não verificado: depende do host, depois da mesclagem |
| O site publicado é conferido de dentro do aplicativo | Não verificado: depende do site no ar e da lista de hosts do agente |
| Uma mudança posterior atualiza o site na mesclagem | Não verificado: o caminho está construído, não foi exercitado |
| A checagem do site pega as duas falhas que ela existe para pegar | **Metade atendida**: pega um link quebrado (inclusive com o prefixo de publicação, conferido nesta rodada); **não pega** uma página de referência que perca uma língua (ver bloqueante 1) |
| O agente de documentação trabalha a pasta do site pelo ciclo normal | O agente tem sandbox e permissão de escrita, e um caso cobre as recusas de cerca de um agente que escreve; nenhum modelo real percorreu o fluxo |

## O que foi conferido por leitura, e o que não foi

Conferido por leitura e execução nesta revisão:

- A checagem de línguas já nomeia o par pela forma que o site escreve, e isso segue valendo para as páginas escritas à mão: uma página sem par é apontada com o caminho `pt-br/` ao lado, a metade portuguesa com o nome que ela espelha, e uma página gerada com o endereço `/reference/…`. Isso não foi reaberto nesta rodada.
- O controle do link quebrado continua pegando, e pega também com o prefixo de publicação: sobre a construção com `SITE_BASE=/cerimonias/`, um link injetado para `/cerimonias/reference/nowhere` reprova e nomeia `reference/nowhere`, saída 1.
- Nada gerado entrou no commit: `site/generated/` e `site/.vitepress/dist/` continuam ignorados e não versionados, e `site/.vitepress/cache/` não existe na árvore.
- Nenhum segredo, nome de empresa, de pessoa ou endereço privado entrou no diff: a auditoria pública rodou sobre a árvore inteira, com os arquivos do site na varredura, e não acusou nada.

Não conferido nesta revisão: a publicação no host, o site no ar, uma mudança posterior atualizando o site na mesclagem e um agente de documentação construindo o site com um modelo de verdade. Nada disso é verificável sem o host.
