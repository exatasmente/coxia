# Memória do ciclo

## Decisões

- Resposta: **Esclarecimento** Os registros estão no próprio feed de ações do app (aba de ações do workspace, cada passo release-git com sua saída), não em arquivo externo. Li-os e extraí o padrão: <!-- answer:12 -->
  - **Issue 75 (0.6.1):** ~25 steps release-git skipped entre 05 e 06/10. Gatilho dominante: a branch release/0.6.1 estava com checkout em outro worktree — "uma branch não pode ter checkout duas vezes". Ao voltar, o passo estável recusou com "tag v0.6.1 already exists".
  - **Issue 115 (0.7.0):** o mesmo gatilho de checkout duplo, mais a guarda de ordem "envie main primeiro: a tag v0.7.0 ainda não está em origin/main" e um skip sem efeito.
  - **Issue 151 (0.9.0):** um skip real de conteúdo — "CHANGELOG.md: [Unreleased] is empty" — bloqueando o corte da próxima beta; os outros dois foram pushes sem nada a enviar.
- **Gatilho comum:** estado ambiente, não conteúdo da release — checkout duplo da branch de release em worktrees, tag já existente, CHANGELOG vazio.
- **Refino (1_SPEC.md aprovado):** escopo = app detecta o conflito de checkout da branch de release em outro worktree antes de rodar o passo, para cedo com mensagem que nomeia branch e worktree, e oferece soltar o checkout com confirmação da pessoa. Recusas "tag já existe" e "[Unreleased] vazio" ficam como portões, com mensagem orientando o próximo passo. Fora do escopo: escrever changelog, tocar worktree sem sim, mudar ordem dos passos ou portões existentes.
- **Plano (2_PLAN.md escrito):** no código há hoje `checkedOutElsewhere`/`switchTo` com a recusa `main.release.branchElsewhere` nos passos merge-pr, beta e push-branch — mas só depois do passo começar; `open` e `stable` não passam por esse conflito. Plano: `assertBranchFree` + `ReleaseConflictError` em `runReleaseOp` antes de `prepareWorktree`; `freeBranchCheckout` (recusa pasta apagada, outro repositório, tree suja, branch movida; desanexa com `switch --detach` no mesmo commit) chamado por `freeReleaseCheckout` em actions.ts atrás de `audited`; campo opcional `conflict?: {branch, path}` em `ReleaseAction` (src/shared/types.ts, sem migration de config); orientações de próximo passo ADDIÇÕES às recusas do script (`scriptFailGuidance`, não no lugar da saída crua); botão de liberar na tela de ações com o padrão de confirmação de `approveAction`; chaves novas em ambos os catálogos; CHANGELOG Unreleased. Teste por comportamento: `test/release-git-conflict.test.ts` (novo), estende `release-actions.test.ts` e um teste de tela novo.
- Triagem: tipo é pedido de investigação, não bug; mecanismo gate-skip/wait-skip com motivo obrigatório lido em src/shared/runs.

## Restrições

- Contagens e motivos vêm do relato de quem abriu ao ler o feed hoje; não reexaminados de primeira mão pelos agentes (não verificados).
- Critérios 2 e 3 da spec (sem novo skip ao repetir o passo; corte de beta simulado em repositório de teste) ficam marcados no plano como a conferir na etapa de teste, não prometidos.

## Tentado e descartado

- Buscar os registros dos releases neste repositório: não estão aqui; ficam no feed de ações do app.

## Perguntas abertas

- Nenhuma bloqueante: confirmação de liberar o checkout tem a regra de parar e pedir quando o caso for imprevisível (worktree de outro repositório, caminho inexistente).

## Onde o trabalho está

- Plano concluído (0_TRIAGE.md, 1_SPEC.md, 2_PLAN.md). Próxima etapa: implementação pela plataforma na ordem do 2_PLAN.md (seção "Ordem do trabalho"), com os testes e as portas listadas lá. Prioridade proposta: priority:medium; marco proposto: hardening do próximo corte de release (aguarda aceite). <!-- handoff:plataforma -->
- Passagem support → product-owner: Refino do produto: os dados da investigação já estão colhidos e o gatilho comum está identificado (checkout duplo da branch de release em worktrees, tag já existente, CHANGELOG [Unreleased] vazio). Decidir se a correção sugerida — liberar o checkout da branch de release nos demais worktrees antes do corte e proteger o corte de beta com o [Unreleased] preenchido — vira trabalho concreto (escopo em um ou mais issues), e definir prioridade. <!-- handoff:19 -->
