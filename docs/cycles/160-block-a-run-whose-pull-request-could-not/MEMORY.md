# Memória do ciclo

## Decisões

- Bug confidoming; fix segue 2_PLAN.md aprovado: blocked como question tipo pr-retry; ensurePr antes do último stageDone; linha de espera uma vez por rodada via waitingSaid no registro do comentário; retry pela porta auditada; baseGone por evidência (VcsError 4xx/invalid + base gravada ≠ padrão re-lido), nunca parsing da mensagem.
- Guarda da espera na rodada 4: ficou no enter() do core, restrita a pr-merged e só quando o registro `comments.pr` está `refused` (proposta recusada: nada virá por fluxo próprio). Rascunho ou `proposed` (esperando o sim) não rebatem a espera — é o caminho normal dos fluxos não-autônomos (docs executa o ready antes do sim do push: comprovado por dump no runner-docs). A marcação `refused` vem de failPr (publish.ts) quando a abertura falha e o registro não está no rastreador; recovery puro (descrição recusada → failed pr-open-failed → publicado → retry → espera) em runner-flow e runner-pr-blocked.
- `runs:retryPr` é escrita direta no code host: em EXTERNAL_EFFECT (webPolicy.ts) e classificado no mapa do runs-policy (mesmo comutador de runs:command/startRelease).
- Resposta: volta para corrigir <!-- answer:212 -->

## Restrições

- Toda string user-facing por t(); catálogos EN+PT em ordem alfabética entre si e sem duplicatas (testes de ordem e gêmea do ui-i18n); terminologia neutra: nem EN nem pt-BR dizem 'pull request' literal nas famílias do runner/cycle — usa `{crLong}` (host-terms testes); CHANGELOG Unreleased para mudança user-visível (entrada já posta).

## Tentado e descartado

- Guarda do core falhando fechado em toda espera sem PR gravado: rebatia fluxos normais não-autônomos (10 testes antigos). Relaxada via `proposed`: ainda rebatia docs (registro `draft` no ready). Estado final: recusa só com registro `refused`.
- Estado 'failed' para a falha de abertura do pull request; rebobinar o fluxo; parsing da mensagem do host; supressão da linha de espera em memória.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Implementação, rodada 4: portões reportados na sessão (tsc 0 erros; i18n:lint, theme-audit, public-audit limpos; vitest completa 312 arquivos, 3 falhando: 1 timing em conflict-resolve, o caso reescrito do runner-flow sem prova no tempo, e um --check de updates; todos os arquivos tocados pela issue passam).
- 3_IMPLEMENTATION.md reescrito; CHANGELOG Unreleased entrada posta; tmp-del.json já não existe.
- Não verificado: prova final da reescrita do caso do runner-flow (últimos comandos do portão não couberam no tempo) e a tela do retry (PrRetryChoice) em navegador.
- Rota de revisão: conferir só os bloqueantes restantes desta rodada e não reabrir o que já passou (esmaecido, transições, catálogos em ordem, DIN da espera).
- Passagem support → product-owner: Implement per 0_TRIAGE.md acceptance list: (1) when the pull request cannot be opened after the push, end the stage blocked with the host's answer and the target branch as the reason, visible on the run screen, in the runs list and in the thread, and keep a base-branch-gone message with a retry (chosen base or re-read of the open release); (2) never start the pr-merged wait without a published or linked pull request; (3) emit the review "waiting" line at most once per round and keep the sweep silent until the pull request exists. Tests: a 422 for a vanished base branch, the wait guard, and the… <!-- handoff:8 -->
- Passagem product-owner → pessoa: Implement de acordo com 1_SPEC.md, que traduz a lista de aceite da triagem: (1) falha de abertura do pull request após o push termina o estágio blocked com a resposta do host e o ramo alvo, visível na tela da corrida, na lista e no thread; (2) a espera pr-merged nunca parte sem pull request publicado ou vinculado; (3) quando o ramo base sumiu, o motivo diz isso e a tela da corrida oferece retry com base à escolha; (4) a linha de revisão 'aguardando o pull request' sai no máximo uma vez por rodada e a varredura fica em silêncio até o pull request existir. Testes: 422 de ramo base inexistente, a… <!-- handoff:16 -->
- Passagem tl-plataforma → pessoa: Implement per 2_PLAN.md, in the order it lists (types → transitions + index → publish.ts → service/module → view/renderer → catalogs → tests). Decoding notes: (1) the two waiting-line emission sites are publish.ts ~l.457 (deliver) and ~l.755 (publishReview); both check and set waitingSaid on the comment record (key review-N), so a new round key says again naturally. (2) Apply prOpenBlocked through moveRun only when the run is still status 'working'; otherwise the thread line lands and the run is untouched. (3) In settle(), the ensurePr hook goes only before the stageDone paths whose following … <!-- handoff:33 -->
- Passagem developer → revisor-plataforma: Continuar a implementação de 160 por onde ela parou: (1) apagar src/shared/i18n/tmp-del.json (lixo, não faz parte da entrega) e confirmar com git status que não ficou nada fora dela; (2) reescrever por inteiro o arquivo incompleto test/runner-pr-blocked.test.ts (o conteúdo atual é rascunho e não deve ser mantido): cenários do plano — 422 de ramo base inexistente → run em question/pr-retry com a resposta do host, bases alvo primeiro e padrão depois, baseGone true, thread com runner.pr.failed com a branch, tom blocked; retryPr da tela da corrida até o fim do fluxo (pergunta limpa, baseBranch cor… <!-- handoff:62 -->
- Passagem revisor-plataforma → developer: A revisão reprovou com seis bloqueantes. O mais grave: a guarda da espera pr-merged no enter() do core (transitions.ts) foi aplicada a TODAS as esperas, não só pr-merged, e três testes existentes do runner-flow falham por isso (esperas de tempo e linked-done viram failed com pr-open-failed). As chaves main.runs.stage.prBlocked/prBaseGone/prRetry, usadas em publish.ts e transitions.ts, não existem em nenhum dos dois catálogos (texto cru na tela em execução); runner.pr.failed não ganhou o parâmetro {branch} que o código passa, então a linha do thread nunca nomeia a branch alvo; o catálogo pt-BR … <!-- handoff:80 -->
- Passagem developer → revisor-plataforma: Reabrir corretamente a partir de onde esta sessão parou: (1) mover a chave ui.cycle.prRetry.* no ui-cycle.pt-BR.json para a posição ordenada (o en já movido por esta sessão; a prova é o teste de ordem de ui-i18n) e conferir com npx vitest run test/ui-i18n.test.ts e npm run i18n:lint; (2) terminar de reescrever test/runner-pr-blocked.test.ts pelos sete comportamentos do 2_PLAN.md (o arquivo atual é raspunho não compilável; o caso puro de runActions já está em run-view.test.ts); (3) rodar os portões (tsc --noEmit, vitest run, theme-audit, i18n:lint, public-audit) e relatar o resultado de cada um… <!-- handoff:162 -->
- Passagem pessoa → developer: volta para corrigir <!-- handoff:213 -->
