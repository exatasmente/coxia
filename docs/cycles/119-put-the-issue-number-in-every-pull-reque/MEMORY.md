# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (`enhancement`), completo, sem pergunta. Refino: `1_SPEC.md` (dez critérios). Plano: `2_PLAN.md`, sete passos. O código dos sete passos está no worktree; nada commitado (quem commita é o app).
- `runner.prTitle` no tipo, no padrão (`{title} #{iid}`) e no esquema (`minLength: 1`, `maxLength: 200`); `CONFIG_SCHEMA_VERSION` 12 → 13; `v12ToV13` ao fim de `STEPS`.
- A montagem do título é a função pura `pullRequestTitle` (`src/main/runner/git.ts`), chamada no rascunho (`publish.ts:674`); o corte de 120 vale sobre o título do agente; execução sem issue larga o `#` e o número; título do agente que já traz qualquer `#<n>` mantém a dele (a especificação aceita).
- O commit do conflito: `mergeMessage` é a base e `conflictMergeMessage` (`src/main/actions.ts:709-711`) monta com o número de `a.issue` e o molde de `getConfig()`, na leitura que `mergeIdentity` já fazia.
- `runner.prTitle` entrou em `WEB_EDITABLE`, no `runnerOfWeb`, nos dois catálogos e na `RunnerSection`.
- A regra do título que já traz o número está aceita como implementada. O `commitMessage` guardado que já tem `{iid}` não é reescrito pela migração.
- **Tentativa 2 (esta passada): correções do recado `changes`.** Aplicadas: o trecho solto de `test/runner-publish.test.ts:638-641`; as versões de esquema em `config-schema` (`:80`→14, `:109`→13), `agent-team` (`:35/:43/:266`→13), `config-transfer:182`→14, `comment-config:154`→14, `wizard-shared:114`→13; `prTitle` em `runner-config.test.ts:12`; `{crLong}` em `ui.runner.prTitle` e `ui.runner.err.prTitleIssue` (pt-BR); as cinco chaves novas reordenadas nos dois catálogos (ordem conferida por execução: os dois `SORTED`).
- Resposta: autorizo <!-- answer:318 -->

## Restrições

- A regra `real-issue-number` da auditoria pública: nenhum arquivo desta mudança escreve o número de exemplo da issue; os exemplos usam `#101`, `#456`, `#321`.
- Nada nesta mudança cria caminho de escrita no host fora da porta das Ações.
- Todo texto novo de interface usa o substantivo do host (`{crLong}`), nunca "pull request" literal no catálogo português.

## Tentado e descartado

- Levar o número e o molde do commit do conflito por um caminho novo (registro da ação, coluna no `unit`): descartado; lê `a.issue` e o config onde a identidade já era lida.
- Leitura preguiçosa de um `prTitle` sem `{iid}`: descartada; o `repair` cobre o valor presente e inválido.

## Perguntas abertas

- Nenhuma para quem abriu ou para a pessoa.

## Onde o trabalho está

- Etapas concluídas: `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e `4_REVIEW.md`.
- **Pendências do recado `changes` que ficaram sem aplicação nesta passada** (orçamento de comandos esgotou): `test/team-runner-edit.test.ts:92` (esperar `error:commitSummary` **e** `error:commitIssue` para `feat: stuff`); `src/main/runner/publish.ts:692` (montar o título pelo molde também na proposta, preservando o título já publicado); `docs/configuration.md:42` e `:190` (acrescentar `prTitle` à tabela de campos do `runner`).
- **Verificado nesta passada por execução:** validade e ordem alfabética das chaves de `src/shared/i18n/ui-team.en.json` e `ui-team.pt-BR.json` (ambos `SORTED`).
- **Não verificado nesta passada:** `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs`, `npm run i18n:lint` e o build do CI **não foram rodados**. Na revisão anterior: suíte 3647 passam / 12 falham em 10 arquivos; `public-audit`, `theme-audit` e `i18n:lint` passavam; `tsc` falhava só na sintaxe agora corrigida.
- **Não verificado (nunca):** o build do CI; uma execução de verdade abrindo pull request; a tela num navegador pareado de verdade; o commit do conflito reproduzido à mão; nenhuma migração sobre arquivo real.
- Passagem developer → revisor-plataforma: refazer a revisão. O que precisa ser conferido primeiro é o que ficou sem rodar: `tsc`, a suíte, `theme-audit`, `public-audit`, `i18n:lint` e o build; e fechar os três pontos listados acima.
- Passagem tl-plataforma → pessoa: Implementação de `2_PLAN.md` (sete passos, um commit cada). O que o plano já decidiu e a implementação não reabre: (1) `runner.prTitle` entra em `types.ts`, `defaults.ts` (`{title} #{iid}`) e `schema.ts` (`minLength: 1`, `maxLength: 200`), e o esquema vai a 13 com um passo **v12→v13** ao fim de `STEPS`; (2) a validação exige `{iid}` nos dois moldes; (3) o título é montado no rascunho e na proposta; (4) o commit do conflito lê `a.issue` e o config; (5) o campo novo na tela Time e nos dois catálogos; (6) `WEB_EDITABLE` e a documentação; (7) `docs/runner.md` e o `CHANGELOG.md`. <!-- handoff:24 -->
- Passagem support → product-owner: Refino do produto (1_SPEC.md). A triagem é de um pedido de funcionalidade completo, sem pergunta pendente para quem abriu nem para a pessoa. O que a próxima etapa precisa carregar: (1) os três comportamentos da issue foram conferidos no código e continuam os mesmos — a validação só exige `{summary}` (`src/shared/config/validate.ts:143-144`), o título do rascunho e o da proposta nunca levam o número (`src/main/runner/publish.ts:673` e `:691`, com `createMr` em `:696-697`), e o commit do conflito usa `mergeMessage` sem número (`src/main/conflictGit.ts:331-340`, chamado de `src/main/actions.ts:84… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Desenho e planejamento (2_PLAN.md) a partir de 1_SPEC.md. O que a especificação fixa e o desenho não precisa reabrir: dois moldes (`commitMessage` como hoje, `prTitle` novo), os dois precisam de `{iid}`, o título é montado no rascunho e na proposta, o corte de 120 vale só para `{title}`, título que já tem o número não ganha de novo, execução sem issue larga o número e o `#`, migração anexa ` #{iid}` a um `commitMessage` guardado sem número e cria `prTitle` com o padrão. O que fica para o desenho (não é decisão da pessoa e não foi decidido aqui): (1) onde o commit do conflito da branch de execu… <!-- handoff:15 -->
- Passagem developer → revisor-plataforma: Revisão da implementação de `2_PLAN.md`: os sete passos entraram no worktree. O que precisa ser conferido primeiro é o que esta etapa não conseguiu rodar: `npx vitest run` completo, `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs` e o build do CI. Os três arquivos de teste que não foram reconferidos depois das últimas edições são `test/runner-publish.test.ts` (título `Add the thing #101` na proposta), `test/conflict-resolve.test.ts` (mensagem do merge com `#15526`) e `test/config-migrations.test.ts` (o passo v12→v13, incluindo o `toEqual` do documento inteiro). Foram rodados com… <!-- handoff:289 -->
- Passagem revisor-plataforma → developer: A entrega tem o comportamento central de pé — a montagem do título pelos dois moldes, o `{iid}` obrigatório na validação, a migração v12→v13, o número no commit do conflito e o campo aceito pela tela Time no navegador foram exercitados nesta etapa —, mas o veredito é "changes": seis arquivos de teste ficaram sem acompanhar a mudança e derrubam o `tsc` e a suíte, dois textos novos da interface dizem "pull request" no catálogo português (a auditoria de termos entre hosts falha), e as chaves novas ficaram fora da ordem alfabética exigida pelos catálogos. Nada disso é caminho de escrita no host: a… <!-- handoff:365 -->
