# Aprovações dos passos na tela: o que foi construído

## Tentativa 4: conferência da base

A pessoa pediu "ajusta a base". A conferência mostrou que não havia o que ajustar (ev-12):
- Depois de `git fetch origin release/0.11.0` (0aacd4a0), a branch está 0 commits atrás e 11 à frente, e a release é ancestral do HEAD (4e746898).
- O PR #276, lido no host, já tem base `release/0.11.0`, `hasConflicts=false` e CI `success`, no head a4154a67. Os dois commits de documentos que vieram depois (revisão e QA) ainda não foram enviados.

Nenhum código mudou nesta tentativa. Gates e suíte não foram rodados de novo: valem os da tentativa 3 (abaixo).

## Tentativa 3: base da release e esquema 33

A integração devolveu a etapa por dois motivos: a base estava 160 commits atrás de `origin/release/0.11.0` e a migração colidia com a da release. Com a autorização da pessoa, a base foi trazida pelo shell com `git merge --no-commit --no-ff origin/release/0.11.0`. Não houve rebase. A mescla foi fechada pelo commit do app (a4154a67).

Conflitos resolvidos, 13 arquivos:
- `CHANGELOG.md`: a linha "Screen step approvals" fica em `[Unreleased]`, antes das seções de versão da release.
- `src/shared/config/types.ts`: `CONFIG_SCHEMA_VERSION = 33`; o comentário do esquema e `schema.ts` também dizem 33.
- `src/shared/config/migrations.ts`: o passo desta branch virou `v32ToV33` (grava `runner.screenPolicy = {}`, sem nota), depois de `v28ToV29`…`v31ToV32` da release; `STEPS` termina em `32: v32ToV33`.
- `src/shared/config/defaults.ts`: o `turns` da release e o `screenPolicy: {}` desta branch.
- `src/shared/config/transfer.ts`, `src/shared/cycles/apply.ts`, `src/shared/auditoria.ts`: imports e tipos das duas partes.
- `docs/configuration.md`: versão 33 e histórico com **v33**.
- Testes: `agent-team`, `runner-config`, `team-runner-edit`, `config-migrations` (bloco novo 32→33: grava `{}` sem nota, v28 chega a 33 com tudo retido, 34 é recusado).

A unificação com a #268 (`screen-autonomous`/`screen-policy` × `auto-step`/`policy-change`) não foi feita: a #268 não está na release.

## O que mudou (por passo do plano)

1. **Tipos e resolução** (`src/shared/config/screenPolicy.ts`): `ScreenPolicy`, `resolveScreenPolicy` / `resolveLevels` (agente > squad > workspace > padrão retido, tipo a tipo), `releasedKinds`, `runsAlone`, `sanitizePolicy`, `heldOnly`, `releasedIn`, `screenPolicyChanges`, `policyRaised`. `STEP_KINDS` e `SENSITIVE_CATEGORIES` em `src/shared/browser.ts`.
2. **Config v33**: `AgentDef.screenPolicy?`, `SquadDef.screenPolicy?`, `runner.screenPolicy` (padrão `{}`), schema, migração `v32ToV33`, normalização. A validação descarta com aviso chave desconhecida ou de categoria (`payment|people|secret|card`).
3. **Detecção** (`src/main/browser/sensitive.ts`): tabela en/pt das quatro categorias e o tipo `password`. `classify()` marca `sensitive` sem mudar `class`/`why`.
4. **Decisão no intermediário**: livre roda; sensível pergunta; passe do site só se não sensível; tipo liberado roda e grava `screen-autonomous`; senão pergunta. `confirmPortFor`: `pay`/`send` e palavras sensíveis sempre perguntam.
5. **Por chamada** (`callScreen.ts`): política lida ao abrir a tela e usada no navegador, no `confirm` e no prompt; a frase `runner.rules.screen.policy` só aparece com tipo liberado.
6. **Registro da mudança**: `saveConfig` → `auditPolicyChanges` (`screen-policy` por tipo mudado).
7. **Escopo e arquivos**: `screenPolicyRaised` para o navegador pareado; modelos guardam só retenções; importação lista liberações.
8. **Interface**: `ScreenPolicyFields.tsx` (agente, squad, workspace), aviso em `AskCard` e `askNotice`, tipos na auditoria, dois catálogos.
9. **Docs**: `CHANGELOG.md` (Unreleased › Added, com a condição da #268) e `docs/configuration.md`.

## Diferenças em relação ao plano

- Migração `v32ToV33` e esquema 33, por causa da release.
- `HoldGate.autonomous` opcional; `BrowserPort` não mudou (envoltório em `openCallScreen`).
- Testes de resolução em `test/screen-step-approvals.test.ts`; `policyChanges` virou `screenPolicyChanges`.
- O probe não lê `autocomplete` de cartão; limite documentado.

## Verificação

Tentativa 4 (ev-12): fetch da release, contagem de commits e leitura do PR #276, como descrito acima.

Tentativa 3, depois da mescla (ev-5): `npx tsc --noEmit` com saída 0; `npx vitest run` com 8807 testes passando e 3 falhando (os 4 arquivos de navegador real por falta de `@playwright/mcp` e `agent-assist-prompts` por tempo esgotado, que passa sozinho); theme-audit, i18n:lint, public-audit e `electron-vite build` com saída 0.

## Não verificado

- A tela de configurações e a janela de aprovação vistas no app (só testes de renderização).
- Os 4 testes de navegador real, e se falham também na base.
- O CI do PR nos commits de documentos ainda não enviados.
- A unificação com a #268.

## Limite conhecido e pendência

- Detecção por palavras (en/pt) e tipo `password`; Enter em campo neutro com botão "Pagar" passa se `submit` estiver liberado; `autocomplete` de cartão não é lido.
- Unificar `screen-autonomous`/`screen-policy` (`policyLevel`) com `auto-step`/`policy-change` (`policy.level`) da #268.
- Regra 14 (não ir à produção sem a #268) é condição de lançamento, não imposta em código.
