# Fazer a etapa conversar enquanto trabalha: receber, mandar e chamar outro agente

Spec: [`1_SPEC.md`](1_SPEC.md). Esta é a etapa que decide o desenho. Nada foi executado aqui: tudo abaixo é leitura do código e dos documentos desta árvore de trabalho, e o que não foi exercitado está dito como **não verificado**.

## 1. O que muda, em uma frase

A etapa deixa de ser um bloco fechado: a sessão do modelo que a trabalha passa a viver enquanto a etapa vive, e o app põe uma mensagem nela entre dois passos — do agente ou de outra pessoa; o agente ganha duas ferramentas (`SendMessage`, `CallAgent`) para falar e para abrir uma conversa com outro agente **sem** terminar a etapa; e um agente chamado passa a poder rodar comandos e (com `permission: worktree`) escrever, sob um dono único do worktree, dentro da autonomia da execução. A pergunta que bloqueia continua parando a etapa, e o caminho de hoje de uma menção a um agente que **não** está trabalhando não muda.

## 2. As decisões que esta etapa fixa

O `1_SPEC.md` deixou quatro pontos ao desenho. Todos ficam decididos aqui, com o motivo.

### 2.1 Quantas rodadas por conversa e quantas conversas por etapa

**Uma configuração, dois números novos na seção `runner`:** `runner.conversations.roundsPerConversation` (padrão **6**) e `runner.conversations.perStage` (padrão **3**). Uma "rodada" é uma mensagem de um dos dois lados; a conversa começa quando o agente que trabalha chama outro, e o teto de rodadas é por conversa, não da etapa inteira. Os dois números valem para a **sessão** de comandos do agente chamado (o teto de ida e volta) e o teto de conversas conta por **tentativa de etapa** (uma etapa devolvida e recomeçada ganha o teto de novo, como o orçamento de rodadas da revisão, que é da rodada). Um teto de rodadas **não** interrompe a etapa de quem chamou: a conversa encerra e quem chamou é avisado por mensagem, como o `1_SPEC` pede ("a conversa diz por quê").

Por que 6 e 3: 6 dá três idas e três voltas — uma pergunta, uma resposta, uma dúvida de volta, outra resposta e o fecho — sem virar um vaivém; 3 conversas por etapa cobrem o caso de uma etapa de desenvolvimento perguntar a um agente de QA, a um revisor e a um terceiro, e o teto existe porque cada conversa gasta uma sessão de modelo e, quando há comandos, uma sessão de sandbox. Os dois são configuráveis e um workspace que não os tenha lê os padrões; **não** há migração só por isso (ver 2.4).

### 2.2 O que a etapa faz com uma mensagem que chega quando ela está prestes a terminar

**A etapa fecha com o que já tem e a mensagem volta como mensagem no fórum, com o motivo.** O encaixe (2.3) só entrega uma mensagem entre dois passos do modelo; quando a resposta final já foi produzida, o app não tem onde enfiar a mensagem sem reiniciar a etapa — e reiniciar é justamente o que o `1_SPEC` proíbe. Então:

- **Mensagem que não pede nada** (um aviso, uma informação): quando o processo de entrega vê que a etapa já está concluindo, deixa a mensagem no fórum e a resposta da etapa **carrega a mensagem**, entre as marcas `<data>`, para ela não se perder para quem lê depois; a etapa **não** recomeça.
- **Mensagem que espera resposta** (o texto cita o agente com uma pergunta e quem escreve espera): a etapa fecha e o agente **não** recebe; a conversa ganha uma linha do app dizendo que a etapa terminou antes da entrega e que a mensagem não foi vista, para o silêncio não passar por recusa. É a pessoa que decide se devolve a etapa com a mensagem como nota — o caminho de `runs:sendBack`, que já existe e já leva uma nota para a etapa anterior.
- **Um pedaço que ajuda:** o mesmo porteiro é usado pela ferramenta `SendMessage` — uma mensagem que o agente manda é aceita enquanto a etapa trabalha e, depois que o processo de entrega começa, a ferramenta responde ao agente que não deu tempo e o texto vai para a conversa no fecho da etapa; a ferramenta nunca falha a etapa por isso.

Alternativa descartada: **reiniciar a etapa** para que a mensagem seja vista. É o comportamento que a issue existe para tirar, e reiniciar custaria a tentativa inteira por causa de uma frase.

### 2.3 Como a mensagem entra na sessão, nos dois motores

O ponto que a triagem e o refino marcaram como não verificado. A leitura desta etapa mostra que os dois motores têm hoje exatamente o mesmo formato de laço — uma chamada ao modelo, execução das ferramentas, resultado de volta — e que, em ambos, a resposta final pode ser pedida **sem** que as ferramentas ganhem o controle: o motor aberto aceita um `response_format` com `json_schema` (e a verificação `extractAnswer` roda sobre o texto da resposta), e no Claude Agent SDK a saída estruturada é do próprio SDK (`outputFormat`), sobre a última mensagem.

Por isso o desenho é uma **fase de coleta** no fim do laço, com uma porta de entrada nova no contrato do motor:

```ts
export interface EngineRequest {
  // ... o que já existe ...
  /** De onde o laço tira as mensagens que chegam entre dois passos, e para onde relata cada entrega. Só a etapa de uma execução tem uma. */
  incoming?: (delivered: (text: string) => void) => Promise<string | null>;
}
```

A chamada de uma etapa passa a ser **duas passadas**:

1. **A passada de trabalho**, como hoje: o laço roda com todas as ferramentas da etapa até o modelo achar que acabou. Quando ele responde e há `incoming` pendente, o motor **entrega** a mensagem: no motor aberto, escreve uma mensagem de usuário (uma linha do app enquadrando o texto, o texto entre `<data>` e um lembrete curto de que o resultado final continua sendo o da etapa) e faz **mais uma** chamada ao modelo; no Claude Agent SDK, o encaixe é a sessão viva do próprio SDK — o texto entra como mensagem de usuário e o laço segue sem reiniciar a etapa. Isto vale nos dois motores e é o que o `1_SPEC` chama de "entre dois passos do modelo".
2. **A passada de coleta**, inegociável: quando a porta de entrada não tem mais nada e o modelo responde de novo, o motor pede a resposta final **sem nenhuma ferramenta** (motor aberto: `tools: undefined` com o `response_format` do esquema; SDK: a saída estruturada com a lista de ferramentas vazia), no mesmo diálogo. É essa resposta que vira o resultado da etapa, e é ela que garante que uma mensagem no meio nunca faça a etapa terminar com um texto solto em vez do `summary`/`artifacts` de sempre.

O **processo que entrega** fica no `src/main/runner/inbox.ts`: a fila de mensagens da etapa, as entregas, e o interruptor `closing` do porteiro de 2.2. Ele é alimentado por `onMessage`: quando um `post` de pessoa com `@` chega numa thread `run-` e o agente citado é o da etapa que está trabalhando, a mensagem **entra na fila da etapa** em vez de abrir a chamada paralela de hoje (que continua para todo agente que não é o da etapa, e para a execução que não está trabalhando). A tela mostra a entrega como uma linha de sistema na conversa (`runner.message.delivered`, com o agente e a hora) e, na mensagem, o estado pendente (`runner.message.waiting`), do mesmo jeito que uma pergunta que espera.

**O que é o piso e o que é o ideal.** O que está descrito acima é o comportamento em código e é o que os testes exercitam. **Não verificado:** se o Claude Agent SDK, entre uma chamada e a seguinte, aceita de fato uma mensagem de usuário na sessão já em andamento e se a saída estruturada sobrevive a isso — é a forma da API e o comportamento do SDK real, e esta etapa só leu os tipos e o código que já usa `resume`; a implementação confere na árvore durante a fase 1 e, se o SDK não aceitar, o caminho de retomada equivalente já existe e está descrito em 2.3.1.

#### 2.3.1 O caminho de retomada, se o SDK não aceitar uma mensagem no meio

O motor aberto já sabe reabrir um diálogo pelo `sessionId` (`resume`): ele relê o JSONL da sessão, reescreve a mensagem de sistema e continua. É o mesmo mecanismo que a resposta a uma menção usa hoje. Se o SDK recusar a mensagem em sessão viva, a passada de trabalho termina, a mensagem é entregue como um **novo** `query()` com `resume: <sessionId>` e **só** essa mensagem no prompt, e a passada de coleta segue no mesmo id de sessão. Do ponto de vista da etapa não muda nada: não há reinício da etapa, o worktree é o mesmo, o sandbox da etapa é o mesmo e o uso continua contando na etapa. Só a fase 1 decide entre os dois, e o teste de 7.1 é o mesmo para os dois.

### 2.4 Onde ficam os números e por que não há migração

A seção `runner` ganha um bloco novo, com os dois inteiros de 2.1. Como o campo é **opcional e lido com padrão quando ausente**, um arquivo guardado sem ele abre com o comportamento novo sem passo de migração: é a mesma escolha que `runner.linkDependencies` e `squads` já usaram ("um campo com padrão; a migração só escreve o padrão quando o padrão é o que a leitura faria de qualquer jeito"). Isto é uma decisão consciente: o repositório diz que uma mudança de config precisa dos três arquivos (`types.ts`, `defaults.ts`, `schema.ts`) e de um passo em `STEPS` quando o arquivo guardado **precisa** mudar; aqui ele não precisa, e um passo que só escrevesse o padrão subiria `CONFIG_SCHEMA_VERSION` de 12 para 13 sem ganho — e a migração não pode ser testada contra o arquivo real de ninguém nesta etapa. O plano registra a alternativa e a deixa como decisão de quem implementa **somente se** o teste de deriva do esquema exigir o passo (o teste pede que os padrões contenham o que o esquema declara; os três arquivos, não a migração). Ver 7.6.

## 3. O que a leitura desta etapa confirmou

Tudo abaixo foi lido nesta árvore de trabalho. Nada foi executado (seção 7).

| Fato | Onde |
|---|---|
| `openStageSandbox` lê `d.forum.append(runThreadId)` e a auditoria, imprime o **número** `n` de cada comando e usa o worktree | `src/main/runner/executor.ts:233-280` |
| A etapa chama um `AgentCall` de `runAgent`; o motor é `StageEngine` | `src/main/runner/executor.ts:424-445`, `src/main/agents.ts:1037-1082` |
| Um `@` de pessoa numa thread de execução abre `answerMentions` com o leitor **forçado** `permission: 'read'` e sem escrita | `src/main/runner/service.ts:894-912`, `src/main/mentions/answer.ts:103` |
| A menção a um agente que trabalha é atendida **em paralelo**, em fila serial por execução, sobre o **worktree** quando é thread de execução | `src/main/runner/service.ts:905-911`, `src/main/mentions/answer.ts:180-189` |
| O agente que só lê recebe uma cópia descartável; o que escreve, nenhuma | `docs/runner.md` (Perguntas e menções), `src/main/sandbox/copy.ts` |
| O sandbox **não** sabe de quem é o comando: só o motor/executor sabe | `docs/cycles/30-agent-permissions/feat/2_PLAN.md:179-215` |
| A lista de comandos por agente da execução hoje **não existe**: `Run` não guarda comandos e o log do sandbox é descartado ao fim da etapa | `src/shared/runs/types.ts`, `src/main/runner/executor.ts:460` |
| O motor aberto faz a chamada final com `response_format` **sem** ferramentas e valida o texto | `src/main/engine/open/loop.ts:446-456` |
| O motor aberto reabre um diálogo pelo `sessionId` e reescreve o sistema | `src/main/engine/open/session.ts:73-75`, `src/main/engine/open/loop.ts:310-327` |
| O Claude Agent SDK usa `outputFormat` com `json_schema` e recebe `resume` e `maxTurns` por opções | `src/main/agents.ts:388-416`, `src/main/agents.ts:1092-1101` |
| A resposta de uma menção "sem passos" é uma retomada **com a lista de ferramentas vazia** | `src/main/agents.ts:1086-1109` |
| O motor aberto oferece as ferramentas de app por `extraTools`, em processo | `src/main/engine/open/loop.ts:147`, `src/main/agents.ts:469` |
| Só o `runClaudeSdk` monta servidores MCP em processo | `src/main/agents.ts:517-524` |
| O `watchdog` já serve a qualquer chamada e tem `pause()` para quando o relógio para | `src/main/runner/executor.ts:140-215` |
| Cada comando do `shell: host` pede o "sim" da pessoa; a pergunta é serializada por execução e a tela segue lendo `Run.command` | `src/main/runner/service.ts:287-323`, `src/main/runner/executor.ts:293-306` |
| Um comando que não pôde rodar **não** é resultado do código: `ENOENT`, `EACCES`, 126, 127 → `notRun` | `src/main/runner/commands.ts:20-22`, `:66-76`, `:96-102` |
| Uma etapa que produz artefato e é devolvida **reescreve** o mesmo arquivo; a UI marca a segunda metade do plano | `docs/runner.md` ("Devolver para uma etapa"), `src/main/runner/executor.ts:463-493` |
| A revisão lê o diff com `--no-ext-diff --no-textconv`, sem a pasta do ciclo | `docs/runner.md` ("Agente que escreve") |
| Um `AgentCall` tem `maxTurns`, `wrapUp`, `beat`, `onUsage` e `abort` | `src/main/agents.ts:968-996` |
| As seções do plano de referência e a forma dos documentos do ciclo | `docs/cycles/9-.../feat/2_PLAN.md`, `docs/cycles/53-.../2_PLAN.md`, `docs/cycles/58-.../2_PLAN.md` |
| A escrita externa só sai por `Actions`; o push e o pull request esperam sempre | `docs/runner.md` ("O que fica no host de código"), `src/main/actions.ts`, `webPolicy.ts` |

## 4. Ordem de trabalho (seis commits)

Cada commit fecha um passo lógico e deixa a árvore verde nos gates da seção 6.

### Commit 1 — `feat: thread the stage across the turns and deliver a message between steps`

O motor e a porta de entrada.

- `src/main/engine/contract.ts`: `EngineRequest.incoming` (2.3).
- `src/main/engine/open/loop.ts`: a fase de coleta; entrega da mensagem como mensagem de usuário e a chamada final **sem** ferramentas com o `response_format` do esquema; `maxTurns` conta as voltas da entrega.
- `src/main/agents.ts` (`runClaudeSdk`): a mensagem entra na sessão viva; a resposta final é pedida com a lista de ferramentas vazia; e o caminho de 2.3.1 (retomada pelo `sessionId`) se a sessão viva recusar.
- `src/main/runner/inbox.ts` (novo): a fila, a entrega, o interruptor `closing` e as linhas de sistema.
- `src/main/runner/executor.ts`: cria a caixa, pendura-a no `call` e fecha-a no `finally`, antes do sandbox.

### Commit 2 — `feat: send and receive messages inside a working stage`

A fiação da etapa e as duas linhas novas.

- `src/main/runner/service.ts`: `onMessage` manda para a fila da etapa a mensagem que cita o agente que está trabalhando (e mantém a chamada paralela para todo o resto); a linha de espera na mensagem e a de entrega.
- `src/main/runner/executor.ts`: o resultado da tentativa carrega o que foi entregue; o fecho de 2.2.

### Commit 3 — `feat: let an agent send a message and call another agent`

As duas ferramentas.

- `src/main/runner/tools.ts` (novo): `sendMessageTool`, `callAgentTool`, `askConversationTool` e o construtor `runnerTools(toolsOf(call), mode)`.
- `src/main/agents.ts` (`AgentCall.runnerTools`, `mode`), `src/main/engine/open/loop.ts` (`extraTools` já existe), `src/main/agents.ts` (MCP em processo no SDK).
- `src/main/runner/conversation.ts` (novo): a validade do agente chamado, o dono do worktree, o teto de conversas e a recusa do ciclo.
- `src/main/runner/prompt.ts` e os catálogos: as regras das duas ferramentas na etapa que as tem.

### Commit 4 — `feat: let a called agent run commands and be its own list`

A sessão de comandos e a escrita do agente chamado.

- `src/main/runner/conversation.ts`: a sessão da conversa, a linha por conversa no log da execução, a auditoria e a revelação do dono.
- `src/main/runner/executor.ts`: a interface do dono do worktree ao redor da sessão da etapa; o registro de comandos por agente; a leitura por instante para a revisão.

### Commit 5 — `feat: count a conversation against the stage that called it`

- `src/main/runner/conversation.ts`: o uso da sessão da conversa somado ao uso da etapa de quem chamou e o teto de conversas por tentativa.
- `src/main/runner/service.ts`: as conversas sem dono no fim da etapa.

### Commit 6 — `feat: put the conversation settings in the workspace config`

- `src/shared/config/{types,defaults,schema}.ts` (e `docs/configuration.md`): o bloco `runner.conversations` de 2.4.
- `test/config-schema.test.ts` (deriva) e o resto dos gates.

## 5. Contratos

### 5.1 `EngineRequest.incoming`

```ts
export interface EngineRequest {
  // ...
  /**
   * A porta de entrada de uma etapa que conversa: o motor a chama quando o modelo termina um passo e não há resposta final; devolve a próxima
   * mensagem a entregar ou `null` quando não há. `delivered` é chamado quando a mensagem entrou na sessão (o app escreve a linha de entrega).
   * Ausente: a chamada é a de hoje, uma passada só.
   */
  incoming?: (delivered: (text: string) => void) => Promise<string | null>;
}
```

### 5.2 `src/main/runner/inbox.ts`

```ts
export interface StageInbox {
  /** A próxima mensagem a entregar, ou uma promessa que acorda quando ela chegar. `null` só depois de `close`. */
  next(): Promise<string | null>;
  /** A mensagem entrou na sessão: a linha de entrega e a marca de tempo. */
  delivered(text: string): void;
  /** A etapa começou a entrega: uma mensagem que chegue agora não é vista e volta como mensagem no fecho. */
  closing(): void;
  /** A entrega acabou (bem ou mal): fecha a fila e libera quem espera. */
  close(): void;
}
export function openInbox(runId: string, stage: string, agent: string, forum: ForumStore, now: () => string): StageInbox;
```

`next()` nunca devolve antes de haver mensagem: o motor o chama **quando** quer uma. `close()` faz um `next()` pendente resolver com `null` (a passada de coleta segue) e uma mensagem que chegue depois é registrada no fecho (2.2).

### 5.3 As ferramentas (`src/main/runner/tools.ts`)

```ts
export function sendMessageTool(send: (to: string, text: string) => void): ToolImpl   // SendMessage
export function callAgentTool(call: (to: string, topic: string, place: 'run' | 'new') => Promise<string>): ToolImpl
export function askConversationTool(ask: (to: string, text: string) => Promise<string>): ToolImpl
export function runnerTools(o: { tools: string[]; mode: 'none' | 'run' | 'worktree' }): ToolImpl[]
```

`runnerTools` é uma transformação **pura** da lista de ferramentas do agente, para os dois motores lerem a mesma política:

| Modo | O que muda na lista |
|---|---|
| `none` | nada (a chamada de hoje: menção, pergunta da cadeia, pedido de squad) |
| `run` | acrescenta `SendMessage` e `CallAgent`, quando a lista já tem ferramenta de app (não é uma chamada sem ferramentas) |
| `worktree` | `run`, mais as ferramentas de escrita (`Write`, `Edit`, `Bash`, `Shell`) quando a etapa de origem as tinha, para o agente chamado com `permission: worktree` |

Sem rede, sem host de código: nada disso muda.

**`SendMessage`** — parâmetros `{ to: string, text: string }`; `to` é o id de um agente do time, ou `''` para a pessoa, ou `'todos'`. O texto é mascarado (`redact`) e publicado na conversa da execução como um `post` de agente **interno**. A ferramenta responde em texto: quem recebeu, ou (fora da janela, 2.2) que não deu tempo. Uma pergunta para a pessoa **não** pausa a etapa, pelo desenho de `1_SPEC`. Não lista agentes inventados: um `to` que não é do time é recusado com a lista.

**`CallAgent`** — parâmetros `{ to: string, topic: string, place: 'run' | 'new' }`. Recusa, com o motivo em texto, quando: o `to` não é agente do time, o `to` já está na **cadeia de chamadas** (o ciclo, seção 3 do `1_SPEC`), ou o teto de conversas da tentativa estourou. Aceita: abre a conversa (5.4) e responde ao chamador com o identificador da conversa; o **primeiro texto fica para a conversa** (o modelo que chama decide o tom). Cada resposta do outro agente entra na sessão de quem chamou pela mesma porta de `incoming` (seção 1 do `1_SPEC`).

**`askConversation`** (a ferramenta que o agente **chamado** tem) — parâmetros `{ to: string, text: string }`: devolve o texto ao outro lado da conversa. O agente chamado chama essa ferramenta para continuar falando; se ele simplesmente termina o passo sem chamá-la, a conversa acabou — o que o `1_SPEC` chama de "qualquer um dos dois pode encerrar". Quando ele chama, o app devolve **a próxima mensagem do outro lado** (ou o fecho, quando o outro lado terminou). O relógio da conversa (ociosidade e relógio total, `limitsOf`) cobre cada passo, não a conversa inteira.

### 5.4 `src/main/runner/conversation.ts`

```ts
export interface ConversationDeps {
  run: Run; stage: string; caller: AgentDef; team: AgentDef[];
  forum: ForumStore; config: () => WorkspaceConfig;
  sandbox?: SandboxService;
  /** A chave da conversa, para o teto e para o registro da execução. */
  conversation: { key: string; place: 'run' | 'new'; thread: string; called: string; round: number; startedAt: string; ended?: string; reason?: 'rounds' | 'ended' };
  /** Devolve a próxima mensagem de quem chamou; `null` quando ele terminou a etapa ou já não fala. */
  fromCaller(): Promise<string | null>;
  /** A conversa terminou: quem chamou é avisado por mensagem. */
  done(reason: 'rounds' | 'ended', said: string): void;
  /** Onde a conversa é registrada, e como o dono do worktree é revelado (5.5). */
  record(change: Partial<ConversationRecord>): void;
  own(mode: 'conversation' | 'none'): { release(): Promise<void> };
}
export async function runConversation(deps: ConversationDeps): Promise<void>;
```

**O agente chamado trabalha como um leitor, com duas diferenças:** ele mantém o `tracker` do agente, nunca tem o CLI do host nem MCP; e a **sessão dele é a da conversa** — o sandbox é aberto sobre o worktree da execução (o `1_SPEC` diz "a sandbox da execução"), com `reader: !(agent.permission === 'worktree')`, com o "sim" da pessoa por comando no `shell: host`, e **fechado junto com a conversa**. Cada comando dele escreve a linha `runner.exec` de hoje, com `{ agent, n, command, result, ms, tail }`, e vai para a auditoria com `by: chamado` e `via: host|sandbox`; **a linha e a auditoria são o "sob o QA" da resolução** (o `n` já é a ordem da execução inteira). Não há segunda numeração por agente (ver decisão 3, na seção 8).

**Um teto de rodadas não estoura o sandbox:** quando o contador de rodadas bate o teto, o app termina a conversa, o agente chamado responde **uma última vez** com o que já leu (é o caso em que ele tem algo a dizer e não é o caso de cortar a fala), e é o passo seguinte, na ordem natural do laço, que fecha o sandbox — não há passo do modelo com a sessão já morta.

### 5.5 O dono do worktree (`src/main/runner/executor.ts` e `conversation.ts`)

```ts
export interface WorktreeOwner {
  /** A etapa larga o worktree: as conversas começam; `release` espera as que ainda rodam. */
  lend(runId: string, key: string): void;
  /** A conversa terminou: quando é a última, a etapa volta a ser a dona. */
  take(runId: string, key: string): void;
  /** Um leitor do estado, para o executor esperar a vez depois de largar. */
  active(runId: string): boolean;
}
```

Regras, e por que cada uma:

- **Donos:** a **etapa** de um agente que escreve, e uma **conversa** de cada vez quando o chamado tem `permission: worktree`. O agente chamado que **não** escreve não pede nada: o sandbox dele recebe uma cópia descartável, como hoje (`reader: true`), e a etapa não precisa largar nada.
- **Ao fim do passo** de um agente que escreve, o sandbox da etapa é largado e o `head` da branch é anotado (`lend`); o passo seguinte o reassume (`take`). É a janela "entre duas passadas" do `1_SPEC` ("um escritor por vez, e o que o outro vê"), que é a única forma honesta de duas sessões **sandbox** não escreverem juntas — o sandbox não sabe de dono.
- **Enquanto a conversa é a dona**, a etapa não abre o worktree: o processo de entrega **espera** a conversa terminar (`take`) antes de voltar a trabalhar. A espera é curta porque o dono é único e a conversa tem teto de rodadas; e não trava nada, porque o passo que pediu a conversa já voltou e o agente só espera o resultado que ele mesmo pediu. **Limite conhecido:** uma conversa que não termina nunca (um agente chamado que fala sozinho) segura a etapa pelo relógio **da conversa** — a decisão é deixar a conversa acabar sempre, e ela tem o relógio de ociosidade e o teto de rodadas. Dito em palavras simples na tela: a etapa espera a conversa, e a conversa diz que está esperando.
- **O que o outro vê:** a etapa que reassume depois de largar **relê** o worktree (os passos seguintes relêem os arquivos, como sempre) e recebe uma mensagem de sistema na sessão, com o **instante** e o **resumo** do que a conversa mudou; a revisão (mais abaixo) lê a mudança pelo que a conversa commitou. Nenhum agente lê um diff de "meio passo" de outro.
- **O commit do trabalho da conversa.** O `1_SPEC` cobra "o que disso é commitado, e com que etapa". Decidido: **o trabalho do agente chamado é commitado com a etapa que chamou** — ele acontece dentro do relógio dela, no worktree dela, e é a etapa que responde pelo resultado. O commit é feito pela **conversa, no fecho dela**, com a identidade do runner, pelo mesmo caminho (`git add -A` sem as pastas de dependências ligadas, `core.hooksPath=/dev/null`, sem assinatura); a mensagem usa o `runner.commitMessage` de sempre e diz que é um commit de conversa. Por que no fecho e não junto do commit da etapa: a revisão lê a mudança pelo `head` da branch que a etapa dela anotou, e um trabalho que só aparecesse mais tarde ficaria sem quem o revisasse. Uma conversa que não mudou nada **não** commita.
- **A revisão:** `readDiff` passa a receber um `head` de início (`from`) e a ler `git diff <from>..<stageHead>` no lugar de `git diff <base>...<HEAD>`, e a pasta do ciclo continua fora. É o que dá a cada etapa a mudança "feita com ela", contando o trabalho do agente chamado.

### 5.6 A configuração (commit 6)

```ts
// types.ts
runner.conversations: { roundsPerConversation: number; perStage: number };
```

| Campo | Padrão | Faixa | O que diz |
|---|---|---|---|
| `runner.conversations.roundsPerConversation` | 6 | 1–50 | Quantas mensagens de cada lado uma conversa aceita antes de encerrar |
| `runner.conversations.perStage` | 3 | 1–20 | Quantas conversas uma tentativa de etapa pode abrir |

`defaults.ts` (`neutralRunner`) traz os dois; `schema.ts` traz os dois com a descrição em uma linha; `docs/configuration.md` recebe a linha do bloco `runner` e a linha do histórico do esquema (com a nota de que um arquivo sem o bloco lê os padrões). Sem passo em `STEPS` (2.4); se o teste de deriva exigir, o passo `v12ToV13` só escreve o bloco.

## 6. Testes e verificação

Nenhum teste toca rede, host de código ou modelo real: tudo com o motor falso de `test/helpers/` e o sandbox falso de `test/runner-sandbox.test.ts`.

| Arquivo (novo/estendido) | O que exercita |
|---|---|
| `test/engine-incoming.test.ts` (**novo**) | Os dois motores com um modelo roteirizado: uma mensagem entregue entre dois passos vira uma chamada a mais no mesmo diálogo; a fase de coleta pede a resposta final **sem** ferramentas e o `data` sai pelo esquema; `maxTurns` conta as voltas; sem `incoming` a chamada é a de hoje (os testes de motor existentes passam sem edição) |
| `test/runner-stage-messages.test.ts` (**novo**) | O `@` a um agente que trabalha entra na fila da etapa e **não** abre chamada paralela; a linha de espera na mensagem e a de entrega; uma mensagem depois do fecho volta no fórum com `runner.message.afterClose`; uma mensagem a um agente que não trabalha continua a chamada de hoje |
| `test/runner-send-call.test.ts` (**novo**) | `SendMessage` publica na conversa e a etapa segue; `CallAgent` abre conversa na conversa da execução ou numa nova ligada à execução; a recusa do ciclo de chamadas; o teto de conversas por tentativa; o teto de rodadas encerra a conversa e quem chamou é avisado; o agente chamado termina sozinho |
| `test/runner-conversation.test.ts` (**novo**) | O agente chamado com `permission: worktree` muda um arquivo e não há dois escritores ao mesmo tempo; o trabalho dele é commitado com a etapa que chamou; a revisão da etapa lê a mudança pelo `head` anotado; uma conversa sem mudança não commita |
| `test/runner-sandbox.test.ts` (estendido) | O log de comandos da execução por agente; a sessão da conversa fechada no fecho dela; um comando que não pôde rodar (`not-run`) não vira resultado do código |
| `test/runner-mention-actions.test.ts` (estendido) | **Nada muda** para uma menção a um agente que não trabalha: o `permission: 'read'` forçado, a cópia descartável e a resposta no fórum seguem como hoje |
| `test/config-schema.test.ts` (estendido) | A deriva dos três arquivos com o bloco novo; um arquivo sem o bloco lê os padrões; a faixa recusa 0 e 51 |
| `test/runner-golden.test.ts` | **Não pode mover** (o comportamento sem as duas ferramentas e sem mensagens entregues é o de hoje) |

**Verificação:** os gates do repositório rodados nesta árvore — `nvm use`, `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` — mais o `electron-vite build` do CI. **Nada disso foi rodado nesta etapa** (ver 9): os testes acima são o que a implementação roda, não o que esta etapa viu passar.

**Pontas que ficam para o QA (não verificado):**

- **O SDK real.** Se o Claude Agent SDK aceita uma mensagem de usuário na sessão viva e a saída estruturada sobrevive a isso, e se a alternativa de 2.3.1 entrega o mesmo resultado. Precisa de um modelo real.
- **O sandbox real (bubblewrap).** A conversa com comandos roda sobre o worktree da execução, com o sandbox de verdade: que o agente chamado não vê `/home`, que a rede segue desligada, e que largar e reassumir o worktree não quebra um processo deixado por um comando (um servidor de desenvolvimento largado por um passo e reassumido pelo seguinte — o sandbox é o mesmo, então por leitura deveria funcionar; **não exercitado**).
- **A corrida dos escritores.** Só o QA com o app em execução mostra que a revisão (que não escreve) e uma conversa nunca se cruzam. O desenho é conservador (um dono de cada vez, a etapa espera a conversa), mas não foi visto rodando.

## 7. Riscos

| Risco | Como é coberto |
|---|---|
| A etapa terminar com um texto solto quando uma mensagem entra no meio | A fase de coleta da resposta final **sem** ferramentas é parte do desenho, não um caso de borda: o `data` sai do esquema, com uma chamada, e o teste de motor cobre a mensagem no meio |
| O SDK recusar a mensagem em sessão viva | O caminho de retomada de 2.3.1 usa o `resume` que o motor aberto já tem e o `sessionId` que o SDK já devolve (`noteSession`); a fase 1 confere e escolhe, e o teste é o mesmo |
| A mensagem chegar quando a etapa já está fechando | O porteiro `closing` de 2.2: a etapa fecha com o que tem, a mensagem volta no fórum com o motivo, e a linha de sistema evita o silêncio; nada reinicia |
| A mensagem que chega no meio envenenar o resultado da etapa (injeção) | Ela entra como material de fora, entre `<data>`, como a conversa e a issue; o modelo continua com as instruções da etapa no sistema, e os quatro passos do `1_SPEC` (receber, mandar, chamar, os limites) são regras da etapa, não do que chega |
| Dois escritores no mesmo worktree | A interface do dono (5.5): o agente de sistema larga o worktree no fim de cada passo de escrita e a conversa de um chamado que escreve é a única dona; a etapa espera a conversa; a revisão só lê; e o teste de conversa cobre o caso |
| A conversa segurar a etapa | A conversa tem teto de rodadas e relógio de ociosidade próprios; e é quem chamou que a pediu, então a espera é pelo que ele pediu. Dito na tela (`runner.conversation.waiting`), para a espera não parecer travamento |
| O custo: cada conversa é uma sessão de modelo a mais | Os tetos de 2.1 (6 rodadas, 3 conversas por etapa) e o uso somado à etapa, pelo caminho que já existe (`Run.stages[].usage`); o teto de conversas é por tentativa, como o orçamento de rodadas |
| A conversa do agente chamado **não** receber uma cópia descartável e escrever no worktree real | É o que o `1_SPEC` pede (ele começa lendo e só escreve quando o ponto exige, com as `permission` dele), e por isso o trabalho é commitado com a etapa e revisado por ela; o que o agente chamado pode **não** fazer é host de código (nada de CLI/MCP), rede, push e escrita externa |
| A escrita do agente chamado sair de `Actions` | Nenhum caminho novo para o host: o agente chamado não tem CLI do host nem MCP, e push e escrita externa continuam na porta de sempre. `test/runs-policy.test.ts` pinna que só `door.ts` importa `Actions` e só `publish.ts` planeja uma escrita |
| O commit da conversa bagunçar a revisão (um commit no meio da etapa) | O `head` anotado no `lend` de cada passo de escrita é quem delimita o que cada etapa viu; a revisão lê `<from>..<head>` e a pasta do ciclo continua fora |
| O trabalho do agente chamado passar por cima dos documentos da etapa | O commit de `git add -A` é o mesmo de hoje; o guarda de escrita do agente chamado é o mesmo `checkPath`, e nada sob a pasta do ciclo é escrito por ele que não pudesse ser antes |
| O `SendMessage` virar um segundo canal de bloqueio | Ele **não** pausa por desenho; uma pergunta que precisa da pessoa continua pelo `question` de sempre (a etapa pausa), e o teste cobre os dois |

## 8. Registro de decisões

1. **Duas passadas, e a coleta é inegociável.** O laço de trabalho segue com as ferramentas; a resposta final sai de uma chamada sem ferramentas. Alternativa descartada: pegar a última resposta antes de fechar e aceitar o texto — quebraria o `summary`/`artifacts` por causa de uma mensagem.
2. **A fiação fina é `onMessage`.** Um `@` que chega numa thread de execução vai para a fila da etapa quando o agente citado **é** o da etapa que trabalha; todo o resto (agente que não trabalha, execução parada) mantém a chamada paralela. Alternativa descartada: um assunto novo no armazém do fórum — mexeria no que o `1_SPEC` manda não mexer e no caminho que a chamada por `@` acabou de estabilizar.
3. **O comando do agente chamado é o da execução, sob o agente.** A linha `runner.exec` de hoje já leva o agente; o `n` já é a ordem da execução. Alternativa descartada: numeração e contexto próprios por conversa — a issue fala de "a lista de comandos da execução", e o agente está **na** execução, não numa sessão à parte.
4. **A lista de comandos por agente é a resolução, não um campo.** O sandbox é montado por etapa e reaproveitado pela conversa; guardar a lista por agente no arquivo da execução exigiria mais um campo e um lugar para ele no esquema do arquivo, sem ganho de comportamento. A tela lê a linha e o nome que ela já tem; a auditoria tem `by`.
5. **O teto de rodadas é da conversa, não da etapa.** Uma conversa encerrada não impede a etapa de seguir; um ciclo aberto de novo é outra conversa, contada no teto de conversas por etapa (que é o freio). Alternativa descartada: um teto global de idas e voltas da etapa — não teria como dizer qual conversa passou do limite.
6. **A resposta final de uma etapa que só recebeu mensagens simples é a mesma do laço de trabalho.** A fase de coleta só existe quando houve entrega; sem mensagem, a chamada é exatamente a de hoje (o que mantém o `runner-golden` parado).
7. **Um dono do worktree de cada vez, com a etapa esperando a conversa.** Alternativa descartada: escrever em cópia e trazer para o worktree no fecho — inventaria um caminho de escrita que o guarda não vê, e o `1_SPEC` pede que o agente chamado use as `permission` dele **no worktree**.
8. **O trabalho do agente chamado é commitado com a etapa que chamou.** Alternativa descartada: commit a cada conversa — poluiria a história do ciclo e o "com que etapa" do `1_SPEC` ficaria sem resposta citável.
9. **Sem migração: um bloco com padrão.** Ver 2.4. Alternativa descartada: subir o esquema só para escrever o padrão, sem poder testá-lo contra um arquivo real de ninguém.
10. **O plano não escolhe a tela.** O aviso de entrega na tela, o link entre a execução e a conversa do fórum e o `@` da pessoa são da squad de experiência; o plano entrega as linhas de sistema, o registro e os tetos de que ela precisa.
11. **`SendMessage` para uma pessoa é interno.** Nada dele vai ao host de código por si: sem CLI, sem MCP, sem `Actions`. Só a saída da etapa publica, como sempre.
12. **A conversa pode abrir numa conversa nova do fórum**, ligada à execução nos dois sentidos (o `place` de `CallAgent`); a conversa de uma execução continua no `runThreadId` — a peça que já sabe resolver os dois lugares é reaproveitada.

## 9. O que esta etapa não verificou

Nada foi alterado nem executado nesta etapa: **nenhum gate foi rodado, nenhum teste, nenhum build; o aplicativo não foi aberto e nenhum modelo real foi chamado**. Tudo acima é leitura de código e de documentos desta árvore. Em particular, **não verificado**:

- que o Claude Agent SDK aceita uma mensagem de usuário numa sessão já em andamento e que a saída estruturada sobrevive a ela (o ponto que a triagem e o refino deixaram aberto, e que a fase 1 fecha);
- que o sandbox real abre sobre o worktree da execução para uma conversa e que largar e reassumir o worktree não quebra um processo deixado por um comando;
- que a corrida entre a etapa e o trabalho do agente chamado se comporta como o desenho diz, com o app em execução;
- que o fecho de 2.2 (a mensagem voltando no fórum com o motivo) é o que a pessoa espera na prática, ou se ela preferiria devolver a etapa — o caminho de devolver continua existindo e a decisão fica para o produto, depois de usar;
- o custo real de uma conversa por etapa (uma sessão de modelo e, com comandos, uma sessão de sandbox a mais por conversa).
