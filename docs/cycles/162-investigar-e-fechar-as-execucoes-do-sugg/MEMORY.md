# Memória do ciclo

## Decisões

- A issue 162 é tarefa de condução do ciclo (não bug nem feature). O escopo afilado: as 8 execuções `failed` (lote de 07/10, ~14:46–48, motivo único "a sugestão não está mais esperando": decisão no gate já caída, alvo encerrado) estão cobertas pela issue **#188** — a 1_SPEC.md as põe fora do escopo aqui.
- "Pending" = sugestão do suggest-agent gerada e à espera de aceitar/recusar na tela de sugestões (não é estado do registro de execução em `src/shared/runs/types.ts`). Contagens divergem: issue dizia 6, esclarecimento de quem abriu diz 10 (lote de 07/10: worktree-gate, pr-opener, ambient, fechamento, test-runner, checker; lote de 09/10: review-unifier, re-revisor, despachante, reparo); contagem não verificada nesta etapa — a que vale é a que a tela mostra no fechamento.
- 1_SPEC.md escrita: decidir cada cartão em bloco (aceitar/editar/recusar com motivo), registrar a decisão de cada um, confirmar a contagem na tela antes; critérios de aceite verificáveis na tela de sugestões.
- 2_PLAN.md escrita: fechamento é operação no app, sem mudança de código. Ordem: confirmar contagem na tela → decidir um cartão por vez lendo a evidência (recusa por padrão; aceite só com razão atual, exigindo que a etapa proposta ainda exista) → recontar na tela e conferir que nada ficou à espera → nota de fechamento com contagem, decisão de cada cartão e motivos. Critério 3 da spec se cumpre trivialmente se todas as sugestões forem recusadas (nada a criar) — o resultado diz isso explicitamente.
- Resposta: **Esclarecimento** (09/10) — feed de ações: 8 failed de 07/10 ~14:46–48, mesma causa "a sugestão não está mais esperando"; 10 sugestões à espera nos lotes de 07/10 e 09/10. Nada a repetir.
- Resposta: **Esclarecimento** Li o feed de ações do app (tipo suggest-agent). O que ele mostra hoje: - **8 failed — todas em 07/10, ~14:46:47–48, com o mesmo motivo:** "a sugestão não está mais esperando" — a decisão no gate de sugestões já tinha caído e a aplicação da sugestão encontrou o alvo encerrado. Sugestões afetadas: plan-refresher, typecheck, tsc-audit, gatekeeper, feedback-driver, preflight, criterios, verifier. Não há mensagem de erro além dessa; a retomada é descartar o lote, não tentar de novo. - **Esperando decisão (pending):** o feed mostra hoje **10** (a issue dizia 6): o lote de 07/10 (w… <!-- answer:9 -->

## Restrições

- Só leitura nas etapas de especificação; a escrita é feita pelo app.
- Poço de contexto: `src/main/suggestionsModule.ts`, `src/shared/suggestions.ts` (cartão: suggestionId, name, role, stage, prompt, evidence, rejectedBefore; decisões: accepted/edited/rejected), `src/main/runs.ts`, `src/shared/runs/types.ts`; sugestões gravam em `suggestions.json` nos dados do workspace, runs em `<workspace>/runs/<id>.json`.
- No fluxo (confirmado no código): aceitar exige que a etapa proposta ainda exista (`stageGone`); recusar grava motivo e dispensa o cartão em Ações; cada decisão substitui o que esperava, um registro por suggestionId. Agente criado entra como read-only, sem shell nem tracker.

## Tentado e descartado

- Pergunta a quem abriu sobre o significado de "pending" e as mensagens de erro das failed: respondida em 09/10, nada a repetir.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Triagem (0_TRIAGE.md), refinamento (1_SPEC.md) e plano (2_PLAN.md) concluídos. A seguir: etapa de fechamento — abrir a tela de sugestões, confirmar a contagem, decidir os cartões dos lotes de 07/10 e 09/10 seguindo a 2_PLAN.md (recusa por padrão, motivo nas recusas, nota de fechamento no fim) e conferir que nenhum desses cartões segue à espera. A parte failed segue na issue #188; a retomada, se couber, é descartar o lote, não tentar de novo.
- Passagem product-owner → pessoa: Fechar a fila de sugestões pendentes na tela de sugestões: confirmar a contagem atual (a issue dizia 6, o esclarecimento 10), decidir cada cartão dos lotes de 07/10 (worktree-gate, pr-opener, ambient, fechamento, test-runner, checker) e 09/10 (review-unifier, re-revisor, despachante, reparo) — aceitar, editar ou recusar com motivo — e registrar a decisão de cada uma, conferindo depois que nenhum desses cartões segue à espera. As 8 failed de 07/10 são da issue #188, não desta. <!-- handoff:26 -->
- Passagem support → product-owner: A etapa seguinte fica com o fechamento das sugestões pendentes: abrir a tela de sugestões do app, revisar as ~10 sugestões à espera de decisão (lote de 07/10: worktree-gate, pr-opener, ambient, fechamento, test-runner, checker; lote de 09/10: review-unifier, re-revisor, despachante, reparo) e aceitar ou recusar cada uma, registrando a decisão. As 8 failed de 07/10 têm causa conhecida ("a sugestão não está mais esperando") e são da alçada da issue #188; a retomada, se couber, é descartar o lote, não tentar de novo. Confirmar a contagem na tela, pois a da issue e a da resposta podem estar desatu… <!-- handoff:16 -->
