# Persona e chat / Persona and chat

[Português](#português) | [English](#english)

---

## Português

A **persona** é o representante da pessoa dentro do app: um agente que sabe quem ela é, como decide, o que importa para ela e o que ela nunca quer que se faça, e com quem ela conversa num **chat** que é a primeira tela do app. Há uma persona por workspace. Nesta versão ela **só conversa**: lê (o que um agente de leitura lê), responde e oferece **botões** que abrem uma cerimônia ou uma tela. Ela não aprova nada, não muda configuração, não escreve em repositório nem em tracker. Ferramentas de ação, voz no chat, agendas e plugins vêm depois.

### Como se faz

Na primeira abertura de um workspace sem persona o app mostra o **assistente da persona**, em tela cheia, depois da configuração inicial; o mesmo assistente abre em Configurações › Persona (**Fazer com IA**, **Ajustar com IA**). Ele usa a mesma mecânica do assistente de agentes, com perguntas próprias:

1. **O pedido:** quem é você e o que faz, com as suas palavras.
2. **Perguntas:** no máximo **quatro rodadas** de três a seis perguntas (aberta, de escolha única ou de múltipla escolha; toda escolha tem **Outra**). As rodadas cobrem quatro temas: quem a pessoa é, como decide, o que importa para ela e o que ela nunca quer que se faça. Dá para pular uma pergunta, e o modelo pode dizer que não tem mais o que perguntar.
3. **Revisão:** três textos que a pessoa edita: o nome (até 80 caracteres), uma frase que diz o que a persona é (até 1.000) e as instruções (até 4.000), escritas em inglês, para a própria persona, com um título por tema (`## Who the person is`, `## How they decide`, `## What matters to them`, `## What they never want done`). **O modelo não propõe configuração nenhuma**: nem permissão, nem ferramenta, nem etapa, nem comando. A revisão diz, numa linha fixa, o que a persona pode fazer agora (ler, conversar, abrir telas).
4. **Teste:** a persona é salva como rascunho (`draft: true`), sem nenhuma ferramenta, e a pessoa conversa com ela no mesmo chat que vai usar. Uma observação sobre o teste volta para a próxima rodada.
5. **Salvar e abrir o chat:** tira a marca de rascunho, esvazia a conversa de teste e abre o chat. Nada vira a persona antes deste botão; fechar o assistente descarta o rascunho e a conversa de teste (pergunta antes, se houver progresso). Um rascunho que ficou de um app fechado aparece em Configurações › Persona com **Descartar**.

O modelo é o do papel `deep`, chamado sem ferramenta, como o assistente de agentes faz. Ao **ajustar** uma persona que já existe, o app testa uma **cópia**; o original só muda quando a pessoa salva.

**O acesso com que a persona nasce** é o de um agente de leitura, definido pelo app e nunca pelo modelo nem pela tela: `permission: read`, `tracker: read`, `shell: none`, sem tela, sem hosts, sem perfil de navegador, com as ferramentas do workspace, sem etapa, sem squad, `turnsTo: null`, `autonomous: false`. Ela tem os procedimentos aprendidos e a memória compartilhada, sob as chaves que já os governam.

### Configurações › Persona

Nome, a frase, as instruções e o modelo (como o editor de agentes), **Salvar**, **Ajustar com IA**, **Limpar a conversa**, **Excluir** e **Abrir o chat**. Limpar e excluir **perguntam antes**, dizem o que vai embora (a conversa, os arquivos dela e a pasta de memória da conversa; ao excluir, a persona também) e são recusados enquanto uma resposta está em andamento. A persona **não aparece** na lista do time nem em **Criar com IA**. Excluir leva o início do app de volta ao assistente.

### O chat

- **A tela inicial** (no computador e no celular pareado) é a conversa com a persona: o cabeçalho (nome, data, o selo do workspace de teste, o aviso de atualização, o alternador de voz, o sino dos jobs), a conversa, a **faixa da cerimônia** quando há o que dizer, e a caixa. No computador a **barra lateral** fica ao lado; no celular o cabeçalho tem o botão do menu.
- **Uma conversa contínua**, sem "novo chat" e sem lista. A persona recebe as **últimas 40 mensagens**, a memória compartilhada e os procedimentos; o que precisa lembrar além disso, ela guarda na própria memória. A conversa é o fio direto `agent-<id>` do fórum, escondido da lista do Fórum.
- **A caixa:** no computador Enter envia e Shift+Enter quebra a linha; no celular Enter quebra a linha e um botão envia. Arquivos entram por botão, soltar ou colar, com os mesmos limites das conversas; até 20.000 caracteres por mensagem. `@nome` fica como texto: outros agentes não são chamados deste chat. Uma mensagem escrita enquanto uma resposta anda **espera a vez** e diz que espera.
- **A resposta aparece enquanto é escrita**, nos dois motores e também no celular; um aparelho que entra no meio mostra o que já foi escrito e segue dali. O balão marca que ainda está sendo escrito e traz **Parar**. A resposta é **texto simples** (Markdown) e **não traz propostas de escrita**. O que aparece é o que será gravado: o mesmo mascaramento de segredos, sobre o texto inteiro até ali, segurando a última palavra incompleta. Quando a resposta termina, é gravada **uma vez, inteira**, e substitui o balão. Se o app cair no meio, não há mensagem, e a falha é dita.
- **Parar** grava o que já foi escrito, marcado como parcial, e uma linha diz que foi parado. **Uma falha** grava só a linha da falha, não o texto parcial.
- **Trabalho:** acima de cada resposta, uma seção **Trabalho** com a árvore de atividade da chamada (sub-agentes, agentes que ela chamou, o raciocínio em linhas fechadas, quando a chave de raciocínio está ligada). Fica aberta enquanto a persona trabalha e fechada quando a resposta termina, com a duração e o número de passos. A atividade vive só na memória: depois de reiniciar, as respostas antigas não têm a seção.
- **Botões:** pedir "comece a pré-daily" ou "mostre o quadro" dá uma resposta com um **botão** que abre a tela. É a única ferramenta nova da persona: ela só oferece, nunca navega. O botão é um destino do vocabulário das notificações (`to` e, se for o caso, `ref`, `id`, `mr`), validado de novo pelo app; o texto do botão é do app, nunca do modelo; no máximo quatro por resposta. Um destino que o ciclo não tem (uma cerimônia desligada) ou um cartão que não está carregado é recusado ao modelo, com o motivo, e não vira botão. O botão é gravado com a mensagem, aparece em todos os aparelhos e depois de reiniciar, e **abre a tela só no aparelho em que foi tocado**.

### Início, navegação e Visão geral

- **Com persona:** o app abre no chat. **Sem persona:** abre no assistente; **Agora não** mostra a Visão geral só nesta sessão (nada é guardado; o próximo início oferece o assistente de novo, e a Visão geral de um workspace sem persona mantém a navegação e um botão **Criar a sua persona**). Vale para workspace novo e para um que já existia.
- **A navegação** é a mesma lista em grupos no computador e no celular: Conversa e Visão geral; **Atenção** (bloqueios, perguntas, ações aguardando e o que precisa de você); **Cerimônias** (a pré-daily com o nome que o ciclo dá, desbloqueio, Passagem ao QA, retro, sem as que o ciclo desligou); **Ciclo** (execuções, quadro, fórum, procedimentos, memória, histórico); **App** (radar, saúde, custo, auditoria, configurações, ajuda). No computador é uma barra lateral fixa ao lado do chat e da Visão geral, que recolhe para só ícones (a escolha fica guardada neste computador); no celular é a folha do botão de menu do cabeçalho, que ganha um ponto quando algo está contado.
- **As contagens** ficam ao lado de cada linha da navegação, como um número pequeno; zero não aparece. Bloqueios, perguntas e o que precisa de você abrem a Visão geral na seção; Ações abre Ações. Execuções, fórum, radar e saúde trazem as suas. Não chamam modelo, e as quatro primeiras saem da mesma função que a Visão geral usa.
- **A faixa da cerimônia** fica acima da caixa quando a pré-daily está pronta, em andamento, encerrada (ata), ou a retro está no dia: uma linha com o nome, o andamento e os botões do cartão "Agora" da Visão geral. Ela usa a cor de destaque só enquanto a cerimônia espera para começar ou está em andamento; encerrada, fica discreta. No celular os botões descem para baixo do nome. Um ciclo sem pré-daily não tem a faixa.
- **Avisos do app em sequência** (uma tela virtual fechada, uma gravação não guardada) viram uma linha só, com quantos são e o último, que abre a lista ao toque; um aviso sozinho continua uma linha.
- **A caixa** é uma linha que cresce com o texto, com anexar e enviar como ícones na borda; Enter envia e Shift+Enter quebra a linha (no celular, Enter quebra a linha e o botão envia).
- **A Visão geral** é o que era o Hoje, sem mudança: o cartão Agora, os números, o que precisa de você, o tempo do dia, as atividades com filtros e atualização, as quatro cerimônias com o seletor de squad. O "voltar" dela e o de todas as telas leva ao início ("Voltar ao início").
- **A barra de baixo do celular** tem Chat (com o ponto vivo de uma pré-daily em andamento), Ações, Histórico e Mais; o chat não tem barra.
- **As cerimônias não mudam.** A pré-daily continua sendo conduzida na tela Call, e Deep, Gate, Passagem ao QA, Retro, Reentrada, Conflito e a ata são as mesmas telas sobre o mesmo estado, que é restaurado do disco e salvo antes de uma atualização. O "voltar" delas leva ao chat.

### Para onde levam as notificações

| Aviso | Abre |
|---|---|
| A pré-daily está na hora (e o push dela, de urgência alta) | `chat` (com a faixa da cerimônia); num workspace sem persona, a Visão geral, que tem o cartão |
| "Cerimônia agora" da bandeja | `call` (a tela da pré-daily) |
| Novos bloqueios, mudança de etapa, retorno de feedback, alertas dos observadores, o aviso de vários, o resumo dos avisos em rajada do celular, um job que terminou, uma pergunta de agente sem execução | `overview` |
| Um aviso feito por uma versão anterior, com `today` ou `call` | `today` abre a Visão geral; `call` abre a pré-daily (sem cartões carregados, o chat) |

### O celular pareado

Faz com a persona **tudo o que o computador faz**: conversa, cria, ajusta, testa, limpa e exclui. Os canais do assistente têm um prefixo próprio, `persona:` (os do assistente de agentes, `agentAssist:`, continuam negados ao navegador). Um canal novo sob `persona:` é negado até alguém classificá-lo. Cada alteração (salvar o rascunho do teste, concluir ou descartar o teste, salvar, limpar, excluir, concluir o assistente) vai para o registro de auditoria com a porta por onde veio (janela ou navegador pareado), e nunca com o texto. O acesso inicial da persona é montado no app, a partir dos textos; uma tela nunca o envia, então um navegador pareado não eleva nada por aqui.

### Configuração

`agents.team[]` aceita `kind: 'persona'` em **uma** entrada (`kind` ausente é um agente comum); o esquema é o **30**, com o passo `v29ToV30` que só muda a versão. Uma versão anterior recusa um arquivo salvo por esta. A validação recusa duas personas (uma real e uma cópia de rascunho no máximo), e uma persona com etapa, squad, `turnsTo`, `autonomous: true` ou `system: true`; todos os erros caem em `agents.team[i].kind`, e um arquivo editado à mão com isso carrega com a persona virando um agente comum e uma nota, sem perder o time. Os campos de permissão **não** são limitados: um arquivo que dê `shell: sandbox` ou `permission: worktree` à persona vale, como para qualquer agente.

**A persona não participa do ciclo.** Não executa etapa, não é oferecida como alguém a quem recorrer, não é chamada por outro agente, não está em squad, não está na lista de agentes que o assistente de agentes conhece e **fica fora de um modelo de ciclo** (compartilhado ou exportado). Um teste percorre quem lê o time com uma persona dentro e uma varredura dos fontes falha quando um leitor novo aparece sem classificação.

### Onde o texto pessoal fica

As instruções descrevem a pessoa. Elas ficam na configuração do workspace (que um navegador pareado lê, a mesma confiança dada ao chat no celular), vão no prompt de cada resposta ao provedor do modelo, e ficam nos arquivos de sessão do motor (a pasta de sessões abertas do app, e, no motor Claude, o histórico que o SDK grava na pasta do próprio Claude da pessoa). **Não vão** para a exportação da configuração (a importação também tira uma persona do arquivo, com aviso, e mantém a do workspace de destino), nem para um modelo de ciclo. O app não copia o texto para o índice de sessões, para o log de erros nem para os registros de uso. As transcrições da conversa da persona **não** são varridas pela retenção, como as de qualquer conversa.

### O que não foi verificado

- Nada disto foi usado por muito tempo. O assistente e o chat foram testados com modelos de mentira; a conversa com um modelo de verdade passou por uma verificação manual do caminho do motor Claude (texto em pedaços, turno com ferramenta, resultado de sucesso sem saída estruturada).
- **No motor Claude o texto pode chegar de uma vez**: depois de uma pausa para pensar, o SDK entrega o texto inteiro de uma só rajada. No motor aberto o texto cresce aos poucos. Os pedaços chegam em ordem e o texto gravado é igual ao último mostrado nos dois.
- A tela do chat, a navegação, a faixa da cerimônia e a Visão geral não são desenhados por nenhum teste (os testes cobrem as funções por trás). O layout foi visto num build com dados fictícios a 1600, 760 e 390 px, nos dois temas; não foi visto num celular de verdade, nem o botão dos jobs sobre a caixa.
- Mensagens anteriores à atualização não têm a seção Trabalho.

---

## English

The **persona** is the person's representative inside the app: an agent that knows who they are, how they decide, what matters to them and what they never want done, and that they talk to in a **chat** that is the app's first screen. There is one persona per workspace. In this version it **only chats**: it reads (what a reading agent reads), answers and offers **buttons** that open a ceremony or a screen. It approves nothing, changes no setting and writes to no repository or tracker. Tools that act, voice in the chat, schedules and plugins come later.

### How it is made

The first time a workspace with no persona is opened, the app shows the **persona wizard**, full screen, after the initial setup; the same wizard opens from Settings › Persona (**Make with AI**, **Adjust with AI**). It uses the agent assistant's machinery with questions of its own:

1. **The request:** who you are and what you do, in your words.
2. **Questions:** at most **four rounds** of three to six questions (open, single choice or multiple choice; every choice has **Other**). The rounds cover four themes: who the person is, how they decide, what matters to them and what they never want done. A question can be skipped, and the model may say it has nothing more to ask.
3. **Review:** three texts the person edits: the name (up to 80 characters), a sentence that says what the persona is (up to 1,000) and the instructions (up to 4,000), written in English, to the persona itself, with a heading per theme (`## Who the person is`, `## How they decide`, `## What matters to them`, `## What they never want done`). **The model proposes no setting at all**: no permission, tool, stage or command. The review says, in a line of fixed text, what the persona can do now (read, chat, open screens).
4. **Test:** the persona is saved as a draft (`draft: true`) with none of its tools, and the person talks to it in the same chat they will use. A remark about the test goes into the next round.
5. **Save and open the chat:** removes the draft mark, empties the test conversation and opens the chat. Nothing becomes the persona before this button; closing the wizard discards the draft and its test conversation (it asks first when there is progress). A draft left by a closed app shows in Settings › Persona with **Discard**.

The model is the `deep` role's, called with no tool, as the agent assistant does. When **adjusting** a persona that exists, the app tests a **copy**; the original only changes when the person saves.

**The access the persona starts with** is that of a reading agent, set by the app and never by the model or the screen: `permission: read`, `tracker: read`, `shell: none`, no screen, hosts or browser profile, the workspace's tools, no stage, no squad, `turnsTo: null`, `autonomous: false`. It has the learned procedures and the shared memory, under the switches that already govern them.

### Settings › Persona

Name, the sentence, instructions and model (as in the agent editor), **Save**, **Adjust with AI**, **Clear conversation**, **Delete** and **Open the chat**. Clear and Delete **ask first**, say what goes (the conversation, its files and the conversation's memory folder; for Delete, the persona too) and are refused while an answer is going. The persona is **not in** the Team list or in **Create with AI**. Deleting brings the app's start back to the wizard.

### The chat

- **The first screen** (on the computer and on a paired phone) is the conversation with the persona: the header (name, date, the test-workspace chip, the update badge, the voice toggle, the jobs bell), the conversation, the **ceremony bar** when there is something to say, and the box. On the computer the **sidebar** sits beside it; on a phone the header has the menu button.
- **One continuous conversation**, with no "new chat" and no list. The persona is told the **last 40 messages**, the shared memory and the procedures; what it must remember beyond that it keeps in its own memory. The conversation is the forum's direct thread `agent-<id>`, hidden from the Forum list.
- **The box:** on the computer Enter sends and Shift+Enter breaks the line; on the phone Enter breaks the line and a button sends. Files go in by button, drop or paste, with the limits of the conversations; up to 20,000 characters per message. `@name` stays plain text: other agents are not called from this chat. A message written while an answer is going **waits its turn** and says so.
- **The answer appears as it is written**, on both engines and on the phone too; a device that joins in the middle shows what has been written and goes on from there. The bubble marks that it is still being written and carries **Stop**. The answer is **plain text** (Markdown) and carries **no write proposals**. What shows is what will be stored: the same masking of secrets, over the whole text so far, holding back the last unfinished word. When the answer is complete it is stored **once, whole**, and replaces the bubble. If the app dies midway there is no message, and the failure is said.
- **Stop** stores what has been written, marked as partial, and a line says it was stopped. **A failure** stores only the failure line, not the partial text.
- **Work:** above each answer, a **Work** section with the activity tree of the call (sub-agents, the agents it called, its reasoning as closed lines when the reasoning switch is on). It is open while the persona works and closed when the answer is done, with the duration and the step count. The activity lives in memory only: after a restart the older answers have no section.
- **Buttons:** asking "start the pre-daily" or "show me the board" gives an answer with a **button** that opens the screen. It is the persona's one new tool: it only offers, it never navigates. A button is a target of the notification vocabulary (`to` and, where it applies, `ref`, `id`, `mr`), validated again by the app; the button's words are the app's, never the model's; at most four per answer. A target the cycle does not have (a ceremony turned off) or a card that is not loaded is refused to the model, with the reason, and makes no button. The button is stored with the message, shows on every device and after a restart, and **opens the screen only on the device that tapped it**.

### Home, navigation and Overview

- **With a persona:** the app opens on the chat. **With none:** it opens on the wizard; **Not now** shows the Overview for this session only (nothing is stored; the next start offers the wizard again, and the Overview of a workspace with no persona keeps the navigation and a **Make your persona** button). This holds for a new workspace and for one that existed.
- **The navigation** is the same grouped list on the computer and the phone: Chat and Overview; **Attention** (blocked, asking, waiting in Actions and what needs you); **Ceremonies** (the pre-daily under the name the cycle gives it, unblock, QA hand-off, retro, without the ones the cycle turned off); **Cycle** (runs, board, forum, procedures, memory, history); **App** (radar, health, cost, audit, settings, help). On the computer it is a sidebar that stays beside the chat and the Overview and collapses to icons (the choice is kept on that computer); on a phone it is the sheet of the header's menu button, which carries a dot while something is counted.
- **The counts** sit beside each row of the navigation as a small number; a zero is not shown. Blocked, asking and what needs you open the Overview at that section; Actions opens Actions. Runs, forum, radar and health carry their own. They call no model, and the first four come from the same function the Overview uses.
- **The ceremony bar** sits above the box when the pre-daily is ready, in progress, ended (minutes), or the retro is due: one line with the name, where it stands and the buttons of the Overview's "Now" card. It takes the accent color only while the ceremony waits to start or is being held; once ended it is quiet. On a phone the buttons go under the name. A cycle with no pre-daily has no bar.
- **App notices in a row** (a virtual screen closed, a recording not kept) become one line with how many there are and the last one, which opens the list when tapped; a single notice stays a line.
- **The box** is one line that grows with the text, with attach and send as icons on its edge; Enter sends and Shift+Enter breaks the line (on a phone, Enter breaks the line and the button sends).
- **The Overview** is what Today was, unchanged: the Now card, the numbers, what needs you, the day's time, the activities with filters and refresh, the four ceremonies with the squad picker. Its "back", and every screen's, goes home ("Back to Home").
- **The phone's bottom bar** has Chat (with the live dot of a pre-daily in progress), Actions, History and More; the chat itself has no bar.
- **The ceremonies do not change.** The pre-daily is still held on the Call screen, and Deep, Gate, QA hand-off, Retro, Re-entry, Conflict and the minutes are the same screens over the same state, restored from disk and saved before an update. Their "back" goes to the chat.

### Where the notices lead

| Notice | Opens |
|---|---|
| The pre-daily is due (and its push, high urgency) | `chat` (with the ceremony bar); in a workspace with no persona, the Overview, which has the card |
| The tray's "ceremony now" | `call` (the pre-daily screen) |
| New blockers, a changed stage, feedback returned, watcher alerts, the many-at-once notice, the phone's summary of a burst of notices, a job that finished, an agent's question outside a run | `overview` |
| A notice made by an earlier version, with `today` or `call` | `today` opens the Overview; `call` opens the pre-daily (with no cards loaded, the chat) |

### The paired phone

It does **everything the computer does** with the persona: chats, makes, adjusts, tests, clears and deletes. The wizard's channels have a prefix of their own, `persona:` (the agent assistant's, `agentAssist:`, stay denied to a browser). A new channel under `persona:` is denied until somebody classifies it. Every change (saving the test draft, concluding or discarding the test, save, clear, delete, finishing the wizard) goes to the audit log with the door it came by (window or paired browser), and never with a text. The persona's starting access is built in the app from the texts; a screen never sends it, so a paired browser raises nothing through here.

### Configuration

`agents.team[]` accepts `kind: 'persona'` on **one** entry (an absent `kind` is an ordinary agent); the schema is **30**, with the step `v29ToV30` that only changes the version. An earlier version refuses a file saved by this one. Validation refuses two personas (at most one real and one draft copy), and a persona with a stage, a squad, a `turnsTo`, `autonomous: true` or `system: true`; every error lands on `agents.team[i].kind`, and a hand-edited file with one loads with the persona turned into an ordinary agent and a note, without losing the team. The permission fields are **not** constrained: a file that gives the persona `shell: sandbox` or `permission: worktree` is honoured, as for any agent.

**The persona takes no part in the cycle.** It works no stage, is not offered as someone to turn to, is not called by another agent, is in no squad, is not on the list of agents the agent assistant is told about, and is **left out of a cycle template** (shared or exported). A test walks the readers of the team with a persona in it, and a scan of the sources fails when a new reader appears unclassified.

### Where the personal text lives

The instructions describe the person. They are in the workspace configuration (which a paired browser reads, the same trust given to the chat on the phone), go in the prompt of every answer to the model's provider, and sit in the engine's session files (the app's open-session folder, and, on the Claude engine, the history the SDK writes in the person's own Claude folder). They are **not** in the configuration export (an import also takes a persona out of the file, with a warning, and keeps the target workspace's own), nor in a cycle template. The app copies the text into neither the session index, the error log nor the usage records. The persona's conversation transcripts are **not** swept by the retention, like any conversation's.

### What was not verified

- None of this has been used for long. The wizard and the chat were tested with fake models; the Claude engine's path was checked by hand against the real SDK (text in pieces, a tool turn, a success result with no structured output).
- **On the Claude engine the text can arrive all at once**: after a pause to think, the SDK delivers the whole text in one burst. On the open engine the text grows gradually. The pieces arrive in order and the stored text equals the last one shown on both.
- The chat screen, the navigation, the ceremony bar and the Overview are drawn by no test (the tests cover the functions behind them). The layout was seen on a build with fictional data at 1600, 760 and 390 px, in both themes; it was not seen on a real phone, nor was the jobs button over the box.
- Messages from before the update have no Work section.
