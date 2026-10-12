# Teste da persona: baixar o executor sem chave indefinida

## Estado

Uma correção de uma linha, pedida pela QA e pela revisão. **Nenhum comando foi rodado nesta tentativa** (não há comando permitido): `npx tsc --noEmit`, `npx vitest run` e as auditorias são **não verificados**.

## O que mudou

- `test/config-claude-code-persona.test.ts` (terceiro teste): o rebaixamento do executor para o agente padrão agora remove a chave `executor` da etapa por desestruturação, em vez de atribuir `executor: undefined`. A validação de `saveConfig` recusa chave presente com valor indefinido ("expected string, got undefined"); por IPC real a chave seria descartada na serialização, então o teste passa a refletir isso. O produto não mudou.

## Não feito (aceito)

Link da transcrição na timeline e canal `runs:claudeTranscript`; `PendingCommand.tool`; `flow-check` para executor sem agente; teste de componente do `StagePanel`.

## Verificação

Não rodados, portanto não verificados: `npx vitest run test/config-claude-code-persona.test.ts` (esperado: os três testes passam), suíte completa, `npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`. Na QA anterior, tudo exceto esse teste passou (1 falha em 9030).

Risco: o `_dropped` não usado pode acionar regra de lint/tsc de variável não usada; conferir ao rodar o tsc.
