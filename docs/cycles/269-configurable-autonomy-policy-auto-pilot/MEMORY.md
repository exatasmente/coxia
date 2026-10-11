# Memória do ciclo

## Decisões

- Tipos de passo da política = motivos de retenção atuais: `submit|name|shortcut|dialog|unclassified|agent`. Sem tipos novos.
- Pagamento, envio a pessoas, segredos e cartão: sempre retidos. Não são chaves da política; `sensitiveCategory` (`src/main/browser/sensitive.ts`) roda ANTES da política, para qualquer tipo. Uma chave dessas num arquivo é descartada com aviso.
- Precedência por tipo: agente > squad > workspace > padrão retido. Campo `screenPolicy` (agente, squad, `runner.screenPolicy`), schema v29. Nome na UI: "aprovações dos passos na tela".
- A política é resolvida por chamada (`CallScreen.policy`) e vale na próxima etapa. Mudança gravada em `saveConfig` (`screen-policy`); passo autônomo gravado em `screen-autonomous`, com `policyLevel`.
- `HoldGate.autonomous` é opcional. `policyChanges` foi renomeado para `screenPolicyChanges` (evita colisão com o da #268).
- Revisão: aprovada, sem bloqueantes. `electron-vite build` passou (saída 0).
- Resposta: Usar os motivos que o app já retém, como estão: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Não entram tipos novos; "novos tipos de passo" fica fora do escopo. Pagamento, envio a pessoas, segredos e cartão continuam sempre retidos e a política não pode liberá-los. Como não são tipos separados, seguem detectados como hoje, por palavras no nome do controle. <!-- answer:12 -->

## Restrições

- Padrão: tudo retido. `screen_handoff` inalterado. Textos via `t()` nos dois catálogos; CHANGELOG Unreleased.
- Comentários do renderer não podem ter `#NNN` de 3–4 dígitos: o theme-audit lê como cor literal.
- Não vai à produção sem a #268 (condição de lançamento, não imposta em código).
- Repositório público; identificadores em inglês.

## Tentado e descartado

- Lista nova de tipos de passo; as quatro categorias como chaves da política.
- Os testes desta mudança ficam em `test/screen-step-approvals.test.ts` (`test/screen-policy.test.ts` já existia com outro assunto).

## Perguntas abertas

- A #268 grava `auto-step`/`policy-change` e muda `saveConfig(next, by)`. Na mescla, unificar com `screen-autonomous`/`screen-policy`; considerar tirar o registro de `workspaceConfig.ts` para um módulo neutro (hoje importa `./browser/audit`).
- Sugestão da revisão: o passo de envio por Enter é checado só pelo campo em foco, não pelo botão do formulário (limite da heurística).
- Não verificado: a tela e a janela vistas no app, os 4 testes de navegador real (falta `@playwright/mcp` aqui), o `autocomplete` de cartão, e os testes não foram rodados de novo na revisão.

## Onde o trabalho está

Implementação concluída e revisada (aprovada). Próxima etapa: QA visual da grade (agente, squad e workspace) e do aviso na janela de aprovação, e rodar os testes.
- Passagem support → product-owner: Planejar: mapear as camadas de configuração (agente, squad, workspace), a tela de configurações, a detecção por palavras das quatro categorias sempre retidas e a ligação com #268. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Planejar a partir de 1_SPEC.md. Ler a tela de configurações (Settings.tsx, TeamSettings.tsx), onde moram agente/squad/workspace (AgentDef, SquadDef, bloco de autonomia do workspace/fluxo em src/shared/config/types.ts), o classificador src/main/browser/classify.ts (lista de palavras mistura pagamento e envio com salvar/apagar: prever detecção das quatro categorias antes da política), asks.ts/intermediary.ts, screenPrompt.ts e o registro de #268 para reaproveitar. Cuidar do choque de nome com a \"autonomia\" existente. <!-- handoff:30 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md na ordem dada: (1) tipos e resolução puros em shared/config/screenPolicy.ts com testes; (2) config v29 (types, defaults, schema, migração, validate, transfer, configScope); (3) detecção sensitive.ts e envoltório em classify; (4) decisão no intermediary + gate.autonomous + auditoria; (5) instantâneo por chamada em callScreen, frase de prompt e chaves de catálogo; (6) registro de mudança em saveConfig; (7) ScreenPolicyFields.tsx no agente, squad e workspace, aviso na janela de aprovação (com a Experiência); (8) CHANGELOG e docs. Conferir na implementação: chaves de prompt… <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: Revisar o diff contra 2_PLAN.md e 3_IMPLEMENTATION.md. Pontos de atenção: - ordem da decisão no intermediário; - `confirmPortFor`; - `screenPolicyRaised`; - `heldOnly` nos modelos; - registro em `saveConfig`. Rodar `electron-vite build`, que não foi rodado. Na QA, ver a grade nas configurações (agente, squad e workspace) e o aviso na janela de aprovação. Na mescla com a #268, unificar `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change` e o `saveConfig(next, by)` dela. Não liberar para produção sem a #268. <!-- handoff:154 -->
