# A correção do bloqueante da rodada anterior chegou; sobra uma falha que a checagem de línguas não alcança

## Veredito

**Mudanças pedidas.** Um bloqueante: a checagem de línguas nunca olha as páginas de referência. Elas são geradas dentro de `site/generated/`, pasta que `checkLanguages` pula, então nenhuma página construída a partir de `docs/` é conferida — e um documento bilíngue que perca a metade portuguesa constrói sem erro e passa na checagem, que é a falha que o critério de aceitação 13 diz que ela existe para pegar. O bloqueante da rodada 2 — a checagem nomear um par que o site não escreve — está corrigido e foi conferido: os três casos vermelhos ficaram verdes, a mensagem aponta a forma que o site escreve, e a suíte inteira passa. Os portões rodados nesta revisão passam: tipos, auditoria de tema, lint de idiomas, auditoria pública e, sobre a construção com o endereço de publicação, a construção e a checagem (0).

## Como esta revisão foi feita

Rodada 3. As duas rodadas anteriores pediram bloqueantes; aqui confiro primeiro se o bloqueante da rodada 2 foi atendido, e depois o que a regra nova deixou de fora. Lido: a checagem, a geração das páginas, os testes do site, o fluxo de publicação e a mudança do agente de documentação. Executado nesta máquina, na árvore de trabalho:

| O que se rodou | O que aconteceu |
|---|---|
| `npx vitest run test/site-check.test.ts test/site-docs-pages.test.ts test/site-changelog.test.ts test/readme-status.test.ts` | 4 arquivos, 38 casos, todos verdes |
| `npx vitest run` | 456 arquivos passam, 1 pulado; 7673 casos passam, 3 pulados, 0 falham |
| `npx tsc --noEmit` | sai 0 |
| `node scripts/theme-audit.mjs` | sai 0 |
| `npm run i18n:lint` | sai 0 |
| `node scripts/public-audit.mjs` | 1733 arquivos, nada, sai 0 |
| `SITE_BASE=/cerimonias/ npm run docs:build` e `npm run docs:check` | a construção passa e a checagem diz que todo link resolve e toda página carrega as duas línguas, saída 0 |
| a checagem de links sobre essa construção com um link para uma página que não existe | reprova e nomeia `reference/nowhere.html`, lendo o prefixo da própria construção |
| a checagem de línguas sobre as fontes reais do site, e sobre uma cópia com a metade `guide/pt-br/index.md` removida | antes: nada faltando; depois: aponta `guide/index.md` sem `guide/pt-br/index.md` — a forma que o site escreve |
| a geração de páginas de `docs/` para cada documento | 14 documentos; 11 pares (pt-BR), 3 de uma língua só (en): `i18n.md`, `images/README.md`, `voice.md`; `verify-commands.md` agora é par, pela forma de um título por metade |
| remover a metade `## Português` de `docs/memory.md` e reconstruir | a construção sai 0, `reference/memory.html` existe e `reference/memory.pt-br.html` **não** existe; `docs:check` informa que toda página carrega as duas línguas, saída 0 — **o defeito bloqueante**; o arquivo foi restaurado em seguida, sem diferença |

O que não foi verificado: a publicação no host e o site no ar; o Pages ligado na configuração do repositório; uma mudança posterior em `docs/` ou no `CHANGELOG.md` atualizando o site na mesclagem; e o agente de documentação construindo o site com um modelo de verdade.

## O bloqueante

### As páginas de referência não passam pela checagem de línguas

A checagem de línguas anda por `site/` e pula a pasta `generated` (`site/scripts/check.mjs:127`: `if (name !== 'scripts' && name !== 'public' && name !== 'generated') walk(full)`). Todas as páginas que o site constrói a partir de `docs/` — a seção de referência inteira — são escritas justamente dentro de `site/generated/`, e por isso **nenhuma delas é conferida**. A checagem só enxerga as páginas escritas à mão em `site/**/*.md`.

Consequência, verificada nesta revisão: removendo a metade portuguesa de um documento bilíngue de referência (`docs/memory.md`), a construção passa e escreve `reference/memory.html` sem `reference/memory.pt-br.html`, e `docs:check` sai 0 dizendo que toda página carrega as duas línguas. É exatamente a falha que a regra 10 da spec e o critério de aceitação 13 dizem que a checagem deve pegar: "uma página que existe só numa das línguas reprova a checagem do site". Hoje ela reprova isso só para as páginas escritas à mão; para a referência — a maioria das páginas do site — não reprova nada.

O fato é desta rodada: a mudança desta rodada passou a decidir, por documento, se ele vira uma página só ou um par (`single`), e a entrega afirma que a checagem de línguas vê as duas páginas geradas. Não vê: a pasta onde elas nascem está fora do alcance da checagem. O defeito estava latente porque os documentos de `docs/` hoje têm as duas línguas que declaram; ele aparece no primeiro documento que perder uma metade — uma edição normal pelo ciclo, que a checagem deveria barrar.

**Correção sugerida:** a checagem precisa olhar o que a construção escreveu, não só as fontes escritas à mão. A forma mais direta é conferir as páginas geradas pelo que o próprio gerador decidiu: para cada documento de `docs/` que o gerador marcou como par, exigir que a página em português exista na construção (ou que a fonte gerada `.pt-br` tenha sido escrita). O marcador `<!-- site: one-language -->` já vai nas páginas geradas de um documento de uma língua só (`site/.vitepress/build-sources.mjs:119`) e é o que diz que a ausência de par ali é legítima; hoje esse marcador nunca é lido para a referência. Uma leitura de `docs/` por `checkLanguages`, com a mesma regra de par de `docs-pages.mjs`, fecharia o buraco sem uma segunda lista.

## Sugestões

### A checagem de links não lê o que a página carrega

`linksOf` (`site/scripts/check.mjs:42`) lê os `href` e os links em Markdown, não os `src`. Nenhuma página carrega imagem hoje, então nada está errado; mas a checagem de ativos (`checkAssets`, agora ligada em `checkSite`) cobre os arquivos sob `/assets/`, não uma imagem de conteúdo que uma página venha a referenciar. Quando o pedido das imagens chegar, um endereço errado de imagem não seria pego.

### O endereço da linha de status dos README não é conferido entre os dois arquivos

`test/readme-status.test.ts:31` aceita qualquer endereço externo (`/https:\/\/[a-z0-9.-]+\/[^\s)]+/`). Um endereço trocado ou velho mantém a suíte verde, enquanto a pessoa cai noutro lugar. Comparar o endereço dos dois README entre si (o português é o mesmo com o segmento de língua) diria o que o teste quer dizer. É a mesma sugestão da rodada 1, ainda não atendida e não bloqueante.

### Nenhum link próprio liga as duas línguas nas páginas escritas à mão

A regra 3 pede que a página em inglês e a em português sejam alcançáveis uma da outra. Nas páginas de referência o gerador escreve esse link; nas escritas à mão (abertura, guia, casos de uso, blog) não há link nenhum entre as duas versões, e a navegação não troca de endereço entre as línguas. O par existe e a checagem o aceita pela pasta, mas quem chega à abertura em inglês só chega ao português pela URL. É sugestão, como nas rodadas anteriores, e não foi reaberta como bloqueante.

## Critérios de aceitação

| Critério | Onde se confere |
|---|---|
| A mudança traz o site, o fluxo e a checagem; os portões passam | Atendido: o site, o fluxo e a checagem estão na árvore, e tipos, tema, idiomas, auditoria pública e a suíte inteira (7673 casos, 0 falham) passam aqui |
| O site constrói, os links resolvem e as duas línguas têm todas as páginas | Atendido na construção publicada (com o endereço de publicação, construção e checagem saem 0). **Não atendido para as páginas de referência**: a checagem de línguas não as inspeciona (ver o bloqueante) |
| Abertura, guia, referência, casos de uso, blog e histórico existem nas duas línguas | Atendido para existir: as 14 páginas de referência saem como par quando o documento tem as duas línguas; as escritas à mão têm o par na pasta `pt-br/` |
| Cada documento da referência é alcançável do site | Atendido: a lista é a travessia de `docs/`, e cada documento ganha endereço pelo próprio caminho |
| A página do histórico segue o arquivo | Atendido: é montada na construção a partir do histórico, sem segunda cópia versionada |
| O blog abre com o texto da versão estável | Atendido: a versão estável mais recente é a que tem seção; as betas não viram texto |
| O site não usa imagem real nenhuma | Atendido: as páginas que pedem imagem mostram texto e espaço reservado |
| A publicação está declarada e o aplicativo não mexeu em configuração de repositório | Atendido: o fluxo de publicação está no repositório e nenhum arquivo escreve configuração no host |
| A linha de status dos dois README diz a versão atual e leva ao site | Atendido: os dois citam a versão do arquivo de versão e trazem o endereço publicado |
| O site responde no endereço dentro da execução do fluxo | Não verificado: depende do host, depois da mesclagem |
| O site publicado é conferido de dentro do aplicativo | Não verificado: depende do site no ar e da lista de hosts do agente |
| Uma mudança posterior atualiza o site na mesclagem | Não verificado: o caminho está construído, não foi exercitado |
| A checagem do site pega as duas falhas que ela existe para pegar | Parcialmente: pega um link quebrado (inclusive com o prefixo de publicação) e uma página escrita à mão sem par; **não pega** uma página de referência que perca uma língua (ver o bloqueante) |
| O agente de documentação trabalha a pasta do site pelo ciclo normal | O agente tem sandbox e permissão de escrita, e um caso cobre as recusas de cerca de um agente que escreve; nenhum modelo real percorreu o fluxo |

## O que foi conferido por leitura, e o que não foi

Conferido por leitura e execução nesta revisão:

- A mensagem de falha da checagem de línguas nomeia a forma que o site escreve, não um nome novo: uma página escrita à mão sem par é apontada com o caminho `pt-br/` ao lado (`use-cases/pt-br/team.md`), a metade portuguesa com o nome que ela espelha (`use-cases/index.md`), e uma página gerada com o endereço `/reference/…` mais a marca `.pt-br`. Um link que desenha um par que não é o da página reprova; uma página cujo par existe ao lado e não escreve link passa.
- Um documento escrito só em português, com o inglês sob um segundo título, vira duas páginas, cada uma com o título da sua língua; um documento de uma língua só continua uma página só.
- Nenhum segredo, nome de empresa, de pessoa ou endereço privado entrou no diff: a auditoria pública rodou sobre a árvore inteira, com os arquivos do site na varredura, e não acusou nada. O endereço publicado do próprio projeto aparece só nas duas linhas de status dos README, e é a decisão que a spec tomou (a linha leva ao site).
- Nada gerado entrou no commit: `site/generated/`, `site/.vitepress/dist/` e `site/.vitepress/cache/` estão ignorados, e os arquivos gerados não são versionados.
- A cerca de escrita do agente de documentação não mudou: só a capacidade de rodar comandos na sandbox foi acrescentada; onde a máquina não tem sandbox, o modelo baixa para o que o agente podia antes.
- O texto do corpo de um documento passa por um escape de tags na geração, então um `<script>` num documento vira texto.

Não conferido nesta revisão: a publicação no host, o site no ar, uma mudança posterior atualizando o site na mesclagem e um agente de documentação construindo o site com um modelo de verdade. Nada disso é verificável sem o host.
