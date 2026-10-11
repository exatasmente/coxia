# Memória do ciclo

## Decisões

- **A regeneração das imagens entra pela rota do pull request**, não num passo novo depois do corte: é uma etapa de trabalho do fluxo de release, depois das atividades da versão na branch e antes de o corte ser pedido, com a tela ligada, e o que mudar em `docs/images/` segue para o pull request do release. Por quê: `scripts/release.sh` corta tudo de uma vez e recusa árvore suja; os passos da release (`release-git`) só aceitam `{op, version, runId, pr, head, from, branch, channel}`; `beta` e `stable` sempre esperam o "sim" (D18). Nota guardada: `m-8bb96df5`.
- O workspace fictício da semeadura fica **fora do repositório**, descartável; o repositório versiona só a semente e os scripts de captura. A aceitação "a auditoria pública passa na pasta que ele escreveu" confere-se com `--root <dir>`.
- **A tela por etapa (fechada nesta tentativa):** o campo `display: true` de uma etapa do fluxo passa a abrir a tela virtual sozinho, sem o interruptor `runner.sandbox.display`. `OpenOptions`/`HostOpenOptions` ganharam `stageDisplay`, o executor passa-o, e a conjunção da sandbox passou a `opts.display === true && (opts.stageDisplay === true || opts.config.display === true)`. A etapa de QA continua a exigir o interruptor do espaço de trabalho. Testes: `test/runner-stage-screen.test.ts` (29 passam, com dois casos a desligar o interruptor).
- **A semente é neutra:** `vcs: []` e `vcsId: null` (o vocabulário do app resolve "provedor de código"), cartões com o id/ref neutro `#123`/`#124`/`#125` (prefixo `docs#`), repo `docs`, chave de procedimento `example.com`.
- Resposta: já foi respondido <!-- answer:99 -->
- Resposta: o @team-lead respondeu <!-- answer:127 -->

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo em semente, fixture, imagem, doc ou commit. Placeholders neutros (`example.com`, `group/project`, `#123`).
- Nenhum teste pode alcançar modelo real, host real ou a rede; as fakes ficam em `test/helpers/`.
- A tela virtual é Linux, o app nunca usa a tela da pessoa.
- **D18:** `beta` e `stable` sempre esperam o "sim"; o corte roda `scripts/release.sh`, sem sandbox.
- **A auditoria pública confere binário só pelo caminho, nunca pelo conteúdo** — uma imagem com dado real não é pega por ela. É o achado bloqueante principal: a semente neutra não basta sozinha, a tela também desenha nomes que não vêm do dado semeado (o provedor do modelo no assistente de configuração, e a linha de atividade do turno).
- A semente escreve uma pasta `phone-data/` a mais (registry, `web.json`, sessão pareada), para a captura do celular abrir o companheiro; o `.gitignore` não a esconde porque ela não fica na árvore.

## Tentado e descartado

- **A captura de `call` por rotas indiretas, todas descartadas:** gravar o estado da cerimónia no `localStorage` (o app fecha a janela e limpa-o), um `falas.json` com os turnos já prontos e a impressão digital do cartão (o app não os serve — a tela pede o turno e o modelo não está configurado), importar a configuração semeada para dentro da pasta do app (`COXIA_TEST_IMPORT_FILE` funciona, mas não trouxe a cerimónia), e `page.clock.install` (mata a janela).
- Descartado acrescentar uma chave em `defaults.ts` para o campo novo.
- Descartado fazer o caso "script sem referência" como literal (quebraria `shared.mjs` e `run.mjs`).
- Frentes de subagente morreram por limite de voltas outra vez; o que faltou foi lido pela própria sessão.

## Perguntas abertas

- O que fazer se as telas mudarem no meio de um ciclo de release: é da pessoa; a etapa nunca segue calada.
- Quem fecha o ciclo de uma imagem órfã: o plano escolhe não recolher na etapa do release (a conferência já reprova a CI).
- **A captura da cerimónia (`call`) e a do celular (`phone`) precisam de decisão de desenho se não fecharem por comando:** uma cerimónia "em andamento" sem modelo mostra os turnos vazios e a linha de atividade do provedor; uma captura que não escreve a imagem não serve, e não há, hoje, uma rota de captura para a tela da cerimónia que não passe pelo modelo.

## Onde o trabalho está

- **Fechado e verificado nesta tentativa:** o campo de tela por etapa (`src/main/sandbox/index.ts`, `src/main/runner/executor.ts`, `test/runner-stage-screen.test.ts`); a semente neutra (`scripts/seed-docs-workspace.mjs`, `test/seed-docs-workspace.test.ts`); a captura da fila de ações (`scripts/captures/actions.mjs`, imagem aberta e lida); o `phone.mjs` reescrito para o modo web; a folha de estilo que esconde o relógio e a linha de atividade.
- **Verificado por comando:** `npx tsc --noEmit` (0), `npx vitest run test/runner-stage-screen.test.ts` (29), `test/seed-docs-workspace.test.ts` (9), `test/captures-index.test.ts` + `test/docs-images-check.test.ts` (17), `node scripts/seed-docs-workspace.mjs` (17 ficheiros), `node scripts/public-audit.mjs --root <pasta semeada>` (0), `npx electron-vite build` (0), `node scripts/captures/run.mjs --only actions --lang pt-BR` (0, imagem conferida).
- **Por fazer:** a captura de `call` não escreve a imagem (as corridas terminam com `page.evaluate: Application exited` e `docs/images/call.png` continua de 19:02, a cerimónia falhada); as de `today`, `wizard` e `phone` ainda são as antigas, com os nomes reais; os gates `theme-audit`, `i18n:lint`, `public-audit` da árvore, `docs-images-check` e a suíte não correram nesta tentativa; as aceitações 1 e 6 seguem sem verificação.
- **Passagem revisão → próxima etapa:** corrigir os achados antes de qualquer merge — as imagens, e depois as aceitações 1, 4 (o runtime está fechado, a comprovação da etapa com tela não) e 6.
- Passagem product-owner → pessoa: A spec está pronta para o gate humano; nada nela depende de leitura nova. Quem for planejar deve conferir três coisas no código antes de escrever o plano, porque a spec as trata como comportamento e não como desenho: (1) onde o veredito de tela do executor ganha o campo novo da etapa (hoje a expressão é outputKindOf(stage.kind) === 'qa' || (own && agent.screen === true && …) || wantsDisplay, em src/main/runner/executor.ts, e StageDef em src/shared/config/types.ts não tem campo de tela); (2) que um campo novo por etapa num template não quebre um workspace com o fluxo já salvo (a validação está … <!-- handoff:138 -->
- Passagem tl-plataforma → pessoa: A implementação segue a ordem do plano, um commit por passo. Antes de codar, três verificações que o plano já resolveu por leitura mas a implementação confirma no build: (1) que o campo `display` compila nos dois tipos (StageDef e FlowStage) e chega ao executor pelas duas leituras do veredito; (2) que `npm run i18n:lint -- --keys` passa com as chaves novas do release nos dois catálogos; (3) que os testes de template atualizados (lista ordenada) e o teste de tela com `stageDisplay` ficam verdes. Os passos 2 e 3 (semente e captura) exigem o app construído: rodar `npx electron-vite build` antes, … <!-- handoff:156 -->
- Passagem developer → revisor-plataforma: A revisão deve conferir o diff desta árvore contra o plano. Ponto de atenção principal: o plano dizia que o campo `display` iria para o `FlowStage` com mapeamento em `flowOf`, mas o código implementado lê o flag na lista viva do fluxo (`stageDisplayOf`, `src/main/runner/executor.ts:191`), como o `poolMode` ao lado — o `FlowStage` não carrega o campo e o `flowHash` não muda. Conferir também se o caso novo da conferência ("entrada da lista sem referência", `scripts/docs-images-check.mjs`) não é forte demais, e que ele não quebra as imagens listadas nos READMEs. O que segue sem verificação de pon… <!-- handoff:726 -->
- Passagem revisor-plataforma → developer: The branch delivers the seeded workspace, the capture scripts, the reference check, the per-stage `display` flag and the release-images stage, and every automated gate I ran passes (tsc, theme-audit, i18n:lint, public-audit, docs-images-check all exit 0; the suite is 435 files / 7298 tests green, with 4 environment-only browser files failing for a missing @playwright/mcp). The review blocks on the delivered images: read pixel by pixel, four of the five are not what the documentation says they are and two of them carry real names into a public repository — the wizard image shows the vendor and … <!-- handoff:782 -->
