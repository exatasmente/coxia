# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (`enhancement`), completo, sem pergunta pendente para quem abriu nem para a pessoa. Refino: especificação funcional em `1_SPEC.md` (o que muda para quem usa, regras, fora do escopo, dez critérios de aceite).
- Prioridade sugerida (não decidida por estas etapas): `priority:medium`. Sem marco.
- Plano (`2_PLAN.md`, esta etapa): dois moldes (`commitMessage` como hoje, `prTitle` novo, padrão `{title} #{iid}`); `{iid}` obrigatório nos dois, `{summary}` e `{title}` como hoje; título montado no rascunho e na proposta; corte de 120 só sobre `{title}`; título que já traz o número não ganha de novo; `iid` 0 larga o `#` e o número; migração v12→v13 anexa ` #{iid}` a um `commitMessage` guardado sem número e cria `prTitle` quando falta; todo commit de execução de issue leva o número, inclusive o do conflito.
- O commit do conflito lê o número do **registro da ação** (`a.issue`, com `mr_iid`/`source_branch` no `unit`) e o molde de `getConfig().runner.commitMessage`, na mesma leitura de config que `mergeIdentity` já faz — sem criar caminho novo de escrita e sem mexer na porta das Ações. `mergeMessage` vira a mensagem dos commits do app com `Merge <branch>` como `{summary}`; `commitMerge` recebe a mensagem pronta; sem número, volta à mensagem de hoje (preserva o caminho do teste atual).
- Migração: o passo novo entra ao fim de `STEPS` (esquema 13) e a cadeia `while (version < CONFIG_SCHEMA_VERSION)` o alcança sozinha. Um arquivo **sem** `prTitle` ganha o padrão antes da validação (o documento chega preenchido), sem tratamento próprio; um `prTitle` **presente e inválido** é reparado pelo `repair`, que reseta só o caminho do campo.
- O `prTitle` guardado não precisa de reparo na proposta: com o registro `pr` publicado o título vai como está (a issue tira do escopo renomear pull request existente); com o registro proposto, a chave `pr:${run.id}` mantém a proposta idêntica; registro antigo sem título cai no título da issue e passa pela mesma montagem.
- `runner.prTitle` entra em `WEB_EDITABLE` e **segue o rascunho** no `runnerOfWeb`, porque a especificação exige que salvar pela tela Time no navegador funcione.

## Restrições

- Só leitura nesta etapa: nenhum teste rodado, nenhum comportamento reproduzido, nenhuma migração executada, nenhuma auditoria pública executada, nenhuma porta (`tsc`, `vitest`, `i18n:lint`, `theme-audit`) rodada. Tudo o que os documentos afirmam vem de leitura.
- O campo novo precisa entrar na lista que a tela Time pelo navegador aceita (`WEB_EDITABLE`, `src/main/configScope.ts`, espelhada em `docs/configuration.md` nos dois idiomas); fora dela, salvar no navegador é recusado.
- A regra `real-issue-number` da auditoria pública inclui o número que a issue usa nos exemplos de aceite: documento, teste, comentário, mensagem de commit ou nome de branch com ele reprova `node scripts/public-audit.mjs`. Usar número neutro (`#321`, `#456`); a lista de permissão casa por `text.includes(match)` na linha inteira e liberaria o resto da linha.
- Documentos, catálogos e testes a mover, conferidos por leitura: `docs/configuration.md:42/46/118/190/194` (listas de campos, histórico do esquema e a lista do canal, nos dois idiomas), `docs/runner.md:92/310`, `CHANGELOG.md` em `## [Unreleased]`, `ui-team.en.json`/`ui-team.pt-BR.json`, `test/runner-config.test.ts:12` e `:41`, `test/runner-units.test.ts:230`, `test/team-runner-edit.test.ts:12`, `test/config-web-scope.test.ts:44-48`, `test/config-migrations.test.ts` (fixa `schemaVersion` 12 em `:53`, `:112`, `:134`, `:208`, `:257`), `test/conflict-resolve.test.ts:257` (muda: passa a esperar o número).
- Nada nesta mudança pode criar caminho de escrita no host fora da porta das Ações; nenhum dos passos do plano cria um.

## Tentado e descartado

- Escrever a especificação com o número de exemplo da issue: descartado, reprova a auditoria pública; exemplos com número neutro.
- Levar o número e o molde do commit do conflito por um caminho novo (registro da ação ou mudança do `unit`) ou por uma coluna no clique do `select` do merge: descartado em favor de ler `a.issue` e o config em `conflictCommit`, onde a identidade já é resolvida.
- Tolerar um `prTitle` sem `{iid}` na leitura (leitura preguiçosa): descartado; o `repair` cobre o valor inválido e a migração não reescreve um campo que já existe.

## Perguntas abertas

- Nenhuma para quem abriu ou para a pessoa. Ficam para a implementação detalhes que o plano já fixou em forma geral: o texto exato das chaves novas de i18n e a palavra da mensagem da migração nos `notes`.

## Onde o trabalho está

- Etapas concluídas: `0_TRIAGE.md`, `1_SPEC.md` e `2_PLAN.md` na pasta do ciclo. A próxima etapa implementa os sete passos de `2_PLAN.md`, cada um com o seu teste.
- Leitura que a implementação herda do plano: título montado em `src/main/runner/publish.ts:673` (rascunho) e `:691`/`:696-697` (proposta), com o rascunho guardando `title` por `recordCommentDraft` (`src/shared/runs/transitions.ts:929`) e a tela lendo `run.comments.pr?.title` (`RunScreen.tsx:153`); substituição de molde em `src/main/runner/git.ts:144` (`commitMessage`, já puro, testado em `test/runner-units.test.ts:230`); validação em `src/shared/config/validate.ts:143-144` sobre o documento preenchido (`:289`); `STEPS` termina em `:263` e a cadeia em `:309-315`; `repair` em `:277-289`; linha que mostra a mensagem do commit do conflito em `src/main/actions.ts:870`; merges de release fora (`src/main/releaseGit.ts:440/471/475`); rascunho do editor em `src/renderer/src/screens/team/runnerEdit.ts:26/48/67/81/128-130` e campo em `RunnerSection.tsx:133-135`; fixtures guardados vão até o schema 4 (`test/fixtures/config-0.3.0.json`).
- Verificações pendentes para a etapa de implementação (nenhuma foi rodada aqui): `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`, build do CI.
- Passagem support → product-owner: Refino do produto (1_SPEC.md). A triagem é de um pedido de funcionalidade completo, sem pergunta pendente para quem abriu nem para a pessoa. O que a próxima etapa precisa carregar: (1) os três comportamentos da issue foram conferidos no código e continuam os mesmos — a validação só exige `{summary}` (`src/shared/config/validate.ts:143-144`), o título do rascunho e o da proposta nunca levam o número (`src/main/runner/publish.ts:673` e `:691`, com `createMr` em `:696-697`), e o commit do conflito usa `mergeMessage` sem número (`src/main/conflictGit.ts:331-340`, chamado de `src/main/actions.ts:84… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Desenho e planejamento (2_PLAN.md) a partir de 1_SPEC.md. O que a especificação fixa e o desenho não precisa reabrir: dois moldes (`commitMessage` como hoje, `prTitle` novo), os dois precisam de `{iid}`, o título é montado no rascunho e na proposta, o corte de 120 vale só para `{title}`, título que já tem o número não ganha de novo, execução sem issue larga o número e o `#`, migração anexa ` #{iid}` a um `commitMessage` guardado sem número e cria `prTitle` com o padrão. O que fica para o desenho (não é decisão da pessoa e não foi decidido aqui): (1) onde o commit do conflito da branch de execu… <!-- handoff:15 -->
