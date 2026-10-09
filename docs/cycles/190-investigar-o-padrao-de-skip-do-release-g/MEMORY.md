# Memória do ciclo

## Decisões

- Resposta: **Esclarecimento** Os registros estão no próprio feed de ações do app (aba de ações do workspace, cada passo release-git com sua saída), não em arquivo externo. Li-os e extraí o padrão: <!-- answer:12 -->
  - **Issue 75 (0.6.1):** ~25 steps release-git skipped entre 05 e 06/10. Gatilho dominante: a branch release/0.6.1 estava com checkout em outro worktree — "uma branch não pode ter checkout duas vezes". Ao voltar, o passo estável recusou com "tag v0.6.1 already exists".
  - **Issue 115 (0.7.0):** o mesmo gatilho de checkout duplo, mais a guarda de ordem "envie main primeiro: a tag v0.7.0 ainda não está em origin/main" e um skip sem efeito.
  - **Issue 151 (0.9.0):** um skip real de conteúdo — "CHANGELOG.md: [Unreleased] is empty" — bloqueando o corte da próxima beta; os outros dois foram pushes sem nada a enviar.
- **Gatilho comum:** estado ambiente, não conteúdo da release — checkout duplo da branch de release em worktrees, tag já existente, CHANGELOG vazio.
- **Refino (1_SPEC.md escrito):** escopo = app detecta o conflito de checkout da branch de release em outro worktree antes de rodar o passo, para cedo com mensagem que nomeia branch e worktree, e oferece soltar o checkout com confirmação da pessoa (regra 3). Recusas "tag já existe" e "[Unreleased] vazio" ficam como portões, com mensagem orientando o próximo passo. Fora do escopo: escrever changelog, tocar worktree sem sim, mudar ordem dos passos ou portões existentes. proposição conferida no código: scripts/release.sh (recusas nas linhas 138-139, 249, 316) e src/shared/release.ts (operações, RELEASE_WAIT_OPS, releaseStepNeeds/releaseBlockers).
- Triagem: tipo é pedido de investigação, não bug; mecanismo gate-skip/wait-skip com motivo obrigatório lido em src/shared/runs.

## Restrições

- Contagens e motivos vêm do relato de quem abriu ao ler o feed hoje; não reexaminados de primeira mão pelos agentes (não verificados).

## Tentado e descartado

- Buscar os registros dos releases neste repositório: não estão aqui; ficam no feed de ações do app.

## Perguntas abertas

- Nenhuma bloqueante para a especificação; a implementação lidará com casos de worktree impares (caminho inexistente) parando e pedindo.

## Onde o trabalho está

- Triagem e refino concluídos (0_TRIAGE.md, 1_SPEC.md). Próxima etapa: implementação pela plataforma detectando o conflito em pré-check do passo release-git e melhorando as mensagens do feed; critérios de aceite em 1_SPEC.md. Prioridade proposta: priority:medium; marco proposto: hardening do próximo corte de release (aguarda aceite). <!-- handoff:plataforma -->
- Passagem support → product-owner: Refino do produto: os dados da investigação já estão colhidos e o gatilho comum está identificado (checkout duplo da branch de release em worktrees, tag já existente, CHANGELOG [Unreleased] vazio). Decidir se a correção sugerida — liberar o checkout da branch de release nos demais worktrees antes do corte e proteger o corte de beta com o [Unreleased] preenchido — vira trabalho concreto (escopo em um ou mais issues), e definir prioridade. <!-- handoff:19 -->
