# Memória do ciclo

## Decisões

- Triagem fechada: pedido de funcionalidade, sem duplicada. Prioridade `priority:low` vem da issue; o refino propôs `medium`. A decisão é da pessoa.
- Squad: `experiencia`. Relação mais próxima: #247.
- Spec aprovada: duas superfícies (botão da persona e botão de outro agente numa conversa). Nada abre sem a pessoa tocar.
- Plano: Q1 campos novos `project` e `number` em `PushTarget`; Q2 sim; Q4 alternativa a (explica sem card).
- Implementação: `mrOutOfReach` (`src/main/vcs/readTool.ts`) estrito; `openDiscussions` lê a MR antes da lista; ferramenta `OpenDiscussions` para quem não é a persona; tela sem card sem jobs, sem responder nem resolver.
- Bloqueantes da revisão tratados (tentativa 6):
  - `Thread.tsx` desenha os botões de agente no Fórum e na execução.
  - `openButton.ts` + `discussionsOpened` (main) gravam a linha `main.feedback.opened` só para um botão que o thread carrega.
  - A rota de discussões por par leva `back` à conversa de origem.
  - `PROJECT` recusa segmentos só de pontos.
- Resposta: **Spec funcional escrita (refinamento).** Li a issue, a triagem e o código que a triagem cita. O que ela pede está de pé, mas a descrição esconde uma coisa maior do que eu esperava, e é essa a spec. **O que a descrição não diz.** Hoje a única superfície que abre uma tela a partir de uma conversa é o botão da persona — e ela só **oferece**, não abre. Um agente que responde numa conversa (não a persona) não tem nenhuma ferramenta de ação: recebe leitura, a chamada a um par e as tarefas da persona. Então “o agente abre a tela de discussões” não é um encaixe no que existe, é uma superfície nova: u… <!-- answer:127 -->
- Resposta: tentar novamente <!-- answer:164 -->

## Restrições

- O destino `discussions` exige a referência em três lugares (`push.ts`, `pushTarget.ts`, `OpenScreen`); os três aceitam o par projeto+número.
- Propor resposta e resolução continua exigindo o card.
- Toda string passa por `t()` nos dois catálogos; repositório público.

## Tentado e descartado

- Ler threads por `VcsRead` não basta: faltava a superfície da tela.
- Reaproveitar `id` ou `mr` para o número da MR: descartado (Q1).

## Perguntas abertas

- Q3 (celular pareado), Q5 (escopo da execução estreitar a lista), Q6 (texto da recusa), Q7 (marco): da pessoa, no aceite.

## Onde o trabalho está

- Implementação, tentativa 6, rodado nela:
  - tsc ok;
  - os 6 testes tocados: 102 passam;
  - i18n:lint, theme-audit e public-audit ok;
  - vitest completo: só os 4 arquivos de navegador falham (`@playwright/mcp` ausente no worktree). `conflict-resolve` oscilou sob carga numa rodada e passa sozinho.
- Não verificado: a tela no app, `electron-vite build`, o desenho da linha de sistema em cada thread, o celular pareado.
- Próxima etapa: a revisão olha só os bloqueantes. Depois, a QA abre a tela por um botão com projeto e número num workspace com provedor falso, no chat da persona, no Fórum e na execução, e confere a linha no thread e o voltar.
- Passagem support → product-owner: O gate 1 decide se a spec (`1_SPEC.md`) segue. A próxima etapa (plano técnico) precisa tratar os três pontos que a triagem achou e a issue não cobre: construir o rigor de projeto no caminho da tela (`listDiscussions`/`explainDiscussion` hoje vão ao provedor direto), fazer a explicação de cada thread funcionar sem o card inteiro no prompt, e levar projeto + número da MR num destino que hoje só tem `ref`/`id`/`mr` — o que toca `src/shared/push.ts`, `src/renderer/src/pushTarget.ts` e o `openScreen` da persona. Nada aqui foi executado; nenhuma tela foi aberta. <!-- handoff:139 -->
- Passagem product-owner → pessoa: O gate 1 decide a spec (`1_SPEC.md`) e, em especial, as duas decisões de base que bloqueiam o plano: (a) se um agente que não é a persona pode abrir uma tela a partir de uma resposta — se a pessoa recusar, as regras 15 a 18 saem e a mudança fica nos botões da persona; (b) como a explicação se comporta sem o card (segue e perde a linha do card / só lista / lista com recado). O plano técnico precisa tratar cinco pontos: construir o rigor de projeto no caminho da tela (hoje a lista e a explicação vão ao provedor direto, com a validação só de formato), fazer a explicação funcionar sem o card intei… <!-- handoff:149 -->
- Passagem tl-experiencia → pessoa: Implementar as mudanças descritas no plano, começando pelos seletores e roteamento, seguido pelas telas e pelos backends. Após cada mudança, executar os testes correspondentes para verificar o comportamento. <!-- handoff:179 -->
- Passagem dev-experiencia → revisor-experiencia: Revisar o diff contra a spec e o plano. Pontos a olhar: - A regra 16 (linha de sistema no thread) não foi implementada. - O voltar leva ao chat (home), e não à conversa exata de onde a tela veio. - O escopo de execução não estreita a lista de projetos (Q5). - O botão de outro agente num thread de execução não foi exercitado. Na interface nada foi conferido: a QA precisa abrir a tela por um botão com projeto e número, num workspace com um provedor falso. `npx vitest run` só falha nos 4 arquivos de navegador, por `@playwright/mcp` ausente no `node_modules` do worktree; rodar de novo com as depen… <!-- handoff:267 -->
- Passagem revisor-experiencia → dev-experiencia: Revisão por leitura do diff: a base está sólida (alcance estrito centralizado, recusas com motivo nos dois idiomas, destino validado em três lugares, nada escrito no host), mas dois critérios de aceite não foram atendidos (4/regra 16 e 14) e o botão do outro agente não aparece em conversa de execução (critério 5). Veredito: changes. Nada foi executado nesta etapa. [bloqueia] src/main/mentions/answer.ts:433: A ferramenta OpenDiscussions é oferecida a todo agente não persona, mas os botões só são desenhados na conversa da persona (ChatThread não compacta). Numa conversa de execução o botão é gra… <!-- handoff:274 -->
