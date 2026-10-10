# Memória compartilhada / Shared memory

[Português](#português) | [English](#english)

---

## Português

Cada agente, onde quer que rode, precisa saber o que já foi decidido e descoberto no app inteiro, sem carregar tudo na janela de contexto. A **memória compartilhada** é isso: os agentes guardam **notas** (decisões, descobertas, anotações) na pasta da conversa em que trabalham, e todo agente recebe, no prompt, uma **lista curta** de títulos e origens, abrindo só o trecho de que precisa. Não confundir com as outras memórias, que continuam como eram: a memória do ciclo (`MEMORY.md`, lida inteira pelas etapas da execução e enviada no pull request), o registro das atividades (o que o app sabe do andamento de cada atividade) e os [procedimentos](procedures.md) (como se faz uma coisa que se repete). A lista da memória **aponta** para as atividades e para os documentos dos ciclos; não os substitui.

As notas são **dados, nunca instruções**: uma nota não dá a um agente ferramenta, host, permissão nem caminho, e o que ela diz não muda o que o agente pode fazer.

### Onde fica

`<workspace>/memory/conversations/<conversa>/<agente>/m-<8 hex>.md`, ao lado de `activities.json` e de `procedures/`, na pasta de dados do workspace. `<conversa>` é o id da conversa como ele é (a thread de uma execução, uma conversa direta, um canal de squad, o geral, a conversa que uma etapa abriu com outro agente), e `<agente>` é o id do agente. A pasta do agente nasce na **primeira vez que ele é chamado** naquela conversa e é reaproveitada nas próximas; em outra conversa nasce outra. Fica fora de qualquer worktree, então **nunca vai num commit nem num pull request**; a varredura de retenção não passa por ela; não vai na exportação da configuração.

Cada agente escreve só na própria pasta e **nenhum arquivo é escrito por dois agentes**. A lista que um agente recebe não é um arquivo: o app a monta na hora da leitura, a partir das notas, do registro das atividades e dos documentos das pastas dos ciclos.

### A nota

Texto simples, com um cabeçalho curto para quem lê (a pessoa abre e edita o arquivo à vontade):

```
---
id: m-3fa91c02
kind: decision            (decision | finding | note)
title: Usar a fila nas tentativas de novo
by: developer
at: 2026-10-09T10:00:00.000Z
revision: 2
reviewed: true
activity: app#101         (opcional: a atividade de que trata)
repo: api                 (opcional: um repositório do workspace)
---
O texto, em prosa, com quebras de linha.
```

| Limite | Valor |
|---|---|
| Texto de uma nota | 8.000 caracteres |
| Título | 80 caracteres, numa linha |
| Notas por agente e por conversa | 50 |

O que passa de um limite é **recusado**, nunca cortado. O mesmo vale para o que o validador não aceita: uma nota inteira é recusada, e a recusa diz o campo e o motivo, sem repetir o valor. O validador recusa credencial, e-mail, caminho dentro da pasta pessoal, sequência de seis dígitos ou mais, caracteres invisíveis ou que invertem a direção, e um hash de commit **inteiro** (conta como credencial; a recusa pede o hash curto, de 7 a 12 caracteres). Um endereço com consulta (`?x=y`) também é recusado; um caminho e um endereço simples passam. Um texto que contém um valor exato de segredo do ambiente de teste da etapa também é recusado, não cortado.

**O cabeçalho não decide nada.** Quem escreveu, se a pessoa editou, se espera revisão e a revisão vivem num arquivo de estado (`_state.json`) que só o app escreve, em cada pasta de agente. Um arquivo que o app não escreveu (colocado à mão, ou deixado por uma queda entre as duas gravações) aparece para a pessoa com a marca "origem desconhecida" e **nenhum agente o recebe** até a pessoa marcá-lo como revisado; um arquivo cujo cabeçalho ou texto deixou de passar nas verificações aparece como "não aceito" e também fica fora das listas dos agentes. Um arquivo de mais de 40.000 bytes não é lido.

### Quem altera o quê

- Um agente **cria, troca e remove só as notas da própria pasta**. Trocar exige a `revision` que ele leu; uma nota de outro agente é recusada com o motivo ("é de fulano; só ele ou a pessoa muda").
- A pessoa **vê, edita e remove qualquer nota**, na tela Memória. Uma nota que a pessoa editou (no app ou direto no arquivo) passa a ser **dela**: o agente que a escreveu não a troca nem a remove, e a tentativa é recusada com o motivo ("editada pela pessoa"). A pessoa também a vê marcada, e o próximo agente que lê a memória enxerga a versão dela.
- Uma nota gravada numa chamada em que a pessoa usou a tela do agente (passagem de tela) **espera a revisão da pessoa**: nenhum outro agente a lê até ela marcar como revisada. O que a pessoa digitou na passagem de tela nunca entra numa nota.
- Uma nota sem alteração há 90 dias é mostrada como **antiga**; nunca é removida por idade. As pastas de um agente que saiu do time ficam (são o histórico do time) e a tela as marca; a pessoa remove quando quiser. Descartar o rascunho de um agente apaga a pasta da conversa dele junto com a thread.

### A lista e as ferramentas

A lista do prompt tem **uma linha por entrada**, só com título e origem, nunca o texto:

```
- sys:version Version: api latest v0.9.0, stable v0.8.0, manifest 0.9.0; release in progress 0.9.1
- sys:roadmap Roadmap: Plan (4 sections): Now; Next; Later
- m-3fa91c02 decision: Usar a fila nas tentativas de novo (developer, squad-core, 2026-10-09)
- act:app#101 Add the thing · Spec · developer
- doc:r-abc-1234/1_SPEC.md document: Spec (app, run-r-abc-1234, 2026-10-08)
```

Entram: as notas que algum agente pode ler, as atividades (uma linha compacta cada), os documentos das pastas dos ciclos das 30 execuções mais recentes (pelos títulos e cabeçalhos; `MEMORY.md` entra pelas seções), a versão e o roadmap. A ordem é uma só, sem modelo: a versão e o roadmap primeiro; depois por pontuação (+4 mesma conversa, +3 mesma atividade ou uma que a mensagem citou, +2 escrita pelo agente chamado, +1 mesmo repositório), depois por tipo (decisão, descoberta, nota, atividade em andamento, documento, outra atividade) e a mais nova primeiro.

Os tetos são fixos: **40 linhas e 3.000 caracteres** no prompt; **40 linhas e 6.000** em `memory_list`; um trecho aberto tem no máximo **4.000 caracteres**. Quando a lista não cabe, a última linha diz quantas entradas ficaram de fora e como pedir por nome.

As ferramentas são as mesmas nos dois motores (Claude Agent SDK, em `mcp__coxia_memory__memory_*`, e o motor aberto, com os nomes simples):

| Ferramenta | O que faz |
|---|---|
| `memory_list` | Lista entradas, com a mesma forma da lista do prompt e mais espaço. Aceita `query` (toda palavra tem de casar com título, tipo, origem ou cabeçalhos), `kind` e `conversation`. Nunca devolve o texto por trás de uma linha |
| `memory_read` | Abre uma entrada como **trecho**, com a origem (conversa, agente, dia), dentro de `<data>` e com a frase de que é material, não instrução. Um documento ou o roadmap abre como índice e começo; `section` escolhe uma seção; `from` continua um trecho longo |
| `memory_save` | Cria uma nota na pasta do próprio agente ou troca uma dele (`id` e `revision`). Responde com o id e a revisão, ou com a recusa |
| `memory_remove` | Remove uma nota do próprio agente |

Uma resposta que se apoia numa entrada diz de onde veio. Um **sub-agente** pode ler (`memory_list`, `memory_read`), só o agente principal escreve, e o sub-agente não recebe a lista: o principal põe na tarefa o trecho de que ele precisa. A última volta dos procedimentos não recebe ferramenta de memória. Se o SDK ou o zod não carregar, a lista continua no prompt e a conversa diz que as ferramentas não estão disponíveis.

### Onde cada agente a recebe

| Lugar | O que recebe |
|---|---|
| Etapa de uma execução | Lista e as quatro ferramentas; a pasta é `run-<id>/<agente>/`; os documentos da própria execução não voltam na lista (a etapa os lê inteiros) |
| Agente citado na thread de uma execução, numa conversa direta, num canal de squad ou no geral | Lista e as quatro ferramentas; a pasta é a da conversa, com o nome do agente |
| Agente chamado por outro, ou por uma etapa | O mesmo do lugar em que foi chamado |
| Pergunta entre agentes e pedido entre squads | Lista e as duas leituras; não escreve e não cria pasta |
| Cerimônias (os cinco agentes de sistema e os agentes citados numa cerimônia) | Lista e as duas leituras: **leem, nunca escrevem**, não criam pasta e não deixam aviso. O agente `teams`, que não tem ferramentas, recebe só a lista |

Nas cerimônias a versão vem do cache (o app a lê ao iniciar e depois a cada 10 minutos, em segundo plano), então a lista não acrescenta espera a um turno de voz; antes da primeira leitura a linha diz `Version: not read yet`.

A atividade e o roadmap: com a memória ligada, a seção das atividades de uma chamada traz **inteira** a atividade de que ela trata (e as que a mensagem citou) e o resto vira linhas da lista, só com a miniatura do agente citado. Com a memória desligada a seção é a de sempre.

### Versão e roadmap

- **Versão.** O app lê, nos repositórios do workspace que existem em disco, a maior tag `v<número>…` e a maior estável (uma pré-versão vale menos que a sua versão final), e a versão do manifesto (`package.json`, `pyproject.toml`, `Cargo.toml`), mais a versão de uma execução de release aberta. Nunca pede ao agente que rode git e nunca faz fetch. Sem nenhuma fonte, a linha diz `Version: unknown`.
- **Roadmap.** Um arquivo Markdown que a pessoa aponta em Configurações › Documentação (`docs.roadmapFile`; `~/` vale). As seções são os cabeçalhos; `memory_read` abre uma por nome. Até 200 KB, arquivo comum (não link), fora do filtro de caminhos secretos. Sem ele, a linha diz `Roadmap: none`.

Um agente cuja fonte está vazia **diz que não tem**; não adivinha.

### Um aviso à execução

Quando um agente guarda uma nota **em outra conversa** (ou uma etapa de **outra execução** produz um documento), as execuções que não terminaram e que o assunto toca recebem **um aviso**, sem chamar modelo. Toca quando:

1. a nota trata da atividade da execução; ou
2. é uma **decisão** sobre o repositório da execução; ou
3. foi escrita pelo agente que trabalha a execução agora.

O que vem das conversas da própria execução (`run-<id>` e as que as suas etapas abriram) nunca avisa a própria execução. Um documento avisa pelas regras 1 e 3. Uma edição da pessoa não avisa. Uma execução que falhou (pode ser refeita) também é avisada; uma terminada não.

O aviso é **uma linha na conversa da execução**, o que a pessoa vê, com ponteiros (id, título, quem escreveu e onde, e por que toca a execução) e nenhum texto. Entradas que chegam juntas (2 segundos) viram um aviso só, com **no máximo cinco ponteiros** e "mais N". Uma entrada não é avisada duas vezes, nem se for trocada, nem depois de um reinício. O agente abre o trecho com `memory_read` e pode mudar de rumo.

- Uma **etapa que está trabalhando** recebe o texto entre dois passos, como uma mensagem para ela.
- Uma execução **entre etapas** (num gate, por exemplo) ou uma etapa que já está terminando só ganha a linha; a **próxima etapa a começar** a lê como a primeira seção do prompt (logo depois do bloco que diz por que a tentativa roda, quando há um), com no máximo cinco avisos por etapa.
- Um aviso é marcado como lido quando a tentativa que o recebeu é **aceita**, ou na entrega, se foi entregue a uma etapa em andamento; uma tentativa que falha e é refeita o vê de novo.
- A linha de aviso nunca entra no prompt como texto da conversa; a etapa a recebe pelos caminhos acima.

Nada disso muda o arquivo da execução.

### A tela Memória

Mais › Memória (e um botão no cabeçalho, no computador). Lista as notas agrupadas por conversa e por agente, com busca e filtros (conversa, agente, tipo, "espera minha revisão", "de agente que saiu"), e as marcas: editada por você, espera sua revisão, origem desconhecida, não aceita, antiga, agente saiu. Abrir uma nota mostra quem escreveu e quando; dá para **editar** (o texto é mascarado, e a nota passa a ser da pessoa), **marcar como revisada** e **remover**; também se remove a pasta de um agente ou a memória inteira de uma conversa. A tela funciona com a chave ligada ou desligada.

O **navegador pareado tem as mesmas capacidades do computador** sobre a memória: lista, lê, edita, revisa, remove e liga e desliga a chave. Os seis canais `memory:*` estão abertos de propósito na política, e qualquer outro canal com esse prefixo é negado até alguém classificá-lo. A auditoria guarda cada edição e remoção da pessoa, e cada gravação de um agente, com a origem (`window` ou `paired`, ou a superfície em que o agente rodou), o título e o tipo, nunca o texto.

### A chave

`runner.sharedMemory` (Configurações › Runner). **Desligada**: nenhuma ferramenta, nenhuma seção em prompt, nenhuma pasta criada, nenhum aviso e nenhuma escrita de agente; a tela ainda lista, edita e remove o que existe. Um workspace que já existia fica **desligado** depois da atualização (o passo 26 → 27 da configuração escreve `false`); um novo nasce **ligado**. O computador e o navegador pareado mudam a chave. Desligada, os prompts são exatamente os de antes.

### O que protege o resto

- O texto de uma nota chega a todo prompt, então é mascarado de credenciais ao gravar e de novo ao mostrar; é mostrado como material, dentro de `<data>`, com a frase de que não é instrução; a lista mostra só títulos e origens.
- As ferramentas de arquivo dos agentes **não escrevem** na pasta `memory/` do app, nem numa execução com a cerca levantada (`runner.unconfined`); isso vale também para `activities.json` e `procedures/`. A leitura não mudou.
- Um id de conversa ou de agente com `secret`, `credential` ou `token` no nome faz o filtro de caminhos secretos recusar a leitura **direta** dos arquivos dessa pasta; as ferramentas da memória continuam funcionando, que é o caminho com origem e cerca.
- Um agente num lugar sem cerca de caminho ainda pode ler os arquivos direto; o caminho que traz a origem e a cerca é a ferramenta, e é o que o prompt manda usar.

### O que fica no disco, e o que não

- Cada nota é um arquivo, gravado de forma atômica; `_state.json` guarda o que o app decide. Um arquivo de estado de uma versão mais nova não é lido nem sobrescrito. Não há retenção, e a lista de entradas não é guardada em lugar nenhum.
- O log do processo principal diz, a cada chamada, `[memory] <lugar> <agente> entries=<n> chars=<m> omitted=<k>`, e uma linha por trecho aberto, para se poder ver o tamanho do que a memória carregou.
- Duas instâncias do app na mesma pasta de dados não são protegidas (como acontece com as atividades e os procedimentos).

### O que não foi verificado

Tudo isto foi conferido com motores e hosts de teste, nunca com um modelo real: se os dois motores entregam o aviso no último passo de uma etapa, se o sub-agente interno do SDK alcança as ferramentas (e se o gancho que recusa a escrita dele dispara), e se o modelo realmente muda de rumo ao abrir o trecho. O custo em tokens da lista e da leitura, a tela Memória num app aberto e o roadmap e a versão num repositório de verdade se conferem à mão, numa pasta de dados descartável.

---

## English

Every agent, wherever it runs, needs to know what was already decided and found across the whole app, without loading everything into its context window. The **shared memory** is that: agents keep **notes** (decisions, findings, notes) in the folder of the conversation they work in, and every agent receives in its prompt a **short list** of titles and origins, opening only the excerpt it needs. Do not confuse it with the other memories, which stay as they were: the cycle memory (`MEMORY.md`, read whole by a run's stages and sent in the pull request), the record of the activities (what the app knows of how each activity stands) and the [procedures](procedures.md) (how to do a recurring thing). The memory's list **points at** the activities and the documents of the cycles; it replaces none of them.

Notes are **data, never instructions**: a note gives an agent no tool, host, permission or path, and what it says changes nothing about what the agent may do.

### Where it lives

`<workspace>/memory/conversations/<conversation>/<agent>/m-<8 hex>.md`, beside `activities.json` and `procedures/`, in the workspace's data folder. `<conversation>` is the conversation id as it is (a run's thread, a direct conversation, a squad channel, the general one, the conversation a stage opened with another agent) and `<agent>` is the agent id. The agent's folder is made the **first time that agent is called** in that conversation and reused afterwards; in another conversation another one is made. It is outside every worktree, so it **never rides a commit or a pull request**; the retention sweep does not go through it; it is not in the configuration export.

Each agent writes only in its own folder and **no file is written by two agents**. The list an agent receives is not a file: the app puts it together at the moment of reading, from the notes, the activities record and the documents of the cycle folders.

### The note

Plain text with a short header for the reader (the person opens and edits the file freely):

```
---
id: m-3fa91c02
kind: decision            (decision | finding | note)
title: Use the queue for retries
by: developer
at: 2026-10-09T10:00:00.000Z
revision: 2
reviewed: true
activity: app#101         (optional: the activity it concerns)
repo: api                 (optional: a repository of the workspace)
---
The text, in prose, line breaks allowed.
```

| Limit | Value |
|---|---|
| A note's text | 8,000 characters |
| Title | 80 characters, one line |
| Notes per agent and conversation | 50 |

What goes over a limit is **refused**, never cut. So is what the validator does not accept: a whole note is refused, and the refusal names the field and the reason, without repeating the value. The validator refuses a credential, an e-mail, a path in a person's home folder, a run of six digits or more, invisible or direction-changing characters, and a **full** commit hash (it counts as a credential; the refusal asks for the short form, 7 to 12 characters). A URL with a query string is refused too; a path and a plain URL pass. A text that holds an exact secret value of the stage's test environment is refused too, not cut.

**The header decides nothing.** Who wrote it, whether the person edited it, whether it waits for review and the revision live in a state file (`_state.json`) in each agent's folder that only the app writes. A file the app did not write (placed by hand, or left by a crash between the two writes) shows to the person with an "unknown origin" badge and **no agent receives it** until the person marks it reviewed; a file whose header or text no longer passes the checks shows as "not accepted" and is also left out of agents' lists. A file over 40,000 bytes is not read.

### Who changes what

- An agent **creates, replaces and removes only the notes in its own folder**. A replace needs the `revision` it read; a note of another agent is refused with the reason ("it is X's; only that agent or the person changes it").
- The person **views, edits and removes any note**, in the Memory view. A note the person edited (in the app, or in the file itself) becomes **theirs**: the agent that wrote it cannot replace or remove it, and the attempt is refused with the reason ("edited by the person"). The next agent that reads the memory sees their version.
- A note saved in a call in which the person used the agent's screen (a hand-off) **waits for the person's review**: no other agent reads it until they mark it reviewed. What the person typed during a hand-off never enters a note.
- A note without a change for 90 days is shown as **old**; it is never removed by age. The folders of an agent that left the team stay (they are the team's history) and the view marks them; the person removes them when they want. Discarding an agent's draft removes the folder of its conversation with the thread.

### The list and the tools

The prompt's list has **one line per entry**, with a title and an origin only, never the text:

```
- sys:version Version: api latest v0.9.0, stable v0.8.0, manifest 0.9.0; release in progress 0.9.1
- sys:roadmap Roadmap: Plan (4 sections): Now; Next; Later
- m-3fa91c02 decision: Use the queue for retries (developer, squad-core, 2026-10-09)
- act:app#101 Add the thing · Spec · developer
- doc:r-abc-1234/1_SPEC.md document: Spec (app, run-r-abc-1234, 2026-10-08)
```

In it: the notes any agent may read, the activities (a compact line each), the documents of the cycle folders of the 30 newest runs (by title and headings; `MEMORY.md` by its sections), the version and the roadmap. The order is one fixed key, with no model: the version and the roadmap first; then by score (+4 same conversation, +3 same activity or one the message named, +2 written by the called agent, +1 same repository), then by kind (decision, finding, note, activity in progress, document, other activity), newest first.

The caps are fixed: **40 lines and 3,000 characters** in the prompt; **40 lines and 6,000** in `memory_list`; an opened excerpt is at most **4,000 characters**. When the list does not fit, its last line says how many entries were left out and how to ask for them by name.

The tools are the same in both engines (the Claude Agent SDK, as `mcp__coxia_memory__memory_*`, and the open engine, with the plain names):

| Tool | What it does |
|---|---|
| `memory_list` | Lists entries, in the shape of the prompt's list and with more room. Takes `query` (every word must match a title, kind, origin or heading), `kind` and `conversation`. Never returns the text behind a line |
| `memory_read` | Opens one entry as an **excerpt**, with its origin (conversation, agent, day), inside `<data>` and with the sentence that it is material, not an instruction. A document or the roadmap opens as its outline and opening; `section` picks a section; `from` continues a long excerpt |
| `memory_save` | Creates a note in the agent's own folder or replaces one of its own (`id` and `revision`). Answers with the id and revision, or the refusal |
| `memory_remove` | Removes one of the agent's own notes |

An answer that rests on an entry says where it came from. A **sub-agent** may read (`memory_list`, `memory_read`); only the principal agent writes, and a sub-agent does not receive the list: the principal puts the excerpt it needs in the task. The procedures' last turn gets no memory tool. If the SDK or zod does not load, the list stays in the prompt and the conversation says the tools are not available.

### Where each agent gets it

| Place | What it gets |
|---|---|
| A run's stage | The list and the four tools; the folder is `run-<id>/<agent>/`; the run's own documents are not listed back (the stage reads them whole) |
| An agent named in a run's thread, in a direct conversation, a squad channel or the general conversation | The list and the four tools; the folder is the conversation's, under the agent's name |
| An agent called by another, or by a stage | The same as the place it was called in |
| A question between agents, a squad request | The list and the two reads; it does not write and makes no folder |
| Ceremonies (the five system agents and the agents named inside a ceremony) | The list and the two reads: they **read, never write**, make no folder and leave no notice. The `teams` agent, which has no tools, gets the list alone |

In ceremonies the version comes from the cache (the app reads it at start and then every 10 minutes, in the background), so the list adds no wait to a voice turn; before the first read the line says `Version: not read yet`.

The activities section: with the memory on, a call's activities section holds the activity the call is about (and the ones the message named) **whole**, and the rest are lines of the list, with only the named agent's thumbnail. With the memory off the section is what it always was.

### Version and roadmap

- **Version.** The app reads, in the workspace's repositories that exist on disk, the newest `v<number>…` tag and the newest stable one (a pre-release ranks below its release) and the manifest's version (`package.json`, `pyproject.toml`, `Cargo.toml`), plus the version of an open release run. It never asks an agent to run git and never fetches. With no source the line says `Version: unknown`.
- **Roadmap.** A Markdown file the person points at in Settings › Documentation (`docs.roadmapFile`; `~/` expands). Its headings are the sections; `memory_read` opens one by name. Up to 200 KB, a regular file (not a link), not held back by the secret-path filter. Without it the line says `Roadmap: none`.

An agent whose source is empty **says it has none**; it does not guess.

### A notice to a run

When an agent keeps a note **in another conversation** (or a stage of **another run** produces a document), the runs that have not finished and that it concerns get **one notice**, with no model call. It concerns a run when:

1. the note is about the run's activity; or
2. it is a **decision** about the run's repository; or
3. it was written by the agent that works the run now.

What comes from the run's own conversations (`run-<id>` and the ones its stages opened) never notifies the run itself. A document notifies by rules 1 and 3. A person's edit notifies nobody. A failed run (it can be retried) is told too; a finished one is not.

The notice is **a line in the run's conversation**, which the person sees, with pointers (id, title, who wrote it and where, and why it concerns the run) and no text. Entries that arrive close together (2 seconds) become one notice, with **five pointers at most** and "and N more". An entry is not told twice, not when it is replaced and not after a restart. The agent opens the excerpt with `memory_read` and may change course.

- A **stage that is working** receives the text between two steps, like a message addressed to it.
- A run **between stages** (at a gate, for example) or a stage that is already finishing only gets the line; the **next stage to start** reads it as the first section of its prompt (right after the block that says why the attempt runs, when there is one), at most five notices per stage.
- A notice is marked read when the attempt that received it is **accepted**, or at the handover when it was handed to a stage in progress; an attempt that fails and is retried sees it again.
- The notice line never enters a prompt as thread text; the stage receives it by the ways above.

None of this changes the run's file.

### The Memory view

More › Memory (and a button in the header, on the computer). It lists the notes grouped by conversation and by agent, with search and filters (conversation, agent, kind, "waits for my review", "of an agent that left") and the badges: edited by you, waits for your review, unknown origin, not accepted, old, agent left. Opening a note shows who wrote it and when; you can **edit** it (the text is masked, and the note becomes the person's), **mark it reviewed** and **remove** it; you can also remove an agent's folder or a conversation's whole memory. The view works with the switch on or off.

A **paired browser has the same capabilities as the computer** over the memory: it lists, reads, edits, reviews, removes and turns the switch on and off. The six `memory:*` channels are open on purpose in the policy, and any other channel with that prefix is denied until somebody classifies it. The audit records each edit and removal by the person and each write by an agent, with the origin (`window` or `paired`, or the surface the agent ran in), the title and the kind, never the text.

### The switch

`runner.sharedMemory` (Settings › Runner). **Off**: no tool, no prompt section, no folder made, no notice and no write by any agent; the view still lists, edits and removes what exists. A workspace that existed before is **off** after the update (configuration step 26 → 27 writes `false`); a new one is **on**. The computer and a paired browser both change the switch. Off, the prompts are exactly what they were.

### What protects the rest

- A note's text reaches every prompt, so it is masked of credentials when written and again when shown; it is shown as material, inside `<data>`, with the sentence that it is not an instruction; the list shows titles and origins only.
- The agents' file tools **cannot write** the app's `memory/` folder, not even in a run whose fence is lifted (`runner.unconfined`); this holds for `activities.json` and `procedures/` too. Reading is unchanged.
- A conversation or agent id with `secret`, `credential` or `token` in its name makes the secret-path filter refuse the **direct** reading of the files in that folder; the memory tools keep working, which is the path with origin and fence.
- An agent in a place without a path fence can still read the files directly; the path that carries the origin and the fence is the tool, and it is what the prompt tells it to use.

### What is kept on disk, and what is not

- Each note is a file, written atomically; `_state.json` holds what the app decides. A state file of a newer version is not read or overwritten. There is no retention, and the list of entries is kept nowhere.
- The main process's log says, for every call, `[memory] <place> <agent> entries=<n> chars=<m> omitted=<k>`, and a line for each excerpt opened, so the size of what the memory carried can be read back.
- Two app instances on the same data folder are not guarded (as for the activities and the procedures).

### What was not verified

All of this was checked with test engines and hosts, never with a real model: whether both engines hand the notice over in the last step of a stage, whether the SDK's built-in sub-agent reaches the tools (and whether the hook that refuses its writes fires), and whether the model really changes course when it opens the excerpt. The token cost of the list and of reading, the Memory view in an open app, and the roadmap and the version in a real repository are checked by hand, on a throwaway data folder.
