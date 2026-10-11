# Memória do ciclo

## Decisões

- Resposta de quem abriu: "pode separar". As cinco partes são entregues em ciclos menores; a issue é guarda-chuva. Este ciclo: só a entrega 4 (fallback por orçamento + nomear "CLI do Claude Code já logado"). Ordem das demais (sugerida): 1+2, 3, 5.
- Spec (1_SPEC.md): 11 regras, 10 critérios. O app não oferece login, mas usa o login do CLI já feito; nunca toca nos arquivos de credencial.
- Proposta: priority:medium, sem marco (não há roadmap).
- Plano (2_PLAN.md): marca do fallback = `llm.cliFallback { enabled:false, agents:[] }` (ids de agente; agentes de sistema têm id = papel); migração v28→v29; provedor fallback = primeiro anthropic/claude-sdk sem chave; retry único em novo `withBudgetFallback` (`src/main/cliFallback.ts`) em volta do `withPool` em `runAgent` e `runOnce`; só `ProviderBudgetError`; recusa com `test:true` no main; limite pelo `rate_limit_event` do SDK (`ProviderBudgetError.until`); uso de assinatura (`subscription`) sem custo de API; fallback usa `sdkEnv loginOnly` (sem ANTHROPIC_API_KEY); sem checagem prévia de login e sem `accountInfo()` (traz e-mail).
- Resposta: pode separar <!-- answer:12 -->

## Restrições

- Nunca ler `~/.claude/.credentials.json`, `sessions/*.key`, `daemon/control.key`; nada de `~/.claude` em testes.
- Eventos só para a janela desktop (nunca `broadcast`); `test: true` recusa envio, início e fallback; nenhum canal novo para o celular, configuração já em CONFIG_ADMIN (conferir no teste).
- Reescrever a regra em `types.ts:22-23` e `docs/configuration.md` (98, 252); aviso em `validate.ts:58` vira informativo.
- Portões: tsc, vitest, theme-audit, i18n:lint, public-audit.

## Tentado e descartado

- Marcar em `AgentDef` + `llm.roles` (dois lugares, duas migrações).
- Checar login antes do fallback (exigiria credenciais ou accountInfo).

## Perguntas abertas

- Não verificado: unidade de `resetsAt` (s ou ms), valores reais de `apiKeySource` com login de assinatura, conformidade com termos da Anthropic. O tipo `rate_limit_event` existe no sdk.d.ts (5627).
- "Tabela de portas"/`EXCLUDED` da persona não existe em `src/`; afeta só as entregas 1-3 e 5.
- Possível colisão do número de esquema (29) com o ciclo da política de aprovações na tela (#269).
- Nomes de alguns arquivos de teste do plano não conferidos.

## Onde o trabalho está

- Plano concluído (só leitura; nada executado). Próxima: implementação do 2_PLAN.md.
- Passagem support → product-owner: Especificar primeiro a entrega 4 (fallback por orçamento e nomeação do modo "CLI do Claude Code já logado"); as demais entregas viram ciclos próprios, na ordem sugerida 1+2, 3, 5. Fechar a redação da regra do login e confirmar a tabela de portas da persona. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Planejar a entrega 4: onde marcar o fallback (papel/agente), ponto do retry único após ProviderBudgetError, leitura do evento estruturado de limite do SDK (verificar que existe), contabilidade como assinatura, reescrita do aviso em validate.ts, da regra em types.ts e de docs/configuration.md, recusa com test:true e negação ao celular. Confirmar existência da tabela de portas da persona. <!-- handoff:28 -->
