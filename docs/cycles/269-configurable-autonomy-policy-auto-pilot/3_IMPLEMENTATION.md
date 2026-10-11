# Aprovações dos passos na tela: o que foi construído

## Tentativa 3: base da release e esquema 33

A integração devolveu a etapa por dois motivos: a base estava 160 commits atrás de `origin/release/0.11.0` e a migração colidia com a da release. Com a autorização da pessoa, a base foi trazida pelo shell com `git merge --no-commit --no-ff origin/release/0.11.0`. Não houve rebase nem commit: a mescla fica aberta (MERGE_HEAD presente) e o commit do app a fecha.

Conflitos resolvidos, 13 arquivos:
- `CHANGELOG.md`: a linha "Screen step approvals" fica em `[Unreleased]`, antes das seções de versão da release.
- `src/shared/config/types.ts`: `CONFIG_SCHEMA_VERSION = 33`; o comentário do esquema também diz 33, assim como `schema.ts`.
- `src/shared/config/migrations.ts`: o passo desta branch virou `v32ToV33` (grava `runner.screenPolicy = {}`, sem nota). Ele vem depois dos passos `v28ToV29`…`v31ToV32` da release, e `STEPS` termina em `32: v32ToV33`. A lista de versões ganhou a linha v33.
- `src/shared/config/defaults.ts`: o `turns` da release e o `screenPolicy: {}` desta branch.
- `src/shared/config/transfer.ts`: os dois imports (`releasedIn` e `withoutPersona`).
- `src/shared/cycles/apply.ts`: os imports da release mais `heldOnly`/`releasedIn`; os avisos de modelo para `screenPolicy` e para `kind`.
- `src/shared/auditoria.ts`: o `AuditKind` da release mais `screen-autonomous` e `screen-policy`, e o tipo `Through` da release.
- `docs/configuration.md`: versão 33 no texto e na tabela; histórico com **v33**; o campo `runner.screenPolicy` agora diz v33.
- Testes: `agent-team` (as propriedades do agente com `kind` e `screenPolicy`), `runner-config` e `team-runner-edit` (o `turns` da release e o `screenPolicy`), `config-migrations`. Neste último, o teste 28→29 da release é mantido, o de 31→32 deixou de ser o "último passo", e há um bloco novo 32→33: grava `{}` sem nota, não toca o resto, um arquivo v28 chega a 33 com tudo retido, e 33 é atual enquanto 34 é recusado.

A unificação com a #268 (`screen-autonomous`/`screen-policy` × `auto-step`/`policy-change`) não foi feita: a #268 não está na release trazida, e os tipos dela não aparecem no `AuditKind` da release.

## O que mudou (por passo do plano)

1. **Tipos e resolução** (`src/shared/config/screenPolicy.ts`, exportado em `config/index.ts`): `ScreenPolicy`, `resolveScreenPolicy` / `resolveLevels` (agente > squad > workspace > padrão retido, tipo a tipo), `releasedKinds`, `runsAlone`, `sanitizePolicy`, `heldOnly`, `releasedIn`, `screenPolicyChanges`, `policyRaised`. `STEP_KINDS` e `SENSITIVE_CATEGORIES` em `src/shared/browser.ts`.
2. **Config v33**: `AgentDef.screenPolicy?`, `SquadDef.screenPolicy?` e `runner.screenPolicy` (padrão `{}`), schema, migração `v32ToV33` e normalização em `newAgent`/`newSquad`. A validação descarta com **aviso** uma chave desconhecida ou de categoria (`payment|people|secret|card`).
3. **Detecção** (`src/main/browser/sensitive.ts`): tabela en/pt das quatro categorias, mais o tipo `password` do campo. `classify()` marca `sensitive` sem mudar `class`/`why`.
4. **Decisão no intermediário**, nesta ordem: livre roda; sensível pergunta (com `sensitive` no pedido quando a política o liberaria); passe do site só se não for sensível; tipo liberado roda e `gate.autonomous` grava `screen-autonomous`; senão pergunta como hoje. Confirmação do agente (`confirmPortFor`): `pay`/`send` e palavras sensíveis sempre perguntam; o tipo `agent` liberado responde "sim" e grava `screen-autonomous`.
5. **Por chamada** (`callScreen.ts`): `policyOf` lê a config quando a chamada abre a tela e a guarda em `CallScreen.policy`; a mesma política vai em cada `browser.call`, no `confirm` e no prompt (`screenPrompt.ts`). A frase `runner.rules.screen.policy` só aparece com tipo liberado.
6. **Registro da mudança**: `saveConfig` chama `auditPolicyChanges` (uma linha `screen-policy` por tipo mudado). A primeira carga não grava.
7. **Escopo e arquivos**: `screenPolicyRaised` recusa ao navegador pareado liberar um tipo; modelos guardam só as retenções, com aviso; a importação lista as liberações em `collectCommands`.
8. **Interface**: `ScreenPolicyFields.tsx` no editor de agente, squad e workspace (só no computador); aviso na janela de aprovação (`AskCard`) e em `askNotice`; tipos novos na tela de auditoria; textos nos dois catálogos.
9. **Docs**: `CHANGELOG.md` (Unreleased › Added, com a condição da #268) e `docs/configuration.md`.

## Diferenças em relação ao plano

- A migração é `v32ToV33` e o esquema é 33, em vez de 28→29 e 29, por causa da release.
- `HoldGate.autonomous` é opcional; o gate real (`asks.ts`) o implementa.
- A política vai ao navegador por um envoltório em `openCallScreen`; `BrowserPort` não mudou.
- Os testes de resolução ficaram em `test/screen-step-approvals.test.ts`.
- `policyChanges` virou `screenPolicyChanges`, para não colidir com o da #268.
- O probe não lê o `autocomplete` de campo de cartão; fica como limite documentado.

## Verificação (rodada nesta tentativa, depois da mescla; ev-5)

- `npx tsc --noEmit`: saída 0.
- `npx vitest run`: 531 arquivos passam e 5 falham; 8807 testes passam, 3 falham, 15 ignorados. Falham os 4 arquivos de navegador real (browser-contract, browser-runtime, browser-quit, browser-sites), por falta de `@playwright/mcp` neste computador, e `agent-assist-prompts`, por tempo esgotado (5,6 s) na rodada completa.
- Rodados de novo, sozinhos, 9 arquivos (agent-assist-prompts, config-migrations, agent-team, runner-config, team-runner-edit, config-schema, screen-step-approvals, cycle-templates, config-transfer): 417 passam.
- `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`: saída 0.
- `electron-vite build` (saída numa pasta temporária fora da worktree): saída 0.

## Não verificado

- A tela de configurações e a janela de aprovação vistas no app (há só testes de renderização).
- Os 4 testes de navegador real, e se eles falham também na base.
- A causa do tempo esgotado de `agent-assist-prompts` na rodada completa.
- O commit da mescla: depende do commit do app.
- A unificação com a #268.

## Limite conhecido e pendência

- A detecção é por palavras (en/pt) e pelo tipo `password`. Um controle de nome genérico que paga não é pego; Enter num campo neutro com botão "Pagar" também passa se `submit` estiver liberado; o `autocomplete` de cartão não é lido.
- A #268 grava `auto-step` / `policy-change` com `policy.level`, e esta entrega grava `screen-autonomous` / `screen-policy` com `policyLevel`. Unificar fica para a mescla da #268.
- A regra 14 (não ir à produção sem a #268) é condição de lançamento e não é imposta em código.
