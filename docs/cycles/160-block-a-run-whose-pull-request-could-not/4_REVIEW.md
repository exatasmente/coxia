# Revisão: a corrida cujo pull request o anfitrião recusou não fica mais esperando às cegas

## O que foi verificado

- Diff inteiro contra 1_SPEC.md e 2_PLAN.md, arquivo por arquivo, incluindo os trechos cortados no diff (test/runner-pr-blocked.test.ts e src/shared/i18n/tmp-del.json lidos por inteiro).
- Portões e testes na worktree: `npx tsc --noEmit` (falha), `npx vitest run` em runner-pr-blocked/runner-flow/run-view (4 falhas, 53 passando nos arquivos transformados), `node scripts/public-audit.mjs` (limpo) e `npm run i18n:lint` (falha).
- A vitest completa e o theme-audit não rodaram nesta revisão; os achados abaixo já decidem o veredito. A tela do retry (RunActions) não foi exercida em navegador; o comportamento da tabela de ações está coberto pelos testes puros de run-view e run-web, que passam.

## Bloqueantes

1. **A guarda da espera vale para toda espera, não só pr-merged** (src/shared/runs/transitions.ts, o `else if (!prRecorded(run))` no `enter()`): falta checar `stage.waitsFor.kind === 'pr-merged'`. Como está, qualquer espera (time, label, linked-done, reply) falha a corrida com `pr-open-failed` quando não há pull request gravado. Três testes existentes do runner-flow falham hoje por isso ("waits for a time...", "a wait on a linked issue...", "holds a run that asked another squad..."). Muda o comportamento de fluxos que a issue não toca.
2. **Chaves de catálogo inexistentes**: `main.runs.stage.prBlocked`, `main.runs.stage.prBaseGone` e `main.runs.stage.prRetry`, usadas em `failPr` (publish.ts) e `prRetryAnswered` (transitions.ts), não existem nem em main.en.json nem em main.pt-BR.json — o texto bloqueado e a linha de retry do thread saem como chave crua. O i18n:lint não acusa porque falta nos dois lados (o lint só aponta divergência entre catálogos).
3. **runner.pr.failed perdeu o {branch}**: `failPr` passa `{ branch, reason }`, mas o texto em EN e PT continua sem `{branch}`; o critério de aceite de que a linha do thread nomeia a branch alvo fica sem efeito.
4. **Catálogo pt-BR incompleto**: faltam `main.forum.code.run.stage.noPullRequest`, `ui.cycle.action.retryPr` e `ui.cycle.error.prOpenFailed`; `main.forum.code.runner.review.waiting` em PT não ganhou a redação once-per-round; i18n:lint vermelho nestes três.
5. **src/shared/i18n/tmp-del.json commitado**: lixo de rascunho (declarações sem sentido) marcado para apagar e não apagado.
6. **test/runner-pr-blocked.test.ts é rascunho e não compila**: o segundo teste tem corpo `...` (TS1128/TS1109 em tsc e na transformação do vitest, linhas 147–149), e os testes referem identificadores indefinidos (`failingForge`, `openTheGate`); o falso wire-in `failingOnce` também não usa o caminho do fakeForge que os demais testes de runner usam.

## Teste que falta para comportamento novo

Nenhum dos sete comportamentos da tabela do 2_PLAN.md está provado por teste passando: o arquivo que devia contê-los não compila e não cobre (422 de ramo base inexistente, retryPr até o fim do fluxo, ensurePr de pull request vinculado, recuperação do failed, e a linha "aguardando" uma vez por rodada — que também não menciona `waiting` em nenhum lugar de runner-review.test.ts). Passam hoje: o caso novo da guarda no runner-flow ("never starts the pr-merged wait"), o runActions de pr-retry (run-view), o canal no run-web e os testes prerexistentes que a mudança não toca.

## O que está bom e não reabre

- O desenho segue o plano aprovado: blocked como `question`/`pr-retry` reusando a superfície bloqueada do core, bases com o alvo primeiro e o padrão depois, baseGone derivado de VcsError 4xx/invalid e da comparação da base gravada com o default re-lido (nunca parsing da mensagem), ensurePr antes do stageDone que entra na espera, `waitingSaid` persistido no registro do comentário, retry pela porta auditada, `answer()`/`answerPost` recusando pergunta pr-retry, sem caixa de texto na tela e no thread. Nada disso volta.
- public-audit limpo.

## Sugestões menores

- O filtro que esconde `retryPr` da lista de botões fica escrito em dois lugares (o bloco do PrRetryChoice e o `.filter` do doIt); quando a lista de ações crescer mais, vale centralizar.
- `runner.review.waiting` em PT continua no texto antigo; resolva junto do bloqueante de catálogo pt-BR.

## Veredito

Devolvido ao implementador para corrigir os seis bloqueantes; a revisão das próximas rodadas confere só estes pontos e não reabre o que está bom.
