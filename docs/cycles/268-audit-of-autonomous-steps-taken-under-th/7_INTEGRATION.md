# Integração: base em dia, pronto para o pull request

**Veredito: pronto para o pull request**, com as ressalvas abaixo. Nenhum dos itens 1 a 6 falhou nas conferências feitas nesta etapa.

## Itens

| # | Item | Resultado | Evidência |
|---|---|---|---|
| 1 | CHANGELOG | OK. Linha em `[Unreleased]` › Added ("The audit log says what the autonomy policy did on the person's behalf"). | leitura de `CHANGELOG.md` (linhas 7 a 11) |
| 2 | Esquema | OK. `CONFIG_SCHEMA_VERSION` = 32 na branch e em `origin/release/0.11.0`; a mudança não toca o esquema nem migrações (plano e implementação). Sem passo repetido. Pull requests abertos para a release: não consultados. | ev-10 |
| 3 | Base | OK. `git rev-list --count HEAD..origin/release/0.11.0` = 0 (rodado agora, depois do commit de merge do app). | ev-10 |
| 4 | Gates | Ver abaixo. | comandos do app |
| 5 | Nomes de módulo | OK. `git ls-files` em minúsculas e sem extensão não achou par de pasta nova por esta mudança (conferência por nome completo de caminho; os pares css/ts antigos são de outras mudanças). `out/` não existe. | leitura |
| 6 | Base do pull request | Deve ser `release/0.11.0`, não a main. Release deduzida da branch e da versão 0.11.0-beta.3; não confirmada no host. | leitura |

## Gates

Observados nesta etapa (rodados pelo app antes de mim):
- `npm run typecheck` (`tsc --noEmit`): saída 0.
- `npm test` (`vitest run`): 530 de 534 arquivos e 8762 testes passaram, 15 ignorados; saída 1 por 4 arquivos de navegador (`browser-contract`, `browser-runtime`, `browser-quit`, `browser-sites`): `Cannot find module '@playwright/mcp/package.json'`. Falta de dependência do ambiente, sem relação com a mudança.

Não rodados por mim nesta etapa (só leitura): `theme-audit`, `i18n:lint`, `public-audit` e `electron-vite build`. A QA e a implementação relatam saída 0 (i18n com 6174 chaves) depois da mescla; o build passou só na implementação (ev-7). Não reconferidos.

## Não verificado

- Pull requests abertos para a release e se a #269 já mesclou nela (a #269 precisa renumerar seu passo de migração; esta não conflita no esquema).
- Que a release aberta seja a 0.11.0 (deduzido).
- Os 4 testes de navegador e a tela do log aberta no app.
- theme-audit, i18n:lint, public-audit e build nesta etapa.
- A lista de passos autônomos contra a spec completa do product owner (truncada).

## Para a próxima passagem

Abrir o pull request com base `release/0.11.0`; citar no texto os limites acima.

## Resultado dos cenários

- Base em dia com a release aberta: passou (executado na sandbox) — 0 commits atrás de origin/release/0.11.0.
- Esquema sem passo repetido com a release: passou (executado na sandbox) — CONFIG_SCHEMA_VERSION 32 na branch e na release; a mudança não toca o esquema. Pull requests abertos não consultados.
- CHANGELOG com linha em Unreleased: passou (executado na sandbox) — Linha 11, seção Added.
- Gates tsc e vitest: passou (lido) — Observados do app: tsc saída 0; vitest 530/534 arquivos, só os 4 de navegador falham (@playwright/mcp ausente). theme-audit, i18n, public-audit e build não rodados por mim.
- Nomes de módulo e base do PR: passou (lido) — Sem par novo por maiúscula/extensão (leitura); base do PR deve ser release/0.11.0 (deduzida).
