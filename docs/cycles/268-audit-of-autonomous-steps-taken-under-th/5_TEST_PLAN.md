# Plano de testes do registro de passos autônomos

## Resultado geral

Aprovado nos critérios de código e testes. Dois itens ficam não verificados: a tela do log aberta no app e os 4 testes de navegador (falta `@playwright/mcp` neste ambiente).

## Cenários

| # | Cenário (fazer / esperar) | Resultado | Evidência |
|---|---|---|---|
| 1 | Testes de auditoria: política/nível em comando no host, portão, início de etapa, push, pull request e quadro; decisões aprovada/recusada; mudança de política; cadeia/`tampered`; canal só de leitura (critérios 1-5). Rodar os 7 arquivos relacionados. | Passou: 137 de 138. Um timeout de 5 s em `conflict-resolve > discard` sob carga; o arquivo isolado passou 22/22. | ev-2 |
| 2 | tsc, theme-audit, i18n:lint, public-audit (critérios 6-7) | Passou, todos com saída 0 | ev-3, ev-5 |
| 3 | Suíte completa `vitest run` | 459 de 463 arquivos, 7787 testes passaram. Falham 4 arquivos de navegador (`browser-contract`, `browser-runtime`, `browser-quit`, `browser-sites`): módulo `@playwright/mcp` ausente em `node_modules`. Sem relação com a mudança. | ev-4 |
| 4 | `electron-vite build` | Passou (saída 0); worktree sem arquivos novos | ev-5 |
| 5 | Critério 3: persona sem caminho de apagar/editar | Coberto por `audit-policy.test.ts` (passou no cenário 1): único canal `auditoria:list` de leitura e detecção de adulteração. Limite: agente `shell: host` pode editar o arquivo; só há detecção. | ev-2 |
| 6 | Tela do log no app: política, nível, agente e a marca "Alterado depois de escrito" | Não executado: o app não foi aberto; sem captura. | - |

## Não verificado

- Tela do log aberta no app (cenário 6).
- Os 4 testes de navegador (ambiente sem `@playwright/mcp`).
- Lista de passos autônomos contra a spec completa do product owner (truncada).
- Mudanças dos interruptores de autonomia de agente e de squad não geram `policy-change` (sugestão da revisão, a cobrir com a #269).
- `lastChain` lê só os últimos 64 KB (sugestão da revisão).

## Resultado dos cenários

- 1. Testes de auditoria (critérios 1-5): passou (executado na sandbox) — 7 arquivos relacionados: 137 de 138 testes passaram; um timeout de 5 s em conflict-resolve sob carga, que passou isolado (22/22).
- 2. Gates tsc, theme, i18n, public-audit: passou (executado na sandbox) — Todos terminaram com saída 0.
- 3. Suíte completa: passou (executado na sandbox) — 459 de 463 arquivos, 7787 testes passaram; 4 arquivos de navegador falham por @playwright/mcp ausente, sem relação com a mudança.
- 4. electron-vite build: passou (executado na sandbox) — Build concluído com saída 0 e sem arquivos novos na worktree.
- 5. Persona sem caminho de apagar ou editar (critério 3): passou (executado na sandbox) — Coberto por audit-policy.test.ts, que passou: só o canal de leitura e detecção de adulteração. Limite declarado: agente com shell no host só tem detecção.
- 6. Tela do log no app: não rodou (lido) — O app não foi aberto; não há captura nem comprovação.
