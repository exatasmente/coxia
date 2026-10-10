# Memória do ciclo

## Decisões

- **A regeneração das imagens entra pela rota do pull request**, não num passo novo depois do corte: é uma etapa de trabalho do fluxo de release, depois das atividades da versão na branch e antes de o corte ser pedido, com a tela ligada, e o que mudar em `docs/images/` segue para o pull request do release. Por quê: `scripts/release.sh` corta tudo de uma vez (bump, CHANGELOG, commit, tag anotada) e para antes de imprimir os pushes, e recusa árvore suja; os passos da release (`release-git`) só aceitam `{op, version, runId, pr, head, from, branch, channel}` e nunca caminho, comando ou flag (`docs/runner.md`, tabela dos passos; `src/shared/release.ts`); `beta` e `stable` sempre esperam o "sim" (D18). Nota guardada: `m-8bb96df5`.
- O workspace fictício da semeadura fica **fora do repositório**, descartável; o repositório versiona só a semente e os scripts de captura. A aceitação "a auditoria pública passa na pasta que ele escreveu" se confere apontando a auditoria para a pasta com `--root <dir>`. Não deve ficar na árvore nem ignorada.
- **Campo `display` da etapa:** aditivo, ausente vale `false`, sem migração e sem `defaults.ts` (não há padrão por etapa), esquema parado em 26. Nesta árvore a implementação resolveu melhor que o plano: `stageDisplayOf(config, run, stageId)` (`src/main/runner/executor.ts:191`) lê o flag na **lista viva do fluxo** (release/docs/squad/workspace), como o `stagePoolModeOf` ao lado; o `FlowStage` **não** carrega o campo e o `flowHash` não muda. As três leituras usam o mesmo valor: sandbox (`:451`), oferta de passagem (`:622`) e `hasDisplay` (`:664`). Nota guardada: `m-d0c9b907` (substitui o desenho antigo de `m-0bea24b8`).
- Resposta: já foi respondido <!-- answer:99 -->
- Resposta: o @team-lead respondeu <!-- answer:127 -->

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo em semente, fixture, imagem, doc ou commit. Placeholders neutros (`example.com`, `group/project`, `#123`).
- Nenhum teste pode alcançar modelo real, host real ou a rede; as fakes ficam em `test/helpers/`.
- A tela virtual é Linux, o app nunca usa a tela da pessoa.
- **D18:** `beta` e `stable` sempre esperam o "sim"; o corte roda `scripts/release.sh`, sem sandbox. Nada nesta mudança afrouxa isso.
- A auditoria pública confere binário só pelo caminho, nunca pelo conteúdo — uma imagem com dado real não é pega por ela; a guarda é a semente com placeholders e a revisão do pull request.
- **A conferência `docs-images-check.mjs` não tem o caso "script sem referência"** (o plano o descrevia): ela confere em uma direção (entrada→script existe, entrada→imagem existe, imagem→entrada existe) e, desde esta tentativa, também **entrada→alguma imagem referenciada**. A direção inversa (todo `*.mjs` de `scripts/captures/` está na lista) não é conferida em lugar nenhum — só o título de um teste a promete, e o título foi corrigido.

## Tentado e descartado

- Frentes de subagente morreram por limite de voltas no refinamento, no plano e nesta implementação (duas das quatro frentes); o que faltou foi conferido pela própria sessão (arquivo:linha).
- Descartado regenerar as imagens depois do corte, num passo novo.
- Descartado acrescentar uma chave em `defaults.ts` para o campo novo.
- Descartado fazer o caso "script sem referência" como literal (todo `*.mjs` da pasta na lista): quebraria `shared.mjs` e `run.mjs`, que não são funcionalidades. O que entrou foi "entrada da lista sem nenhuma imagem referenciada".

## Perguntas abertas

- O que fazer se as telas mudarem no meio de um ciclo de release: é da pessoa; a etapa nunca segue calada.
- Quem fecha o ciclo de uma imagem órfã: o plano **escolhe não recolher** na etapa do release (apagar é da pessoa; a conferência já reprova a CI).
- As dúvidas que a issue lista e a spec resolveu por omissão: a primeira lista (as cinco do README), o relógio fixo (datas relativas na semente + relógio falsificado na captura), a semeadura fora dos testes e um tema por imagem.

## Onde o trabalho está

- **Os passos 1 a 5 do plano estão implementados nesta árvore** (conferido por leitura na tentativa 4): `scripts/seed-docs-workspace.mjs`, `scripts/captures/{run,shared}.mjs` + `index.json` + um script por funcionalidade, `scripts/docs-images-check.mjs` e o passo na CI (`.github/workflows/ci.yml:36-38`), o campo `display` (schema em `src/shared/config/schema.ts:168`, `stageDisplayOf` em `executor.ts:191`), a etapa `release-images` (`releaseFlow.ts:23`, rank 4, `display: true`, agente `release-images` sandbox/worktree) com textos nos dois catálogos (`src/shared/i18n/{pt-BR,en}.json`), `docs/runner.md` nas duas passagens, e os testes `config-schema`, `runner-stage-screen`, `cycle-templates`, `seed-docs-workspace`, `captures-index`, `docs-images-check`.
- **A tentativa 4 fechou as lacunas:** o caso "entrada da lista sem referência" na conferência (`scripts/docs-images-check.mjs`) com o teste, o teste da oferta de passagem para a etapa com `display` (`test/runner-stage-screen.test.ts`, exige `hubFake(true)`), o título de `test/captures-index.test.ts` e um code span quebrado em `docs/images/README.md`.
- **Verificado rodando:** `npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` (5634 chaves), `node scripts/public-audit.mjs` (1667 arquivos) e `node scripts/docs-images-check.mjs` todos saem 0. A semente escreve 12 arquivos, recusa a segunda execução e passa `public-audit --root` na pasta. `npx electron-vite build` sai 0 e a captura de `today` nos dois idiomas escreveu as imagens; **duas execuções deram os mesmos hashes sha256** (igualdade byte a byte, aceitação 3, para essa funcionalidade).
- **Suíte:** 435 arquivos passam; 2 testes de navegador real falham por faltar `@playwright/mcp`/navegador neste computador (`browser-contract`, `browser-quit`, `browser-sites`, `browser-runtime`), sem relação com a mudança.
- **Não verificado:** captura das outras quatro funcionalidades e `run.mjs` inteiro; o app abrindo o workspace semeado sem aviso de migração; uma etapa com `display` guardando imagem como comprovação; um release refazendo as imagens e o pull request mostrando só o que mudou; o site da #220.
- Passagem implementação → revisão: o diff são os arquivos do `git status` (16 modificados + `scripts/captures/`, `scripts/docs-images-check.mjs`, `scripts/seed-docs-workspace.mjs` e 3 testes novos, + as 10 PNGs). O build (`out/`) é ignorado e não entra. A revisão deve conferir o desenho do `display` contra o plano (o plano dizia `FlowStage`, o código lê o fluxo ao vivo) e se o caso novo da conferência não é forte demais.
- Passagem product-owner → pessoa: A spec está pronta para o gate humano; nada nela depende de leitura nova. Quem for planejar deve conferir três coisas no código antes de escrever o plano, porque a spec as trata como comportamento e não como desenho: (1) onde o veredito de tela do executor ganha o campo novo da etapa (hoje a expressão é outputKindOf(stage.kind) === 'qa' || (own && agent.screen === true && …) || wantsDisplay, em src/main/runner/executor.ts, e StageDef em src/shared/config/types.ts não tem campo de tela); (2) que um campo novo por etapa num template não quebre um workspace com o fluxo já salvo (a validação está … <!-- handoff:138 -->
- Passagem tl-plataforma → pessoa: A implementação segue a ordem do plano, um commit por passo. Antes de codar, três verificações que o plano já resolveu por leitura mas a implementação confirma no build: (1) que o campo `display` compila nos dois tipos (StageDef e FlowStage) e chega ao executor pelas duas leituras do veredito; (2) que `npm run i18n:lint -- --keys` passa com as chaves novas do release nos dois catálogos; (3) que os testes de template atualizados (lista ordenada) e o teste de tela com `stageDisplay` ficam verdes. Os passos 2 e 3 (semente e captura) exigem o app construído: rodar `npx electron-vite build` antes, … <!-- handoff:156 -->
