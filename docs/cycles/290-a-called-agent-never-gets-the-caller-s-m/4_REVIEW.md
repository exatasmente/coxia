# Revisão: entrega da mensagem ao chamado e fim da espera circular

Veredito: **mudanças**.

## O que foi verificado (rodado)

- `npm ci` e `npx tsc --noEmit`: **falha** com 1 erro em `test/runner-conversation.test.ts:249` (TS2352, a ferramenta devolve `ToolResult`, não `string`).
- `vitest` em `runner-conversation`, `runner-conversation-stall`, `runner-send-call`, `activity-calls`, `qa-conversation-commit`, `runner-conversation-screen`: 3 falhas, 42 passam. O arquivo novo `runner-conversation-stall.test.ts` passa (3 testes).
- `npm run i18n:lint`: passa (6416 chaves nos dois idiomas). `node scripts/public-audit.mjs`: passa.
- `node scripts/theme-audit.mjs`: imprime 17 ocorrências no total; não comparado com a base, o diff não toca o renderer. Não conclusivo.
- `vitest run` completo: **não rodado**. Só os arquivos acima.

## Bloqueantes

1. `test/runner-conversation.test.ts:249-254`: o teste do aviso imediato compara `asked` (um `ToolResult` com `response`) com uma string. Falha no vitest e no tsc. Usar `.response` e tipar o retorno.
2. `test/runner-conversation-screen.test.ts:83`: `call.abort` deixou de ser o `deps.abort`, porque `runConversation` cria um abort local. Regressão do contrato testado; ajustar o teste (o abort do turno é o local, ligado ao da execução) e conferir que a tela abre/fecha com o abort certo.
3. `test/activity-calls.test.ts` ("keeps one node for several rounds..."): quebra porque turno sem `AskConversation` agora encerra a conversa. O plano previa ajustar esse teste (dar mensagem pendente); não foi feito.
4. Testes que faltam (pedidos no plano e no recado): `callAgent` em `runner-send-call.test.ts` (retorno de falta de progresso, conversa nova na chamada seguinte após o fim) e a caracterização do relógio de ociosidade (critério 8). Critério 8 e a causa dos 70 min seguem não verificados.

## Pontos a conferir (não bloqueantes)

- Chave de `screenApi.stop(thread, agent)` contra o registro em `callStops` (thread da execução + id do chamado): não conferida; critério 5 só foi testado pelo `callStops` direto.
- O retorno de `stalled`/`stopped` do `callAgent` do chamado que escreve não tem teste.
- Repositório público: nada de nome ou segredo no diff. Regra de config: sem campo novo, sem migração, conforme plano. Escrita externa: nada novo fora da porta Actions.
