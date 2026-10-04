# Uma recusa por orçamento da chave vira espera com o motivo, nos dois motores

## Como a mudança é feita

Uma falha por recusa de orçamento deixa de ser uma falha: vira um estado de espera. A peça nova é um
motivo de orçamento compartilhado pelos dois motores (`ProviderBudgetError`, em
`src/main/engine/contract.ts`, com o provedor, o motor e o texto do provedor já mascarado). Onde hoje
uma chamada termina sem saída estruturada e o app lança `agent failed`, o app passa a ler o texto das
mensagens de assistente que já recebe, classifica esse texto e, quando ele é uma recusa de orçamento,
lança o motivo próprio em vez da falha genérica; quando não é, a falha continua como falha, agora
carregando o texto que o provedor devolveu (nunca só o subtipo). O mesmo motivo é lançado pelo motor
aberto, a partir do status HTTP e do corpo da resposta.

O executor da etapa traduz o motivo para um código de `StageError` novo (`budget`); o serviço do runner
não manda a execução para `failed`, e sim para o estado `waiting` com um `wait` de tipo novo
(`budget`), que guarda o provedor, o motor, o motivo em palavras simples e desde quando. É o mesmo
mecanismo que já segura a execução num evento do host, então o reinício do app, a tela e o histórico
seguem valendo sem caminho novo. Enquanto isso, um registro de provedores em espera no serviço do
runner faz `pump`, o escalonador (`scan`) e as menções pararem de começar trabalho naquele provedor;
cada execução que esperava é lembrada por provedor. A passada de 5 minutos faz **uma** chamada de
sondagem por provedor (o mesmo motivo de motor, uma chamada curta, nunca uma por execução); quando
ela passa, todas as execuções que esperavam por aquele provedor voltam a trabalhar.

## Decisões de desenho

### 1. O motivo de orçamento e o provedor nomeado

- `ProviderBudgetError extends Error`, em `src/main/engine/contract.ts`, com `provider` (id do
  provedor em `llm.providers`), `engine` (`claude-sdk` | `open`) e `detail` (o texto do provedor, já
  passado pelo mascaramento compartilhado na construção). A frase que a pessoa lê é o texto de
  catálogo `main.engine.budget` com o nome do provedor; o erro carrega o identificador, e o texto é
  montado no executor/serviço, onde o idioma da interface está em vigor (ver decisão 4).
- No motor **aberto** (`src/main/engine/open/errors.ts`): a classificação já existente ganha o 403
  com corpo de limite/crédito. Regras exatas: 402 continua recusa de orçamento; um 403 cujo
  `detail`/`code`/`type` casa `/limit|credit|quota|billing|balance|insufficient/i` passa a ser
  recusa de orçamento (hoje vai para `forbidden`); um 429 cujo corpo casa
  `/quota|billing|credit|balance/i` continua recusa (não é retentável, como hoje); um 429 que não
  casa segue `rate_limit` retentável. O `code === 'insufficient_quota'` continua valendo para
  qualquer status. Nada casa só pela palavra "authenticate".
- No motor **Claude SDK** (`src/main/agents.ts`, `runClaudeSdk`): o laço já guarda os blocos de
  texto de assistente (`activity?.text(block.text)`). Passa a acumular o texto (limitado, por
  exemplo 4 000 caracteres) e, no `result`:
  - `error_max_turns` continua lançando `MaxTurnsError` (o tratamento de retomada de uma resposta
    parcial não muda — a checagem vem antes da nova);
  - quando `subtype !== 'success'` ou `structured_output == null`, classifica o texto acumulado
    (e também o texto do próprio `result`, quando o SDK o trouxer). Se casar recusa de orçamento,
    lança `ProviderBudgetError`; senão lança `new Error('agent failed: ' + redact(erroDoProvedor ||
    ('agent ended with ' + subtype)))`.
- A classificação em si é uma função pura nova (`budgetErrorOf`/`classifyBudget`) em um módulo de
  engine compartilhado (por exemplo `src/main/engine/budget.ts`), usada pelos dois motores, para as
  regras serem uma coisa só. Ela casa o formato HTTP sobre o texto: `402`, `403` + corpo de
  limite/crédito, `429` que não passa. O prefixo "Failed to authenticate" do SDK não muda nada: o
  casamento do 403 olha o corpo, nunca só "authenticate".

### 2. O erro do provedor na falha genérica

- A mensagem passa a ser `agent failed: <texto do provedor>` (o algoritmo exato da string fica na
  implementação, no espírito do `agent ended with error_max_turns` que o log de erros já reconhece).
  O subtipo não é mais a única informação.
- O texto que vem de fora passa por `redact` (`src/main/errorlog-core.ts`) antes de entrar na
  mensagem, no ponto do motor, porque o motor roda em contexto de trabalho (sem tradução/idioma
  garantidos) e `redact` é puro.
- `nextErrorHint` (`src/main/errorlog-core.ts`): uma regra nova para orçamento — `/402|insufficient
  (quota|credits|funds)|payment required|out of credits|key limit exceeded|monthly limit|
  exceeded your current quota/i` → chave de catálogo de dica nova, **em provedor neutro** (sem
  nomear nenhum provedor real), usada por app, produto e suporte.
- O teste de dica existente que hoje espera as chaves da OpenRouter para `402` e para o 401 da
  OpenRouter continua passando: as regras da OpenRouter vêm antes, e o novo teste usa um texto sem
  a palavra OpenRouter.

### 3. Do motor ao runner

- `engine/open/loop.ts`: o caminho de tool-calling converte `EngineError`/`StructuredOutputError` em
  uma resposta vazia. Antes dessa conversão, um `EngineError` com `kind === 'budget'` é propagado
  como `ProviderBudgetError` (senão a recusa vira "resposta sem saída estruturada" e volta para a
  falha genérica). O `kind` novo (`'budget'`) entra em `ErrorKind` e em `MSG_KEYS`.
- `runOpenOnce` (`engine/open/bridge.ts`) e `runOpenEngine` (`src/main/agents.ts`): traduzem o
  `EngineError` de `kind === 'budget'` para `ProviderBudgetError`, com o provedor da seleção
  (`req.target.providerId`; no caminho do ambiente, `'COXIA_ENGINE=open'`). Um `catch` no
  `runOpenEngine` é o ponto natural.
- `runAgent` (`src/main/agents.ts`, usado pelo runner para etapas, menções e cadeia): captura o
  `ProviderBudgetError` que subiu da chamada guardada pelo watchdog e anexa (quando ausente) o
  provedor resolvido (`target.providerId`) e o motor. É a costura única para etapas, menções e
  cadeia.
- `src/main/runner/executor.ts`: `STAGE_ERROR_CODES` ganha `'budget'`; o `catch` da chamada do
  estágio (`runStage`) traduz `ProviderBudgetError` para `new StageError('budget', { provider,
  engine, detail })`, para as etapas irem por um caminho só. A mesma tradução no `catch` de
  `answerMention` e no de `walkChain` (uma única frase de catálogo para a conversa, com o provedor).
- O texto do catálogo é montado onde o idioma está em vigor: no runner (serviço/executor), a partir
  de `t('main.engine.budget', { provider })`. As chamadas de cerimônia não-`runAgent` seguem o
  caminho de falha de hoje.

### 4. A execução espera em vez de falhar

- `src/shared/runs/types.ts`: `WAIT_KINDS` ganha `'budget'`; `WaitState` ganha `provider?: string` e
  `detail?: string`. `RUN_STATUSES` não muda (a execução fica em `waiting`).
- `src/shared/runs/schema.ts`: o objeto `wait` ganha `provider` e `detail` (strings, limite de
  tamanho) — sem isso o arquivo da execução gravado com esses campos seria recusado por
  `additionalProperties: false`. O tipo de `runSnapshot`/`RUN_VERSION` fica como está: o campo é
  opcional e o esquema continua lendo arquivos antigos.
- `src/shared/runs/transitions.ts`: transição nova `stageWaitingOnBudget(run, input, at)` —
  `need(run, 'working')`, a etapa fica `waiting`, `run.status = 'waiting'`,
  `run.wait = { kind: 'budget', since: at, provider, detail }`, histórico `wait-started` com tipo
  `budget`, e a mensagem da conversa `run.stage.wait.budget` (com o provedor e o motivo). Nada é
  apagado: a tentativa já usou o que usou, e o que o agente escreveu no worktree fica lá.
- `src/main/runner/service.ts`, em `step`: quando a falha é `StageError` de código `budget`, aplica
  a transição nova em vez de `fail(...)`. As esperas do provedor ficam num mapa `budget: Map<string,
  { engine, reason, since }>` (limpo quando a sondagem passa).
- `runActions` (`src/shared/runs/view.ts`): `waiting` continua oferecendo `skipWait` (com motivo) e
  `sendBack`; **não** oferece `retry` (não é `failed`). Nenhuma ação nova: é o mesmo caminho de uma
  espera.
- A conversa da execução recebe: a tentativa que bateu na recusa (mensagem `run.stage.wait.budget`
  com o provedor e o motivo), e, quando a pessoa segue sem esperar, a `wait.skipped` que já existe.
  A mensagem de espera do provedor não é a mensagem genérica de falha.

### 5. Nada novo começa naquele provedor

- `pump(runId)` (`service.ts`): antes de `drive`, se `run.issue.ref` está no mapa de espera, não
  começa a próxima etapa daquela execução. É a peça que faz uma execução em espera com várias
  etapas seguidas não avançar para uma etapa que também usaria o provedor.
- `scanIssues()`: com qualquer provedor em espera, não inicia execuções novas
  (`if (budget.size) return []`). O motivo vai ao log; a decisão é conservadora de propósito (não
  se sabe, sem resolver o papel, qual provedor cada execução nova usaria; hoje o ciclo usa um
  provedor para todos os papéis).
- `answerMention` (`service.ts`): antes da chamada, se `target.providerId` do modelo do agente
  está em espera, a resposta da menção não começa; a conversa recebe um sistema que diz que
  o provedor está sem orçamento e que a menção será retomada quando ele voltar. O mesmo na
  `walkChain`: a pergunta continua seguindo para o próximo (o comportamento de falha de hoje), sem
  gastar uma chamada no provedor que está fora.
- A menção é **por chamada**, então uma menção que bate na recusa entra no caminho `ProviderBudgetError`
  (decisão 3) e a conversa recebe a mensagem de orçamento — a mensagem de menção falhada existente
  sai com o motivo do provedor.

### 6. Uma sondagem só, e a retomada de todas as execuções

- A sondagem é uma **chamada de modelo pequena** (`probeBudgetProvider` em `src/main/runner/budget.ts`),
  feita pelo método novo do runner (`probeWaitingProviders`), chamado por `lookForEvents`
  (`runForEvents` na passada de `tick`), que já roda a cada 5 minutos e já nunca espera uma etapa
  terminar. Ela usa o mesmo motor (aberto ou SDK) e a mesma resolução de provedor do alvo, com um
  limite de tempo curto e um prompt mínimo (1 token), e devolve `ok | still-out | unknown`.
  - Para o motor aberto, a sondagem reusa `ChatClient.complete` com um prompt curto e `maxTokens: 1`,
    lendo o `EngineError.kind`: `'budget'` → ainda fora; 5xx/`network` → `unknown` (a execução
    continua esperando, para não retomar sem certeza).
  - Para o motor `claude-sdk` (o caminho que mais importa, porque foi o relatado), a sondagem é a
    chamada de SDK de menor custo disponível: `runClaudeSdk` com `extra: { maxTurns: 1 }` e um
    prompt mínimo. Ela reusa exatamente a mesma classificação dos dois motores, então uma sondagem
    que bate na recusa continua fora e uma que passa libera as execuções. O executor do runner
    ganha o gancho opcional `probe(providerId)` (ausente nos testes de unidade que não o dão →
    nenhuma sondagem, as execuções continuam esperando; é o desenho conservador).
  - `claudeExecutable()` hoje lança quando não há CLI configurada; o caminho de sondagem usa
    `loadClaudeQuery()` e o ambiente do provedor já resolvido pela config, sem o caminho de falha.
- Quando a sondagem passa: todas as execuções em `waiting` com `wait.kind === 'budget'` daquele
  provedor são movidas com `waitDone(run, flow, {}, at)` — `waitDone` já trata um estágio de
  trabalho devolvendo a execução a `working` com a etapa em `running`. O mapa de provedores em
  espera é limpo para aquele provedor. É uma sondagem, não uma por execução.
- A sondagem também é oferecida quando o app abre (o `resume` do runner já existe) para não deixar
  execuções presas sem nunca tentar.

## Arquivos

**Runtime (motores e provedores)**

- `src/main/engine/budget.ts` (novo): classificação pura da recusa de orçamento por status + corpo,
  e o reconhecimento do texto de resultado do SDK.
- `src/main/engine/contract.ts`: `ProviderBudgetError`.
- `src/main/engine/open/errors.ts`: `ErrorKind` ganha `'budget'`; 403 com corpo de limite/crédito;
  mensagem `budget` com o provedor; `retryable: false`.
- `src/main/engine/open/messages.ts`: `'budget'` em `MSG_KEYS`.
- `src/main/engine/open/client.ts`: no `catch` do `complete`, sem retentativa para `budget` (já é
  `retryable: false`).
- `src/main/engine/open/loop.ts`: propaga `kind === 'budget'` em vez de virar resposta vazia.
- `src/main/engine/open/bridge.ts` / `src/main/agents.ts` (`runOpenEngine`): tradução para
  `ProviderBudgetError`.
- `src/main/agents.ts` (`runClaudeSdk` e `runAgent`): acumula o texto, classifica a recusa, mantém
  `MaxTurnsError`, e anexa provedor/motor ao erro que sobe.

**Runner (espera, travamento e sondagem)**

- `src/main/runner/executor.ts`: `'budget'` em `STAGE_ERROR_CODES`; tradução nos `catch` de
  `runStage`, `answerMention` e `walkChain`; gancho opcional `probe`.
- `src/main/runner/service.ts`: transição de espera, mapa de provedores em espera, `pump`/`scan`/
  `answerMention` segurados, `probeWaitingProviders` na passada, retomada por `waitDone`.
- `src/main/runner/budget.ts` (novo): a sondagem e a razão em palavras simples.

**Estado da execução**

- `src/shared/runs/types.ts`: `WAIT_KINDS` com `'budget'`; `WaitState.provider`/`detail`.
- `src/shared/runs/schema.ts`: `wait.provider`/`wait.detail`.
- `src/shared/runs/transitions.ts`: `stageWaitingOnBudget`.
- `src/shared/runs/view.ts`: nada além do que já existe (o `waiting` já oferece `skipWait`/`sendBack`).

**Interface e catálogos (os dois idiomas)**

- `src/shared/i18n/main.en.json` e `main.pt-BR.json`: a mensagem `main.engine.budget` (diz que o
  orçamento da chave do provedor acabou e **nomeia o provedor**), `main.forum.code.run.stage.wait.budget`
  (etapa, provedor, motivo), `main.forum.code.wait.done.budget` (o provedor voltou e a execução
  segue), e a dica de log `main.errorlog.hint.*` para orçamento.
- `test/fixtures/catalogs-main/main.en.json` e `main.pt-BR.json`: as mesmas chaves, no texto em que
  o snapshot foi tirado (ver "Testes").
- `src/renderer/src/screens/cycle/RunBadge.tsx`: nada muda — a execução continua `waiting`;
  verificar no teste que o estado é `waiting` e o motivo aparece na conversa.

**Documentação de comportamento**

- `docs/runner.md` (pt e en): a espera por orçamento, a sondagem única, e que a recusa não gasta
  tentativa nem oferece retry.
- `CHANGELOG.md`, em `## [Unreleased]`: a linha visível à pessoa.

## Testes

Nenhum teste da árvore cai por causa desta mudança: o texto novo é o mesmo nos dois idiomas e as
chaves novas convivem com as antigas. O que muda é que **as chaves de `main` que têm texto novo
precisam da lista `INTENDED` de `test/gitlab-catalogs-unchanged.test.ts`** (com o motivo), senão a
comparação com o snapshot de `fixtures/catalogs-main` acusa a diferença. Se o texto novo for posto
também no fixture, a lista `INTENDED` não é necessária; uma das duas coisas, e a implementação
escolhe e registra.

1. **Classificação, motor aberto** (`test/engine-open-client.test.ts`): 402, 403 com corpo
   "Key limit exceeded (monthly limit)" e 429 com cota/limite caem em recusa de orçamento
   (`kind === 'budget'`, mensagem com o provedor, `retryable: false`); um 403 de permissão comum
   continua `forbidden`; um 429 comum continua `rate_limit` retentável.
2. **Classificação, motor Claude SDK** (`test/agent-resume.test.ts` ou novo
   `test/agent-budget.test.ts`, com o SDK falso): resultado `success` sem `structured_output` e um
   bloco de assistente com `API Error: 403 Key limit exceeded (monthly limit)` (com o prefixo
   "Failed to authenticate") lança a recusa de orçamento; um resultado sem saída estruturada com
   outra mensagem lança falha com o texto do provedor anexado (não só o subtipo); `error_max_turns`
   continua sendo `MaxTurnsError` com a retomada intacta.
3. **Mascaramento** (`test/errorlog.test.ts` ou um teste de motor): o texto do provedor com um
   formato de credencial sai mascarado na mensagem do erro.
4. **Dica de log**: o texto exato da issue (`403 Key limit exceeded (monthly limit)`) recebe a nova
   dica neutra de orçamento; os testes de 401/402 da OpenRouter continuam passando.
5. **Runner, a execução espera** (`test/runner-lifecycle.test.ts`, com `fakeEngine` que lança
   `ProviderBudgetError`): a execução fica `waiting` com `wait.kind === 'budget'` e o provedor no
   motivo; **não** fica `failed`; `runActions` não oferece `retry`; a conversa traz a mensagem de
   orçamento; `sendBack` a partir dessa espera continua funcionando.
6. **Nada novo começa** (`test/runner-lifecycle.test.ts`):
   - com uma execução `working` em `waiting` de orçamento, nenhuma etapa seguinte daquela execução
     começa (`pump` segurado);
   - com um provedor em espera, `scan` não inicia execução nova;
   - uma menção a um agente cujo provedor está em espera não faz a chamada de modelo e a conversa
     diz por quê.
7. **Sondagem única e retomada** (`test/runner-lifecycle.test.ts`): com `probe` que responde "ainda
   fora", a execução continua esperando; com `probe` que responde "voltou", todas as execuções que
   esperavam por aquele provedor passam a `working`, com **uma** sondagem (o dublê conta as
   chamadas: 1 para o provedor, não 1 por execução), e o motivo antigo sai do mapa.
8. **Espera sobrevive ao reinício** (`test/runner-lifecycle.test.ts`): ler a execução do disco no
   estado `waiting` com `wait.kind === 'budget'` e provedor passa por `parseRun` (o esquema novo);
   `resume` não a transforma numa etapa a recomeçar.
9. **Regressão do que estava certo** (`test/runner-agent.test.ts`, `test/run-view.test.ts`): as
   esperas por evento (pull request, resposta, label, tempo) e as ações por estado continuam como
   são.

## Verificação (o que fica para o próximo passo)

Os comandos do `CLAUDE.md` do repositório: `npx tsc --noEmit`, `npx vitest run`,
`node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` (e o
`electron-vite build` do CI não roda aqui). No plano nada foi executado: tudo acima foi lido no
código ou conferido com uma busca de texto local.

## Riscos

| Risco | Como é coberto |
|---|---|
| Falso positivo: uma recusa que não é de orçamento ser tratada como tal e segurar tudo | O casamento do 403 olha o corpo (limite, crédito, cota, cobrança, saldo); o 402 continua sendo orçamento por definição; o 429 comum continua retentável. Testes 1 e 2 cobrem as bordas. |
| Uma execução ficar presa para sempre porque a sondagem nunca passa | A sondagem devolve `ok` ou `unknown` (5xx, rede): em `unknown` a execução continua esperando (conservador). `skipWait` continua na tela de `waiting` e a pessoa pode seguir com motivo; `sendBack` também. O diagnóstico do `unknown` vai ao log de erros. |
| O 403 de orçamento passar a segurar o que antes era um erro de permissão | O teste da borda: um 403 sem corpo de limite/crédito continua `forbidden`, mensagem e comportamento de hoje. |
| O texto do provedor vazar para a conversa, o log ou o comentário | Todo texto de fora passa por `redact` na construção do `ProviderBudgetError`; o `run.stage.failed` já mascara no `fail`, e o novo caminho de orçamento usa o mesmo texto já mascarado. Teste 3. |
| As chaves novas de catálogo mudarem o texto de `main` que o snapshot de `test/gitlab-catalogs-unchanged.test.ts` compara | As chaves novas não colidem; as que têm texto novo entram na lista `INTENDED` com o motivo (ou no fixture), como o próprio teste exige. Teste de CI. |
| A sondagem gastar uma chamada de modelo a cada 5 minutos e virar custo | Uma chamada por provedor em espera por passada, com prompt mínimo; provedor em espera é caso excepcional. |
| O esquema novo do arquivo da execução recusar arquivos antigos ou os desta mudança | Os campos são opcionais; `RUN_VERSION` não muda e os arquivos antigos continuam válidos (teste 8). |
| O nome do provedor na mensagem ficar genérico demais | O texto nomeia o provedor (`main.engine.budget` com `{provider}` nos dois idiomas, teste 1/2 conferem o nome no texto). |

## Rollback

Reverter o commit devolve o comportamento de hoje: as chaves novas de catálogo ficam sem chamador
(aceitável por um ciclo) e as execuções que estivessem em `waiting` de orçamento voltariam a valer
como uma espera qualquer, que a pessoa pode seguir com `skipWait`.

## Próximos passos (fora deste plano)

- A decisão "um provedor para todos os papéis" hoje simplifica o travamento; um provedor por papel
  seria um refinamento posterior.
- A sonda por HTTP direto para o motor SDK (sem uma chamada de modelo) fica como melhoria, não como
  requisito: hoje não há caminho configurado para o app ler a chave do ambiente do CLI.
