# Memória do ciclo

## Decisões

- A #220 é pedido de funcionalidade: publicar um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog), escrito e mantido pelos agentes pelo ciclo normal. Squad `Plataforma`; prioridade proposta `priority:medium`. Gate 1 e Gate 2 aprovados pelo app.
- Refino fechou: gerador **VitePress**; pasta **`site/`**; referência **incluída de `docs/`**, nunca copiada; **domínio próprio fora do escopo**.
- Plano fechou o resto (2_PLAN.md): o agente de documentação é o **`docs-writer` que o modelo `docs-flow` já cria**, com `shell: 'none'` → `'sandbox'`. **Não** se cria um "onde escrever" no fluxo (custaria campo novo no esquema e migração).
- A versão estável que abre o blog é `0.8.0`; a linha de status dos README cita a versão do arquivo de versão (`0.9.0-beta.15`).
- Imagem guardada por etapa chega ao commit pelo mecanismo que já existe (`copyToCycleFolder`), **só** com `runner.evidence: "cycle"`.
- A contradição entre a regra 12 (a linha de status leva ao site) e o D10 do plano resolve-se a favor da spec: o endereço publicado fica nos dois README.
- **Revisão (rodada 1, commit 3898d756):** veredito `changes`, um bloqueante — a checagem de links não resolvia nada com o prefixo de publicação (`site/scripts/check.mjs:40`).
- **Revisão (rodada 2, commit 7d48af17):** veredito `changes`, um bloqueante **novo**: a correção do prefixo foi feita e conferida (a checagem lê o prefixo dos endereços de `assets/` da própria construção e o retira; na construção publicada a checagem sai 0), mas o arquivo da própria checagem ficou **3 de 18 casos vermelhos**. Dois desses vermelhos são o mesmo defeito: a mensagem de recuo da checagem de línguas (`site/scripts/check.mjs:139`, `candidatesOf(page)[0]`) pede o irmão `.pt-BR.md` para uma página de português sem par — um nome que o site nunca escreve, porque o par dele é o irmão em inglês ao lado (a forma `pt-br/`). O terceiro vermelho é o caso do link quebrado numa construção com prefixo, que monta a construção pela metade e por isso mede o estado do gerador. O terceiro pedido da rodada 1 (`runner.pt-br.md` com o link de volta de título `English`) não foi feito.
- Sugestões da rodada 2: a checagem de links mede o estado do gerador; a checagem ignora `src` (e `assetsOf`/`checkAssets` seguem sem uso); não há **link entre as duas línguas** nas páginas escritas à mão (a abertura, o guia, os casos de uso, o blog) — a regra 3 pede que sejam alcançáveis uma da outra, e a navegação não troca de endereço entre as línguas (a rodada 1 já registrara isto como "duas convenções"); e quatro links de host do site publicado apontam para `docs/docs/...`, caminho que não existe (defeito do commit 3898d756, `rewriteLinks`).
- Respostas da pessoa sobre abrir o pull request: contra `main` e contra `release/0.9.0` (a última: `main`). <!-- answer:313 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:301 --> <!-- answer:304 --> <!-- answer:307 --> <!-- answer:310 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:295 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:298 -->

## Restrições

- O repositório é público: `scripts/public-audit.mjs` é gate de CI e vale para as fontes do site. Nada de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros (`example.com`). Nenhuma exceção nova em `scripts/public-audit.allow.json`.
- `docs/` continua a fonte lida pelos agentes do aplicativo em tempo de execução: a referência é incluída no site, não movida nem copiada.
- Nada no aplicativo escreve Pages nem configuração de repositório: ligar o Pages é ato da pessoa no host.
- O esquema de configuração continua **27**, sem migração.
- Nenhuma string de interface entra aqui; o site não usa `t()` nem os tokens de tema do renderer.
- A cerca de escrita de um agente do ciclo não mudou; só a capacidade de rodar comandos na sandbox foi acrescentada.
- Ao construir o site na árvore de trabalho, apagar `site/generated/`, `site/.vitepress/dist/` e `site/.vitepress/cache/` antes de responder: não podem ir no commit da etapa.

## Tentado e descartado

- Fazer a própria checagem construir o site com um prefixo: descartado por custo (a construção leva minutos) e por duplicar o que o fluxo já faz.
- Exigir `SITE_BASE` no ambiente da checagem: descartado porque duas construções com prefixos diferentes podem coexistir e a checagem passaria a conferir uma com o prefixo da outra.
- Escrever o prefixo da construção num campo da página gerada para a checagem lê-lo: descartado; ler o prefixo dos endereços de `assets/` da própria página construída resolve sem inventar arquivo nem variável. **Feito e conferido na rodada 2.**
- Vincular o fluxo de documentação à pasta do site (`devCycle.flows.docs`): descartado (campo novo + migração + caminho de escrita novo).
- Mudar o padrão de `runner.evidence` para `cycle`: faria toda imagem de toda execução entrar em algum commit.
- Cópia descartável da árvore para medir o defeito dos links de host: `git archive` de um commit + symlink de `node_modules` resolve; `git worktree add` é recusado porque o worktree da etapa já tem a branch.

## Perguntas abertas

Nenhuma.

## Onde o trabalho está

- Triagem, refino e plano em 2026-10-10: `0_TRIAGE.md`, `1_SPEC.md` (14 regras, 14 critérios), `2_PLAN.md` (17 decisões, 9 blocos).
- **Implementação (tentativa 1, commit 3898d756):** `site/` com VitePress preso em 1.6.4; travessia de `docs/`; histórico e blog lidos do `CHANGELOG.md`; checagem de links e de línguas; `pages.yml`; linha de status dos README; `docsWriter()` com sandbox; `docs/site.md`; esquema 27.
- **Implementação (tentativa 2, commit 7d48af17, "strip the publishing base in the site link check"):** a checagem lê o prefixo da própria construção (`baseOf`, `withinBase`, `targetOf`, `checkLinks`); a regra de endereço vive só em `referenceRoute`; o par de línguas virou link escrito pelo gerador (`otherLanguageLink`); `assetsOf`/`checkAssets` foram acrescentados (483 arquivos carregados, 85 distintos, nenhum faltando) mas o gerador não os chama.
- **Revisão (rodada 2): `4_REVIEW.md`, veredito `changes`.** Rodados aqui: tipos (0), suíte (3 falham / 7668 passam), tema (0), idiomas (0), auditoria pública (0, 1733 arquivos), construção com `SITE_BASE=/cerimonias/` e a checagem sobre ela (0). Bloqueante: os 3 casos vermelhos de `test/site-check.test.ts` e a regra de candidatos em `check.mjs:139`.
- **Não verificado (nada disto foi exercitado):** a publicação no host, o site no ar, o Pages ligado, uma mudança posterior atualizando o site na mesclagem, o `npm ci` do fluxo, e o agente de documentação construindo o site com um modelo de verdade.
- Passagem revisor-plataforma → developer: os três vermelhos, a regra de candidatos de `check.mjs:139` e os portões a rodar (detalhado no handoff de 4_REVIEW.md).
- Passagem support → product-owner: Refinar a #220 a partir deste documento: fechar as escolhas em aberto (gerador VitePress vs Jekyll, pasta e roteamento de squad do agente, referência incluída de docs/ vs movida, domínio próprio) e detalhar a aceitação em passos verificáveis. Fica fora desta etapa decidir prioridade e milestone. Vale confirmar no código, antes do plano, o formato exato do fluxo de Pages e a checagem de links/línguas no CI. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano técnico: decidir o agente, o fluxo e o encaminhamento à pasta do site (a spec recomenda um agente novo da pessoa, com sandbox, encaminhado a `site/`) e o que isso muda numa configuração que já tem o agente do fluxo de documentação de hoje; decidir a forma técnica de incluir a referência de `docs/` sem copiá-la (montagem, ligação ou equivalente); dizer como a construção do site, a checagem de links e a checagem das duas línguas entram no fluxo de verificação; e resolver como uma imagem guardada por uma etapa chega ao repositório, já que as ferramentas de arquivo do agente que escreve só a… <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementar o plano na ordem dos 9 commits, cada um com os gates do repositório verdes (auditoria pública, tipos, suíte, lint de idiomas, construção). Os quatro primeiros commits (1 a 4) são onde se decide o nome exato e a versão do gerador do site, se ele aceita a travessia da pasta de documentação sem uma lista de páginas escrita à mão, e se a checagem de links dele basta ou precisa do módulo próprio: construir o site e provocar um link quebrado e uma página de uma língua só. No commit 8, cobrir com um caso novo as recusas da cerca do agente que escreve quando o palco não é do fluxo de docum… <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: Revisar a implementação contra a spec (docs/cycles/[redacted]/1_SPEC.md) e o plano (2_PLAN.md), sem editar. Pontos que merecem atenção na revisão: (1) o bloco 8 do plano dizia para criar um caso novo em `test/runner-agent.test.ts` sobre `run.docs`; o caso foi criado em `test/runner-docs.test.ts`, onde vivem `confinedHooks` e os testes de cerca — a revisão deve decidir se isso satisfaz o plano ou se o caso deve morar no outro arquivo; (2) a linha de status dos README cita o endereço publicado (`exatasmente.github.io/coxia`), que o plano (D10) queria fora de qualquer arquivo — a spec (regra 12) … <!-- handoff:280 -->
- Passagem revisor-plataforma → developer: The documentation site change is rejected for one reason: the site's own link check cannot resolve a single link whenever the site is built with the base path the publishing workflow sets, which is the only environment in which the site is actually published. Building with SITE_BASE=/cerimonias/ (the value the workflow derives from the repository name) succeeds and writes use-cases/issue-to-pr.html, but the check then exits 1 with 2242 broken-link lines, because the check joins an absolute href to the built folder and never strips the base; with the default base the same command exits 0. The a… <!-- handoff:346 -->
- Passagem developer → revisor-plataforma: Terminar a correção: deixar verdes os três casos vermelhos de test/site-check.test.ts (a fixture `underBase` precisa de um endereço `/assets/` para a checagem ler o prefixo; o caso de uma língua só produz duas entradas e a expectativa tem de decidir qual delas é a falha; o `runner.pt-br.md` precisa do link de volta com título `English`), limpar a frase de abertura de `site/guide/index.md` e `site/guide/pt-br/index.md`, decidir se `assetsOf`/`checkAssets` ficam (hoje sem uso nem teste) e conferir o bloco de código corrompido de `site/README.md`. Depois rodar os portões: `npx tsc --noEmit`, `npx… <!-- handoff:386 -->
