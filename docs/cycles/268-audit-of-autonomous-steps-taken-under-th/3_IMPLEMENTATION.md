# O que foi construído para o registro dos passos autônomos

## O que mudou

- **Política em cada linha** (`src/shared/auditoria.ts`, `src/shared/config/autonomy.ts`): `AuditEntry` tem os campos opcionais `policy` (cinco escolhas, `board` quando é escrita do quadro, `level`, `flow`), `chain` e `tampered`. Há três tipos novos: `auto-step`, `decision` e `policy-change`. `auditPolicyOf` monta a política em vigor e `levelOf` é o único lugar que dá nome ao nível (hoje `workspace` ou `flow`). `policyChanges` compara duas configs, escolha por escolha.
- **Log encadeado** (`src/main/auditoria.ts`): cada linha guarda `chain = sha256(chain anterior + corpo)`. `listAudit` marca `tampered` numa linha editada, na linha seguinte a uma removida e numa linha sem `chain` depois que a cadeia começou. Linhas antigas sem `chain` são lidas como estão. Quem chama `recordWrite` não consegue definir `chain` nem `tampered`.
- **Passos autônomos**:
  - comando no host: uma linha `auto-step` por comando, com o comando mascarado (`executor.ts` `hostApproval`);
  - portão aprovado pelo app: `auto-step` com o agente da etapa julgada (`service.ts` `gateBy`);
  - início de etapa: `auto-step` em `tell`, quando a execução entra numa etapa de trabalho autônoma já com status `working`;
  - push e pull request: levam `policy` (`publish.ts`, `door.ts`, `actions.ts` `pushRunBranchAuto`/`runVcsAuto`);
  - quadro: `policy` com `board` (`boardHost.ts` `runNow`).
- **Decisões sobre passos retidos**:
  - `approveAction` grava `decision` `approved` no momento do "sim", depois das guardas e antes da escrita (a escrita grava a própria linha, ligada pelo `actionId`);
  - `skipAction` grava `refused` só quando o passo ainda esperava;
  - a resposta da pessoa a um comando no host (`askCommand`) e o portão decidido pela pessoa gravam `decision` com `by: person` e sem `policy`.
- **Mudança de política** (`src/main/workspaceConfig.ts`): `saveConfig(next, by = 'person')` grava uma linha `policy-change` por escolha alterada (nível, fluxo, escolha, antes, depois). A primeira carga não grava nada. `updateConfig` repassa `by`.
- **Tela do log** (`Auditoria.tsx`): mostra os três tipos novos, "por {agente}", a política em vigor (escolhas ligadas e nível) e a marca "Alterado depois de escrito". Os textos novos estão nos dois catálogos; o nome do pull request usa o termo do host (`{crLong}`).
- **CHANGELOG** `Unreleased` › Added.

## Diferenças em relação ao plano

- A aprovação grava a decisão antes da escrita e com `ok: true`; o resultado fica só na linha da escrita. Gravar depois duplicava o resultado e tirava a escrita do topo do log.
- O início de etapa também é gravado quando a etapa é autônoma pelo interruptor do próprio agente, com a política do ciclo desligada. É um passo sem "sim" (regra 6), e a linha mostra a política que estava valendo, com `cycle: false`.
- `mentions/propose.ts` ficou sem `policy`: aquela escrita sai pela autonomia do próprio agente, não pelas cinco escolhas, assim como os plugins (decisão 3). A linha já tem `by`.

## Testes

- `test/audit-policy.test.ts` (novo):
  - política gravada e cadeia;
  - linha editada, removida ou forjada é marcada;
  - linha antiga é lida sem marca;
  - token fora do log;
  - um só canal, `auditoria:list`, que não altera o arquivo;
  - mudança no workspace e depois num fluxo grava uma linha por escolha, com antes, depois, nível e quem mudou; uma mudança sem relação não grava.
- `test/autonomy.test.ts`: `levelOf` e `auditPolicyOf` (workspace, fluxo, `release`, quadro).
- `test/actions-group.test.ts`:
  - aprovação grava `decision` antes da escrita;
  - recusa grava `refused` e não executa;
  - recusar de novo não grava;
  - aprovação barrada no workspace de teste não grava.
- `test/runner-host-shell.test.ts`:
  - um `auto-step` por comando, com agente, hora, política e nível;
  - token mascarado;
  - portão aprovado pelo app vira `auto-step`;
  - comando e portão decididos pela pessoa viram `decision`, sem `policy`.
- `test/runner-publish.test.ts`: push e pull request com `level: workspace`, e o mesmo com `level: flow` quando o bloco do fluxo decide (critério 5 da spec); início de etapa autônomo com o agente.
- `test/board-host.test.ts`: a escrita do quadro leva a política do workspace com `board`.
- `test/helpers/audit.ts` (novo): `writesOf` e `autonomyLines`. Os testes antigos que contavam as escritas (`board-host`, `release-actions`, `runner-publish`, `runner-release`, `vcs-writes`, `conflict-resolve`, `actions-group`) passaram a ler só as escritas.

## Verificação

- `npx tsc --noEmit`: passou.
- `node scripts/theme-audit.mjs`: passou.
- `npm run i18n:lint`: passou (chaves iguais nos dois idiomas).
- `node scripts/public-audit.mjs`: passou.
- `npx vitest run` completo: 457 de 463 arquivos passaram (ev-1).
  - 4 arquivos de navegador (`browser-contract`, `browser-runtime`, `browser-quit`, `browser-sites`) falham porque `@playwright/mcp` não está em `node_modules` deste worktree. É do ambiente e não tem relação com esta mudança.
  - As outras 3 falhas eram asserções em `conflict-resolve` e `runner-host-shell`; foram corrigidas, e os dois arquivos rodados de novo passaram (31/31).

## Não verificado

- A suíte completa não foi rodada de novo depois dessas duas correções.
- `electron-vite build` não foi rodado.
- A tela do log não foi aberta no app (nenhum cenário de interface rodou).
- A lista de passos autônomos não foi conferida contra o texto completo do product owner, que chegou truncado.

## Limite conhecido

Um agente `shell: host` roda como a pessoa e pode editar `auditoria.jsonl` no disco. O app detecta a alteração (`tampered`), mas não a impede.
