# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (`enhancement`), completo, sem pergunta para quem abriu nem para a pessoa. Refino: `1_SPEC.md` (dez critérios de aceite). Plano: `2_PLAN.md`, sete passos, um commit cada.
- Implementação (esta etapa): os sete passos entraram. `runner.prTitle` no tipo, no padrão (`{title} #{iid}`) e no esquema (`minLength: 1`, `maxLength: 200`); `CONFIG_SCHEMA_VERSION` 12 → 13; `v12ToV13` ao fim de `STEPS` anexa ` #{iid}` a um `commitMessage` guardado sem número e cria `prTitle` quando falta.
- A montagem do título é a função pura `pullRequestTitle` em `src/main/runner/git.ts`, chamada no rascunho e na proposta (`src/main/runner/publish.ts`). O corte de 120 vale sobre o título do agente; execução sem issue larga o `#` e o número (e uma casca vazia tipo `()` junto).
- **A regra do título que já traz o número ficou mais estrita que a letra do plano**: se o título do agente tem qualquer referência `#<n>`, o molde inteiro larga o `{iid}` (não acrescenta nada). Foi o que o teste fixou. A revisão deve conferir se é o comportamento aceito.
- O commit do conflito: `mergeMessage` continua a base; `commitMerge` recebe a mensagem pronta; `conflictMergeMessage` (`src/main/actions.ts`) monta com o número de `a.issue` e o molde de `getConfig().runner.commitMessage`, na leitura de config que `mergeIdentity` já fazia. Sem número, volta à mensagem de hoje.
- `runner.prTitle` entrou em `WEB_EDITABLE` e segue o rascunho no `runnerOfWeb`; o campo e as três chaves de recusa entraram nos dois catálogos e na `RunnerSection`.

## Restrições

- A regra `real-issue-number` da auditoria pública: nenhum arquivo desta mudança escreve o número de exemplo da issue; os exemplos usam `#101`, `#456`, `#321` (todos neutros, já usados no repositório).
- Nada nesta mudança cria caminho de escrita no host fora da porta das Ações.

## Tentado e descartado

- Levar o número e o molde do commit do conflito por um caminho novo (registro da ação, coluna no `unit`): descartado; lê `a.issue` e o config onde a identidade já era lida.
- A primeira redação de `pullRequestTitle` decidia pelo número exato da issue e reescrevia o título guardado; duas iterações de teste mostraram que o correto é olhar qualquer referência `#<n>` do título e, nesse caso, largar o `{iid}` do molde.
- A leitura preguiçosa de um `prTitle` sem `{iid}`: descartada; o `repair` cobre o valor presente e inválido e a migração não reescreve um campo que já existe.

## Perguntas abertas

- Nenhuma para quem abriu ou para a pessoa.

## Onde o trabalho está

- Etapas concluídas: `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md` e `3_IMPLEMENTATION.md`. O código está no worktree, sem commit: quem commita é o app.
- **Verificado nesta etapa**: `npx tsc --noEmit` limpo; `npx vitest run test/runner-units.test.ts` 29/29; `npm run i18n:lint` limpo (4059 chaves nos dois idiomas). A primeira suíte completa falhou em 32 testes (schemaVersion 12 espalhado, campo novo em objetos fixos, chaves de i18n que faltavam no pt-BR — refeitas).
- **Não verificado**: a suíte completa depois das correções finais (o orçamento de comandos acabou), `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs` e o build do CI. `test/runner-publish.test.ts`, `test/conflict-resolve.test.ts` e `test/config-migrations.test.ts` não foram reconferidos depois das últimas edições.
- A revisão deve começar por rodar essas quatro portas e reconferir esses três arquivos.
- Passagem support → product-owner: Refino do produto (1_SPEC.md). A triagem é de um pedido de funcionalidade completo, sem pergunta pendente para quem abriu nem para a pessoa. O que a próxima etapa precisa carregar: (1) os três comportamentos da issue foram conferidos no código e continuam os mesmos — a validação só exige `{summary}` (`src/shared/config/validate.ts:143-144`), o título do rascunho e o da proposta nunca levam o número (`src/main/runner/publish.ts:673` e `:691`, com `createMr` em `:696-697`), e o commit do conflito usa `mergeMessage` sem número (`src/main/conflictGit.ts:331-340`, chamado de `src/main/actions.ts:84… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Desenho e planejamento (2_PLAN.md) a partir de 1_SPEC.md. O que a especificação fixa e o desenho não precisa reabrir: dois moldes (`commitMessage` como hoje, `prTitle` novo), os dois precisam de `{iid}`, o título é montado no rascunho e na proposta, o corte de 120 vale só para `{title}`, título que já tem o número não ganha de novo, execução sem issue larga o número e o `#`, migração anexa ` #{iid}` a um `commitMessage` guardado sem número e cria `prTitle` com o padrão. O que fica para o desenho (não é decisão da pessoa e não foi decidido aqui): (1) onde o commit do conflito da branch de execu… <!-- handoff:15 -->
- Passagem tl-plataforma → pessoa: Implementação de `2_PLAN.md`, na ordem dos sete passos (um commit cada, com o teste no mesmo commit). O que o plano já decidiu e a implementação não precisa reabrir: (1) `runner.prTitle` entra em `types.ts`, `defaults.ts` (`{title} #{iid}`) e `schema.ts` (`minLength: 1`, `maxLength: 200`), e o esquema vai a 13 com um passo **v12→v13** ao fim de `STEPS` que anexa ` #{iid}` a um `commitMessage` guardado sem `{iid}` e cria `prTitle` quando falta (nunca quando já existe, para o `repair` cuidar de um valor presente e inválido); (2) a validação ganha `{iid}` obrigatório nos dois moldes em `runnerRul… <!-- handoff:24 -->
