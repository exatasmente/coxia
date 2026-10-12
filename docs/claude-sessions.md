# Sessões do Claude Code / Claude Code sessions

[Português](#português) | [English](#english)

---

## Português

Um recurso opcional, **desligado por padrão e só na janela do desktop**, que lista e conduz as sessões do Claude Code da máquina. Liga-se em Configurações › Configurações e workspaces › Sessões do Claude Code (`claudeSessions.enabled`, esquema 35; ver [`configuration.md`](configuration.md)). Desligado, não há linha no menu nem tela, e todo canal do recurso, menos o próprio interruptor, recusa.

### De onde vem a lista

- **Transcrições**: o `listSessions` do Claude Agent SDK (título, primeiro pedido, pasta, branch, última alteração). A conversa aberta vem do `getSessionMessages` e é relida a cada 2 s enquanto a tela está aberta.
- **Em execução e em segundo plano**: cada processo do Claude Code grava `~/.claude/sessions/<pid>.json`. O app lê só esses arquivos, só os campos `pid`, `sessionId`, `cwd`, `kind` (`interactive` ou `background`), `status` e `updatedAt`, e confere se o processo vive. Um único ponto do código lê o disco (`guardedRead`), e ele recusa qualquer outro nome.
- O app **nunca** abre `~/.claude/.credentials.json`, `~/.claude/sessions/*.key` nem `~/.claude/daemon/control.key`, nunca oferece login e nunca lê, guarda ou repassa token: usa o `claude` que a pessoa instalou e no qual já entrou. Sem o SDK, a tela diz o motivo.
- Todo texto que sai do processo principal (transcrição, atividade, entrada de um pedido de permissão) passa pela mesma ocultação de segredos das linhas de atividade.

### O que a pessoa faz

- **Enviar mensagem**: retoma a sessão. Se outro processo a mantém aberta, o envio parte de uma **cópia** (bifurcação) e a tela avisa. A resposta corre ao vivo na mesma visão de atividade das execuções. O processo iniciado pelo app fica vivo entre mensagens.
- **Pedidos de permissão**: quando uma sessão conduzida pelo app pede uma ferramenta, o pedido aparece como item pendente com Permitir e Negar, e a sessão espera, sem prazo. Negar faz a sessão seguir sem a ferramenta; parar a vez nega. Só a janela responde: o celular pareado e a persona são recusados.
- **Parar** interrompe a vez que o app está rodando. **Encerrar** só existe para um processo que o app iniciou; uma sessão de outro processo não oferece encerrar.
- **Iniciar** uma sessão nova numa pasta de projeto (`projects.repos`) do workspace.
- Num workspace com `test: true`, enviar e iniciar são recusados antes de tocar o SDK; listar e ler continuam.

### Auditoria

Cada mensagem enviada, resposta de permissão, parada (e encerramento) e início grava uma linha do tipo `claude-session`, com `target` `claude:<id da sessão>`, a porta e a ação. O texto da mensagem nunca vai para a linha, só o tamanho.

### A fronteira

- Todo canal `claudeSessions:` é negado ao celular pareado por um padrão em `webPolicy.ts`, com ou sem o interruptor de efeitos externos, inclusive canais futuros com o mesmo prefixo.
- Os eventos vão só à janela (`emitWindow`), nunca por `broadcast`.
- Cada canal está em `EXCLUDED` da tabela da porta da persona (motivo `machine`), e a persona não muda o interruptor pelo `Settings.set`.
- Além disso, cada canal recusa qualquer porta que não seja a janela.

### O que não foi verificado

- O recurso contra o Claude Code real (listar, enviar, cópia, permissão, parar) não foi exercitado; os testes usam um SDK e uma máquina falsos.
- Um pedido de permissão só aparece para uma sessão que o app conduz; uma sessão aberta num terminal pergunta no próprio terminal.
- "Logado ou não" só aparece quando o SDK recusa; o app não confere a credencial.

---

## English

An opt-in feature, **off by default and desktop window only**, that lists and drives the machine's Claude Code sessions. It is turned on in Settings › Configuration and workspaces › Claude Code sessions (`claudeSessions.enabled`, schema 35; see [`configuration.md`](configuration.md)). Off, there is no menu row and no screen, and every channel of the feature but the switch refuses.

### Where the list comes from

- **Transcripts**: the Claude Agent SDK's `listSessions` (title, first prompt, folder, branch, last change). The open conversation comes from `getSessionMessages` and is read again every 2 s while the screen is open.
- **Running and background**: each Claude Code process writes `~/.claude/sessions/<pid>.json`. The app reads only those files, only the fields `pid`, `sessionId`, `cwd`, `kind` (`interactive` or `background`), `status` and `updatedAt`, and checks that the process is alive. One place in the code reads the disk (`guardedRead`), and it refuses any other name.
- The app **never** opens `~/.claude/.credentials.json`, `~/.claude/sessions/*.key` or `~/.claude/daemon/control.key`, never offers a login and never reads, stores or forwards a token: it uses the `claude` the person installed and signed in to. Without the SDK, the screen says why.
- Every text that leaves the main process (transcript, activity, the input of a permission request) goes through the same secret masking as the activity lines.

### What the person does

- **Send a message**: resumes the session. When another process holds it open, the message goes to a **copy** (a fork) and the screen says so. The answer streams in the same activity view the runs use. A process the app started stays alive between messages.
- **Permission requests**: when a session the app drives asks for a tool, the request shows as a pending item with Allow and Deny, and the session waits, with no time limit. Denying lets the session go on without the tool; stopping the turn denies. Only the window answers: a paired phone and the persona are refused.
- **Stop** interrupts the turn the app is running. **End** exists only for a process the app started; a session of another process offers no end.
- **Start** a new session in a project folder (`projects.repos`) of the workspace.
- In a `test: true` workspace, sending and starting are refused before the SDK is touched; listing and reading still work.

### Audit

Every message sent, permission answer, stop (and end) and start writes one line of kind `claude-session`, with `target` `claude:<session id>`, the door and the action. The text of a message never goes into the line, only its length.

### The boundary

- Every `claudeSessions:` channel is denied to a paired phone by a pattern in `webPolicy.ts`, with or without the external-effects switch, future channels under the prefix included.
- Its events go to the window only (`emitWindow`), never through `broadcast`.
- Each channel is in `EXCLUDED` of the persona's door table (reason `machine`), and the persona cannot change the switch through `Settings.set`.
- On top of that, each channel refuses any door but the window.

### What was not verified

- The feature against the real Claude Code (listing, sending, the copy, permission, stop) was not exercised; the tests use a fake SDK and a fake machine.
- A permission request shows only for a session the app drives; a session open in a terminal asks in that terminal.
- "Signed in or not" shows only when the SDK refuses; the app does not check the credential.
