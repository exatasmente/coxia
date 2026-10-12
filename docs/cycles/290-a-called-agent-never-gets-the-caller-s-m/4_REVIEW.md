# Revisão: quarta rodada, o bloqueante foi tratado e os gates passam

Veredito: **aprovado**.

## Bloqueante anterior

1. `test/activity-calls.test.ts` ("keeps one node for several rounds…"): tratado. O turno seguinte passa `mode: 'conversation'` no resume e o nó do chamado volta a ter `['started','finished']`. Rodado: o arquivo passa (10 testes).

## O que foi verificado (rodado)

- `npm ci`; `npx tsc --noEmit`: passa.
- `npx vitest run` completo: 571 arquivos e 9155 testes passam (1 arquivo e 4 testes ignorados).
- Arquivos da área (runner-send-call, runner-conversation, runner-conversation-stall, runner-conversation-screen, activity-calls, qa-conversation-commit): 46 testes passam.
- `npm run i18n:lint`: 6416 chaves nos dois idiomas. `node scripts/public-audit.mjs`: limpo.
- `node scripts/theme-audit.mjs`: 17 ocorrências, em arquivos do renderer que o diff não altera; não comparado com a base.
- Repositório público e regras: sem nome, host ou segredo; sem campo novo de config (não exige migração); nenhuma escrita nova fora da porta Actions (lido no diff).

## Não bloqueantes (sugestões, não reabertas)

- Teste de caracterização do relógio de ociosidade (critério 8): não escrito; a causa dos 70 minutos segue hipótese. O limite sem progresso (metade da ociosidade) encerra a conversa antes.
- Teste de `stalled`/`stopped` via `CallAgent` (mensagem devolvida ao chamador): não escrito; as mensagens existem nos catálogos e a conversa em si é testada.
- Chave de `screenApi.stop(thread, agent)` contra o registro em `callStops`: não conferida.
- Duplicadas no tracker: não pesquisadas.
