# Memória do ciclo

## Decisões

- Tipos de passo da política = motivos de retenção atuais: `submit|name|shortcut|dialog|unclassified|agent`. Sem tipos novos.
- Pagamento, envio a pessoas, segredos e cartão: sempre retidos. Não são chaves da política; `sensitiveCategory` (`src/main/browser/sensitive.ts`) roda ANTES da política, para qualquer tipo. Chave dessas num arquivo é descartada com aviso.
- Precedência por tipo: agente > squad > workspace > padrão retido. Campo `screenPolicy` (agente, squad, `runner.screenPolicy`). Nome na UI: "aprovações dos passos na tela".
- A política é resolvida por chamada (`CallScreen.policy`). Mudança gravada em `saveConfig` (`screen-policy`); passo autônomo em `screen-autonomous`, com `policyLevel`.
- `HoldGate.autonomous` é opcional. `policyChanges` foi renomeado para `screenPolicyChanges`.
- Esquema: depois da mescla com release/0.11.0, migração `v32ToV33`, `CONFIG_SCHEMA_VERSION = 33`.
- Resposta da pessoa: usar os motivos que o app já retém; "novos tipos de passo" fora do escopo; as quatro categorias seguem detectadas por palavras no nome do controle. A mescla da base pelo shell foi autorizada (`git merge --no-commit`).
- Resposta: Usar os motivos que o app já retém, como estão: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Não entram tipos novos; "novos tipos de passo" fica fora do escopo. Pagamento, envio a pessoas, segredos e cartão continuam sempre retidos e a política não pode liberá-los. Como não são tipos separados, seguem detectados como hoje, por palavras no nome do controle. <!-- answer:12 -->
- Resposta: Autorizo você a fazer pelo shell <!-- answer:205 -->

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
- Não verificado: tela e janela de aprovação no app; os 4 testes de navegador real; `agent-assist-prompts` esgota o tempo na suíte completa (passa sozinho).

## Onde o trabalho está

Revisão rodada 2: aprovado, sem bloqueantes (rodada 1 também). Conferido por leitura: esquema 33, `v32ToV33` em `STEPS`, sem marcadores de conflito reais. Gates não rodados de novo na revisão; valem os da implementação (tsc, lints, build com 0; suíte com falhas só de ambiente). Mescla com a release segue aberta até o commit do app. Próximo: integração; base do PR = release/0.11.0.
- Passagem support → product-owner: Planejar: mapear as camadas de configuração (agente, squad, workspace), a tela de configurações, a detecção por palavras das quatro categorias sempre retidas e a ligação com #268. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Planejar a partir de 1_SPEC.md. Ler a tela de configurações (Settings.tsx, TeamSettings.tsx), onde moram agente/squad/workspace (AgentDef, SquadDef, bloco de autonomia do workspace/fluxo em src/shared/config/types.ts), o classificador src/main/browser/classify.ts (lista de palavras mistura pagamento e envio com salvar/apagar: prever detecção das quatro categorias antes da política), asks.ts/intermediary.ts, screenPrompt.ts e o registro de #268 para reaproveitar. Cuidar do choque de nome com a \"autonomia\" existente. <!-- handoff:30 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md na ordem dada: (1) tipos e resolução puros em shared/config/screenPolicy.ts com testes; (2) config v29 (types, defaults, schema, migração, validate, transfer, configScope); (3) detecção sensitive.ts e envoltório em classify; (4) decisão no intermediary + gate.autonomous + auditoria; (5) instantâneo por chamada em callScreen, frase de prompt e chaves de catálogo; (6) registro de mudança em saveConfig; (7) ScreenPolicyFields.tsx no agente, squad e workspace, aviso na janela de aprovação (com a Experiência); (8) CHANGELOG e docs. Conferir na implementação: chaves de prompt… <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: Revisar o diff contra 2_PLAN.md e 3_IMPLEMENTATION.md. Pontos de atenção: - ordem da decisão no intermediário; - `confirmPortFor`; - `screenPolicyRaised`; - `heldOnly` nos modelos; - registro em `saveConfig`. Rodar `electron-vite build`, que não foi rodado. Na QA, ver a grade nas configurações (agente, squad e workspace) e o aviso na janela de aprovação. Na mescla com a #268, unificar `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change` e o `saveConfig(next, by)` dela. Não liberar para produção sem a #268. <!-- handoff:154 -->
- Passagem revisor-plataforma → qa-plataforma-2: QA: ver a grade nas configurações (agente, squad e workspace) e o aviso na janela de aprovação. Rodar os testes. Na mescla com a #268, unificar os registros de auditoria e o `saveConfig(next, by)`. Não liberar para produção sem a #268. <!-- handoff:162 -->
- Passagem qa-plataforma-2 → integrator: Atenção na mescla com a #268: unificar os registros `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change` e o `saveConfig(next, by)`. Tela e janela de aprovação ainda sem conferência visual. <!-- handoff:180 -->
- Passagem integrator → developer: Devolver ao implement: a branch está 160 commits atrás de origin/release/0.11.0, e a mescla de teste (git merge-tree) dá 13 arquivos em conflito. O passo de migração v28→v29 desta branch colide com os passos 29→30, 30→31 e 31→32 que a release já tem (ela está na versão 32 do esquema; a branch, na 29). O passo desta branch precisa ser renumerado para v32→v33 e a CONFIG_SCHEMA_VERSION virar 33, depois que a base for trazida pela ferramenta de conflito do app. tsc e a suíte completa rodaram nesta etapa (7833 passam; 4 arquivos de navegador real falham por falta de @playwright/mcp). Os outros gate… <!-- handoff:197 -->
- Passagem developer → revisor-plataforma: Integração de novo: a mescla com origin/release/0.11.0 está na worktree, com os conflitos resolvidos e marcados. O commit do app a fecha (MERGE_HEAD presente). Conferir de novo a base contra a release (que pode ter andado) e o esquema 33 (`v32ToV33`). Gates rodados após a mescla: tsc, theme-audit, i18n:lint, public-audit e build saíram com 0. Na suíte, falham os 4 de navegador real (falta `@playwright/mcp`) e, por tempo esgotado na rodada completa, agent-assist-prompts, que passa sozinho. A unificação com a #268 continua pendente; não liberar para produção sem a #268. <!-- handoff:250 -->
