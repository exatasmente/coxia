# Implementação: fallback para o CLI do Claude Code já logado

Escopo: entrega 4 (1_SPEC.md, 2_PLAN.md). A configuração, a validação e `signedIn.ts` vieram da tentativa anterior; o resto foi feito nesta.

## O que mudou

### Configuração (tentativa anterior, conferida nesta)
- `src/shared/config/types.ts`: `LlmConfig.cliFallback?: { enabled, agents }` e regra do login reescrita no comentário de `PROVIDER_KINDS`; `CONFIG_SCHEMA_VERSION = 29`.
- `defaults.ts`, `schema.ts` (bloco `cliFallback`, descrição de `secretRef`), `migrations.ts` (`v28ToV29`).
- `validate.ts`: o aviso de provedor anthropic sem chave diz que usa o CLI logado (aviso, nunca erro); avisos para agente desconhecido na lista e para fallback ligado sem provedor sem chave.
- `src/shared/config/signedIn.ts`: `isSignedIn`, `signedInProvider`, `fallbackListed`.

### Main
- `src/main/cliFallback.ts` (novo):
  - `fallbackTarget` (puro): recusa quando o recurso está desligado ou ausente, o agente não está na lista, o workspace é `test: true`, não há provedor sem chave, a recusa veio do próprio fallback ou a rodada retoma uma sessão que não é do SDK. O modelo é o mesmo se o fallback o lista; senão, `models[0]`.
  - `resetMs`: valor menor que 1e12 é lido como segundos.
  - `withBudgetFallback`: só `ProviderBudgetError` aciona, e só uma vez. O alvo do retry vai com `loginOnly: true` e sem pool. Uma recusa do próprio fallback ou um `MaxTurnsError` passam adiante. Qualquer outra falha vira a recusa original, com o motivo anexado (`main.engine.cliFallback.failed`).
- `src/main/agents.ts`:
  - `runAgent` e `runOnce` embrulham o `withPool` com `withBudgetFallback`; a atividade mostra `main.engine.cliFallback.using`.
  - `runAgent` agora repassa `until` ao reembrulhar o erro.
  - Em `runClaudeSdk`:
    - `rate_limit_event` com `rejected` gera `ProviderBudgetError` com `until`.
    - `allowed`/`allowed_warning` limpam o limite.
    - `init.apiKeySource` decide se a chamada é de assinatura, para um provedor sem chave. Fora de `ANTHROPIC_API_KEY`, `apiKeyHelper` e `none`, conta como assinatura.
    - Com assinatura, os tokens levam `subscription: true` e o `total_cost_usd` não é relatado.
- `src/main/config-resolve.ts`: `ResolvedRole.loginOnly?`. `src/main/llm.ts` passa a opção a `sdkEnv`, e `llm-core.ts` não deixa `ANTHROPIC_API_KEY` passar com `loginOnly`.
- `engine/contract.ts` (`until`, `budgetResetText`), `runner/budget.ts` (`dueForProbe`), `executor.ts` e `service.ts` (`until` até o estado; o varredor não sonda antes): da tentativa anterior.

### Uso e exibição
- `shared/runs/usage.ts`: `UsageReport.subscription`. `addReport` e `mergeUsage` somam `subscriptionCalls` e nunca somam custo de uma chamada de assinatura.
- `shared/runs/types.ts`, `schema.ts`: `subscriptionCalls?`.
- `view.ts`: `usageParams().subscription`.
- `StageTimeline.tsx` e `RecordBody.tsx` acrescentam `ui.cycle.stage.usageSubscription`.

### Interface
- `ModelsStep.tsx`:
  - Rótulo `wizard.kind.anthropic.signedIn` e nota `wizard.models.signedInNote` para provedor sem chave.
  - Chave Anthropic opcional por caixa de seleção. Deixada vazia com a caixa marcada, continua sendo erro.
  - Bloco `CliFallbackFields`, que só aparece com um provedor sem chave. A lista de agentes só aparece com o recurso ligado.
- `ReviewStep.tsx`: mostra "(CLI do Claude Code já logado)" em vez de "sem chave".
- Textos novos ou revistos em `wizard`, `main` e `ui-cycle`, nos dois idiomas. `wizard.models.noSubscription` foi reescrito.

### Documentação
- `docs/configuration.md`: decisão 1 reescrita nos dois idiomas. O app não oferece login, mas usa o do CLI. A seção diz o que toca e o que não toca, e descreve o fallback. Versão do esquema 29.
- `CHANGELOG.md`: entrada em `Unreleased › Added`.

## Desvios do plano

- Para um provedor sem chave, `budgetText` (detecção pelo texto) continua valendo além do evento estruturado. A regra 1 da spec pede que, com o recurso desligado, ele funcione exatamente como hoje.
- A chave Anthropic ficou opcional no assistente. Sem isso, não havia como criar o modo pelo assistente.
- A marca `loginOnly` viaja no `ResolvedRole`, para chegar a `claudeSdkEnv` e a `runClaudeSdk` sem mudar assinaturas.
- `runner-lifecycle.test.ts` não foi estendido. A espera com `until` foi coberta por testes puros (`dueForProbe`, `budgetResetText`) e pelo teste de `runAgent` com o SDK simulado.

## Testes

- `test/cli-fallback.test.ts` (novo, puro):
  - `isSignedIn` e `signedInProvider`.
  - Validação: aviso informativo sem "no API key", avisos da lista.
  - `fallbackTarget`: todas as recusas.
  - `withBudgetFallback`: um único retry com `loginOnly`; espera para agente não listado, workspace de teste, `EngineBusyError` e `MaxTurnsError`; recusa do fallback sem terceira chamada; falha comum vira a recusa original com o motivo.
  - `resetMs` em segundos e em ms; `dueForProbe`; `budgetResetText`.
  - `sdkEnv` com e sem `loginOnly`.
  - Soma de assinatura.
  - A documentação sem a frase antiga.
  - Canais de configuração negados ao celular.
- `test/agent-cli-fallback.test.ts` (novo, `runAgent` real com o SDK e `isTestWorkspace` simulados):
  - Agente marcado: duas chamadas, a segunda sem `ANTHROPIC_API_KEY` e contada como assinatura sem custo.
  - Limite do CLI com `until` em segundos e em ms.
  - Falha comum do CLI: a recusa original fica.
  - Agente não marcado, recurso desligado ou workspace de teste: uma chamada só.
  - 401 não aciona o fallback.
  - Provedor sem chave direto: assinatura com login, custo de API com chave.
  - Aviso de limite não bloqueia; rejeição espera.
- `test/config-migrations.test.ts`: v28→v29 (tentativa anterior).
- Ajustados: `run-view.test.ts` (campo `subscription`) e `gitlab-catalogs-unchanged.test.ts` (`wizard.models.noSubscription` em `INTENDED`).

## Verificado nesta tentativa

- `npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` e `node scripts/public-audit.mjs`: passaram (ev-1).
- `npx vitest run test/cli-fallback.test.ts test/agent-cli-fallback.test.ts test/config-migrations.test.ts test/agent-budget.test.ts test/qa-57-sdk-cost.test.ts`: 117 testes passaram, numa versão do teste puro anterior ao acréscimo do teste da documentação.
- `npx vitest run` completo: 7 arquivos com falha (ev-2).
  - 4 de navegador (`browser-contract`, `browser-quit`, `browser-runtime`, `browser-sites`): falta `node_modules/@playwright/mcp` neste worktree (conferido: a pasta `@playwright` não existe). Sem relação com a mudança.
  - 3 tocados por esta mudança: `docs-schema-version`, `gitlab-catalogs-unchanged` e `run-view`.
- Depois da correção, `npx vitest run test/cli-fallback.test.ts test/docs-schema-version.test.ts test/gitlab-catalogs-unchanged.test.ts test/run-view.test.ts`: 55 testes passaram (ev-3). A suíte completa não foi rodada de novo.
- Nenhum teste lê `~/.claude`. A busca por `.claude` nos testes novos só acha os comentários do cabeçalho.

## Não verificado

- Execução com o CLI real logado: unidade de `resetsAt`, valores reais de `apiKeySource` e o retry de ponta a ponta.
- A tela do assistente no app: não foi aberta.
- A espera com horário no runner de ponta a ponta (`runner-lifecycle`).
- `electron-vite build`.
- Se o ciclo da #269 também ocupa o esquema 29.
- Conformidade com os termos da Anthropic.
