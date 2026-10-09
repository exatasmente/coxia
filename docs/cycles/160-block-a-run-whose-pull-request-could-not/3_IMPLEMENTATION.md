# A implementação em andamento

## Estado real desta tentativa

A implementação não chegou ao fim nesta tentativa: nenhum comando de teste rodou e o arquivo de teste novo (test/runner-pr-blocked.test.ts) ficou incompleto, com partes ainda rascunhadas. O que está de fato escrito e compilando:

- `src/shared/runs/types.ts`: `pr-retry` em `QUESTION_KINDS`; campos opcionais `bases`, `targetBranch`, `baseGone` em `PendingQuestion`; `'pr-open-failed'` em `RunFailure['code']`; `waitingSaid` em `CommentRecord`.
- `src/shared/runs/transitions.ts`: novo `prRecorded` (exporta se o pull request do run está gravado como publicado); guarda no `enter()` da espera que recusa iniciar a espera `pr-merged` sem pull request publicado e falha com código `pr-open-failed` e mensagem `run.stage.noPullRequest`; transições novas `prOpenBlocked` (para run `working` em `question` com pergunta do tipo `pr-retry`) e `prRetryAnswered` (exige pergunta `pr-retry`, limpa a pergunta, corrige `run.baseBranch`, restaura `working`); `answer()` recusa responder uma pergunta `pr-retry`; `recordCommentWaiting` marca a linha de espera do comentário.
- `src/shared/runs/schema.ts`: campos novos no esquema do arquivo de corrida (`bases`/`targetBranch`/`baseGone` da pergunta, `waitingSaid` do comentário, `pr-open-failed` no código de erro).
- `src/main/runner/publish.ts`: abertura direta extraída para `openPrNow` (reusada pelo ramo autônomo e pelo retry); `failPr`, que diz no thread `runner.pr.failed` com a branch alvo, reler o branch padrão do host, deriva `baseGone` de evidência (VcsError 4xx/invalide) e aplica `prOpenBlocked` só quando o run ainda está `working`; `ensurePr` (resolve o pull request vinculado e grava); `retryPr` (transição e abertura auditaro pela porta); guardas de uma vez por rodada da linha `runner.review.waiting` nos dois pontos de emissão (deliver e publishReview), via `waitingSaid`.
- `src/main/runner/service.ts`: `settle()` chama `publisher.ensurePr` antes das passagens de `stageDone` cuja etapa seguinte é a espera `pr-merged`; interface `Runner` e implementação ganham `retryPr`, que faz a transição e só depois disso reabre o fluxo (pump), esperado o fim da escrita; `answerPost` ignora pergunta `pr-retry`; novo código de erro do runner `no-host`.
- `src/main/runner/module.ts`: canal `runs:retryPr` junto de `runs:retry`.
- `src/shared/runs/view.ts`: `retryPr` em `RUN_ACTIONS`; pergunta `pr-retry` na tabela `runActions` oferece `retryPr` (sem caixa de texto) no lugar de `answer`.
- Renderer: `runsApi.retryPr`; `RunActions.tsx` com `PrRetryChoice` (um botão por base da pergunta, feesa `runs:retryPr`), rótulo e mapeamento de erro `pr-open-failed`; `Thread.tsx` não abre caixa de resposta para pergunta `pr-retry`.
- Catálogos EN/PT: `runner.pr.failed` com `{branch}`; `runner.review.waiting` com a frase uma vez por rodada; novas chaves `run.stage.noPullRequest` (fórum), `main.runs.stage.prBlocked`, `main.runs.stage.prBaseGone`, `main.runs.stage.prRetry`, `main.runner.error.no-host`; ui-cycle: `ui.cycle.action.retryPr`, `ui.cycle.prRetry.title/pick/hint`, `ui.cycle.error.prOpenFailed`.
- `test/run-web.test.ts` atualizado para o mapa de canais com `retryPr`.

O que falta (não verificado nesta etapa): testes dos sete comportamentos da tabela do plano (422 de ramo base inexistente, guarda da espera, guard geral no runner-flow, ensurePr de pull request vinculado, recuperação do failed, retryPr completo até fim do fluxo, uma linha por rodada com a varredura repetida), caso puro de `runActions` em test/run-view.test.ts, e a rodada dos portões padrão.

## Não verificado

- Nenhum teste rodou. `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` não foram rodados; o último `npx tsc --noEmit` que rodou passou sem erros.
