# Memória do ciclo

## Decisões

- **A regeneração das imagens entra pela rota do pull request**, não num passo novo depois do corte: é uma etapa de trabalho do fluxo de release, depois das atividades da versão na branch e antes de o corte ser pedido, com a tela ligada, e o que mudar em `docs/images/` segue para o pull request do release. Por quê: `scripts/release.sh` corta tudo de uma vez (bump, CHANGELOG, commit, tag anotada) e para antes de imprimir os pushes, e recusa árvore suja; os passos da release (`release-git`) só aceitam `{op, version, runId, pr, head, from, branch, channel}` e nunca caminho, comando ou flag (`docs/runner.md`, tabela dos passos; `src/shared/release.ts`); `beta` e `stable` sempre esperam o "sim" (D18); as etapas declaradas do `release-flow` não têm nenhuma de documentação (`src/shared/cycles/templates/releaseFlow.ts`). A spec não promete número de versão futuro: o ciclo de release seguinte captura de novo. Nota guardada: `m-8bb96df5`.
- O workspace fictício da semeadura fica **fora do repositório**, descartável; o repositório versiona só o script de semeadura e os de captura. A aceitação "a auditoria pública passa na pasta que ele escreveu" se confere apontando a auditoria para a pasta com `--root <dir>` (já existe, documentado como uso de teste em `scripts/public-audit.mjs`). Não deve ficar na árvore nem ignorada: `--exclude-standard` esconderia uma pasta ignorada.
- **Campo `display` da etapa:** a spec pede o campo na etapa do fluxo (é o que a issue pede); a pessoa do fluxo não precisa decidir isso agora, e a especificação funcional não escolhe a implementação. Fica registrado que o agente já tem `screen` e que o campo novo por etapa precisa ser aditivo para não mexer nos fluxos já salvos.
- Resposta: já foi respondido <!-- answer:99 -->
- Resposta: o @team-lead respondeu <!-- answer:127 -->

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo em script de semeadura, fixture, imagem, doc ou commit. Placeholders neutros (`example.com`, `group/project`, `#123`).
- Nenhum teste pode alcançar modelo real, host real ou a rede; as fakes ficam em `test/helpers/`.
- A tela virtual é Linux, o app nunca usa a tela da pessoa, e `display` é hoje campo de `runner.sandbox` (esquema 26), não do stage.
- **D18:** `beta` e `stable` sempre esperam o "sim" da pessoa, mesmo com o Release manager autônomo; o corte roda `scripts/release.sh` do repositório, sem sandbox. Nada nesta mudança afrouxa isso.
- A auditoria pública confere um arquivo binário só pelo caminho, nunca pelo conteúdo.

## Tentado e descartado

- As quatro frentes de subagentes disparadas no refinamento (issue e conversa; tela virtual no código; fluxo de release e ponto de captura; semeadura e imagens; casos de borda) morreram por limite de voltas. A conferência decisiva foi feita pela própria sessão, por leitura, e o que a spec cita foi lido diretamente.
- Descartado regenerar as imagens depois do corte, num passo novo: o corte é um passo único e a etapa de release não aceita caminho nem comando.

## Perguntas abertas

- O que fazer se as telas mudarem no meio de um ciclo de release (rodar a etapa de novo ou aceitar a imagem velha até o release seguinte): é da pessoa, e a spec deixa isso explícito na etapa, que nunca segue calada.
- Quem fecha o ciclo de uma imagem órfã (apagar as que sobrarem na etapa do release, ou deixar para a pessoa): o refino não decidiu; a mudança pode fazê-lo.
- As dúvidas que a própria issue lista e a spec resolveu por omissão: a primeira lista de funcionalidades (as cinco do README, no mínimo), o relógio fixo (datas relativas na semente + relógio falsificado na captura; campo novo no app fica fora), a semeadura servindo aos testes (fica fora) e um tema por imagem (escolhido na lista).

## Onde o trabalho está

- Refinamento feito em 2026-10-10. `1_SPEC.md` reescrito: 9 regras numeradas, o que fica fora, 9 critérios de aceite verificáveis e 2 perguntas em aberto (as duas de escopo, para a pessoa). A regra 6 fechou a pergunta que a tentativa anterior abriu. Triagem em `0_TRIAGE.md`, sem pendência.
- Verificado por leitura nesta cópia: `src/main/runner/executor.ts` (veredito de tela da etapa e abertura do sandbox), `src/shared/config/types.ts` (StageDef sem campo de tela), `src/shared/config/schema.ts` e `defaults.ts` (`runner.sandbox.display`), `src/main/sandbox/index.ts` e `host.ts` (sandbox e host pedem a tela juntos, sem TCP), `src/shared/cycles/templates/releaseFlow.ts` (11 etapas, nenhuma de documentação), `scripts/release.sh` (corte único, recusa árvore suja, não faz push), `RELEASING.md` (o PR do release e o corte), `docs/runner.md` (tabela dos passos, esperas, tela virtual, comprovação e ViewImage, navegador do app), `.github/workflows/ci.yml` (um job de conferências), `docs/images/README.md`, `README.md` e `docs/README.md`, `src/main/workspaces-core.ts` e `config-bootstrap.ts` (registro, marcador de migração, config atual) e `src/main/env.ts` (`CERIMONIAS_DATA_DIR`).
- Não verificado: abrir o workspace semeado, a igualdade byte a byte de duas capturas, e uma etapa com tela guardando a imagem como comprovação — as três são condições de aceite de quem implementar.
