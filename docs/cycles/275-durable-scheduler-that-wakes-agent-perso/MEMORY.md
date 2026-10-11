# Memória do ciclo

## Decisões

- Persona e usuário gerenciam os schedules. Ao iniciar, o app pergunta se deve executar o scheduler (resposta da pessoa, #12).
- Tipo: pedido de funcionalidade, priority:medium proposta, sem marco.
- Implementado (3_IMPLEMENTATION.md):
  - store `schedules.json` em ATAS, fora da config, sem schema;
  - job `schedules` via `ctx.job` (everyMin 1, enabled = agendador ligado na sessão);
  - disparo = linha de sistema `schedule.fired`/`firedLate` com o prompt, depois `wakePersona(..., 'schedule')` (mentions/module.ts), que usa a mesma fila, linhas e trava;
  - operações da persona em `Conversations` (`schedules`, `scheduleCreate/Update/Remove`); `schedules:setEnabled` excluído da porta (motivo `scheduler`);
  - um turno com porta `schedule` não cria nem altera agendamentos;
  - pergunta de partida via `asked` em `schedules:list`, resposta só na sessão.
- Padrões adotados (a confirmar com a pessoa, não bloqueante): disparo perdido roda uma vez ao ligar, marcado como atrasado; resultado na conversa de origem (na tela, escolhida pela pessoa).
- Resposta: A persona e o usuário podem gerenciar os schedules, quando o app iniciar pergunta se deve executar o scheduler <!-- answer:12 -->

## Restrições

- Não há código de #268/#269 na árvore. A porta só vai para a auditoria (`door` no act), então um disparo usa as mesmas ferramentas, Actions e auditoria de qualquer resposta.
- Contagens fixadas em test/persona-door-table.test.ts: 309 canais, 194 operações, 115 exclusões.
- Catálogos `ui-*.json` precisam de chaves em ordem alfabética. `#NNN` em comentário do renderer conta como cor literal no theme-audit.
- Testes com fakes; textos nos dois idiomas; repositório público.

## Tentado e descartado

- CronCreate/ScheduleWakeup da sessão: morrem com a sessão.
- Guardar na config: descartado (migração e risco de colisão com o schema 29).
- Quatro ferramentas novas da persona: descartado para manter as 11 ferramentas e o limite de tamanho das descrições.

## Perguntas abertas

- Não verificado: tela Agendamentos e pergunta de partida no app rodando; `electron-vite build`; critério 8 (pendência em Actions) sem teste específico; virada de horário de verão.
- Testes de navegador (browser-contract/runtime/quit/sites) falham nesta worktree por falta de `@playwright/mcp` em node_modules; sem relação com a mudança.

## Onde o trabalho está

- Triagem, spec, plano e implementação prontos.
- Gates rodados: tsc, theme-audit, i18n:lint e public-audit ok. vitest: 8773 passaram, só os de navegador falharam (ambiente). Evidência ev-1 = testes novos e tocados, 167 de 167.
- Próxima: revisão, depois QA da interface com dados vazios.
- Passagem support → product-owner: Refinamento: definir priority/milestone; especificar persistência dos agendamentos, gerenciamento por persona (ferramenta) e usuário (tela), confirmação de execução do agendador na partida, tratamento de disparo perdido e conversa do resultado. Verificar reaproveitamento de sessão e colisão do schema 29. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Tech lead plataforma: desenhar a solução reaproveitando o agendador existente (src/main/scheduler.ts) e a porta de agendamento do turno da persona; verificar (1) se um turno de persona abre sem sessão viva e se o motor do Claude reaproveita sessão, (2) onde persistir as definições e se isso muda o schema de configuração (colisão com o schema 29 do #274), (3) interação com as políticas #268/#269. Confirmar com a pessoa o padrão de disparo perdido e conversa do resultado. <!-- handoff:29 -->
- Passagem tl-plataforma → pessoa: Developer: executar 2_PLAN.md. Começar pelo item 0 (confirmar chamadores de answerMentions, ferramentas da persona, IPC, política #268/#269, tipos de door), depois core, store, fire, service, ferramentas, IPC/tela, docs. <!-- handoff:43 -->
