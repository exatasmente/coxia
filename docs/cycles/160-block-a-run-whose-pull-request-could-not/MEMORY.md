# Memória do ciclo

## Decisões

- Triagem: bug, não duplicada, acionável como escrito; relacionada a #133 (mesma família).
- Prioridade sugerida (só sugestão): high — falha silenciosa, espera sem saída, >150 linhas idênticas por thread, recuperação manual.
- Nada falta que só quem abriu possa dizer; a etapa não pausa.

## Restrições

- Toda string de usuário por t(), catálogos EN+PT; testes com fakes de test/helpers/, sem rede nem host real.
- Commit em inglês, fix:, sem número de issue (app acrescenta).
- As definições de "waiting" e "blocked" do core de corridas devem ser respeitadas pela implementação.

## Tentado e descartado

- Nenhuma tentativa de correção ainda.

## Perguntas abertas

- Nenhuma para quem abriu. A implementação escolherá como o retry do pull request decide o ramo base (a aceinação aceita escolher na tela ou reler o release aberto) — decisão de implementação, não do repórter.

## Onde o trabalho está

- Triagem completa: 0_TRIAGE.md escrito. Reivindicações da issue confirmadas por leitura de publish.ts (pullRequest, runner.pr.failed), service.ts (flush), transitions.ts (wait-started) e do caminho de review.waiting em publish.ts. Nada executado. Próxima etapa: implementação por worker.
