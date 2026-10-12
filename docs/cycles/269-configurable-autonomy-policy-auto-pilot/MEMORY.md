# Memória do ciclo

## Decisões

- Tipos de passo da política = motivos de retenção atuais: `submit|name|shortcut|dialog|unclassified|agent`. Sem tipos novos.
- Pagamento, envio a pessoas, segredos e cartão: sempre retidos. Não são chaves da política; `sensitiveCategory` (`src/main/browser/sensitive.ts`) roda ANTES da política. Chave dessas num arquivo é descartada com aviso.
- Precedência por tipo: agente > squad > workspace > padrão retido. Campo `screenPolicy` (agente, squad, `runner.screenPolicy`). Nome na UI: "aprovações dos passos na tela".
- Política resolvida por chamada (`CallScreen.policy`). Mudança gravada em `saveConfig` (`screen-policy`); passo autônomo em `screen-autonomous`, com `policyLevel`.
- `HoldGate.autonomous` opcional. `policyChanges` virou `screenPolicyChanges`.
- Esquema: migração `v32ToV33`, `CONFIG_SCHEMA_VERSION = 33`.
- Release-alvo: release/0.11.0 (decisão do Neto). PR #276 já com essa base (ev-12).
- Respostas da pessoa: usar os motivos de retenção atuais, sem tipos novos; as quatro categorias seguem detectadas por palavras no nome do controle; autorizado fazer pelo shell; base já atualizada no GitHub.
- Resposta: Usar os motivos que o app já retém, como estão: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Não entram tipos novos; "novos tipos de passo" fica fora do escopo. Pagamento, envio a pessoas, segredos e cartão continuam sempre retidos e a política não pode liberá-los. Como não são tipos separados, seguem detectados como hoje, por palavras no nome do controle. <!-- answer:12 -->
- Resposta: Autorizo você a fazer pelo shell <!-- answer:205 -->
- Resposta: Atualiza no github <!-- answer:290 -->
- Resposta (dada pela persona, pela pessoa): Decisão do Neto: a release-alvo é release/0.11.0. O PR da #269 (hoje #276, apontando para release/0.9.1) deve ter a base em release/0.11.0. Se você não consegue redirecionar pelo host, diga isso e o que falta, sem contornar. As 2 falhas de @playwright/mcp na suíte seguem sem verificação na base; registre como não verificado. <!-- answer:311 -->
- Resposta: já atualizei <!-- answer:319 -->

## Restrições

- Padrão: tudo retido. `screen_handoff` inalterado. Textos via `t()` nos dois catálogos; CHANGELOG Unreleased.
- Comentários do renderer sem `#NNN` de 3–4 dígitos (theme-audit).
- Não vai à produção sem a #268.
- Repositório público; identificadores em inglês.
- Sem commit/rebase pelo shell; o commit é do app.

## Tentado e descartado

- Lista nova de tipos de passo; as quatro categorias como chaves da política.
- Migração 28→29 (colidia com a release).
- Testes de resolução ficam em `test/screen-step-approvals.test.ts`.

## Perguntas abertas

- Mescla com a #268: unificar `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change` e `saveConfig(next, by)`; mover o registro de `workspaceConfig.ts` para módulo neutro.
- Limites da heurística: Enter em campo neutro com botão "Pagar"; `autocomplete` de cartão não é lido.
- Não verificado: tela e janela de aprovação no app; 4 testes de navegador real (falta `@playwright/mcp`) e se falham na base; `agent-assist-prompts` esgota o tempo na suíte completa (passa sozinho); CI nos commits de documentos não enviados.

## Onde o trabalho está

Revisão, rodada 3: aprovada, sem bloqueantes; nenhum código mudou desde a rodada 2 (só a conferência da base). Duas sugestões mantidas (Enter em campo neutro; registro fora de `workspaceConfig.ts`). Próximo: integração/PR. Conferência visual segue pendente; não liberar sem a #268.
- Passagem revisor-plataforma → integrator: rodada 3 aprovada; seguir para PR; não liberar sem a #268.
- Passagem support → product-owner: Planejar: mapear as camadas de configuração (agente, squad, workspace), a tela de configurações, a detecção por palavras das quatro categorias sempre retidas e a ligação com #268. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Planejar a partir de 1_SPEC.md. Ler a tela de configurações (Settings.tsx, TeamSettings.tsx), onde moram agente/squad/workspace (AgentDef, SquadDef, bloco de autonomia do workspace/fluxo em src/shared/config/types.ts), o classificador src/main/browser/classify.ts (lista de palavras mistura pagamento e envio com salvar/apagar: prever detecção das quatro categorias antes da política), asks.ts/intermediary.ts, screenPrompt.ts e o registro de #268 para reaproveitar. Cuidar do choque de nome com a \"autonomia\" existente. <!-- handoff:30 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md na ordem dada: (1) tipos e resolução puros em shared/config/screenPolicy.ts com testes; (2) config v29 (types, defaults, schema, migração, validate, transfer, configScope); (3) detecção sensitive.ts e envoltório em classify; (4) decisão no intermediary + gate.autonomous + auditoria; (5) instantâneo por chamada em callScreen, frase de prompt e chaves de catálogo; (6) registro de mudança em saveConfig; (7) ScreenPolicyFields.tsx no agente, squad e workspace, aviso na janela de aprovação (com a Experiência); (8) CHANGELOG e docs. Conferir na implementação: chaves de prompt… <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: Revisar o diff contra 2_PLAN.md e 3_IMPLEMENTATION.md. Pontos de atenção: - ordem da decisão no intermediário; - `confirmPortFor`; - `screenPolicyRaised`; - `heldOnly` nos modelos; - registro em `saveConfig`. Rodar `electron-vite build`, que não foi rodado. Na QA, ver a grade nas configurações (agente, squad e workspace) e o aviso na janela de aprovação. Na mescla com a #268, unificar `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change` e o `saveConfig(next, by)` dela. Não liberar para produção sem a #268. <!-- handoff:154 -->
- Passagem revisor-plataforma → qa-plataforma-2: QA: ver a grade nas configurações (agente, squad e workspace) e o aviso na janela de aprovação. Rodar os testes. Na mescla com a #268, unificar os registros de auditoria e o `saveConfig(next, by)`. Não liberar para produção sem a #268. <!-- handoff:162 -->
- Passagem qa-plataforma-2 → integrator: Atenção na mescla com a #268: unificar os registros `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change` e o `saveConfig(next, by)`. Tela e janela de aprovação ainda sem conferência visual. <!-- handoff:180 -->
- Passagem integrator → developer: Devolver ao implement: a branch está 160 commits atrás de origin/release/0.11.0, e a mescla de teste (git merge-tree) dá 13 arquivos em conflito. O passo de migração v28→v29 desta branch colide com os passos 29→30, 30→31 e 31→32 que a release já tem (ela está na versão 32 do esquema; a branch, na 29). O passo desta branch precisa ser renumerado para v32→v33 e a CONFIG_SCHEMA_VERSION virar 33, depois que a base for trazida pela ferramenta de conflito do app. tsc e a suíte completa rodaram nesta etapa (7833 passam; 4 arquivos de navegador real falham por falta de @playwright/mcp). Os outros gate… <!-- handoff:197 -->
- Passagem developer → revisor-plataforma: Integração de novo: a mescla com origin/release/0.11.0 está na worktree, com os conflitos resolvidos e marcados. O commit do app a fecha (MERGE_HEAD presente). Conferir de novo a base contra a release (que pode ter andado) e o esquema 33 (`v32ToV33`). Gates rodados após a mescla: tsc, theme-audit, i18n:lint, public-audit e build saíram com 0. Na suíte, falham os 4 de navegador real (falta `@playwright/mcp`) e, por tempo esgotado na rodada completa, agent-assist-prompts, que passa sozinho. A unificação com a #268 continua pendente; não liberar para produção sem a #268. <!-- handoff:250 -->
- Passagem revisor-plataforma → qa-plataforma-2: Integrator: base da release já trazida, esquema 33 conferido por leitura. Conferir a base contra a release de novo; base do PR = release/0.11.0; não liberar sem a #268. <!-- handoff:258 -->
- Passagem qa-plataforma-2 → integrator: Integração: base trazida e esquema 33 conferidos; testes da política e lints rodados de novo e verdes. Base do PR = release/0.11.0. Unificar com a #268 e não liberar sem ela. Tela e janela de aprovação sem conferência visual. <!-- handoff:272 -->
- Passagem pessoa → developer: ajusta a base Contexto para o pedido acima, não trabalho novo: o que a revisão e a QA deixaram em aberto. O que o QA não aprovou ou não conseguiu verificar: - 13 Conferência visual no app (não rodou): O app não foi subido; sem comprovação visual. <!-- handoff:329 -->
- Passagem developer → revisor-plataforma: Base conferida: branch 0 atrás de origin/release/0.11.0 e PR #276 já com base release/0.11.0, sem conflitos, CI verde (ev-12). Nenhum código mudou. Próximas etapas: seguir para a integração/PR; a conferência visual da grade e da janela de aprovação segue não feita; não liberar sem a #268. <!-- handoff:343 -->
