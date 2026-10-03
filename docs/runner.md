# O runner / The runner

[Português](#português) | [English](#english)

---

## Português

O runner leva uma issue pelo [ciclo de agentes](cycles.md) (`agent-flow`): cria uma branch e um worktree do repositório da issue, copia a issue para a pasta do ciclo e roda, uma etapa de cada vez, o agente de cada etapa, até um gate, uma pergunta, uma falha ou o fim. Tudo que ele faz fica no worktree e na conversa da execução: **nada é escrito no host de código** (os comentários na issue, a revisão nas linhas do pull request, o push e o pull request são de uma etapa seguinte). Configuração: a seção `runner` em [`configuration.md`](configuration.md).

### Começar uma execução

`runs:start(ref)` (a referência do cartão, como `app#101` ou só `101`). O app lê a issue e os comentários pelo provedor, só leitura, e então:

1. Escolhe o repositório: o único de `projects.repos` com o `projectPath` do projeto de issues (ou o único que existe, ou o que a chamada nomear); sem cópia local ele procura uma pela origem.
2. Busca a branch padrão da origem (uma leitura) e cria o worktree em `<worktreesDir>/<repo>/<n>-<título>` numa branch nova `cycle/<n>-<título>`. Uma branch ou uma pasta que já existe é recusada, nunca reaproveitada.
3. Escreve `docs/cycles/<n>-<título>/0_ISSUE.md` (título, endereço, rótulos, descrição e comentários humanos, com o que parece credencial mascarado) e faz o commit `feat: add the issue record #<n>`.
4. Abre a conversa da execução e entra na primeira etapa. Quem inicia a execução inicia também a primeira etapa.

Só há uma execução por issue por vez, e só em um workspace cujo ciclo é o ciclo de agentes. Se qualquer passo falha depois de o worktree existir, o worktree e a branch que esta chamada criou são removidos: é a única coisa que o runner apaga.

### Uma etapa

Para a etapa atual, o agente dela recebe um prompt montado pelo app: o trabalho e as instruções do agente, os documentos que a etapa precisa produzir, o conteúdo da pasta do ciclo até agora (a issue e os documentos anteriores), as últimas mensagens da conversa, o recado que outra etapa deixou para ele e a resposta da pessoa a uma pergunta dele. Tudo que veio de fora (issue, comentários, conversa, arquivos, diff) entra entre marcas `<data>` e o texto de sistema diz que é material, não instrução. Os textos estão no catálogo como `prompt.<família>.runner.*`.

A resposta é estruturada: `summary` (o que fez, para a conversa), `commit` (descrição curta para a mensagem do commit), `artifacts` (nome e conteúdo completo de cada documento), `handoff` (o que a próxima etapa deve fazer), `question` (algo que só a pessoa decide: pausa a etapa). A etapa de revisão acrescenta `verdict` e `findings` (cada um com `path`, `line`, `endLine`, `side`, `severity` `blocking` ou `suggestion`, `body` e `suggestion`, a troca exata das linhas comentadas, só quando completa); a de QA acrescenta `scenarios` (`name`, `result` `pass`, `fail` ou `not-run`, `detail`). Quem escreve os documentos e faz o commit é o **app**, nunca o agente: um agente que só lê produz os documentos da mesma forma, e um documento que a etapa não lista é ignorado (e dito na conversa).

Depois da resposta o app aplica a transição: pergunta pausa a execução; `blocking` (ou `verdict: changes`) devolve o trabalho ao desenvolvedor com os achados como recado e conta uma rodada (duas rodadas com achados e a execução para e pergunta); um cenário de QA que falha devolve ao desenvolvedor também, contando na mesma conta; qualquer outro caso é a etapa concluída. Os achados de cada rodada e os cenários de cada passada de QA ficam na execução (`Run.reviews`, `Run.qa`), do jeito que foram dados: é de onde os comentários de linha serão montados.

### Autonomia, escalonador e reinício

- Agente **autônomo**: a etapa começa quando a execução chega nela e o resultado segue adiante sem esperar. Agente que **espera**: a etapa fica em `to-start` até a pessoa iniciar (`runs:startStage`), e o resultado fica em `to-accept` até a pessoa aceitar (`runs:accept`) ou devolver com um recado (`runs:return`). Mudar a chave (`runs:setAutonomous`) vale a partir da próxima etapa, nunca no meio de uma. Os gates não mudam.
- Com `runner.enabled`, um trabalho a cada 5 minutos lista as issues abertas atribuídas à pessoa que levam o rótulo `runner.triggerLabel` e inicia execuções até `runner.maxConcurrentRuns` execuções **trabalhando** ao mesmo tempo (uma execução parada em um gate não conta). Uma issue que já teve uma execução, em qualquer estado, não é iniciada de novo sozinha: sem isso uma execução cancelada voltaria a cada passada. Uma issue que o app não consegue iniciar (sem cópia local, sem identidade) é tentada uma vez por sessão.
- Ao abrir o app, uma execução que estava no meio de um agente recomeça aquela etapa (nova tentativa); as que esperavam a pessoa continuam esperando. Uma etapa que passa de `runner.stageTimeoutMs` é interrompida e a execução fica `failed`, com tentar de novo (`runs:retry`) ou cancelar (`runs:cancel`). Cancelar interrompe o agente e não apaga nada: o worktree, a branch e a conversa ficam até a pessoa removê-los.

### Perguntas e menções

Uma pergunta do agente pausa a etapa, avisa pelas notificações do app e é respondida por `runs:answer` ou por uma mensagem da pessoa na conversa da execução (a mensagem vira a resposta, e a etapa recomeça com a pergunta e a resposta no prompt). Uma mensagem que cita um agente (`@developer ...`) não é resposta: chama aquele agente, que responde na conversa **só lendo**, qualquer que seja a permissão dele (a chamada não tem Edit, Write nem comandos). Só a mensagem de uma pessoa chama alguém.

### Agente que escreve

Um agente com permissão `worktree` roda com a pasta de trabalho no worktree da execução, nos dois motores, com **uma só função de guarda** (`src/main/engine/guard.ts`) na frente de cada escrita: no Claude Agent SDK ela é um hook `PreToolUse` sobre `Edit`/`Write`; no motor aberto são as ferramentas `Write` e `Edit` (que chamam a mesma função de novo, por dentro). As regras:

- Só caminhos dentro do worktree. Recusados: absoluto fora dele, `..` em qualquer lugar do caminho, `~`, um link simbólico no caminho que leve para fora (também para uma pasta e um arquivo novo sob ela), um link que não leva a lugar nenhum, a própria raiz.
- Nada dentro de `.git` (qualquer profundidade, qualquer caixa, nem por um link para ele), nem `.husky`, `.githooks`, `.gitattributes`, `.gitmodules`. Arquivos de segredo (`secretPath`) também não.
- Leitura (`Read`, `Grep`, `Glob`) só no worktree e fora de `.git` e dos segredos.
- Shell só para os comandos de `runner.commands`, **exatamente como escritos** (a mesma máquina do `shellAllowlist` das cerimônias, com uma lista própria); sem a lista, só `Read`/`Grep`/`Glob`/`Edit`/`Write`. No motor aberto o comando roda sem shell e com o ambiente sem variáveis que parecem credencial.
- Sem rede (`WebFetch`, `WebSearch`), sem `git push`, sem ferramentas de MCP nem do código host.
- Toda recusa vai para a conversa da execução como uma mensagem do app (quem, qual ferramenta, o quê, por quê) e aparece como "bloqueado" na atividade ao vivo.

Depois de uma etapa, o **app** faz o commit no worktree (`git add -A` e `git commit`) com a identidade de `runner.identity` ou, vazia, a que o repositório já tem (lida, nunca gravada), com `-c core.hooksPath=/dev/null` (um hook que o agente tenha mexido não roda), sem assinatura e sem monitor de arquivos, e a mensagem de `runner.commitMessage` (padrão `feat: <resumo> #<n>`). A mensagem nunca leva atribuição de ferramenta. Os documentos das etapas que só leem também são commitados pelo app. A revisão lê o diff com `--no-ext-diff --no-textconv`, sem a pasta do ciclo.

### Canais

| Canal | Faz | Navegador pareado |
|---|---|---|
| `runs:list`, `runs:get(id)` | lê as execuções | sim |
| `runs:answer(id, texto)` | responde a pergunta da execução (e uma mensagem na conversa também) | sim: o telefone é onde a pessoa responde, e uma resposta só deixa seguir a etapa que perguntou, com a mesma guarda |
| `runs:start(ref, repo?)`, `runs:startStage`, `runs:accept`, `runs:return(id, recado)`, `runs:gate(id, approve/reject/skip, motivo)`, `runs:retry`, `runs:cancel`, `runs:setAutonomous(agente, ligado)` | inicia trabalho ou muda uma execução, ou o que um agente faz sozinho | não: só a janela (`test/runs-policy.test.ts` fixa a lista) |

### Não verificado

- Nada rodou contra um modelo, um código host ou um repositório reais: os testes usam um motor roteirizado, um host que só lê e repositórios git temporários. O que um modelo de verdade faz com os prompts (e se escolhe bem o `commit`, os achados e as perguntas) não foi medido; os prompts em inglês foram escritos por tradução.
- O guarda foi testado com travessia de caminho, links simbólicos, caminhos absolutos e `.git/hooks`, nos dois motores; **não** contra um repositório hostil de verdade. Um comando da lista executa código do repositório (um `npm test` roda o que o `package.json` mandar) e pode fazer tudo que o usuário pode: a lista curta e escolhida pela pessoa é a defesa. No Claude Agent SDK o comando herda o ambiente do processo do SDK (que precisa da chave do provedor); só no motor aberto o ambiente é limpo.
- O `git add -A` leva para o commit tudo que um comando da lista criou e o `.gitignore` não cobre.
- O runner não escreve em issue, pull request ou código host, nem faz push: isso é a etapa seguinte. O painel de custo e a retenção ainda não reconhecem as sessões do runner como sessões do app.

---

## English

The runner takes an issue through the [agent cycle](cycles.md) (`agent-flow`): it makes a branch and a worktree of the issue's repository, copies the issue into the cycle folder and runs the agent of each stage, one at a time, until a gate, a question, a failure or the end. All it does stays in the worktree and in the run's thread: **nothing is written to the code host** (the comments on the issue, the review on the pull request's lines, the push and the pull request belong to a later change). Configuration: the `runner` section in [`configuration.md`](configuration.md).

### Starting a run

`runs:start(ref)` (the card's reference, such as `app#101` or just `101`). The app reads the issue and its comments through the provider, read only, and then:

1. Picks the repository: the only one in `projects.repos` whose `projectPath` is the issue project (or the only one there is, or the one the call names); without a local checkout it looks one up by its origin.
2. Fetches the origin's default branch (a read) and makes the worktree at `<worktreesDir>/<repo>/<n>-<title>` on a new branch `cycle/<n>-<title>`. A branch or a folder that exists is refused, never reused.
3. Writes `docs/cycles/<n>-<title>/0_ISSUE.md` (title, address, labels, description and human comments, with anything that looks like a credential masked) and commits it as `feat: add the issue record #<n>`.
4. Opens the run's thread and enters the first stage. Whoever starts the run starts its first stage too.

There is one run per issue at a time, and only in a workspace whose cycle is the agent cycle. If a step fails after the worktree exists, the worktree and branch that call made are removed: the only thing the runner ever deletes.

### A stage

For the current stage, its agent gets a prompt the app builds: the agent's job and instructions, the documents the stage must produce, the cycle folder as it is (the issue and the earlier documents), the latest messages of the thread, the note another stage left for it and the person's answer to a question of its own. Everything that came from outside (issue, comments, thread, files, diff) goes between `<data>` tags and the system text says it is material, not instruction. The texts are in the catalog as `prompt.<family>.runner.*`.

The answer is structured: `summary` (what it did, for the thread), `commit` (a short description for the commit message), `artifacts` (name and complete content of each document), `handoff` (what the next stage is to do), `question` (something only the person decides: it pauses the stage). A review stage adds `verdict` and `findings` (each with `path`, `line`, `endLine`, `side`, `severity` `blocking` or `suggestion`, `body` and `suggestion`, the exact replacement of the commented lines, only when complete); QA adds `scenarios` (`name`, `result` `pass`, `fail` or `not-run`, `detail`). The **app** writes the documents and makes the commit, never the agent: an agent that only reads produces its documents the same way, and a document the stage does not list is ignored (and said so in the thread).

After the answer the app applies the transition: a question pauses the run; a `blocking` finding (or `verdict: changes`) sends the work back to the developer with the findings as the handoff and counts a round (two rounds with findings and the run stops and asks); a QA scenario that fails sends it back to the developer too, on the same count; anything else is the stage done. The findings of each round and the scenarios of each QA pass are kept in the run (`Run.reviews`, `Run.qa`) as they were given: that is where the line comments will be built from.

### Autonomy, the scheduler and restarts

- **Autonomous** agent: its stage starts when the run reaches it and its result goes on without waiting. An agent that **waits**: its stage stays in `to-start` until the person starts it (`runs:startStage`), and its result stays in `to-accept` until the person accepts it (`runs:accept`) or sends it back with a note (`runs:return`). Changing the switch (`runs:setAutonomous`) applies from the next stage, never in the middle of one. Gates do not change.
- With `runner.enabled`, a job every 5 minutes lists the open issues assigned to the person that carry the `runner.triggerLabel` label and starts runs up to `runner.maxConcurrentRuns` runs **working** at the same time (a run parked at a gate does not count). An issue that ever had a run, in any state, is not started again by itself: otherwise a cancelled run would come back on every pass. An issue the app cannot start (no local checkout, no identity) is tried once per session.
- When the app opens, a run that was in the middle of an agent starts that stage over (a new attempt); those waiting for the person keep waiting. A stage past `runner.stageTimeoutMs` is stopped and the run is `failed`, with retry (`runs:retry`) or cancel (`runs:cancel`). Cancelling stops the agent and deletes nothing: the worktree, the branch and the thread stay until the person removes them.

### Questions and mentions

An agent's question pauses the stage, notifies through the app's notifications and is answered by `runs:answer` or by a person's message in the run's thread (the message becomes the answer, and the stage starts again with the question and the answer in the prompt). A message that names an agent (`@developer ...`) is not an answer: it calls that agent, which answers in the thread **reading only**, whatever its own permission (the call has no Edit, no Write and no commands). Only a person's message calls anyone.

### An agent that writes

An agent with the `worktree` permission runs with the run's worktree as its working directory, on both engines, with **one guard function** (`src/main/engine/guard.ts`) in front of every write: on the Claude Agent SDK it is a `PreToolUse` hook on `Edit`/`Write`; on the open engine it is the `Write` and `Edit` tools (which call the same function again, inside). The rules:

- Only paths inside the worktree. Refused: an absolute path outside it, `..` anywhere in the path, `~`, a symbolic link on the way that leads out (also for a folder, and a new file under it), a link that leads nowhere, the root itself.
- Nothing inside `.git` (any depth, any case, nor through a link to it), nor `.husky`, `.githooks`, `.gitattributes`, `.gitmodules`. Secret files (`secretPath`) neither.
- Reading (`Read`, `Grep`, `Glob`) only inside the worktree and outside `.git` and secrets.
- Shell only for the commands of `runner.commands`, **exactly as written** (the ceremonies' `shellAllowlist` machinery with a list of its own); without the list, only `Read`/`Grep`/`Glob`/`Edit`/`Write`. On the open engine the command runs without a shell and with an environment that has no credential-looking variables.
- No network (`WebFetch`, `WebSearch`), no `git push`, no MCP or code host tools.
- Every refusal goes to the run's thread as an app message (who, which tool, what, why) and shows as "blocked" in the live activity.

After a stage, the **app** commits in the worktree (`git add -A` and `git commit`) as the identity in `runner.identity` or, when empty, the one the repository already has (read, never written), with `-c core.hooksPath=/dev/null` (a hook the agent touched does not run), no signing and no file-system monitor, and the message from `runner.commitMessage` (default `feat: <summary> #<n>`). The message never carries a tool's attribution. The documents of stages that only read are committed by the app too. The review reads the diff with `--no-ext-diff --no-textconv`, without the cycle folder.

### Channels

| Channel | Does | Paired browser |
|---|---|---|
| `runs:list`, `runs:get(id)` | reads runs | yes |
| `runs:answer(id, text)` | answers the run's question (so does a message in the thread) | yes: the phone is where a person answers, and an answer only lets the stage that asked go on, under the same guard |
| `runs:start(ref, repo?)`, `runs:startStage`, `runs:accept`, `runs:return(id, note)`, `runs:gate(id, approve/reject/skip, reason)`, `runs:retry`, `runs:cancel`, `runs:setAutonomous(agent, on)` | starts work or changes a run, or what an agent does by itself | no: the window only (`test/runs-policy.test.ts` pins the list) |

### Not verified

- Nothing ran against a real model, a real code host or a real repository: the tests use a scripted engine, a host that can only be read and temporary git repositories. What a real model does with the prompts (and whether it picks the `commit`, the findings and the questions well) was not measured; the English prompts were written by translation.
- The guard was tested with path traversal, symbolic links, absolute paths and `.git/hooks` on both engines; **not** against a real hostile repository. A command on the list runs the repository's code (an `npm test` runs whatever `package.json` says) and can do anything the user can: the short list the person chooses is the defence. On the Claude Agent SDK the command inherits the SDK process's environment (which needs the provider's key); only on the open engine is the environment cleaned.
- `git add -A` takes into the commit whatever a listed command created that `.gitignore` does not cover.
- The runner writes nothing to an issue, a pull request or the code host, and does not push: that is the next change. The cost panel and the retention screen do not yet recognise the runner's sessions as the app's.
