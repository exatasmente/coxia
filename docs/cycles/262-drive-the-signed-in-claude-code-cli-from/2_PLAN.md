# Plano: fallback para o CLI do Claude Code já logado

Escopo: só a entrega 4 da issue guarda-chuva (spec 1_SPEC.md, regras 1–11, critérios 1–10). Entregas 1+2, 3 e 5 ficam fora. Tudo abaixo foi lido no código; nada foi executado nesta etapa (sem testes, sem `tsc`).

## Verificado nesta etapa (leitura)

- `ProviderBudgetError` nasce em `runClaudeSdk` (`src/main/agents.ts:942`, texto via `budgetText`) e no motor `open`; `runAgent` (`agents.ts:1627`) e `runOnce` passam o erro adiante; `executor.ts:1235` vira `StageError('budget')`; `runner/budget.ts:29` marca o estado `out`. `withPool` (`modelPick.ts:85`) deixa o erro de orçamento passar de propósito.
- O SDK instalado tem `SDKRateLimitEvent` (`type: 'rate_limit_event'`, `rate_limit_info.status: 'allowed'|'allowed_warning'|'rejected'`, `resetsAt?: number`, `rateLimitType?: 'five_hour'|'seven_day'|…`) e `ApiKeySource` na mensagem `init`. `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5627-5649`, `:131`. **Não verificado:** a unidade de `resetsAt` (segundos ou ms) e os valores reais de `apiKeySource` num login de assinatura. O plano trata os dois de forma defensiva e testa com dublê.
- `AccountInfo` (`sdk.d.ts:23`) traz `email`; **não será chamado**: o app não precisa dele e não deve guardar nem exibir dados da conta.
- A "tabela de portas" com `EXCLUDED` da persona **não existe em `src/`** (busca na triagem e na spec). Esta entrega não cria canal nem ferramenta de persona, então o critério da issue sobre a persona fica coberto só por: nenhum canal novo de escrita além da configuração, e a configuração já negada ao celular. Dito aqui para não parecer coberto.
- Versão atual do esquema: 28 (`migrations.ts` STEPS 1..27). Esta entrega é a 29.

## Decisões

1. **Onde marcar: uma lista de ids de agentes em `llm.cliFallback`** (`{ enabled: false, agents: [] }`). Os agentes de sistema têm o id igual ao papel (`turn`, `reply`, `deep`, `teams`, `fix`), então a mesma lista cobre papéis das cerimônias e agentes de uma execução. Motivo: um campo só, uma migração, sem tocar `AgentDef`. Alternativa descartada: campo em `AgentDef` + campo em `llm.roles` (dois lugares, duas migrações, dois editores).
2. **Qual provedor é o fallback:** o primeiro provedor `kind: 'anthropic'`, `engine: 'claude-sdk'`, `secretRef` nulo e sem `legacyCustomEndpoint` (`signedInProvider(cfg)`, função pura). Se não houver, o fallback não existe e a espera é a de hoje (regra 5). Não há checagem prévia de instalação/login: o CLI falhar ao autenticar vira o erro original de orçamento (espera) com uma nota do motivo. Motivo: verificar login exigiria olhar credenciais ou `accountInfo()` (traz e-mail).
3. **Ponto do retry único: `withBudgetFallback`** (novo `src/main/cliFallback.ts`), usado por `runAgent` e `runOnce`, em volta do `withPool` existente. Só `ProviderBudgetError` aciona; só uma vez; não aciona se o provedor que recusou já é o fallback, se o agente não está marcado, se `enabled` é falso, ou se o workspace é `test: true`. `EngineBusyError`, `MaxTurnsError` e erros comuns passam como hoje (regra 4). `askBare` e `probeProviderBudget` ficam sem fallback (o probe mede o orçamento do provedor real).
4. **Modelo no fallback:** o mesmo id se o provedor do fallback o lista, senão `models[0]` dele (mesmo padrão de `probeProviderBudget`). Sem pool no fallback (`withoutPool`).
5. **Sessão retomada:** uma rodada que retoma sessão (`call.resume`) mantém a sessão no fallback, pois o CLI usa a mesma pasta de sessões. Se o retry falhar, vale o erro de orçamento original. Risco anotado abaixo.
6. **Limite do fallback pelo evento estruturado:** em `runClaudeSdk`, tratar `m.type === 'rate_limit_event'`; com `status === 'rejected'` guarda `{ type, resetsAt }` e, ao fim da chamada sem resultado, lança `ProviderBudgetError` com `until` (campo novo opcional, epoch ms, `resetsAt` normalizado: valor < 1e12 é segundos). O texto não é mais lido para o fallback. `budgetText` continua só para o provedor de chave (comportamento de hoje).
7. **Espera até a renovação:** `runner/budget.ts` já marca `out`; passa a guardar `until` e o executor mostra "volta às HH:MM" em vez do detalhe cru. O varredor de orçamento (probe) não sonda o fallback antes de `until`.
8. **Assinatura, não custo de API:** relato de uso ganha `subscription?: boolean`. Chamada pelo fallback: `sdkEnv` recebe `loginOnly` e descarta `ANTHROPIC_API_KEY` (só o login do CLI pode autenticar; garante que é assinatura por construção). Em `runClaudeSdk`, para qualquer alvo anthropic sem chave, `subscription` é decidido pelo `apiKeySource` do `init` (login, não `ANTHROPIC_API_KEY`/`apiKeyHelper`); com assinatura o `total_cost_usd` **não é somado** (tokens contam, custo não). `shared/runs/usage.ts` soma `subscription` separado (`subscriptionCalls`), `view.ts` mostra "assinatura" no lugar do custo.
9. **Segurança:** nenhum `readFile` em `~/.claude`; o app só inicia o CLI com `HOME` real (como já faz). Canais novos: nenhum para o celular; a edição de `llm.cliFallback` passa pelos canais de configuração já em `CONFIG_ADMIN` (conferir no teste). A recusa com `test: true` fica no main (`withBudgetFallback`), não só na UI.

## Mudanças, na ordem

1. **Configuração (três arquivos + migração):**
   - `src/shared/config/types.ts`: `LlmConfig.cliFallback?: { enabled: boolean; agents: string[] }`; reescrever o comentário de `PROVIDER_KINDS` (linhas 22-23): o app não oferece login, mas um provedor `anthropic` sem chave usa o login que o CLI da máquina já tem.
   - `src/shared/config/defaults.ts`: `cliFallback: { enabled: false, agents: [] }` no `llm` padrão.
   - `src/shared/config/schema.ts`: o objeto no esquema JSON (descrição sem prometer login); atualizar a descrição de `secretRef` (linha 74).
   - `src/shared/config/migrations.ts`: `v28ToV29` (acrescenta `llm.cliFallback` desligado se ausente, `schemaVersion: 29`), entrada `28` em `STEPS`, e subir `CONFIG_SCHEMA_VERSION`.
   - `src/shared/config/validate.ts:58`: o aviso passa a "uses the signed-in Claude Code CLI of this machine" (informativo, ainda `warnings`, nunca erro); validar que `agents` só tem ids existentes (aviso) e que `enabled` sem provedor sem-chave avisa que o fallback ficará inativo.
   - `signedInProvider` e `isSignedIn(provider)` em `src/shared/config/` (puro, usado por validação, assistente e main).
2. **Fallback (main):**
   - `src/main/cliFallback.ts`: `fallbackTarget(agentId)`, `withBudgetFallback(id, resolved, attempt)`; recusa com `test: true` (lê o flag do workspace atual).
   - `src/main/agents.ts`: `runAgent` e `runOnce` embrulham o `withPool`; `runClaudeSdk` trata `rate_limit_event`, `init.apiKeySource` e a regra de custo.
   - `src/main/engine/contract.ts`: `ProviderBudgetError` ganha `until?: number | null` (opcional, sem quebrar quem constrói).
   - `src/main/llm-core.ts` / `llm.ts`: opção `loginOnly` no `sdkEnv`.
   - `src/main/runner/budget.ts` e `executor.ts`: `until` até o estado e a mensagem.
3. **Uso e exibição:** `src/shared/runs/types.ts`, `usage.ts`, `schema.ts`, `view.ts` (`subscription`), catálogos i18n (`pt-BR` e `en`) para "assinatura" e "volta às {time}".
4. **Assistente e tela de modelos:** `src/renderer/src/wizard/steps/ModelsStep.tsx` (rótulo "CLI do Claude Code já logado" para provedor anthropic sem chave; seletor de agentes do fallback, escondido com o recurso desligado) e `ReviewStep.tsx:56-57` (o `(chave faltando)` não aparece para esse modo). Cores só por tokens de tema; textos por `t()`.
5. **Documentação:** `docs/configuration.md` linhas 98 e 252 reescritas (o app não oferece login, usa o do CLI; toca o CLI instalado e o login dele, nunca os arquivos de credencial); `CHANGELOG.md` em `Unreleased`; `AGENTS.md` não muda.

## Testes (um por comportamento)

- `test/agent-budget.test.ts` (estender, SDK dublê): marcado + recusa de orçamento → segunda chamada no provedor sem chave, uma só (crit. 3); não marcado → `ProviderBudgetError` como hoje (crit. 4); recusa do próprio fallback não gera terceira chamada; `EngineBusyError` não aciona (regra 4).
- `test/agent-cli-fallback-limit.test.ts` (novo): `rate_limit_event` `rejected` com `resetsAt` → erro com `until` correto (segundos e ms) e sem ler texto (crit. 5); `allowed_warning` não bloqueia.
- `test/cli-fallback.test.ts` (novo, puro): `signedInProvider`, escolha do modelo, recusa com `test: true` (crit. 7), recurso desligado nunca aciona (crit. 1).
- Teste existente do `sdkEnv` (ou novo `test/llm-core.test.ts`): `loginOnly` remove `ANTHROPIC_API_KEY`; sem `loginOnly` o comportamento atual fica igual.
- Teste de uso (`test/runs-usage.test.ts`): chamada de assinatura soma tokens e zero de custo, e aparece separada (crit. 6).
- `test/config-migrations.test.ts`: v28→v29 acrescenta o bloco desligado, é idempotente; teste de validação: aviso informativo sem "chave faltando", nunca erro (crit. 2).
- `test/web-policy.test.ts`: os canais de configuração do fallback são negados ao celular (crit. 8).
- `test/runner-lifecycle.test.ts`: recusa por orçamento num papel marcado conclui a etapa; num não marcado espera; `until` aparece na mensagem de espera.
- `npm run i18n:lint`; busca de teste de que `docs/configuration.md` não contém mais a frase antiga (crit. 9) e de que nenhum teste referencia `.claude` (crit. 10).

(Nomes dos arquivos de teste existentes além de `agent-budget.test.ts` e `runner-lifecycle.test.ts` não foram conferidos; o developer confirma ou cria.)

## Riscos

- **Unidade de `resetsAt` e valores de `apiKeySource` não verificados.** Normalização defensiva e dublês com os dois formatos; uma execução manual com CLI real fica como verificação pendente para a pessoa.
- **Retomar sessão no fallback** pode falhar se a sessão for de outro HOME ou provedor: o erro vira o de orçamento original (espera), sem perda.
- **Custo contado errado** se `apiKeySource` vier diferente: o fallback força `loginOnly`, então a contagem do fallback não depende desse campo; só o caso "keyless comum" depende.
- **Termos da Anthropic para uso de assinatura por apps de terceiros: não verificado**; o recurso fica desligado por padrão e a documentação evita prometer conformidade.
- **Persona/celular:** sem tabela `EXCLUDED` no código; coberto só pelo que está dito acima.
- **Colisão de versão do esquema com outro ciclo em andamento** (plano da política de aprovações na tela, que também acrescenta um campo de configuração, `runner.screenPolicy`; lido só o início do plano, não se sabe se ele cria migração). Quem mesclar depois renumera o passo (`v28ToV29` vira o próximo número livre) e os testes de migração; as duas mudanças tocam blocos diferentes (`llm` e `runner`).
- **Repositório público:** fixtures sem caminho ou dado de `~/.claude`, sem e-mail de conta.

## Critérios de aceite sem cobertura total

- Persona sem acesso (issue): sem tabela de portas para testar; fora desta entrega.
- Confirmação real no CLI logado (crit. 3, 5, 6): só por dublê; verificação ao vivo fica para a pessoa.

## Portões antes de concluir

`npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` (nenhum rodado nesta etapa).
