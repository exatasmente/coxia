# Memória do ciclo

## Decisões

- **A regeneração das imagens entra pela rota do pull request**, não num passo novo depois do corte: é uma etapa de trabalho do fluxo de release, depois das atividades da versão na branch e antes de o corte ser pedido, com a tela ligada, e o que mudar em `docs/images/` segue para o pull request do release. Por quê: `scripts/release.sh` corta tudo de uma vez (bump, CHANGELOG, commit, tag anotada) e para antes de imprimir os pushes, e recusa árvore suja; os passos da release (`release-git`) só aceitam `{op, version, runId, pr, head, from, branch, channel}` e nunca caminho, comando ou flag (`docs/runner.md`, tabela dos passos; `src/shared/release.ts`); `beta` e `stable` sempre esperam o "sim" (D18); as etapas declaradas do `release-flow` não têm nenhuma de documentação (`src/shared/cycles/templates/releaseFlow.ts`). A spec não promete número de versão futuro: o ciclo de release seguinte captura de novo. Nota guardada: `m-8bb96df5`.
- O workspace fictício da semeadura fica **fora do repositório**, descartável; o repositório versiona só o script de semeadura e os de captura. A aceitação "a auditoria pública passa na pasta que ele escreveu" se confere apontando a auditoria para a pasta com `--root <dir>` (já existe, documentado como uso de teste em `scripts/public-audit.mjs`). Não deve ficar na árvore nem ignorada: `--exclude-standard` esconderia uma pasta ignorada.
- **Campo `display` da etapa:** a spec pede o campo na etapa do fluxo (é o que a issue pede); o campo é aditivo e ausente vale `false`, sem migração. Regra de esquema do squad: aqui é `types.ts` (etapa e fluxo) + `schema.ts`; o `defaults.ts` não entra porque não há padrão por etapa a gravar (mesmo caso de `testEnv` e `poolMode`).
- **O campo `display` toca mais do que uma linha** (achado do plano, tentativa 2, conferido por leitura): `FlowStage` precisa carregar o campo e `flowOf` precisa mapeá-lo (o executor lê o FlowStage), o `flowHash` muda com o campo novo, e o veredito de tela tem uma **segunda** leitura (a oferta de passagem) que muda junto. Nota guardada: `m-0bea24b8`.
- Resposta: já foi respondido <!-- answer:99 -->
- Resposta: o @team-lead respondeu <!-- answer:127 -->

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo em script de semeadura, fixture, imagem, doc ou commit. Placeholders neutros (`example.com`, `group/project`, `#123`).
- Nenhum teste pode alcançar modelo real, host real ou a rede; as fakes ficam em `test/helpers/`.
- A tela virtual é Linux, o app nunca usa a tela da pessoa, e `display` é hoje campo de `runner.sandbox` (esquema 26), não do stage.
- **D18:** `beta` e `stable` sempre esperam o "sim" da pessoa, mesmo com o Release manager autônomo; o corte roda `scripts/release.sh` do repositório, sem sandbox. Nada nesta mudança afrouxa isso.
- A auditoria pública confere um arquivo binário só pelo caminho, nunca pelo conteúdo — uma imagem com dado real não é pega por ela.

## Tentado e descartado

- As quatro frentes de subagentes do refinamento morreram por limite de voltas; no plano, a frente da semeadura também morreu por limite de voltas, e a conferência dessa frente foi feita pela própria sessão (arquivo:linha).
- Descartado regenerar as imagens depois do corte, num passo novo: o corte é um passo único e a etapa de release não aceita caminho nem comando.
- Descartado acrescentar uma chave em `defaults.ts` para o campo novo: não há tabela de padrão por etapa e forçá-la escreveria uma etapa que não existe.

## Perguntas abertas

- O que fazer se as telas mudarem no meio de um ciclo de release (rodar a etapa de novo ou aceitar a imagem velha até o release seguinte): é da pessoa, e a spec deixa isso explícito na etapa, que nunca segue calada. O plano não muda isso.
- Quem fecha o ciclo de uma imagem órfã: o plano **escolhe não recolher** na etapa do release (apagar é da pessoa; a conferência já reprova a CI). Se o product owner quiser o contrário, é uma linha a mais.
- As dúvidas que a própria issue lista e a spec resolveu por omissão: a primeira lista de funcionalidades (as cinco do README, no mínimo), o relógio fixo (datas relativas na semente + relógio falsificado na captura; campo novo no app fica fora), a semeadura servindo aos testes (fica fora) e um tema por imagem (escolhido na lista).

## Onde o trabalho está

- Refinamento feito em 2026-10-10 (`1_SPEC.md`: 9 regras, o que fica fora, 9 aceites, 2 perguntas de escopo). Plano feito em `2_PLAN.md` (tentativa 2): 7 passos na ordem, um teste por comportamento, riscos, decisões. Triagem em `0_TRIAGE.md`, sem pendência.
- O plano decide: o campo `display` vai na etapa e no `FlowStage` (com mapeamento em `flowOf`), sem passo de migração e sem `defaults.ts`; a semente fica fora do repositório (auditoria por `--root`); a conferência de referências é `scripts/docs-images-check.mjs` dentro do job `check` da CI; a etapa nova do release fica entre `release-assemble` e o wait `release-approved`, com um agente que roda comando (não o Release manager); o `phone` sai do modo web do próprio app.
- Verificado por leitura nesta cópia (tentativa 2): `src/main/runner/executor.ts:440` e `:611` (as duas leituras do veredito de tela), `src/shared/runs/types.ts` (FlowStage sem display), `src/shared/runs/flow.ts` (flowOf e flowHash), `src/shared/config/types.ts` (StageDef, `CONFIG_SCHEMA_VERSION = 26`), `schema.ts` (objeto stage, `object()` com `additionalProperties: false`), `defaults.ts` (withConfigDefaults, sem padrão por etapa), `src/shared/cycles/templates/releaseFlow.ts` (11 etapas, Release manager shell none), `test/cycle-templates.test.ts` (lista ordenada exata que quebra), `test/runner-stage-screen.test.ts` (tabela de tela), `docs/runner.md` (as duas descrições do fluxo), `src/main/workspaces-core.ts` e `config-bootstrap.ts` (registro, layout, detecção de instalação existente), `src/main/runs-core.ts` (runs/<id>.json), `src/main/env.ts` (`CERIMONIAS_DATA_DIR`), `scripts/public-audit.mjs` (`--root`, binário só pelo caminho, `auditRoot`), `test/public-audit.test.ts`, `.github/workflows/ci.yml` (job `check`), `docs/images/README.md` e os dois READMEs.
- Não verificado: abrir o workspace semeado sem aviso de migração, a igualdade byte a byte de duas capturas, e uma etapa com tela guardando a imagem como comprovação — as três são aceites de quem implementar, e o plano as nomeia como verificação à mão.
- Passagem plano → implementação: seguir a ordem do plano, um commit por passo; rodar `npx electron-vite build` antes dos passos de semente e captura (o build não entra na captura); conferir que os testes de template e de tela atualizados ficam verdes.
- Passagem product-owner → pessoa: A spec está pronta para o gate humano; nada nela depende de leitura nova. Quem for planejar deve conferir três coisas no código antes de escrever o plano, porque a spec as trata como comportamento e não como desenho: (1) onde o veredito de tela do executor ganha o campo novo da etapa (hoje a expressão é outputKindOf(stage.kind) === 'qa' || (own && agent.screen === true && …) || wantsDisplay, em src/main/runner/executor.ts, e StageDef em src/shared/config/types.ts não tem campo de tela); (2) que um campo novo por etapa num template não quebre um workspace com o fluxo já salvo (a validação está … <!-- handoff:138 -->
