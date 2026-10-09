# QA — cenários numerados derivados dos critérios de aceite

Este plano transforma cada critério de aceite de 1_SPEC.md em cenários numerados. Nenhum cenário foi executado nesta tentativa: todos registram apenas a definição, sem comando nem evidência.

## Cenários

1. **PR recusado vira corrida bloqueada na tela, lista e thread**
   - Ação: com um provider falso que responde 422 ao abrir o pull request após o push (ramo base inexistente), o estágio que empurrou termina com a corrida em `question` do tipo `pr-retry`.
   - Fonte dos testes: `test/runner-pr-blocked.test.ts`.
   - Executado: não. Evidência: nenhuma.

2. **A espera `pr-merged` não parte sem pull request publicado ou vinculado**
   - Ação: com a corrida no caso do cenário 1 (422 de ramo base inexistente), forçar a transição para o estágio final que espera `pr-merged`.
   - Esperado: a corrida não entra em espera; fica `failed` com código `pr-open-failed` e `run.wait` null.
   - Fonte dos testes: `test/runner-pr-blocked.test.ts` (nível transitions) e o caso da guarda em `test/runner-flow.test.ts`.
   - Executado: não. Evidência: nenhuma.

3. **Chamada de `pr-merged` sem pull request gravado não inicia a espera (guarda geral no `enter()` do core)**
   - Ação: desenhar (`drive`) uma corrida cujo registro `comments.pr` esteja recusado e cuja etapa de entrada seja `wait` com `waitsFor.kind = 'pr-merged'`.
   - Esperado: `enter()` fecha fechado (`failed`/`pr-open-failed`); após o pull request ser gravado, um `retry` recomeça a espera.
   - Fonte dos testes: `test/runner-flow.test.ts`.
   - Executado: não. Evidência: nenhuma.

4. **Retry do pull request pela tela da corrida, com base à escolha**
   - Ação: na corrida bloqueada do cenário 1, usar a tela de retry (PrRetryChoice em RunActions.tsx num navegador, com app numa pasta de dados descartável).
   - Esperado: a tela oferece `retryPr` + cancelar (sem caixa de texto `answer`), um botão por base da lista `bases` (alvo primeiro, padrão depois); clicar numa base abre o pull request contra ela via `runs:retryPr` (canal externo auditado), limpa a pergunta, corrige `run.baseBranch` e a corrida retoma o fluxo normal (`runner.pr.created`, reviews saem).
   - Fonte dos testes: `test/run-web.test.ts` (classificação `external`), `test/web-server.test.ts` (lista pinada de EXTERNAL_EFFECT), `test/runs-policy.test.ts`, testes puros de `runActions` em `test/runner-flow.test.ts`; verificação visual não executada.
   - Executado: não. Evidência: nenhuma.

5. **Uma linha "waiting" no máximo por rodada**
   - Ação: comentário de review rascunho sem pull request, executadas duas varreduras (sweep).
   - Esperado: exatamente uma linha `runner.review.waiting`; a segunda varredura não acrescenta nada.
   - Fonte dos testes: `test/runner-review.test.ts` (estendido).
   - Executado: não. Evidência: nenhuma.

6. **Pull request passa a existir → drafts saem e nada mais de "waiting"**
   - Ação: após o cenário 5, fazer o provider reportar o pull request.
   - Esperado: os drafts pendentes vão out como hoje e nenhuma linha `runner.review.waiting` é emitida.
   - Fonte dos testes: `test/runner-review.test.ts`.
   - Executado: não. Evidência: nenhuma.

## Resumo

Todos os seis cenários derivados dos critérios de aceite de 1_SPEC.md (critérios 1–6 do spec mapeados para os cenários 1–6 acima, com o cenário 4 cobrindo o retry por base escolhida) ficam not-run nesta tentativa por não terem sido executados. Os portões de `npx tsc --noEmit`, `npx vitest run` (312/312 arquivos, 4890/4890 testes), `npm run i18n:lint`, `node scripts/theme-audit.mjs` e `node scripts/public-audit.mjs` foram reportados como limpos pela revisão da rodada 4, mas não foram recomandados nesta sessão — leitura, não evidência própria. A tela de retry em navegador segue não exercida. Nenhuma evidência foi salva.

## Resultado dos cenários

- PR recusado vira corrida bloqueada na tela, lista e thread: não rodou (lido) — Não executado nesta sessão: nenhum comando rodado e nenhuma evidência produzida. Cenário definido no 5_TEST_PLAN.md a partir do critério de aceite 1 de 1_SPEC.md.
- A espera pr-merged não parte sem pull request publicado ou vinculado: não rodou (lido) — Não executado nesta sessão. Cenário derivado do critério de aceite 2 de 1_SPEC.md.
- Guarda geral do enter() para chamada de pr-merged sem pull request gravado: não rodou (lido) — Não executado nesta sessão. Cenário derivado do critério de aceite 3 de 1_SPEC.md.
- Retry do pull request pela tela da corrida, com base à escolha: não rodou (lido) — Não executado nesta sessão; a tela em navegador segue não exercida (já marcada como não verificado pela revisão da rodada 4). Cenário derivado do critério de aceite 4 de 1_SPEC.md.
- Uma linha waiting no máximo por rodada: não rodou (lido) — Não executado nesta sessão. Cenário derivado do critério de aceite 5 de 1_SPEC.md.
- Pull request passa a existir: drafts saem e nada mais de waiting: não rodou (lido) — Não executado nesta sessão. Cenário derivado do critério de aceite 6 de 1_SPEC.md.
