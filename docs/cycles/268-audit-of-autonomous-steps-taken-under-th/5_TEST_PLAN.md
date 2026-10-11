# Plano de testes do registro de passos autônomos (após a mescla da release)

## Resultado geral

Aprovado nos critérios de código e testes. Ficam não verificados: a tela do log aberta no app e o build desta rodada.

## Cenários

| # | Cenário (fazer / esperar) | Resultado | Evidência |
|---|---|---|---|
| 1 | Base em dia: `HEAD..origin/release/0.11.0` deve ser 0 | Passou: 0 commits atrás | ev-8 |
| 2 | Testes de auditoria (critérios 1-5): política/nível em comando no host, portão, início de etapa, push, pull request, quadro; decisões aprovada/recusada (inclusive pela persona); mudança de política; cadeia/`tampered`; filtro "Quem"; `persona-worded` | Passou: 8 arquivos, 149 testes | ev-8 |
| 3 | Gates: `tsc --noEmit`, theme-audit, i18n:lint (6174 chaves), public-audit (critérios 6-7) | Passou, todos com saída 0 | ev-8 |
| 4 | Suíte completa `vitest run` (com `out/` apagado) | 530 de 534 arquivos, 8762 testes passaram, 15 ignorados. Falham 4 arquivos de navegador (`browser-contract`, `browser-runtime`, `browser-quit`, `browser-sites`): `@playwright/mcp` ausente. Sem relação com a mudança. | ev-9 |
| 5 | Critério 3: persona sem caminho de apagar/editar | Coberto por `audit-policy.test.ts` (passou no cenário 2): único canal `auditoria:list`, de leitura, e detecção de adulteração. Limite: agente `shell: host` pode editar o arquivo; só há detecção. | ev-8 |
| 6 | `electron-vite build` | Não rodado nesta rodada (passou na implementação, ev-7, não reconferido aqui) | - |
| 7 | Tela do log no app: política, nível, agente e marca "Alterado depois de escrito" | Não executado: o app não foi aberto; sem captura. | - |

## Não verificado

- Tela do log aberta no app (cenário 7).
- Build desta rodada (cenário 6).
- Os 4 testes de navegador (sem `@playwright/mcp`).
- Lista de passos autônomos contra a spec completa do product owner (truncada).
- Pull requests abertos para a release e se a #269 já mesclou nela.
- Interruptores de autonomia de agente e de squad não geram `policy-change` (a cobrir com a #269); `askCommand` ainda grava `by: 'person'` fixo; `lastChain` lê só os últimos 64 KB (sugestões da revisão).

## Resultado dos cenários

- Base em dia com release/0.11.0: passou (executado na sandbox) — 0 commits atrás de origin/release/0.11.0.
- Testes de auditoria (critérios 1-5): passou (executado na sandbox) — 8 arquivos, 149 testes passaram: política/nível, decisões, mudança de política, cadeia, persona-worded.
- Gates tsc, theme, i18n, public-audit: passou (executado na sandbox) — Todos com saída 0; 6174 chaves iguais nos dois idiomas.
- Suíte completa vitest: passou (executado na sandbox) — 530/534 arquivos, 8762 testes passaram; 4 arquivos de navegador falham por @playwright/mcp ausente, sem relação com a mudança.
- Persona sem caminho de apagar/editar (critério 3): passou (executado na sandbox) — Coberto por audit-policy.test.ts (passou); só canal de leitura e detecção de adulteração. Limite: agente com shell no host só tem detecção.
- electron-vite build: não rodou (lido) — Não rodado nesta rodada; passou na implementação (ev-7), não reconferido.
- Tela do log no app: não rodou (lido) — O app não foi aberto; sem captura nem comprovação.
