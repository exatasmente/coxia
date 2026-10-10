# Memória do ciclo

## Decisões

- #220 pede um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog) escrito e mantido pelos agentes pelo ciclo normal. Squad `Plataforma`; `priority:medium`; gates 1 e 2 aprovados pelo app.
- Refino fechou: gerador **VitePress**; pasta **`site/`**; referência **incluída de `docs/`**, nunca copiada; domínio próprio fora do escopo.
- Plano: o agente `docs-writer` que o modelo `docs-flow` já cria passa a ter `shell: 'sandbox'` (permissão `worktree` continua); esquema continua **27**, sem migração. Onde a máquina não tem sandbox, o modelo baixa `sandbox` para `allowlist` (`withoutSandbox`).
- Versão que abre o blog: **0.8.0** (estável); a linha de status dos dois README cita a versão do arquivo de versão e leva ao endereço publicado, contrariando a D10 do plano a favor da regra 12.
- Imagem de etapa só chega ao commit com `runner.evidence: "cycle"` (o padrão é `app`); nada muda o padrão.
- O prefixo de publicação nunca vive em arquivo: a construção o recebe do fluxo e a checagem o lê da própria construção (`baseOf`, `withinBase`, `targetOf`).
- A checagem de línguas nomeia o par pela forma que o site escreve: pasta `pt-br/` para páginas escritas à mão, marca `.pt-br` e endereço `/reference/…` para páginas geradas de documento. A página cujo par existe ao lado passa sem link próprio (a navegação leva); um link que leva a uma página que não é o par reprova.
- A checagem passou a **ler as fontes que a construção escreveu**: as páginas de referência nascem em `site/generated/reference/` e eram puladas pela travessia; agora são julgadas pelo documento de que vieram (a página e a irmã `.pt-br` precisam existir, a marca `site: one-language` dispensa, e um link para uma metade ausente reprova).
- O gerador das fontes do site (`writeSources`) e o montador de conteúdo (`contentOf`) aceitam a raiz de um repositório, para um teste rodar o gerador de verdade sobre uma cópia de `docs/` sem sujar a árvore.
- Um documento de português com o inglês sob um segundo título (`# … (English)`) vira duas páginas (`blocksOf`); um documento de uma língua só continua uma página.
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:313 -->
- Resposta: Volta e pede o ajuste que falta e somente os que faltam <!-- answer:493 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:295 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:298 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:301 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:304 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:307 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:310 -->

## Restrições

- Repositório público: `node scripts/public-audit.mjs` é portão e vale para as fontes do site; nada de empresa, pessoa, host privado, número real de issue ou segredo; nenhuma exceção nova em `scripts/public-audit.allow.json`. O único endereço publicado no repositório são as duas linhas de status dos README (regra 12).
- `docs/` continua sendo a fonte lida pelos agentes; a referência é incluída, não copiada. `CONFIG_SCHEMA_VERSION` segue 27.
- Nada da construção entra no commit: `site/generated/`, `site/.vitepress/dist/` e `site/.vitepress/cache/` são ignorados.
- A cerca de escrita do agente que escreve não mudou; só a capacidade de rodar comandos na sandbox foi acrescentada. Nenhuma string de interface do desktop passa por aqui.
- `runner.evidence: "cycle"` é escolha da pessoa, nunca o padrão.
- As sugestões não bloqueantes da rodada 3 (o teste do endereço dos README aceitar qualquer host; a checagem de links não olhar `src`; as páginas escritas à mão não ligarem as línguas por link) continuam fora do escopo destas passadas.

## Tentado e descartado

- Exigir `SITE_BASE` no ambiente da checagem: descartado; o prefixo é lido da construção.
- Escrever o prefixo num campo da página gerada: descartado; os endereços de `assets/` já o dizem.
- Vincular o fluxo de documentação à pasta do site (`devCycle.flows.docs`): descartado (campo novo, migração, caminho de escrita novo).
- Exigir o link que leva de uma língua para a outra nas páginas escritas à mão: permanece sugestão, não coberta.
- Fazer a checagem reprovar as fontes de `generated/` pelo próprio nome do arquivo (o `pt-br/` do palpite errado): descartado; elas são nomeadas pelo endereço `/reference/…`.

## Perguntas abertas

Nenhuma.

## Onde o trabalho está

- Triagem, refino e plano: `0_TRIAGE.md`, `1_SPEC.md` (14 regras, 14 critérios), `2_PLAN.md` (17 decisões, 9 blocos).
- Implementação: `site/` com VitePress preso em 1.6.4; travessia de `docs/`; blog e histórico do `CHANGELOG.md`; `pages.yml`; linha de status dos README; `docsWriter()` com sandbox; `docs/site.md`; esquema 27. Testes: `test/site-check.test.ts` (20), `test/site-docs-pages.test.ts` (8), `test/site-changelog.test.ts` (11), `test/readme-status.test.ts` (3).
- **Rodadas 1 a 3 da revisão:** veredicto `changes` nas três. Corrigidos: o prefixo da checagem de links; a regra de candidatos e os três casos vermelhos; agora a checagem de línguas ler as páginas geradas.
- **Esta passada (retomada da rodada 3):** `checkLanguages` deixou de pular `generated/`, julga as fontes geradas por documento (par obrigatório, `site: one-language` dispensa, link para metade ausente reprova); `writeSources(at, into)` e `contentOf(at)` aceitam a raiz de um repositório; novo `test/site-reference-languages.test.ts` (copia `docs/`, roda o gerador, roda a checagem) — **1 verde, 2 vermelhos**, ainda no formato antigo das mensagens.
- **Verificado nesta passada:** `node --check site/scripts/check.mjs` (0); `npx vitest run test/site-check.test.ts` (20 verdes); `node site/scripts/cli.mjs build` (0); `npm run docs:check` (antes 0 sem a metade em português — o defeito; depois 0 com as duas).
- **Não verificado nesta passada:** `npx vitest run` inteiro, `npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`, a construção com `SITE_BASE`; publicação no host; Pages ligado; uma mudança posterior em `docs/`/`CHANGELOG.md` atualizando o site na mesclagem; `npm ci` do fluxo; o agente de documentação com um modelo de verdade.
- Passagem developer → revisor-plataforma: fechar o caso de teste da página de referência que perde uma língua (com a mensagem real), rodar os portões e a construção com `SITE_BASE`, limpar a árvore e reescrever o documento desta etapa.
- Passagem revisor-plataforma → developer (rodada 3): a checagem de línguas não alcançava as páginas de referência geradas em `site/generated/`, provado removendo a metade `## Português` de um documento bilíngue; fechamento pedido: ler os documentos de `docs/` na checagem e exigir a página em português de cada par. <!-- handoff:626 -->
- Passagem support → product-owner: Refinar a #220 a partir deste documento: fechar as escolhas em aberto (gerador VitePress vs Jekyll, pasta e roteamento de squad do agente, referência incluída de docs/ vs movida, domínio próprio) e detalhar a aceitação em passos verificáveis. Fica fora desta etapa decidir prioridade e milestone. Vale confirmar no código, antes do plano, o formato exato do fluxo de Pages e a checagem de links/línguas no CI. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano técnico: decidir o agente, o fluxo e o encaminhamento à pasta do site (a spec recomenda um agente novo da pessoa, com sandbox, encaminhado a `site/`) e o que isso muda numa configuração que já tem o agente do fluxo de documentação de hoje; decidir a forma técnica de incluir a referência de `docs/` sem copiá-la (montagem, ligação ou equivalente); dizer como a construção do site, a checagem de links e a checagem das duas línguas entram no fluxo de verificação; e resolver como uma imagem guardada por uma etapa chega ao repositório, já que as ferramentas de arquivo do agente que escreve só a… <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementar o plano na ordem dos 9 commits, cada um com os gates do repositório verdes (auditoria pública, tipos, suíte, lint de idiomas, construção). Os quatro primeiros commits (1 a 4) são onde se decide o nome exato e a versão do gerador do site, se ele aceita a travessia da pasta de documentação sem uma lista de páginas escrita à mão, e se a checagem de links dele basta ou precisa do módulo próprio: construir o site e provocar um link quebrado e uma página de uma língua só. No commit 8, cobrir com um caso novo as recusas da cerca do agente que escreve quando o palco não é do fluxo de docum… <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: Revisar a implementação contra a spec (docs/cycles/[redacted]/1_SPEC.md) e o plano (2_PLAN.md), sem editar. Pontos que merecem atenção na revisão: (1) o bloco 8 do plano dizia para criar um caso novo em `test/runner-agent.test.ts` sobre `run.docs`; o caso foi criado em `test/runner-docs.test.ts`, onde vivem `confinedHooks` e os testes de cerca — a revisão deve decidir se isso satisfaz o plano ou se o caso deve morar no outro arquivo; (2) a linha de status dos README cita o endereço publicado (`exatasmente.github.io/coxia`), que o plano (D10) queria fora de qualquer arquivo — a spec (regra 12) … <!-- handoff:280 -->
- Passagem revisor-plataforma → developer: The documentation site change is rejected for one reason: the site's own link check cannot resolve a single link whenever the site is built with the base path the publishing workflow sets, which is the only environment in which the site is actually published. Building with SITE_BASE=/cerimonias/ (the value the workflow derives from the repository name) succeeds and writes use-cases/issue-to-pr.html, but the check then exits 1 with 2242 broken-link lines, because the check joins an absolute href to the built folder and never strips the base; with the default base the same command exits 0. The a… <!-- handoff:346 -->
- Passagem developer → revisor-plataforma: Terminar a correção: deixar verdes os três casos vermelhos de test/site-check.test.ts (a fixture `underBase` precisa de um endereço `/assets/` para a checagem ler o prefixo; o caso de uma língua só produz duas entradas e a expectativa tem de decidir qual delas é a falha; o `runner.pt-br.md` precisa do link de volta com título `English`), limpar a frase de abertura de `site/guide/index.md` e `site/guide/pt-br/index.md`, decidir se `assetsOf`/`checkAssets` ficam (hoje sem uso nem teste) e conferir o bloco de código corrompido de `site/README.md`. Depois rodar os portões: `npx tsc --noEmit`, `npx… <!-- handoff:386 -->
- Passagem pessoa → developer: Volta e pede o ajuste que falta e somente os que faltam <!-- handoff:494 -->
- Passagem developer → revisor-plataforma: Revisar os dois pontos que sobraram da rodada anterior contra a regra agora escrita. (1) A checagem de línguas nomeia o par pela forma que a seção escreve (pasta pt-br/ para as páginas escritas à mão, marca .pt-br e o endereço /reference/… para as páginas geradas a partir de documento) e aceita uma página cujo par existe mesmo sem link próprio; os casos verdeiam (20 em test/site-check.test.ts, 8 em test/site-docs-pages.test.ts, 11 em test/site-changelog.test.ts), e vale conferir que a mensagem de falha aponta o nome que o site escreve, não um nome novo. (2) Um documento escrito numa língua só … <!-- handoff:577 -->
