# Memória do ciclo

## Decisões

- Resposta de quem abriu: "pode separar". As cinco partes são entregues em ciclos menores; a issue é guarda-chuva. Este ciclo: só a entrega 4 (fallback por orçamento + nomear "CLI do Claude Code já logado"). Ordem das demais (sugerida): 1+2, 3, 5.
- Spec escrita (1_SPEC.md): 11 regras, 10 critérios. Regra do login reescrita: o app não oferece login, mas usa o login do CLI já feito; nunca toca nos arquivos de credencial.
- Proposta: priority:medium, sem marco (não há roadmap).
- Resposta: pode separar <!-- answer:12 -->

## Restrições

- Nunca ler `~/.claude/.credentials.json`, `sessions/*.key`, `daemon/control.key`; nada de `~/.claude` em testes.
- Eventos só para a janela desktop (nunca `broadcast`); canais negados ao celular em `webPolicy.ts`; `test: true` recusa envio, início e fallback.
- Reescrever a regra em `types.ts:22-23` e `docs/configuration.md` (98, 252) sem prometer login.
- Aviso a trocar: `validate.ts:58`. Orçamento hoje: `ProviderBudgetError` (`contract.ts:62`), detecção por texto em `agents.ts:942`, `executor.ts:1235`, `runner/budget.ts:29`.

## Tentado e descartado

- Nada.

## Perguntas abertas

- Onde marcar o fallback (papel, agente ou ambos); comportamento se o CLI não estiver instalado/logado (proposta: esperar e avisar).
- Afirmações sobre o SDK (`accountInfo`, `rate_limit_event`, `remoteControlAtStartup`, `claude --bg`) não verificadas.
- "Tabela de portas" com `EXCLUDED` da persona não achada em `src/` (importa às entregas 1-3, 5).
- Conformidade com termos da Anthropic não verificada.

## Onde o trabalho está

- Refinamento concluído (só leitura; nada executado). Próxima: Plano da entrega 4.
- Passagem support → product-owner: Especificar primeiro a entrega 4 (fallback por orçamento e nomeação do modo "CLI do Claude Code já logado"); as demais entregas viram ciclos próprios, na ordem sugerida 1+2, 3, 5. Fechar a redação da regra do login e confirmar a tabela de portas da persona. <!-- handoff:19 -->
