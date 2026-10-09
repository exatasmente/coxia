# Procedimentos aprendidos / Learned procedures

[Português](#português) | [English](#english)

---

## Português

Um agente que descobre como se faz uma coisa que se repete (rodar os testes de ponta a ponta, atualizar uma linha numa planilha, montar as notas de uma versão) gasta tokens e tentativas para isso. Sem memória, o próximo agente gasta o mesmo. Um **procedimento** é o que o agente descobriu, guardado na pasta do workspace para o próximo ler e seguir, explorando só o que mudou.

Os procedimentos são **dados, nunca instruções**: um registro não dá a um agente uma ferramenta, um host ou uma permissão, e o que ele manda fazer passa pelas regras de comandos e pela aprovação do próprio agente, como se o agente tivesse inventado. Não confundir com as outras memórias: a memória do ciclo (`MEMORY.md`) diz o que foi decidido numa execução, as atividades dizem o que está acontecendo agora, o `AGENTS.md` diz o que o repositório quer de quem trabalha nele (veja [Instruções do projeto](harness.md)). Um procedimento diz **como se faz X**.

### O registro

Um registro é um arquivo JSON em `<workspace>/memory/procedures/<id>.json`, fora de qualquer worktree e do repositório, então nunca vai num pull request. O app é o único que escreve nele; o agente nunca vê o arquivo.

| Campo | O que é |
|---|---|
| `id` | `p-` e 8 dígitos hexadecimais, feito pelo app. Um id apagado nunca é reaproveitado (`deleted.json` guarda os já usados) |
| `kind` | `repo`, `tool`, `cycle`, `request` ou `gui` |
| `key` | Onde vale, na forma do tipo (abaixo), até 80 caracteres |
| `title` | A ação em poucas palavras, até 80 caracteres: letras, dígitos, espaços e `. , - / ( ) '`, numa linha |
| `steps` | Até 20 passos: `text` (240) e, se quiser, `run` (200): um comando, ou um controle por seu papel e rótulo visível |
| `pitfalls`, `waits` | O que evitar (até 8 de 200) e o que esperar e por quanto tempo (até 6 de 160) |
| `state` | `unverified`, `ok` ou `failing`; só o app muda |
| `lastVerified`, `lastFailed` | Instantes que o app marca; o segundo traz o número do passo |
| `stats` | Usos, falhas, último uso e os números de consumo (veja a comparação) |
| `origin` | Quem escreveu esta revisão, de que lugar (etapa e tipo, conversa direta, canal de squad, tópico geral, thread da execução, agente chamado, ou a pessoa), a permissão e o shell do agente naquele momento |
| `stepsFrom`, `keyedBy` | De onde vêm os passos (`recording`, `edited`, `agent`) e `app` quando o app tirou a chave das páginas visitadas |
| `reviewed` | `true` quando a pessoa olhou esta revisão ou a escreveu |
| `revision`, `previous` | A revisão sobe a cada escrita; os campos de texto da revisão anterior ficam guardados uma vez, para restaurar |

O conteúdo (`key`, `title`, `steps`, `pitfalls`, `waits`) tem no máximo **4.000 caracteres**; `stats`, `origin` e `previous` não contam. O que passa de um limite é **recusado**, nunca cortado.

Os tipos e a chave de cada um:

- `repo`: o id de um repositório do workspace (`projects.repos`); qualquer outra coisa é recusada.
- `tool`: o nome de um plugin, do host de código ou de uma ferramenta de linha de comando, como slug.
- `cycle`: um tipo de etapa do fluxo, opcionalmente seguido de `@` e o id de um repositório.
- `request`: um slug curto para algo que as pessoas pedem sempre nas conversas. O tipo menos ancorado; vai por último na lista.
- `gui`: o host de um site (`docs.example.com`, sem esquema, caminho, porta nem consulta) ou o nome de um aplicativo. Veja "A tela" abaixo.

Há no máximo **10 registros por tipo e chave** e **300 por workspace**. No limite, a gravação é recusada com o nome do registro menos usado, para trocar: o app nunca expulsa um registro sozinho. Um título quase igual (mesmo texto sem contar caixa e espaços) no mesmo tipo e chave é recusado com o id do que já existe.

### As ferramentas

Com a chave ligada (veja abaixo), uma etapa, um agente chamado por uma etapa, um agente citado na thread de uma execução e um agente numa conversa direta, num canal de squad ou num tópico geral recebem as ferramentas e, no prompt, uma **lista curta** dos procedimentos que servem ao trabalho deles (no máximo 25 linhas e 2.000 caracteres, e "N mais não listados"). Uma cerimônia e uma chamada sem sessão de trabalho não recebem nada. Um agente somente-leitura recebe as ferramentas: elas escrevem na pasta do app, não num repositório nem num serviço externo.

As ferramentas são as mesmas para os dois motores (Claude Agent SDK, em `mcp__coxia_procedures__procedures_*`, e o motor aberto, com os nomes simples):

| Ferramenta | O que faz |
|---|---|
| `procedures_list` | Lista id, tipo, chave, título, estado e quando foi verificado: o que serve à chamada, ou o de um tipo e chave. Mostra também o que a lista do prompt cortou |
| `procedures_get` | Devolve um registro inteiro, enquadrado como dado. Ler conta como **uso** |
| `procedures_save` | Cria um registro, ou troca um pelo `id` e a `revision` que o agente leu. O app valida campo a campo e responde com o id e a revisão, ou com a recusa, que diz o campo e o motivo sem repetir o valor |
| `procedures_stale` | Diz que um passo não funcionou mais (id, número do passo, nota curta). O registro passa a `failing` |
| `procedures_draft` | **Só numa chamada que tem o navegador do app ou um shell do app.** Devolve o rascunho que o app fez do que a tela fez (`d-1`) e dos comandos que o agente rodou (`c-1`). Veja "A tela" e "Os comandos" |

Não há ferramenta para apagar nem para mexer na tela de procedimentos: o agente cria, troca e reporta; só o computador apaga. Se o SDK ou o zod não carregar, a lista continua no prompt e a conversa diz que as ferramentas não estão disponíveis.

### Como o registro muda

Um registro é **atualizado, não acumulado**. Uma gravação com o `id` troca os campos de texto (a revisão anterior fica em `previous`; uma troca de agente sobre uma versão de agente não tira dali a versão que a pessoa escreveu ou revisou), devolve o estado a `unverified`, zera as falhas desde a gravação e mantém o consumo-base. Uma gravação que não leu a revisão atual é recusada com "mudou desde que você leu; leia de novo".

- **Falha**: `procedures_stale` marca o registro como `failing`, guarda o passo e escreve uma linha na thread. Só vale para um registro que a chamada leu, que estava na lista dela ou que ela gravou, na revisão que ela viu, e uma chamada falha um registro uma vez. Ele continua na lista, marcado. Um registro que falhou duas vezes desde a última gravação sai da lista do prompt (a pessoa continua vendo).
- **Uso**: uma chamada que leu um procedimento e terminou sem relatar falha nem trocá-lo conta como uso "sem falha relatada"; o app marca `ok` e `lastVerified`. Isso é **inferido pelo app**, não declarado pelo modelo, e é mais fraco que um teste: ninguém testou os passos. A tela diz exatamente isso.
- **Velho**: sem verificação há mais de 90 dias, o registro é listado como velho, nunca removido por idade.

Cada gravação, relato de falha e exclusão (da pessoa também) deixa uma entrada no registro de auditoria (agente, id, revisão, tipo, chave e título; nunca um passo) e, quando foi um agente, uma linha na thread do lugar.

### A tela (tipo `gui`)

Um agente com o navegador do app (`screen: true`) não escreve um procedimento de tela de memória. O app, que executa cada ação do navegador, mantém um registro dos passos e monta um **rascunho**; o agente o revisa e o grava.

- `procedures_draft` devolve o rascunho da **tela inteira, desde que ela abriu** (todas as respostas dele na mesma tela, não só a atual) ou desde a última marca (abaixo): um passo por ação, na ordem, cada controle pelo **papel e rótulo visível** (rótulo cortado em **40 caracteres**, uma linha), a página como caminho sem consulta nem fragmento e com os trechos que parecem id trocados por `:id`, as esperas que o app mediu (arredondadas para cima), as ações que falharam como candidatas a `pitfalls`, e os passos desfeitos pelo seguinte, descartados. Um passo `type` **nunca traz o texto**: lê `<value>`, seja o que o agente ou a pessoa digitou. O intervalo em que a pessoa usou a tela é um passo sem conteúdo. Mostra também os sites visitados e, quando já havia um procedimento seguido, uma comparação (mantidos, mudados, novos, sumidos).
- `procedures_save` de um `gui` leva o id do rascunho (`draft`), uma `key` entre os sites que ele lista, o título, e `steps` como os **números** dos passos a manter, cada um `{n}` ou `{n, text}` para reescrever; sem `steps`, mantém todos. Não se acrescenta um passo nem um comando que o app não gravou. Um passo reescrito fica marcado (`edited`). Sem rascunho, ou com passos próprios, o `gui` é recusado com "use o rascunho". Com o `id` de um registro existente, a gravação é uma troca.
- **A chave vem das páginas visitadas**: o app a tira do que o navegador abriu, na sandbox e com `shell: host`, e recusa uma chave que a sessão nunca visitou.
- **O caminho do shell não deixa registro `gui`.** Playwright ou outro navegador rodado pelo shell do próprio agente não é visto pelo app: não há rascunho, e nenhum `gui` pode ser escrito dele (os outros tipos ainda podem). Uma etapa de QA que testa o app em desenvolvimento trabalha por esse caminho, então só deixa registros `repo`.
- Os rótulos de controle são texto da página, e uma página hostil pode chamar um botão do que quiser. Eles passam pelo mesmo validador e aparecem num registro que a pessoa pode revisar; o rascunho não marca nenhum como confiável.

**A marca do rascunho** mora na sessão da tela, junto do registro de passos, e uma tela nova começa em 0. Ela anda para o último passo do rascunho quando um `gui` é gravado a partir dele ou a pessoa diz Sim no cartão, para o último passo oferecido quando a pessoa diz Não, e para o último passo da tela quando a chamada lê (`procedures_get`) um `gui` cuja chave a tela visitou: o que veio antes não é a parte que mudou. Um cartão ignorado ou vencido não move nada, então o próximo rascunho é o maior.

### Os comandos (tipos `repo` e `tool`)

Um agente com shell do app (sandbox ou host) também não escreve de memória o que rodou. `procedures_draft` devolve o **rascunho dos comandos** (`c-1`, ...): os comandos que o agente rodou **nesta chamada**, na ordem em que funcionaram. Não contam os comandos que o app rodou antes do QA, os de um agente chamado, os de respostas anteriores numa sessão mantida, os recusados e os que nem chegaram a rodar.

- **Só o texto do comando é lido; a saída nunca.** A saída é onde o segredo aparece.
- Comandos que só leem (`ls`, `cat`, `grep`, `git status`, ...) somem em silêncio. Um comando que falhou e depois deu certo **com o mesmo programa** vira só o passo que deu certo, e a falha vira candidata a armadilha (`Failed (exit 1): npm test`); uma falha sem sucesso depois é só armadilha. Um sucesso repetido fica na última posição. Variáveis de ambiente e um `cd <pasta> &&` do começo são tirados.
- **Como o segredo fica fora**, em camadas, todas sobre o texto: um comando de várias linhas (heredoc, script colado), `export`, `set`, `unset`, `source` e `.` são deixados de fora; um comando que cita `.env`, `.npmrc`, `.netrc`, `.aws`, `.ssh`, `id_rsa`, `.pem`, `credentials` ou `secret`, as palavras `authorization`, `bearer`, `cookie`, `api-key`, `passw*` ou `token`, uma URL com credenciais, um heredoc, ou as opções de carga de `curl`, `wget` e `http` (`-H`, `-u`, `-d`, `-F`, `-b`) é deixado de fora (erra para o lado de deixar de fora: `npm run test:token` também); cada passo e armadilha passa pelo validador acima; um comando que a máscara exata do ambiente de teste mudaria, ou que contém o que a pessoa digitou, é deixado de fora; e um comando com mais de 200 caracteres é deixado de fora, nunca cortado. O rascunho diz **quantos** comandos ficaram de fora ("2 commands were left out for safety"), nunca quais nem por quê.
- `procedures_save` com `draft: "c-1"`, o tipo `repo` (a chave é o id do repositório) ou `tool` (a chave é o programa), um título e, se quiser, `steps` como números (`{n}` ou `{n, text}`). O comando de cada passo é o gravado pelo app: o agente reescreve só o texto e não acrescenta passo nem muda comando. Um `repo`, `tool`, `cycle` ou `request` **sem** rascunho continua como antes (o agente pode escrever um de memória).

### A oferta ao fim do trabalho

Os agentes quase nunca chamam `procedures_save` por conta própria. Por isso o app, no fim do trabalho, oferece o que ele mesmo registrou.

- **Quando.** Uma vez ao fim de uma tentativa de etapa que **concluiu** (não a que termina numa pergunta, que retoma, nem uma que falhou, parou ou foi cancelada) e uma vez ao fim de cada resposta de conversa que deu resposta (conversa direta, canal, tópico, thread da execução). Não numa cerimônia, nem para um agente chamado por outro. A chave `runner.procedures` tem de estar ligada.
- **Condições, todas.** A chamada não gravou nem trocou procedimento e não leu nenhum; e houve tentativa e erro: nos comandos, uma falha seguida de um sucesso do mesmo programa e pelo menos um passo; na tela, pelo menos **5 passos** mantidos. Trabalho sem tentativa e erro não paga nada.
- **A última vez que o agente fala.** O app chama o mesmo agente mais uma vez, com um prompt pequeno: a tarefa, as palavras finais dele (até 600 caracteres, como dado) e o rascunho. Ele pode salvar com `procedures_save` e o id do rascunho, se a tarefa terminou e vale guardar; senão não salva nada. A chamada tem **só as ferramentas de procedimentos** (nem shell, nem arquivos, nem host de código, nem tela), é de leitura qualquer que seja a permissão do agente, tem **no máximo 3 turnos**, **120 segundos** e não retoma a sessão da etapa (um prompt de poucos milhares de tokens, não a conversa inteira). Cancelar a execução a interrompe; erro, limite de tempo ou recusa de orçamento são engolidos: a etapa e a resposta seguem como seguiriam. Numa etapa a chamada é esperada, antes de fechar o uso dos procedimentos; numa conversa ela roda **depois que a resposta foi publicada** e fora da fila da thread, então a próxima mensagem não espera. Numa conversa é dada **uma vez por tela e por marca de rascunho**.
- **O custo.** Os tokens da volta são gastos de verdade: entram no consumo da etapa (a conversa não guarda consumo, e continua sem guardar), **não** no consumo-base do procedimento, que continua sendo o que custou descobrir. A thread diz "{agente} teve uma última vez para guardar um procedimento ({n} tokens)".
- **O cartão.** O que nenhum salvamento usou vira uma **oferta** em memória (nunca em disco), que aparece na thread da execução ou da conversa ao lado dos cartões de pergunta: "Guardar como procedimento?", o agente, o tipo e a chave, os passos (`text` e `run` em monoespaçado), as armadilhas, "N comandos foram deixados de fora por segurança", um aviso quando a pessoa usou a tela ("você usou a tela neste trabalho: confira se nenhum passo guarda o que digitou") e um título editável. A thread ganha a linha "O app oferece guardar {n} passos como procedimento". **Sim** salva pelo mesmo armazém e validador, como escrita da pessoa (`origin.by: person`, `createdBy` o agente), já revisado, com o consumo do trabalho como base, e move a marca da tela; uma recusa (título repetido, teto, repositório que mudou) aparece no cartão, que fica. **Não** descarta a oferta e, numa tela, move a marca. A oferta vence em 24 horas, são no máximo 10 por workspace (a mais antiga sai) e uma por (thread, agente, tipo, chave); reiniciar o app as apaga, sem linha.
- **O celular.** O cartão é do computador: um navegador pareado não o vê nem o responde (`procedures:offers`, `procedures:offer-keep` e `procedures:offer-decline` caem na negação do prefixo `procedures:`). Ele vê as linhas da thread.
- **Nada novo no disco.** Nenhum campo novo de registro, de execução ou de configuração (esquema 23, formato de execução 6).

### O que não entra num registro

O primeiro filtro é a estrutura: campos curtos e um validador que **recusa**, por campo e em palavras, sem repetir o valor:

- um passo `gui` com mais de 40 caracteres entre aspas;
- uma sequência de 6 ou mais dígitos, ou 20 ou mais caracteres sem espaço que misturam letras e dígitos;
- um endereço com consulta ou fragmento;
- e-mail, telefone, ou qualquer coisa que `redact()` mudaria (uma credencial num comando é recusada, não mascarada);
- o caminho da pasta pessoal;
- uma senha ou token dado como valor de uma opção de comando (`--password x`, `mysql -p x`), a menos que seja um marcador como `<valor>` ou `$VAR`;
- caracteres invisíveis ou de formatação (largura zero, inversão de direção).

O validador erra para o lado de recusar: um falso positivo recusa e ensina. Isso **não** pega um nome, um endereço ou outro dado pessoal escrito em palavras curtas com cara de rótulo; as defesas que restam são a revisão da pessoa e os limites de tamanho.

**O que a pessoa digitou numa passagem de tela nunca entra.** Durante uma passagem (o agente entrega a tela para a pessoa fazer um login), o app guarda **na memória**, nunca em disco, o que ela digitou pelo visualizador, nas formas simples, codificada em URL e escapada para JSON. Uma gravação de qualquer tipo cujo título, chave, passo, armadilha ou espera contenha isso é **recusada** (não mascarada), não escreve nada e vai para a auditoria por campo, sem o valor. A garantia é só esta, e vale o seguinte:

- é **o melhor que dá para fazer**, não um cofre: pega o que a pessoa digitou **pelo visualizador do app**, e só durante **aquela chamada** (a memória some ao fim da chamada ou ao reiniciar o app);
- não pega o que a página mostra e a pessoa não digitou (um código que chegou ao celular), nem o que o agente leu da própria página, já que os processos do agente continuam rodando durante a passagem;
- um registro gravado numa chamada em que a pessoa usou a tela, **ou numa tela em que ela já tinha usado antes**, fica **à espera de revisão** (`origin.handoff` sem `reviewed`): não entra na lista do prompt, nem em `procedures_list`, nem em `procedures_get` até a pessoa marcá-lo como revisado ou reescrevê-lo. A tela de procedimentos o mostra e diz que espera.
- uma página hostil pode levar o agente a gravar texto da página como registro de outro tipo (`request` ou `tool`), onde o limite de aspas de 40 caracteres do `gui` não vale; o validador e a revisão da pessoa são o que resta.

### A chave

`runner.procedures` (Configurações › Runner). Desligada, não há ferramenta, nem seção no prompt, nem escrita de nenhum agente, e a tela ainda lista, edita e apaga o que existe. Um workspace que já existia fica **desligado** (o passo de migração 21 → 22 escreve `false`); um novo nasce **ligado**. Só o computador a muda: `runner.*` não está entre os caminhos que um navegador pareado pode editar (veja [Configuração](configuration.md)).

### A tela de procedimentos

Mais › Procedimentos (e um botão no cabeçalho do app, no computador). Lista todos os registros do workspace, com busca por título e chave e filtros por tipo, chave, quem escreveu, estado e "não revisados"; os que falham vêm primeiro. Abrir um registro mostra os campos, a origem (agente, permissão, shell, lugar), o estado e por quê, a revisão anterior e a comparação de consumo.

No computador:

- **Editar** passa pelo mesmo validador que a gravação do agente, torna o registro da pessoa e já revisado, guarda a revisão anterior e sobe a revisão;
- **Marcar como revisado** não muda texto nem revisão, então um agente que o leu ainda pode trocá-lo;
- **Restaurar a anterior** volta aos campos de texto de `previous`;
- **Apagar** pede confirmação, remove o arquivo e o id não é reutilizado; um agente que segura o id apagado ouve "não encontrado; grave um novo".

Um **navegador pareado só lê**: `procedures:list`, `procedures:get` e `procedures:stats` são os únicos canais abertos, e qualquer outro canal com o prefixo `procedures:`, inclusive um que ainda não exista, é negado. A tela não mostra os botões de edição, revisão, restauração nem exclusão no navegador, e uma chamada direta é recusada.

### A comparação

Para cada procedimento o app guarda o consumo da chamada que o criou (a **base**: o que custou descobrir) e o das **últimas 20 chamadas** que o leram. A tela mostra a base ao lado da média dos usos, o número de usos e a parte sem falha relatada. Só mostra "tokens economizados", como (base − média) × usos, com **pelo menos 3 usos** e média abaixo da base, e sempre com o rótulo **aproximado**: a chamada que criou e as que usaram fizeram outro trabalho além do procedimento, então é uma comparação, não um teste controlado. O custo só aparece onde o provedor ou o SDK o informou, e como estimativa quando o consumo diz que é. Com menos usos a tela diz "poucos usos para comparar". Duas gravações do mesmo agente na mesma chamada dividem a mesma medida de consumo.

Numa etapa de uma execução, o cartão mostra "Usou: {título}" e se um passo falhou ou o agente trocou o procedimento. Numa conversa, o mesmo vira uma linha de sistema, que nunca chega a um prompt. A resposta de uma conversa que leu um procedimento guarda seu consumo; uma que não leu não guarda nenhum.

### O que fica no disco, e o que não

- `<workspace>/memory/procedures/<id>.json` e `deleted.json`, atômicos (escreve num nome temporário e renomeia). Um arquivo de uma versão mais nova do formato não é lido nem sobrescrito: o app diz "escrito por um app mais novo".
- **Não há retenção para procedimentos.** A varredura de retenção não toca em `memory/procedures/`: é conhecimento que custou tokens para achar. A tela mostra a contagem e os mais antigos; quem apaga é a pessoa. Os registros também não vão na exportação da configuração.
- Uma execução cujo estágio leu um procedimento é gravada no **formato 5**: um app mais antigo a lê como "escrita por um app mais novo" e não como inválida. As execuções sem isso continuam como eram.

### O que não foi verificado

O uso do navegador, a passagem de tela e a tela de procedimentos num app aberto de verdade (e a economia de tokens de uma segunda execução da mesma tarefa) se confere à mão num diretório de dados descartável; veja o plano de teste do ciclo. O mesmo vale para a última volta e o cartão: o custo real de uma volta em tokens e o fluxo "o agente briga com um script, termina, o cartão aparece, Sim" só se veem num app aberto. Os testes automáticos usam o rascunho feito sobre um registro falso de passos, nunca um site, um modelo ou um host reais.

---

## English

An agent that works out how to do something that repeats (run the end-to-end tests, update a row in a sheet, assemble the notes of a version) spends tokens and attempts on it. Without a memory, the next agent spends the same. A **procedure** is what the agent worked out, kept in the workspace's folder for the next one to read and follow, exploring only what changed.

Procedures are **data, never instructions**: a record gives an agent no tool, no host and no permission, and whatever it says to do goes through the agent's own command rules and approval, as if the agent had made it up. They are not the other memories: the cycle memory (`MEMORY.md`) says what was decided in one run, the activities say what is going on now, `AGENTS.md` says what the repository wants from anyone who works in it (see [Project instructions](harness.md)). A procedure says **how to do X**.

### The record

A record is a JSON file at `<workspace>/memory/procedures/<id>.json`, outside every worktree and the repository, so it never rides a pull request. The app is the only writer; the agent never sees the file.

| Field | What it is |
|---|---|
| `id` | `p-` and 8 hex digits, made by the app. A deleted id is never reused (`deleted.json` keeps the ones ever used) |
| `kind` | `repo`, `tool`, `cycle`, `request` or `gui` |
| `key` | Where it applies, in the form its kind takes (below), at most 80 characters |
| `title` | The action in a few words, at most 80 characters: letters, digits, spaces and `. , - / ( ) '`, on one line |
| `steps` | Up to 20 steps: `text` (240) and optionally `run` (200): a command, or a control by its role and visible label |
| `pitfalls`, `waits` | What to avoid (up to 8 of 200) and what to wait for and how long (up to 6 of 160) |
| `state` | `unverified`, `ok` or `failing`; only the app changes it |
| `lastVerified`, `lastFailed` | Instants the app sets; the second carries the step number |
| `stats` | Uses, failures, last use and the usage figures (see the comparison) |
| `origin` | Who wrote this revision, from where (stage and its kind, direct conversation, squad channel, general thread, run thread, called agent, or the person), and the agent's permission and shell at that moment |
| `stepsFrom`, `keyedBy` | Where the steps come from (`recording`, `edited`, `agent`) and `app` when the app took the key from the pages visited |
| `reviewed` | `true` once the person looked at this revision or wrote it |
| `revision`, `previous` | The revision goes up on every write; the text fields of the revision before are kept once, to restore |

The content (`key`, `title`, `steps`, `pitfalls`, `waits`) is at most **4,000 characters**; `stats`, `origin` and `previous` do not count. Anything over a limit is **refused**, never cut.

The kinds and their keys:

- `repo`: the id of one of the workspace's repositories (`projects.repos`); anything else is refused.
- `tool`: the name of a plugin, the code host or a command-line tool, as a slug.
- `cycle`: a stage kind of the flow, optionally followed by `@` and a repository id.
- `request`: a short slug for something people keep asking in conversations. The least anchored kind; listed last.
- `gui`: the host of a site (`docs.example.com`, no scheme, path, port or query) or the name of an application. See "The screen" below.

There are at most **10 records per kind and key** and **300 per workspace**. At a limit the write is refused naming the least-used record, to replace: the app never evicts a record by itself. A near-identical title (the same text ignoring case and spaces) in the same kind and key is refused with the id of the one that exists.

### The tools

With the switch on (below), a stage, an agent a stage called, an agent named in a run's thread and an agent in a direct conversation, a squad channel or a general thread get the tools and, in the prompt, a **short list** of the procedures that fit their work (at most 25 lines and 2,000 characters, then "N more not listed"). A ceremony and a call with no session of work get nothing. A read-only agent gets the tools: they write the app's own folder, not a repository or an external service.

The tools are the same for both engines (the Claude Agent SDK, as `mcp__coxia_procedures__procedures_*`, and the open engine, with the plain names):

| Tool | What it does |
|---|---|
| `procedures_list` | Lists id, kind, key, title, state and when it was verified: what fits the call, or one kind and key. It also shows what the prompt's list left out |
| `procedures_get` | Returns one record in full, framed as data. Reading counts as a **use** |
| `procedures_save` | Creates a record, or replaces one by `id` and the `revision` the agent read. The app validates field by field and answers with the id and revision, or with the refusal, which names the field and the reason without repeating the value |
| `procedures_stale` | Says a step no longer worked (id, step number, short note). The record becomes `failing` |
| `procedures_draft` | **Only in a call that has the app's browser or the app's shell.** Returns the app's draft of what the screen did (`d-1`) and of the commands the agent ran (`c-1`). See "The screen" and "The commands" |

There is no tool to delete, and none that touches the Procedures view: the agent creates, replaces and reports; only the computer deletes. If the SDK or zod does not load, the list stays in the prompt and the conversation says the tools are unavailable.

### How a record changes

A record is **updated, not piled up**. A write with the `id` replaces the text fields (the revision before stays in `previous`; an agent replacing an agent's version does not push out the version the person wrote or reviewed), returns the state to `unverified`, resets the failures since the save and keeps the baseline usage. A write that did not read the current revision is refused with "changed since you read it; read again".

- **Failure**: `procedures_stale` marks the record `failing`, keeps the step and writes a line in the thread. It counts only for a record the call read, had in its list or wrote, at the revision it saw, and a call fails a record once. It stays in the list, marked. A record that failed twice since it was last saved leaves the prompt's list (the person still sees it).
- **Use**: a call that read a procedure and finished without reporting a failure or replacing it counts as a use with "no failure reported"; the app sets `ok` and `lastVerified`. This is **inferred by the app**, not claimed by the model, and it is weaker than a test: nobody tested the steps. The view says so in those words.
- **Old**: not verified for more than 90 days, a record is listed as old and never removed by age.

Each save, stale report and delete (the person's too) leaves an entry in the audit log (agent, id, revision, kind, key and title; never a step) and, when an agent did it, a line in the thread of the place.

### The screen (kind `gui`)

An agent with the app's browser (`screen: true`) does not write a screen procedure from memory. The app, which executes every action of the browser, keeps a log of the steps and builds a **draft**; the agent reviews and saves it.

- `procedures_draft` returns the draft of the **whole screen from when it opened** (all the agent's answers on that screen, not only the current one) or from the last mark (below): one step per action, in order, each control by its **role and visible label** (a label is cut to **40 characters**, one line), the page as a path with the query and fragment dropped and id-like segments turned into `:id`, the waits the app measured (rounded up), failed actions as candidates for `pitfalls`, and steps undone by the next one dropped. A `type` step **never carries the text**: it reads `<value>`, whatever the agent or the person typed. The stretch in which the person used the screen is one step with no content. It also lists the sites visited and, when a procedure had been followed, a comparison (kept, changed, new, gone).
- `procedures_save` of a `gui` takes the draft's id (`draft`), a `key` among the sites it lists, the title, and `steps` as the **numbers** of the draft steps to keep, each `{n}` or `{n, text}` to reword it; without `steps` it keeps them all. A step or a command the app did not record cannot be added. A reworded step is marked (`edited`). Without a draft, or with steps of its own, `gui` is refused with "use the draft". With the `id` of an existing record, the save is a replacement.
- **The key comes from the pages visited**: the app takes it from what the browser opened, in the sandbox and with `shell: host`, and refuses a key the session never visited.
- **The shell path leaves no `gui` record.** Playwright or another browser run from the agent's own shell is not seen by the app: there is no draft, and no `gui` record can be written from it (the other kinds still can). A QA stage that tests the app under development works that way, so it leaves `repo` records only.
- A control's label is page text, and a hostile page can name a button anything. Labels pass the same validator and appear in a record the person can review; the draft marks no label as trusted.

**The draft mark** lives in the screen session, beside the log of steps, and a new screen starts at 0. It moves to the last step of the draft when a `gui` is saved from it or the person says Yes on the card, to the last step offered when the person says No, and to the screen's last step when the call reads (`procedures_get`) a `gui` record whose key the screen visited: what came before is not the part that changed. A card that is ignored or expires moves nothing, so the next draft is the bigger one.

### The commands (kinds `repo` and `tool`)

An agent with the app's shell (sandbox or host) does not write from memory what it ran either. `procedures_draft` returns the **command draft** (`c-1`, ...): the commands the agent ran **in this call**, in the order they worked. Not counted: the commands the app ran before QA, those of a called agent, those of earlier answers in a kept session, refused ones and ones that never ran.

- **Only the text of the command is read; the output never is.** Output is where a secret shows.
- Commands that only read (`ls`, `cat`, `grep`, `git status`, ...) vanish silently. A command that failed and then worked **with the same program** becomes only the step that worked, and the failure becomes a pitfall candidate (`Failed (exit 1): npm test`); a failure with no later success is only a pitfall. A success repeated word for word keeps its last place. Environment assignments and a leading `cd <folder> &&` are stripped.
- **How secrets stay out**, in layers, all over the text: a multi-line command (a heredoc, a pasted script), `export`, `set`, `unset`, `source` and `.` are left out; a command that mentions `.env`, `.npmrc`, `.netrc`, `.aws`, `.ssh`, `id_rsa`, `.pem`, `credentials` or `secret`, the words `authorization`, `bearer`, `cookie`, `api-key`, `passw*` or `token`, a URL with credentials, a heredoc, or the payload options of `curl`, `wget` and `http` (`-H`, `-u`, `-d`, `-F`, `-b`) is left out (it errs towards leaving out: `npm run test:token` goes too); every step and pitfall goes through the validator above; a command the exact mask of the test environment would change, or that holds what the person typed, is left out; and a command over 200 characters is left out, never cut. The draft says **how many** commands were left out ("2 commands were left out for safety"), never which and never why.
- `procedures_save` with `draft: "c-1"`, kind `repo` (the key is the repository id) or `tool` (the key is the program), a title and, optionally, `steps` as numbers (`{n}` or `{n, text}`). The command of each step is the app's recording: the agent rewords the text only and cannot add a step or change a command. A `repo`, `tool`, `cycle` or `request` save **without** a draft stays as before (the agent may write one from memory).

### The offer at the end of the work

Agents rarely call `procedures_save` on their own. So the app, at the end of the work, offers what it recorded itself.

- **When.** Once at the end of a stage attempt that **concluded** (not one that ends in a question, which resumes; not one that failed, stopped or was cancelled) and once at the end of each conversation answer that gave an answer (direct conversation, channel, thread, run thread). Not in a ceremony, and not for an agent called by another. The `runner.procedures` switch must be on.
- **Conditions, all of them.** The call saved and replaced no procedure and read none; and there was trial and error: in the commands, a failure followed by a success of the same program and at least one step; on the screen, at least **5 kept steps**. Work with no trial and error pays nothing.
- **The agent's last turn.** The app calls the same agent once more with a small prompt: the task, its own closing words (up to 600 characters, as data) and the draft. It may save with `procedures_save` and the draft's id if the task is done and worth keeping; otherwise it saves nothing. The call has **only the procedure tools** (no shell, no files, no code host, no screen), is read-only whatever the agent's permission, has **at most 3 turns** and **120 seconds**, and does not resume the stage's session (a prompt of a few thousand tokens, not the whole conversation). Cancelling the run stops it; an error, a timeout or a refused budget is swallowed: the stage or the answer goes on as it would have. In a stage the call is awaited, before the procedure uses are closed; in a conversation it runs **after the answer is posted** and outside the thread's queue, so the next message does not wait. In a conversation it is given **once per screen and draft mark**.
- **The cost.** The turn's tokens are real spend: they go into the stage's usage (a conversation keeps no usage, and still keeps none), **not** into the procedure's baseline, which stays what finding it cost. The thread says "{agent} had one last turn to keep a procedure ({n} tokens)".
- **The card.** What no save used becomes an **offer** in memory (never on disk), shown in the run's or the conversation's thread beside the ask cards: "Keep this as a procedure?", the agent, kind and key, the steps (`text` and `run` in monospace), the pitfalls, "N commands were left out for safety", a warning when the person used the screen ("you used the screen in this work: check that no step holds what you typed") and an editable title. The thread gets the line "The app offers to keep {n} steps as a procedure". **Yes** saves through the same store and validator, as the person's write (`origin.by: person`, `createdBy` the agent), already reviewed, with the work's usage as the baseline, and moves the screen mark; a refusal (a repeated title, a cap, a repository that changed) shows on the card, which stays. **No** drops the offer and, on a screen, moves the mark. An offer expires after 24 hours, at most 10 are held per workspace (the oldest goes) and there is one per (thread, agent, kind, key); restarting the app clears them, with no line.
- **The phone.** The card is the computer's: a paired browser neither sees nor answers it (`procedures:offers`, `procedures:offer-keep` and `procedures:offer-decline` fall under the denial of the `procedures:` prefix). It sees the thread's lines.
- **Nothing new on disk.** No new record, run or configuration field (schema 23, run format 6).

### What does not go in a record

The first filter is structure: short fields and a validator that **refuses**, by field and in words, without repeating the value:

- a `gui` step that quotes more than 40 characters between quotation marks;
- a run of 6 or more digits, or 20 or more characters with no space that mix letters and digits;
- an address with a query string or a fragment;
- an email, a phone number, or anything `redact()` would change (a credential in a command is refused, not masked);
- the path of the home folder;
- a password or token given as the value of a command option (`--password x`, `mysql -p x`), unless it is a placeholder such as `<value>` or `$VAR`;
- invisible or format characters (zero width, direction overrides).

The validator errs towards refusing: a false positive refuses and teaches. It does **not** catch a name, an address or other personal data written in short label-like words; what is left is the person's review and the size limits.

**What the person typed during a hand-off never goes in.** During a hand-off (the agent gives the screen to the person to log in), the app keeps **in memory**, never on disk, what they typed through the viewer, in its plain, URL-encoded and JSON-escaped forms. A save of any kind whose title, key, step, pitfall or wait holds it is **refused** (not masked), writes nothing, and is audited by field without the value. The guarantee is only this, and:

- it is **best effort**, not a vault: it catches what the person typed **through the app's viewer**, and only during **that call** (the memory is gone at the end of the call or when the app restarts);
- it does not catch what the page shows and the person did not type (a code that reached a phone), nor what the agent read from the page itself, since the agent's processes keep running during a hand-off;
- a record saved in a call in which the person used the screen, **or on a screen where they had used it earlier**, **waits for review** (`origin.handoff` without `reviewed`): it is out of the prompt list, `procedures_list` and `procedures_get` until the person marks it as reviewed or rewrites it. The Procedures view shows it and says it waits.
- a hostile page can steer the agent into saving page text as a record of another kind (`request` or `tool`), where the 40-character quotation limit of `gui` does not apply; the validator and the person's review are what is left.

### The switch

`runner.procedures` (Settings › Runner). Off, there is no tool, no prompt section and no write by any agent, and the view still lists, edits and deletes what exists. A workspace that existed is **off** (the migration step 21 → 22 writes `false`); a new one is born **on**. Only the computer changes it: `runner.*` is not among the paths a paired browser may edit (see [Configuration](configuration.md)).

### The Procedures view

More › Procedures (and a button in the header of the app, on the computer). It lists every record of the workspace, with a search by title and key and filters by kind, key, who wrote it, state and "not reviewed"; failing ones come first. Opening a record shows its fields, the origin (agent, permission, shell, place), the state and why, the version before this one and the usage comparison.

On the computer:

- **Edit** goes through the same validator as an agent's save, makes the record the person's and already reviewed, keeps the version before and raises the revision;
- **Mark as reviewed** changes no text and no revision, so an agent that read it can still replace it;
- **Restore the previous** goes back to the text fields in `previous`;
- **Delete** asks to confirm, removes the file, and the id is not reused; an agent holding the deleted id is told "not found; save a new one".

A **paired browser only reads**: `procedures:list`, `procedures:get` and `procedures:stats` are the only open channels, and any other channel under the `procedures:` prefix, including one that does not exist yet, is denied. The view shows no edit, review, restore or delete control in a browser, and a direct call is refused.

### The comparison

For each procedure the app keeps the usage of the call that created it (the **baseline**: what finding it cost) and of the **last 20 calls** that read it. The view shows the baseline next to the average of the uses, the number of uses and the share with no failure reported. It shows "tokens saved", as (baseline - average) x uses, only with **at least 3 uses** and an average below the baseline, and always labelled **approximate**: the call that created it and the ones that used it did other work besides the procedure, so it is a comparison and not a controlled test. Cost shows only where the provider or the SDK reported one, and as an estimate where the usage says so. With fewer uses the view says "not enough uses to compare". Two records of one agent in one call share the one usage meter.

On the stage of a run the card shows "Used: {title}" and whether a step failed or the agent replaced the procedure. In a conversation the same is a system line, which never reaches a prompt. An answer in a conversation that read a procedure keeps its usage; one that did not keeps none.

### What is kept on disk, and what is not

- `<workspace>/memory/procedures/<id>.json` and `deleted.json`, written atomically (to a temporary name, then renamed). A file of a newer format version is neither read nor overwritten: the app says "written by a newer app".
- **There is no retention for procedures.** The retention sweep does not touch `memory/procedures/`: it is knowledge that took tokens to find. The view shows the count and the oldest; the person deletes. Records are not part of the configuration export either.
- A run whose stage read a procedure is written as **format 5**: an older app reads it as "written by a newer app" and not as invalid. Runs without it stay as they were.

### What was not verified

The browser's use, the hand-off and the Procedures view in a real running app (and the token saving of a second run of the same task) are checked by hand, on a throwaway data directory; see the cycle's test plan. So are the last turn and the card: the real cost of a turn in tokens and the flow "the agent fights a script, finishes, the card appears, Yes" can only be seen in an open app. The automated tests use the draft built over a fake log of steps, never a real site, model or host.
