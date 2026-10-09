# Memória do ciclo

## Decisões

- Bug confirmado; fix segue 2_PLAN.md aprovado: blocked como `question` tipo `pr-retry` (superfície bloqueada do core reutilizada); guarda da espera pr-merged no `enter()` do core (fail-closed, `pr-open-failed`, run.wait null); `ensurePr` grava pull request vinculado antes do último stageDone; linha "aguardando" no CommentRecord (`waitingSaid`), uma vez por rodada; retry pela porta auditada, corrige `run.baseBranch`; `baseGone` por evidência (VcsError 4xx/`invalid` + baseBranch ≠ default re-lido), nunca parsing da mensagem; o run pausa onde está e retoma por nova tentativa da etapa atual; rebobinar descartado.

## Restrições

- Toda string de usuário por t(), catálogos EN+PT, chaves em ordem nos dois (guardas: i18n:lint e o teste de ordem do ui-i18n); testes com fakes de test/helpers/, sem rede nem host real.
- `answer()` e `answerPost` recusam pergunta `pr-retry` (a base é escolhida na tela, não em texto).
- A implementação respeita as definições de 'waiting' e 'blocked' do core de corridas.

## Tentado e descartado

- Estado `failed` para a falha de abertura do pull request; supressão da linha de espera só em memória; rebobinar o fluxo até a etapa que empurrou; parsing da mensagem do host.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Revisão devolvida com seis bloqueantes; estado desta sessão: (1) guarda restrita a pr-merged confirmada por leitura de transitions.ts (l.104-113, `stage.waitsFor.kind === 'pr-merged' && !prRecorded(run)`) e esperas do runner-flow voltam a passar; (2) chaves main.runs.stage.prBlocked/prBaseGone/prRetry presentes em EN e PT (l.1211-1213); (3) PT main.forum.code.runner.pr.failed com {branch} (l.1199); (4) PT main.forum.code.runner.review.waiting com a frase once-per-round (l.1187), main.forum.code.run.stage.noPullRequest (l.1215) e ui.cycle.action.retryPr/ui.cycle.error.prOpenFailed (l.62/157) presentes; (5) tmp-del.json apagado; (6) test/runner-pr-blocked.test.ts CONSTANTES não compilável (rascunho) — reescrever pelos sete comportamentos do plano; caso puro de runActions pr-retry fica em test/run-view.test.ts (~l.70).
- ui-cycle.en.json: chaves ui.cycle.prRetry.* movidas nesta sessão para posição ordenada; o mesmo movimento no ui-cycle.pt-BR.json NÃO foi feito nesta sessão (fica vermelho nos 2: primeiro mismatch do PT em ui.cycle.prRetry, deve ir depois de ui.cycle.error.prOpenFailed).
- Passa nesta sessão: npx tsc --noEmit; npm run i18n:lint (0 acima do limite 0); vitest de runner-response, ui-test, ui-check, order-issues. FALTA: vitest completo, theme-audit, public-audit do diff de catálogos por comando, reescrita de 3_IMPLEMENTATION.md e CHANGELOG.md Unreleased (duas linhas: corrida bloqueada + linha de espera uma vez por rodada).
- Rota da revisão devolvida (4_REVIEW.md):trfs a revisão das próximas rodadas confere só os pontos da lista e não reabre o que está bom.
- Passagens para o final: tl-plataforma → developer (order do 2_PLAN.md: types → transitions → publish.ts → service/module → view/renderer → catálogos → testes; ensurePr só antes dos stageDone cuja etapa seguinte é espera pr-merged; retry pela porta auditada; uma edição por arquivo por rodada).
- Passagem support → product-owner (lista de aceite da triagem): falha de abertura do pull request termina blocked com a resposta do host e a branch alvo visíveis (tela, lista e thread); nunca esperar pr-merged sem pull request publicado ou vinculado; linha "aguardando" no máximo uma vez por rodada e varredura silenciosa até existir.
- Passagem product-owner → pessoa: Implement de acordo com 1_SPEC.md (critérios: blocked com motivo na tela/lista/thread; espera pr-merged nunca sem pull request; baseGone com retry à escolha; linha de revisão uma vez por rodada; retry bem-sucedido retoma o fluxo; pull request existindo reentrega os rascunhos). Testes: 422 de ramo base inexistente, a guarda, a linha uma vez por rodada. <!-- handoff:16 -->
- Passagem support → product-owner: Implement per 0_TRIAGE.md acceptance list: (1) when the pull request cannot be opened after the push, end the stage blocked with the host's answer and the target branch as the reason, visible on the run screen, in the runs list and in the thread, and keep a base-branch-gone message with a retry (chosen base or re-read of the open release); (2) never start the pr-merged wait without a published or linked pull request; (3) emit the review "waiting" line at most once per round and keep the sweep silent until the pull request exists. Tests: a 422 for a vanished base branch, the wait guard, and the… <!-- handoff:8 -->
- Passagem tl-plataforma → pessoa: Implement per 2_PLAN.md, in the order it lists (types → transitions + index → publish.ts → service/module → view/renderer → catalogs → tests). Decoding notes: (1) the two waiting-line emission sites are publish.ts ~l.457 (deliver) and ~l.755 (publishReview); both check and set waitingSaid on the comment record (key review-N), so a new round key says again naturally. (2) Apply prOpenBlocked through moveRun only when the run is still status 'working'; otherwise the thread line lands and the run is untouched. (3) In settle(), the ensurePr hook goes only before the stageDone paths whose following … <!-- handoff:33 -->
- Passagem developer → revisor-plataforma: Continuar a implementação de 160 por onde ela parou: (1) apagar src/shared/i18n/tmp-del.json (lixo, não faz parte da entrega) e confirmar com git status que não ficou nada fora dela; (2) reescrever por inteiro o arquivo incompleto test/runner-pr-blocked.test.ts (o conteúdo atual é rascunho e não deve ser mantido): cenários do plano — 422 de ramo base inexistente → run em question/pr-retry com a resposta do host, bases alvo primeiro e padrão depois, baseGone true, thread com runner.pr.failed com a branch, tom blocked; retryPr da tela da corrida até o fim do fluxo (pergunta limpa, baseBranch cor… <!-- handoff:62 -->
- Passagem revisor-plataforma → developer: A revisão reprovou com seis bloqueantes. O mais grave: a guarda da espera pr-merged no enter() do core (transitions.ts) foi aplicada a TODAS as esperas, não só pr-merged, e três testes existentes do runner-flow falham por isso (esperas de tempo e linked-done viram failed com pr-open-failed). As chaves main.runs.stage.prBlocked/prBaseGone/prRetry, usadas em publish.ts e transitions.ts, não existem em nenhum dos dois catálogos (texto cru na tela em execução); runner.pr.failed não ganhou o parâmetro {branch} que o código passa, então a linha do thread nunca nomeia a branch alvo; o catálogo pt-BR … <!-- handoff:80 -->
