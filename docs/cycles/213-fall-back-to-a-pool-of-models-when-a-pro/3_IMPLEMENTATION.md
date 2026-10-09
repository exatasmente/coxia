# Implementação: conjunto de modelos por papel

Registro do que foi feito por commit, dos desvios do plano (`2_PLAN.md`) e dos testes acrescentados. Os commits 1 a 4 do plano estão aqui; os seguintes são acrescentados quando feitos.

## Commit 1: `fix: count a retry-after as an attempt in the open client`

- **Feito.** `src/main/engine/open/client.ts`: a espera do `Retry-After` passa a incrementar o contador de tentativas (`transient`), como a espera por recuo exponencial. Antes o contador só subia sem o cabeçalho.
- **Desvios.** Nenhum.
- **Testes.** `test/engine-open-client.test.ts`: 429 com `Retry-After: 0` repetido faz exatamente `maxRetries + 1` chamadas e termina em `rate_limit`; 503 com `Retry-After` seguido de sucesso continua repetindo. CHANGELOG › Fixed.
