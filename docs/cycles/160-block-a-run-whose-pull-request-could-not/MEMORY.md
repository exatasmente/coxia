# Memória do ciclo

## Decisões

- Triagem: bug, não duplicada, acionável; relacionada a #133 (mesma família).
- Refinamento: 1_SPEC.md, 5 regras, 6 critérios de aceite, sem pergunta bloqueante.
- Prioridade proposta (só sugestão): priority:high — falha silenciosa, espera sem saída, 150+ linhas idênticas por thread, recuperação manual.
- Plano (2_PLAN.md): o estado blocked é `question` com novo tipo `pr-retry` (superfície bloqueada do core reaproveitada; escolha de base no lugar da caixa de texto); não se rebobina o fluxo até a etapa que empurrou — texto e histórico nomeiam o ramo alvo e a corrida pausa onde está; `baseGone` por evidência (VcsError 4xx/`invalid` + baseBranch gravada ≠ default re-lido via getRepo), nunca parsing da mensagem; a guarda da espera fica no `enter()` do core (fail-closed, código novo `pr-open-failed`) e os pull requests vinculados entram por `ensurePr` no settle antes do último stageDone; proposta ainda não aprovada ('proposed') não satisfaz a guarda (fallback de uma linha no plano se a QA mostrar atrito); a linha de 'aguardando' usa `waitingSaid` persistido no CommentRecord (uma vez por rodada, sobrevive a reinício); retry é ação da pessoa pela porta auditada (sem proposal novo), reusa o draft e corrige `run.baseBranch`.

## Restrições

- Toda string de usuário por t(), catálogos EN+PT; testes com fakes de test/helpers/, sem rede nem host real.
- Commit em inglês, sem número de issue (app acrescenta).
- As transições novas (`prOpenBlocked`, `prRetryAnswered`, `recordCommentWaiting`) seguem as formas de `ask()`/`answer()`/`recordCommentRefused()` e os guards de estado do core.
- RetryPr válido só com pergunta `pr-retry` aberta; falha de novo reergue a pergunta; sucesso reusa `pullRequestOpened` → `flush`.
- A implementação respeita as definições de 'waiting' e 'blocked' do core de corridas (view.ts: failed/question são blocked; transitions.ts marca wait-started).

## Tentado e descartado

- Estado `failed` para a falha de abertura do pull request: descartado — a única ação dele é retry de etapa (roda agente de novo); a pergunta bloqueada é mais barata.
- Supressão da linha de espera só em memória: descartada — o app reinicia; a marca fica no CommentRecord.
- Rebobinar o fluxo até a etapa que empurrou no bloqueio: descartado — reimplementaria o send-back sem ganho para quem lê.
- Parsing da mensagem do host para dizer 'ramo base sumiu': descartado por frágil; a flag vem de evidência (erro 4xx + default re-lido).

## Perguntas abertas

- Nenhuma para quem abriu.

## Onde o trabalho está

- Plano técnico completo: 0_TRIAGE.md, 1_SPEC.md e 2_PLAN.md na pasta do ciclo. Comportamento de hoje já confirmado por leitura de código nas etapas anteriores; nesta etapa não rodou comando nem execução de teste (leitura e escrita do plano).
- Próxima etapa: implementação, na ordem do plano (types → transitions + index → publish.ts → service/module → view/renderer → catálogos → testes), com os sete comportamentos de teste da tabela do plano e as quatro notas de decodificação no handoff.
- Passagem support → product-owner: Implement per 0_TRIAGE.md acceptance list: (1) when the pull request cannot be opened after the push, end the stage blocked with the host's answer and the target branch as the reason, visible on the run screen, in the runs list and in the thread, and keep a base-branch-gone message with a retry (chosen base or re-read of the open release); (2) never start the pr-merged wait without a published or linked pull request; (3) emit the review "waiting" line at most once per round and keep the sweep silent until the pull request exists. Tests: a 422 for a vanished base branch, the wait guard, and the… <!-- handoff:8 -->
- Passagem product-owner → pessoa: Implement de acordo com 1_SPEC.md, que traduz a lista de aceite da triagem: (1) falha de abertura do pull request após o push termina o estágio blocked com a resposta do host e o ramo alvo, visível na tela da corrida, na lista e no thread; (2) a espera pr-merged nunca parte sem pull request publicado ou vinculado; (3) quando o ramo base sumiu, o motivo diz isso e a tela da corrida oferece retry com base à escolha; (4) a linha de revisão 'aguardando o pull request' sai no máximo uma vez por rodada e a varredura fica em silêncio até o pull request existir. Testes: 422 de ramo base inexistente, a… <!-- handoff:16 -->
