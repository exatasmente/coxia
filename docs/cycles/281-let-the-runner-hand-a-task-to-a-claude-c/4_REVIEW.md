# Revisão da rodada 6: o teste da persona continua vermelho

## Veredito

Mudanças. Só leitura; nenhum comando foi rodado nesta etapa. Os números da QA anterior (1 falha em 9030) não foram reconfirmados aqui.

## Bloqueante anterior

- **Teste da persona com `executor: undefined` explícito: NÃO tratado.** `test/config-claude-code-persona.test.ts:58` ainda faz `{ ...lowered.devCycle.stages[0], executor: undefined }`. A validação de `saveConfig` recusa a chave presente com valor indefinido ("expected string, got undefined"), então o terceiro teste falha e o portão `vitest` fica vermelho. Critério 7 (persona pode baixar, não subir) fica sem demonstração. Correção de uma linha: remover a chave (desestruturar `executor` fora do objeto) em vez de atribuir `undefined`. O produto não precisa mudar.

## Critérios de aceite

Sem fato novo no diff desta rodada: o que foi aceito antes não é reaberto. Em aberto só o critério 7 pelo teste acima.

## Não verificado

- Nenhum portão rodado nesta etapa (tsc, vitest, theme-audit, i18n:lint, public-audit).
- Interface e comportamento real do SDK (deny respeitado, `canUseTool`, `structured_output`).

## Próximo

Corrigir o teste, rodar a suíte; depois renumerar v34→v35 com a #280 na integração.
