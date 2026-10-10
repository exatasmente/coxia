# O workspace fictício, as capturas, a conferência de referências, o campo de tela por etapa e a etapa do release

Resumo do que existe nesta árvore depois da implementação, e do que foi conferido rodando. Os passos 1 a 5 do plano já estavam feitos quando esta tentativa começou; ela fechou as lacunas que faltavam (o caso "lista sem referência" na conferência, o teste da oferta de passagem, o título de um teste e a quebra de um code span no README das imagens) e correu os gates.

## O que foi entregue

- **Workspace fictício** — `scripts/seed-docs-workspace.mjs` escreve um workspace completo (configuração na versão de esquema corrente, time com os cinco agentes de sistema e um time de produto, duas execuções, quadro, conversa, procedimentos, ata e celular pareado) numa pasta indicada na linha de comando, e se recusa a escrever numa pasta que já guarda um workspace. Fica fora do repositório; só o script é versionado.
- **Scripts de captura** — `scripts/captures/` tem `run.mjs`, `shared.mjs`, `index.json` e um script por funcionalidade (`today`, `call`, `actions`, `wizard`, `phone`). Abrem o aplicativo **construído** sobre o workspace semeado, com janela, tema, idioma e relógio fixos e animações desligadas, e escrevem `docs/images/<id>[-en].png`. O `wizard` sai de uma pasta de dados vazia.
- **Conferência de referências** — `scripts/docs-images-check.mjs` compara o que é usado com o que existe, dentro do job `check` da CI (`.github/workflows/ci.yml:36-38`).
- **Campo de tela por etapa** — uma etapa de fluxo pode declarar `display: true` (ausente vale `false`). Nesta árvore o campo é resolvido por `stageDisplayOf` (`src/main/runner/executor.ts:191`), que lê a lista viva do fluxo como o `poolMode` ao lado; o executor usa esse valor na abertura da sandbox (`:451`), na oferta de passagem (`:622`) e no `hasDisplay` da tela (`:664`), e o `FlowStage` não carrega o campo.
- **Etapa do release** — `releaseFlow.ts` ganha a etapa `release-images` (rank 4, `display: true`) entre `release-assemble` e a espera `release-approved`, com o agente `release-images` (sandbox, `permission: 'worktree'`), os textos e os comentários nos dois catálogos. O corte do release não foi tocado.
- **Imagens e textos** — as dez imagens de `docs/images/` existem e os dois READMEs, `docs/README.md` e `docs/images/README.md` as referenciam; a tabela de pendências saiu. O `CHANGELOG.md` tem a entrada na seção `[Unreleased]`.

## O que esta tentativa mudou

- `scripts/docs-images-check.mjs` — acrescentado o caso que faltava: uma entrada da lista que a documentação nunca referencia agora é divergência (antes, uma imagem listada e não usada passava calada). O comentário do topo foi alinhado.
- `test/docs-images-check.test.ts` — caso novo `refuses an entry of the list the documentation never references`.
- `test/runner-stage-screen.test.ts` — caso novo `offers the hand-off to a stage that asks for the display of the flow, without the agent's switch` (a segunda leitura do veredito de tela, que o plano nomeia como risco).
- `test/captures-index.test.ts` — o título do primeiro caso dizia mais do que ele afirma; o título foi corrigido.
- `docs/images/README.md` — a linha do comando de auditoria tinha um code span aberto atravessando a quebra de linha; corrigido.

## O que foi verificado

Rodado nesta árvore, com o resultado de cada um:

- `npx tsc --noEmit` — sai 0.
- `npx vitest run` — 435 arquivos passam; 2 testes falham em `browser-contract`, `browser-quit`, `browser-sites` e `browser-runtime`, todos por faltar `@playwright/mcp` ou navegador real neste computador; não tocam o que esta mudança mexeu (`ls node_modules/@playwright` → inexistente).
- `node scripts/theme-audit.mjs` — sai 0.
- `npm run i18n:lint` — sai 0, 5634 chaves nos dois idiomas.
- `node scripts/public-audit.mjs` — sai 0, 1667 arquivos.
- `node scripts/docs-images-check.mjs` — sai 0 (a lista, os scripts e as imagens se correspondem).
- `node scripts/seed-docs-workspace.mjs <pasta vazia>` — sai 0, escreve 12 arquivos; segunda execução sobre a mesma pasta é recusada com mensagem (sai 1); `node scripts/public-audit.mjs --root <pasta semeada>` sai 0.
- `npx electron-vite build` — sai 0; e a captura de `today` nos dois idiomas sobre o workspace semeado escreveu `docs/images/today.png` e `today-en.png`. Duas execuções separadas produziram os mesmos hashes sha256, ou seja, os mesmos arquivos byte a byte.

## O que não foi verificado

- A captura das outras quatro funcionalidades e o `run.mjs` inteiro não foram rodados; só `today` foi exercitada de ponta a ponta.
- Não foi aberta a interface para ver o workspace semeado sem aviso de migração, nem uma etapa com `display` guardando imagem como comprovação e sendo vista.
- Não foi rodado um release para ver a etapa `release-images` refazendo as imagens e o pull request mostrando só o que mudou.
- Não foi tocado nem verificado o site de documentação (a #220), que o plano deixa fora de escopo.
