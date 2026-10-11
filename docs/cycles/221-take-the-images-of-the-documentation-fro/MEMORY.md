# Memória do ciclo

## Decisões

- **A regeneração das imagens entra pela rota do pull request:** uma etapa de trabalho do release-flow (`release-images`, `display: true`), depois das atividades na branch e antes do corte; o que mudar em `docs/images/` segue para o PR. O corte (`scripts/release.sh`) não muda (D18). Nota: `m-8bb96df5`.
- O workspace semeado fica **fora do repositório**, descartável; a auditoria confere-o com `--root <dir>`.
- **Tela por etapa:** `display: true` abre a tela sem o interruptor `runner.sandbox.display`; a sandbox decide `opts.display && (opts.stageDisplay || opts.config.display)`. O executor lê o flag na lista viva do fluxo (`stageDisplayOf`), não no `FlowStage`.
- **A semente escreve o workspace `docs`** (`test: false`), nunca `principal` (o `FRESH_ID` do app); web e sessões do celular na raiz dos dados. Semente neutra: `vcs: []`, cartões `#123`–`#125`, prefixo `docs#`.
- **A cerimônia sai do turno guardado:** a semente escreve em `falas.json` um turno por cartão com a impressão digital do app (`fingerprint`, `src/main/falas-core.ts`), e o relógio do processo principal fica no dia fixo. Nenhum modelo é chamado; a captura recusa a foto se a tela mostrar `llm.`.
- **Byte a byte:** a janela de `call` tem o relógio parado (`STILL_CLOCK`), e todo arranque recebe `SAME_PIXELS` (sem GPU, sRGB, sem texto subpixel, um fio de rasterização, sem rasterização parcial, sem otimizações do Skia).
- Respostas da pessoa: <!-- answer:99 --> <!-- answer:127 --> <!-- answer:1027 --> <!-- answer:1217 -->

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo em semente, fixture, imagem, doc ou commit.
- Nenhum teste alcança modelo, host real ou rede; fakes em `test/helpers/`.
- Tela virtual só no Linux; nunca a tela da pessoa.
- **D18:** `beta` e `stable` sempre esperam o "sim".
- A auditoria pública confere binário só pelo caminho: uma imagem precisa ser aberta para saber se leva nome real. As telas desenham nomes que não vêm do dado (fornecedor do modelo, vocabulário do host, texto de falha).
- O app não tem roteador por fragmento: a captura se guia por clique.

## Tentado e descartado

- Para `call`: estado no `localStorage`, `turns` no `historico/<id>.json` (o app não os lê), importar a configuração, `page.clock.install` (mata a janela).
- Esconder texto do fornecedor por folha de estilo (fica no HTML); o que funciona é extrair o nó de texto.
- Só `--disable-gpu`/sRGB/sem LCD/hinting não bastou para o byte a byte; faltavam as três chaves de rasterização.
- Subagentes morrem por limite de voltas: frentes de 3–5 perguntas.

## Perguntas abertas

- Telas que mudam no meio de um release: decide a pessoa; a etapa nunca segue calada.
- Imagem órfã: o plano não a recolhe na etapa do release (a conferência já reprova a CI).
- A conferência de referências não reconhece caminho relativo (`images/x.png`); sugestão da revisão, não mexida.

## Onde o trabalho está

- **Fechado e verificado:** o campo de tela por etapa, a semente reconhecida pelo app, a etapa `release-images`, a conferência `scripts/docs-images-check.mjs`, e as dez imagens (5 telas × 2 idiomas) sem nome real e mostrando a tela prometida. `call` mostra o turno semeado, \"Ao vivo · 0:00\" (ev-85). Três execuções de `run.mjs` escrevem as dez imagens iguais byte a byte (ev-84).
- **Gates nesta tentativa:** build, tsc, theme-audit, i18n:lint, public-audit (1669) e docs-images-check saem 0; vitest dá 7301 passando e 2 reprovando por falta de `@playwright/mcp` (o mesmo na base).
- **Sem verificação:** aceitação 4 (a etapa com tela guardar imagem como comprovação, na sandbox e no computador), aceitação 6 (o release refazer as imagens) e o byte a byte em outro computador.
- Árvore: só arquivos rastreados alterados (semente, roteiros de captura, `run.mjs`, `shared.mjs`, imagens, teste da semente, documentos do ciclo).
- Passagem product-owner → pessoa: A spec está pronta para o gate humano; nada nela depende de leitura nova. Quem for planejar deve conferir três coisas no código antes de escrever o plano, porque a spec as trata como comportamento e não como desenho: (1) onde o veredito de tela do executor ganha o campo novo da etapa (hoje a expressão é outputKindOf(stage.kind) === 'qa' || (own && agent.screen === true && …) || wantsDisplay, em src/main/runner/executor.ts, e StageDef em src/shared/config/types.ts não tem campo de tela); (2) que um campo novo por etapa num template não quebre um workspace com o fluxo já salvo (a validação está … <!-- handoff:138 -->
- Passagem tl-plataforma → pessoa: A implementação segue a ordem do plano, um commit por passo. Antes de codar, três verificações que o plano já resolveu por leitura mas a implementação confirma no build: (1) que o campo `display` compila nos dois tipos (StageDef e FlowStage) e chega ao executor pelas duas leituras do veredito; (2) que `npm run i18n:lint -- --keys` passa com as chaves novas do release nos dois catálogos; (3) que os testes de template atualizados (lista ordenada) e o teste de tela com `stageDisplay` ficam verdes. Os passos 2 e 3 (semente e captura) exigem o app construído: rodar `npx electron-vite build` antes, … <!-- handoff:156 -->
- Passagem developer → revisor-plataforma: A revisão deve conferir o diff desta árvore contra o plano. Ponto de atenção principal: o plano dizia que o campo `display` iria para o `FlowStage` com mapeamento em `flowOf`, mas o código implementado lê o flag na lista viva do fluxo (`stageDisplayOf`, `src/main/runner/executor.ts:191`), como o `poolMode` ao lado — o `FlowStage` não carrega o campo e o `flowHash` não muda. Conferir também se o caso novo da conferência ("entrada da lista sem referência", `scripts/docs-images-check.mjs`) não é forte demais, e que ele não quebra as imagens listadas nos READMEs. O que segue sem verificação de pon… <!-- handoff:726 -->
- Passagem revisor-plataforma → developer: The branch delivers the seeded workspace, the capture scripts, the reference check, the per-stage `display` flag and the release-images stage, and every automated gate I ran passes (tsc, theme-audit, i18n:lint, public-audit, docs-images-check all exit 0; the suite is 435 files / 7298 tests green, with 4 environment-only browser files failing for a missing @playwright/mcp). The review blocks on the delivered images: read pixel by pixel, four of the five are not what the documentation says they are and two of them carry real names into a public repository — the wizard image shows the vendor and … <!-- handoff:782 -->
- Passagem developer → revisor-plataforma: O que falta, em ordem: (1) fazer a captura de `call` escrever a imagem — a tela da cerimónia abre no workspace semeado (conferido à mão), mas `node scripts/captures/run.mjs --only call` termina sem escrever `docs/images/call.png`, que ainda é a imagem antiga com o nome do provedor e as referências velhas; (2) regenerar `today`, `wizard` e `phone` com a semente nova — as três continuam as imagens antigas, com o nome real do host no `today` e os nomes do fornecedor do modelo no `wizard`; (3) correr os gates que faltam: `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-aud… <!-- handoff:881 -->
- Passagem pessoa → developer: Devolve e manda resolver <!-- handoff:1028 -->
- Passagem developer → revisor-plataforma: O bloqueio que resta é `docs/images/call.png` (e `call-en.png`): a cerimônia abre, mas o turno do agente falha e o aviso vermelho leva o nome do fornecedor do modelo (`main.llm.keyMissing` com `llm.anthropic`) para dentro do pixel. O próximo passo é descobrir por que o mapa `turns` do `historico/<id>.json` semeado não chega à tela: a cerimônia é retomada pela data do arquivo, e o app regrava o estado com `state:save` ao abrir — comparar o arquivo semeado com o que fica em disco depois de a janela abrir mostra onde o turno pronto se perde. Alternativa a decidir com o produto: aceitar a cerimôni… <!-- handoff:1200 -->
- Passagem revisor-plataforma → developer: The branch introduces the workspace seed, capture scripts, reference check, per-stage display flag, and release-images stage. Automated gates pass. However, the delivered images (docs_images/*.png) still show incorrect screens and real names (wizard.png shows model vendor, today.png/actions.png/phone.png show real host and issue numbers, call.png shows agent failure with model provider name). The phone capture leaves a browser profile in docs_images/.phone-profile. The images have not been regenerated with the corrected seed and scripts. [bloqueia] docs/images/wizard.png: The image shows the m… <!-- handoff:1226 -->
