# Memória do ciclo

## Decisões

- #220 pede um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog) escrito e mantido pelos agentes pelo ciclo normal. Squad `Plataforma`; `priority:medium`; gates 1 e 2 aprovados pelo app.
- Refino fechou: gerador **VitePress**; pasta **`site/`**; referência **incluída de `docs/`**, nunca copiada; domínio próprio fora do escopo.
- Plano: o agente `docs-writer` do modelo `docs-flow` passa a ter `shell: 'sandbox'` (permissão `worktree` continua); esquema continua **27**, sem migração. Onde a máquina não tem sandbox, o modelo baixa `sandbox` para os comandos de antes.
- Versão que abre o blog: **0.8.0** (estável); a linha de status dos dois README cita a versão do arquivo de versão e leva ao endereço publicado (contraria a D10 do plano a favor da regra 12).
- Imagem de etapa só chega ao commit com `runner.evidence: "cycle"` (o padrão é `app`); nada muda o padrão.
- O prefixo de publicação nunca vive em arquivo: a construção o recebe do fluxo e a checagem o lê da própria construção (`baseOf`, `withinBase`, `targetOf`).
- A checagem de línguas nomeia o par pela forma que o site escreve: pasta `pt-br/` para páginas escritas à mão, marca `.pt-br` e endereço `/reference/…` para páginas geradas.
- **Páginas de referência são julgadas pelo documento, não pelo gerado.** A checagem decide pela coluna de línguas do índice de `docs/` (`declaredLanguages`): documento declarado bilíngue exige a página inglesa sem a marca `site: one-language`, com o link de par e o arquivo `.pt-br`; declarado em uma língua só não exige par. `otherLanguageLink` lê as duas formas do link (HTML e Markdown).
- Resposta: Volta e resolve <!-- answer:761 --> <!-- answer:493 -->
- O pull request está sendo aberto contra a branch `main` (também já foi aberto contra `release/0.9.0` em rodadas anteriores).
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:295 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:298 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:301 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:304 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:307 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:310 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:313 -->

## Restrições

- Repositório público: `node scripts/public-audit.mjs` é portão e vale para as fontes do site; nada de empresa, pessoa, host privado, número real de issue ou segredo; nenhuma exceção nova em `scripts/public-audit.allow.json` (segue com duas entradas).
- `docs/` continua sendo a fonte lida pelos agentes; a referência é incluída, não copiada. `CONFIG_SCHEMA_VERSION` segue 27.
- Nada da construção entra no commit: `site/generated/`, `site/.vitepress/dist/` e `site/.vitepress/cache/` são ignorados.
- A cerca de escrita do agente que escreve não mudou; só a capacidade de rodar comandos na sandbox foi acrescentada. Nenhuma string de interface do desktop passa pelo site.
- `runner.evidence: "cycle"` é escolha da pessoa, nunca o padrão.

## Tentado e descartado

- Exigir `SITE_BASE` no ambiente da checagem: descartado; o prefixo é lido da construção.
- Escrever o prefixo num campo da página gerada: descartado; os endereços de `assets/` já o dizem.
- Vincular o fluxo de documentação à pasta do site (`devCycle.flows.docs`): descartado (campo novo, migração, caminho de escrita novo).
- Deduzir a língua declarada lendo só o arquivo do documento: descartado; um documento que perdeu a metade lê como uma língua só — por isso a checagem lê o índice de `docs/`.
- Exigir o link entre as duas línguas nas páginas escritas à mão: permanece sugestão, não coberta.

## Perguntas abertas

Nenhuma.

## Onde o trabalho está

- Triagem, refino e plano: `0_TRIAGE.md`, `1_SPEC.md` (14 regras, 14 critérios), `2_PLAN.md` (17 decisões, 9 blocos).
- Implementação: `site/` com VitePress preso em 1.6.4; travessia de `docs/`; blog e histórico do `CHANGELOG.md`; `pages.yml`; linha de status dos README; `docsWriter()` com sandbox; `docs/site.md`; esquema 27.
- **Rodadas 1 a 4 da revisão:** veredicto `changes` nas quatro (base de links com o prefixo de publicação; nome do par errado; `generated/` fora do alcance; checagem julgando o gerado e não o documento; typecheck e suíte vermelhos).
- **Rodada 5 (esta): veredicto `approved`.** Os dois bloqueantes da rodada 4 estão fechados e conferidos: o critério 13 pega as duas falhas na construção de verdade (remover a metade `## Português` de `docs/memory.md` com `SITE_BASE=/cerimonias/` faz `docs:check` sair 1 nomeando `/reference/memory`; a árvore saudável sai 0; um link injetado sob o prefixo é nomeado), `npx tsc --noEmit` sai 0 e os 8 arquivos de teste do site/README passam (213 casos). A suíte inteira tem 8 falhas, todas em `test/conflict-resolve.test.ts`, arquivo que esta branch não toca e que passa 22/22 isolado — disputa de recursos entre processos paralelos, não regressão.
- Verificado na árvore: theme-audit, i18n:lint e public-audit (1734) em 0; sugestões não bloqueantes seguem abertas (endereço dos README aceitar qualquer host; a checagem de links não olhar `src`; as páginas escritas à mão não ligarem as línguas por link).
- Não verificado: o site no ar, o Pages ligado no host, uma mudança posterior em `docs/`/`CHANGELOG.md` atualizando o site na mesclagem, e o agente de documentação construindo o site com um modelo de verdade.
- Passagem revisor-plataforma → QA: conferir na prévia local as seis seções nas duas línguas, a referência alcançável por documento, e os espaços reservados no lugar de imagens.
- Passagem developer → revisor-plataforma (rodada 5): confirmar o critério 13, o typecheck e a suíte verdes, e que a correção do link de língua não enfraqueceu o caso da página escrita à mão. <!-- handoff:887 -->
- Passagens anteriores (cronologia resumida): support → product-owner (refinar a #220) <!-- handoff:11 -->; product-owner → pessoa (plano técnico) <!-- handoff:22 -->; tl-plataforma → pessoa (implementar) <!-- handoff:49 -->; reviews e retrabalhos das rodadas 1 a 4 <!-- handoff:280 --> <!-- handoff:386 --> <!-- handoff:577 --> <!-- handoff:626 --> <!-- handoff:705 --> <!-- handoff:762 -->.
- Passagem revisor-plataforma → developer: The documentation site change is rejected for one reason: the site's own link check cannot resolve a single link whenever the site is built with the base path the publishing workflow sets, which is the only environment in which the site is actually published. Building with SITE_BASE=/cerimonias/ (the value the workflow derives from the repository name) succeeds and writes use-cases/issue-to-pr.html, but the check then exits 1 with 2242 broken-link lines, because the check joins an absolute href to the built folder and never strips the base; with the default base the same command exits 0. The a… <!-- handoff:346 -->
- Passagem pessoa → developer: Volta e pede o ajuste que falta e somente os que faltam <!-- handoff:494 -->
