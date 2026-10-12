# Plano de testes: etapa entregue a uma sessão do Claude Code (rodada 2)

## Resultado

Quase pronto, mas devolve ao desenvolvimento: a suíte completa tem 1 falha em 9030 (ev-7). tsc (ev-6), theme-audit, i18n:lint e public-audit (ev-5) passaram. Antes eram 12 falhas; 11 foram resolvidas. Interface não exercitada; o comportamento real do SDK do Claude Code não foi observado.

## Comandos rodados nesta etapa

1. `npx tsc --noEmit`: saída 0 (ev-6).
2. `npx vitest run` completo: saída 1; 1 falha, 9025 passaram, 4 ignoradas (ev-7).
3. `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`: todos saída 0 (ev-5).

## Cenários

| # | Critério | Resultado |
|---|---|---|
| 1 | Resultado de volta (ponta a ponta, sessão simulada) | Passou na suíte completa (ev-7); testes de runner-claude-code-stage sem falha. |
| 2 | Registro (transcrição fora da resposta) | Passou, idem (ev-7). |
| 3 | Permissão pendente | Passou no teste de módulo, sessão simulada (ev-7). SDK real não observado. |
| 4 | Escrita fora do worktree | Passou no teste de módulo (ev-7). |
| 5 | Opção desligada | Passou (guarda e ponta a ponta) (ev-7). |
| 6 | Workspace de teste | Passou (ev-7). |
| 7 | Celular e persona | **FALHA** (ev-7). Os dois primeiros testes da persona passam (recusa de ligar a opção e de escolher o executor). O terceiro falha: `configuração inválida: devCycle.stages[0].executor: expected string, got undefined`. O teste baixa o executor com `executor: undefined` explícito e a validação de saveConfig recusa a chave presente com valor indefinido (por IPC real a chave seria descartada na serialização). Correção provável: o teste remover a chave (desestruturar) em vez de atribuir undefined; confirmar se o validador deve tolerar `undefined`. |
| 8 | Falha da sessão | Passou (ev-7). |
| 9 | Padrão intacto | Passou; sem outra falha de fluxo na suíte (ev-7). |
| 10 | Sem `~/.claude` | Passou no teste de módulo; só por leitura que nada toca o diretório real. |
| 11 | Portões | tsc, theme-audit, i18n:lint, public-audit passam (ev-5, ev-6); vitest falha (ev-7). |

## Falha bloqueante

- `test/config-claude-code-persona.test.ts`, terceiro teste: ver cenário 7.

## Não verificado

- Interface (campo Executor e botão da opção): nenhum app subido, sem teste de componente.
- Comportamento real do SDK (`canUseTool`, `deny` respeitado, `structured_output`).
- Link da transcrição na timeline, `PendingCommand.tool` e `flow-check`: fora de escopo por decisão.
- Renumeração do passo de migração v34→v35 com a #280: fica para a integração.

## Resultado dos cenários

- 1/2/8 Resultado, transcrição e falha de ponta a ponta (sessão simulada): passou (executado na sandbox) — Testes de runner-claude-code-stage passam na suíte completa (a falha do esquema da execução foi corrigida).
- 3/4 Permissão pendente e escrita fora do worktree (módulo): passou (executado na sandbox) — Testes de claude-code-task passam com sessão simulada; SDK real não observado.
- 5/6 Recusa com opção desligada e workspace de teste: passou (executado na sandbox) — Guarda e ponta a ponta passam.
- 7 Celular e persona: falhou (executado na sandbox) — Recusas passam; o terceiro teste da persona falha ao salvar config com `executor: undefined` explícito (expected string, got undefined). Suposição do teste; portão vermelho.
- 9/10 Padrão intacto e sem ~/.claude: passou (executado na sandbox) — Sem outra falha de fluxo; testes de módulo conferem opções isoladas com sessão simulada.
- 11 Portões tsc, theme-audit, i18n:lint, public-audit: passou (executado na sandbox) — Todos saída 0.
- Suíte vitest completa: falhou (executado na sandbox) — 1 falha, 9025 passaram, 4 ignoradas.
- Interface: campo Executor e botão da opção: não rodou (lido) — Nenhum app subido nem teste de componente; sem comprovação.
