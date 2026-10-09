# Memória do ciclo

## Decisões

- Bug confirmado; fix segue 2_PLAN.md aprovado: blocked como `question` tipo `pr-retry` (superfície bloqueada do core reutilizada); guarda da espera pr-merged no `enter()` do core (fail-closed, falha com `pr-open-failed` e run.wait null); `ensurePr` grava pull request vinculado antes do último stageDone; linha de "aguardando" marcada no CommentRecord (`waitingSaid`), uma vez por rodada; retry pela porta auditada (sem proposta), corrige `run.baseBranch`; `baseGone` por evidência (VcsError 4xx/`invalid` + baseBranch ≠ default re-lido), nunca parsing da mensagem; o run pausa onde está e retoma por nova tentativa da etapa atual; rebobinar descartado.

## Restrições

- Toda string de usuário por t(), catálogos EN+PT; testes com fakes de test/helpers/, sem rede nem host real.
- `answer()` e `answerPost` recusam pergunta `pr-retry` (a base é escolhida na tela, não em texto).
- A implementação respeita as definições de 'waiting' e 'blocked' do core de corridas.

## Tentado e descartado

- Estado `failed` para a falha de abertura do pull request; supressão da linha de espera só em memória; rebobinar o fluxo até a etapa que empurrou; parsing da mensagem do host.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Revisão devolvida ao developer com seis bloqueantes (4_REVIEW.md): (1) a guarda do enter() atinge TODAS as esperas, não só pr-merged — 3 testes do runner-flow quebrados; (2) chaves `main.runs.stage.prBlocked/prBaseGone/prRetry` usadas pelo código e inexistentes nos dois catálogos (texto cru na tela); (3) `runner.pr.failed` sem `{branch}` do lado do catálogo, a branch não sai no thread; (4) pt-BR sem 3 chaves e sem a frase once-per-round (i18n:lint vermelho); (5) tmp-del.json lixo ainda commitado; (6) test/runner-pr-blocked.test.ts rascunho não compilável, nenhum dos 7 comportamentos do plano testado.
- Passam hoje: caso da guarda no runner-flow, runActions de pr-retry (run-view), canal (run-web), public-audit limpo; tsc e i18n:lint vermelhões.
- Passagem support → product-owner: Executar de acordo com 0_TRIAGE.md (lista de aceite: falha de abertura do pull request termina blocked com a resposta do host e a branch alvo visíveis; nunca esperar pr-merged sem pull request publicado ou vinculado; linha "aguardando" no máximo uma vez por rodada e varredura silenciosa até existir).
- Passagem product-owner → implementação: segun 1_SPEC.md (6 critérios de aceite, testes exigidos para 2, 3 e 5).
- Passagem tl-plataforma → implementação: order do 2_PLAN.md (types → transitions → publish.ts → service/module → view/renderer → catálogos → testes); ensurePr só antes dos stageDone cuja etapa seguinte é espera pr-merged; retry pela porta auditada; uma edição por arquivo por rodada (edições paralelas se perderam nesta sessão).
- Passagem support → product-owner: Implement per 0_TRIAGE.md acceptance list: (1) when the pull request cannot be opened after the push, end the stage blocked with the host's answer and the target branch as the reason, visible on the run screen, in the runs list and in the thread, and keep a base-branch-gone message with a retry (chosen base or re-read of the open release); (2) never start the pr-merged wait without a published or linked pull request; (3) emit the review "waiting" line at most once per round and keep the sweep silent until the pull request exists. Tests: a 422 for a vanished base branch, the wait guard, and the… <!-- handoff:8 -->
- Passagem product-owner → pessoa: Implement de acordo com 1_SPEC.md, que traduz a lista de aceite da triagem: (1) falha de abertura do pull request após o push termina o estágio blocked com a resposta do host e o ramo alvo, visível na tela da corrida, na lista e no thread; (2) a espera pr-merged nunca parte sem pull request publicado ou vinculado; (3) quando o ramo base sumiu, o motivo diz isso e a tela da corrida oferece retry com base à escolha; (4) a linha de revisão 'aguardando o pull request' sai no máximo uma vez por rodada e a varredura fica em silêncio até o pull request existir. Testes: 422 de ramo base inexistente, a… <!-- handoff:16 -->
- Passagem tl-plataforma → pessoa: Implement per 2_PLAN.md, in the order it lists (types → transitions + index → publish.ts → service/module → view/renderer → catalogs → tests). Decoding notes: (1) the two waiting-line emission sites are publish.ts ~l.457 (deliver) and ~l.755 (publishReview); both check and set waitingSaid on the comment record (key review-N), so a new round key says again naturally. (2) Apply prOpenBlocked through moveRun only when the run is still status 'working'; otherwise the thread line lands and the run is untouched. (3) In settle(), the ensurePr hook goes only before the stageDone paths whose following … <!-- handoff:33 -->
- Passagem developer → revisor-plataforma: Continuar a implementação de 160 por onde ela parou: (1) apagar src/shared/i18n/tmp-del.json (lixo, não faz parte da entrega) e confirmar com git status que não ficou nada fora dela; (2) reescrever por inteiro o arquivo incompleto test/runner-pr-blocked.test.ts (o conteúdo atual é rascunho e não deve ser mantido): cenários do plano — 422 de ramo base inexistente → run em question/pr-retry com a resposta do host, bases alvo primeiro e padrão depois, baseGone true, thread com runner.pr.failed com a branch, tom blocked; retryPr da tela da corrida até o fim do fluxo (pergunta limpa, baseBranch cor… <!-- handoff:62 -->
