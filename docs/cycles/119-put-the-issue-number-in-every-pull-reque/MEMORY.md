# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (`enhancement`), completo, sem pergunta para quem abriu nem para a pessoa. Refino: `1_SPEC.md` (dez critérios de aceite). Plano: `2_PLAN.md`, sete passos. Implementação: os sete passos entraram; o código está no worktree, sem commit (quem commita é o app).
- `runner.prTitle` no tipo, no padrão (`{title} #{iid}`) e no esquema (`minLength: 1`, `maxLength: 200`); `CONFIG_SCHEMA_VERSION` 12 → 13; `v12ToV13` ao fim de `STEPS`.
- A montagem do título é a função pura `pullRequestTitle` (`src/main/runner/git.ts`), chamada no rascunho (`src/main/runner/publish.ts:674`); o corte de 120 vale sobre o título do agente; execução sem issue larga o `#` e o número; título do agente que já traz qualquer `#<n>` mantém a dele (a especificação aceita).
- O commit do conflito: `mergeMessage` é a base e `conflictMergeMessage` (`src/main/actions.ts:709-711`) monta com o número de `a.issue` e o molde de `getConfig()`, na leitura que `mergeIdentity` já fazia.
- `runner.prTitle` entrou em `WEB_EDITABLE`, no `runnerOfWeb`, nos dois catálogos e na `RunnerSection`.
- **Revisão (esta etapa): veredito `changes`**, oito achados. O comportamento central está de pé e foi exercitado; o que impede é a suíte vermelha.
- A regra do título que já traz o número está aceita como implementada. O `commitMessage` guardado que já tem `{iid}` não deve ser reescrito pela migração.
- Resposta: autorizo <!-- answer:318 -->

## Restrições

- A regra `real-issue-number` da auditoria pública: nenhum arquivo desta mudança escreve o número de exemplo da issue; os exemplos usam `#101`, `#456`, `#321`.
- Nada nesta mudança cria caminho de escrita no host fora da porta das Ações. Fronteira de segurança confirmada por leitura do diff.
- Todo texto de interface novo usa o substantivo do host (`{crLong}`), nunca \"pull request\" literal no catálogo português.

## Tentado e descartado

- Levar o número e o molde do commit do conflito por um caminho novo (registro da ação, coluna no `unit`): descartado; lê `a.issue` e o config onde a identidade já era lida.
- Leitura preguiçosa de um `prTitle` sem `{iid}`: descartada; o `repair` cobre o valor presente e inválido.

## Perguntas abertas

- Nenhuma para quem abriu ou para a pessoa. A via `Next` está fechada e não há rótulo `Next`.

## Onde o trabalho está

- Etapas concluídas: `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e `4_REVIEW.md`.
- **Verificado na revisão**, rodando: `npx vitest run` completo roda em ~112 s nesta máquina — **3647 passam, 12 falham** em 10 arquivos; `node scripts/public-audit.mjs`, `node scripts/theme-audit.mjs` e `npm run i18n:lint` passam; `npx tsc --noEmit` falha só por sintaxe em `test/runner-publish.test.ts:638-641`. Verdes inteiros: `runner-units` (29), `config-migrations` (28), `conflict-resolve` (22), `config-web-scope` (20), `runner-lifecycle` (52), `runner-e2e`.
- **As 12 falhas são todas de teste, não de comportamento**, e a correção é mecânica: `schemaVersion: 12` → 13 em `test/config-schema.test.ts:109`, `test/agent-team.test.ts:35/:43/:266`, `test/config-transfer.test.ts:182`, `test/wizard-shared.test.ts:114`; `13` → `14` nas recusas de app mais novo de `test/config-schema.test.ts:80` e `test/comment-config.test.ts:154`; `prTitle` no objeto de `test/runner-config.test.ts:12`; a segunda recusa em `test/team-runner-edit.test.ts:92`; `{crLong}` nas duas chaves novas de `src/shared/i18n/ui-team.pt-BR.json:189/:203` (a verificação entre hosts falha por causa delas); reordenar as cinco chaves novas nos dois catálogos (`test/ui-i18n.test.ts`); `prTitle` nas listas de `docs/configuration.md:42` e `:190` (e as gêmeas em português).
- Achado de desenho em aberto: a proposta usa o título guardado (`publish.ts:692`), não o molde — um registro `pr` antigo, sem `title`, abriria sem número. Precisa de uma decisão sobre montar o título também na proposta, preservando o caso de um título já publicado.
- **Não verificado**: o build do CI; uma execução de verdade abrindo pull request; a tela num navegador pareado de verdade; o commit do conflito reproduzido à mão; nenhuma migração sobre um arquivo real.
- Passagem revisor-plataforma → developer: as oito correções do `4_REVIEW.md`, com os arquivos e linhas já localizados (ver a memória acima), e as portas a rodar de novo depois.
- Passagem support → product-owner: Refino do produto (1_SPEC.md). A triagem é de um pedido de funcionalidade completo, sem pergunta pendente para quem abriu nem para a pessoa. O que a próxima etapa precisa carregar: (1) os três comportamentos da issue foram conferidos no código e continuam os mesmos — a validação só exige `{summary}` (`src/shared/config/validate.ts:143-144`), o título do rascunho e o da proposta nunca levam o número (`src/main/runner/publish.ts:673` e `:691`, com `createMr` em `:696-697`), e o commit do conflito usa `mergeMessage` sem número (`src/main/conflictGit.ts:331-340`, chamado de `src/main/actions.ts:84… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Desenho e planejamento (2_PLAN.md) a partir de 1_SPEC.md. O que a especificação fixa e o desenho não precisa reabrir: dois moldes (`commitMessage` como hoje, `prTitle` novo), os dois precisam de `{iid}`, o título é montado no rascunho e na proposta, o corte de 120 vale só para `{title}`, título que já tem o número não ganha de novo, execução sem issue larga o número e o `#`, migração anexa ` #{iid}` a um `commitMessage` guardado sem número e cria `prTitle` com o padrão. O que fica para o desenho (não é decisão da pessoa e não foi decidido aqui): (1) onde o commit do conflito da branch de execu… <!-- handoff:15 -->
- Passagem tl-plataforma → pessoa: Implementação de `2_PLAN.md`, na ordem dos sete passos (um commit cada, com o teste no mesmo commit). O que o plano já decidiu e a implementação não precisa reabrir: (1) `runner.prTitle` entra em `types.ts`, `defaults.ts` (`{title} #{iid}`) e `schema.ts` (`minLength: 1`, `maxLength: 200`), e o esquema vai a 13 com um passo **v12→v13** ao fim de `STEPS` que anexa ` #{iid}` a um `commitMessage` guardado sem `{iid}` e cria `prTitle` quando falta (nunca quando já existe, para o `repair` cuidar de um valor presente e inválido); (2) a validação ganha `{iid}` obrigatório nos dois moldes em `runnerRul… <!-- handoff:24 -->
- Passagem developer → revisor-plataforma: Revisão da implementação de `2_PLAN.md`: os sete passos entraram no worktree. O que precisa ser conferido primeiro é o que esta etapa não conseguiu rodar: `npx vitest run` completo, `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs` e o build do CI. Os três arquivos de teste que não foram reconferidos depois das últimas edições são `test/runner-publish.test.ts` (título `Add the thing #101` na proposta), `test/conflict-resolve.test.ts` (mensagem do merge com `#15526`) e `test/config-migrations.test.ts` (o passo v12→v13, incluindo o `toEqual` do documento inteiro). Foram rodados com… <!-- handoff:289 -->
