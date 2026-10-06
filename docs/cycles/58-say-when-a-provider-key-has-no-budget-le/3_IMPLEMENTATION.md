# O orçamento esgotado da chave virou espera com o motivo, nos dois motores

## O que ficou diferente

A recusa por orçamento da chave deixou de ser uma falha genérica e passou a ser um motivo próprio, com
a execução esperando em vez de gastar tentativa:

- Quando uma chamada termina sem saída estruturada, a falha passa a carregar o texto que o provedor
  devolveu, e nunca apenas o subtipo do SDK. `agent ended with success` deixou de existir como causa.
  O texto de fora passa pelo mesmo mascaramento do resto.
- Uma recusa por orçamento (HTTP 402; um 403 cujo corpo fala de limite, cota, crédito ou saldo; um 429
  que não passa) é reconhecida como um motivo de orçamento, e a mensagem diz, em palavras simples, que o
  orçamento da chave daquele provedor acabou, nomeando o provedor. Nos dois motores: Claude SDK e aberto.
- A execução que bate nisso fica em `waiting` com `wait.kind: 'budget'` (com o provedor e o motivo), em
  vez de `failed`; o retry não é oferecido, e o caminho de "seguir sem esperar" continua valendo.
- Enquanto o provedor está sem orçamento, nada novo começa nele: a próxima etapa de uma execução que
  esperava, uma execução nova do escalonador e uma menção (`@agente`) ficam seguradas, com a conversa
  dizendo por quê.
- A passada de 5 minutos faz uma sondagem por provedor (nunca uma por execução); quando ela passa, todas
  as execuções que esperavam por aquele provedor seguem de onde pararam.

## O que foi implementado

### A classificação, uma só para os dois motores

`src/main/engine/budget.ts` (novo) reúne a regra pura:

- `classifyBudget(status, body)`: 402 por definição; 403 cujo corpo casa limite, cota, crédito, saldo,
  `insufficient`, `payment required`, `exceeded your current quota`, `key limit exceeded`, `monthly limit`;
  429 com esses mesmos termos e **sem** os termos de um rate limit comum (`rate limit`, `too many requests`,
  `try again`, `retry after`).
- `budgetRefusal(status, body)`, usado pelo motor aberto, só considera 402 e o 403 com corpo de orçamento; um
  429 que carrega cota continua caindo em `quota` (não retentável, que já existia), preservando o
  comportamento e os testes de hoje.
- `readTextRefusal` / `budgetText`: leem um texto plano (`API Error: 403 Key limit exceeded (monthly limit)`),
  com o prefixo "Failed to authenticate" do SDK. Nunca casam só por "authenticate", e nunca por um 401 ou
  "invalid api key", que continuam sendo problema de chave.
- `clipProviderText(text)`: o corte do texto de fora que entra na mensagem.

### O motivo compartilhado

`ProviderBudgetError` em `src/main/engine/contract.ts`, com `provider` (id em `llm.providers`), `engine`
(`'claude-sdk'` | `'open'`) e `detail` (o texto do provedor, já mascarado). Não tem mensagem de interface
própria: quem monta a frase é o executor, onde o idioma está em vigor.

### Os dois motores

- **Aberto** (`src/main/engine/open/errors.ts`): `ErrorKind` ganhou `'budget'`; o mapeamento classifica o 402
  e o 403 com corpo de orçamento antes do `forbidden`, com `retryable: false` e a mensagem
  `main.engine.budget` (com o provedor). `messages.ts` ganhou `'budget'` em `MSG_KEYS`.
  `src/main/engine/open/loop.ts` propaga o `EngineError` de `kind === 'budget'` em vez de virar resposta
  vazia. `src/main/engine/open/bridge.ts` (`runOpenOnce`) e `runOpenEngine` em `src/main/agents.ts` traduzem
  para `ProviderBudgetError`.
- **Claude SDK** (`src/main/agents.ts`, `runClaudeSdk`): o laço acumula o texto dos blocos de assistente
  (limitado por `clipProviderText`) e, no `result` sem saída estruturada, classifica o texto (mais o campo
  `result` do SDK, quando houver). Uma recusa por orçamento lança `ProviderBudgetError`; senão a falha passa
  a ser `agent failed: <texto do provedor>` (mascarado), em vez de só o subtipo. `error_max_turns` continua
  lançando `MaxTurnsError` antes de tudo, e a retomada de resposta parcial não muda.
- `runAgent` (usado por etapas, menções e cadeia) reescreve o `ProviderBudgetError` com o provedor resolvido
  do alvo, para o texto nomear sempre o provedor certo.

### Do motor ao runner

- `src/main/runner/executor.ts`: `STAGE_ERROR_CODES` ganhou `'budget'`; `StageError` passou a guardar os
  `params`; o `catch` da chamada do estágio traduz `ProviderBudgetError` em `StageError('budget', { provider,
  engine, detail })`.
- `src/main/runner/service.ts`: quando a falha da etapa é um `StageError` de código `budget`, o serviço aplica
  a transição de espera em vez de `stageFailed`. Um mapa de provedores em espera (`budget: Map<string,
  WaitingProvider>`) faz `pump`, `scanIssues` e `answerMention` pararem de começar trabalho no provedor. A
  passada chama `probeWaitingProviders`, que faz **uma** sondagem por provedor e, quando ela passa, aplica
  `waitDone` a todas as execuções que esperavam por ele e limpa a entrada do mapa. `resume` reconstrói o mapa
  a partir dos `wait` gravados, para o app reaberto não deixar execuções presas.
- `src/main/runner/budget.ts` (novo): tipos da sondagem (`BudgetProbe`, `BudgetProbeResult`, `WaitingProvider`,
  `BudgetProbeFn`) e `probeStateOf` (uma recusa por orçamento é `out`; qualquer outra coisa é `unknown`, e as
  execuções continuam esperando).
- `src/main/runner/module.ts`: injeta o `probeBudget` real, que chama `probeProviderBudget` (novo, em
  `src/main/agents.ts`), uma chamada mínima pelo mesmo motor do provedor.

### O estado da execução

- `src/shared/config/types.ts`: `WAIT_KINDS` ganhou `'budget'`.
- `src/shared/runs/types.ts`: `WaitState` ganhou `provider?` e `detail?`.
- `src/shared/runs/schema.ts`: o objeto `wait` ganhou `provider` e `detail`, para o arquivo gravado com esses
  campos ser aceito (`additionalProperties: false`). `RUN_VERSION` não mudou e os campos são opcionais.
- `src/shared/runs/transitions.ts`: transição nova `stageWaitingOnBudget(run, { provider, engine, detail }, at)` —
  a etapa fica `waiting`, `run.status = 'waiting'`, `run.wait = { kind: 'budget', since, provider, detail }`,
  histórico `wait-started` e a mensagem `run.stage.wait.budget`. `waitDone` passa o `provider` nos params da
  mensagem `wait.done.*`.
- `src/shared/runs/view.ts` não mudou: `waiting` já oferece `skipWait` e `sendBack`, e não `retry`.

### Interface e catálogos

Chaves novas nos dois idiomas: `main.engine.budget`, `main.runner.error.budget`,
`main.forum.code.run.stage.wait.budget`, `main.forum.code.wait.done.budget`,
`main.forum.code.runner.mention.budget`, `main.errorlog.hint.budget`, `prompt.sdd.system.budgetProbe`,
`ui.cycle.wait.budget`, `ui.cycle.action.skipWait.budget`, `ui.flow.wait.budget`. `names.ts` e `labels.ts`
ganharam a entrada `budget`. `src/shared/errorlog.ts` ganhou a regra de dica neutra (sem nomear provedor
nenhum) para o texto relatado.

### Testes

- `test/engine-open-client.test.ts`: 402 e 403 com corpo de orçamento (o texto exato da issue, com o prefixo
  "Failed to authenticate") caem em `budget`, não são retentados e nomeiam o provedor; um 403 comum continua
  `forbidden` e um 429 comum continua `rate_limit` retentável; o 429 com `insufficient_quota` continua `quota`.
- `test/agent-budget.test.ts` (novo, com o SDK falso): a falha sem saída estruturada carrega o texto do
  provedor; o texto externo sai mascarado; a recusa por orçamento com o texto da issue é um
  `ProviderBudgetError` que nomeia o provedor e não menciona `agent ended with success`; um 401 e um
  "authenticate" sozinho não são recusa de orçamento; `error_max_turns` continua sendo `MaxTurnsError`.
- `test/runner-lifecycle.test.ts`: a recusa por orçamento deixa a execução `waiting` com
  `wait.kind === 'budget'` e o provedor, sem `error`, sem `retry` nas ações e com a mensagem na conversa;
  `skipWait` continua levando a execução adiante; a execução é lida do disco pelo esquema novo e `resume` não
  a transforma em etapa a recomeçar; um provedor em espera segura uma execução nova (`scan`) e uma menção; a
  sondagem é uma por provedor (o dublê conta as chamadas) e a execução segue quando ela passa; a sondagem que
  ainda recusa mantém a espera.
- `test/errorlog.test.ts`: o texto exato da issue recebe a dica neutra de orçamento, e as dicas de 401/402 da
  OpenRouter continuam valendo.
- `test/helpers/runner.ts`: `BootOptions` ganhou `probeBudget`, repassado ao runner.

## O que foi verificado nesta etapa

Rodado nesta etapa, no worktree:

- `npx tsc --noEmit` — sem erros.
- `npx vitest run` — 3540 testes passam, 212 de 213 arquivos verdes. As duas falhas restantes estão em
  `test/release-script.test.ts` (git real contra um remoto), que passam sozinhas e não tocam este caminho.
- `node scripts/theme-audit.mjs`, `npm run i18n:lint` (4004 chaves nos dois idiomas) e
  `node scripts/public-audit.mjs` — verdes.
- Conferência direta da classificação com o texto exato da issue, um 401, um texto só com "authenticate", um
  429 com cota, um 429 comum e um 402.

Não verificado nesta etapa: a sondagem real pelo motor (o teste exercita o `probeBudget` injetado, não a
chamada de modelo de `probeProviderBudget`); um run de verdade do app contra um provedor sem orçamento; o
`electron-vite build` do CI, que não roda aqui.

## Fora do escopo

- Corrigir a chave, aumentar o orçamento ou trocar de provedor.
- Descobrir o valor exato do orçamento.
- Um teto de espera curto e automático para a espera por orçamento.
- Outras classes de erro (401, 404, contexto, ferramentas): continuam como estavam.
- Tela nova: o comportamento aparece na conversa da execução e nos selos que já existem.
