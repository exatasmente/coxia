# Implementação: conjunto de modelos por papel

Registro do que foi feito por commit, dos desvios do plano (`2_PLAN.md`) e dos testes acrescentados. Os commits 1 a 4 do plano estão aqui; os seguintes são acrescentados quando feitos.

## Commit 1: `fix: count a retry-after as an attempt in the open client`

- **Feito.** `src/main/engine/open/client.ts`: a espera do `Retry-After` passa a incrementar o contador de tentativas (`transient`), como a espera por recuo exponencial. Antes o contador só subia sem o cabeçalho.
- **Desvios.** Nenhum.
- **Testes.** `test/engine-open-client.test.ts`: 429 com `Retry-After: 0` repetido faz exatamente `maxRetries + 1` chamadas e termina em `rate_limit`; 503 com `Retry-After` seguido de sucesso continua repetindo. CHANGELOG › Fixed.

## Commit 2: `feat: add model pools to the config`

- **Feito.** Esquema 24 → 25. `types.ts`: `ACTIVITIES`, `Activity`, `SCORED_ACTIVITIES`, `ModelRef`, `ModelPool`, `ScoreOverrides`, `MAX_POOL_ENTRIES` (8); `RoleModel` e `AgentModel` ganham `fallbacks`/`activities` (e as três marcas por entrada); `LlmConfig.scoreOverrides`. `schema.ts` (`modelRef`, listas de até 8, notas de 0 a 100), `validate.ts` (`poolRules`: provedor existente, sem repetir provedor+modelo na lista, aviso de entrada `screen` com `images: false`, aviso de pool em agente com papel), `migrations.ts` (`v24ToV25` só sobe a versão), `config-resolve.ts` (`ResolvedRole.pool`, `images`/`contextWindow`/`echoReasoning` por entrada, cada entrada passa por `target()`), `docs/configuration.md` (esquema 25 nas quatro menções; a linha de `llm.roles`, `llm.scoreOverrides` e o modelo do agente).
- **Desvios do plano.**
  - `defaults.ts` não mudou: o neutro não traz nenhum dos campos (ausente = sem reservas), e `mergeDeep` já os preserva. O teste de deriva `config-schema` ganhou uma isenção explícita para os caminhos de pool/`scoreOverrides` (opcionais, ausentes de todo default), com um teste próprio que prende o contrário.
  - `repair` (migrations) não repunha só o campo: um erro em `llm.roles.x.fallbacks[0].provider` subia até o papel inteiro e o repunha para o neutro. Agora um campo de pool inválido é descartado sozinho (uma entrada de lista, ou o campo), nunca o papel ou o modelo do agente ao redor (`dropPoolField`).
  - Fora da lista do plano, para que um pool salvo não se perca por uma edição que não o conhece: `newAgent` mantém o pool do modelo próprio (`modelPoolOf`); `fieldsOf` do editor de agente o preserva; `ModelsStep` (`setRole`, `remove`) e `applySettings` mantêm o pool do papel, tiram as marcas do modelo antigo quando o modelo muda e `remove` tira do pool as entradas do provedor removido (pequeno `src/shared/config/pool.ts`). A interface de edição do pool em si continua nos commits 8 e 9.
  - Modelo de ciclo: `applyTemplate` e `templateFromConfig` tiram o pool do modelo do agente e `parseTemplate` avisa (`template.team[<id>].model`); o plano pedia só "conferir e travar com teste".
  - A rule `config-schema.md` (fora do repositório) segue dizendo 23; o código estava em 24. A tabela de `docs/configuration.md` vai para 25.
- **Testes.** `config-schema` (neutro sem os campos; aceita; recusa tipo errado, campo desconhecido, lista longa, nota fora da faixa; provedor inexistente e repetição; aviso de `screen` sem imagem; agente próprio e agente com papel), `config-migrations` (v24→25 só sobe a versão e mantém o resto; mantém pool existente; descarta só a entrada inválida; 26 recusado), `config-resolve` (pool resolvido, papel emprestado, provedor inexistente lança, `applySettings`), `cycle-templates` (modelo não leva pool), `team-agent-edit` (editor preserva), `config-pool` (funções puras).
