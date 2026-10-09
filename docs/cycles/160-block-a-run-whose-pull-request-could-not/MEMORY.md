# Memória do ciclo

## Decisões

- Bug confirmado; fix seguindo 2_PLAN.md aprovado: blocked como `question` tipo `pr-retry` (superfície bloqueada do core reaproveitada); guarda da espera pr-merged no `enter()` do core (fail-closed, falha com `pr-open-failed` e undefined run.wait); `ensurePr` grava pull request vinculado antes do último stageDone; linha de 'aguardando' marcada no CommentRecord (`waitingSaid`), uma vez por rodada; retry pela porta auditada (sem proposta), corrige `run.baseBranch`; `baseGone` por evidência (VcsError 4xx/`invalid` + baseBranch ≠ default re-lido), nunca parsing da mensagem; o run pausa onde está e retoma por nova tentativa da etapa atual (como ask/answer), rebobinar descartado.

## Restrições

- Toda string de usuário por t(), catálogos EN+PT; testes com fakes de test/helpers/, sem rede nem host real.
- `answer()` e `answerPost` recusam pergunta `pr-retry` (a base é escolhida na tela, não em texto).
- A implementação respeita as definições de 'waiting' e 'blocked' do core de corridas.

## Tentado e descartado

- Estado `failed` para a falha de abertura do pull request; supressão da linha de espera só em memória; rebobinar o fluxo até a etapa que empurrou; parsing da mensagem do host.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Código da implementação escrito e `npx tsc --noEmit` passou; catálogos completos; testes pendentes: runner-pr-blocked.test.ts está como rascunho incompleto a reescrever; caso de runActions pendente; portões padrão (vitest run, theme-audit, i18n:lint, public-audit) ainda não rodados nesta sessão.
- Arquivo lixo a remover: src/shared/i18n/tmp-del.json.
- Edital: edições em paralelo no mesmo arquivo se perdiam nesta sessão — uma edição por vez, verificar com grep.
- Passagem support → product-owner: Executar de acordo com 0_TRIAGE.md: (1) falha de abertura do pull request termina a etapa blocked com a resposta do host e o ramo alvo, visível na tela, na lista e no thread, com mensagem de ramo base sumido e retry (base à escolha ou releitura da release aberta); (2) nunca iniciar a espera pr-merged sem pull request publicado ou vinculado; (3) linha 'aguardando' no máximo uma vez por rodada, varredura silenciosa até existir. Testes: 422 de ramo base inexistente, guarda da espera, linha única por rodada — com fakes, host real proibido.
- Passagem support → product-owner: Implement per 0_TRIAGE.md acceptance list: (1) when the pull request cannot be opened after the push, end the stage blocked with the host's answer and the target branch as the reason, visible on the run screen, in the runs list and in the thread, and keep a base-branch-gone message with a retry (chosen base or re-read of the open release); (2) never start the pr-merged wait without a published or linked pull request; (3) emit the review "waiting" line at most once per round and keep the sweep silent until the pull request exists. Tests: a 422 for a vanished base branch, the wait guard, and the… <!-- handoff:8 -->
- Passagem product-owner → pessoa: Implement de acordo com 1_SPEC.md, que traduz a lista de aceite da triagem: (1) falha de abertura do pull request após o push termina o estágio blocked com a resposta do host e o ramo alvo, visível na tela da corrida, na lista e no thread; (2) a espera pr-merged nunca parte sem pull request publicado ou vinculado; (3) quando o ramo base sumiu, o motivo diz isso e a tela da corrida oferece retry com base à escolha; (4) a linha de revisão 'aguardando o pull request' sai no máximo uma vez por rodada e a varredura fica em silêncio até o pull request existir. Testes: 422 de ramo base inexistente, a… <!-- handoff:16 -->
- Passagem tl-plataforma → pessoa: Implement per 2_PLAN.md, in the order it lists (types → transitions + index → publish.ts → service/module → view/renderer → catalogs → tests). Decoding notes: (1) the two waiting-line emission sites are publish.ts ~l.457 (deliver) and ~l.755 (publishReview); both check and set waitingSaid on the comment record (key review-N), so a new round key says again naturally. (2) Apply prOpenBlocked through moveRun only when the run is still status 'working'; otherwise the thread line lands and the run is untouched. (3) In settle(), the ensurePr hook goes only before the stageDone paths whose following … <!-- handoff:33 -->
