# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, sem duplicada. Prioridade da issue `priority:low`; refino propôs `medium`; decisão da pessoa. Squad `experiencia`. Relação mais próxima: #247.
- Spec aprovada: duas superfícies (botão da persona e botão de outro agente numa conversa). Nada abre sem a pessoa tocar.
- Plano: Q1 campos `project` e `number` em `PushTarget`; Q2 sim; Q4 alternativa a (explica sem card).
- Implementação: `mrOutOfReach` (`readTool.ts`) estrito; `openDiscussions` lê a MR antes da lista; ferramenta `OpenDiscussions` para quem não é a persona; tela sem card sem jobs, sem responder nem resolver.
- Bloqueantes da revisão tratados: `Thread.tsx` desenha botões de agente; `openButton.ts` + `discussionsOpened` gravam `main.feedback.opened` só para botão do thread; rota por par leva `back`; `PROJECT` recusa segmentos de pontos.
- Revisão rodada 2 aprovada; QA e integração: gates passaram.
- Tentativa 7 (pedido da pessoa: conflitos com a base): mesclada `release/0.10.0` (`8389197`); conflitos em CHANGELOG, `answer.ts`, `ChatScreen.tsx`, `ChatThread.tsx` resolvidos unindo os dois lados. Os canais `feedback:discussions:open`/`opened` entraram como exclusão `window` na tabela da porta da persona (`doorTable.ts`, vinda da release); teste com 303 canais e 113 exclusões.
- Resposta: **Spec funcional escrita (refinamento).** Li a issue, a triagem e o código que a triagem cita. O que ela pede está de pé, mas a descrição esconde uma coisa maior do que eu esperava, e é essa a spec. **O que a descrição não diz.** Hoje a única superfície que abre uma tela a partir de uma conversa é o botão da persona — e ela só **oferece**, não abre. Um agente que responde numa conversa (não a persona) não tem nenhuma ferramenta de ação: recebe leitura, a chamada a um par e as tarefas da persona. Então “o agente abre a tela de discussões” não é um encaixe no que existe, é uma superfície nova: u… <!-- answer:127 -->
- Resposta: tentar novamente <!-- answer:164 -->

## Restrições

- O destino `discussions` exige a referência em três lugares (`push.ts`, `pushTarget.ts`, `OpenScreen`); os três aceitam o par projeto+número.
- Propor resposta e resolução continua exigindo o card.
- Toda string passa por `t()` nos dois catálogos; repositório público.
- PR com base na release aberta (0.10.0), nunca na main.
- Todo canal IPC novo precisa de lugar em `src/main/persona/doorTable.ts` (operação ou exclusão), senão `persona-door-table` falha.

## Tentado e descartado

- Ler threads por `VcsRead` não basta: faltava a superfície da tela.
- Reaproveitar `id` ou `mr` para o número da MR: descartado (Q1).
- Tornar `feedback:discussions:open/opened` operações da persona: descartado (a persona lê por `VcsRead`; a linha registra o toque da pessoa).

## Perguntas abertas

- Q3 (celular pareado), Q5 (escopo da execução estreitar a lista), Q6 (texto da recusa), Q7 (marco): da pessoa, no aceite.

## Onde o trabalho está

- Merge com a release preparado no worktree (sem commit; o app commita). Depois do merge: tsc ok, 7 arquivos tocados 124 passam, i18n (6150 chaves), theme, public-audit ok (ev-12). Vitest completo: falhas só nos 4 arquivos de navegador (`@playwright/mcp` ausente) e `conflict-from-mr` sob carga (passa sozinho).
- Não verificado: `electron-vite build` depois do merge; o host sem conflito depois do push; a tela no app (chat, Fórum, execução), a linha no thread, o voltar, celular pareado.
- `public-audit` acusa 2 achados só se `out/` do build existir; apagar `out/` depois do build.
- Sugestão menor não tratada: `discussionsOpened` grava uma linha por toque.
- Passagem dev-experiencia → revisão: conferir a resolução dos 4 arquivos e a exclusão em `doorTable.ts`; rodar `electron-vite build`; abrir o PR com base `release/0.10.0`.
- Passagem support → product-owner: O gate 1 decide se a spec (`1_SPEC.md`) segue. A próxima etapa (plano técnico) precisa tratar os três pontos que a triagem achou e a issue não cobre: construir o rigor de projeto no caminho da tela (`listDiscussions`/`explainDiscussion` hoje vão ao provedor direto), fazer a explicação de cada thread funcionar sem o card inteiro no prompt, e levar projeto + número da MR num destino que hoje só tem `ref`/`id`/`mr` — o que toca `src/shared/push.ts`, `src/renderer/src/pushTarget.ts` e o `openScreen` da persona. Nada aqui foi executado; nenhuma tela foi aberta. <!-- handoff:139 -->
- Passagem product-owner → pessoa: O gate 1 decide a spec (`1_SPEC.md`) e, em especial, as duas decisões de base que bloqueiam o plano: (a) se um agente que não é a persona pode abrir uma tela a partir de uma resposta — se a pessoa recusar, as regras 15 a 18 saem e a mudança fica nos botões da persona; (b) como a explicação se comporta sem o card (segue e perde a linha do card / só lista / lista com recado). O plano técnico precisa tratar cinco pontos: construir o rigor de projeto no caminho da tela (hoje a lista e a explicação vão ao provedor direto, com a validação só de formato), fazer a explicação funcionar sem o card intei… <!-- handoff:149 -->
- Passagem tl-experiencia → pessoa: Implementar as mudanças descritas no plano, começando pelos seletores e roteamento, seguido pelas telas e pelos backends. Após cada mudança, executar os testes correspondentes para verificar o comportamento. <!-- handoff:179 -->
- Passagem dev-experiencia → revisor-experiencia: Revisar o diff contra a spec e o plano. Pontos a olhar: - A regra 16 (linha de sistema no thread) não foi implementada. - O voltar leva ao chat (home), e não à conversa exata de onde a tela veio. - O escopo de execução não estreita a lista de projetos (Q5). - O botão de outro agente num thread de execução não foi exercitado. Na interface nada foi conferido: a QA precisa abrir a tela por um botão com projeto e número, num workspace com um provedor falso. `npx vitest run` só falha nos 4 arquivos de navegador, por `@playwright/mcp` ausente no `node_modules` do worktree; rodar de novo com as depen… <!-- handoff:267 -->
- Passagem revisor-experiencia → dev-experiencia: Revisão por leitura do diff: a base está sólida (alcance estrito centralizado, recusas com motivo nos dois idiomas, destino validado em três lugares, nada escrito no host), mas dois critérios de aceite não foram atendidos (4/regra 16 e 14) e o botão do outro agente não aparece em conversa de execução (critério 5). Veredito: changes. Nada foi executado nesta etapa. [bloqueia] src/main/mentions/answer.ts:433: A ferramenta OpenDiscussions é oferecida a todo agente não persona, mas os botões só são desenhados na conversa da persona (ChatThread não compacta). Numa conversa de execução o botão é gra… <!-- handoff:274 -->
- Passagem dev-experiencia → revisor-experiencia: Revisar só os três bloqueantes e as duas sugestões, no diff desta tentativa: - `Thread.tsx` desenha os botões, com `onOpen` passado por `RunScreen` e `ForumScreen`. - `openButton.ts` e `discussionsOpened` (`feedback.ts`): a linha só é gravada para um botão que o thread carrega. - O `back` em `App.tsx`, `pushTarget.buttonScreen` e `Discussions.tsx`. - O endurecimento de `PROJECT` e os testes novos. Gates rodados: tsc, os testes tocados e os três lints passam. O vitest completo falha só nos 4 arquivos de navegador (`@playwright/mcp` ausente). Na primeira rodada, `conflict-resolve` falhou sob car… <!-- handoff:297 -->
- Passagem revisor-experiencia → qa-experiencia: Revisão aprovada: os três bloqueantes foram tratados. A QA deve abrir a tela por um botão com projeto e número, com provedor falso, no chat da persona, no Fórum e na execução, conferindo a linha no thread e o voltar; rodar também electron-vite build. <!-- handoff:303 -->
- Passagem qa-experiencia → integrator: QA: gates automáticos (tsc, testes tocados, i18n, theme, public, build) passam. A tela não foi exercitada no app; decidir se aceita assim ou se alguém abre chat, Fórum e execução com provedor falso. Q3, Q5, Q6, Q7 seguem para a pessoa. <!-- handoff:323 -->
- Passagem integrator → pessoa: Integração: gates do CI passam (tsc, theme, i18n, public sem out/, build, testes tocados). Não verificados por falta de .git na sandbox: atraso da base, esquema contra a release e PRs abertos. Abra o PR com base release/0.10.0 e confira antes se a branch está atrás. A tela não foi exercitada no app; Q3, Q5, Q6, Q7 ficam para a pessoa. <!-- handoff:346 -->
- Passagem pessoa → dev-experiencia: a branch está com conflitos com a base, devem ser resolvidos antes do merge Contexto para o pedido acima, não trabalho novo: o que a revisão e a QA deixaram em aberto. Pontos em aberto da revisão (rodada 2), os que bloqueiam e as sugestões. Trate cada um, ou diga por que não vai tratar: [sugestão] src/main/feedback.ts:441-445: Cada toque no mesmo botão grava uma nova linha de sistema; toques repetidos poluem o thread. Não bloqueia. O que o QA não aprovou ou não conseguiu verificar: - Esquema, base atrás da release e base do PR (não rodou): Sandbox sem .git (git falha); vcs_read não lista branc… <!-- handoff:354 -->
