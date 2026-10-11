# Memória do ciclo

## Decisões

- Triagem fechada: pedido de funcionalidade, sem duplicada. Prioridade `priority:low` vem da issue; o refino propôs `medium`. A decisão é da pessoa.
- Squad: `experiencia`. Relação mais próxima: #247 (o botão da persona).
- Spec aprovada no gate 1: duas superfícies (o botão da persona e um botão de outro agente numa conversa). Nada abre sem a pessoa tocar.
- Plano: Q1 com campos novos `project` e `number` em `PushTarget`; Q2 sim (outro agente oferece um botão); Q4 alternativa a (explica sem card, sem a linha da spec).
- Implementação:
  - checagem de alcance única em `mrOutOfReach` (`src/main/vcs/readTool.ts`), estrita, com os projetos do workspace;
  - `openDiscussions` lê a MR antes da lista; um número que o host não dá como MR é recusado sem afirmar o que é;
  - ferramenta nova `OpenDiscussions` só para quem não é a persona;
  - tela sem card: sem jobs, lista lida a cada abertura, sem responder nem resolver.
- Resposta: **Spec funcional escrita (refinamento).** Li a issue, a triagem e o código que a triagem cita. O que ela pede está de pé, mas a descrição esconde uma coisa maior do que eu esperava, e é essa a spec. **O que a descrição não diz.** Hoje a única superfície que abre uma tela a partir de uma conversa é o botão da persona — e ela só **oferece**, não abre. Um agente que responde numa conversa (não a persona) não tem nenhuma ferramenta de ação: recebe leitura, a chamada a um par e as tarefas da persona. Então “o agente abre a tela de discussões” não é um encaixe no que existe, é uma superfície nova: u… <!-- answer:127 -->
- Resposta: tentar novamente <!-- answer:164 -->

## Restrições

- O destino `discussions` exige a referência em três lugares (`push.ts`, `pushTarget.ts` e o `OpenScreen`); os três aceitam agora o par projeto+número.
- Propor resposta e resolução continua exigindo o card (a fila de Ações não muda).
- Toda string passa por `t()` e vai nos dois catálogos; o repositório é público.

## Tentado e descartado

- Ler os threads por `VcsRead` não basta: o que faltava era a superfície da tela.
- Reaproveitar `id` ou `mr` para o número da MR: descartado (Q1).

## Perguntas abertas

- Q3 (celular pareado), Q5 (escopo da execução estreitar a lista; hoje não estreita), Q6 (texto da recusa) e Q7 (marco): da pessoa, no aceite.
- Fora do implementado e a revisar:
  - regra 16 (linha de sistema no thread do que foi aberto) não feita;
  - o voltar leva à home (chat), não à conversa exata;
  - o botão de outro agente num thread de execução não foi exercitado.

## Onde o trabalho está

- `0_TRIAGE`, `1_SPEC` (aprovada), `2_PLAN` e `3_IMPLEMENTATION` escritos. O código e os testes estão no worktree, com o CHANGELOG em Unreleased.
- Rodado na tentativa 4:
  - `tsc` ok;
  - testes tocados ok (72): `discussions-by-mr` (novo), `push-targets`, `persona-open-screen`, `chat-model`;
  - vitest completo: só 2 testes falham, em 4 arquivos de navegador, por `@playwright/mcp` ausente no `node_modules` do worktree (ambiente);
  - `i18n:lint`, `theme-audit` e `public-audit` ok.
- Não verificado: a tela no app, `electron-vite build` e o celular pareado.
- Próxima etapa: revisão e depois QA, que deve abrir a tela por um botão com projeto e número, num provedor falso.
- Passagem support → product-owner: O gate 1 decide se a spec (`1_SPEC.md`) segue. A próxima etapa (plano técnico) precisa tratar os três pontos que a triagem achou e a issue não cobre: construir o rigor de projeto no caminho da tela (`listDiscussions`/`explainDiscussion` hoje vão ao provedor direto), fazer a explicação de cada thread funcionar sem o card inteiro no prompt, e levar projeto + número da MR num destino que hoje só tem `ref`/`id`/`mr` — o que toca `src/shared/push.ts`, `src/renderer/src/pushTarget.ts` e o `openScreen` da persona. Nada aqui foi executado; nenhuma tela foi aberta. <!-- handoff:139 -->
- Passagem product-owner → pessoa: O gate 1 decide a spec (`1_SPEC.md`) e, em especial, as duas decisões de base que bloqueiam o plano: (a) se um agente que não é a persona pode abrir uma tela a partir de uma resposta — se a pessoa recusar, as regras 15 a 18 saem e a mudança fica nos botões da persona; (b) como a explicação se comporta sem o card (segue e perde a linha do card / só lista / lista com recado). O plano técnico precisa tratar cinco pontos: construir o rigor de projeto no caminho da tela (hoje a lista e a explicação vão ao provedor direto, com a validação só de formato), fazer a explicação funcionar sem o card intei… <!-- handoff:149 -->
- Passagem tl-experiencia → pessoa: Implementar as mudanças descritas no plano, começando pelos seletores e roteamento, seguido pelas telas e pelos backends. Após cada mudança, executar os testes correspondentes para verificar o comportamento. <!-- handoff:179 -->
