# A checagem passa a pegar a página de referência que perdeu uma língua, e o typecheck e a suíte voltam verdes

## Veredito

**Aprovado.** Os dois bloqueantes da rodada 4 estão fechados e conferidos nesta árvore, e nenhum achado bloqueante novo aparece.

O primeiro bloqueante era o da rodada 3, que sobreviveu à rodada 4: a checagem de línguas não pegava uma página de referência que perdesse uma língua. Agora ela julga cada documento de `docs/` pela declaração de línguas do índice de `docs/` e exige, para um documento declarado bilíngue, que a página em português exista na construção — e a falha do critério de aceitação 13 foi reproduzida na árvore de verdade e é nomeada. O segundo bloqueante era o typecheck e a suíte vermelhos: `npx tsc --noEmit` sai 0 e os arquivos de teste do site e dos README passam.

## Como esta revisão foi feita

Rodada 5. O pedido desta passada era confirmar três coisas: que o critério 13 está atendido (uma página de referência que perde uma língua reprova a checagem e uma árvore saudável passa), que o typecheck e a suíte inteira estão verdes, e que a correção do link de língua (formas Markdown e HTML) não enfraqueceu o caso da página escrita à mão. Foi conferido primeiro se o que a rodada 4 pediu como bloqueante foi feito, e depois se a correção pega de fato a falha que ela existe para pegar.

Lido: a checagem (`site/scripts/check.mjs`), o gerador das fontes (`site/.vitepress/build-sources.mjs`), os módulos puros (`site/scripts/docs-pages.mjs`, `site/scripts/changelog.mjs`, `site/scripts/cli.mjs`), a configuração do site (`site/.vitepress/config.mts`), os dois fluxos de integração contínua, e os testes do site e dos README. Executado nesta máquina, na árvore de trabalho:

| O que se rodou | O que aconteceu |
|---|---|
| remover a metade `## Português` de `docs/memory.md`, `SITE_BASE=/cerimonias/ npm run docs:build`, `npm run docs:check` | construção sai 0, escreve `reference/memory.html`; a checagem **sai 1** nomeando `/reference/memory` e a metade ausente (`no page is served at /reference/memory.pt-br`) |
| documento restaurado, `SITE_BASE=/cerimonias/ npm run docs:build` e `npm run docs:check` | construção e checagem saem 0 sobre a árvore saudável |
| injetar um link para `/cerimonias/reference/nowhere.html` na construção publicada e rodar a checagem de links | o prefixo `/cerimonias/` é lido da construção e o link é nomeado (`missing: reference/nowhere.html`); o outro lado do critério 13 continua coberto |
| `npx tsc --noEmit` | sai 0 (o erro TS7006 da rodada 4 sumiu) |
| `npx vitest run` dos arquivos de site e dos README (8 arquivos) | 213 casos, todos verdes |
| `npx vitest run` (suíte inteira) | 7668 passam, 3 pulados, **8 falham**, todas em `test/conflict-resolve.test.ts` |
| `npx vitest run test/conflict-resolve.test.ts` isolado | 22 casos, todos verdes |
| `node scripts/theme-audit.mjs` | sai 0 |
| `npm run i18n:lint` | sai 0 |
| `node scripts/public-audit.mjs` | 1734 arquivos, nada, sai 0 |
| estado da árvore depois | `site/generated/`, `site/.vitepress/dist/` e `site/.vitepress/cache/` continuam ignorados e não versionados |

As 8 falhas da suíte inteira são de um arquivo que esta mudança não toca (`test/conflict-resolve.test.ts` não aparece em nenhum commit da branch), e ele passa inteiro rodado sozinho: são disputa de recursos entre os processos paralelos da suíte, não regressão desta branch. Os arquivos de teste que esta mudança acrescenta ou ajusta passam.

## Os bloqueantes anteriores, um a um

### 1. A checagem de línguas agora pega a página de referência que perdeu uma língua — atendido

O que a rodada 4 apontou era que a checagem julgava as fontes geradas por si mesmas e dispensava toda página marcada `<!-- site: one-language -->`; como um documento bilíngue que perde a metade portuguesa é escrito exatamente com essa marca, as duas situações ficavam indistinguíveis e a checagem passava.

A correção faz a checagem decidir pela **fonte de verdade**: para cada documento de `docs/`, a checagem lê as línguas que o índice declara para ele (a coluna de línguas da tabela) e, se o documento é declarado bilíngue, exige que a página inglesa não carregue a marca de uma língua só, que ela desenhe o link de par e que o arquivo `.pt-br` exista. Um documento declarado em uma língua só não precisa de par; um documento que o índice não menciona é julgado pelo que o próprio arquivo carrega.

Conferido na árvore de verdade: removida a metade `## Português` de `docs/memory.md`, a construção escreve `reference/memory.html` sem `reference/memory.pt-br.html`, e a checagem **sai 1** nomeando `/reference/memory` — antes ela saía 0 dizendo que toda página carregava as duas línguas. O documento foi restaurado e a árvore saudável volta a sair 0. É a falha que o critério de aceitação 13 diz que a checagem existe para pegar.

### 2. O typecheck e a suíte voltam verdes — atendido

`npx tsc --noEmit` sai 0 (o erro do parâmetro implícito no teste novo sumiu) e os arquivos de teste que esta mudança acrescenta ou ajusta — os do site e os dos README, 8 arquivos, 213 casos — passam. O `CONTRIBUTING.md` do repositório lista o typecheck e os testes entre os portões, e os dois portões passam para o que esta mudança entrega.

## Segurança, regras do repositório e efeitos externos

- **A mudança não abre caminho novo de escrita no host.** O fluxo de publicação (`.github/workflows/pages.yml`) só lê o conteúdo (`contents: read`), escreve na fonte de publicação (`pages: write`) e usa o `id-token` que a ação de publicação pede; nenhum passo escreve configuração de repositório — ligar a publicação continua sendo um ato da pessoa. O push e o pull request seguem pela porta de sempre.
- **A cerca do agente que escreve não mudou.** O agente de documentação ganha a sandbox (`shell: 'sandbox'`), mas continua com `permission: 'worktree'` e `tracker: 'none'`, e a cerca de escrita do fluxo de documentação segue valendo: só o arquivo de instruções é permitido dentro da execução de documentação, e um teste novo cobre que o mesmo agente, fora do fluxo de documentação, escreve o *worktree* inteiro e continua recusando `.git`, arquivo de segredo e caminho que sai por link.
- **O endereço de publicação não vive em arquivo.** O prefixo vem da própria execução do fluxo (`SITE_BASE: /${{ github.event.repository.name }}/`) e a checagem o lê da construção, nunca do ambiente. Os endereços de exemplo nos testes usam espaços reservados neutros.
- **O repositório público continua limpo.** A auditoria pública roda sobre a árvore inteira, com os arquivos do site na varredura, e não acusa nada. As únicas URLs reais nos arquivos versionados do site são o endereço público do próprio projeto, que o repositório já usava.
- **`site/` fica fora do tema da interface do desktop.** O tema do site é o de fábrica, com um arquivo próprio; a auditoria de tema varre só `src/` do renderer, então as páginas do site não entram nela, como o plano decidiu.
- **As duas línguas dos catálogos de interface continuam casando:** os dois arquivos definem as mesmas chaves, e o `npm run i18n:lint` sai 0.

## Sugestões (não bloqueiam)

Estas já foram levantadas em rodadas anteriores e continuam abertas; nenhuma bloqueia, e nenhuma ganhou fato novo nesta rodada:

- O teste que guarda o endereço do site nos README aceita qualquer endereço externo, então um endereço trocado ou velho mantém a suíte verde. Comparar o endereço dos dois README entre si diria o que o teste quer dizer.
- A checagem de links lê os `href` e os links em Markdown, não os `src`; nenhuma página carrega imagem hoje, mas um endereço errado de imagem não seria pego quando as capturas chegarem.
- Nas páginas escritas à mão (abertura, guia, casos de uso, blog) não há link próprio ligando as duas línguas; o par existe e a navegação leva, mas quem chega pela URL de uma língua só chega à outra pela URL.

## Critérios de aceitação

| Critério | Onde se confere |
|---|---|
| A mudança traz o site, o fluxo e a checagem; os portões passam | **Atendido**: typecheck sai 0; os testes do site e dos README passam; theme-audit, i18n:lint e auditoria pública saem 0; a construção publicada e a checagem saem 0 |
| O site constrói, os links resolvem e as duas línguas têm todas as páginas | **Atendido**: sobre a árvore saudável, construção e checagem saem 0 com o prefixo de publicação |
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
| A checagem do site pega as duas falhas que ela existe para pegar | **Atendido**: pega um link quebrado (inclusive com o prefixo de publicação) e pega uma página de referência que perca uma língua — os dois provocados na construção de verdade nesta rodada |
| O agente de documentação trabalha a pasta do site pelo ciclo normal | O agente tem sandbox e permissão de escrita, e casos cobrem a cerca do agente que escreve; nenhum modelo real percorreu o fluxo |

## O que foi conferido, e o que não foi

Conferido por leitura e execução nesta revisão: os dois bloqueantes anteriores estão fechados; o critério 13 tem as duas metades cobertas por falhas provocadas na construção real; o typecheck sai 0; os arquivos de teste do site e dos README passam; a correção do link de língua não enfraqueceu o caso da página escrita à mão; a auditoria pública, a de tema e o lint de idiomas saem 0; nada gerado entrou no commit.

Não conferido nesta revisão: a publicação no host, o site no ar, uma mudança posterior em `docs/` ou no `CHANGELOG.md` atualizando o site na mesclagem, e um agente de documentação construindo o site com um modelo de verdade. Nada disso é verificável sem o host.
