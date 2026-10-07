# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (`enhancement`), completo, sem pergunta. Refino: `1_SPEC.md` (dez critérios). Plano: `2_PLAN.md`, sete passos. O código dos sete passos está no worktree; nada commitado (quem commita é o app).
- `runner.prTitle` no tipo, no padrão (`{title} #{iid}`) e no esquema (`minLength: 1`, `maxLength: 200`); `CONFIG_SCHEMA_VERSION` 12 → 13; `v12ToV13` ao fim de `STEPS`.
- A montagem do título é a função pura `pullRequestTitle` (`src/main/runner/git.ts`), chamada no rascunho (`publish.ts:674`) e na proposta (`publish.ts:692`); o corte de 120 vale sobre o título do agente; execução sem issue larga o `#` e o número; título do agente que já traz qualquer `#<n>` mantém a dele.
- O commit do conflito: `conflictMergeMessage` (`src/main/actions.ts:709-711`) monta com o número de `a.issue` e o molde de `getConfig().runner.commitMessage`; sem número, a mensagem de base continua `Merge <branch>`.
- `runner.prTitle` entrou em `WEB_EDITABLE`, no `runnerOfWeb`, nos dois catálogos, na `RunnerSection` e agora também na tabela de campos do `runner` em `docs/configuration.md` (`:42` e `:190`), nos dois idiomas.
- O `commitMessage` guardado que já tem `{iid}` não é reescrito pela migração.
- **Tentativa 4 (esta passada): os cinco achados do veredito "changes" foram fechados e verificados por execução.** Fechados: as versões de esquema de `test/agent-team.test.ts:43` e `:266` e a recusa de app mais novo em `test/config-schema.test.ts:80` (agora 14); `prTitle` no objeto do padrão de `test/runner-config.test.ts:12`; as recusas somadas do editor em `test/team-runner-edit.test.ts:92-94`; e a proposta (`publish.ts:692`) passou a preferir o título guardado e cair no título da issue quando ele não serve, com caso novo em `test/runner-publish.test.ts`.
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

- Etapas concluídas: `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e `4_REVIEW.md` (revisão em andamento).
- **Verificado nesta passada por execução:** `npx tsc --noEmit` passa limpo; `npx vitest run` dá 3675 passando e 1 falha, em `test/update-script.test.ts` (arquivo alheio a esta mudança, que passa 12/12 sozinho — falha de tempo na execução paralela); os quatro arquivos antes vermelhos dão 84 passando; os oito arquivos de runner e config dão 183 passando; `test/runner-publish.test.ts` dá 17 passando com o caso novo; `node scripts/public-audit.mjs` (911 arquivos), `npm run i18n:lint` (4059 chaves nos dois idiomas), `node scripts/theme-audit.mjs` e `npx electron-vite build` (1 min 3 s) passam.
- **Sem achados abertos:** os cinco do veredito anterior foram fechados, e a documentação ganhou o campo na tabela do `runner`.
- **Não verificado (nunca):** uma execução real abrindo pull request; a tela num navegador pareado de verdade; o commit do conflito reproduzido à mão; nenhuma migração sobre o arquivo de configuração de um espaço de trabalho real.
- Passagem developer → revisor-plataforma: fechar os cinco achados e repetir as portas — feito; cabe à revisão conferir a suíte inteira e a falha isolada de `test/update-script.test.ts`.
- Passagem developer → revisor-plataforma (rodada anterior): o comportamento central de pé, mas seis arquivos de teste sem acompanhar, dois textos de interface e a ordem dos catálogos — os três últimos fechados então. <!-- handoff:365 -->
- Passagem developer → revisor-plataforma: Fechar os achados que ficaram sem aplicação antes de nova revisão: (1) `test/team-runner-edit.test.ts:92` precisa esperar as duas mensagens (`error:commitSummary` e `error:commitIssue`) para `feat: stuff`; (2) `src/main/runner/publish.ts:692` deve montar o título pelo molde também na proposta, preservando o caso de um título já publicado, para um registro `pr` antigo sem `title` não abrir a pull request sem número; (3) acrescentar `runner.prTitle` à tabela de campos do `runner` em `docs/configuration.md:42` e na gêmea em inglês em `:190`. Depois, rodar as portas de verdade: `npx tsc --noEmit`,… <!-- handoff:372 -->
- Passagem tl-plataforma → pessoa: Implementação de `2_PLAN.md` (sete passos, um commit cada). <!-- handoff:24 -->
- Passagem support → product-owner: Refino do produto (1_SPEC.md). <!-- handoff:6 -->
- Passagem product-owner → pessoa: Desenho e planejamento (2_PLAN.md) a partir de 1_SPEC.md. <!-- handoff:15 -->
- Passagem developer → revisor-plataforma: Revisão da implementação de `2_PLAN.md`: os sete passos entraram no worktree. <!-- handoff:289 -->
- Passagem pessoa → developer: Volta para o dev <!-- handoff:444 -->
