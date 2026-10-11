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
  - a resposta a um comando no host (`askCommand`) e o portão decidido por alguém gravam `decision`, sem `policy`.
- **Mudança de política** (`src/main/workspaceConfig.ts`): `saveConfig(next, by = 'person')` grava uma linha `policy-change` por escolha alterada (nível, fluxo, escolha, antes, depois). A primeira carga não grava nada. `updateConfig` repassa `by`.
- **Tela do log** (`Auditoria.tsx`): mostra os três tipos novos, "por {agente}", a política em vigor (escolhas ligadas e nível) e a marca "Alterado depois de escrito". Os textos novos estão nos dois catálogos, e o nome do pull request usa o termo do host (`{crLong}`).
- **CHANGELOG** `Unreleased` › Added.

## Nesta tentativa: base trazida da release

- Com a autorização da pessoa, `origin/release/0.11.0` (160 commits à frente) foi mesclada pelo shell com `git merge --no-commit --no-ff`. A mescla fica aberta e o commit de merge sai no commit da etapa, feito pelo app. Não houve rebase, push nem commit pelo shell.
- Conflitos resolvidos somando os dois lados:
  - `src/shared/auditoria.ts`: os tipos da release (`turn-limit`, `persona`, `config`, `secret`, `plugin-decision`, `act`, `Through`) somados aos três novos; os campos `actor`, `door`, `id`, `said`, `basis` e `proposedBy` somados a `policy`, `chain` e `tampered`;
  - `src/main/auditoria.ts`: `recordWrite` tira primeiro `chain` e `tampered` do chamador, depois aplica o carimbo do ato da persona e a máscara dele; a cadeia é calculada sobre a linha já carimbada;
  - `src/main/actions.ts`: `AuditOrigin` e `audited` levam `policy` e `proposedBy`;
  - `src/main/runner/executor.ts`: os dois imports somados (`auditPolicyOf`, `personaIdsOf`);
  - `Auditoria.tsx`: os tipos e o filtro "Quem" da release somados aos tipos e à política desta mudança; a marca de alteração fica ao lado do selo da persona;
  - `ui-today.en.json` e `ui-today.pt-BR.json`: chaves dos dois lados, em ordem;
  - `CHANGELOG.md`: o arquivo da release, com a linha desta mudança em `[Unreleased]` › Added (a release já tinha cortado as versões 0.10.0 a 0.11.0-beta.3).
- **Correção que a mescla expôs.** O teste da release `persona-worded` achou `by: 'person'` fixo em `actions.ts`: a persona pode aprovar ou recusar em Ações, e a linha `decision` dizia que foi a pessoa. Agora:
  - `recordDecision` grava `by: 'persona'` quando um ato da persona está aberto e `PERSON_WHO.by` quando não está;
  - o portão decidido (`gateBy`) grava `who.by`, e não mais `'person'` fixo.
- **Filtro "Quem"** (`src/renderer/src/auditModel.ts` `whoOf`): `by: 'person'` (decisões e mudanças de política) conta como da pessoa e `by: 'persona'` como da persona. Antes, as duas apareciam como "um agente".

## Diferenças em relação ao plano

- A aprovação grava a decisão antes da escrita e com `ok: true`; o resultado fica só na linha da escrita.
- O início de etapa também é gravado quando a etapa é autônoma pelo interruptor do próprio agente, com `cycle: false` na política.
- `mentions/propose.ts` ficou sem `policy`, como os plugins (decisão 3).
- Quem decidiu um passo retido pode ser a persona (veio com a release); a linha diz `persona`, e não `person`.

## Testes

- `test/audit-policy.test.ts` (novo): política gravada e cadeia; linha editada, removida ou forjada é marcada; linha antiga é lida sem marca; token fora do log; um só canal, `auditoria:list`, que não altera o arquivo; mudança no workspace e depois num fluxo, uma linha por escolha.
- `test/autonomy.test.ts`: `levelOf` e `auditPolicyOf`.
- `test/actions-group.test.ts`: aprovação grava `decision` antes da escrita; recusa grava `refused` e não executa; **novo nesta tentativa**: a recusa feita dentro de um ato da persona grava `by: persona` e `actor: persona`.
- `test/audit-model.test.ts` (**nesta tentativa**): decisão e mudança de política com `by: person` contam como da pessoa; `by: persona` conta como da persona.
- `test/runner-host-shell.test.ts`, `test/runner-publish.test.ts`, `test/board-host.test.ts`: passos autônomos com política e nível; decisões da pessoa sem `policy`.
- `test/helpers/audit.ts` (novo): `writesOf` e `autonomyLines`.

## Verificação (nesta tentativa, depois da mescla, ev-7)

- `npx tsc --noEmit`: saída 0, rodado depois da última edição.
- `npx vitest run` (com `out/` apagado antes): 530 de 534 arquivos e 8762 testes passaram, 15 ignorados.
  - Falham 4 arquivos de navegador (`browser-contract`, `browser-runtime`, `browser-quit`, `browser-sites`) com `Cannot find module '@playwright/mcp/package.json'`: o pacote não está em `node_modules`. Isso é do ambiente.
  - Na primeira rodada falhou também `persona-worded`; a correção acima o resolveu.
- Os 6 arquivos tocados (`actions-group`, `audit-model`, `persona-worded`, `audit-policy`, `runner-host-shell`, `persona-audit`) também foram rodados isolados: 98/98.
- `node scripts/theme-audit.mjs`: saída 0.
- `npm run i18n:lint`: saída 0, 6174 chaves nos dois idiomas.
- `node scripts/public-audit.mjs`: saída 0, 1935 arquivos.
- `npx electron-vite build`: saída 0; `out/` apagado depois.

## Não verificado

- O commit de merge: a mescla está aberta (`MERGE_HEAD`), e o commit é do app. Que a branch fique em dia com a release depende desse commit.
- A tela do log não foi aberta no app; nenhum cenário de interface rodou.
- Os 4 testes de navegador (sem `@playwright/mcp`).
- `askCommand` em `service.ts` continua gravando `by: 'person'`. Não ficou claro se a persona alcança essa resposta, e isso não foi conferido.
- Pull requests abertos para a release e se a #269 já mesclou nela: não consultados.
- A lista de passos autônomos contra o texto completo do product owner, que chegou truncado.

## Limite conhecido

Um agente `shell: host` roda como a pessoa e pode editar `auditoria.jsonl` no disco. O app detecta a alteração (`tampered`), mas não a impede.
