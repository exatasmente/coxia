# Memória do ciclo

## Decisões

- Resposta: **Esclarecimento** Os registros estão no próprio feed de ações do app (aba de ações do workspace, cada passo release-git com sua saída), não em arquivo externo. <!-- answer:12 -->
  - **Issue 75 (0.6.1):** ~25 steps release-git skipped entre 05 e 06/10. Gatilho dominante: a branch release/0.6.1 estava com checkout em outro worktree — "uma branch não pode ter checkout duas vezes". Ao voltar, o passo estável recusou com "tag v0.6.1 already exists".
  - **Issue 115 (0.7.0):** o mesmo gatilho de checkout duplo, mais a guarda de ordem "envie main primeiro: a tag v0.7.0 ainda não está em origin/main" e um skip sem efeito.
  - **Issue 151 (0.9.0):** um skip real de conteúdo — "CHANGELOG.md: [Unreleased] is empty" — bloqueando o corte da próxima beta; os outros dois foram pushes sem nada a enviar.
- **Gatilho comum:** estado ambiente, não conteúdo da release — checkout duplo da branch de release em worktrees, tag já existente, CHANGELOG vazio.
- **Spec (1_SPEC.md aprovada):** app detecta o conflito de checkout da branch de release em outro worktree antes de rodar o passo, para cedo com mensagem que nomeia branch e worktree, e oferece soltar o checkout com confirmação da pessoa. Recusas "tag já existe" e "[Unreleased] vazio" ficam como portões, com mensagem orientando o próximo passo.
- **Implementação (concluída) e revisão (esta etapa, aprovada):** tudo da ordem do plano — `assertBranchFree` + `ReleaseConflictError` antes de `prepareWorktree`; `freeBranchCheckout` com as quatro recusas; `freeReleaseCheckout` em actions.ts atrás de `audited`, tipo de auditoria `worktree`, campo opcional `conflict` em `ReleaseAction`; canal `actions:freeBranch`; botão de liberar na tela com o padrão de confirmação de `approveAction`; `scriptFailGuidance` acrescenta orientação à saída crua do script. Revisão conferiu diff contra spec e plano e rodou os portões: tsc limpo, 111 testes nos quatro arquivos tocados, theme-audit, i18n:lint (5375 chaves) e public-audit limpos. Um achado de sugestão: derivação duplicada do caminho do worktree de steps em actions.ts.

## Restrições

- Contagens e motivos do padrão vêm do relato de quem abriu ao ler o feed hoje; não reexaminados de primeira mão pelos agentes (não verificados).
- Critério 2 da spec verificado só pelo lado automático/estado (freeReleaseCheckout → pending → approve → done); critério 3 idem (beta corta com branch no worktree próprio da run). A leitura dos cenários no feed da interface real não aconteceu (não verificado) — é o trabalho da etapa de teste.
- No worktree não há `@playwright/mcp` em node_modules: os testes de browser falham por ambiente, não pela mudança.

## Tentado e descartado

- Buscar os registros dos releases neste repositório: não estão aqui; ficam no feed de ações do app.

## Perguntas abertas

- Nenhuma bloqueante.

## Onde o trabalho está

- Revisão aprovada (4_REVIEW.md), sem bloqueantes. Próxima etapa: teste — validar os critérios 2 e 3 da spec na interface (feed de ações: liberar checkout e repetir o passo; recusas de tag existente e [Unreleased] vazio com a orientação). <!-- handoff:110 -->
- Passagem developer → revisor-plataforma: validação de teste pedida. Feita: revisão confere o código e os testes automáticos; os cenários de ponta a ponta na interface é o que falta, entregues à etapa de teste. <!-- handoff:99 -->
- Passagem tl-plataforma → pessoa: implementação concluída e revisada; nada além do plano. Triagem proposta: priority:medium, marco hardening do próximo corte de release (aguarda aceite). <!-- handoff:42 -->
- Passagem support → product-owner: refino decidido — a correção virou o escopo aprovado em 1_SPEC.md e foi implementada. <!-- handoff:19 -→
- Passagem revisor-plataforma → qa-plataforma-2: Etapa de teste (plataforma): validar na interface os cenários que os testes automáticos cobrem só do lado do código — critério 2 (liberar o checkout e repetir o passo sem novo registro de pulado lido no feed) e critério 3 (corte de beta simulado em repositório de teste), mais os motivos de recusa "tag já existe" e "[Unreleased] vazio" mostrando a orientação no feed. <!-- handoff:111 -->
