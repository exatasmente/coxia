# Plano de testes: etapa entregue a uma sessão do Claude Code

## Resultado

Devolve ao desenvolvimento. `tsc`, `theme-audit`, `i18n:lint` e `public-audit` passaram. `vitest` falhou: 7 falhas nos cinco testes tocados e 12 na suíte completa (7 arquivos). Nada de interface foi exercitado (sem app em execução; o comportamento real do SDK do Claude Code não foi observado).

## Comandos rodados nesta etapa

1. `npx tsc --noEmit`: saída 0, sem mensagens (ev-4).
2. `npx vitest run` nos cinco testes tocados: 7 falhas, 130 passaram (ev-2).
3. `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`: todos saída 0 (ev-1).
4. `npx vitest run` completo: 12 falhas, 9014 passaram, 4 ignoradas (ev-3).

## Cenários

| # | Critério | O que fazer / esperar | Resultado |
|---|---|---|---|
| 1 | Resultado de volta | Etapa `claude-code` com sessão simulada: a resposta é o resultado da sessão. | **FALHA** (ev-2). A criação da execução é recusada: `flow.stages[4].executor: is not a known field`. |
| 2 | Registro | Transcrição em arquivo e na thread, fora da resposta. | **FALHA** pelo mesmo motivo (ev-2). |
| 3 | Permissão pendente | `canUseTool` pergunta pelo porto e a etapa espera. | **Passou** no teste de módulo `claude-code-task` (ev-2), com sessão simulada. Comportamento real do SDK não observado. |
| 4 | Escrita fora do worktree | `Write` fora/`..`/link simbólico negado. | **Passou** no teste de módulo (ev-2), sessão simulada. |
| 5 | Opção desligada | Recusa sem chamar sessão nem agente. | Guarda isolada **passou** (`claude-code-executor-guard`); o teste de ponta a ponta **FALHA** pelo motivo do cenário 1 (ev-2). |
| 6 | Workspace de teste | Recusa com a opção ligada. | Idem 5. |
| 7 | Celular e persona | Ligar a opção / escolher executor negado. | **Parcial.** Recusa da persona ao ligar a opção passou; os testes de escolha do executor **falham** porque o teste lê `devCycle.stages[0]`, que não existe na config neutra (suposição errada do teste, `TypeError`) (ev-2). A recusa do celular passou no teste de escopo. |
| 8 | Falha da sessão | Etapa falha como qualquer agente. | Módulo **passou**; ponta a ponta **FALHA** (cenário 1) (ev-2). |
| 9 | Padrão intacto | Etapa sem campo segue no agente do Coxia. | O teste do runner que cobre isso não foi apontado como falho; suíte completa sem outra falha de fluxo (ev-3). |
| 10 | Sem `~/.claude` | Sessão simulada, `settingSources: []`. | **Passou** no teste de módulo (ev-2); só por leitura do teste que nada toca `~/.claude`. |
| 11 | Portões do repositório | Cinco portões do AGENTS.md. | tsc, theme-audit, i18n:lint, public-audit: passam (ev-1, ev-4). vitest: **FALHA** (ev-3). |

## Falhas encontradas

Bloqueantes:

- **Esquema da execução.** `src/shared/runs/schema.ts` (bloco da etapa, ao lado de `display`, ~linha 213) não tem `executor`; `parseRun` recusa o arquivo. Toda execução cujo fluxo tenha etapa `claude-code` não inicia, mesmo com a opção ligada. Corrigir com `executor: enum ['claude-code']` e manter o hash estável. Cobre 5 testes de `runner-claude-code-stage`.
- **Teste da persona** (`test/config-claude-code-persona.test.ts:44`): usa `getConfig().devCycle.stages[0]`, inexistente na config neutra; ajustar o teste para montar a etapa.
- **Testes que não acompanharam o campo/opção:** `runner-config.test.ts` e `team-runner-edit.test.ts` (runner ganhou `claudeCodeTasks`, 24 campos contra 23 no esperado); `docs-schema-version.test.ts` (docs/configuration.md ainda não cita "versão do esquema 35"); `ui-i18n.test.ts` (chaves de `ui-team.en.json` fora de ordem); `runs-policy.test.ts` (`module.ts` agora também chama a pergunta de escrita externa; confirmar se é intencional e ajustar a lista ou o código).

## Não verificado

- Interface (campo Executor, botão da opção): nenhum app subido, sem teste de componente.
- Comportamento real do SDK (`canUseTool`, `deny` respeitado, `structured_output`).
- Se as falhas de `runs-policy` e `ui-i18n` já existiam antes desta mudança: não comparado com a base; pela mensagem, decorrem desta mudança.
- Renumeração do passo de migração v34→v35 com a #280: fica para a integração.

## Resultado dos cenários

- Portões: tsc, theme-audit, i18n:lint, public-audit: passou (executado na sandbox) — Os quatro terminaram com saída 0.
- 1/2/8 Resultado, transcrição e falha de ponta a ponta: falhou (executado na sandbox) — A criação da execução é recusada pelo esquema do arquivo: flow.stages[4].executor não é campo conhecido. Os cinco testes de runner-claude-code-stage falham por isso.
- 5/6 Recusa com opção desligada e workspace de teste (ponta a ponta): falhou (executado na sandbox) — A guarda isolada passa, mas os testes pelo runner falham antes, no mesmo erro do esquema.
- 3/4 Permissão pendente e escrita fora do worktree (módulo): passou (executado na sandbox) — Testes de claude-code-task passam com sessão simulada; SDK real não observado.
- 7 Celular e persona: falhou (executado na sandbox) — Dois testes do handler da persona falham por TypeError (devCycle.stages[0] indefinido na config neutra): suposição errada do teste, então a recusa do executor pela persona não foi demonstrada.
- Suíte vitest completa: falhou (executado na sandbox) — 12 falhas em 7 arquivos: os dois acima mais runner-config, team-runner-edit, docs-schema-version, ui-i18n e runs-policy.
- Interface: campo Executor e botão da opção: não rodou (lido) — Nenhum app subido; execuções não iniciam por causa do esquema. Sem teste de componente.
