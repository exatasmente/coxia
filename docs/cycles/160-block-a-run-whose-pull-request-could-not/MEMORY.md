# Memória do ciclo

## Decisões

- Triagem: bug, não duplicada, acionável; relacionada a #133 (mesma família).
- Refinamento: 1_SPEC.md escrito a partir da triagem, sem projetar solução; 5 regras, 6 critérios de aceite, sem pergunta bloqueante (a escolha de como o retry pega o ramo base é da implementação).
- Prioridade proposta (só sugestão): priority:high — falha silenciosa, espera sem saída, 150+ linhas idênticas por thread, recuperação manual.

## Restrições

- Toda string de usuário por t(), catálogos EN+PT; testes com fakes de test/helpers/, sem rede nem host real.
- Commit em inglês, sem número de issue (app acrescenta).
- A implementação respeita as definições de 'waiting' e 'blocked' do core de corridas (src/shared/runs: view.ts trata failed como blocked; transitions.ts marca wait-started).

## Tentado e descartado

- Nenhuma tentativa de correção ainda.

## Perguntas abertas

- Nenhuma para quem abriu.

## Onde o trabalho está

- Refinamento completo: 0_TRIAGE.md e 1_SPEC.md na pasta do ciclo. Comportamento de hoje confirmado por leitura de código: publish.ts (runner.pr.failed em dois caminhos da abertura), service.ts flush()/sweep (re-envia drafts 'mr' de corridas não canceladas), publish.ts runner.review.waiting (duas emissões, l.457 e l.755), transitions.ts wait-started sem guarda de pull request. Nada executado. Próxima etapa: implementação; handoff detalha a lista de aceite e os testes pedidos.
- Passagem support → product-owner: Implement per 0_TRIAGE.md acceptance list: (1) when the pull request cannot be opened after the push, end the stage blocked with the host's answer and the target branch as the reason, visible on the run screen, in the runs list and in the thread, and keep a base-branch-gone message with a retry (chosen base or re-read of the open release); (2) never start the pr-merged wait without a published or linked pull request; (3) emit the review "waiting" line at most once per round and keep the sweep silent until the pull request exists. Tests: a 422 for a vanished base branch, the wait guard, and the… <!-- handoff:8 -->
