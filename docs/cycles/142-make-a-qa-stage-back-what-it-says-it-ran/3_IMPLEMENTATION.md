# O que a etapa de QA diz que rodou tem respaldo, e o que ela olhou não some

## O que esta tentativa fez

A revisão (`4_REVIEW.md`) aprovou o essencial e apontou um bloqueante: a guarda automática do fecho
dava ao `putEvidence` o caminho que o gancho da imagem recebeu sem conferir que ele estava na pasta
de saída da etapa, sem recusar link e sem comparar o caminho real. Esta tentativa corrige esse
ponto e as sugestões que a revisão ligou a ele; não refaz o que já estava aceito.

Por passo do plano (`2_PLAN.md`), o que ficou de pé:

1. **O registro da imagem olhada.** O caminho da imagem que o agente abre com `ViewImage` é anotado
   no único ponto comum às duas engines; o `onLooked` do executor junta os caminhos num conjunto por
   tentativa. A `lookAtImage` devolve `looked` só quando a imagem veio da pasta de saída e é mesmo
   uma imagem (PNG, JPEG, GIF ou WebP), e nada quando veio de um id de comprovação.
2. **A rodada de reparo.** Dentro do `try` de `runStage`, antes do `finally` que fecha a sandbox, com
   no máximo uma volta por tentativa, na mesma sessão e no mesmo motor, e as duas chamadas ao motor
   sob o mesmo `guard` do `watchdog`.
3. **A fonte única do que se publica.** Os cenários são conferidos uma vez e o mesmo vetor alimenta o
   registro da QA, o `5_TEST_PLAN.md` (reescrito por `testPlanWithResults`, antes do `tidyArtifact`) e
   o comentário (que perde as linhas de cenário do agente e ganha as do registro).
4. **A guarda automática no fecho.** Corrigida nesta tentativa: o caminho do gancho passa pelo
   `resolveOutputPath` antes de qualquer leitura; o que não for caminho da pasta de saída, ou for
   link, ou sair da pasta depois do `realpath`, não é lido e vira a linha `runner.qa.lookNotKept` com
   o motivo. Um arquivo que o agente já guardou não é guardado de novo, e o id de uma peça só entra
   na lista da etapa depois de a guarda dar certo.
5. **As correções de passagem e o changelog.** A regra `.coxia/rules/runner.md` corrigida e a linha
   no `CHANGELOG.md` sob `## [Unreleased]`.

## O que foi verificado, e com que comando

Nesta cópia de trabalho:

- `npx tsc --noEmit` — sem saída, sem erro.
- `npx vitest run test/runner-qa-repair.test.ts test/runner-evidence-run.test.ts test/runner-evidence.test.ts test/runner-publish.test.ts test/runs-scenario.test.ts` —
  todos os arquivos passando (`runner-qa-repair`: 10 testes, incluindo os dois casos novos).
- `node scripts/public-audit.mjs` — 1215 arquivos, nada que pertença a uma empresa ou a uma pessoa.
- `node scripts/theme-audit.mjs` — passa (só os 8 literais de `api.ts`, que já existiam).
- `npm run i18n:lint` — 4598 chaves nos dois idiomas, 0 problema.

O que os testes cobrem, e que foi rodado nesta tentativa: a rodada de reparo pede uma volta só e o
comando que o agente então aponta sustenta o cenário; um cenário que volta sem respaldo é gravado como
`read` com `unbacked` e a conversa diz isso uma vez; uma etapa sem sandbox fica como antes; o
`5_TEST_PLAN.md` não chama de executado um cenário que o registro tem como lido e marca um `not-run`
como não rodado; uma imagem olhada e não guardada termina como comprovação da etapa; um link na pasta
de saída e um caminho fora dela terminam como "visto, não guardado", com o motivo, e nada é lido
através deles; o que sumiu antes do fecho vira "visto, não guardado"; uma imagem com nome de texto é
guardada pelo conteúdo; um cenário que continua executado aparece como executado no registro, no
plano gravado e no comentário; e o comentário de QA com um cenário rebaixado nunca diz executado.

## O que não foi verificado

- Nada foi exercitado com modelo, host ou sandbox reais, nem nenhuma tela foi conduzida: a verificação
  é de leitura de código e de testes com os ajudantes de teste (motor e sandbox falsos, sem rede).
- A corrida completa da suíte depois destas mudanças não chegou a ser lida: o tempo de comandos desta etapa
  acabou antes. A última corrida completa que li, já com o bloqueante corrigido mas antes do conserto da
  conferência pública, deu 282 arquivos e 4392 testes passando com uma única falha, a da conferência
  pública no documento da revisão, corrigida em seguida. A corrida final fica registrada como não lida.
- O caminho de recusa por tipo e por tamanho de imagem (o tipo diferente de imagem e a imagem acima do
  teto) não tem teste próprio: os dois vêm do mesmo `putEvidence` de hoje, e o teste novo cobre a recusa
  por link e por caminho fora da pasta.
- A resposta de um motor sem id de sessão, o contrato da rodada que falha e as duas limpezas de passagem
  continuam como a revisão os deixou: sugestões, não decididas nesta tentativa.
- A regra `.coxia/rules/runner.md` foi corrigida por leitura; não há teste que a confira.
