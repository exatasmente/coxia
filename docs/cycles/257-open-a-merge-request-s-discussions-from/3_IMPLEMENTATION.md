# Discussões de uma MR abertas por projeto e número

A tela de discussões passa a abrir uma merge request pelo projeto (`group/repo`) e pelo número, sem card do dia. Ela abre por um botão sob uma resposta numa conversa: o da persona ou o de qualquer outro agente que responde ali. Nada abre sem a pessoa tocar.

## O que mudou, por arquivo

### Destino e validação
- `src/shared/push.ts`
  - `PushTarget` ganha `project` e `number` (decisão Q1 do plano: campo novo, nada reaproveitado de `id` ou `mr`).
  - `parseTarget` aceita o par só quando ele vem inteiro e só para `discussions`; `discussions` com o par dispensa `ref`.
  - `targetQuery`, `targetFromSearch` e `noticeTarget` carregam o par. Na URL, o número é só dígitos.
  - Exporta `PROJECT` e `isMrNumber`.
- `src/renderer/src/pushTarget.ts`: um destino com o par vira a tela `{ name: 'discussions', project, number }`.
- `src/main/forum-core.ts`: o esquema do botão gravado na mensagem aceita `project` e `number`.

### Rigor de projeto
- `src/main/vcs/readTool.ts`: `mrOutOfReach(project, number, allowed)` aplica a regra estrita da ferramenta de leitura.
  - Recusa com motivo um nome malformado (`main.feedback.badMrTarget`).
  - Recusa um workspace sem projetos (`main.feedback.noProjects`).
  - Recusa um projeto fora da lista (`main.feedback.projectNotAllowed`).
- `src/main/feedback.ts`
  - `openDiscussions(project, number)` confere o alcance antes de qualquer leitura do host. Depois lê a MR (`getMr`): se o host não a dá, recusa com `main.feedback.mrUnreadable`, sem dizer o que o número seria. Só então lista os threads.
  - Handler novo: `feedback:discussions:open`.
  - `explainDiscussion(card | null, …)`: sem card, confere o alcance e usa o prompt `discussion.mainMr`, sem a issue, o título e a linha da spec (decisão Q4, alternativa a). Com card, nada muda.
- `src/main/retention-core.ts`: registra o prompt novo.

### Os botões
- `src/main/persona/openScreen.ts`
  - `OpenScreen` aceita `project` e `number` para `discussions`. `whyNot` confere o par com `facts.projects()`.
  - A chave de repetição dos botões inclui o par, e o teto de quatro não muda.
  - Ferramenta nova `OpenDiscussions` (`openDiscussionsTool`) para um agente que não é a persona: recebe projeto e número, recusa com motivo e só acrescenta um botão (decisão Q2).
- `src/main/persona/runtime.ts`: `projects: workspaceProjects` nos fatos da persona.
- `src/main/mentions/answer.ts`
  - Um agente que não é a persona recebe `OpenDiscussions` nas ferramentas da resposta.
  - A mensagem dele carrega `buttons` só quando ele ofereceu um.
- `src/renderer/src/chatModel.ts`: `buttonLabel` diz a MR (`ui.chat.button.discussionsMr`, `{project}{crMark}{number}`).
- `src/renderer/src/screens/persona/ChatMessage.tsx` e `ChatThread.tsx`: a bolha de outro agente mostra os botões dele.
- `src/shared/forum.ts`: comentário do campo `buttons`.

### A tela
- `src/renderer/src/App.tsx`: rota nova de `discussions` por `project` e `number`; a rota por `ref` continua igual.
- `src/renderer/src/screens/Discussions.tsx`, sem card:
  - lê a lista ao abrir e no Atualizar, sem trabalho na barra de jobs;
  - explica sem job;
  - o cabeçalho cita a MR (`ui.discussions.headerMr`, `ui.discussions.mrName`);
  - não oferece responder nem resolver e diz por quê (`ui.discussions.noCard`).
  - Com card, o comportamento de hoje fica.
- `src/renderer/src/feedbackApi.ts`: `openDiscussions`; `explainDiscussion` aceita `null`.

### Textos
- Chaves novas nos dois catálogos: `ui-persona`, `ui-gate`, `main`, e o prompt `prompt.sdd.discussion.mainMr` em `en.json` e `pt-BR.json`.

### CHANGELOG
- `Unreleased › Added`.

## Testes

- `test/discussions-by-mr.test.ts` (novo), com o provedor e o agente falsos. Cobre:
  - `mrOutOfReach` nas três recusas;
  - a lista só com threads não resolvidos;
  - a nova leitura a cada abertura;
  - a recusa antes de ler do host;
  - o número que o host não dá como MR, recusado sem citar issue;
  - a explicação sem card, com prompt sem issue, e sua recusa fora do workspace sem chamar o modelo.
- `test/push-targets.test.ts`:
  - o par passa por `parseTarget`, pela URL e por `noticeTarget`;
  - meio par, nome ruim, número ruim e o par em outra tela são recusados;
  - `targetToScreen` por par e por `ref`.
- `test/persona-open-screen.test.ts`:
  - o botão da persona por par, com repetição e com as recusas;
  - `OpenDiscussions`: só acrescenta um botão, não é da persona e recusa com motivo.
- `test/chat-model.test.ts`: o rótulo cita a MR nos dois idiomas, e o rótulo por `ref` fica.

## Verificação (rodado nesta tentativa)

- `npx tsc --noEmit`: ok.
- `npx vitest run` nos 4 arquivos acima: 72 testes passam.
- `npx vitest run` completo: 8201 passam, 2 falham e 15 são pulados.
  - As falhas ficam em 4 arquivos de navegador (`browser-contract`, `browser-runtime`, `browser-sites`, `browser-quit`).
  - O erro é `Cannot find module '@playwright/mcp/...'`: a dependência falta no `node_modules` deste worktree. Esta mudança não toca esses arquivos.
- `npm run i18n:lint`: ok.
- `node scripts/theme-audit.mjs`: ok.
- `node scripts/public-audit.mjs`: ok.

## Não verificado

- A tela não foi aberta no app: nenhum cenário de interface rodou.
- `electron-vite build` não rodou.
- O botão de um agente numa conversa de execução (regra 18) não foi exercitado: como o thread de execução mostra `buttons` não foi conferido.
- O celular pareado (Q3) não foi testado.

## Diferenças em relação à spec, para a revisão

- **Regra 16, a linha de sistema no thread:** não implementada. O app não registra no thread o que foi aberto.
- **Critério 14:** o voltar da tela leva à home, que hoje é o chat, e não à conversa exata de onde veio.
- **Q5 e regra 4, o escopo de execução:** a ferramenta usa os projetos do workspace e não estreita pela execução.
- **Q6:** a recusa de um número que o host não dá como MR repete o motivo do host e não afirma o que o número é.
