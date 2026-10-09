# Memória do ciclo

## Decisões

- Resposta: **Esclarecimento** Os registros estão no próprio feed de ações do app (aba de ações do workspace, cada passo release-git com sua saída), não em arquivo externo. Li-os e extraí o padrão: <!-- answer:12 -->
  - **Issue 75 (0.6.1):** ~25 steps release-git skipped entre 05 e 06/10. Gatilho dominante: a branch release/0.6.1 estava com checkout em outro worktree — "uma branch não pode ter checkout duas vezes". Ao voltar, o passo estável recusou com "tag v0.6.1 already exists".
  - **Issue 115 (0.7.0):** o mesmo gatilho de checkout duplo, mais a guarda de ordem "envie main primeiro: a tag v0.7.0 ainda não está em origin/main" e um skip sem efeito.
  - **Issue 151 (0.9.0):** um skip real de conteúdo — "CHANGELOG.md: [Unreleased] is empty" — bloqueando o corte da próxima beta; os outros dois foram pushes sem nada a enviar.
- **Gatilho comum:** estado ambiente, não conteúdo da release — checkout duplo da branch de release em worktrees, tag já existente, CHANGELOG vazio.
- **Spec (1_SPEC.md aprovada):** escopo = app detecta o conflito de checkout da branch de release em outro worktree antes de rodar o passo, para cedo com mensagem que nomeia branch e worktree, e oferece soltar o checkout com confirmação da pessoa. Recusas "tag já existe" e "[Unreleased] vazio" ficam como portões, com mensagem orientando o próximo passo.
- **Plano (2_PLAN.md):** `assertBranchFree` + `ReleaseConflictError` em `runReleaseOp` antes de `prepareWorktree`; `freeBranchCheckout` (recusa pasta apagada, outro repositório, tree suja, branch movida; desanexa com `switch --detach` no mesmo commit) chamado por `freeReleaseCheckout` em actions.ts atrás de `audited`; campo opcional `conflict` em `ReleaseAction` (src/shared/types.ts, sem migration de config); `scriptFailGuidance` acrescenta orientação à saída crua do script; botão de liberar na tela com o padrão de confirmação de `approveAction`.
- **Implementação feita:** tudo da ordem do plano; canal novo `actions:freeBranch` servido em src/main/index.ts; o `buildApi` genérico deixa `api.freeReleaseCheckout` disponível ao renderer sem mudança extra; tipo de auditoria novo `worktree`. Testes: test/release-git-conflict.test.ts e test/release-conflict-screen.test.ts novos; test/release-actions.test.ts estendido; test/release-git.test.ts ajustado (worktree alheio passa a ser recusado pelo conflito cedo, garantia de não rodar mantida).

## Restrições

- Contagens e motivos vêm do relato de quem abriu ao ler o feed hoje; não reexaminados de primeira mão pelos agentes (não verificados).
- Critérios 2 e 3 da spec (sem novo skip ao repetir o passo; corte de beta simulado em repositório de teste) ficam marcados no plano como a conferir na etapa de teste, não prometidos.
- No worktree não há `@playwright/mcp` em node_modules: os testes de browser falham por ambiente, não pela mudança.

## Tentado e descartado

- Buscar os registros dos releases neste repositório: não estão aqui; ficam no feed de ações do app.

## Perguntas abertas

- Nenhuma bloqueante: confirmação de liberar o checkout tem a regra de parar e pedir quando o caso for imprevisível (worktree de outro repositório, caminho inexistente).

## Onde o trabalho está

- Implementação concluída e portões rodados: `npx tsc --noEmit` limpo; `npx vitest run` nos cinco arquivos tocados com 127 testes passando (a suite completa também correu: 6558 passaram; falhas restantes só de ambiente — node_modules sem `@playwright/mcp` neste worktree — e um timeout isolado que passou sozinho); `theme-audit`, `i18n:lint` (5375 chaves nos dois idiomas) e `public-audit` limpos. Próxima etapa: teste (validação dos critérios 2 e 3 da spec e dos cenários de interface do feed).
- Triagem: tipo é pedido de investigação, não bug; mecanismo gate-skip/wait-skip com motivo obrigatório lido em src/shared/runs. Prioridade proposta: priority:medium; marco proposto: hardening do próximo corte de release (aguarda aceite).
- Passagem support → product-owner: Refino do produto: os dados da investigação já estão colhidos e o gatilho comum está identificado (checkout duplo da branch de release em worktrees, tag já existente, CHANGELOG [Unreleased] vazio). Decidir se a correção sugerida — liberar o checkout da branch de release nos demais worktrees antes do corte e proteger o corte de beta com o [Unreleased] preenchido — vira trabalho concreto (escopo em um ou mais issues), e definir prioridade. <!-- handoff:19 -->
- Passagem tl-plataforma → pessoa: Implementação pela plataforma seguindo 2_PLAN.md na ordem dada: em src/main/releaseGit.ts (assertBranchFree + ReleaseConflictError chamados em runReleaseOp antes de prepareWorktree; freeBranchCheckout com as quatro recusas), depois i18n/CHANGELOG, depois actions.ts (freeReleaseCheckout atrás de audited, campo conflict no catch de approveAction) com o campo opcional em src/shared/types.ts, o botão da tela, e os testes da tabela. Critérios 2 e 3 da spec ficam como a validar na etapa de teste; nada além do que o plano lista. <!-- handoff:42 -->
