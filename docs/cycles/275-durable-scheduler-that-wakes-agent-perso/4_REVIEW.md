# Revisão: agenda durável que acorda a persona

## Veredito

Aprovado. Nenhum achado bloqueante.

## O que foi verificado

- Leitura do diff contra a spec, o plano e os desvios declarados em 3_IMPLEMENTATION.md: núcleo de recorrência, store, disparo, serviço, módulo IPC, `wakePersona`, tabela da porta, tela e pergunta de partida.
- Rodado nesta etapa: os testes `schedules-core`, `schedules-store`, `schedules-fire`, `persona-schedules` e `persona-door-table` (44 de 44 passaram), `npm run i18n:lint` (6215 chaves nos dois idiomas) e `node scripts/public-audit.mjs` (ok).
- Os demais gates (tsc, theme-audit, suíte completa) vêm do relato da implementação; não foram repetidos aqui.

## Contra os critérios da spec

- Persistência fora da config (`schedules.json`), escrita atômica, arquivo ilegível posto de lado: atendido, testado.
- Disparo sem sessão, porta `schedule`, resposta com `answersTo`, falha na conversa sem pausar, sem disparo duplo, perdidos viram um atrasado, pausa e retomada: cobertos por `schedules-fire.test.ts`.
- A persona gerencia pelas operações de Conversations; turno de agendamento não cria nem altera; só a pessoa liga o agendador (`schedules:setEnabled` fora da porta): coberto por `persona-schedules.test.ts`.
- Sem escrita nova no host de código; contagens da tabela da porta atualizadas.
- Repositório público e regras de i18n: sem achados.

## Sugestões (não bloqueiam)

1. `validateInput` aceita a conversa de uma run; o disparo depois falha a cada vez com erro de conversa. Recusar `kind === 'run'` na criação.
2. Critério 8 (ação sujeita a aprovação fica pendente) só tem o carimbo `door: 'schedule'` testado; um teste de integração com Actions fecharia isso.
3. Sem teste de renderer para a tela e a pergunta de partida, nem de virada de horário de verão.

## Não verificado

Tela Agendamentos e pergunta de partida em execução, `electron-vite build`, testes de navegador (falta `@playwright/mcp` na worktree), comportamento com o app fechado e reaberto.
