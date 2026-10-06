# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (`enhancement`), completo, sem pergunta. Refino: `1_SPEC.md` (dez critérios). Plano: `2_PLAN.md`, sete passos. O código dos sete passos está no worktree; nada commitado (quem commita é o app).
- `runner.prTitle` no tipo, no padrão (`{title} #{iid}`) e no esquema (`minLength: 1`, `maxLength: 200`); `CONFIG_SCHEMA_VERSION` 12 → 13; `v12ToV13` ao fim de `STEPS`.
- A montagem do título é a função pura `pullRequestTitle` (`src/main/runner/git.ts`), chamada no rascunho (`publish.ts:674`) e na proposta (`publish.ts:692`); o corte de 120 vale sobre o título do agente; execução sem issue larga o `#` e o número; título do agente que já traz qualquer `#<n>` mantém a dele (a especificação aceita).
- O commit do conflito: `conflictMergeMessage` (`src/main/actions.ts:709-711`) monta com o número de `a.issue` e o molde de `getConfig().runner.commitMessage`, na leitura que `mergeIdentity` já fazia; sem número, a mensagem de base continua `Merge <branch>`.
- `runner.prTitle` entrou em `WEB_EDITABLE`, no `runnerOfWeb`, nos dois catálogos e na `RunnerSection`.
- O `commitMessage` guardado que já tem `{iid}` não é reescrito pela migração.
- **Tentativa 3 (esta passada): os achados de texto, catálogo, documentação e compilação foram fechados.** Fechados: o trecho solto de `test/runner-publish.test.ts`; as duas chaves pt-BR que diziam a palavra de outro host; a ordem alfabética das cinco chaves nos dois catálogos; `docs/configuration.md` com `prTitle` nos dois idiomas; `config-web-scope` cobrindo o campo novo; `runner-publish.test.ts:532/537` com `Add the thing #101`.
- Resposta: autorizo <!-- answer:318 -->

## Restrições

- A regra `real-issue-number` da auditoria pública: nenhum arquivo desta mudança escreve o número de exemplo da issue; os exemplos usam `#101`, `#456`, `#321`.
- Nada nesta mudança cria caminho de escrita no host fora da porta das Ações.
- Todo texto novo de interface usa o substantivo do host (`{crLong}`), nunca "pull request" literal no catálogo português.
- Uma versão de esquema citada num teste precisa acompanhar `CONFIG_SCHEMA_VERSION`; a versão anterior é recusada como "de um app mais novo".

## Tentado e descartado

- Levar o número e o molde do commit do conflito por um caminho novo (registro da ação, coluna no `unit`): descartado; lê `a.issue` e o config onde a identidade já era lida.
- Leitura preguiçosa de um `prTitle` sem `{iid}`: descartada; o `repair` cobre o valor presente e inválido.

## Perguntas abertas

- Nenhuma para quem abriu ou para a pessoa.

## Onde o trabalho está

- Etapas concluídas: `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e `4_REVIEW.md` (revisão em andamento, veredito "changes").
- **Verificado nesta passada por execução:** `npx tsc --noEmit` passa limpo; a árvore inteira menos quatro arquivos dá 3591 testes passando e nenhuma falha; `node scripts/public-audit.mjs` (911 arquivos limpos), `npm run i18n:lint` (4059 chaves nos dois idiomas), `node scripts/theme-audit.mjs` e `npx electron-vite build` (1 min 9 s) passam. A função `pullRequestTitle` foi exercitada à parte: padrão, `#{iid} {title}`, título que já traz `#456`, execução sem issue e título de 200 caracteres cortado em 120 terminando em `#7`.
- **Cinco achados abertos no veredito "changes":** (1) `test/agent-team.test.ts:43` e `:266` ainda com a versão de esquema anterior (a correção pegou só a linha 35) — 2 falhas; (2) `test/config-schema.test.ts:80` testa a recusa de esquema mais novo com a versão corrente; (3) `test/runner-config.test.ts:12` compara o objeto do padrão sem `prTitle`; (4) `test/team-runner-edit.test.ts:92` espera só a recusa do resumo para `feat: stuff` (pedido pelo nome e ainda não aplicado); (5) `src/main/runner/publish.ts:692` monta o título a partir do registro guardado, que pode ser nulo num registro antigo sem título, e um título vazio não é rejeitado pela validação, então a montagem falha em vez de cair no título da issue. Quatro arquivos vermelhos, 79 passando e 5 falhando neles.
- **Não verificado (nunca):** uma execução real abrindo pull request; a tela num navegador pareado de verdade; o commit do conflito reproduzido à mão; nenhuma migração sobre o arquivo de configuração de um espaço de trabalho real.
- Passagem revisor-plataforma → developer: fechar os cinco achados e repetir as portas; o build e a suíte inteira já passam fora dos quatro arquivos.
- Passagem developer → revisor-plataforma (rodada anterior): o comportamento central de pé, mas seis arquivos de teste sem acompanhar, dois textos de interface e a ordem dos catálogos — os três últimos fechados nesta passada. <!-- handoff:365 -->
- Passagem developer → revisor-plataforma: Fechar os achados que ficaram sem aplicação antes de nova revisão: (1) `test/team-runner-edit.test.ts:92` precisa esperar as duas mensagens (`error:commitSummary` e `error:commitIssue`) para `feat: stuff`; (2) `src/main/runner/publish.ts:692` deve montar o título pelo molde também na proposta, preservando o caso de um título já publicado, para um registro `pr` antigo sem `title` não abrir a pull request sem número; (3) acrescentar `runner.prTitle` à tabela de campos do `runner` em `docs/configuration.md:42` e na gêmea em inglês em `:190`. Depois, rodar as portas de verdade: `npx tsc --noEmit`,… <!-- handoff:372 -->
- Passagem tl-plataforma → pessoa: Implementação de `2_PLAN.md` (sete passos, um commit cada). O que o plano já decidiu e a implementação não reabre: (1) `runner.prTitle` entra em `types.ts`, `defaults.ts` (`{title} #{iid}`) e `schema.ts` (`minLength: 1`, `maxLength: 200`), e o esquema vai a 13 com um passo **v12→v13** ao fim de `STEPS`; (2) a validação exige `{iid}` nos dois moldes; (3) o título é montado no rascunho e na proposta; (4) o commit do conflito lê `a.issue` e o config; (5) o campo novo na tela Time e nos dois catálogos; (6) `WEB_EDITABLE` e a documentação; (7) `docs/runner.md` e o `CHANGELOG.md`. <!-- handoff:24 -->
- Passagem support → product-owner: Refino do produto (1_SPEC.md). A triagem é de um pedido de funcionalidade completo, sem pergunta pendente para quem abriu nem para a pessoa. O que a próxima etapa precisa carregar: (1) os três comportamentos da issue foram conferidos no código e continuam os mesmos — a validação só exige `{summary}` (`src/shared/config/validate.ts:143-144`), o título do rascunho e o da proposta nunca levam o número (`src/main/runner/publish.ts:673` e `:691`, com `createMr` em `:696-697`), e o commit do conflito usa `mergeMessage` sem número (`src/main/conflictGit.ts:331-340`, chamado de `src/main/actions.ts:84… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Desenho e planejamento (2_PLAN.md) a partir de 1_SPEC.md. O que a especificação fixa e o desenho não precisa reabrir: dois moldes (`commitMessage` como hoje, `prTitle` novo), os dois precisam de `{iid}`, o título é montado no rascunho e na proposta, o corte de 120 vale só para `{title}`, título que já tem o número não ganha de novo, execução sem issue larga o número e o `#`, migração anexa ` #{iid}` a um `commitMessage` guardado sem número e cria `prTitle` com o padrão. O que fica para o desenho (não é decisão da pessoa e não foi decidido aqui): (1) onde o commit do conflito da branch de execu… <!-- handoff:15 -->
- Passagem developer → revisor-plataforma: Revisão da implementação de `2_PLAN.md`: os sete passos entraram no worktree. O que precisa ser conferido primeiro é o que esta etapa não conseguiu rodar: `npx vitest run` completo, `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs` e o build do CI. Os três arquivos de teste que não foram reconferidos depois das últimas edições são `test/runner-publish.test.ts` (título `Add the thing #101` na proposta), `test/conflict-resolve.test.ts` (mensagem do merge com `#15526`) e `test/config-migrations.test.ts` (o passo v12→v13, incluindo o `toEqual` do documento inteiro). Foram rodados com… <!-- handoff:289 -->
