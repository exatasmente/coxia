# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (enhancement). Sem defeito a reproduzir.
- Spec `1_SPEC.md`, plano `2_PLAN.md`, implementação `3_IMPLEMENTATION.md`, revisão `4_REVIEW.md`, teste `5_TEST_PLAN.md`.
- Regras fechadas no refino: cada mensagem é respondida, uma após a outra; a conversa é interna; contexto é a janela das últimas 40 mensagens; fechar e mudar o estado sempre esperam a pessoa; a autonomia por agente cobre só comentário e rótulo; nenhuma conversa dá escrita em arquivos; host sem a operação diz que não tem; ajustar a permissão de um agente não muda a dos outros; todas as ferramentas são dizíveis por agente e um agente pode usar uma que o espaço desligou.
- Portão 3: **opção B** — o módulo de menções ganha caminho de proposta próprio (`proposeMention`), sem o publicador da execução.
- Plano: quarto tipo de thread `agent` (dono no campo `squad`, id `agent-<id>`, idempotente, listado como conversa); `proposals` no esquema da resposta; chave distinta por proposta; autonomia liga só comentário/rótulos; tela de Ações em lote; `tools` opcional por agente sobrepondo o do espaço, migração v12→v13.
- **Revisão da rodada 2: aprovado.** Os cinco bloqueantes da rodada 1 foram atendidos. **QA: entregue para o pull request.**
- Resposta: todas na mesma entrega e todas as ferramentas pode usar uma ferramenta desligada <!-- answer:37 -->
- Resposta: B <!-- answer:62 -->

## Restrições

- As escritas da porta passam por validação e auditoria (`src/main/vcs/types.ts`, `src/main/actions.ts`); o Bitbucket não tem rótulos de issue (`issueLabels: false` em `src/shared/vcsCaps.ts`); fechar e mudar estado divergem por host; teto de 3 menções; contexto de 40 mensagens; `CONFIG_SCHEMA_VERSION` foi de 12 para 13.
- Uma menção não recebe `confine` (`src/main/agents.ts`), então nenhuma conversa dá escrita em arquivos, mesmo com `tools.files` ligado só para o agente.
- **O caminho de leitura do host é o do espaço de trabalho**, não o do agente: `wantsVcsTool` decide por `vcsReadPolicy().via === 'tool'`.
- **A conversa de uma execução não tem mais caminho próprio de proposta**: `Publisher.proposeIssue` e o ramo `mention-issue` foram removidos; toda resposta propõe pelo módulo (`src/main/mentions/propose.ts`).
- Linhas de sistema da menção: `runner.mention.proposed|autoWrote|unsupported|proposalFailed`.

## Tentado e descartado

- Publicar as regras gerais no texto do produto: as opções saem do host e do app.
- Um tipo novo de lugar de menção: reusa `kind: 'channel'` com o dono do cabeçalho.
- Reusar o publicador da execução (opção A): a pessoa escolheu a B.
- Testar `wantsVcsTool` num teste de motor: a garantia fica no código e no teste de `toolsForAgent`.
- Chamar o marco de um número: o marco não foi lido; a proposta é "a próxima versão menor", a confirmar.

## Perguntas abertas

- Nenhuma de quem abriu a issue. Em aberto para a pessoa: quais escritas contam como de baixo risco (hoje comentário e rótulo); aceitar que fechar não é igual em todo host; e a conversa no telefone pareado, que a verificação precisa fechar.

## Onde o trabalho está

- `docs/cycles/[redacted]/` com `0_ISSUE.md`, `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md`, `4_REVIEW.md`, `5_TEST_PLAN.md`.
- Gates rodados pela QA, todos exit 0: `npx tsc --noEmit`, `npx vitest run` (223 arquivos, **3657** testes), `node scripts/theme-audit.mjs`, `npm run i18n:lint` (4074 chaves), `node scripts/public-audit.mjs` (914 arquivos), `npx electron-vite build` (a revisão não o havia rodado).
- Testes de comportamento da entrega, 57 passando: `test/mentions-agent-chat.test.ts` (12), `test/actions-batch.test.ts` (3), mais casos em `test/agent-team.test.ts` (36) e `test/runner-mention-actions.test.ts` (6).
- **Não verificado**: a conversa direta no telefone pareado; a ausência de memória entre conversas; a tela exercitada de fato (não há teste de renderer; exercitada a regra pura `batchesOf` e a compilação); qualquer host de código real.
- Sugestões não bloqueantes que restam: a perda do aviso na conversa de uma execução sobre a issue que ela propôs (a unidade não leva `runId`); o alvo 0 do registro de uma proposta numa conversa sem `ref`; tudo isso está no `5_TEST_PLAN.md`.
- Passagem support → product-owner: Levar ao refino o pedido com a seguinte base verificada: (1) a proposta de uma resposta hoje depende de um publicador que só a execução tem — um lugar sem execução precisa de um publicador próprio; (2) a única operação proposta hoje é `createIssue`, e as operações `commentIssue`, `setIssueLabels`, `setIssueStatus` e `closeIssue` já existem e passam pela mesma porta (plano, proposta, validação, aprovação, auditoria), faltando o canal que permite ao agente propô-las e o rascunho por hash de corpo para não repetir; (3) a única conversa que existe hoje é uma thread (execução, squad, canal dos squa… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Levar a spec para o plano técnico, com as decisões da pessoa resolvidas antes do desenvolvimento (o escopo, item 1 das perguntas em aberto: se a autonomia entra nesta entrega ou na seguinte). O plano decide então, e só isso: (1) onde mora uma conversa que pertence a um agente — hoje a conversa é uma thread com tipo `run`/`general`/`channel` e cabeçalho `kind`/`runId`/`squad`/`title`, e nada numa thread pertence a um agente (`src/shared/forum.ts:80-94`, `src/main/forum-core.ts:271`, `src/main/mentions/place.ts:29-46`) —, como ela é listada junto das conversas do fórum (`src/main/forum.ts:52-59`… <!-- handoff:25 -->
- Passagem pessoa → product-owner: O Agente também poderar criar issues que lhe for permitido [, deve ter nas configurações do agente a opão de ajustar as permissões de uso de comandos e tools por agente ale do que já é permitido nas configurações <!-- handoff:30 -->
- Passagem product-owner → pessoa: Levar a spec para o plano técnico: as perguntas que dependiam da pessoa sobre escopo e sobre até onde vai o ajuste de permissões estão resolvidas — autonomia por agente e ajuste de permissões de comandos e ferramentas entram na mesma entrega, o ajuste cobre todas as ferramentas, e um agente pode usar uma ferramenta que o espaço de trabalho desligou (dita só para ele). O plano decide, e só isso: (1) onde mora uma conversa que pertence a um agente — hoje a conversa é uma thread com tipo `run`/`general`/`channel` e cabeçalho `kind`/`runId`/`squad`/`title`, e nada numa thread pertence a um agente … <!-- handoff:40 -->
- Passagem tl-plataforma → pessoa: A próxima etapa (desenvolvimento) implementa o plano em 2_PLAN.md nesta ordem sugerida: (1) fórum — quarto tipo `agent` em THREAD_KINDS e no enum do cabeçalho, id `agent-<id>`, criação idempotente como os canais de squad, `placeOfThread` devolvendo o agente dono, lista como conversa; (2) menções — uma mensagem de pessoa numa conversa `agent` chama o dono sem `@`, com o teto de 3, e um caminho de proposta pelo módulo que não depende do publicador da execução; (3) `mentionCall` com `proposals` em vez de `issue`, com os dois catálogos de idioma; (4) propostas por operação (comentar, rótulos, esta… <!-- handoff:48 -->
- Passagem developer → revisor-plataforma: A próxima etapa (desenvolvimento, continuação) deve: (1) terminar a tela — o atalho da equipe para abrir `agent-<id>`, os interruptores de ferramentas por agente em `TeamSection`/`agentEdit` (o draft já tem o campo `tools`), e o \"sim a todas\" em `src/renderer/src/screens/Actions.tsx` agrupando por `unit.batch`; (2) escrever os testes de unidade que o plano pede (fórum `agent`, lugar/chamada, `proposals` leniente, proposta por operação e chave, host sem operação, autonomia só para comentário/rótulo, lote, ferramentas por agente sem Edit/Write numa menção, migração v12→v13); (3) rodar `node sc… <!-- handoff:87 -->
- Passagem revisor-plataforma → developer: A entrega fica aquém do que a spec e o plano fecharam: o núcleo de runtime (conversa `agent` no fórum, chamada do dono sem `@`, esquema `proposals` com leitura leniente, caminho de proposta próprio do módulo de menções, campo `tools` por agente e a migração v12→v13) está implementado e os gates do repositório passam (tsc, vitest com 3639 testes, theme-audit, i18n:lint e public-audit, todos exit 0), mas a tela toda ficou de fora — não há atalho para abrir a conversa direta, nem o "sim a todas" do lote em Ações, nem os interruptores de ferramentas por agente —, não existe nenhum teste novo de co… <!-- handoff:119 -->
- Passagem developer → revisor-plataforma: Levar a entrega para revisão. O núcleo de runtime está fechado e os gates passam (tsc, vitest 3657, theme-audit, i18n:lint, public-audit, todos exit 0): o caminho de proposta próprio do módulo de menções propõe todos os comandos de uma escrita e vale para qualquer lugar onde o agente responde (inclusive a thread de uma execução); a chave distingue cada proposta; a tela (atalho do fórum, "sim a todas" por `unit.batch`, interruptores de ferramentas por agente) está feita; e os testes de comportamento do plano existem. O que a revisão deve conferir: (1) que a remoção de `Publisher.proposeIssue` e… <!-- handoff:176 -->
- Passagem revisor-plataforma → qa-plataforma-2: Levar a entrega para o pull request. A revisão da rodada 2 aprovou: os bloqueantes da rodada 1 estão atendidos (todos os comandos de uma escrita são propostos, a conversa de uma execução não descarta propostas, o caminho de leitura do host voltou ao do espaço de trabalho, a tela inteira existe e há testes de comportamento novos), e os gates do repositório passam (tsc, vitest 3657, theme-audit, i18n:lint, public-audit, todos exit 0). Ficam como sugestões, não bloqueantes: a perda do aviso na conversa de uma execução sobre a issue que ela propôs, o alvo 0 do registro de uma proposta numa convers… <!-- handoff:198 -->
