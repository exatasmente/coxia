# Plano: uma só regra para chamar um agente com @

## 1. O que muda, em uma frase

O `@agente` deixa de ser um recurso da thread de uma execução e vira a regra do aplicativo: onde a pessoa escreve — um canal, a conversa geral, a thread de uma execução, o texto de qualquer cerimônia — o agente nomeado do time responde ali, sempre somente leitura, e quem responde passa a ser um só dono por lugar, com o núcleo da resposta (o prompt, os limites, a cópia descartável e a proposta de issue em Ações) compartilhado entre eles. O rótulo "Chamado" passa a dizer só o que aconteceu, um `@nome` sem agente do time vira uma linha de desconhecido, e os avisos que diziam que num canal o `@` não chama somem.

## 2. As duas decisões que esta etapa fixa

O spec deixou duas coisas para o plano. Ambas ficam decididas aqui.

### 2.1 De onde sai a cópia descartável do código fora de uma execução

Um agente chamado num canal ou numa conversa pode ter `shell: sandbox` ou `shell: host`. Nas duas, ele precisa de um lugar para rodar comandos que não seja o repositório real. Não há worktree próprio, então a fonte é montada por lugar:

- **Canal de um squad** — os repositórios do escopo do squad (`SquadDef.scope.repos`, por id em `ProjectsConfig.repos`), que existam no disco.
- **Canal sem squad e conversa geral** — os repositórios do espaço de trabalho (`config.projects.repos`).
- **Cerimônia** — nenhum: uma cerimônia não tem repositório, então o agente chamado numa cerimônia nunca recebe sessão de comandos (`shell: undefined`), só leitura da conversa e do cartão/issue em discussão. É o que a Regra 3 do spec já exige para "um lugar que não tem repositório", e evita montar cópia de código a partir do cartão, que não é um repositório.
- **Um repositório no escopo** — é ele a fonte.
- **Mais de um repositório no escopo** — a fonte é uma pasta de rascunho montada na hora, com uma cópia de cada repositório em uma subpasta, via o `copyTree` que já existe (`src/main/sandbox/copy.ts:36`). O agente recebe essa pasta como `cwd` e a lista dos repositórios no texto do sistema; o que ele escrever ali morre com a sessão, como em qualquer cópia descartável.
- **Nenhum repositório** — sem sessão de comandos, e a resposta do agente (e a linha do sistema no thread) dizem por quê.

A pasta de rascunho fica sob `join(ATAS, 'sandbox', 'mention', <thread>, <seq>)`, o mesmo lugar onde o sandbox já faz as pastas de etapa, e é removida ao fim da resposta junto com a sessão.

### 2.2 Onde mora quem responde

Um só núcleo, dois pontos de entrada:

- **`src/main/mentions/`** (novo) tem o núcleo: `call.ts` (o `mentionCall` de hoje, generalizado de `Run` para um lugar), `place.ts` (o lugar a partir da thread: execução, canal, conversa geral) e `answer.ts` (o laço de resposta: os três primeiros nomes, a cópia descartável, a resposta no thread, a proposta de issue).
- **A thread de uma execução continua respondida pelo runner** (`src/main/runner/service.ts`), que passa a chamar o núcleo com um lugar de execução — o comportamento de hoje não muda (Regra 10 do spec). O runner é o único que tem worktree, pasta de ciclo, `stage` e publicador.
- **Os demais threads ficam com um módulo novo** (`src/main/mentions/module.ts`, registrado em `src/main/modules.ts`), que escuta o fórum e responde os threads que não são `run-`.
- **As cerimônias chamam o núcleo direto**, no início de cada handler de texto (seção 5.5), porque o texto de uma cerimônia não é uma mensagem do fórum.

Essa divisão é a menor mudança que dá a regra única sem tocar no caminho da thread de execução, que o spec manda deixar como está.

## 3. O que a leitura desta etapa confirmou (arquivo:linha)

Tudo abaixo foi lido nesta árvore de trabalho. Nada foi executado; ver a seção 10.

| Fato | Onde |
|---|---|
| `parseMentions` casa só ids do time (case-insensitive, dedup, ordem), com a fronteira que exclui e-mail e caminho; não devolve nada sobre nomes desconhecidos | `src/shared/forum.ts:147-155` |
| `personPost` já resolve as menções do post de uma pessoa contra o time e grava `mentions` | `src/main/forum.ts:33-39`, `:64` |
| `forum:post` chama o interceptor antes e só cai em `personPost` quando ele não assume o post | `src/main/forum.ts:62-65` |
| `answerPost` devolve `null` quando o texto tem menção, para o post não ser tomado como a resposta da pergunta que espera | `src/main/runner/service.ts:841-850` |
| `onMessage` filtra `author === person`, `kind === post`, `mentions.length > 0` e `thread.startsWith('run-')`; serializa por run num `Map` de promessas | `src/main/runner/service.ts:851-861` |
| `answerMention` é o laço de hoje: só os 3 primeiros nomes, `permission: 'read'` forçada, sandbox quando o agente tem shell e o worktree existe, `mentionCall`, post do agente e `proposeIssue` | `src/main/runner/service.ts:938-981` |
| `mentionCall` exige `run` e usa `run.issue.ref`/`title` no texto do sistema; sem `confine`, logo o agente não tem Edit/Write | `src/main/runner/mention.ts:15-27`, `:52-77` |
| `openStageSandbox` recebe `Run` e usa `run.worktree`, `runThreadId(run.id)` e `run.issue.iid` na auditoria; `sandbox.open`/`openHost` em si recebem só um caminho | `src/main/runner/executor.ts:228-275`, `src/main/sandbox/index.ts:33-62` |
| `copyTree` copia uma árvore sem `.git` e recusa acima de `maxBytes`: é a peça pronta para a pasta de rascunho | `src/main/sandbox/copy.ts:36-54` |
| `limitsOf` e `watchdog` (ociosidade e relógio) já servem a qualquer chamada, não só a uma etapa | `src/main/runner/executor.ts:130-133`, `:148` |
| `runAgent` é o motor de um agente do time com o modelo e o sistema dele; `run`/`askAgent` é o do papel fixo da cerimônia | `src/main/agents.ts:956-991`, `:994` |
| O runner monta o motor com `engine: (call, commands) => runAgent(call, commands)` e exporta o `sandbox` que usa | `src/main/runner/module.ts:70`, `:81` |
| Os módulos registram-se numa lista ordenada | `src/main/modules.ts:30-57` |
| `Talk` só tem `me: boolean`, sem autor; os registros de cerimônia são `talk: Talk[]` (Gate, QaHandoff, Retro) e `DeepState.msgs: Talk[]` | `src/shared/types.ts:321-329`, `:228-235`, `:305-319`, `:331-349`, `:356-371` |
| A ata do call diário sai do `log` do renderer, que tem `who`; as outras cerimônias não passam por `minutes.ts` | `src/shared/minutes.ts:5-18` |
| O call diário registra e fala no renderer: `cc.addLog(WHO_ME, text, …)` e depois fala o `r.ack` com `cc.voiceOf(card.ref)` | `src/renderer/src/screens/Call.tsx:193-222` |
| Cada cerimônia fala um item de `talk`/`msgs` sem `me`, com uma voz fixa por índice (`voices.agents[n]`), não pelo agente nomeado | `src/renderer/src/screens/{Deep,QaHandoff,Reentry,RetroScreen,Gate}.tsx`, `src/renderer/src/ceremony.ts:247-250` |
| Nenhum caminho de cerimônia chama `parseMentions` hoje: o `@` no texto é texto | busca em `src/main/{agents,gate,qa,retro,feedback}.ts` e nas seis telas |
| Os prompts de cerimônia são renderizados de chaves `prompt.*` com parâmetros nomeados | `src/main/cyclePrompts.ts`, `src/main/agents.ts:339` |
| A guarda dos catálogos congelados cobre o snapshot do `main` (fixtures de `ui-call`, `ui-docs`, `ui-gate`, `ui-settings`, `ui-shell`, `ui-today`, `wizard`, `minutes`), e tem `RENAMED`, `INTENDED` e `REMOVED` | `test/gitlab-catalogs-unchanged.test.ts:33-126` |
| `ui.forum.*` mora em `ui-cycle.{en,pt-BR}.json`, que **não** entra no snapshot: mexer nele não exige exceção na guarda | `src/shared/i18n/ui-cycle.pt-BR.json:269-280`; `test/gitlab-catalogs-unchanged.test.ts:34-35` |
| `forum:*` é aberto ao navegador pareado; `runs:command` e `actions:approve` são o efeito externo | `src/main/webPolicy.ts:20`, `:22-24` |

## 4. Ordem de trabalho (cinco commits)

Cada commit fecha um passo lógico e deixa a árvore verde nos gates da seção 7. A ordem isola o refactor do comportamento novo e deixa a tela por último, para o rótulo nunca dizer algo que o código ainda não faz.

### Commit 1 — `refactor: give the mention answer a place instead of a run`

Sem mudança de comportamento. Move e generaliza:

- `src/main/runner/mention.ts` → `src/main/mentions/call.ts`; `MentionInput.run` sai e entram `ref?`, `title?`, `mission?`, `repos?` (5.1).
- `src/main/mentions/place.ts` (novo): o `MentionPlace` e a resolução a partir de uma `ThreadSummary`/`Run` (5.2).
- `src/main/mentions/answer.ts` (novo): o laço de `service.ts:938-981`, com a fonte de comandos resolvida por lugar (5.3).
- `src/main/runner/service.ts`: `answerMention` vira uma casca fina sobre o núcleo, com o lugar de execução; a mensagem de sistema e os códigos de falha não mudam.
- `src/shared/i18n/{en,pt-BR}.json`: as chaves novas do texto de sistema (5.6), mantendo `runner.mention.system` renderizando o mesmo de hoje para uma execução.

Prova de que nada mudou: os testes atuais de menção da thread de execução passam sem edição.

### Commit 2 — `feat: answer an @agent in every forum thread`

- `src/main/mentions/module.ts` (novo) + registro em `src/main/modules.ts`; resposta dos threads que não são `run-`, serializada por thread.
- `src/shared/forum.ts`: `MAX_MENTIONS = 3` e `unknownMentions(text, agentIds)` (5.4).
- `src/main/forum.ts`: `personPost` acrescenta a linha de sistema do nome desconhecido.
- `src/main/mentions/place.ts`: os repositórios do canal/geral e a pasta de rascunho de vários repositórios (2.1).
- `src/main/runner/module.ts` (ou um suporte neutro): o `sandbox` passa a ser importável pelo módulo de menções sem ciclo.
- i18n: `main.forum.mentions.unknown`, `runner.mention.system.channel`, `runner.mention.system.general`, `main.mentions.noRepo`.

### Commit 3 — `feat: answer an @agent inside the ceremonies`

- `src/main/mentions/ceremony.ts` (novo): `answerCeremonyMentions` (5.5).
- `src/main/agents.ts` `reply`; `src/main/gate.ts` `answerGate`/`explainGate`; `src/main/qa.ts` `askQa`; `src/main/retro.ts` `askRetro`; `src/main/feedback.ts` `askReentry`: chamam o núcleo no topo do handler e empilham as respostas no registro com o nome do agente, antes da resposta do agente do sistema.
- `src/shared/types.ts`: `Talk.agent?`, `ReplyResult.mentions?`, `DeepAnswer.mentions?`.
- i18n: `runner.mention.system.ceremony`, `main.mentions.ceremony.failed`.

### Commit 4 — `feat: speak the named agent's answer and show it by name`

- `src/renderer/src/ceremony.ts`: `voiceOfAgent(agentId)`, mapeando o id para o índice no time.
- As seis telas falam cada resposta nova de agente (com a voz do agente) antes de falar a resposta do agente do sistema; guardam o que já foi falado como já fazem hoje.
- As telas que mostram `talk`/`msgs` mostram o nome do agente quando `Talk.agent` existe.
- i18n de tela conforme a seção 5.6.

### Commit 5 — `fix: say what actually happened where a person writes`

- `src/renderer/src/screens/cycle/Thread.tsx`: o rótulo de chamada só para post de pessoa, os três primeiros como chamados e os demais como não chamados; saem a prop `channel` e o ramo do aviso do canal.
- `src/shared/i18n/ui-cycle.{en,pt-BR}.json`: sai `ui.forum.noteChannel`, entra `ui.forum.mentionsOverLimit`, `ui.forum.noteMention` é reescrito para a regra única.
- `test/forum-policy.test.ts` e o comentário de `webPolicy.ts` ganham a nota de que o `@` vale em todo lugar (sem mudar a política).

## 5. Contratos

### 5.1 `src/main/mentions/call.ts`

```ts
export interface MentionInput {
  agent: AgentDef;
  config: WorkspaceConfig;
  message: ForumMessage;
  thread: ForumMessage[];
  files: FolderFile[];
  cwd: string;
  /** A issue/execução ou o cartão em discussão, quando há um. */
  ref?: string;
  title?: string;
  /** A missão do squad, quando o lugar tem uma (canal de squad). */
  mission?: string | null;
  /** Os repositórios que o agente pode ler, já por nome/id. */
  repos?: readonly string[];
  /** Onde a pessoa escreveu: o texto do sistema muda por lugar. */
  place: 'run' | 'channel' | 'general' | 'ceremony';
  shell?: { host: boolean; network: 'off' | 'registry' };
  issue?: boolean;
}
```

`mentionCall` monta o sistema como hoje (`runner.mention.system` + regras de shell + regras de dados/claims + persona + instruções do agente) e acrescenta, depois do texto do sistema, a linha do lugar: `runner.mention.place.channel` com `{mission}`, `.general`, `.ceremony` com `{ref,title}` ou `.run` (o `.run` é o texto de hoje, para a execução não mudar). Sem shell e sem issue numa cerimônia, o prompt é o mesmo menos essas seções. `maxTurns: 20` e o schema `{text}` (ou `{text, issue}` quando `issue`) não mudam.

### 5.2 `src/main/mentions/place.ts`

```ts
export type MentionPlace =
  | { kind: 'run'; run: Run }
  | { kind: 'channel'; squad: SquadDef | null; repos: RepoConfig[] }
  | { kind: 'general'; repos: RepoConfig[] }
  | { kind: 'ceremony'; ref: string; title: string; thread: { who: string; text: string }[] };

export function placeOfThread(summary: ThreadSummary | null, runs: (id: string) => Run | null, config: WorkspaceConfig): MentionPlace | null;
```

`placeOfThread` resolve: `run-<id>` → `{ kind: 'run' }` pelo run store; `squad-<id>` → canal com o squad (`config.squads`) e os repositórios do escopo (`scope.repos` casados com `projects.repos`); `squads` → canal sem squad; `general` (ou qualquer `general` aberto) → `{ kind: 'general', repos: config.projects.repos }`. Devolve `null` para um thread que não existe.

### 5.3 `src/main/mentions/answer.ts`

```ts
export interface MentionDeps {
  forum: ForumStore;
  config: () => WorkspaceConfig;
  engine: (call: AgentCall, commands: string[]) => Promise<Run<unknown>>;
  sandbox?: SandboxService;
  /** Só a execução tem: onde propor a issue que o agente levantar. */
  proposeIssue?: (runId: string, e: { key: string; title: string; body: string; labels: string[]; by: string; stage: string }) => Promise<unknown>;
  env: () => { fallbackCwd: string };
}

export async function answerMentions(place: MentionPlace, message: ForumMessage, deps: MentionDeps): Promise<void>;
```

O laço é o de `service.ts:938-981`, com as trocas: `run` sai; o `threadId` vem do lugar (`runThreadId`, o canal, ou o próprio id do thread); o `cwd` e a fonte de comandos vêm de `shellSourceOf(place)` (2.1); `stage` é `run.stage` ou `null`; `proposeIssue` só existe no lugar de execução. Os códigos de sistema (`runner.mention.noShell`, `runner.mentionFailed`) continuam os mesmos; o texto do sistema do agente vira `main.mentions.noRepo` quando não há repositório nenhum. A proposta usa como `key` `` `${message.seq}-${id}` `` e o `runId` do lugar quando existe; fora de uma execução não há publicação, como o spec manda (canal fica interno, Regra 3 do refino).

### 5.4 `src/shared/forum.ts`

```ts
export const MAX_MENTIONS = 3;
/** Os `@nome` do texto que não são de nenhum agente do time, na ordem, sem repetir. Mesma fronteira de `parseMentions`. */
export function unknownMentions(text: string, agentIds: readonly string[]): string[];
```

`unknownMentions` reusa o mesmo laço/regex de `parseMentions`, trocando `known.has(id)` por `!known.has(id)`. `answerMention` e o módulo passam a cortar por `MAX_MENTIONS` em vez do `3` literal.

### 5.5 `src/main/mentions/ceremony.ts`

```ts
export interface CeremonyMention {
  agent: string;   // id
  name: string;    // o nome mostrado
  text: string;    // o corpo da resposta
  speech: string;  // a frase falada (a mesma quando o schema só tem `text`)
}

export async function answerCeremonyMentions(text: string, ctx: { thread: string; ref: string; title: string; msgs: { who: string; text: string }[] }): Promise<CeremonyMention[]>;
```

Percorre `parseMentions(text, team).slice(0, MAX_MENTIONS)`; para cada um chama `runAgent(mentionCall({ …, place: 'ceremony', shell: undefined, issue: false }))` sob o mesmo `watchdog`/`limitsOf` da thread de execução (Regra 7 do spec). Nunca lança para o handler: uma falha vira uma `CeremonyMention` com o texto de `main.mentions.ceremony.failed`, para a cerimônia seguir de pé. Quando o texto não tem menção, devolve `[]` sem chamar ninguém.

Os handlers que passam a chamar (todos no topo, antes do agente do sistema):

| Handler | Onde | O que fazer com as respostas |
|---|---|---|
| `reply` | `src/main/agents.ts:665` | devolver em `ReplyResult.mentions`; o renderer registra e fala |
| `deepAsk` | `src/main/agents.ts:708` | devolver em `DeepAnswer.mentions`; entram em `DeepState.msgs` |
| `answerGate` | `src/main/gate.ts:198` | empilhar em `g.talk` com `agent` e seguir a lógica de hoje |
| `explainGate` | `src/main/gate.ts:226` | empilhar em `g.talk` |
| `askQa` | `src/main/qa.ts:111` | empilhar em `q.talk` |
| `askRetro` | `src/main/retro.ts:177` | empilhar em `retro.talk` antes de `proposeRetroIssues` |
| `askReentry` | `src/main/feedback.ts:343` | empilhar em `re.talk` |

A ordem em cada registro é: a fala da pessoa, as respostas dos agentes nomeados, e por fim a do agente do sistema — que continua conduzindo (Regra 5 do spec). O agente do sistema não é pulado quando a pessoa chama alguém: ele retoma depois.

### 5.6 Chaves de idioma

Nos catálogos principais (`src/shared/i18n/en.json` e `pt-BR.json`), porque o `src/main` as usa:

| Chave | Papel |
|---|---|
| `runner.mention.place.channel` | Onde a pessoa escreveu e a missão do squad que o agente recebe |
| `runner.mention.place.general` | A conversa e os repositórios do espaço de trabalho, sem missão |
| `runner.mention.place.ceremony` | O cartão/issue em discussão é o contexto |
| `runner.mention.place.run` | O texto de hoje (`runner.mention.system` fica sem o pedaço do lugar) |
| `main.forum.mentions.unknown` | A linha de sistema: `{names}` não é agente do time |
| `main.mentions.noRepo` | Por que o agente não recebeu comandos |
| `main.mentions.ceremony.failed` | A resposta quando o agente nomeado falhou dentro da cerimônia |

No catálogo de tela (`ui-cycle.{en,pt-BR}.json`): entra `ui.forum.mentionsOverLimit`, sai `ui.forum.noteChannel`, e `ui.forum.noteMention` passa a ser a regra única ("Chame um agente com @ … ele responde aqui, só lendo"). `ui-cycle` não está no snapshot congelado, então não há exceção a registrar em `test/gitlab-catalogs-unchanged.test.ts`.

### 5.7 A tela do thread

- `Message`: a linha `ui.forum.mentions` só quando `m.author.type === 'person'` e `m.mentions.length > 0`; os nomes até `MAX_MENTIONS` como chamados; quando há mais, uma segunda linha `ui.forum.mentionsOverLimit` com os restantes. Nomes desconhecidos não entram aí: são a linha de sistema de `personPost`.
- `Thread`: sai a prop `channel` e o ramo `channel ? noteChannel`; o aviso que sobra é `noteAnswers` (a pergunta que espera) ou `noteMention` (a regra única). O `onSendBack` continua como está.

## 6. Testes

Arquivos novos, no molde de `test/forum-store.test.ts` e `test/runner-squads-publish.test.ts` (com o motor falso de `test/helpers/`):

1. **`test/mentions-place.test.ts`** — a resolução pura: `run-<id>` com o run store falso; `squad-<id>` com o squad e os repositórios do escopo; `squads`; `general`; um thread inexistente devolve `null`.
2. **`test/forum-mentions.test.ts`** — um canal e uma conversa geral, com um motor falso que devolve `{ text }`: o agente nomeado posta no mesmo thread com `author.type === 'agent'`, `mentions` vazio e nada publicado; um nome desconhecido gera a linha `main.forum.mentions.unknown`; quatro nomes atendem só os três primeiros; uma mensagem de agente com `@` não dispara outra resposta (sem laço); o post de uma pessoa numa thread de execução continua indo pelo runner (o módulo novo não responde `run-`).
3. **`test/mentions-shell.test.ts`** — a fonte de comandos: um repositório no escopo é a fonte; dois geram a pasta de rascunho com uma cópia por repositório (`copyTree` falso); nenhum repositório não abre sessão e a resposta diz o motivo; um agente com `shell: host` nunca é aberto sem repositório.
4. **`test/ceremony-mentions.test.ts`** — com `askAgent`/`runAgent` mockado como em `test/squad-ceremonies.test.ts`: `reply`, `askQa`, `askRetro`, `askReentry`, `explainGate` empilham a resposta com o id do agente antes da resposta do agente do sistema; a ordem é pessoa → nomeado → sistema; uma falha do agente nomeado não derruba a cerimônia; nenhum caminho de cerimônia propõe issue e nenhum abre sessão de comandos.
5. **`test/forum-view.test.ts`** (edição) — `unknownMentions` e `MAX_MENTIONS`: o que conta como nome, o que não conta (e-mail, caminho, id desconhecido), a ordem e a dedup.
6. **`test/forum-policy.test.ts`** (edição) — a nota nova; nenhum canal novo entra na política.

Asserções sobre fonte (como `test/vcs-writes.test.ts` faz) para a tela, que não tem teste renderizado: `noteChannel` sai, `mentionsOverLimit` entra, e `Thread.tsx` não decide mais o aviso por `channel`.

## 7. Gates

Um commit só está pronto com os do `CLAUDE.md` verdes, mais o build do CI:

```
nvm use
npx tsc --noEmit
npx vitest run
node scripts/theme-audit.mjs
npm run i18n:lint
node scripts/public-audit.mjs
electron-vite build
```

Nenhum comando que escreve no repositório além dos testes; não há regeneração de golden aqui (nenhum prompt com snapshot muda: as chaves de prompt são novas, não edições das que a guarda cobre). `public-audit` é o gate que mais importa aqui: nada de host, pessoa, número de issue ou segredo nas fixtures novas — `example.com`, `group/project`, `#123`.

## 8. Riscos e como são cobertos

1. **A generalização do `answerMention` mexer no caminho da thread de execução** (Regra 10 do spec). Cobertura: o commit 1 é refactor puro, sem teste novo, e os testes atuais de menção da execução passam sem edição; a fonte de comandos e o publicador só existem no lugar de execução.
2. **Multiplicidade de repositórios no escopo.** O agente recebe uma pasta de rascunho com uma cópia por repositório; o custo de cópia é dobrado (a pasta de rascunho e a cópia do leitor que o sandbox faz por cima). Aceito e limitado por `copyMb`. Alternativa descartada: copiar só o primeiro repositório, o que esconderia os outros.
3. **A cópia descartável fora de uma execução nunca foi exercitada com o sandbox real.** **Não verificado** — depende de `bwrap` na máquina. Cobertura: o teste usa um `SandboxService` falso; o comportamento real fica para o QA.
4. **Falar a resposta do agente nomeado nas cerimônias exige mexer em seis telas.** É a maior superfície de revisão do plano. Cobertura: só a asserção sobre fonte onde não há teste de tela; o resto é revisão e QA. Se o "falar cada item novo" for grande demais, o corte é falar a resposta nomeada e a do sistema em sequência, o que não muda o registro.
5. **O "trabalhando" enquanto o agente responde** é pedido da issue irmã e não é construído aqui (spec, Fora do escopo). A aceitação 5 tem essa cláusula; ela fica dependente daquela peça. **Não verificado.**
6. **O laço de menção.** Um agente que responda com `@outro` no texto não pode disparar outra resposta: as respostas do agente são postadas com `mentions` vazio e `onMessage`/o módulo só olham `author === person`. Cobertura: caso 2 de `test/forum-mentions.test.ts`.
7. **A linha de desconhecido em posts que não são de agente.** `personPost` só roda para post de pessoa; um texto de agente com `@nome` desconhecido não gera linha. É o desejado.
8. **Nomes desconhecidos e a fronteira do regex.** `unknownMentions` precisa da mesma fronteira que `parseMentions` (e-mail, caminho, `/`, `.`, `-`), senão `ana@example.com` viraria nome desconhecido. Cobertura: caso 5.

## 9. Registro de decisões

1. **Um núcleo compartilhado, dois donos.** A thread de uma execução continua com o runner (Regra 10 do spec, e é ele que tem worktree, pasta de ciclo e publicador); o resto fica com um módulo novo; as cerimônias chamam o núcleo direto. Alternativa descartada: um só módulo dono de todos os threads — obrigaria a mover para fora do runner o `stage`, a pasta de ciclo e o publicador, mexendo no que o spec manda deixar quieto.
2. **A pasta de rascunho para vários repositórios é montada com `copyTree`.** É a peça de cópia descartável que já existe (`sandbox/copy.ts:36`) e a única Run-agnóstica. Alternativa descartada: só o primeiro repositório (esconderia os outros) ou montar uma pasta de links (a checagem antes de montar recusa qualquer link dentro da árvore, `sandbox/index.ts:117-137`).
3. **Cerimônia não recebe sessão de comandos.** Uma cerimônia não tem repositório (Regra 3 do spec) e montar cópia a partir do cartão não faz sentido. O agente chamado numa cerimônia só lê a conversa e o cartão. Alternativa descartada: dar a cópia do repositório do cartão, que exigiria um mapa cartão → repositório que não existe.
4. **A resposta do agente nomeado entra no registro com o nome dele; a do sistema continua.** Exige um autor no `Talk` (`agent?: string`) e, no call diário, um `who` novo no `log`. Alternativa descartada: só o sistema falar, o que contraria a Regra 5 do spec.
5. **O agente do sistema não é pulado quando a pessoa chama alguém.** A cerimônia continua conduzida; o nomeado responde e o sistema retoma (Regra 5). Alternativa descartada: pular o sistema quando há menção, o que faria a pergunta da pessoa ficar sem a condução da cerimônia.
6. **`answerPost` não muda.** Ele já devolve `null` quando o texto tem menção, que é exatamente o que a regra única precisa para o post não ser tomado como a resposta da pergunta que espera. Nenhuma linha.
7. **O rótulo só para post de pessoa.** Um agente que nomeie outro no texto não "chamou": a linha de chamada é de quem escreve. Alternativa descartada: mostrar para todo autor, o que repetiria a mentira de hoje em outro lugar.
8. **`ui.forum.noteChannel` sai; `ui.forum.noteMention` fica e vira a regra única.** A aceitação 10 do spec manda os avisos do canal sumirem; o aviso geral passa a valer em todo lugar. Não há exceção a registrar na guarda congelada porque `ui-cycle` está fora do snapshot.
9. **`MAX_MENTIONS` sai do literal.** O `3` de hoje vira constante compartilhada, para o corte e o rótulo contarem a mesma história (Regra 6 do spec).

## 10. O que esta etapa não verificou

Nada foi alterado nem executado nesta etapa: nenhum gate foi rodado, nenhum teste, nenhum build, o aplicativo não foi aberto e nenhum modelo real foi chamado. Tudo acima é leitura de código e de documentos. Em particular, **não verificado**:

- se o sandbox real abre sobre a pasta de rascunho de vários repositórios e se a cópia dupla respeita os limites;
- se o texto de sistema novo (`runner.mention.place.*`) faz o agente responder como o esperado em cada lugar — depende de execução com o modelo;
- se as seis telas falam cada resposta nova na ordem certa sem repetir a que já foi falada;
- se o mapa de voz por id de agente soa como o esperado quando o time mudou depois da cerimônia gravada;
- se `npm run i18n:lint` e `scripts/public-audit.mjs` passam com as chaves e fixtures novas;
- o estado de "trabalhando" enquanto o agente responde, que é da issue irmã e não é construído aqui.
