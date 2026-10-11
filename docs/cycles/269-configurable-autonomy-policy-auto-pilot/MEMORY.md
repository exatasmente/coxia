# Memória do ciclo

## Decisões

- Tipos de passo da política = motivos de retenção atuais: `submit|name|shortcut|dialog|unclassified|agent`. Sem tipos novos.
- Pagamento, envio a pessoas, segredos e cartão: sempre retidos. Não são chaves da política; `sensitiveCategory` (`src/main/browser/sensitive.ts`) roda ANTES da política, para qualquer tipo. Uma chave dessas num arquivo é descartada com aviso.
- Precedência por tipo: agente > squad > workspace > padrão retido. Campo `screenPolicy` (agente, squad, `runner.screenPolicy`), schema v29. Nome na UI: "aprovações dos passos na tela".
- A política é resolvida por chamada (`CallScreen.policy`, em `openCallScreen`/`policyOf`) e vale na próxima etapa. Mudança gravada em `saveConfig` (`screen-policy`); passo autônomo gravado em `screen-autonomous`, com `policyLevel`.
- `HoldGate.autonomous` é opcional. `policyChanges` foi renomeado para `screenPolicyChanges` (evita colisão com o da #268).
- Resposta: Usar os motivos que o app já retém, como estão: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Não entram tipos novos; "novos tipos de passo" fica fora do escopo. Pagamento, envio a pessoas, segredos e cartão continuam sempre retidos e a política não pode liberá-los. Como não são tipos separados, seguem detectados como hoje, por palavras no nome do controle. <!-- answer:12 -->

## Restrições

- Padrão: tudo retido. `screen_handoff` inalterado. Textos via `t()` nos dois catálogos; CHANGELOG Unreleased.
- Comentários do renderer não podem ter `#NNN` de 3–4 dígitos: o theme-audit lê como cor literal.
- Não vai à produção sem a #268 (condição de lançamento, não imposta em código).
- Repositório público; identificadores em inglês.

## Tentado e descartado

- Lista nova de tipos de passo; as quatro categorias como chaves da política.
- `test/screen-policy.test.ts` já existia (política web do #157). Os testes desta mudança ficam em `test/screen-step-approvals.test.ts`.

## Perguntas abertas

- A #268 (outra execução) grava `auto-step`/`policy-change` com `policy.level` e muda `saveConfig(next, by)`. Na mescla, unificar com `screen-autonomous`/`screen-policy`.
- Não verificado: `electron-vite build`, a tela e a janela vistas no app, os testes de navegador real (falham neste computador porque falta `@playwright/mcp`), o `autocomplete` de cartão (não lido, limite documentado).

## Onde o trabalho está

Implementação concluída (3_IMPLEMENTATION.md):
- tsc, theme-audit, i18n:lint e public-audit passam;
- vitest: só falham os 4 arquivos de navegador real (sem `@playwright/mcp` neste computador);
- 2 testes (agent-assist-prompts, workspace-guard) falharam só na rodada completa e passaram sozinhos.

Próxima etapa: revisão, `electron-vite build` e QA visual da grade e do aviso.
- Passagem support → product-owner: Planejar: mapear as camadas de configuração (agente, squad, workspace), a tela de configurações, a detecção por palavras das quatro categorias sempre retidas e a ligação com #268. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Planejar a partir de 1_SPEC.md. Ler a tela de configurações (Settings.tsx, TeamSettings.tsx), onde moram agente/squad/workspace (AgentDef, SquadDef, bloco de autonomia do workspace/fluxo em src/shared/config/types.ts), o classificador src/main/browser/classify.ts (lista de palavras mistura pagamento e envio com salvar/apagar: prever detecção das quatro categorias antes da política), asks.ts/intermediary.ts, screenPrompt.ts e o registro de #268 para reaproveitar. Cuidar do choque de nome com a \"autonomia\" existente. <!-- handoff:30 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md na ordem dada: (1) tipos e resolução puros em shared/config/screenPolicy.ts com testes; (2) config v29 (types, defaults, schema, migração, validate, transfer, configScope); (3) detecção sensitive.ts e envoltório em classify; (4) decisão no intermediary + gate.autonomous + auditoria; (5) instantâneo por chamada em callScreen, frase de prompt e chaves de catálogo; (6) registro de mudança em saveConfig; (7) ScreenPolicyFields.tsx no agente, squad e workspace, aviso na janela de aprovação (com a Experiência); (8) CHANGELOG e docs. Conferir na implementação: chaves de prompt… <!-- handoff:49 -->
