# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (enhancement). Sem defeito a reproduzir.
- Spec em `1_SPEC.md`, plano em `2_PLAN.md`, implementação em `3_IMPLEMENTATION.md`, revisão em `4_REVIEW.md`.
- Regras fechadas no refino, que o plano não reabre: cada mensagem é respondida, uma após a outra; a conversa é interna; contexto é a janela das últimas 40 mensagens; fechar e mudar o estado sempre esperam a pessoa; a autonomia por agente cobre só comentário e rótulo; nenhuma conversa dá escrita em arquivos; host sem a operação diz que não tem; ajustar a permissão de um agente não muda a dos outros; todas as ferramentas são dizíveis por agente e um agente pode usar uma que o espaço desligou.
- Portão 3 (resposta ao plano): **opção B** — o módulo de menções ganha caminho de proposta próprio (`planWrite` + `proposeVcsAction`/`runVcsAuto`), sem o publicador da execução.
- Plano: (1) quarto tipo de thread `agent`, dono no campo `squad`, id `agent-<id>`, idempotente, listada como conversa; (2) `proposals` no esquema da resposta; (3) chave `mention:<thread>:<dono>:<agente>:<n>:<hash>`; (4) autonomia liga só comentário/rótulos; (5) tela de Ações em lote; (6) `tools` opcional por agente sobrepondo o do espaço, migração v12→v13.
- Resposta: todas na mesma entrega e todas as ferramentas pode usar uma ferramenta desligada <!-- answer:37 -->
- Resposta: B <!-- answer:62 -->

## Restrições

- Achados de leitura que prendem o trabalho: `proposesIssue` devolvia `false` fora de uma execução; as escritas da porta passam por validação e auditoria (`src/main/vcs/types.ts`, `src/main/actions.ts`); o Bitbucket não tem rótulos de issue (`issueLabels: false` em `src/shared/vcsCaps.ts`); fechar e mudar estado divergem por host; teto de 3 menções; contexto de 40 mensagens; `CONFIG_SCHEMA_VERSION` foi de 12 para 13.
- A escrita em arquivos não pode nascer de uma conversa: uma menção não recebe `confine` (`src/main/agents.ts`).
- Revisão (esta passada, tentativa 1, veredito **changes**): gates verdes (`tsc`, `vitest` 3639, `theme-audit`, `i18n:lint`, `public-audit`, todos exit 0), mas (a) `proposeMention` guarda só `commands[0]`, descartando rótulos de remoção num host que planeja vários comandos; (b) na thread de uma execução, `raiseWrites` só oferece `createIssue` e descarta em silêncio comentário/rótulo/estado/fechamento; (c) `wantsVcsTool` (`src/main/agents.ts:457`) troca o caminho de leitura do host quando o agente tem `tools`, o que é fora do escopo; (d) a tela toda ficou ausente (atalho da equipe, lote em Ações, interruptores de ferramentas); (e) nenhum teste novo de comportamento; (f) o texto de sistema da menção ainda diz "só lê". Também: chave `${seq}-${agent}` colide para duas issues na mesma resposta, e `place.ref` indefinido deixa o alvo da ação em 0 (não conferido se a tela aceita).

## Tentado e descartado

- Publicar as regras gerais de "escrita de baixo risco" e as operações no texto do produto: as opções saem do host e do app.
- Um tipo novo de lugar de menção: descartado; reusa `kind: 'channel'` com o dono do cabeçalho.
- Reusar o publicador da execução no módulo de menções (opção A): a pessoa escolheu a B.
- Chamar o marco de um número: o marco não foi lido; a proposta é "a próxima versão menor", a confirmar.

## Perguntas abertas

- Nenhuma de quem abriu a issue. Em aberto para a pessoa: quais escritas contam como de baixo risco (hoje comentário e rótulo); aceitar que fechar não é igual em todo host; e a conversa no telefone pareado, que a verificação precisa fechar.

## Onde o trabalho está

- `docs/cycles/[redacted]/` com `0_ISSUE.md`, `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e agora `4_REVIEW.md`.
- Implementado (gates verdes): fórum tipo `agent`; lugar/chamada sem `@`; `proposals` com leitura leniente; caminho de proposta próprio (`src/main/mentions/propose.ts`); campo `tools` por agente com `toolsForAgent`; migração v12→v13; i18n dos dois catálogos.
- Falta (bloqueia a entrega): corrigir os três defeitos de runtime apontados na revisão, construir a tela e escrever os testes de comportamento do plano. Handoff no `4_REVIEW.md` e em `3_IMPLEMENTATION.md`.
- Não verificado em nenhuma etapa: a conversa no telefone pareado e a ausência de memória entre conversas.
- Passagem support → product-owner: Levar ao refino o pedido com a seguinte base verificada: (1) a proposta de uma resposta hoje depende de um publicador que só a execução tem — um lugar sem execução precisa de um publicador próprio; (2) a única operação proposta hoje é `createIssue`, e as operações `commentIssue`, `setIssueLabels`, `setIssueStatus` e `closeIssue` já existem e passam pela mesma porta (plano, proposta, validação, aprovação, auditoria), faltando o canal que permite ao agente propô-las e o rascunho por hash de corpo para não repetir; (3) a única conversa que existe hoje é uma thread (execução, squad, canal dos squa… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Levar a spec para o plano técnico, com as decisões da pessoa resolvidas antes do desenvolvimento (o escopo, item 1 das perguntas em aberto: se a autonomia entra nesta entrega ou na seguinte). O plano decide então, e só isso: (1) onde mora uma conversa que pertence a um agente — hoje a conversa é uma thread com tipo `run`/`general`/`channel` e cabeçalho `kind`/`runId`/`squad`/`title`, e nada numa thread pertence a um agente (`src/shared/forum.ts:80-94`, `src/main/forum-core.ts:271`, `src/main/mentions/place.ts:29-46`) —, como ela é listada junto das conversas do fórum (`src/main/forum.ts:52-59`… <!-- handoff:25 -->
- Passagem pessoa → product-owner: O Agente também poderar criar issues que lhe for permitido [, deve ter nas configurações do agente a opão de ajustar as permissões de uso de comandos e tools por agente ale do que já é permitido nas configurações <!-- handoff:30 -->
- Passagem product-owner → pessoa: Levar a spec para o plano técnico: as perguntas que dependiam da pessoa sobre escopo e sobre até onde vai o ajuste de permissões estão resolvidas — autonomia por agente e ajuste de permissões de comandos e ferramentas entram na mesma entrega, o ajuste cobre todas as ferramentas, e um agente pode usar uma ferramenta que o espaço de trabalho desligou (dita só para ele). O plano decide, e só isso: (1) onde mora uma conversa que pertence a um agente — hoje a conversa é uma thread com tipo `run`/`general`/`channel` e cabeçalho `kind`/`runId`/`squad`/`title`, e nada numa thread pertence a um agente … <!-- handoff:40 -->
- Passagem tl-plataforma → pessoa: A próxima etapa (desenvolvimento) implementa o plano em 2_PLAN.md nesta ordem sugerida: (1) fórum — quarto tipo `agent` em THREAD_KINDS e no enum do cabeçalho, id `agent-<id>`, criação idempotente como os canais de squad, `placeOfThread` devolvendo o agente dono, lista como conversa; (2) menções — uma mensagem de pessoa numa conversa `agent` chama o dono sem `@`, com o teto de 3, e um caminho de proposta pelo módulo que não depende do publicador da execução; (3) `mentionCall` com `proposals` em vez de `issue`, com os dois catálogos de idioma; (4) propostas por operação (comentar, rótulos, esta… <!-- handoff:48 -->
- Passagem developer → revisor-plataforma: A próxima etapa (desenvolvimento, continuação) deve: (1) terminar a tela — o atalho da equipe para abrir `agent-<id>`, os interruptores de ferramentas por agente em `TeamSection`/`agentEdit` (o draft já tem o campo `tools`), e o \"sim a todas\" em `src/renderer/src/screens/Actions.tsx` agrupando por `unit.batch`; (2) escrever os testes de unidade que o plano pede (fórum `agent`, lugar/chamada, `proposals` leniente, proposta por operação e chave, host sem operação, autonomia só para comentário/rótulo, lote, ferramentas por agente sem Edit/Write numa menção, migração v12→v13); (3) rodar `node sc… <!-- handoff:87 -->
