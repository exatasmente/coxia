# Memória do ciclo

## Decisões

- #220 pede um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog) escrito e mantido pelos agentes pelo ciclo normal. Squad `Plataforma`; `priority:medium`; gates 1 e 2 aprovados pelo app.
- Refino fechou: gerador **VitePress**; pasta **`site/`**; referência **incluída de `docs/`**, nunca copiada; domínio próprio fora do escopo.
- Plano: o agente `docs-writer` que o modelo `docs-flow` já cria passa a ter `shell: 'sandbox'` (permissão `worktree` continua); sem campo novo de "onde escrever"; a configuração do esquema continua **27**, sem migração.
- Versão que abre o blog: **0.8.0** (estável); a linha de status dos dois README cita a versão do arquivo de versão (`0.9.0-beta.15`) e leva ao endereço publicado, contrariando a D10 do plano a favor da regra 12.
- Imagem de etapa só chega ao commit com `runner.evidence: "cycle"` (o padrão é `app`); nada muda o padrão.
- O prefixo de publicação nunca vive em arquivo: a construção o recebe do fluxo e a checagem o lê da própria construção.
- **Rodada 1 (commit 3898d756):** bloqueante — a checagem de links não resolvia nada com o prefixo de publicação (`site/scripts/check.mjs`); a página histórica também gerava quatro links `docs/docs/…`, fora do bloqueio.
- **Rodada 2 (commit 7d48af17):** o prefixo passou a ser lido da construção (`baseOf`, `withinBase`, `targetOf`) e, com `SITE_BASE=/cerimonias/`, a checagem sai 0; ficaram três casos vermelhos em `test/site-check.test.ts`, sobretudo a regra que pedia o irmão `.pt-BR.md`, nome que o site não escreve.
- **Rodada 3 (esta):** `pairRouteOf` e `candidatesOf` nomeiam o par pela forma que a página escreve — a pasta `pt-br/` para as páginas escritas à mão, a marca `.pt-br` com o endereço `/reference/…` para as páginas geradas de documento; a falha reprova um link que leva a uma página que não é o par; uma página cujo par existe ao lado passa sem link próprio (a navegação já leva até ele). `checkAssets` entrou no veredito de `checkSite`.
- Um documento escrito só em português, com a metade inglesa sob um segundo `# … (English)`, virou duas páginas: `blocksOf` trata a forma de um título por metade ao lado de `## Português`/`## English`, o texto anterior ao segundo título fica com a própria língua, e `titleOf` escolhe o título da metade. Era o caso que a revisão chamou de "página só em português servida como metade em inglês".
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:295 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:298 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:301 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:304 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:307 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:310 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:313 -->
- Resposta: Volta e pede o ajuste que falta e somente os que faltam <!-- answer:493 -->

## Restrições

- Repositório público: `node scripts/public-audit.mjs` é portão e vale para as fontes do site; nada de empresa, pessoa, host privado, número real de issue ou segredo; nenhuma exceção nova em `scripts/public-audit.allow.json`.
- `docs/` continua sendo a fonte lida pelos agentes; a referência é incluída, não copiada. `CONFIG_SCHEMA_VERSION` segue 27.
- Nada da construção entra no commit: apagar `site/generated/`, `site/.vitepress/dist/` e `site/.vitepress/cache/` depois de exercitar.
- A cerca de escrita do agente que escreve não mudou; só a capacidade de rodar comandos na sandbox foi acrescentada. Nenhuma string de interface do desktop passa por aqui.
- `runner.evidence: "cycle"` é escolha da pessoa, nunca o padrão.

## Tentado e descartado

- Exigir `SITE_BASE` no ambiente da checagem: descartado, duas construções com prefixos diferentes coexistiriam.
- Escrever o prefixo num campo da página gerada: descartado; os endereços de `assets/` da própria construção já o dizem.
- Vincular o fluxo de documentação à pasta do site (`devCycle.flows.docs`): descartado (campo novo, migração e caminho de escrita novo).
- Exigir também o link que leva de uma língua para a outra nas páginas escritas à mão: permanece como sugestão da revisão, não coberta; a navegação é o que leva ao par.

## Perguntas abertas

Nenhuma.

## Onde o trabalho está

- Triagem, refino e plano: `0_TRIAGE.md`, `1_SPEC.md` (14 regras, 14 critérios), `2_PLAN.md` (17 decisões, 9 blocos).
- **Implementação (tentativa 1, commit 3898d756):** `site/` com VitePress preso em 1.6.4; travessia de `docs/`; blog e histórico do `CHANGELOG.md`; `pages.yml`; linha de status dos README; `docsWriter()` com sandbox; `docs/site.md`; esquema 27.
- **Implementação (tentativas 2 e 3):** a checagem lê o prefixo da construção; uma regra só de endereço em `referenceRoute`/`pairRouteOf`; a página gerada diz a outra língua no fim; um documento de dois títulos vira duas páginas; `checkAssets` conta; `test/site-check.test.ts` (20 casos), `test/site-docs-pages.test.ts` (8, com um novo) e `test/site-changelog.test.ts` (11) verdes.
- **Rodadas 1 e 2 da revisão:** veredicto `changes`, um bloqueante por rodada (o prefixo da checagem de links; depois a regra de candidatos e os três casos vermelhos).
- **Verificado nesta tentativa:** os três arquivos de teste do site (35 casos, verdes), `npx tsc --noEmit` (0), `node scripts/theme-audit.mjs` (0), `npm run i18n:lint` (0), `node scripts/public-audit.mjs` (0, 1733 arquivos), `SITE_BASE=/cerimonias/ npm run docs:build` seguido de `npm run docs:check` (0).
- **Não verificado:** a suíte completa do repositório; publicação no host; Pages ligado; uma mudança posterior em `docs/`/`CHANGELOG.md` atualizando o site na mesclagem; `npm ci` do fluxo; o agente de documentação trabalhando com um modelo de verdade.
- Passagem revisor-plataforma → developer: os três casos vermelhos, a regra de candidatos e os portões a rodar.
- Passagem support → product-owner: fechar as escolhas em aberto (gerador, referência incluída, domínio próprio) — fora desta etapa.
- Passagem product-owner → pessoa: decidir agente, fluxo e encaminhamento à pasta do site; a inclusão da referência sem copiar; como entram construção e checagens; como a imagem de etapa chega ao repositório.
- Passagem tl-plataforma → pessoa: implementar o plano na ordem dos 9 commits, com os portões verdes. <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: revisar contra a spec e o plano; dois pontos de escopo (caso novo em `test/runner-docs.test.ts`; endereço publicado no README, contrariando a D10 e atendendo à regra 12).
- Passagem revisor-plataforma → developer: a checagem de links não resolve os endereços com o prefixo de publicação; mais três pedidos menores.
- Passagem developer → revisor-plataforma: terminar a correção dos três casos vermelhos, limpar a frase de abertura do guia, decidir o destino de `assetsOf`/`checkAssets`, conferir o bloco de código do `site/README.md`. <!-- handoff:386 -->
- Passagem pessoa → developer: volta e pede o ajuste que falta e somente os que faltam. <!-- handoff:494 -->
- Passagem support → product-owner: Refinar a #220 a partir deste documento: fechar as escolhas em aberto (gerador VitePress vs Jekyll, pasta e roteamento de squad do agente, referência incluída de docs/ vs movida, domínio próprio) e detalhar a aceitação em passos verificáveis. Fica fora desta etapa decidir prioridade e milestone. Vale confirmar no código, antes do plano, o formato exato do fluxo de Pages e a checagem de links/línguas no CI. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano técnico: decidir o agente, o fluxo e o encaminhamento à pasta do site (a spec recomenda um agente novo da pessoa, com sandbox, encaminhado a `site/`) e o que isso muda numa configuração que já tem o agente do fluxo de documentação de hoje; decidir a forma técnica de incluir a referência de `docs/` sem copiá-la (montagem, ligação ou equivalente); dizer como a construção do site, a checagem de links e a checagem das duas línguas entram no fluxo de verificação; e resolver como uma imagem guardada por uma etapa chega ao repositório, já que as ferramentas de arquivo do agente que escreve só a… <!-- handoff:22 -->
- Passagem developer → revisor-plataforma: Revisar a implementação contra a spec (docs/cycles/[redacted]/1_SPEC.md) e o plano (2_PLAN.md), sem editar. Pontos que merecem atenção na revisão: (1) o bloco 8 do plano dizia para criar um caso novo em `test/runner-agent.test.ts` sobre `run.docs`; o caso foi criado em `test/runner-docs.test.ts`, onde vivem `confinedHooks` e os testes de cerca — a revisão deve decidir se isso satisfaz o plano ou se o caso deve morar no outro arquivo; (2) a linha de status dos README cita o endereço publicado (`exatasmente.github.io/coxia`), que o plano (D10) queria fora de qualquer arquivo — a spec (regra 12) … <!-- handoff:280 -->
- Passagem revisor-plataforma → developer: The documentation site change is rejected for one reason: the site's own link check cannot resolve a single link whenever the site is built with the base path the publishing workflow sets, which is the only environment in which the site is actually published. Building with SITE_BASE=/cerimonias/ (the value the workflow derives from the repository name) succeeds and writes use-cases/issue-to-pr.html, but the check then exits 1 with 2242 broken-link lines, because the check joins an absolute href to the built folder and never strips the base; with the default base the same command exits 0. The a… <!-- handoff:346 -->
