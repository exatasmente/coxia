# Memória do ciclo

## Decisões

- A issue 162 é tarefa de condução do ciclo (não bug nem feature). O escopo afilado: as 8 execuções `failed` (lote de 07/10, ~14:46–48, motivo único "a sugestão não está mais esperando": decisão no gate já caída, alvo encerrado) estão cobertas pela issue **#188** — a 1_SPEC.md as põe fora do escopo aqui.
- "Pending" = sugestão do suggest-agent gerada e à espera de aceitar/recusar na tela de sugestões (não é estado do registro de execução em `src/shared/runs/types.ts`).
- 1_SPEC.md escrita: decidir cada cartão em bloco (aceitar/editar/recusar com motivo), registrar a decisão de cada um, confirmar a contagem na tela antes; critérios de aceite verificáveis na tela de sugestões.
- 2_PLAN.md escrita: fechamento é operação no app, sem mudança de código. Ordem: confirmar contagem na tela → decidir um cartão por vez lendo a evidência (recusa por padrão; aceite só com razão atual, exigindo que a etapa proposta ainda exista) → recontar na tela e conferir que nada ficou à espera → nota de fechamento com contagem, decisão de cada cartão e motivos. Critério 3 da spec se cumpre trivialmente se todas as sugestões forem recusadas (nada a criar) — o resultado diz isso explicitamente.
- Contagem confirmada por leitura do arquivo de ações do workspace (tentativa 1 da implementação): **10 cartões à espera** (227 done, 62 skipped, 8 failed no arquivo; zero done de sugestão). Lote de 07/10 ~14:46: worktree-gate (gate2), pr-opener (implement), ambient (qa), fechamento (implement), test-runner (implement), checker (review). Lote de 09/10 00:41–00:48: review-unifier e re-revisor (review), reparo (implement), despachante (review).
- **Decisão de fechamento confirmada pela pessoa ("Pode seguir com a sugestão"): recusar as 10 em bloco**, motivo em cada recusa: "sugestão de lote antigo (07/10 ou 09/10) com evidência desatualizada; a condução do ciclo cobre a função proposta; não vira agente da equipe". Nenhuma aceita ou editada hoje.
- Resposta: **Esclarecimento** (09/10) — feed de ações: 8 failed de 07/10 ~14:46–48, mesma causa "a sugestão não está mais esperando"; 10 sugestões à espera nos lotes de 07/10 e 09/10. Nada a repetir.
- Resposta: **Esclarecimento** Li o feed de ações do app (tipo suggest-agent). O que ele mostra hoje: - **8 failed — todas em 07/10, ~14:46:47–48, com o mesmo motivo:** "a sugestão não está mais esperando" — a decisão no gate de sugestões já tinha caído e a aplicação da sugestão encontrou o alvo encerrado. Sugestões afetadas: plan-refresher, typecheck, tsc-audit, gatekeeper, feedback-driver, preflight, criterios, verifier. Não há mensagem de erro além dessa; a retomada é descartar o lote, não tentar de novo. - **Esperando decisão (pending):** o feed mostra hoje **10** (a issue dizia 6): o lote de 07/10 (w… <!-- answer:9 -->
- Resposta: o team lead respondeu <!-- answer:180 -->
- Resposta: Pode seguir com a sugestão <!-- answer:199 -->

## Restrições

- Poço de contexto: `src/main/suggestionsModule.ts`, `src/shared/suggestions.ts` (cartão: suggestionId, name, role, stage, prompt, evidence, rejectedBefore; decisões: accepted/edited/rejected), `src/main/runs.ts`, `src/shared/runs/types.ts`; sugestões gravam em `suggestions.json` nos dados do workspace, runs em `<workspace>/runs/<id>.json`.
- No fluxo (confirmado no código): aceitar exige que a etapa proposta ainda exista (`stageGone`); recusar grava motivo e dispensa o cartão em Ações; cada decisão substitui o que esperava, um registro por suggestionId. Agente criado entra como read-only, sem shell nem tracker.
- Editar o arquivo de sugestões à mão é proibido: a decisão só se grava pela tela única de sugestões do app, contra uma instância única nos dados reais. As ferramentas de etapa de agente não alcançam essa tela (tentativa 1 confirmou).

## Tentado e descartado

- Pergunta a quem abriu sobre o significado de "pending" e as mensagens de erro das failed: respondida em 09/10, nada a repetir.
- Registrar as decisões a partir da etapa de agente: impossível (tela única do app inalcançável pelas ferramentas; segunda instância proibida); a confirmação da decisão foi pedida à pessoa e dada.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Triagem, refinamento, plano e implementação concluídos; 3_IMPLEMENTATION.md traz a contagem confirmada (10, lista cartão a cartão), a decisão confirmada (recusar as 10) e o estado perante os critérios de aceite (critério 4 cumprido; 1 e 2 por cumprir).
- Falta a execução das recusas: na tela de sugestões do app, recusar os 10 cartões com o motivo confirmado, um por vez, e reabrir a tela para conferir que nenhum segue à espera; depois o fechamento da issue 162 está completo. A parte failed segue na issue #188.
- Passagem support → product-owner: A etapa seguinte fica com o fechamento das sugestões pendentes: abrir a tela de sugestões do app, revisar as ~10 sugestões à espera de decisão (lote de 07/10: worktree-gate, pr-opener, ambient, fechamento, test-runner, checker; lote de 09/10: review-unifier, re-revisor, despachante, reparo) e aceitar ou recusar cada uma, registrando a decisão. As 8 failed de 07/10 têm causa conhecida ("a sugestão não está mais esperando") e são da alçada da issue #188; a retomada, se couber, é descartar o lote, não tentar de novo. Confirmar a contagem na tela, pois a da issue e a da resposta podem estar desatu… <!-- handoff:16 -->
- Passagem product-owner → pessoa: Fechar a fila de sugestões pendentes na tela de sugestões: confirmar a contagem atual (a issue dizia 6, o esclarecimento 10), decidir cada cartão dos lotes de 07/10 (worktree-gate, pr-opener, ambient, fechamento, test-runner, checker) e 09/10 (review-unifier, re-revisor, despachante, reparo) — aceitar, editar ou recusar com motivo — e registrar a decisão de cada uma, conferindo depois que nenhum desses cartões segue à espera. As 8 failed de 07/10 são da issue #188, não desta. <!-- handoff:26 -->
- Passagem tl-plataforma → pessoa: Fechar a fila de sugestões pendentes na tela de sugestões, seguindo docs/cycles/[redacted]/2_PLAN.md: abrir a tela, confirmar a contagem atual (change: pode não ser 6 nem 10), decidir um cartão por vez dos lotes de 07/10 (worktree-gate, pr-opener, ambient, fechamento, test-runner, checker) e 09/10 (review-unifier, re-revisor, despachante, reparo) — recusa com motivo por padrão para as de lote velho, aceite/editar só com razão atual e etapa existente —, recontar e conferir que nenhum desses cartões segue à espera, e registrar numa nota de fechamento a contagem confirmada, a decisão de cada cart… <!-- handoff:38 -->
