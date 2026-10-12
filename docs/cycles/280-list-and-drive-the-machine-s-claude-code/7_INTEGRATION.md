# Integração: ordem de entrada e renumeração do esquema

## Veredito

**Devolver ao implement.** A pessoa respondeu "2882 vai primeiro". Leio como a #282 primeiro: "2882" não é uma issue deste repositório, e a leitura mais provável é "282" com um 8 repetido. Esta resposta é a mais recente e vale mais que o "280 primeiro" anterior. Se a leitura estiver errada, basta dizer, e o veredito volta a ser o da rodada anterior.

Com a #282 entrando primeiro, esta branch precisa renumerar o passo de configuração.

## O que renumerar nesta branch

- `CONFIG_SCHEMA_VERSION` de 35 para 36 (`src/shared/config/types.ts:7`).
- `v34ToV35` vira `v35ToV36` e passa a migrar do esquema 35 (o da #282) para o 36 (`src/shared/config/migrations.ts:500`).
- Comentário de histórico em `migrations.ts` e `docs/configuration.md`.
- `test/config-migrations.test.ts` (bloco 34→35 vira 35→36) e `CHANGELOG.md`, que cita o esquema 35.
- Atenção: a `release/0.11.0` está no 34 e a #282 vai trazer o 35. Esta branch só pode ser mesclada depois, com a base trazida pela ferramenta de conflito do app.

## Itens

| # | Item | Resultado | Evidência |
|---|---|---|---|
| 1 | CHANGELOG | Linha em `[Unreleased]` / `Added` (rodada anterior). Não reconferido agora, e precisa ajustar a menção ao esquema. | não verificado nesta rodada |
| 2 | Esquema | **Bloqueante.** Esta branch: 35 com `v34ToV35` (lido, ev-13). A #282 usa o mesmo número e entra primeiro, então esta branch renumera para 36. | ev-13 (lido) |
| 3 | Base | Não reverificada nesta rodada. A rodada anterior achou 0 commits atrás de `origin/release/0.11.0`. Reconferir depois da renumeração e da entrada da #282. | não verificado |
| 4 | Gates | Nesta etapa o app rodou `npm test` (562 arquivos passaram, 1 pulado, 9068 testes, código 0) e `npm run typecheck` (código 0). theme-audit, i18n:lint, public-audit e build não foram rodados nesta rodada. | saída do app |
| 5 | Nomes de módulo | Não reconferido. O teste `module-names-case.test.ts` passou dentro do `npm test`. | saída do app |
| 6 | Base do PR | Deve ser `release/0.11.0`. O PR ainda não existe. | não verificado |

## Não verificado

- A leitura de "2882" como #282 (suposição minha, a confirmar).
- Nada contra o Claude Code real nem com a tela aberta.
- O esquema da #282 e da release não foi relido nesta rodada.
- Pull requests abertos.

## Resultado dos cenários

- Esquema: ordem de entrada e numeração: falhou (lido) — Esta branch tem CONFIG_SCHEMA_VERSION 35 e v34ToV35. Com a #282 entrando primeiro (leitura de "2882"), precisa ir a 36.
- Testes e typecheck rodados pelo app: passou (lido) — npm test: 562 arquivos passaram, 9068 testes, código 0. npm run typecheck: código 0. Rodados pelo app antes da etapa, não por mim.
- Base, outros gates e base do PR: não rodou (lido) — Não reverificados nesta rodada: sem mudança de código e o veredito já devolve ao implement. Sem comprovação.
