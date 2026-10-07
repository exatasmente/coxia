# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (`enhancement`), completo, sem pergunta. Refino: `1_SPEC.md` (dez critérios). Plano: `2_PLAN.md`, sete passos. O código dos sete passos está no worktree e commitado; a revisão aprovou.
- `runner.prTitle` no tipo, no padrão (`{title} #{iid}`) e no esquema (`minLength: 1`, `maxLength: 200`); `CONFIG_SCHEMA_VERSION` 12 → 13; `v12ToV13` ao fim de `STEPS`.
- A montagem do título é a função pura `pullRequestTitle` (`src/main/runner/git.ts`), chamada no rascunho (`publish.ts:674`) e na proposta (`publish.ts:692`); o corte de 120 vale sobre o título do agente; execução sem issue larga o `#` e o número; título do agente que já traz qualquer `#<n>` mantém a dele.
- O commit do conflito: `conflictMergeMessage` (`src/main/actions.ts:709-711`) monta com o número de `a.issue` e o molde de `getConfig().runner.commitMessage`; sem número, a mensagem de base continua `Merge <branch>`.
- `runner.prTitle` entrou em `WEB_EDITABLE`, no `runnerOfWeb`, nos dois catálogos, na `RunnerSection` e na tabela de campos do `runner` em `docs/configuration.md` (`:118`, `:190`, `:266`), nos dois idiomas.
- O `commitMessage` guardado que já tem `{iid}` não é reescrito pela migração.
- A revisão aprovou na terceira rodada: os cinco achados anteriores foram corrigidos e confirmados por execução.
- Resposta: autorizo <!-- answer:318 -->
- Resposta: Volta para o dev <!-- answer:443 -->

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

- Etapas concluídas: `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e `4_REVIEW.md` (revisão aprovada).
- **Verificado nesta passada por execução:** `npx tsc --noEmit` limpo; `npx vitest run` com 3676 passando e nenhuma falha (a falha de `test/update-script.test.ts` da passada anterior não reproduz; sozinho, passa 12/12); os nove arquivos de configuração, runner e conflito com 200 passando; `node scripts/public-audit.mjs` (911 arquivos), `npm run i18n:lint` (4059 chaves nos dois idiomas), `node scripts/theme-audit.mjs` e `npx electron-vite build` (1 min 14 s) passam.
- **Sem achados abertos:** os cinco do veredito anterior foram fechados e confirmados; nenhum achado novo nesta rodada.
- **Não verificado (nunca):** uma execução real abrindo pull request; a tela num navegador pareado de verdade; o commit do conflito reproduzido à mão; nenhuma migração sobre o arquivo de configuração de um espaço de trabalho real.
- Passagem revisor-plataforma → pessoa: revisão aprovada; o ciclo pode seguir para o commit e a abertura da pull request. <!-- handoff:476 -->
- Passagem developer → revisor-plataforma: fechar os cinco achados e repetir as portas — feito e aprovado. <!-- handoff:475 -->
- Passagem developer → revisor-plataforma (rodada anterior): o comportamento central de pé, mas seis arquivos de teste sem acompanhar, dois textos de interface e a ordem dos catálogos — fechados. <!-- handoff:365 -->
- Passagem tl-plataforma → pessoa: Implementação de `2_PLAN.md` (sete passos, um commit cada). <!-- handoff:24 -->
- Passagem support → product-owner: Refino do produto (1_SPEC.md). <!-- handoff:6 -->
- Passagem product-owner → pessoa: Desenho e planejamento (2_PLAN.md) a partir de 1_SPEC.md. <!-- handoff:15 -->
- Passagem pessoa → developer: Volta para o dev <!-- handoff:444 -->
- Passagem developer → revisor-plataforma: Revisão da implementação de `2_PLAN.md`: os sete passos entraram no worktree. O que precisa ser conferido primeiro é o que esta etapa não conseguiu rodar: `npx vitest run` completo, `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs` e o build do CI. Os três arquivos de teste que não foram reconferidos depois das últimas edições são `test/runner-publish.test.ts` (título `Add the thing #101` na proposta), `test/conflict-resolve.test.ts` (mensagem do merge com `#15526`) e `test/config-migrations.test.ts` (o passo v12→v13, incluindo o `toEqual` do documento inteiro). Foram rodados com… <!-- handoff:289 -->
- Passagem developer → revisor-plataforma: Fechar os achados que ficaram sem aplicação antes de nova revisão: (1) `test/team-runner-edit.test.ts:92` precisa esperar as duas mensagens (`error:commitSummary` e `error:commitIssue`) para `feat: stuff`; (2) `src/main/runner/publish.ts:692` deve montar o título pelo molde também na proposta, preservando o caso de um título já publicado, para um registro `pr` antigo sem `title` não abrir a pull request sem número; (3) acrescentar `runner.prTitle` à tabela de campos do `runner` em `docs/configuration.md:42` e na gêmea em inglês em `:190`. Depois, rodar as portas de verdade: `npx tsc --noEmit`,… <!-- handoff:372 -->
