# Memória do ciclo

## Decisões

- A #220 é pedido de funcionalidade: publicar um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog), escrito e mantido pelos agentes pelo ciclo normal. Squad `Plataforma`; prioridade proposta `priority:medium`. Gate 1 e Gate 2 aprovados pelo app.
- Refino fechou: gerador **VitePress**; pasta **`site/`**; referência **incluída de `docs/`**, nunca copiada; **domínio próprio fora do escopo**.
- Plano fechou o resto (2_PLAN.md): o agente de documentação é o **`docs-writer` que o modelo `docs-flow` já cria**, com `shell: 'none'` → `'sandbox'`. **Não** se cria um "onde escrever" no fluxo (custaria campo novo no esquema e migração).
- A versão estável que abre o blog é `0.8.0`; a linha de status dos README cita a versão do arquivo de versão (`0.9.0-beta.15`).
- Imagem guardada por etapa chega ao commit pelo mecanismo que já existe (`copyToCycleFolder`), **só** com `runner.evidence: "cycle"`.
- **Revisão (2026-10-10):** veredito `changes`, com **um bloqueante**: a checagem de links não resolve nenhum link com o prefixo de publicação que `pages.yml` define, porque `site/scripts/check.mjs` junta um endereço absoluto à pasta construída sem retirar o prefixo. Conferido: com o prefixo a checagem sai 1 com 2242 linhas; sem o prefixo as duas passam. Sugestões: a linha de status fixa a versão em dois README; a linguagem de endereço de uma página de referência escrita em três lugares; falta caso para uma página de uma língua só na forma que o site usa.
- A contradição entre a regra 12 (a linha de status leva ao site) e o D10 do plano resolve-se a favor da spec: o endereço publicado fica nos dois README.
- Respostas da pessoa sobre abrir o pull request: contra `main` e contra `release/0.9.0` (a última: `main`). <!-- answer:313 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:295 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:298 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:301 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:304 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:307 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:310 -->

## Restrições

- O repositório é público: `scripts/public-audit.mjs` é gate de CI e vale para as fontes do site. Nada de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros (`example.com`). Nenhuma exceção nova em `scripts/public-audit.allow.json`.
- `docs/` continua a fonte lida pelos agentes do aplicativo em tempo de execução: a referência é incluída no site, não movida nem copiada.
- Nada no aplicativo escreve Pages nem configuração de repositório: ligar o Pages é ato da pessoa no host.
- O esquema de configuração continua **27**, sem migração.
- Nenhuma string de interface entra aqui; o site não usa `t()` nem os tokens de tema do renderer.
- A cerca de escrita de um agente do ciclo não mudou; só a capacidade de rodar comandos na sandbox foi acrescentada.

## Tentado e descartado

- Fazer a própria checagem construir o site com um prefixo: descartado por custo (a construção leva minutos) e por duplicar o que o fluxo já faz.
- Exigir `SITE_BASE` no ambiente da checagem: descartado porque duas construções com prefixos diferentes podem coexistir e a checagem passaria a conferir uma com o prefixo da outra.
- Escrever o prefixo da construção num campo da página gerada para a checagem lê-lo: descartado; ler o prefixo dos endereços de `assets/` da própria página construída resolve sem inventar arquivo nem variável.
- Vincular o fluxo de documentação à pasta do site (`devCycle.flows.docs`): descartado (campo novo + migração + caminho de escrita novo).
- Mudar o padrão de `runner.evidence` para `cycle`: faria toda imagem de toda execução entrar em algum commit.

## Perguntas abertas

Nenhuma.

## Onde o trabalho está

- Triagem, refino e plano em 2026-10-10: `0_TRIAGE.md`, `1_SPEC.md` (14 regras, 9 critérios antes da mesclagem), `2_PLAN.md` (17 decisões, 9 blocos).
- **Implementação (tentativa 1, commit 3898d756):** `site/` com VitePress preso em 1.6.4; travessia de `docs/`; histórico e blog lidos do `CHANGELOG.md`; checagem de links e de línguas; `pages.yml`; linha de status dos README; `docsWriter()` com sandbox; `docs/site.md`; esquema 27.
- **Revisão (tentativa 1, refeita): `4_REVIEW.md`, veredito `changes`.** Rodados: auditoria pública (1733 arquivos, saída 0), seis arquivos de teste (71 testes), construção e checagem nos dois endereços. O bloqueante: `site/scripts/check.mjs:40` (prefixo não retirado).
- **Implementação (tentativa 2, em andamento):** a checagem lê o prefixo da própria construção (dos endereços de `assets/`) e o retira (`baseOf`, `withinBase`, `targetOf`, `checkLinks`); a regra de endereço vive só em `referenceRoute` (`docs-pages.mjs`), usada pela configuração e pelo gerador; o ternário morto de `pageFor` saiu; o par de línguas de uma página de referência virou link escrito pelo gerador e lido pela checagem (`otherLanguageLink`); o par de uma página escrita à mão passou a ser aceito também na forma `pt-br/` da pasta. Verificado: `SITE_BASE=/cerimonias/ npx vitepress build site` constrói, `node site/scripts/cli.mjs check` sai 0, 2238 links internos e 0 quebrados. **Aberto:** três casos de `test/site-check.test.ts` ainda vermelhos (fixtures), a frase de abertura de `site/guide/*/index.md` por limpar, a decisão sobre `assetsOf`/`checkAssets`, o bloco de código corrompido de `site/README.md`, e os portões (typecheck, suíte, auditoria pública, i18n, tema, construção) não rodados depois destas mudanças.
- **Não verificado (nada disto foi exercitado):** a publicação no host, o site no ar, o Pages ligado, uma mudança posterior atualizando o site na mesclagem, o `npm ci` do fluxo, e o agente de documentação construindo o site com um modelo de verdade.
- Passagem support → product-owner: Refinar a #220 a partir deste documento: fechar as escolhas em aberto (gerador VitePress vs Jekyll, pasta e roteamento de squad do agente, referência incluída de docs/ vs movida, domínio próprio) e detalhar a aceitação em passos verificáveis. Fica fora desta etapa decidir prioridade e milestone. Vale confirmar no código, antes do plano, o formato exato do fluxo de Pages e a checagem de links/línguas no CI. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano técnico: decidir o agente, o fluxo e o encaminhamento à pasta do site (a spec recomenda um agente novo da pessoa, com sandbox, encaminhado a `site/`) e o que isso muda numa configuração que já tem o agente do fluxo de documentação de hoje; decidir a forma técnica de incluir a referência de `docs/` sem copiá-la (montagem, ligação ou equivalente); dizer como a construção do site, a checagem de links e a checagem das duas línguas entram no fluxo de verificação; e resolver como uma imagem guardada por uma etapa chega ao repositório, já que as ferramentas de arquivo do agente que escreve só a… <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementar o plano na ordem dos 9 commits, cada um com os gates do repositório verdes (auditoria pública, tipos, suíte, lint de idiomas, construção). Os quatro primeiros commits (1 a 4) são onde se decide o nome exato e a versão do gerador do site, se ele aceita a travessia da pasta de documentação sem uma lista de páginas escrita à mão, e se a checagem de links dele basta ou precisa do módulo próprio: construir o site e provocar um link quebrado e uma página de uma língua só. No commit 8, cobrir com um caso novo as recusas da cerca do agente que escreve quando o palco não é do fluxo de docum… <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: Revisar a implementação contra a spec (docs/cycles/[redacted]/1_SPEC.md) e o plano (2_PLAN.md), sem editar. Pontos que merecem atenção na revisão: (1) o bloco 8 do plano dizia para criar um caso novo em `test/runner-agent.test.ts` sobre `run.docs`; o caso foi criado em `test/runner-docs.test.ts`, onde vivem `confinedHooks` e os testes de cerca — a revisão deve decidir se isso satisfaz o plano ou se o caso deve morar no outro arquivo; (2) a linha de status dos README cita o endereço publicado (`exatasmente.github.io/coxia`), que o plano (D10) queria fora de qualquer arquivo — a spec (regra 12) … <!-- handoff:280 -->
- Passagem revisor-plataforma → developer: The documentation site change is rejected for one reason: the site's own link check cannot resolve a single link whenever the site is built with the base path the publishing workflow sets, which is the only environment in which the site is actually published. Building with SITE_BASE=/cerimonias/ (the value the workflow derives from the repository name) succeeds and writes use-cases/issue-to-pr.html, but the check then exits 1 with 2242 broken-link lines, because the check joins an absolute href to the built folder and never strips the base; with the default base the same command exits 0. The a… <!-- handoff:346 -->
