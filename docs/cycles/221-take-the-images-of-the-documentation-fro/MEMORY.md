# Memória do ciclo

## Decisões

- **A regeneração das imagens entra pela rota do pull request:** uma etapa de trabalho do release-flow (`release-images`, `display: true`), depois das atividades na branch e antes do corte; o que mudar em `docs/images/` segue para o PR. O corte (`scripts/release.sh`) não muda (D18). Nota: `m-8bb96df5`.
- O workspace semeado fica **fora do repositório**, descartável; a auditoria confere-o com `--root <dir>`.
- **Tela por etapa:** `display: true` abre a tela sem o interruptor `runner.sandbox.display`; a sandbox decide `opts.display && (opts.stageDisplay || opts.config.display)`. O executor lê o flag na lista viva do fluxo (`stageDisplayOf`), não no `FlowStage`.
- **A semente escreve o workspace `docs`** (`test: false`), nunca `principal`; semente neutra: `vcs: []`, cartões `#123`–`#125`, prefixo `docs#`.
- **A cerimônia sai do turno guardado** (`falas.json` com impressão digital); nenhum modelo é chamado.
- **Byte a byte:** `STILL_CLOCK` na janela de `call` e `SAME_PIXELS` em todo arranque.
- Respostas da pessoa: <!-- answer:99 --> <!-- answer:127 --> <!-- answer:1027 --> <!-- answer:1217 -->

## Restrições

- Repositório público: nada de nome real, host, número de issue ou segredo em semente, fixture, imagem, doc ou commit.
- Nenhum teste alcança modelo, host real ou rede.
- Tela virtual só no Linux; nunca a tela da pessoa.
- **D18:** `beta` e `stable` sempre esperam o "sim".
- A auditoria pública confere binário só pelo caminho: uma imagem precisa ser aberta para saber se leva nome real.

## Tentado e descartado

- Para `call`: estado no `localStorage`, `turns` no `historico/<id>.json`, `page.clock.install`.
- Esconder texto do fornecedor por folha de estilo; o que funciona é extrair o nó de texto.
- Só `--disable-gpu`/sRGB não bastou para o byte a byte.

## Perguntas abertas

- Telas que mudam no meio de um release: decide a pessoa; a etapa nunca segue calada.
- Imagem órfã: o plano não a recolhe na etapa do release (a conferência reprova a CI).
- A conferência não reconhece caminho relativo (`images/x.png`); sugestão, não mexida.

## Onde o trabalho está

- **Revisão rodada 4: aprovado.** Os bloqueantes anteriores foram tratados (imagens pt-BR abertas e limpas, perfil do celular em pasta temporária, texto de pendências removido).
- Gates relatados pela implementação (tsc, theme-audit, i18n:lint, public-audit, docs-images-check, vitest com 2 falhas por falta de `@playwright/mcp`, como na base); não reexecutados na revisão.
- **Sem verificação:** aceitação 4 (etapa com tela guardar imagem como comprovação), aceitação 6 (release refazer as imagens), byte a byte em outro computador, imagens em inglês.
- Passagem product-owner → pessoa: A spec está pronta para o gate humano; nada nela depende de leitura nova. Quem for planejar deve conferir três coisas no código antes de escrever o plano, porque a spec as trata como comportamento e não como desenho: (1) onde o veredito de tela do executor ganha o campo novo da etapa (hoje a expressão é outputKindOf(stage.kind) === 'qa' || (own && agent.screen === true && …) || wantsDisplay, em src/main/runner/executor.ts, e StageDef em src/shared/config/types.ts não tem campo de tela); (2) que um campo novo por etapa num template não quebre um workspace com o fluxo já salvo (a validação está … <!-- handoff:138 -->
- Passagem tl-plataforma → pessoa: A implementação segue a ordem do plano, um commit por passo. Antes de codar, três verificações que o plano já resolveu por leitura mas a implementação confirma no build: (1) que o campo `display` compila nos dois tipos (StageDef e FlowStage) e chega ao executor pelas duas leituras do veredito; (2) que `npm run i18n:lint -- --keys` passa com as chaves novas do release nos dois catálogos; (3) que os testes de template atualizados (lista ordenada) e o teste de tela com `stageDisplay` ficam verdes. Os passos 2 e 3 (semente e captura) exigem o app construído: rodar `npx electron-vite build` antes, … <!-- handoff:156 -->
- Passagem developer → revisor-plataforma: A revisão deve conferir o diff desta árvore contra o plano. Ponto de atenção principal: o plano dizia que o campo `display` iria para o `FlowStage` com mapeamento em `flowOf`, mas o código implementado lê o flag na lista viva do fluxo (`stageDisplayOf`, `src/main/runner/executor.ts:191`), como o `poolMode` ao lado — o `FlowStage` não carrega o campo e o `flowHash` não muda. Conferir também se o caso novo da conferência ("entrada da lista sem referência", `scripts/docs-images-check.mjs`) não é forte demais, e que ele não quebra as imagens listadas nos READMEs. O que segue sem verificação de pon… <!-- handoff:726 -->
- Passagem revisor-plataforma → developer: The branch delivers the seeded workspace, the capture scripts, the reference check, the per-stage `display` flag and the release-images stage, and every automated gate I ran passes (tsc, theme-audit, i18n:lint, public-audit, docs-images-check all exit 0; the suite is 435 files / 7298 tests green, with 4 environment-only browser files failing for a missing @playwright/mcp). The review blocks on the delivered images: read pixel by pixel, four of the five are not what the documentation says they are and two of them carry real names into a public repository — the wizard image shows the vendor and … <!-- handoff:782 -->
- Passagem developer → revisor-plataforma: O que falta, em ordem: (1) fazer a captura de `call` escrever a imagem — a tela da cerimónia abre no workspace semeado (conferido à mão), mas `node scripts/captures/run.mjs --only call` termina sem escrever `docs/images/call.png`, que ainda é a imagem antiga com o nome do provedor e as referências velhas; (2) regenerar `today`, `wizard` e `phone` com a semente nova — as três continuam as imagens antigas, com o nome real do host no `today` e os nomes do fornecedor do modelo no `wizard`; (3) correr os gates que faltam: `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-aud… <!-- handoff:881 -->
- Passagem pessoa → developer: Devolve e manda resolver <!-- handoff:1028 -->
- Passagem developer → revisor-plataforma: O bloqueio que resta é `docs/images/call.png` (e `call-en.png`): a cerimônia abre, mas o turno do agente falha e o aviso vermelho leva o nome do fornecedor do modelo (`main.llm.keyMissing` com `llm.anthropic`) para dentro do pixel. O próximo passo é descobrir por que o mapa `turns` do `historico/<id>.json` semeado não chega à tela: a cerimônia é retomada pela data do arquivo, e o app regrava o estado com `state:save` ao abrir — comparar o arquivo semeado com o que fica em disco depois de a janela abrir mostra onde o turno pronto se perde. Alternativa a decidir com o produto: aceitar a cerimôni… <!-- handoff:1200 -->
- Passagem revisor-plataforma → developer: The branch introduces the workspace seed, capture scripts, reference check, per-stage display flag, and release-images stage. Automated gates pass. However, the delivered images (docs_images/*.png) still show incorrect screens and real names (wizard.png shows model vendor, today.png/actions.png/phone.png show real host and issue numbers, call.png shows agent failure with model provider name). The phone capture leaves a browser profile in docs_images/.phone-profile. The images have not been regenerated with the corrected seed and scripts. [bloqueia] docs/images/wizard.png: The image shows the m… <!-- handoff:1226 -->
- Passagem developer → revisor-plataforma: A revisão deve conferir o diff contra o plano e contra a última revisão. Fechado e verificado nesta tentativa: `call.png`/`call-en.png` mostram o turno semeado, sem falha nem nome de fornecedor, e três execuções de `node scripts/captures/run.mjs` escrevem as dez imagens iguais byte a byte (ev-84, ev-85). As causas eram o relógio decorrido da cerimônia (`STILL_CLOCK`) e o ruído de rasterização (`SAME_PIXELS`). Gates: tsc, theme-audit, i18n:lint, public-audit e docs-images-check saem 0; vitest dá 7301 passando e 2 reprovando por falta de `@playwright/mcp`, como na base. Sem verificação: as aceit… <!-- handoff:1329 -->
