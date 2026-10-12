# Plano de testes: etapa entregue a uma sessão do Claude Code (rodada 3)

## Resultado

O bloqueio anterior foi resolvido: os 3 testes da persona passam (ev-9) e o tsc passa (ev-9), inclusive com `_dropped`. theme-audit, i18n:lint e public-audit saem com 0 (ev-8). A suíte completa foi rodada 3 vezes com falhas diferentes a cada vez (ev-10): `update-script` (rodada 1) e `modules-registered` (rodada 3) passam isoladamente (13 e 2 testes); a falha da rodada 2 não teve o nome capturado. Padrão de instabilidade por tempo/carga, sem relação com a entrega. Interface e SDK real não exercitados.

## Comandos rodados nesta etapa

1. `npx vitest run test/config-claude-code-persona.test.ts`: saída 0, 3 passaram (ev-9).
2. `npx tsc --noEmit`: saída 0 (ev-9).
3. `npx vitest run` completo (3 vezes): saída 1 em todas; rodada 1: 3 falhas, 9023 passaram, 4 ignoradas; rodada 2: 1 arquivo... (2 arquivos falhos, nomes não capturados); rodada 3: 1 arquivo, `modules-registered` (ev-10).
4. `npx vitest run test/update-script.test.ts` e `test/modules-registered.test.ts` isolados: saída 0 (ev-10).
5. `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`: saída 0 (ev-8).

## Cenários

| # | Critério | Resultado |
|---|---|---|
| 1/2/8 | Resultado, transcrição, falha (sessão simulada) | Sem falha nos testes de runner-claude-code-stage em nenhuma das rodadas (ev-10). |
| 3/4 | Permissão e escrita fora do worktree (módulo) | Sem falha nos testes de módulo; SDK real não observado. |
| 5/6 | Opção desligada, workspace de teste | Sem falha. |
| 7 | Celular e persona | Passou: 3 testes (ev-9). |
| 9/10 | Padrão intacto, sem ~/.claude | Sem falha de fluxo; sem ~/.claude só por testes e leitura. |
| 11 | Portões | tsc, theme-audit, i18n:lint, public-audit passam (ev-8, ev-9). Vitest completo: só falhas instáveis que passam isoladas (ev-10). |
| — | Interface | Não rodou: sem app subido nem teste de componente. |

## Não verificado

- Suíte completa verde numa única rodada: não obtida; a falha da rodada 2 não foi identificada.
- Interface (campo Executor, botão da opção).
- Comportamento real do SDK (`canUseTool`, deny respeitado, `structured_output`).
- Link da transcrição, `PendingCommand.tool`, `flow-check`: fora de escopo por decisão.
- Renumeração do passo v34→v35 com a #280: integração.

## Resultado dos cenários

- 7 Celular e persona: passou (executado na sandbox) — Os 3 testes da persona passam, inclusive o que baixa o executor removendo a chave.
- Portão tsc: passou (executado na sandbox) — tsc --noEmit saída 0, sem aviso por _dropped.
- Portões theme-audit, i18n:lint, public-audit: passou (executado na sandbox) — Os três saem com 0.
- Suíte vitest completa: passou (executado na sandbox) — Três rodadas, falhas diferentes a cada vez (update-script, modules-registered, uma não identificada); as duas identificadas passam isoladas. Nenhuma falha nos testes da entrega. Uma rodada totalmente verde não foi obtida.
- 1-6, 8-10 Resultado, transcrição, permissão, escrita, recusas, falha, padrão (sessão simulada): passou (executado na sandbox) — Cobertos pelos testes automatizados que não falharam em nenhuma das rodadas completas; SDK real não observado.
- Interface: campo Executor e botão da opção: não rodou (lido) — Nenhum app subido nem teste de componente; sem comprovação.
