# Memória do ciclo

## Decisões

- Tipos de passo da política = motivos de retenção atuais: `submit|name|shortcut|dialog|unclassified|agent`. Sem tipos novos.
- Pagamento, envio a pessoas, segredos e cartão: sempre retidos. Não são chaves da política; `sensitiveCategory` (`src/main/browser/sensitive.ts`) roda ANTES da política, para qualquer tipo. Uma chave dessas num arquivo é descartada com aviso.
- Precedência por tipo: agente > squad > workspace > padrão retido. Campo `screenPolicy` (agente, squad, `runner.screenPolicy`), schema v29. Nome na UI: "aprovações dos passos na tela".
- A política é resolvida por chamada (`CallScreen.policy`) e vale na próxima etapa. Mudança gravada em `saveConfig` (`screen-policy`); passo autônomo gravado em `screen-autonomous`, com `policyLevel`.
- `HoldGate.autonomous` é opcional. `policyChanges` foi renomeado para `screenPolicyChanges` (evita colisão com o da #268).
- Revisão: aprovada, sem bloqueantes. `electron-vite build` passou.
- QA: 13 arquivos de teste da mudança (522 testes) passam; tsc, theme-audit, i18n:lint e public-audit saem 0; suíte completa 7833 passam, 4 arquivos de navegador real falham (falta `@playwright/mcp`).
- Resposta da pessoa: usar os motivos de retenção que o app já tem; sem tipos novos; as quatro categorias sempre retidas, detectadas por palavras no nome do controle.
- Resposta: Usar os motivos que o app já retém, como estão: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Não entram tipos novos; "novos tipos de passo" fica fora do escopo. Pagamento, envio a pessoas, segredos e cartão continuam sempre retidos e a política não pode liberá-los. Como não são tipos separados, seguem detectados como hoje, por palavras no nome do controle. <!-- answer:12 -->

## Restrições

- Padrão: tudo retido. `screen_handoff` inalterado. Textos via `t()` nos dois catálogos; CHANGELOG Unreleased.
- Comentários do renderer não podem ter `#NNN` de 3–4 dígitos: o theme-audit lê como cor literal.
- Não vai à produção sem a #268 (condição de lançamento, não imposta em código).
- Repositório público; identificadores em inglês.

## Tentado e descartado

- Lista nova de tipos de passo; as quatro categorias como chaves da política.
- Os testes ficam em `test/screen-step-approvals.test.ts` (`test/screen-policy.test.ts` já existia com outro assunto).

## Perguntas abertas

- Mescla com a #268: unificar `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change` e `saveConfig(next, by)`; considerar mover o registro de `workspaceConfig.ts` para um módulo neutro (hoje importa `./browser/audit`).
- Limites da heurística: Enter em campo neutro com botão "Pagar" no formulário; `autocomplete` de cartão não é lido.
- Não verificado: a grade das configurações (agente, squad, workspace) e o aviso na janela de aprovação vistos no app (só testes de renderização); os 4 testes de navegador real.

## Onde o trabalho está

Implementação revisada (aprovada) e QA feita por testes e gates, sem conferência visual. Próximo: mescla com a #268 e, se desejado, conferência visual da tela.
- Passagem support → product-owner: Planejar: mapear as camadas de configuração (agente, squad, workspace), a tela de configurações, a detecção por palavras das quatro categorias sempre retidas e a ligação com #268. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Planejar a partir de 1_SPEC.md. Ler a tela de configurações (Settings.tsx, TeamSettings.tsx), onde moram agente/squad/workspace (AgentDef, SquadDef, bloco de autonomia do workspace/fluxo em src/shared/config/types.ts), o classificador src/main/browser/classify.ts (lista de palavras mistura pagamento e envio com salvar/apagar: prever detecção das quatro categorias antes da política), asks.ts/intermediary.ts, screenPrompt.ts e o registro de #268 para reaproveitar. Cuidar do choque de nome com a \"autonomia\" existente. <!-- handoff:30 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md na ordem dada: (1) tipos e resolução puros em shared/config/screenPolicy.ts com testes; (2) config v29 (types, defaults, schema, migração, validate, transfer, configScope); (3) detecção sensitive.ts e envoltório em classify; (4) decisão no intermediary + gate.autonomous + auditoria; (5) instantâneo por chamada em callScreen, frase de prompt e chaves de catálogo; (6) registro de mudança em saveConfig; (7) ScreenPolicyFields.tsx no agente, squad e workspace, aviso na janela de aprovação (com a Experiência); (8) CHANGELOG e docs. Conferir na implementação: chaves de prompt… <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: Revisar o diff contra 2_PLAN.md e 3_IMPLEMENTATION.md. Pontos de atenção: - ordem da decisão no intermediário; - `confirmPortFor`; - `screenPolicyRaised`; - `heldOnly` nos modelos; - registro em `saveConfig`. Rodar `electron-vite build`, que não foi rodado. Na QA, ver a grade nas configurações (agente, squad e workspace) e o aviso na janela de aprovação. Na mescla com a #268, unificar `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change` e o `saveConfig(next, by)` dela. Não liberar para produção sem a #268. <!-- handoff:154 -->
- Passagem revisor-plataforma → qa-plataforma-2: QA: ver a grade nas configurações (agente, squad e workspace) e o aviso na janela de aprovação. Rodar os testes. Na mescla com a #268, unificar os registros de auditoria e o `saveConfig(next, by)`. Não liberar para produção sem a #268. <!-- handoff:162 -->
