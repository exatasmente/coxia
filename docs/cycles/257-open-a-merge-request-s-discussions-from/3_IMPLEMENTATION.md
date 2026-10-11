# Discussões de uma MR abertas por projeto e número

A tela de discussões passa a abrir uma merge request pelo projeto (`group/repo`) e pelo número, sem card do dia. Ela abre por um botão sob uma resposta numa conversa: o da persona ou o de qualquer outro agente que responde ali (chat da persona, Fórum ou conversa de execução). Nada abre sem a pessoa tocar. Ao tocar, a conversa ganha uma linha dizendo qual MR foi aberta, e o voltar da tela leva de volta a essa conversa.

## O que mudou nesta tentativa (bloqueantes da revisão)

1. **Botão em conversa de execução (critério 5 / regra 18).** `src/renderer/src/screens/cycle/Thread.tsx` ganhou `onOpen`: com ele, a mensagem de um agente que traz `buttons` mostra os botões (o mesmo `Buttons` de `ChatMessage.tsx`). `RunScreen.tsx` (aba de conversa) e `ForumScreen.tsx` passam `onOpen`. O teste do assistente continua sem botões (sem `onOpen`).
2. **Linha de sistema no thread (critério 4 / regra 16).**
   - `src/renderer/src/openButton.ts` (novo): um toque num botão abre a tela neste dispositivo. Quando o destino é discussões por projeto e número, chama `feedbackApi.discussionsOpened(thread, project, number)`. A linha é registro, não portão: a tela abre mesmo se a gravação falhar.
   - `src/main/feedback.ts`: `discussionsOpened` (canal `feedback:discussions:opened`) grava `{ kind: 'system', code: 'main.feedback.opened', params: { project, number } }`, mas só se uma mensagem daquele thread carrega um botão com aquele par. Nenhum chamador escreve uma linha sobre outra coisa, e nada é lido do host.
   - Texto `main.forum.code.main.feedback.opened` nos dois catálogos (`main.en.json`, `main.pt-BR.json`).
3. **Voltar à conversa (critério 14).**
   - `App.tsx`: a rota `{ name: 'discussions', project, number, back? }`.
   - `Discussions.tsx`: usa `back` (HOME quando falta) nos dois botões de voltar.
   - `pushTarget.ts`: `buttonScreen(target, hasCards, back)` põe o `back` só no destino por projeto e número. O destino por `ref` fica como antes.
   - O `back` de cada superfície: o chat da persona volta a HOME, que é o chat; o Fórum volta a `{ name: 'forum', thread }`; a execução volta a `{ name: 'run', id, tab: 'forum' }`.

## Sugestões da revisão também tratadas

- `src/shared/push.ts`: `PROJECT` recusa segmentos feitos só de pontos (`../..`, `group/..`, `./app`, `group/.`).
- Testes novos:
  - `test/mentions-open-discussions.test.ts` (novo), sobre a fiação de `answerMentions`:
    - o agente ofereceu e a mensagem leva `buttons`;
    - não ofereceu e a mensagem vai sem `buttons`;
    - o projeto está fora do workspace: recusa com motivo ao modelo e nenhum botão.
  - `test/discussions-by-mr.test.ts`: `discussionsOpened` grava a linha só para um botão que o thread carrega e recusa par ou tipos que não batem.
  - `test/push-targets.test.ts`:
    - `buttonScreen` com `back` só para o par;
    - `openButton` registra a linha só para o par;
    - os nomes com pontos são recusados.

## O que já estava feito (tentativas anteriores, conferido pelo código)

- O destino `PushTarget` com `project` e `number` (Q1), validado em `push.ts`, `pushTarget.ts` e `openScreen.ts`.
- `mrOutOfReach` estrito em `readTool.ts`, aplicado antes de qualquer leitura do host em `openDiscussions` e em `explainDiscussion` sem card.
- `explainDiscussion(null, …)` com o prompt `discussion.mainMr` (Q4 a).
- A tela sem card: lê a cada abertura, sem job, sem responder nem resolver.
- A ferramenta `OpenDiscussions` para quem não é a persona (Q2).
- O rótulo do botão com `{project}{crMark}{number}`.
- `CHANGELOG.md`: a entrada em Unreleased › Added foi completada nesta tentativa com a linha na conversa e o voltar.

## Verificação (rodado nesta tentativa)

- `npx tsc --noEmit`: ok.
- `npx vitest run` nos 6 arquivos tocados (`discussions-by-mr`, `push-targets`, `mentions-open-discussions`, `persona-open-screen`, `chat-model`, `jobs`): 102 passam.
- `npx vitest run` completo, duas vezes:
  - 1ª: 13 falhas em 5 arquivos. Uma era `test/conflict-resolve.test.ts` ("este conflito já tem um passo em andamento"); rodado sozinho, passa 22/22.
  - 2ª: 8210 passam, 2 falham e 15 são pulados. As falhas ficam só nos 4 arquivos de navegador (`browser-contract`, `browser-runtime`, `browser-sites`, `browser-quit`), por `@playwright/mcp` ausente no `node_modules` deste worktree. Esta mudança não toca esses arquivos.
- `npm run i18n:lint`: ok (5927 chaves nos dois idiomas).
- `node scripts/theme-audit.mjs`: ok.
- `node scripts/public-audit.mjs`: ok.

## Não verificado

- A tela não foi aberta no app; nenhum cenário de interface rodou.
- `electron-vite build` não rodou.
- O desenho da linha de sistema no chat da persona, no Fórum e na execução não foi visto na tela, só gravado pelo teste.
- O celular pareado (Q3) não foi testado.
- A oscilação de `conflict-resolve` sob carga não foi investigada; fica fora do escopo.

## Diferenças em relação à spec, para a revisão

- **Q5 / regra 4, o escopo de execução:** a ferramenta usa os projetos do workspace e não estreita a lista pela execução. É decisão da pessoa.
- **Q6:** a recusa de um número que o host não dá como MR repete o motivo do host e não afirma o que o número é.
- A linha de sistema é gravada ao tocar no botão, no main, para um botão que o thread carrega. Ela não confirma que a leitura da tela deu certo: uma recusa aparece na própria tela.
