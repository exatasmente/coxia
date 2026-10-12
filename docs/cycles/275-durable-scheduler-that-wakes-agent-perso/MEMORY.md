# Memória do ciclo

## Decisões

- Persona e usuário gerenciam os schedules. Ao iniciar, o app pergunta se deve executar o scheduler (resposta da pessoa, #12).
- Tipo: pedido de funcionalidade, priority:medium proposta, sem marco.
- Implementado (3_IMPLEMENTATION.md):
  - store `schedules.json` em ATAS, fora da config, sem schema;
  - job `schedules` via `ctx.job` (everyMin 1, enabled = agendador ligado na sessão);
  - disparo = linha de sistema `schedule.fired`/`firedLate` com o prompt, depois `wakePersona(..., 'schedule')`;
  - operações da persona em `Conversations`; `schedules:setEnabled` excluído da porta;
  - um turno com porta `schedule` não cria nem altera agendamentos;
  - pergunta de partida via `asked` em `schedules:list`.
- Padrões adotados (a confirmar com a pessoa, não bloqueante): disparo perdido roda uma vez ao ligar, marcado como atrasado; resultado na conversa de origem.
- Revisão (4_REVIEW.md): aprovado, sem bloqueantes. Sugestões: recusar conversa de run na criação; teste de integração do critério 8; testes de renderer e de horário de verão.
- QA: 44 testes passaram e build saiu 0; interface não exercitada.
- Integração (7_INTEGRATION.md): pronto para o PR. Base 0 atrás de release/0.11.0; CONFIG_SCHEMA_VERSION 32 igual à release, sem passo novo; CHANGELOG em Unreleased/Added; gates saíram 0. PR #277 já existe com base release/0.11.0.
- Comunicação: 6_RELEASE_NOTE.md e comentário escritos a partir dos documentos, sem executar nada; limites e não verificados ditos na nota.
- Resposta: A persona e o usuário podem gerenciar os schedules, quando o app iniciar pergunta se deve executar o scheduler <!-- answer:12 -->

## Restrições

- Não há código de #268/#269 na árvore; a porta só vai para a auditoria.
- Contagens fixadas em test/persona-door-table.test.ts: 309 canais, 194 operações, 115 exclusões.
- Catálogos `ui-*.json` em ordem alfabética. `#NNN` em comentário do renderer conta como cor literal no theme-audit.
- Testes com fakes; textos nos dois idiomas; repositório público.
- Um `out/` velho faz public-audit falhar; apagar depois do build.

## Tentado e descartado

- CronCreate/ScheduleWakeup da sessão: morrem com a sessão.
- Guardar na config: descartado.
- Quatro ferramentas novas da persona: descartado (11 ferramentas).

## Perguntas abertas

- Não verificado: tela Agendamentos e pergunta de partida no app rodando (nem reabertura); critério 8 sem teste de integração; horário de verão; recusa de conversa de run; outros PRs abertos para a release.
- Testes de navegador falham na worktree por falta de `@playwright/mcp`; sem relação.

## Onde o trabalho está

- Triagem, spec, plano, implementação, revisão, QA (parcial, sem UI), integração e comunicação prontos.
- Próxima: revisão humana do PR #277; a UI segue para verificação manual antes de mesclar.
- Passagem support → product-owner: Refinamento: definir priority/milestone; especificar persistência dos agendamentos, gerenciamento por persona (ferramenta) e usuário (tela), confirmação de execução do agendador na partida, tratamento de disparo perdido e conversa do resultado. Verificar reaproveitamento de sessão e colisão do schema 29. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Tech lead plataforma: desenhar a solução reaproveitando o agendador existente (src/main/scheduler.ts) e a porta de agendamento do turno da persona; verificar (1) se um turno de persona abre sem sessão viva e se o motor do Claude reaproveita sessão, (2) onde persistir as definições e se isso muda o schema de configuração (colisão com o schema 29 do #274), (3) interação com as políticas #268/#269. Confirmar com a pessoa o padrão de disparo perdido e conversa do resultado. <!-- handoff:29 -->
- Passagem tl-plataforma → pessoa: Developer: executar 2_PLAN.md. Começar pelo item 0 (confirmar chamadores de answerMentions, ferramentas da persona, IPC, política #268/#269, tipos de door), depois core, store, fire, service, ferramentas, IPC/tela, docs. <!-- handoff:43 -->
- Passagem developer → revisor-plataforma: Revisão: conferir o diff contra 2_PLAN.md e os desvios listados em 3_IMPLEMENTATION.md (operações em Conversations; persona acordada não cria nem altera; pergunta de partida via `asked` em `schedules:list`). Para a QA: abrir o app com dados vazios (CERIMONIAS_DATA_DIR) e exercitar a tela Agendamentos e a pergunta de partida, que não foram verificadas aqui. Rodar também `electron-vite build`. Os testes de navegador falham nesta worktree por falta de `@playwright/mcp` em node_modules, sem relação com a mudança. <!-- handoff:72 -->
- Passagem revisor-plataforma → qa-plataforma-2: QA: abrir o app com dados vazios (CERIMONIAS_DATA_DIR), criar um agendamento na tela Agendamentos, exercitar a pergunta de partida (sim/não), pausar, remover e reabrir o app. Rodar também electron-vite build. <!-- handoff:81 -->
- Passagem qa-plataforma-2 → integrator: Integração: nenhum bloqueante. Pendente fora desta QA: verificação manual da tela Agendamentos e da pergunta de partida; teste de integração do critério 8. <!-- handoff:95 -->
- Passagem integrator → pessoa: Pull request: #277 já aberto com base release/0.11.0; nenhum bloqueante. Antes de mesclar, verificação manual da tela Agendamentos e da pergunta de partida. <!-- handoff:117 -->
