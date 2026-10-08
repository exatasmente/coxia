# O que a etapa de QA diz que rodou tem respaldo, e o que ela olhou não some

## O que esta tentativa fez

A revisão (`4_REVIEW.md`) voltou `changes` com um bloqueante: a regra `.coxia/rules/runner.md`
passou a dizer, no parágrafo "What a QA stage says it ran", que o plano de teste é escrito a
partir do registro, mas continuava soando como se o documento inteiro fosse o texto do agente,
quando o código desta branch reescreve as linhas de cenário (`testPlanWithResults`,
`src/shared/runs/testPlan.ts:51-63`, aplicado em `src/main/runner/executor.ts:873`). Esta
tentativa corrige essa frase e não refaz o que já estava aceito.

A frase corrigida, no mesmo parágrafo:

> The test plan stops being the agent's text whole: the app writes the recorded scenarios as
> their own section, taken from the record, and keeps out the agent's own scenario lines, so
> one scenario is written once and only from the record; the plan's other sections stay as the
> agent wrote them.

Lida contra o código desta cópia, a frase nova confere: `testPlanWithResults` corta a seção de
resultados do agente, tira as linhas de cenário que o agente escreveu e põe, no fim, uma seção
com uma linha por cenário gravado; as outras seções ficam intactas (o teste puro do arquivo
`test/runner-qa-repair.test.ts` confere isso, e os testes de executor conferem o documento
gravado na pasta do ciclo).

Os cinco passos do plano (`2_PLAN.md`) seguem de pé, como nas tentativas anteriores:

1. **O registro da imagem olhada.** O caminho da imagem que o agente abre com `ViewImage` é
   anotado no único ponto comum às duas engines; o `onLooked` do executor junta os caminhos num
   conjunto por tentativa. A `lookAtImage` devolve `looked` só quando a imagem veio da pasta de
   saída e é mesmo uma imagem (PNG, JPEG, GIF ou WebP), e nada quando veio de um id de
   comprovação.
2. **A rodada de reparo.** Dentro do `try` de `runStage`, antes do `finally` que fecha a sandbox,
   com no máximo uma volta por tentativa, na mesma sessão e no mesmo motor, e as duas chamadas ao
   motor sob o mesmo `guard` do `watchdog`.
3. **A fonte única do que se publica.** Os cenários são conferidos uma vez e o mesmo vetor
   alimenta o registro da QA, o `5_TEST_PLAN.md` (reescrito por `testPlanWithResults`, antes do
   `tidyArtifact`) e o comentário.
4. **A guarda automática no fecho.** O caminho do gancho passa pelo `resolveOutputPath` antes de
   qualquer leitura; o que não for caminho da pasta de saída, ou for link, ou sair da pasta
   depois do `realpath`, não é lido e vira a linha `runner.qa.lookNotKept` com o motivo. Um
   arquivo que o agente já guardou não é guardado de novo, e o id de uma peça só entra na lista
   da etapa depois de a guarda dar certo.
5. **As correções de passagem e o changelog.** A regra `.coxia/rules/runner.md` corrigida (a
   frase desta tentativa) e a linha no `CHANGELOG.md` sob `## [Unreleased]`.

## O que foi verificado, e com que comando

Nesta cópia de trabalho:

- `npx tsc --noEmit` — sem saída, sem erro (exit 0).
- `npx vitest run test/runner-qa-repair.test.ts test/runner-evidence-run.test.ts test/runner-evidence.test.ts test/runner-publish.test.ts test/runs-scenario.test.ts` —
  5 arquivos, 56 testes, todos passando.
- `node scripts/public-audit.mjs` — 1215 arquivos, nada que pertença a uma empresa ou a uma
  pessoa (exit 0).
- `node scripts/theme-audit.mjs` — passa; os únicos literais são os 8 de `api.ts`, que já
  existiam (exit 0).
- `npm run i18n:lint` — 4598 chaves nos dois idiomas, 0 problema (exit 0).
- `npx vitest run` (a suíte inteira) — 283 arquivos, 4384 testes passando e 9 falhando em 8
  arquivos. Os nove falharam por ambiente/carga do computador, não por esta mudança: cada um
  dos arquivos passa quando rodado em grupo menor (`runner-chain`, `harness-deliver`,
  `conflict-from-mr`, `sandbox-hardening`, `sandbox-bwrap`, `voice-setup`, `public-audit` — os
  cinco primeiros e o último rodados de novo e verdes). O que falhou na corrida cheia foi
  tempo-limite de 5 s por teste sob 283 arquivos em paralelo, rede ausente (o `uv`), sandbox
  real e git do host. Nenhum desses arquivos está no diff da branch, e a mudança desta
  tentativa é só um arquivo de documentação.

O que os testes cobrem, rodados nesta tentativa ou nas anteriores: a rodada de reparo pede uma
volta só e o comando que o agente então aponta sustenta o cenário; um cenário que volta sem
respaldo é gravado como `read` com `unbacked` e a conversa diz isso uma vez; uma etapa sem
sandbox fica como antes; o `5_TEST_PLAN.md` não chama de executado um cenário que o registro tem
como lido e marca um `not-run` como não rodado; uma imagem olhada e não guardada termina como
comprovação da etapa; um link na pasta de saída e um caminho fora dela terminam como "visto, não
guardado", com o motivo, e nada é lido através deles; o que sumiu antes do fecho vira "visto, não
guardado"; uma imagem com nome de texto é guardada pelo conteúdo; um cenário que continua
executado aparece como executado no registro, no plano gravado e no comentário; e o comentário de
QA com um cenário rebaixado nunca diz executado.

## O que não foi verificado

- Nada foi exercitado com modelo, host ou sandbox reais, nem nenhuma tela foi conduzida: a
  verificação é de leitura de código e de testes com os ajudantes de teste (motor e sandbox
  falsos, sem rede).
- A corrida completa da suíte não é verde de ponta a ponta nesta máquina: 9 testes de 8
  arquivos falharam sob carga. Cada um dos que se pôde rodar de novo passou; a causa apontada é
  ambiente (tempo-limite sob paralelismo, rede, sandbox real, git), não esta mudança, mas a
  corrida cheia **não** foi vista verde.
- O caminho de recusa por tipo e por tamanho de imagem (o tipo diferente de imagem e a imagem
  acima do teto) não tem teste próprio: os dois vêm do mesmo `putEvidence` de hoje, e o teste
  novo cobre a recusa por link e por caminho fora da pasta.
- A resposta de um motor sem id de sessão, o contrato da rodada que falha e as duas limpezas de
  passagem continuam como a revisão os deixou: sugestões, não decididas nesta tentativa.
- A regra `.coxia/rules/runner.md` foi corrigida por leitura contra o código; não há teste que a
  confira. Os marcadores `checked-commit`/`checked-date` dos arquivos de `.coxia` que a branch
  toca continuam com a data antiga: quem os escreve é o app, no commit.
- O `docs/runner.md` (o documento para pessoas) continua sem a rodada de reparo e sem a guarda
  da imagem olhada, como a revisão apontou em sugestão; não foi tocado nesta tentativa. Ele
  também traz, no fim, uma linha repetida/truncada que já existia no ponto de ramificação — não
  é desta branch.
