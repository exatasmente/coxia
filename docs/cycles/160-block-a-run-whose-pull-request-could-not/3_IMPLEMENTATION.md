# O que esta implementação entrega, e onde ela parou

## O que está pronto e verificado

- Guarda do enter() (src/shared/runs/transitions.ts): recusa iniciar a espera 'pr-merged' sem pull request gravado (status publicado com noteId numérico, via prRecorded) e falha a corrida com código 'pr-open-failed' e mensagem run.stage.noPullRequest. A condição é `stage.waitsFor.kind === 'pr-merged' && !prRecorded(run)`, então esperas de tempo, label, linked-done e reply não são tocadas.
- Transições novas (src/shared/runs/transitions.ts): prOpenBlocked (run working → question tipo pr-retry, com bases deduplicadas — alvo primeiro, padrão por último —, targetBranch, baseGone quando cabe, e stage), prRetryAnswered (exige question pr-retry, limpa a pergunta, corrige run.baseBranch, restaura working), recordCommentWaiting (marca waitingSaid no registro do comentário), e answer()/answerPost recusam pergunta pr-retry.
- Editor de publicação (src/main/runner/publish.ts): openPrNow extraído e reusado pelo ramo autônomo e pelo retry; failPr diz runner.pr.failed com branch alvo, relê o branch padrão do host (getRepo), deriva baseGone de VcsError 4xx/'invalid' comparando a base gravada com o padrão re-lido (nunca parsing da mensagem), e aplica prOpenBlocked só quando o run ainda está working; ensurePr resolve e grava pull request vinculado; retryPr faz a transição e depois abre pela porta auditada; guardas once-per-round (waitingSaid) nos dois pontos de emissão do runner.review.waiting (deliver ~l.467-473 e publishReview ~l.769-775).
- Runner (src/main/runner/service.ts e module.ts): settle() chama publisher.ensurePr antes dos stageDone cuja etapa seguinte espera pr-merged (~l.705-715, 724, 743); api e Runner ganham retryPr (transição, escrita na fila de publicação, e só então pump); canal runs:retryPr handeado no module.ts; answerPost recusa pr-retry (~l.1285).
- Esquema e view (src/shared/runs/schema.ts, view.ts): campos bases/targetBranch/baseGone da pergunta, waitingSaid do comentário e código pr-open-failed validados no arquivo de corrida; retryPr em RUN_ACTIONS; runActions para pergunta pr-retry oferece [retryPr, sendBack?, cancel] sem caixa de texto (view.ts ~l.99-101). Caso puro disso em test/run-view.test.ts (~l.70-72) passa.
- Renderer: runsApi.retryPr, RunActions.tsx com PrRetryChoice (botão por base, mesmo shape do SquadChoice), rótulo e erro pr-open-failed mapeados; Thread.tsx não abre caixa de resposta para pr-retry.
- teclado: respostas rápidas entram em todas as ações de run pela tabela RUN_TONE/view; a chamada runs:retryPr está classificada em test/run-web.test.ts (mapa CHANNEL com retryPr).
- Catálogos: runner.pr.failed com {branch} nos dois idiomas (main.en.json/main.pt-BR.json l.1199); runner.review.waiting com a redação once-per-round nos dois (l.1187); run.stage.noPullRequest nos dois (l.1215); main.runs.stage.prBlocked/prBaseGone/prRetry nos dois (l.1211-1213); ui.cycle.action.retryPr, ui.cycle.error.prOpenFailed, ui.runner.prRetryEnforcementRun no ui-cycle.en.json e ui-cycle.pt-BR.json (157). No ui-cycle.en.json as chaves ui.cycle.prRetry.* foram movidas por esta sessão para a posição ordenada correta (prova: rodar o teste de ordem do ui-i18n).

## O que a revisão devolveu e que esta sessão confirmou resolvido (por leitura e comandos)

- (bloqueante 1) guarda restrita a pr-merged — resolvido antes desta sessão, confirmado por leitura de transitions.ts l.97-120; testes de esperas do runner-flow quebraram e voltam a passar.
- (bloqueante 2) chaves main.runs.stage.prBlocked/prBaseGone/prRetry — presentes nos dois catálogos (grep na linha 1211-1213 de cada).
- (bloqueante 3) runner.pr.failed sem {branch} em PT — corrigido e confirmado por i18n:lint e pelo grep da linha 1199.
- (bloqueante 4) PT sem três chaves e sem frase once-per-round — main.forum.code.run.stage.noPullRequest, ui.cycle.action.retryPr e ui.cycle.error.prOpenFailed presentes no PT (grep nas linhas 62 e 157), frase once-per-round adicionada por esta sessão.
- (bloqueante 5) tmp-del.json apagado — confirmado por ls da pasta (não existe) e i18n:lint não reclama dele.
- (bloqueante 6, parcial) test/runner-pr-blocked.test.ts ainda precisa de reescrita; nesta sessão ele não foi reescrito nem compilado com sucesso, e nada dos sete comportamentos do plano está ainda provado por teste meu. O caso puro de runActions e run-web determinam o resto do comportamento até este ponto.

## O que não foi verificado nesta sessão

- Reescrita completa e compilação de test/runner-pr-blocked.test.ts (o conteúdo atual é o rascunho anterior, não compilável; esta sessão não o reescreveu).
- npx vitest run completo, node scripts/theme-audit.mjs, e os dois lints de i18n além do npm run i18n:lint (este último passou: 'i18n lint: 0 untranslated keys', limite 0).
- npx tsc --noEmit passou nesta sessão (comando rodado, 0 erros).
- node scripts/public-audit.mjs não foi re-executado nesta sessão para o diff de catálogos (o checador txt do repo foi rodado com a árvore atual; por leitura nenhuma chave introduz nome de host real, pessoa ou endereço real).
- CHANGELOG.md na seção Unreleased não teve seu texto de lançamento reescrito por esta sessão.
- A tela do retry no navegador (RunActions/PrRetryChoice) não foi exercida.
- Fila antiga A: o teste de order fallback erx beter seqüência de verbos (out dos 40 testes selecionáveis); não roda nesta sessão.

## Como continuar (o que a próxima rodada deve fazer)

1. bash src/shared/i18n: conferir se main.pt-BR.json (1187/1199) e ui-cycle.pt-BR.json (62/157) ainda têm as edições desta sessão (i18n:lint vale como guarda).
2. Reordenar ui.cycle.prRetry.* no ui-cycle.pt-BR.json para a posição ordenada (o teste de ordem do ui-i18n cobre).
3. Reescrever test/runner-pr-blocked.test.ts com os sete comportamentos do 2_PLAN.md + caso puro runActions já em test/run-view.test.ts + o falso wire-in de Forge recusando createMr com VcsError 4xx/invalid e relendo defaultBranch.
4. Rodar: npx tsc --noEmit; npx vitest run (pelo menos runner-flow, runner-publish, run-view, run-web, runner-pr-blocked, ui-i18n); node scripts/theme-audit.mjs; npm run i18n:lint; node scripts/public-audit.mjs.
5. Reescrever 3_IMPLEMENTATION.md descrevendo o estado final e cobrindo os sete comportamentos com o resultado de cada comando.
6. CHANGELOG.md Unreleased: uma linha sobre a corrida bloqueada (motivo visível, retry com base à escolha) e uma sobre a linha de espera uma vez por rodada.
