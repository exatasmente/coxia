# Revisão: a etapa de QA comprovando o que diz que rodou, e o que ela olhou sem sumir

## O que foi conferido, e como

Esta rodada leu o diff da branch contra a issue, a spec (`1_SPEC.md`), o plano (`2_PLAN.md`) e o documento da implementação (`3_IMPLEMENTATION.md`), e conferiu primeiro se o bloqueante da rodada anterior foi feito. Nada de run real, modelo, host ou tela foi usado; a verificação é de leitura de código e de testes.

**O bloqueante da rodada 2, conferido por leitura e por comando.** A rodada anterior voltou `changes` porque `.coxia/rules/runner.md`, no parágrafo "What a QA stage says it ran", afirmava que o resultado de cada cenário vinha do registro mas deixava entender que o documento inteiro era o texto do agente, quando o código desta branch reescreve as linhas de cenário. O arquivo, lido agora, diz:

> The test plan stops being the agent's text whole: the app writes the recorded scenarios as their own section, taken from the record, and keeps out the agent's own scenario lines, so one scenario is written once and only from the record; the plan's other sections stay as the agent wrote them.

A frase confere com o código: `testPlanWithResults` (`src/shared/runs/testPlan.ts:51-63`) remove a seção de resultados do agente, filtra as linhas de cenário que ele escreveu e acrescenta uma seção com uma linha por cenário gravado, deixando as outras seções intactas; o executor o aplica antes da normalização do cabeçalho (`src/main/runner/executor.ts:873`). O conserto está commitado (`532d3449 feat: state that the test plan is written from the run record #142`), não só no worktree.

**O bloqueante da rodada 1, conferido de novo.** A guarda do fecho passa o caminho que o gancho da imagem recebeu pelo mesmo resolvedor da pasta de saída antes de ler qualquer coisa (`src/main/runner/executor.ts:624`), e o caminho recusado vira a linha `runner.qa.lookNotKept` com o motivo (`executor.ts:625-628`). O id e o registro de uma peça só entram nas listas da etapa depois de a guarda dar certo (`executor.ts:635-639`), o `keptNames` evita guardar duas vezes o mesmo arquivo e o `looked` só sai para imagem de verdade. Continua tudo de pé.

**As portas, rodadas nesta cópia.** `npx tsc --noEmit` — sem saída, sem erro (exit 0). `npx vitest run test/runner-qa-repair.test.ts test/runner-publish.test.ts test/runs-scenario.test.ts` — 3 arquivos, 38 testes, todos passando. `npm run i18n:lint` — 4598 chaves nos dois idiomas, 0 problema. `node scripts/theme-audit.mjs` — passa (os únicos literais são os 8 de `api.ts`, que já existiam). `node scripts/public-audit.mjs` — 1215 arquivos, nada que pertença a uma empresa ou a uma pessoa.

Os testes do assunto cobrem a rodada de reparo pedindo uma volta só e o comando que o agente então aponta sustentando o cenário; um cenário que volta sem respaldo virando `read` com `unbacked` e a conversa dizendo isso uma vez; a etapa sem sandbox como antes; o plano gravado e o comentário não chamando de executado um cenário que o registro tem como lido e marcando um `not-run` como não rodado; uma imagem olhada e não guardada terminando como comprovação da etapa; um link na pasta de saída e um caminho fora dela terminando como "visto, não guardado" com o motivo; o que sumiu antes do fecho virando "visto, não guardado"; e uma imagem com nome de texto sendo guardada pelo conteúdo.

## O veredito

**approved.** O bloqueante da rodada 2 foi corrigido e commitado, e a frase nova confere com o código. O bloqueante da rodada 1 continua tratado. Nenhum defeito novo aparece no diff desta rodada: o que ela mudou é uma frase de documentação, e ela foi lida contra `testPlanWithResults` e coberta pelo teste puro do plano. Nada bloqueia.

## Achados

### Bloqueante

Nenhum.

### Sugestões

Nenhuma nova. As sugestões das rodadas anteriores que continuam abertas não foram reabertas e não viram bloqueantes: o `docs/runner.md` (o documento para pessoas) segue sem a rodada de reparo e sem a guarda da imagem olhada, mas nada nele ficou falso; os marcadores `checked-commit`/`checked-date` dos arquivos de `.coxia` que a branch toca são escritos pelo app no commit; e o contrato da rodada de reparo que falha por dentro (tempo, passos, orçamento) segue não escrito em lugar nenhum, sem nada da entrega afirmar o contrário.

## O que esta revisão não fez

Não reproduziu o run real citado pela issue, não exercitou modelo, host nem sandbox, e não conduziu nenhuma tela. Não rodou a suíte completa: rodou o typecheck, os testes do assunto, o lint de internacionalização, a conferência de tema e a conferência pública. Não julgou por execução o caminho de uma imagem acima do teto nem o de um arquivo que não é imagem (não têm teste próprio; a recusa por link e por caminho fora da pasta tem).
