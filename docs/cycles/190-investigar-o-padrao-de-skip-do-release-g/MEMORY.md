# Memória do ciclo

## Decisões

- Resposta: **Esclarecimento** Os registros estão no próprio feed de ações do app (aba de ações do workspace, cada passo release-git com sua saída), não em arquivo externo. Li-os e extraí o padrão: <!-- answer:12 -->
  - **Issue 75 (0.6.1):** ~25 steps release-git skipped entre 05 e 06/10. Gatilho dominante: a branch release/0.6.1 estava com checkout em outro worktree (~/coxia/wt-061 e depois o worktree próprio da release) — "uma branch não pode ter checkout duas vezes". Ao voltar, o passo estável recusou com "tag v0.6.1 already exists".
  - **Issue 115 (0.7.0):** o mesmo gatilho de checkout duplo (release/0.7.0 em checkout em outra pasta), mais uma guarda de ordem — "envie main primeiro: a tag v0.7.0 ainda não está em origin/main" — e um skip sem efeito ("o remoto já tem v0.7.0-beta.9, nada mudou no host").
  - **Issue 151 (0.9.0):** um skip real de conteúdo — "CHANGELOG.md: [Unreleased] is empty … describe the changes first" bloqueou o corte da próxima beta; os outros dois foram pushes sem nada a enviar depois do passo anterior ter concluído.
- **Gatilho comum:** estado ambiente, não conteúdo da release — checkout duplo da branch de release em worktrees, tag já existente, CHANGELOG vazio.
- **Correção sugerida:** antes de cortar, liberar o checkout da branch da release nos demais worktrees e proteger o corte de beta com o [Unreleased] preenchido.
- Triagem: tipo é pedido de investigação/pergunta, não bug; o skip é comportamento previsto do app. Mecanismo lido no código: gate-skip/wait-skip com motivo obrigatório, registrado como 'gate-skipped'/'wait-skipped', estado 'skipped'. Nada falta para a investigação; resta o refino decidir escopo e prioridade da correção.

## Restrições

- Contagens e motivos vêm do relato de quem abriu ao ler o feed hoje; não foram reexaminados pelos agentes (não verificados de primeira mão).

## Tentado e descartado

- Buscar os registros dos releases neste repositório: não estão aqui; ficam no feed de ações do app.

## Perguntas abertas

- Escopo da correção sugerida (um ou mais issues) e prioridade: para o refino do produto.

## Onde o trabalho está

- Triagem concluída: 0_TRIAGE.md escrito e atualizado com o esclarecimento; aguarda refino do produto (priority e escopo) para seguir no ciclo.
