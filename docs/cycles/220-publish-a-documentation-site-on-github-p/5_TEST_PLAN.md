# Plano de teste — site de documentação publicado

Etapa **QA**, squad `Plataforma`. O que foi conferido nesta passada: a declaração de publicação e o fato de o aplicativo não mexer em
configuração de repositório (critério 8), a checagem do site pegando as duas falhas que ela existe para pegar (critério 13), e a
linha de status dos dois README (critério 9). Os cenários das seções anteriores deste plano continuam como estavam, com o resultado
que já registravam.

**Como os cenários foram executados.** Comandos no worktree da execução, sobre o código entregue; a cópia descartável usada no
critério 13 ficou em `$COXIA_OUT/sitecheck`. Nada foi alterado no código do produto para testar: a única mudança que a árvore
mostra depois da passada é o `MEMORY.md` do ciclo, que o próprio aplicativo escreve (ev-55). Cada comando desta passada está com o
código de saída e a saída no arquivo guardado como comprovação.

## Cenário 8 — A publicação está declarada e o aplicativo não mexeu em configuração de repositório

**O que fazer.** Ler a árvore: (a) o fluxo que publica o site, seus gatilhos e suas permissões; (b) todo arquivo do repositório que
nomeie um fluxo de publicação ou uma configuração de repositório, e o que cada ocorrência é; (c) a porta de escrita do aplicativo
(`src/main/actions.ts`), procurando escrita de configuração.

**O que se espera.** O fluxo que publica existe no repositório, roda na ramificação padrão (`main`) e nenhum passo dele escreve
configuração de repositório; o aplicativo não tem, em código, escrita de configuração de Pages ou de configuração de repositório.

**Resultado: passou (executado).**

- O fluxo é `.github/workflows/pages.yml`, com `on: push: branches: [main]` e `workflow_dispatch`; permissões `contents: read`,
  `pages: write` e `id-token: [redacted]; o trabalho constrói (`npm run docs:build`, com o endereço de origem lido do próprio fluxo,
  `SITE_BASE: /${{ github.event.repository.name }}/`) e publica o que foi construído (ev-52, com o arquivo inteiro).
- A árvore tem três fluxos (`ci.yml`, `pages.yml`, `release.yml`); nenhum outro publica nada.
- A busca por todo o repositório de um nome de fluxo de publicação ou de configuração de repositório devolve seis linhas, todas
  lidas uma a uma: dois textos de interface do assistente de código que citam o caminho REST `/api/v3` de um host auto-hospedado,
  duas linhas de código que montam esse mesmo caminho, o **arquivo de configuração de um servidor de busca** que a pessoa roda
  (não do repositório) e a frase do `site/README.md` que aponta para o fluxo de publicação. Nenhuma escreve configuração de
  repositório (ev-56).
- A porta do aplicativo: `src/main/actions.ts`, procurada por `settings` e `pages`, tem uma única ocorrência, e ela é um campo do
  objeto de configuração **do próprio espaço de trabalho** — não uma configuração de repositório (ev-56).
- O endereço publicado não vive em arquivo nenhum: o fluxo o recebe do próprio host na hora de construir (ev-52).
- O que a mudança deixa na árvore é o fluxo, o site, a checagem e os documentos; a pasta construída e as fontes geradas continuam
  ignoradas (`site/.vitepress/dist/`, `site/generated/`, ev-55).

**Não verificado.** A publicação no host: que a pessoa liga o Pages, que o fluxo roda na ramificação padrão do host e que o site
responde no endereço publicado são critérios 10 e 12, verificáveis só depois da mesclagem.

## Cenário 13 — A checagem do site pega as duas falhas que ela existe para pegar

**O que fazer.** Provocar cada falha numa árvore de verdade e rodar a checagem: (a) uma página de referência que perde uma das duas
línguas; (b) um link que aponta para uma página que não existe.

**O que se espera.** Cada uma reprova a checagem (saída 1) e é nomeada; uma árvore sem defeito passa (saída 0).

**Resultado: passou (executado).**

- **A página que perde uma língua.** Numa cópia descartável com os `docs/`, o `CHANGELOG.md` e o `package.json` de verdade,
  tirando a metade `## Português` de `docs/memory.md`, a checagem passa a nomear `/reference/memory` — `no page is served at
  /reference/memory.pt-br` — e sai 1; a mesma cópia sem o defeito não gera achado nenhum (ev-54).
- **O link que não existe.** Um link injetado apontando para uma página que o site não tem é nomeado e reprova a checagem (ev-38,
  de uma passada anterior desta mesma etapa).
- Sobre a árvore saudável deste worktree, construída com o prefixo de publicação, a checagem sai 0 (ev-51).

## Cenário 9 — A linha de status dos dois README diz a versão atual e leva ao site

**O que fazer.** Ler a linha de status dos dois README e comparar com o arquivo de versão.

**O que se espera.** Os dois citam a versão do arquivo de versão (não a de estreia) e trazem o endereço do site.

**Resultado: passou (executado).**

- `README.md:7` e `README.pt-BR.md:7` dizem `Status: 0.9.0-beta.15 (beta)`, a mesma versão de `package.json:3`, e cada uma leva ao
  endereço publicado; nenhuma diz a versão de estreia (ev-53). Os dois casos que guardam isso (`test/readme-status.test.ts`) passam
  (ev-50).

## Cenários das passadas anteriores

Estes foram executados e comprovados na etapa; os ids das comprovações são os que já estavam registrados.

| Cenário | Resultado | Comprovação |
|---|---|---|
| O site constrói, os links resolvem e as páginas carregam os seus arquivos | passou | ev-37 |
| A checagem pega um link que aponta para uma página que não existe | passou | ev-38 |
| A checagem pega uma página de referência que perdeu uma das duas línguas | passou | ev-39 |
| A checagem pega uma página escrita à mão que perdeu a outra língua | passou | ev-40 |
| Typecheck, auditoria de tema, lint de idiomas e auditoria pública passam | passou | ev-41 |
| A árvore construída tem as seis seções nas duas línguas | passou | ev-42 |
| Passeio por cada seção nas duas línguas e pelos pares da referência | passou | ev-43 |
| Os arquivos de teste da própria mudança passam (176 casos) | passou | ev-44 |
| Uma linha acrescentada ao `CHANGELOG.md` chega à página do histórico e ao texto do blog | passou | ev-45 |
| A linha de status dos README carrega a versão atual e o endereço do site (coberto por teste) | passou | ev-46 |
| O guia mostra espaço reservado, sem captura de verdade | passou | ev-47 |
| A abertura em português | passou | ev-48 |
| A lista de referência traz cada documento de `docs/` com as suas línguas | passou | ev-35 |
| A abertura desenha a navegação e o espaço reservado em texto | passou | ev-34 |
| O blog abre com a versão estável 0.8.0 e não lista beta | passou | ev-36 |

Nesta passada também se rodaram os arquivos de teste do site e dos README (41 casos, saída 0, ev-50), a construção com o prefixo de
publicação e a checagem sobre ela (ambas saída 0, ev-51), e a guarda da árvore depois da passada (ev-55).

## O que não deu para verificar

- **O site no ar, o Pages ligado no host e uma mudança posterior atualizando o site na mesclagem** (critérios 10, 11 e 12): só
  depois de a pessoa ligar a publicação e mesclar.
- **Um agente de documentação construindo o site com um modelo de verdade** (critério 14): nenhum modelo real foi chamado; o que
  existe é o agente com sandbox e os casos que cobrem a cerca de escrita.
- **O endereço publicado de cada README aceitar qualquer host** e a checagem de links não olhar `src` de imagem: são sugestões não
  bloqueantes da revisão, abertas e não cobertas por cenário.

## Resultado dos cenários

- 8. A publicação está declarada e o aplicativo não mexeu em configuração de repositório: passou (executado na sandbox) — O fluxo que publica é `.github/workflows/pages.yml`: `on: push: branches: [main]` e `workflow_dispatch`, permissões `contents: read`/`pages: write`/`id-token: [redacted], construção com `SITE_BASE` lido do próprio fluxo e publicação do que foi construído (ev-52). A árvore tem três fluxos (ci.yml, pages.yml, release.yml) e nenhum outro publica. A busca na árvore inteira por um nome de fluxo de publicação ou de configuração de repositório devolve seis linhas, lidas uma a uma: o caminho REST `/api/v3` de um host auto-hospedado (duas em catálogos de interface, duas em código), o arquivo de configuração de um servidor de busca que a pessoa roda, e a frase do `site/README.md` que aponta para o fluxo; `src/main/actions.ts`, procurada por `settings` e `pages`, tem uma única ocorrência, e é um campo da configuração do próprio espaço de trabalho (ev-56). Nenhum arquivo escreve configuração de repositório e o endereço publicado não vive em arquivo nenhum (ev-52).
- 13. A checagem do site pega as duas falhas que ela existe para pegar: passou (executado na sandbox) — Metade 1 (página de referência que perde uma língua): numa cópia descartável com os `docs/`, o `CHANGELOG.md` e o `package.json` de verdade, tirando a metade `## Português` de `docs/memory.md`, a checagem passa a nomear `/reference/memory` ("no page is served at /reference/memory.pt-br") e sai 1; a mesma cópia sem o defeito não gera achado (ev-54). Metade 2 (link para uma página que o site não tem): o link injetado é nomeado e a checagem sai 1 (ev-38, de uma passada anterior desta etapa). A árvore saudável construída com o prefixo de publicação sai 0 (ev-51). O `cli.mjs` não aceita `--root`; a prova fora do worktree usa os módulos puros `writeSources` e `checkLanguages`.
- 9. A linha de status dos dois README diz a versão atual e leva ao site: passou (executado na sandbox) — `README.md:7` e `README.pt-BR.md:7` dizem `Status: 0.9.0-beta.15 (beta)`, a versão de `package.json:3`, e cada uma leva ao endereço publicado; nenhuma diz a versão de estreia (ev-53). Os casos que guardam isso (`test/readme-status.test.ts`) passam dentro dos 41 casos verdes (ev-50), e o teste também falha se a linha deixar de citar a versão do arquivo.
- Os arquivos de teste do site e dos README passam (41 casos): passou (executado na sandbox) — `npx vitest run test/readme-status.test.ts test/site-check.test.ts test/site-reference-languages.test.ts test/site-docs-pages.test.ts test/site-changelog.test.ts` sai 0: 5 arquivos, 41 casos, 1,88 s. Cobre a linha de status dos README, a checagem de links, a de línguas, o endereço de um documento, as páginas de referência que a construção escreve e o blog e a página do histórico.
- A construção com o prefixo de publicação e a checagem do site saem 0: passou (executado na sandbox) — `SITE_BASE=/cerimonias/ npm run docs:build` termina com "build complete in 12.73s." e `npm run docs:check` imprime "site: every link resolves and every page carries its two languages", ambos com saída 0. A checagem lê o prefixo da própria construção (nunca do ambiente), então é o mesmo ambiente em que o site é publicado.
- Nenhum arquivo do produto foi alterado para testar e a construção ficou fora da árvore: passou (executado na sandbox) — `git status --porcelain` depois da passada mostra só `M docs/cycles/220-.../MEMORY.md` (escrito pelo próprio aplicativo); `site/.vitepress/dist/` e `site/generated/` continuam ignorados pelo `.gitignore`. As cópias e os dados descartáveis ficaram em `$COXIA_OUT`.
- 10, 11 e 12. O site no ar, o Pages ligado e uma mudança posterior atualizando o site na mesclagem: não rodou (lido) — Marcados como não executados: dependem do host. O site responde no endereço do projeto dentro da execução do fluxo, o site publicado é conferido de dentro do aplicativo com um agente cujo host permitido inclua o endereço, e uma mudança posterior em `docs/` ou no `CHANGELOG.md` atualiza o site na mesclagem sem passo novo — nada disso é verificável antes de a pessoa ligar a publicação e mesclar.
- 14. O agente de documentação trabalha a pasta do site pelo ciclo normal: não rodou (lido) — Não executado: nenhum modelo real percorreu o fluxo de documentação nesta etapa. O que está verificado é por leitura e por teste — o agente `docs-writer` do modelo `docs-flow` tem `shell: 'sandbox'` com a permissão de escrita de antes, e os casos cobrem a cerca do agente que escreve.
