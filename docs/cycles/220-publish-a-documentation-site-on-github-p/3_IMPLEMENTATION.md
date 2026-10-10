# O site de documentação entrou no repositório, e o agente de documentação passou a construí-lo

O que esta passada mudou, com o que foi rodado. O plano foi seguido na ordem dos nove commits; o que o plano
previa e a execução corrigiu está dito abaixo, junto do resultado de cada portão.

## O que entrou

**A pasta `site/`, com o gerador preso por versão exata.** `vitepress@1.6.4` entrou em `devDependencies` sem `^`
(D17), e o `package.json` ganhou `docs:dev`, `docs:build` e `docs:check`. A configuração
(`site/.vitepress/config.mts`) traz a navegação escrita à mão e o `theme/` que existe para o trabalho visual
posterior. `site/README.md` diz o que a pasta é e como ela é publicada.

**A referência vem de `docs/`, lida onde está.** `site/scripts/docs-pages.mjs` percorre a pasta (deixando de fora
`docs/cycles/`, que é registro de execução, não referência), trata `README.md` de uma pasta como o índice dela, e dá
a cada documento um endereço derivado do próprio caminho. Um arquivo com `## Português` e `## English` vira dois
blocos, um por língua; um arquivo escrito numa língua só vira uma página, e o gerador marca que o repositório o
escreve assim. O título de um documento bilíngue (`Configuração / Configuration`) vira a metade da língua da página.

**A página do histórico e o blog saem do `CHANGELOG.md`.** `site/scripts/changelog.mjs` lê o arquivo na construção:
a página do histórico é uma seção por versão, e o blog abre com um texto por versão **estável**, do mais novo ao
mais antigo (`0.8.0` é o primeiro hoje), tudo na hora de construir e nada versionado como cópia.

**As checagens do site.** `site/scripts/check.mjs` confere os links do site construído e as duas línguas de cada
página; `site/scripts/cli.mjs` constrói e confere. As três checagens rodam na etapa `check` do fluxo de verificação
que já existe (D8), depois da construção do aplicativo, e o `checkout` do trabalho passou a trazer o histórico.

**O fluxo que publica.** `.github/workflows/pages.yml` constrói o site a cada push na ramificação padrão e o publica
pela fonte de GitHub Actions. O endereço de origem vem de uma variável do próprio fluxo (`SITE_BASE`), nunca de um
arquivo da árvore — por isso nada em `scripts/public-audit.allow.json` mudou. Ligar o Pages continua sendo um ato da
pessoa no host.

**O agente de documentação constrói o site.** `docsWriter()` passou de `shell: 'none'` para `'sandbox'`, a
recomendação do papel acompanhou (`RECOMMENDED['docs-writer']`), e os dois textos do papel nos catálogos passaram a
dizer o que ele faz: mantém o site e o arquivo de instruções, e roda comandos na sandbox da etapa. A permissão de
escrita e a cerca continuam exatamente as de antes. O `docs-flow` não ganhou campo nenhum: o esquema continua 27 e
não há migração.

**A documentação do site e a linha de status.** `docs/site.md` (pt-BR e en), a linha no índice de `docs/README.md`,
duas linhas na tabela de scripts do `CONTRIBUTING.md`, e o `CHANGELOG.md` sob `## [Unreleased]`. A linha de status
dos dois README diz a versão do arquivo de versão (`0.9.0-beta.15`) e leva ao site.

## O que o plano previa e a execução corrigiu

- **A pasta de fontes geradas.** O plano não dizia onde elas ficariam. Elas vão para `site/generated/`, ignorado
  pelo `.gitignore`, e não para dentro de `.vitepress/`, porque a varredura de páginas do gerador não desce numa
  pasta que começa com ponto.
- **Quando gerar.** O gerador resolve as páginas antes de qualquer gancho da construção, então a geração acontece
  quando o módulo da configuração e seus imports são avaliados. Foi conferido: `resolveConfig` escreve os arquivos e
  lista as 79 páginas na mesma chamada.
- **Os endereços.** As páginas geradas são reescritas (`rewrites`) para os endereços que o resto do site linka:
  `/reference/<caminho do documento>` e `/blog/<slug>`.
- **Os links de dentro de `docs/`.** Um documento de `docs/` linka para arquivos que não são páginas do site
  (`CONTRIBUTING.md`, uma pasta de código, uma spec de ciclo). O gerador reescreve esses links para o arquivo no host,
  lendo o endereço do `repository.url` do próprio `package.json`, e deixa os que apontam para outros documentos da
  referência como páginas do site.
- **Texto que o compilador leria como etiqueta.** Um `CHANGELOG.md` e um documento de referência trazem `<stage>`,
  `<nome>` e `<teste.yml>` como texto comum; sem tratamento isso quebra a construção. O gerador escapa o que está
  fora de um trecho de código e deixa o que está dentro dele intacto (conferido na página renderizada).
- **O `fetch-depth`.** A etapa `check` precisou dele: sem o histórico, a página do histórico e os textos do blog não
  teriam o que ler.

## O que foi rodado

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | Sem saída: passa. |
| `npx vitest run` | 456 arquivos passam, 1 pulado; 7662 testes passam, 3 pulados. |
| `node scripts/theme-audit.mjs` | Passa (o site não entra na conta, que é do renderer). |
| `npm run i18n:lint` | 5739 chaves nos dois idiomas; 0 literais fora de `t()`. |
| `node scripts/public-audit.mjs` | 1731 arquivos, nada de empresa ou pessoa. Passa com os arquivos do site na varredura e sem exceção nova. |
| `npx electron-vite build` | Constrói. |
| `npm run docs:build` | Constrói o site: 79 páginas, sem link morto. |
| `npm run docs:check` | "every link resolves and every page carries its two languages". |

## Os testes que entraram

- `test/site-docs-pages.test.ts` — a travessia de `docs/` (a pasta de ciclos fica de fora, o `README.md` de uma
  pasta é o índice dela), a divisão de um documento bilíngue em dois blocos na ordem do arquivo, o arquivo de uma
  língua só, e o endereço derivado do caminho.
- `test/site-changelog.test.ts` — o extrator acha a seção de uma versão e não confunde `[Unreleased]` com versão; a
  página do histórico segue o arquivo (mudar uma seção muda a página); o blog abre com as versões estáveis, da mais
  nova à mais antiga, e ignora as betas; a versão vem do `package.json`.
- `test/site-check.test.ts` — a checagem de links reprova um link para uma página que não existe (absoluto e
  relativo) e passa quando tudo resolve; a de línguas reprova uma página de uma língua só e aceita a que o
  repositório escreve em uma língua e diz isso.
- `test/readme-status.test.ts` — os dois README citam a versão do `package.json`, deixam de dizer a versão de
  estreia e levam ao site.
- `test/cycle-templates.test.ts` e `test/agent-permissions-config.test.ts` — os dois casos existentes ajustados: o
  agente de documentação tem sandbox, continua sem rastreador e com a permissão de escrita.
- `test/runner-docs.test.ts` — dois casos novos: um agente que escreve numa execução que **não** é de documentação
  escreve o *worktree* inteiro e continua recusando `.git`, pasta de gancho, arquivo de segredo e caminho que sai por
  link; e a cerca da execução de documentação continua valendo (só o arquivo de instruções). Os casos existentes
  ajustados para o campo `shell`.

## A interface, exercitada

O site foi servido no endereço local (`127.0.0.1:4123`) e conduzido com o Playwright do próprio repositório, com
janela, num perfil descartável. Doze páginas foram abertas nas duas línguas, todas com código 200 e o texto
esperado: a abertura (en e pt-BR), o guia, os casos de uso, o índice da referência, `docs/runner.md` como página do
site (en e pt-BR), uma página de configuração em português, o blog, o texto do `0.8.0`, a página do histórico nos
dois idiomas e o guia de instalação em português. O índice da referência foi lido: ele alcança os dezessete
endereços de documento, incluindo `docs/site.md`, que entrou nesta mudança.

As duas falhas que a checagem existe para pegar foram provocadas: um link para uma página que não existe reprova a
construção (o próprio gerador o pega) e reprova a checagem própria (`exit 1`); uma página que perde a sua par de
língua reprova a checagem (`exit 1`), e com tudo no lugar ela sai com `exit 0`.

## O que não foi verificado

- **A publicação.** O fluxo `pages.yml` não foi executado: não se viu o site publicado, nem a ação de publicação do
  host, nem o Pages ligado na configuração do repositório. O endereço publicado não é citado em arquivo nenhum, por
  decisão; a conferência é da pessoa depois da mesclagem.
- **O site publicado conferido de dentro do aplicativo.** Depende do site no ar e da lista de hosts do agente, que só
  a pessoa configura.
- **Uma mudança posterior em `docs/` ou no `CHANGELOG.md` atualizar o site na mesclagem.** Depende da publicação
  ligada. O caminho está construído (a página é lida do arquivo na hora de construir), mas não foi exercitado.
- **O agente de documentação construindo o site de verdade.** A mudança do campo `shell` está nos testes; nenhum
  modelo real percorreu o fluxo e construiu o site.
- **A chave de cache e a primeira publicação.** `npm ci` no fluxo não foi rodado aqui; os comandos rodados foram os
  de cima, na máquina, com as dependências já instaladas.
