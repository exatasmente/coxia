# Integração: veredito e conferências

**Veredito: devolver ao implement.** Dois itens bloqueantes: o esquema de configuração (item 2) e a base (item 3).

## Itens

| # | Item | Resultado | Evidência |
|---|---|---|---|
| 1 | CHANGELOG | OK. Há linha em `[Unreleased]` › Added ("Screen step approvals"). Lido nesta etapa. A mescla com a release dá conflito neste arquivo. | leitura de `CHANGELOG.md` |
| 2 | Esquema | **BLOQUEANTE.** Branch: `CONFIG_SCHEMA_VERSION = 29`, passo `v28ToV29`. `origin/release/0.11.0`: versão 32, passos `v29ToV30`, `v30ToV31`, `v31ToV32`. O passo 28→29 da branch fica numa posição que a release já ocupa de outro modo. **Renumerar o passo desta branch** para `v32ToV33`, com `CONFIG_SCHEMA_VERSION = 33`, depois de trazer a base. Pull requests abertos para a release: não consultados (só conferi as branches). | ev-4 |
| 3 | Base | **BLOQUEANTE.** Depois de `git fetch`: `git rev-list --count HEAD..origin/release/0.11.0` = 160. A mescla de teste (`git merge-tree`, sem gravar nada) dá conflito em 13 arquivos: CHANGELOG.md, docs/configuration.md, src/shared/auditoria.ts, config/{defaults,migrations,schema,transfer,types}.ts, cycles/apply.ts e 4 arquivos de teste. Pedido: trazer a base pela ferramenta de conflito do app. Não fiz merge, rebase nem commit. | ev-4 |
| 4 | Gates | Parcial; ver abaixo. | saída do app |
| 5 | Nomes de módulo | Há pares na mesma pasta que diferem só pela extensão, mas todos já existiam antes desta mudança (`jobs.css`/`jobs.ts`, `activity.css`/`activity.ts`, `CeremonyCommands.tsx`/`ceremonyCommands.css`); a mudança não acrescenta nenhum. Não bloqueante. Pares tipo `.gitignore`/`.nvmrc` e `icon.png`/`icon.svg` são falsos positivos do meu filtro. | `git ls-files` + awk |
| 6 | Base do PR | Deve ser `release/0.11.0` (a release aberta), não a main. Não aberto ainda. A release aberta foi deduzida da branch mais nova de release e da versão 0.11.0-beta; não confirmei no host. | leitura |

## Gates (observados nesta etapa pelo app antes de mim)

- `npm run typecheck` (tsc --noEmit): saída 0.
- `npm test` (vitest run): 7833 passam, 15 ignorados; 4 arquivos de navegador real falham (browser-contract, browser-quit, browser-runtime, browser-sites) porque falta `@playwright/mcp` neste computador. Não verifiquei se falham também na base.

## Para a próxima passagem

1. Trazer a base pela ferramenta de conflito; resolver os 13 arquivos.
2. Renumerar a migração (v32→v33, versão 33) e ajustar os testes de migração e de esquema.
3. Na mesma mescla, tratar a #268 (unificar `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change`; `src/shared/auditoria.ts` já conflita).
4. Rodar de novo todos os gates e o build.

## Não verificado

Pull requests abertos para a release; a tela e a janela de aprovação no app; os 4 testes de navegador real.

## Resultado dos cenários

- CHANGELOG tem linha em Unreleased: passou (executado na sandbox) — Linha 'Screen step approvals' em [Unreleased] › Added.
- Esquema sem passo repetido com a release: falhou (executado na sandbox) — Release 0.11.0 na versão 32 com passos 29→30..31→32; a branch tem v28→v29 e versão 29. Renumerar para v32→v33.
- Base em dia com a release aberta: falhou (executado na sandbox) — 160 commits atrás de origin/release/0.11.0; mescla de teste dá conflito em 13 arquivos.
- Nomes de módulo sem pares por maiúscula/extensão: passou (executado na sandbox) — Só pares já existentes (css/ts); a mudança não acrescenta nenhum.
