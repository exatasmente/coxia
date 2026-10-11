# Memória do ciclo

## Decisões

- Resposta de quem abriu: "pode separar". As cinco partes são entregues em ciclos menores; a issue é guarda-chuva. Este ciclo: só a entrega 4 (fallback por orçamento + nomear "CLI do Claude Code já logado"). Ordem das demais (sugerida): 1+2, 3, 5.
- Spec (1_SPEC.md): 11 regras, 10 critérios. O app não oferece login, mas usa o login do CLI já feito; nunca toca nos arquivos de credencial.
- Proposta: priority:medium, sem marco (não há roadmap).
- Plano (2_PLAN.md): `llm.cliFallback { enabled:false, agents:[] }` (ids de agente; agente de sistema tem id = papel); migração v28→v29; provedor fallback = primeiro anthropic/claude-sdk sem chave; retry único em `withBudgetFallback` (`src/main/cliFallback.ts`) em volta do `withPool` em `runAgent` e `runOnce`; só `ProviderBudgetError`; recusa com `test:true` no main; limite pelo `rate_limit_event` (`ProviderBudgetError.until`); assinatura sem custo de API; fallback sem ANTHROPIC_API_KEY; sem checagem prévia de login e sem `accountInfo()`.
- Implementação (desvios do plano): `budgetText` continua valendo para o provedor sem chave (regra 1: desligado = como hoje); a chave Anthropic ficou opcional no assistente (sem isso não se cria o modo); a marca `loginOnly` viaja em `ResolvedRole`; uma falha comum no retry vira a recusa original com o motivo; a recusa do próprio fallback e `MaxTurnsError` passam adiante; assinatura = `apiKeySource` fora de ANTHROPIC_API_KEY/apiKeyHelper/none.
- Resposta: pode separar <!-- answer:12 -->

## Restrições

- Nunca ler `~/.claude/.credentials.json`, `sessions/*.key`, `daemon/control.key`; nada de `~/.claude` em testes.
- Eventos só para a janela desktop (nunca `broadcast`); `test: true` recusa o fallback; configuração só pelos canais em CONFIG_ADMIN (negados ao celular, testado).
- Portões: tsc, vitest, theme-audit, i18n:lint, public-audit (+ electron-vite build no CI).

## Tentado e descartado

- Marcar em `AgentDef` + `llm.roles` (dois lugares, duas migrações).
- Checar login antes do fallback (exigiria credenciais ou accountInfo).

## Perguntas abertas

- Não verificado: unidade de `resetsAt` (tratada: < 1e12 = segundos), valores reais de `apiKeySource` com login de assinatura, retry com o CLI real, conformidade com os termos da Anthropic.
- Possível colisão do esquema 29 com o ciclo da #269 (não conferido).
- `node_modules/@playwright/mcp` falta neste worktree: 4 testes de navegador falham por isso (ambiente, não código).
- "Tabela de portas"/`EXCLUDED` da persona não existe em `src/`; afeta só as entregas 1-3 e 5.

## Onde o trabalho está

- Implementação concluída (3_IMPLEMENTATION.md).
- Portões que passaram: tsc, theme-audit, i18n:lint, public-audit (ev-1).
- `vitest` completo: 7 arquivos com falha (ev-2). 4 de navegador, por falta de `@playwright/mcp`. 3 testes antigos (`docs-schema-version`, `gitlab-catalogs-unchanged`, `run-view`), já corrigidos e passando isolados (ev-3). A suíte completa não foi rodada de novo.
- Não rodados: tela no app, `electron-vite build`, runner-lifecycle de ponta a ponta.
- Testes novos: `test/cli-fallback.test.ts`, `test/agent-cli-fallback.test.ts`.
- Próxima: revisão/QA. Rodar a suíte completa com `@playwright/mcp` instalado, conferir a tela do assistente e o esquema 29 contra a #269.
- Passagem support → product-owner: Especificar primeiro a entrega 4 (fallback por orçamento e nomeação do modo "CLI do Claude Code já logado"); as demais entregas viram ciclos próprios, na ordem sugerida 1+2, 3, 5. Fechar a redação da regra do login e confirmar a tabela de portas da persona. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Planejar a entrega 4: onde marcar o fallback (papel/agente), ponto do retry único após ProviderBudgetError, leitura do evento estruturado de limite do SDK (verificar que existe), contabilidade como assinatura, reescrita do aviso em validate.ts, da regra em types.ts e de docs/configuration.md, recusa com test:true e negação ao celular. Confirmar existência da tabela de portas da persona. <!-- handoff:28 -->
- Passagem tl-plataforma → pessoa: Implementar 2_PLAN.md na ordem: configuração (types/defaults/schema/migração v28→v29, validate.ts:58), cliFallback.ts + withBudgetFallback em runAgent/runOnce, rate_limit_event e uso de assinatura, interface do assistente, docs/configuration.md e CHANGELOG. Verificar com dublê a unidade de resetsAt e o apiKeySource; conferir se a migração do ciclo da política de tela já ocupou a versão 29. Rodar os cinco portões. <!-- handoff:43 -->
