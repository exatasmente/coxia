# Memória do ciclo

## Decisões

- A issue 162 é tarefa de condução do ciclo (não bug nem feature). O escopo afilado: as 8 execuções `failed` (lote de 07/10, ~14:46–48, motivo único "a sugestão não está mais esperando": decisão no gate já caída, alvo encerrado) estão cobertas pela issue **#188** — a 1_SPEC.md as põe fora do escopo aqui.
- "Pending" = sugestão do suggest-agent gerada e à espera de aceitar/recusar na tela de sugestões (não é estado do registro de execução em `src/shared/runs/types.ts`). Contagens divergem: issue dizia 6, esclarecimento de quem abriu diz 10 (lote de 07/10: worktree-gate, pr-opener, ambient, fechamento, test-runner, checker; lote de 09/10: review-unifier, re-revisor, despachante, reparo); contagem não verificada nesta etapa — a que vale é a que a tela mostra no fechamento.
- 1_SPEC.md escrita: decidir cada cartão em bloco (aceitar/editar/recusar com motivo), registrar a decisão de cada um, confirmar a contagem na tela antes; critérios de aceite verificáveis na tela de sugestões.
- Resposta: **Esclarecimento** Li o feed de ações do app (tipo suggest-agent). O que ele mostra hoje: - **8 failed — todas em 07/10, ~14:46:47–48, com o mesmo motivo:** "a sugestão não está mais esperando" — a decisão no gate de sugestões já tinha caído e a aplicação da sugestão encontrou o alvo encerrado. Sugestões afetadas: plan-refresher, typecheck, tsc-audit, gatekeeper, feedback-driver, preflight, criterios, verifier. Não há mensagem de erro além dessa; a retomada é descartar o lote, não tentar de novo. - **Esperando decisão (pending):** o feed mostra hoje **10** (a issue dizia 6): o lote de 07/10 (w… <!-- answer:9 -->

## Restrições

- Só leitura nas etapas de especificação; a escrita é feita pelo app.
- Poço de contexto: `src/main/suggestionsModule.ts`, `src/shared/suggestions.ts` (cartão: suggestionId, name, role, stage, prompt, evidence, rejectedBefore; decisões: accepted/edited/rejected), `src/main/runs.ts`, `src/shared/runs/types.ts`; sugestões gravam em `suggestions.json` nos dados do workspace, runs em `<workspace>/runs/<id>.json`.

## Tentado e descartado

- Pergunta a quem abriu sobre o significado de "pending" e as mensagens de erro das failed: respondida em 09/10, nada a repetir.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Triagem concluída (0_TRIAGE.md) e refinamento concluído (1_SPEC.md). A seguir: etapa de fechamento — abrir a tela de sugestões, decidir os ~10 cartões pendentes e registrar cada decisão; confirmar a contagem na tela, pois a da issue e do esclarecimento podem estar desatualizadas. A parte failed segue na issue #188; a retomada, se couber, é descartar o lote, não tentar de novo.
- Passagem support → product-owner: A etapa seguinte fica com o fechamento das sugestões pendentes: abrir a tela de sugestões do app, revisar as ~10 sugestões à espera de decisão (lote de 07/10: worktree-gate, pr-opener, ambient, fechamento, test-runner, checker; lote de 09/10: review-unifier, re-revisor, despachante, reparo) e aceitar ou recusar cada uma, registrando a decisão. As 8 failed de 07/10 têm causa conhecida ("a sugestão não está mais esperando") e são da alçada da issue #188; a retomada, se couber, é descartar o lote, não tentar de novo. Confirmar a contagem na tela, pois a da issue e a da resposta podem estar desatu… <!-- handoff:16 -->
