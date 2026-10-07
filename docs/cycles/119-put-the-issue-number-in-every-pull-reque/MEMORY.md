# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (`enhancement`), completo, sem pergunta. Refino: `1_SPEC.md` (dez critérios). Plano: `2_PLAN.md`, sete passos. O código está no worktree e commitado (`f71b53a`, `490fe91`); a revisão aprovou.
- `runner.prTitle` no tipo, no padrão (`{title} #{iid}`) e no esquema (`minLength: 1`, `maxLength: 200`); `CONFIG_SCHEMA_VERSION` 12 → 13; `v12ToV13` ao fim de `STEPS`.
- A montagem do título é a função pura `pullRequestTitle` (`src/main/runner/git.ts`), chamada no rascunho (`publish.ts:674`) e na proposta (`publish.ts:692`); o corte de 120 vale sobre o título do agente; execução sem issue larga o `#` e o número; título do agente que já traz qualquer `#<n>` mantém a dele.
- O commit do conflito: `conflictMergeMessage` (`src/main/actions.ts:709-711`) monta com o número de `a.issue` e o molde de `getConfig().runner.commitMessage`; sem número, a mensagem de base continua `Merge <branch>`; os merges de release (`releaseGit.ts`) ficam intocados.
- `runner.prTitle` entrou em `WEB_EDITABLE`, no `runnerOfWeb`, nos dois catálogos, na `RunnerSection` e na tabela de campos e no histórico do `runner` em `docs/configuration.md`, nos dois idiomas.
- O `commitMessage` guardado que já tem `{iid}` não é reescrito pela migração.
- QA: aprovado por execução; a mudança atende aos dez critérios de aceite.
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
- Roteiro de caixa preta importando `actions.ts` fora do app: descartado; `actions.ts` puxa o electron. O roteiro cobre o conflito pela função pura do molde de commit.

## Perguntas abertas

- Nenhuma para quem abriu ou para a pessoa.

## Onde o trabalho está

- Etapas concluídas: `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md`, `4_REVIEW.md` (aprovada) e `5_TEST_PLAN.md`.
- **Verificado pela QA por execução:** os oito arquivos de teste da mudança (runner-units, runner-config, config-migrations, config-web-scope, team-runner-edit, conflict-resolve, runner-publish, config-schema) com 167 passando; `npx tsc --noEmit` limpo; um roteiro próprio de caixa preta com 19 de 19; `node scripts/public-audit.mjs` (911 arquivos), `npm run i18n:lint` (4059 chaves nos dois idiomas) e `node scripts/theme-audit.mjs` passam.
- **Suíte inteira (`npx vitest run`):** 3663 passando, 13 falhas em 4 arquivos, todas de tempo de espera sob carga paralela (runner-release, conflict-resolve, runner-chain e a conhecida update-script). Os quatro arquivos, rodados sozinhos, passam com 67 e nenhuma falha — é a carga, não a mudança. Fica como risco de execução paralela.
- **Não verificado (nunca):** uma execução real abrindo pull request; a tela num navegador pareado de verdade; o commit do conflito reproduzido à mão; nenhuma migração sobre o arquivo de configuração de um espaço de trabalho real.
- Passagem qa-plataforma-2 → pessoa: QA concluída; o ciclo pode seguir para o commit e a abertura da pull request. <!-- handoff:498 -->
- Passagem revisor-plataforma → qa-plataforma-2: revisão aprovada; as portas passam por execução; o que segue não verificado são os quatro de sempre. <!-- handoff:497 -->
- Passagem developer → revisor-plataforma: fechar os cinco achados e repetir as portas — feito e aprovado. <!-- handoff:475 -->
- Passagem tl-plataforma → pessoa: Implementação de `2_PLAN.md` (sete passos, um commit cada). <!-- handoff:24 -->
- Passagem support → product-owner: Refino do produto (1_SPEC.md). <!-- handoff:6 -->
- Passagem product-owner → pessoa: Desenho e planejamento (2_PLAN.md) a partir de 1_SPEC.md. <!-- handoff:15 -->
- Passagem developer → revisor-plataforma: Revisão da implementação de `2_PLAN.md`: os sete passos entraram no worktree. O que precisa ser conferido primeiro é o que esta etapa não conseguiu rodar: `npx vitest run` completo, `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs` e o build do CI. Os três arquivos de teste que não foram reconferidos depois das últimas edições são `test/runner-publish.test.ts` (título `Add the thing #101` na proposta), `test/conflict-resolve.test.ts` (mensagem do merge com `#15526`) e `test/config-migrations.test.ts` (o passo v12→v13, incluindo o `toEqual` do documento inteiro). Foram rodados com… <!-- handoff:289 -->
- Passagem revisor-plataforma → developer: A entrega tem o comportamento central de pé — a montagem do título pelos dois moldes, o `{iid}` obrigatório na validação, a migração v12→v13, o número no commit do conflito e o campo aceito pela tela Time no navegador foram exercitados nesta etapa —, mas o veredito é "changes": seis arquivos de teste ficaram sem acompanhar a mudança e derrubam o `tsc` e a suíte, dois textos novos da interface dizem "pull request" no catálogo português (a auditoria de termos entre hosts falha), e as chaves novas ficaram fora da ordem alfabética exigida pelos catálogos. Nada disso é caminho de escrita no host: a… <!-- handoff:365 -->
- Passagem developer → revisor-plataforma: Fechar os achados que ficaram sem aplicação antes de nova revisão: (1) `test/team-runner-edit.test.ts:92` precisa esperar as duas mensagens (`error:commitSummary` e `error:commitIssue`) para `feat: stuff`; (2) `src/main/runner/publish.ts:692` deve montar o título pelo molde também na proposta, preservando o caso de um título já publicado, para um registro `pr` antigo sem `title` não abrir a pull request sem número; (3) acrescentar `runner.prTitle` à tabela de campos do `runner` em `docs/configuration.md:42` e na gêmea em inglês em `:190`. Depois, rodar as portas de verdade: `npx tsc --noEmit`,… <!-- handoff:372 -->
- Passagem pessoa → developer: Volta para o dev <!-- handoff:444 -->
