# Plano: a leitura de um agente de execução fica dentro da pasta de trabalho dela

## 1. O que a mudança faz, em uma frase

No motor do Claude Agent SDK, um agente que só lê numa execução passa a receber a mesma guarda de
caminho que o agente que escreve já recebe: `Read`, `Grep` e `Glob` ficam presos à pasta de
trabalho da execução (com a pasta do ciclo dentro dela), qualquer tentativa de sair é recusada, a
recusa é dita na conversa da execução e a chamada aparece bloqueada na atividade ao vivo; nada é
afrouxado (arquivo de segredo, censura do resultado de busca e recusa de busca ampla continuam
valendo) e o agente que escreve não muda em nada.

## 2. O que foi lido nesta etapa (arquivo:linha)

Tudo abaixo foi conferido por leitura nesta árvore de trabalho. Nada foi exercitado com agente real;
ver a seção 11. Nesta etapa também rodaram `npx tsc --noEmit` (sem erro) e `npx vitest run` (3664
testes, 222 arquivos, todos verdes, na árvore sem alteração), para deixar registrado o estado de
partida.

O fato que a issue afirma se confirma:

| Fato | Onde |
|---|---|
| A guarda de caminho já recusa absoluto fora, `..`, `~`, link que sai, link que não leva a lugar nenhum, `.git` e arquivo de segredo, e, para leitura, libera a própria raiz | `src/main/engine/guard.ts:76-98` (`checkPath`, `options.read` na linha 89) |
| A guarda de leitura já cobre `Read`/`Grep`/`Glob`, com `checkPath(o.root, p, { read: true })`, e cada recusa passa por `onDenied` | `src/main/runner/hooks.ts:55-67` |
| Os mesmos hooks já montam a recusa, o relato na conversa e a marcação de bloqueado na atividade | `src/main/runner/hooks.ts:41-91`, `src/main/agents.ts:315-325` (`reportBlocked`) |
| Hoje a chamada de etapa só monta `confine` para quem escreve | `src/main/runner/executor.ts:430` (`confine: writes ? { root: wt, hooks: confinedHooks(...) } : undefined`) |
| Sem `confine`, as ferramentas do leitor saem de `allowedFor` e nada recebe a raiz | `src/main/agents.ts:1000-1004` (`toolsOf`), `:56-66` (`allowedFor`) |
| O leitor recebe, hoje, as pastas de documentação listadas fora da pasta de trabalho | `src/main/agents.ts:379-383` (`extraDirs`), `:1055` (`extraDirs: call.confine ? [] : extraDirs(call.cwd, modelRole)`), `:413` (`additionalDirectories`) |
| Essas pastas vêm de listas da configuração (`docs.claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`), com `~/` expandido | `src/main/config-resolve.ts:204-237` (`resolveDocs`), `src/main/workspaceConfig.ts:63-65` (`docsSources`) |
| `sdkOptions` decide o resto do leitor pela ausência de `confine`: `asks = !confine && !!req.ask`, e `Edit`/`Write` só somem quando não há `confine` | `src/main/agents.ts:388-416` |
| O motor aberto limita toda ferramenta de leitura pelas raízes do contexto (`cwd` + pastas extras + documentação + skills) | `src/main/engine/open/loop.ts:264-277`, `src/main/engine/open/tools/read.ts:17-37` (`confine`) |
| O motor aberto também passa os hooks pelos mesmos callbacks, e uma recusa vira o texto que o modelo lê | `src/main/engine/open/policy.ts:44-50`, `src/main/engine/open/loop.ts:377-378` |
| A recusa da leitura, quando vem do motor aberto, é a mensagem genérica, não a recusa da guarda | `src/main/engine/open/tools/read.ts:34` (`main.engine.text.read.outside`) |
| Toda chamada de leitor de uma execução passa por `runAgent` com a lista de ferramentas de `toolsOf` | `src/main/agents.ts:1037-1066` |
| A menção numa conversa de execução monta um `AgentCall` sem confinamento nenhum, com `cwd` igual à pasta de trabalho da execução | `src/main/mentions/call.ts:74-101`, `src/main/mentions/answer.ts:125-146`, `src/main/mentions/answer.ts:181` |
| A menção fora de uma execução também monta um `AgentCall` sem confinamento; quando o chamado roda comandos, o `cwd` é uma cópia descartável | `src/main/mentions/module.ts:28-52`, `src/main/mentions/answer.ts:180-189` |
| Uma menção dentro de uma cerimônia resolve a raiz como a primeira raiz de projetos do espaço de trabalho | `src/main/mentions/ceremony.ts:57-70` (`config.projects.roots[0] ?? ''`), e `rc().projectsRoot` é `roots[0] ?? fallbackCwd` (`src/main/config-resolve.ts:107`) |
| A cadeia de perguntas da execução monta a chamada com a pasta de trabalho quando ela existe, senão com a pasta de reserva | `src/main/runner/service.ts:1104`, `:1113` (`chainCall`), `src/main/runner/chain.ts:48-74` |
| O contato de um squad chamado por outro squad lê o repositório do próprio squad | `src/main/runner/service.ts:1156-1159` (`squadCwd`), `:1180` (`requestCall`), `src/main/runner/request.ts:41-69` |
| O `Grep`/`Glob` já aceita um caminho de busca (`path`), o `Glob` por pasta e o `Grep` por pasta ou arquivo | `src/main/engine/open/tools/search.ts:99`, `:280`; `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` (`GlobInput.path`, `GrepInput.path`) |
| A negação de ferramentas por `disallowedTools` no SDK é um interruptor do processo inteiro, com nome próprio (`blockReadsOutsideWorkingDirectories`), e a guarda do projeto é a que já existe | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` (`blockReadsOutsideWorkingDirectories`); `src/main/agents.ts:402-409` |

Consequências que caem do que foi lido e que definem o plano:

1. `toolsOf` (`src/main/agents.ts:1002`) dispara por `call.confine`: se o confinamento de leitura
   entrar no mesmo campo, o leitor ganha `Edit`/`Write` e um shell só para os comandos da lista, o
   que a issue proíbe. Daí o campo próprio.
2. `sdkOptions` (`src/main/agents.ts:394`) trata `confine` como "agente que escreve" para decidir
   `asks` e o desligamento do shell. Precisa passar a distinguir os dois confinamentos.
3. Os hooks do leitor, hoje, são os das cerimônias (`src/main/agents.ts:299-312`: `noSecrets`, a
   recusa de busca ampla e a censura de resultados). Trocar a escolha em bloco, como o
   `confine` de quem escreve faz (`:392`), tiraria a censura do resultado e a recusa de busca ampla
   do leitor. A composição tem de somar, não substituir.

Estas três são as armadilhas de regressão desta mudança e é por isso que a ordem de trabalho as
isola em commits próprios.

## 3. As decisões que este plano fixa

### 3.1 Um campo próprio de leitura, com os mesmos hooks

Entra `EngineRequest.read?: Confinement`, ao lado do `confine` que já existe em
`src/main/engine/contract.ts:57-62`. O `Confinement` é reaproveitado inteiro (`root` e `hooks`),
porque a guarda de caminho certa já é uma só (`checkPath`). O `AgentCall` ganha
`readRoot?: Confinement` — o nome que a especificação pediu.

`confine` continua significando "muda arquivos na pasta de trabalho" em cada decisão que já o
consulta hoje (`toolsOf`, `wantsVcsTool`, `sdkOptions`, `shellEnv`, `writeRoot`, o scrub dos hooks
de shell). Nenhuma dessas decisões passa a olhar `readRoot`.

### 3.2 A montagem dos hooks do leitor: somar, não substituir

Um leitor confinado recebe, na mesma lista, os hooks que já valem para ele e a guarda de leitura:

```
PreToolUse:
  Read|Grep|Glob  -> [noSecrets, readGuard]
  Grep|Glob       -> [noBroadSearch]
PostToolUse:
  Grep|Glob       -> [redactSecretResults]
```

com `readGuard` definido em `src/main/runner/hooks.ts` (`readConfinedHooks(o)`, mesma opção
`onDenied`). É o que `confinedHooks` já faz para quem escreve (`hooks.ts:85`) e o que o leitor não
pode perder: o filtro de segredo (`noSecrets`), a recusa de busca ampla e a censura do resultado de
busca.

### 3.3 De onde sai a lista de pastas de documentação permitidas

A lista entregue ao motor como diretórios adicionais continua saindo de `extraDirs(call.cwd,
modelRole)` (`src/main/agents.ts:379-383`): as pastas que a configuração lista em `docs`
(`claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`), sem as que o
auto-detect achou dentro do alvo e sem as que já estão dentro do `cwd`. As mesmas pastas são as
raízes extras da guarda de leitura.

Essa é a lista explícita, curta e derivada da configuração que a triagem e a especificação
propuseram: ela não é maior que a lista que o leitor já recebe hoje, cai para zero nas pastas que
o auto-detect achou dentro da pasta de trabalho, e passa a valer para a leitura de arquivo e de
busca, não só para o "o que o motor enxerga".

Duas notas de honestidade sobre esta decisão:

- **Não consta desta árvore nenhum passo de migração que cadastre as pastas de documentação na
  configuração do espaço de trabalho** (nem em `src/shared/config/migrations.ts`, nem em
  `src/main/config-bootstrap.ts`, nem em `src/main/legacy-profile.ts`). Como a decisão não mexe em
  campo de configuração, ela não precisa de passo; mas o efeito prático é que um espaço de trabalho
  em que essas pastas foram achadas pelo auto-detect **fora** da pasta de trabalho (a pasta
  `~/.claude`, por exemplo) deixa de alcançá-las pelo leitor da execução, porque pastas achadas por
  auto-detect não entram na lista.
- Com `cwd` vazio (`''`), que é o que uma cerimônia monta hoje
  (`src/main/mentions/ceremony.ts:63`), `extraDirs` devolve todos os `p !== ''` que não começam com
  `'/'`. Como uma raiz de leitura relativa à pasta de trabalho não é uma raiz utilizável, a guarda
  **não pode** usar essa lista quando o `cwd` não é absoluto; ver o caso 11 dos testes.

### 3.4 Onde o confinamento de leitura é ligado

Só onde a issue mandou: numa execução.

| Chamada | Raiz de leitura | Onde |
|---|---|---|
| Etapa de leitura da execução | a pasta de trabalho | `src/main/runner/executor.ts` (`runStage`, hoje `:424-437`) |
| Menção na conversa de uma execução | a pasta de trabalho daquela execução | `src/main/mentions/answer.ts` (`place.kind === 'run'`), ou pelo `openSession` que o runner já fornece |
| Pergunta da cadeia de perguntas da execução | a pasta de trabalho quando ela existe | `src/main/runner/service.ts:1113` (`chainCall`) |

Ficam **sem** confinamento de leitura, como a especificação propôs (regras 8 e 9):

- menção num canal, numa conversa geral ou numa cerimônia;
- o contato de um squad que lê o repositório do próprio squad
  (`src/main/runner/service.ts:1180`, `squadCwd` — a raiz seria o repositório, que não é a pasta de
  trabalho da execução);
- uma cadeia (ou uma etapa) cuja pasta de trabalho não existe mais, que cai na pasta de reserva.

Essas chamadas não têm pasta de trabalho para servir de raiz, e inventar uma (a pasta de projetos,
o repositório do squad) seria fechar a leitura sobre uma pasta que não é a da execução. Elas
continuam como estão hoje — **confirmado pela pessoa**, que respondeu "deixa como está" à pergunta
de escopo desta etapa. Nenhum campo de configuração novo, nenhuma migração: `types.ts`,
`defaults.ts`, `schema.ts` e `migrations.ts` ficam intocados.

## 4. Ordem de trabalho (quatro commits)

Cada commit deixa a árvore verde nos gates da seção 9. A ordem existe para isolar o campo novo do
comportamento novo: depois do commit 1 os testes existentes continuam passando sem edição, e as
saídas do motor falso (a lista de ferramentas, `allowedTools`, `additionalDirectories`) não mudam
enquanto a fiação não chega.

### Commit 1 — `add a read-only confinement to a call, beside the one that writes`

Sem mudança de comportamento. Só o campo e a montagem dos hooks:

- `src/main/engine/contract.ts`: `EngineRequest.read?: Confinement`, com o comentário de que é o
  confinamento de leitura de um agente de execução que não escreve.
- `src/main/agents.ts`: `AgentCall.readRoot?: Confinement`; `sdkOptions` escolhe os hooks por
  `confine ?? read`, mantém `asks`/shell/`Edit`/`Write`/`VCS` decididos só por `confine` (as
  funções `asksOf`, `shellOffOf` documentam isso em um lugar só), e acrescenta
  `additionalDirectories: read.roots` quando `req.read?.roots?.length` (sem tirar o caminho atual).
- `src/main/runner/hooks.ts`: `ReadConfinementOptions` e `readConfinedHooks(o: {root, roots?, onDenied})`.

Nada liga o campo ainda: nenhum chamador o preenche. Prova de que nada mudou: a suíte inteira
passa sem edição (conferido nesta etapa que ela está verde antes da mudança).

### Commit 2 — `confine the reading agent of a run to its worktree`

O comportamento pedido pela issue, no motor do Claude Agent SDK e no motor aberto, que usa os mesmos
hooks:

- `src/main/runner/executor.ts` (`runStage`): monta `readRoot` para `!writes` com
  `{ root: wt, roots: extraReadRoots(wt, role), hooks: readConfinedHooks({ root: wt, onDenied: denied }) }`.
  `extraReadRoots` é uma função nova e pura em `src/main/agents.ts` que devolve
  `extraDirs(cwd, role)` filtrada por `isAbsolute` e por `!= cwd` e sem descendentes de `cwd`.
  A raiz de leitura da cadeia de perguntas e da menção numa conversa de execução é ligada aqui
  também (seção 5.6): a primeira em `service.ts` (`chainCall`), a segunda no `openSession` do
  runner.
- O que **não** muda em `executor.ts`: o `cwd`, o `confine` de quem escreve, o sandbox, a pasta do
  ciclo, o prompt, os limites de turno, a escrita dos documentos e o commit.

### Commit 3 — `say a refused read of a run in the activity and the thread`

Nada novo de fiação deve ser necessário — o relato já existe (`executor.ts:416-422`, a linha
`runner.denied`; `reportBlocked` em `agents.ts:315-325`, a marcação de bloqueado). O commit existe
para consertar o que a leitura mostra: a recusa que volta do motor aberto é o texto genérico
(`read.ts:34`), e as mensagens de recusa (`prompt.sdd.runner.denied.*` em
`src/shared/i18n/main.en.json:808-817`, com os pares em pt-BR) falam de "ler ou alterar".

- `src/main/engine/open/tools/read.ts`: a mensagem de fora passa a citar o caminho que o agente
  tentou e o limite, sem autocitação de política (a mesma frase serve para os dois motores).
- Os textos de recusa ganham a redação de leitura onde ainda falam só de escrita.
- Nenhuma chave nova de catálogo; a linha da conversa e a marcação de bloqueado já existem e já são
  testadas.

Se, ao ligar a guarda num leitor, algum caminho de chamada chegar sem `onDenied`, é aqui que ele
recebe o fio — o critério 8 da especificação não aceita recusa silenciosa.

### Commit 4 — `write the reading confinement in the docs and the changelog`

- `docs/runner.md`: a seção do agente que só lê passa a dizer que a leitura dele fica na pasta de
  trabalho da execução.
- `CHANGELOG.md`, sob `## [Unreleased]`, em `### Fixed`: o que mudou para quem usa, na mesma voz das
  entradas vizinhas.
- Sem campo novo na configuração: não há migração, e portanto `src/shared/config/{types,defaults,schema,migrations}.ts`
  não são tocados por este plano. Se a decisão de escopo mudar para um campo de configuração (regra
  8 da especificação), esta etapa para: passam a valer o passo de migração, o schema e os três
  arquivos de tipos/defaults/schema, e o escopo do plano cresce.

## 5. Contratos

### 5.1 `src/main/engine/contract.ts`

```ts
/** What a reading agent of a run is confined to: the run's worktree and the documentation folders it was given. Only a run's call carries one. */
export interface ReadConfinement {
  root: string;
  /** Absolute folders outside the worktree the call may still read (the documentation the config lists). */
  roots: string[];
  /** The hooks that enforce it (`runner/hooks.ts`, `readConfinedHooks`). */
  hooks: NonNullable<Options['hooks']>;
}

export interface EngineRequest {
  // ... o que já existe
  /** Set for an agent that may change files; read-only calls leave it out and keep the policy of the ceremonies. */
  confine?: Confinement;
  /** Set for an agent of a run that only reads: its file tools are confined to `root` and `roots`, with no Edit, no Write and no shell. */
  read?: ReadConfinement;
}
```

### 5.2 `src/main/runner/hooks.ts`

```ts
export interface ReadConfinementOptions {
  root: string;
  /** Folders outside `root` that a read may still reach: the roots checkPath is asked about, in order. */
  roots?: string[];
  /** Called for every refusal, before the agent is told: the runner posts it to the run's thread. */
  onDenied?: (denial: Denial) => void;
}

/** The hooks of an agent of a run that only reads: the ceremonies' read policy plus the path guard, so what exists today is never loosened. */
export function readConfinedHooks(o: ReadConfinementOptions): Hooks;
```

O `Denial.code` que sai daqui é um `DenialCode` de `checkPath` (`no-path`, `traversal`, `outside`,
`dangling`, `git`, `hooks`, `secret`), os mesmos códigos que a linha `runner.denied` já traduz
(`main.runner.denied.*`).

### 5.3 `src/main/agent.ts` (`sdkOptions` e a lista de documentação)

```ts
/** The documentation folders listed outside the working folder that a reading agent of a run may still read; empty when cwd is not an absolute folder. */
export function extraReadRoots(cwd: string, role: ModelRole): string[];

function asksOf(req: EngineRequest): boolean;      // !req.confine && !!req.ask
function shellOffOf(req: EngineRequest): boolean;  // inalterado
```

`sdkOptions` passa a:

```ts
const hooks = confine ? confine.hooks : read ? read.hooks : agentHooks(req.shell.patterns, host, req.ask);
// Edit/Write/disallowedTools/shell/VCS continuam decididos só por `confine` (aguardando o commit 2: `!confine && !read` para `Edit`/`Write`, que já é o caso por serem distintos).
const extraDirs = [...req.extraDirs, ...(read?.roots ?? [])];
...(extraDirs.length ? { additionalDirectories: extraDirs } : {}),
```

`extraReadRoots` é a mesma função que `runAgent` usa para montar `readRoot.roots` e que
`extraDirs(cwd, modelRole)` alimenta hoje (`agents.ts:1055`), para o que o motor enxerga e o que a
guarda permite não poderem divergir. Nas chamadas que não são de execução ela devolve `[]` quando
`cwd` é vazio ou relativo, porque uma raiz relativa não serve de raiz.

### 5.4 `src/main/agents.ts` (`runAgent` e `toolsOf`)

`AgentCall`:

```ts
export interface AgentCall {
  // ...
  /** The run's worktree for an agent that writes; where a reader looks at the code too. */
  cwd: string;
  confine?: Confinement;
  /** The confinement of a reading agent of a run: the file tools stay inside it, and no Edit, Write or shell is offered. */
  readRoot?: ReadConfinement;
}
```

`runAgent` repassa `read: call.readRoot` no `EngineRequest`. `toolsOf` não muda: continua decidindo
por `confine`, porque `readRoot` nunca abre ferramenta nenhuma a mais.

### 5.5 `src/main/runner/executor.ts`

No `runStage`, onde hoje está `confine: writes ? { ... } : undefined`:

```ts
const readConfinement: ReadConfinement | undefined = writes
  ? undefined
  : { root: wt, roots: extraReadRoots(wt, agent.model.role ?? 'deep'), hooks: readConfinedHooks({ root: wt, roots: extraReadRoots(wt, agent.model.role ?? 'deep'), onDenied: denied }) };

const call: AgentCall = {
  // ...
  confine: writes ? { root: wt, hooks: confinedHooks({ root: wt, commands, onDenied: denied }) } : undefined,
  readRoot: readConfinement,
};
```

As recusas do leitor entram pela mesma função `denied` que já escreve a linha `runner.denied`
(`executor.ts:416-422`), com o agente, a ferramenta, o alvo e o motivo.

### 5.6 As chamadas de leitor de uma execução fora da etapa

- **Cadeia de perguntas** (`src/main/runner/service.ts:1113`): quando `existsSync(run.worktree)`, o
  `AgentCall` recebe `readRoot` com `root = run.worktree` e os hooks de `readConfinedHooks`, com
  `onDenied` escrevendo a mesma linha na conversa da execução. Quando a pasta de trabalho não
  existe, a chamada fica como está hoje (sem confinamento de leitura).
- **Menção numa conversa de execução** (`src/main/mentions/answer.ts:125-146`, chamada pelo
  runner em `service.ts:1019-1030`): a menção é um leitor e recebe a mesma raiz. Como o
  `MentionDeps` já tem `openSession`, que o runner fornece e que recebe o `Run` (`service.ts:1036-1042`),
  o `readRoot` é preenchido ali — num lugar que só o runner tem — em vez de o núcleo de menções
  adivinhar a pasta de trabalho a partir de `place.run`. Um `MentionDeps.readRoot?: (cwd: string) => ReadConfinement | undefined`
  mantém o núcleo de menções genérico: o runner devolve o confinamento da execução; os outros
  donos devolvem `undefined`.
- **Menção fora de uma execução** (`src/main/mentions/module.ts`) e **menção de cerimônia**
  (`src/main/mentions/ceremony.ts`): sem confinamento de leitura nesta mudança.
- **Contato entre squads** (`src/main/runner/service.ts:1180`): sem confinamento de leitura nesta
  mudança.

### 5.7 O que **não** entra

- Interruptor de sandbox do próprio SDK: a árvore lê uma opção que nega a leitura de arquivos fora
  das pastas de trabalho (`blockReadsOutsideWorkingDirectories`, em `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`),
  mas ela é uma negação do processo inteiro, sem alvo, e não é o mecanismo que a issue pediu. A
  guarda do projeto é a que já produz a recusa certa, o relato na conversa e a marcação de bloqueado.
- Campo de configuração novo, migração, schema, tela e chave de idioma nova.
- Largar o SDK: fora de escopo.
- Reduzir a lista de pastas de documentação entregue ao motor: o que muda é que ela passa a valer
  também dentro da guarda de leitura.

## 6. Casos de teste

Tudo com o motor falso de `test/helpers/` (nunca um modelo, nunca a rede). Nenhum arquivo de teste
novo é necessário; os quatro pontos abaixo são edições nos arquivos que já cobrem o caminho.

1. **`test/runner-lifecycle.test.ts`** — numa execução de verdade (runner falso), o refiner e o QA
   (agentes de leitura) saem de `engine.calls` com `readRoot` definido, `readRoot.root` igual à pasta
   de trabalho e os hooks de leitura presentes; o developer (que escreve) sai com `confine` e sem
   `readRoot`. O leitor continua com `exec === undefined` quando o agente não tem shell.
2. **`test/runner-agent-open.test.ts`** — com o provedor local falso do arquivo, um `runAgent` de
   um leitor com `readRoot` ligado, no motor aberto: uma leitura dentro da pasta de trabalho passa
   (critério 1), e uma leitura de um caminho absoluto fora (2), com `..` (3), com `~` (4), por um
   link que sai (5), dentro de `.git` (6) e de um arquivo de nome de segredo (7) é recusada e o
   modelo lê o motivo. Um teste irmão confirma que, com o interruptor desligado, nada disso é
   recusado: é a prova de regressão da lacuna.
3. **`test/runner-agent-open.test.ts`** — a recusa de um leitor aparece na atividade ao vivo como
   bloqueada (`activityLog.get(...)` com `state === 'blocked'`), como o teste do agente que escreve
   já faz, e `onDenied` recebe `{ tool, target, code }` (critério 8). Um teste irmão confirma que,
   com `readRoot` ligado, o leitor continua sem `Write`, sem `Edit` e sem `Bash` na lista de
   ferramentas (critério 9 e regra 7 — a armadilha do `toolsOf`).
4. **`test/runner-agent-open.test.ts`** — a composição dos hooks: um leitor confinado recusa um
   arquivo de segredo (critério 7), recusa uma busca ampla e continua censurando o resultado de uma
   busca, provando que `noSecrets`, `noBroadSearch` e `redactSecretResults` não foram substituídos
   pela guarda de leitura.
5. **`test/worktree-guard.test.ts`** — a guarda de leitura contra uma raiz extra: um caminho dentro
   da pasta de documentação permitida passa, e uma pasta irmã (listada fora da lista) é recusada
   (critério 11); uma raiz relativa é ignorada.
6. **`test/agent-roles.test.ts`** (edição) — `extraReadRoots` com `cwd` absoluto devolve as pastas
   listadas fora do `cwd`, sem as achadas por auto-detect e sem descendentes do `cwd`; com `cwd`
   vazio devolve `[]`.
7. **`test/agent-roles.test.ts`** (edição) — regressão das decisões de `sdkOptions` que não podem
   mudar: com `read` ligado e sem `confine`, `Edit` e `Write` continuam fora de `disallowedTools`
   (isto é, continuam sendo negados), o shell continua desligado, e `asks` continua falso; um
   `extraDirs` de cerimônia com `read` presente soma as raízes extras à lista que já ia.
   `test/agent-resume.test.ts:59` continua valendo, porque o resume usa `request.extra`, não o
   `read`.
8. **`test/runner-chain.test.ts`** (edição) — a chamada da cadeia de perguntas de uma execução sai
   com `readRoot` igual à pasta de trabalho (critério 10); com a pasta de trabalho removida, sai sem
   `readRoot`.
9. **`test/forum-mentions.test.ts`** (edição) — a menção numa conversa de execução (o caminho do
   runner, com `place.kind === 'run'`) sai com o confinamento de leitura; a menção num canal e a de
   uma conversa geral continuam sem ele (critério 10).
10. **`test/runner-squads-requests.test.ts`** (edição) — o contato de um squad chamado por outro
    continua sem confinamento de leitura, lendo o repositório do próprio squad (critério 10).
11. **`test/mentions-call-line.test.ts`** (edição) — uma menção de cerimônia continua sem
    confinamento de leitura e sem raiz relativa (a raiz de leitura nunca é uma lista vazia com
    `cwd` vazio).

Critérios da especificação sem teste novo, porque já estão cobertos pela suíte atual: a pasta do
ciclo dentro da raiz (critério 1, o `withExpect` case do runner cobre a pasta do ciclo como pasta
comum) e a linha na conversa da execução (critério 8, coberta para quem escreve em
`test/runner-e2e.test.ts` e reaproveitada pelo mesmo `denied`).

## 7. O que muda, por área

- **Um agente que só lê numa execução (o pedido da issue):** a leitura dele passa a ficar dentro da
  pasta de trabalho da execução e da pasta do ciclo.
- **O agente que escreve:** nada muda.
- **As cerimônias:** nada muda.
- **A conversa e a atividade:** uma leitura recusada numa execução aparece como as outras recusas:
  linha na conversa e chamada bloqueada na atividade.
- **A configuração:** nada muda nesta etapa (nenhum campo novo, nenhuma migração).
- **A documentação (`docs/runner.md`) e o changelog:** passam a dizer que a leitura do agente de
  uma execução fica na pasta de trabalho dela.

## 8. Riscos e como são cobertos

1. **Ligar o confinamento de leitura no campo `confine` exporia o leitor a `Edit`/`Write` e ao
   shell.** Cobertura: campo próprio (`readRoot`), com o caso 3 e o caso 7 provando que `toolsOf` e
   `disallowedTools` continuam decidindo por `confine`.
2. **Trocar os hooks do leitor pelos do confinamento tiraria a censura do resultado de busca e a
   recusa de busca ampla.** Cobertura: `readConfinedHooks` compõe (caso 4), em vez de substituir.
3. **O leitor perde as pastas de documentação que hoje alcança.** Cobertura: a lista que já ia para
   o motor vira a lista de raízes extras da guarda, num lugar só (`extraReadRoots`); uma pasta que
   hoje está na lista continua alcançável (caso 5, raiz extra; caso 1, a lista de `additionalDirectories`
   não encolhe). **Não verificado** onde as pastas foram achadas por auto-detect fora da pasta de
   trabalho: elas não entram na lista, e a seção 3.3 registra isso.
4. **Um `cwd` vazio ou relativo (cerimônia, pasta de reserva) viraria raiz de leitura relativa à
   pasta de trabalho.** Cobertura: `extraReadRoots` devolve `[]` e o commit 2 não liga `readRoot`
   fora de uma execução (casos 6, 10 e 11).
5. **A chamada da cadeia e a menção da execução não receberem o confinamento e a lacuna continuar
   por um caminho lateral.** Cobertura: os casos 8 e 9 olham o `AgentCall` das duas chamadas; a
   raiz sai do runner, que é quem tem a pasta de trabalho.
6. **Uma mudança de comportamento não pedida (por exemplo, a leitura do motor aberto, que já é
   confinada pelas raízes, passar a ser recusada pela guarda com outra mensagem).** Cobertura: o
   commit 1 é inerte e a suíte inteira passa sem edição antes e depois dele; o commit 3 só ajusta
   texto.
7. **Nomes de arquivo, host ou pessoa vazando num teste, num comentário ou no documento.** Cobertura:
   `node scripts/public-audit.mjs`; as fixtures novas usam `example.com`, `group/project` e `#123`.

## 9. Gates

Um commit só está pronto com os gates do `CLAUDE.md` verdes:

```
nvm use
npx tsc --noEmit
npx vitest run
node scripts/theme-audit.mjs
npm run i18n:lint
node scripts/public-audit.mjs
electron-vite build
```

Notas: nesta etapa o Node disponível no computador é o 26.5.1 (`nvm` não está instalado aqui,
conferido), e mesmo assim `npx tsc --noEmit` e `npx vitest run` passaram sem alteração. A mudança
não cria chave de catálogo, não mexe em token de tema e não muda texto de prompt coberto por
snapshot (as chaves de recusa já existem nos dois idiomas), então `i18n:lint`, `theme-audit` e as
guardas de catálogo congelado não devem exigir exceção — **não verificado** nesta etapa, porque
nenhum deles foi rodado.

## 10. A pergunta de escopo, e a resposta

A pergunta desta etapa era o alcance fora de uma execução (regra 9 da especificação e a seção 3.4
daqui): **raiz igual à pasta de trabalho quando ela existe, e a chamada como está hoje onde não
existir** (menção num canal, numa conversa geral ou numa cerimônia; contato de squad que lê o
repositório do próprio squad).

A resposta foi **"deixa como está"**: a proposta fica de pé, e esses caminhos continuam sem
confinamento de leitura. O desenho fecha por aqui e nada muda na configuração: sem campo novo, sem
passo de migração (`src/shared/config/migrations.ts`, `STEPS`), sem tocar em
`src/shared/config/types.ts`, `defaults.ts` nem `schema.ts`, e sem migração de dados para os espaços
de trabalho existentes.

A outra escolha (as pastas de documentação) fica resolvida por derivação da configuração, sem campo
novo, na seção 3.3.

## 11. O que esta etapa não verificou

Nesta etapa rodaram apenas `npx tsc --noEmit` (sem erro), `npx vitest run` (3664 testes em 222
arquivos, todos verdes, na árvore **sem** as mudanças deste plano) e leitura de código (inclusive
dos arquivos empacotados do SDK em `node_modules`). Não rodaram `node scripts/theme-audit.mjs`,
`npm run i18n:lint`, `node scripts/public-audit.mjs` nem `electron-vite build` — **não verificado**.

Em particular, **não verificado**:

- que um agente leitor, no motor do Claude Agent SDK, passe a receber a guarda e recuse a leitura
  fora — só depois do commit 2 e com o provedor real;
- como o SDK trata o `additionalDirectories` que ele já recebe hoje: a árvore mostra que ele entra
  no escopo de permissão do processo (`sdk.mjs`, `additionalDirectories: ... "Additional directories
  to include in the permission scope"`) e que a SDK tem um interruptor próprio de negação de leitura
  fora das pastas de trabalho, mas nenhum teste desta árvore exercita leitura fora com o SDK real;
- que a recusa da guarda chegue com o motivo certo quando a leitura é feita por `Grep`/`Glob` com
  `path` e não por `Read` — o motor aberto cobre (`search.ts:99`, `:280`), o SDK não foi exercitado;
- o efeito real nas pastas de documentação achadas por auto-detect fora da pasta de trabalho
  (seção 3.3);
- se `Grep` e `Glob` são `allowedFor` em algum espaço de trabalho com `agents.tools.files` desligado
  (hipótese: não, e nesse caso o leitor não tem guarda porque não tem ferramenta — não verificado);
- que os gates `i18n:lint`, `theme-audit`, `public-audit` e o build passem com as mudanças.

## 12. O que a próxima etapa pega

Com a resposta de escopo dada ("deixa como está"), o desenho está fechado e nada mais trava a
implementação. A próxima etapa escreve o plano de teste a partir da seção 6 e, em seguida, a
implementação segue a ordem de trabalho da seção 4, commit a commit, até o commit 4 (docs e
changelog), fechando os gates da seção 9 ao fim de cada um.
