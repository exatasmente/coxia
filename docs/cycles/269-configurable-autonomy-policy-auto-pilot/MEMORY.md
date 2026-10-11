# Memória do ciclo

## Decisões

- Tipos de passo da política = motivos de retenção atuais: `submit|name|shortcut|dialog|unclassified|agent`. Sem tipos novos.
- Pagamento, envio a pessoas, segredos e cartão: sempre retidos. Não são chaves da política; `sensitiveCategory` (`src/main/browser/sensitive.ts`) roda ANTES da política, para qualquer tipo. Chave dessas num arquivo é descartada com aviso.
- Precedência por tipo: agente > squad > workspace > padrão retido. Campo `screenPolicy` (agente, squad, `runner.screenPolicy`). Nome na UI: "aprovações dos passos na tela".
- A política é resolvida por chamada (`CallScreen.policy`). Mudança gravada em `saveConfig` (`screen-policy`); passo autônomo em `screen-autonomous`, com `policyLevel`.
- `HoldGate.autonomous` é opcional. `policyChanges` foi renomeado para `screenPolicyChanges`.
- Esquema: depois da mescla com release/0.11.0, migração `v32ToV33`, `CONFIG_SCHEMA_VERSION = 33`.
- Resposta: Usar os motivos que o app já retém, como estão: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Não entram tipos novos; "novos tipos de passo" fica fora do escopo. Pagamento, envio a pessoas, segredos e cartão continuam sempre retidos e a política não pode liberá-los. Como não são tipos separados, seguem detectados como hoje, por palavras no nome do controle. <!-- answer:12 -->
- Resposta: Autorizo você a fazer pelo shell <!-- answer:205 --> (a mescla da base pelo shell foi autorizada pela pessoa e feita com `git merge --no-commit`).

## Restrições

- Padrão: tudo retido. `screen_handoff` inalterado. Textos via `t()` nos dois catálogos; CHANGELOG Unreleased.
- Comentários do renderer não podem ter `#NNN` de 3–4 dígitos (theme-audit lê como cor).
- Não vai à produção sem a #268 (condição de lançamento).
- Repositório público; identificadores em inglês.
- Sem commit nem rebase pelo shell; o commit é do app.

## Tentado e descartado

- Lista nova de tipos de passo; as quatro categorias como chaves da política.
- Migração 28→29 (colidia com a release; virou 32→33).
- Testes de resolução ficam em `test/screen-step-approvals.test.ts`.

## Perguntas abertas

- Mescla com a #268: unificar `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change` e `saveConfig(next, by)`; mover o registro de `workspaceConfig.ts` para módulo neutro. A #268 não está na release trazida.
- Limites da heurística: Enter em campo neutro com botão "Pagar"; `autocomplete` de cartão não é lido.
- Não verificado: tela e janela de aprovação no app; os 4 testes de navegador real; `agent-assist-prompts` esgota o tempo na suíte completa (passa sozinho); PRs abertos para a release.

## Onde o trabalho está

Implementação, tentativa 3: origin/release/0.11.0 (160 commits) foi mesclada na worktree, 13 conflitos resolvidos e marcados com `git add`, e a mescla segue aberta (MERGE_HEAD) até o commit do app. Após a mescla: tsc, theme-audit, i18n:lint, public-audit e electron-vite build saíram com 0. Na suíte, 8807 testes passam e 3 falham: os 4 arquivos de navegador real (falta `@playwright/mcp`) mais o timeout de agent-assist-prompts (ev-5). Próximo: integração de novo; base do PR = release/0.11.0.
- Passagem developer → revisor-plataforma: Revisar o diff contra 2_PLAN.md e 3_IMPLEMENTATION.md. Pontos de atenção: ordem da decisão no intermediário, `confirmPortFor`, `screenPolicyRaised`, `heldOnly`, registro em `saveConfig`. <!-- handoff:154 -->
- Passagem qa-plataforma-2 → integrator: Atenção na mescla com a #268: unificar os registros e o `saveConfig(next, by)`. Tela e janela de aprovação ainda sem conferência visual. <!-- handoff:180 -->
- Passagem integrator → developer: Base 160 commits atrás de release/0.11.0, 13 conflitos; renumerar migração para v32→v33 e esquema 33; rodar gates e build. Feito nesta tentativa. <!-- handoff:197 -->
- Passagem product-owner → pessoa: Planejar a partir de 1_SPEC.md. Ler a tela de configurações (Settings.tsx, TeamSettings.tsx), onde moram agente/squad/workspace (AgentDef, SquadDef, bloco de autonomia do workspace/fluxo em src/shared/config/types.ts), o classificador src/main/browser/classify.ts (lista de palavras mistura pagamento e envio com salvar/apagar: prever detecção das quatro categorias antes da política), asks.ts/intermediary.ts, screenPrompt.ts e o registro de #268 para reaproveitar. Cuidar do choque de nome com a \"autonomia\" existente. <!-- handoff:30 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md na ordem dada: (1) tipos e resolução puros em shared/config/screenPolicy.ts com testes; (2) config v29 (types, defaults, schema, migração, validate, transfer, configScope); (3) detecção sensitive.ts e envoltório em classify; (4) decisão no intermediary + gate.autonomous + auditoria; (5) instantâneo por chamada em callScreen, frase de prompt e chaves de catálogo; (6) registro de mudança em saveConfig; (7) ScreenPolicyFields.tsx no agente, squad e workspace, aviso na janela de aprovação (com a Experiência); (8) CHANGELOG e docs. Conferir na implementação: chaves de prompt… <!-- handoff:49 -->
- Passagem revisor-plataforma → qa-plataforma-2: QA: ver a grade nas configurações (agente, squad e workspace) e o aviso na janela de aprovação. Rodar os testes. Na mescla com a #268, unificar os registros de auditoria e o `saveConfig(next, by)`. Não liberar para produção sem a #268. <!-- handoff:162 -->
