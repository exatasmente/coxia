# Memória do ciclo

## Decisões

- **A regeneração das imagens entra pela rota do pull request:** uma etapa de trabalho do fluxo de release, depois das atividades da versão na branch e antes de o corte ser pedido, com a tela ligada; o que mudar em `docs/images/` segue para o pull request. Por quê: `scripts/release.sh` corta tudo de uma vez e recusa árvore suja; os passos da release (`release-git`) só aceitam `{op, version, runId, pr, head, from, branch, channel}`; `beta` e `stable` sempre esperam o "sim" (D18). Nota guardada: `m-8bb96df5`.
- O workspace fictício da semeadura fica **fora do repositório**, descartável; o repositório versiona só a semente e os scripts de captura. A auditoria pública confere-se com `--root <dir>`.
- **A tela por etapa está fechada:** `display: true` numa etapa abre a tela virtual sozinho, sem o interruptor `runner.sandbox.display`. `OpenOptions`/`HostOpenOptions` ganharam `stageDisplay`, o executor passa-o, e a conjunção da sandbox é `opts.display === true && (opts.stageDisplay === true || opts.config.display === true)`. A etapa de QA segue a exigir o interruptor. Testes: `test/runner-stage-screen.test.ts` (29 passam).
- **A semente agora escreve o workspace `docs`** (nome `Documentação`, `test: false`), e não `principal`: `principal` é o id que o app dá ao workspace novo (`FRESH_ID`, `src/main/workspaces-core.ts`), e o app descartava o registro semeado por causa disso e abria um workspace vazio com `setupComplete: false`. A semente é neutra: `vcs: []` e `vcsId: null`, cartões `#123`/`#124`/`#125` (prefixo `docs#`), repo `docs`, chave de procedimento `example.com`.
- **A configuração da web e a sessão do celular vão na raiz dos dados** (`web.json`, `web-sessions.json`), não numa pasta `phone-data/`: é onde o app as lê (`src/main/config.ts`, `src/main/webAccess.ts`). `phone-data/` deixou de existir.
- Resposta: já foi respondido <!-- answer:99 -->
- Resposta: o @team-lead respondeu <!-- answer:127 -->
- Resposta: Devolve e manda resolver <!-- answer:1027 -->

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo em semente, fixture, imagem, doc ou commit. Placeholders neutros (`example.com`, `group/project`, `#123`).
- Nenhum teste pode alcançar modelo real, host real ou a rede; as fakes ficam em `test/helpers/`.
- A tela virtual é Linux, o app nunca usa a tela da pessoa.
- **D18:** `beta` e `stable` sempre esperam o "sim"; o corte roda `scripts/release.sh`, sem sandbox.
- **A auditoria pública confere binário só pelo caminho, nunca pelo conteúdo** — uma imagem com dado real não é pega por ela. A semente neutra não basta: as telas desenham nomes que não vêm do dado (o provedor do modelo no assistente, o vocabulário do host quando a configuração não traz integração, e o texto de falha do agente).
- O app não tem roteador por fragmento: o único endereço lido ao abrir é `location.search` (`?open=…`, `src/renderer/src/App.tsx`). Captura de tela se guia por clique, não por `#`.

## Tentado e descartado

- **A captura de `call` por rotas indiretas, todas descartadas:** gravar o estado da cerimônia no `localStorage`, um `falas.json` com os turnos já prontos, importar a configuração semeada para dentro da pasta do app e `page.clock.install` (mata a janela).
- Esconder o texto que nomeia o fornecedor com folha de estilo: o texto continua no HTML da captura. O que funciona é extrair o nó mais fundo que o contém.
- Descartado acrescentar uma chave em `defaults.ts` para o campo novo, e fazer o caso "script sem referência" como literal.
- Frentes de subagente morrem por limite de voltas: dividir em frentes de 3-5 perguntas com resposta em `arquivo:linha`.

## Perguntas abertas

- O que fazer se as telas mudarem no meio de um ciclo de release: é da pessoa; a etapa nunca segue calada.
- Quem fecha o ciclo de uma imagem órfã: o plano escolhe não recolher na etapa do release (a conferência já reprova a CI).
- **A cerimônia (`call`) precisa de decisão de desenho:** a captura abre a tela certa (pauta, cartão, "Aguardando você"), mas o turno do agente falha por falta de chave e o aviso vermelho leva o nome do fornecedor para dentro do PNG. O mapa `turns` do `historico/<id>.json` semeado não é lido — o app regrava o estado retomado com `state:save` ao abrir, e é ali que o turno pronto se perde (não confirmado).

## Onde o trabalho está

- **Fechado e verificado:** o campo de tela por etapa; a semente neutra e agora **reconhecida pelo app** (workspace `docs`, `test: false`, web na raiz); a etapa `release-images` do template; a conferência `scripts/docs-images-check.mjs`; e as capturas de `today`, `actions`, `wizard` e `phone`, nos dois idiomas, abertas e conferidas uma a uma (sem nome real, mostrando a tela prometida; `wizard-en` em inglês; `phone` no modo web a 390 px). `node scripts/captures/run.mjs` escreve as dez imagens de `index.json`. Gates nesta rodada: `tsc`, `theme-audit`, `i18n:lint`, `public-audit` (1669 arquivos), `public-audit --root` (15 arquivos) e `docs-images-check`, todos 0; `vitest run` 7300 passam, com 2 reprovando por faltar `@playwright/mcp` neste computador (mesmo estado da base).
- **Aberto:** `call.png`/`call-en.png` mostram a cerimônia falhada, com `llm.anthropic` no aviso.
- **Sem verificação:** as aceitações 4 (a etapa com tela guardar a imagem como comprovação), 6 (um release refazer as imagens) e a igualdade byte a byte entre duas execuções. A aceitação 1 foi exercitada à mão e passa.
- **Árvore de trabalho no fim desta etapa:** limpa, sem arquivos não rastreados; as alterações são a semente, os quatro roteiros de captura, o runner, as dez imagens, o README da pasta das imagens, o teste da semente e os documentos do ciclo.
- Passagem product-owner → pessoa: A spec está pronta para o gate humano; nada nela depende de leitura nova. Quem for planejar deve conferir três coisas no código antes de escrever o plano, porque a spec as trata como comportamento e não como desenho: (1) onde o veredito de tela do executor ganha o campo novo da etapa (hoje a expressão é outputKindOf(stage.kind) === 'qa' || (own && agent.screen === true && …) || wantsDisplay, em src/main/runner/executor.ts, e StageDef em src/shared/config/types.ts não tem campo de tela); (2) que um campo novo por etapa num template não quebre um workspace com o fluxo já salvo (a validação está … <!-- handoff:138 -->
- Passagem tl-plataforma → pessoa: A implementação segue a ordem do plano, um commit por passo. Antes de codar, três verificações que o plano já resolveu por leitura mas a implementação confirma no build: (1) que o campo `display` compila nos dois tipos (StageDef e FlowStage) e chega ao executor pelas duas leituras do veredito; (2) que `npm run i18n:lint -- --keys` passa com as chaves novas do release nos dois catálogos; (3) que os testes de template atualizados (lista ordenada) e o teste de tela com `stageDisplay` ficam verdes. Os passos 2 e 3 (semente e captura) exigem o app construído: rodar `npx electron-vite build` antes, … <!-- handoff:156 -->
- Passagem developer → revisor-plataforma: A revisão deve conferir o diff desta árvore contra o plano. Ponto de atenção principal: o plano dizia que o campo `display` iria para o `FlowStage` com mapeamento em `flowOf`, mas o código implementado lê o flag na lista viva do fluxo (`stageDisplayOf`, `src/main/runner/executor.ts:191`), como o `poolMode` ao lado — o `FlowStage` não carrega o campo e o `flowHash` não muda. Conferir também se o caso novo da conferência ("entrada da lista sem referência", `scripts/docs-images-check.mjs`) não é forte demais, e que ele não quebra as imagens listadas nos READMEs. O que segue sem verificação de pon… <!-- handoff:726 -->
- Passagem revisor-plataforma → developer: The branch delivers the seeded workspace, the capture scripts, the reference check, the per-stage `display` flag and the release-images stage, and every automated gate I ran passes (tsc, theme-audit, i18n:lint, public-audit, docs-images-check all exit 0; the suite is 435 files / 7298 tests green, with 4 environment-only browser files failing for a missing @playwright/mcp). The review blocks on the delivered images: read pixel by pixel, four of the five are not what the documentation says they are and two of them carry real names into a public repository — the wizard image shows the vendor and … <!-- handoff:782 -->
- Passagem developer → revisor-plataforma: O que falta, em ordem: (1) fazer a captura de `call` escrever a imagem — a tela da cerimónia abre no workspace semeado (conferido à mão), mas `node scripts/captures/run.mjs --only call` termina sem escrever `docs/images/call.png`, que ainda é a imagem antiga com o nome do provedor e as referências velhas; (2) regenerar `today`, `wizard` e `phone` com a semente nova — as três continuam as imagens antigas, com o nome real do host no `today` e os nomes do fornecedor do modelo no `wizard`; (3) correr os gates que faltam: `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-aud… <!-- handoff:881 -->
- Passagem pessoa → developer: Devolve e manda resolver <!-- handoff:1028 -->
