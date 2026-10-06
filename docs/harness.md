# A documentação do projeto / The project documentation

[Português](#português) | [English](#english)

---

## Português

Cada repositório pode ter, na raiz, uma pasta **`.coxia/`**: a documentação do projeto que os agentes do app leem, versionada com o código e revisada em pull request como ele. Ela diz o que o projeto é e como se constrói e se testa, as regras de cada domínio (cada uma com a evidência em que se apoia), os procedimentos que um agente segue e as notas por papel do time. Um workspace com vários repositórios tem uma por repositório; não há lista nova para configurar, a pasta é achada por convenção. Esta página é a casa do formato e do comportamento; os outros documentos apontam para cá.

O Claude Code continua dono do `.claude/` e do `CLAUDE.md`: o app **só os lê**, para importar o que é fato do projeto, e nunca escreve neles.

### O formato

```
.coxia/
  README.md          a visão geral: o que o projeto é, como se constrói e se testa (todo agente a recebe)
  rules/<id>.md      uma regra de domínio: a regra, o porquê, a evidência e os testes que a guardam
  skills/<id>.md     um procedimento que um agente segue
  roles/<id>.md      notas para um papel do time (o `<id>` é o id do agente)
```

O `<id>` segue o padrão de id do resto da configuração (`^[a-z0-9][a-z0-9_-]{0,47}$`). Um nível só: `rules/a/b.md` não é lido. O tipo do arquivo vem do caminho, nunca do conteúdo. `.coxia/.run/` e `.coxia/.gitignore` são do app e ficam fora da contagem; qualquer outro arquivo aparece em Configurações › Documentação como "não lido" e nada mais.

Todo arquivo abre com um **cabeçalho** entre duas linhas `---`, num subconjunto de YAML que o app entende sozinho (`chave: valor` e listas em linha ou em bloco; o app não tem dependência de YAML):

```markdown
---
checked-commit: 3f9a1c2
checked-date: 2026-10-06
evidence: [src/billing/invoice.ts:40-88, src/billing/tax/]
stages: [review, development]
roles: [reviewer]
summary: How an invoice total is computed and rounded
---

# Invoice totals
...
```

| Campo | Valor | Obrigatório |
|---|---|---|
| `checked-commit` | hexadecimal de 7 a 40 caracteres: o commit contra o qual o arquivo foi conferido | sim, em todo arquivo |
| `checked-date` | `AAAA-MM-DD` | sim, em todo arquivo |
| `evidence` | caminhos relativos à raiz do repositório, cada um com `:linha` ou `:linha-linha` opcional; `pasta/` com barra final vale a pasta inteira | a chave é obrigatória em `rules/`, com a lista não vazia; opcional nos demais |
| `stages` | ids de etapa **ou** tipos de etapa (`development`, `review`, `qa`…) a que o arquivo se destina | não |
| `roles` | ids de agente do time a que o arquivo se destina | não |
| `summary` | uma linha, até 160 caracteres, que aparece no índice | não (recomendado) |

Chave desconhecida é guardada e ignorada (um app mais novo pode acrescentar campos). Um caminho absoluto, com `..` ou com `~` em `evidence` torna o cabeçalho inválido: a evidência é do repositório, e isso impede que um caminho local entre num arquivo versionado. Globos não existem.

Um arquivo sem cabeçalho válido não é descartado nem confiado: tem o estado **inválido** (`no-header`, `bad-commit`, `bad-date`, `no-evidence` ou `bad-evidence`), conta como **não conferido** e chega ao agente sempre marcado (só vai inteiro o `README.md` e o `roles/<id do agente>.md`; os outros aparecem só no índice).

**Quem escreve o `checked-commit` e o `checked-date` é o app**, não o agente: o agente não conhece o commit que ainda vai existir (veja [o carimbo](#o-texto-é-conferido-e-o-carimbo)). **Hash de commit vai só no cabeçalho:** no corpo, qualquer cadeia longa com letra e dígito é mascarada como credencial na conferência de texto, e o hash viraria `[redacted]`.

### O que os agentes leem, e o que deixam de ler

- **Os agentes do time** (uma etapa de execução, uma menção, uma pergunta da cadeia, um pedido entre squads, a execução de documentação) leem a `.coxia/` dos repositórios em que trabalham, as **fontes extras** que a pessoa listou em `docs` de propósito (`claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`) e o `.mcp.json` de cada projeto. **Nada do Claude Code chega a eles**: nem o `CLAUDE.md` e o `.claude/` do projeto, nem os do `~/.claude` da pessoa.
  - No **motor do Claude Agent SDK**, a chamada leva `settingSources: []` e `settings: { autoMemoryEnabled: false }`: o Claude Code não carrega por conta própria o `CLAUDE.md`, o `.claude/`, os `settings.json` nem a memória automática. O que o app usava desses ajustes ele passa explícito (permissões, ferramentas, hooks, modelo, ambiente e MCP). A política gerenciada de uma empresa continua valendo, pois `[]` não a desliga.
  - No **motor aberto**, a leitura de `CLAUDE.md` subindo a árvore e de `.claude/` do `cwd` e da pasta pessoal (`defaultDocSources`) não entra: a chamada leva listas explícitas, vazias quando não há nada.
  - **`autoDetect` mudou de significado, não de formato:** continua um `boolean` no mesmo lugar, e `CONFIG_SCHEMA_VERSION` segue 13 (nenhum passo de migração: o arquivo de um workspace existente é válido antes e depois). Agora ele vale para as **cerimônias** (acrescenta `~/.claude`, `<projeto>/.claude` e `CLAUDE.md`) e, para todo agente, acrescenta o `.mcp.json` de cada projeto. As listas que a pessoa já preencheu continuam valendo; em Configurações › Documentação as que apontam para arquivos do Claude Code levam o selo "do Claude Code".
- **As cerimônias seguem como estão.** Os cinco agentes de sistema (`turn`, `reply`, `deep`, `teams`, `fix`) **ainda leem os arquivos do Claude Code**, como sempre, e não passam a ler a `.coxia/` por causa desta mudança. É uma escolha de escopo (a especificação deixou as cerimônias de fora), e elas usam o servidor MCP de issues, que só elas têm. Isolá-las também é uma issue própria.
- **O que se perde.** Com `settingSources: []`, as skills e os subagentes de `~/.claude` e de `<projeto>/.claude` **não são mais achados pelas ferramentas `Skill` e `Agent` do SDK** nos agentes do time. As `skills/` da `.coxia/` as substituem, como texto que o agente lê; o interruptor `tools.skills` continua existindo e só deixa de achar skills no caminho do SDK.

### O que cada agente recebe

O app monta **um texto só**, anexado ao texto de sistema, igual nos dois motores (os arquivos continuam legíveis, para o agente aprofundar com `Read`). Quem chama diz o repositório, a etapa e os caminhos que o trabalho toca; para uma execução, os caminhos são os que o ramo já mudou mais os que o texto da spec e do plano cita.

- **A visão geral (`README.md`) vai sempre**, até 40% do orçamento.
- Um arquivo de `rules/`, `skills/` ou `roles/` é **escolhido** quando o seu `stages` contém o id ou o tipo da etapa, ou o seu `roles` contém o id do agente (`roles/<id>.md` vale pelo nome), ou uma entrada de `evidence` cobre um caminho que o trabalho toca. Os não escolhidos entram num **índice** (nome e `summary`).
- **Orçamento por chamada: 24.000 caracteres** (cerca de 6 mil tokens), **reduzido pela janela de contexto** quando o provedor a declara: `min(24.000, 3 × janela × 0,15)`, com piso de 3.000. Em prioridade: as notas do papel do agente, as regras com mais caminhos cobertos, as escolhidas por etapa, as skills. Um arquivo que não cabe inteiro entra cortado, com a nota do corte, se couberem 600 caracteres; o que não coube vira uma linha "não coube" com os nomes. **Nada é cortado em silêncio.** **O número é o do texto inteiro entregue**: o cabeçalho, as marcas "não conferida", o índice e a linha "não coube" entram na conta, e a parte dos arquivos é reduzida até o total caber (a seleção estima o que cada parte custa, e o tamanho real decide). Vários repositórios numa conversa dividem o orçamento. O número aparece em Configurações › Documentação.
- **Repositório sem `.coxia/`: nenhum texto novo**, nem uma linha "não há documentação". Nada o impede de executar: o agente trabalha pelo código e pelas fontes extras, e a tela diz que a documentação não existe.

### "Não conferida"

O app não sabe se uma regra ainda é verdade; sabe se um arquivo que ela cita **mudou desde o commit contra o qual foi conferida**. Para cada arquivo com `evidence`, ele compara o `checked-commit` com a árvore de trabalho (só caminhos de evidência, fora de `.coxia/`): mudou, apagou ou renomeou é `stale`, com a lista dos arquivos; mudança ainda não commitada conta. **Limite:** um arquivo novo e ainda não rastreado numa pasta de evidência só conta como mudança depois de ser adicionado (`git add`) ou commitado, porque a comparação é um `git diff`, que não lista arquivo não rastreado. Um arquivo sem evidência (visão geral, skill, papel) é sempre conferido: não há o que comparar.

- Se o `checked-commit` não é antepassado do `HEAD` (um squash ou um rebase do pull request o apagou), a referência é o commit mais antigo que escreveu aquele valor no arquivo (`git log -S`): num squash, é o da mesclagem, que traz a regra e a mudança de código juntas. Se nada o acha, ou o git falha, ou passa de 5 segundos por repositório, o estado é `unverified`: **nunca "conferida"**. Um clone raso (`--depth`) ou uma história reescrita pode cair aí; a tela diz o motivo.
- O resultado é guardado por repositório, `HEAD` e arquivos de `.coxia/`; uma segunda chamada no mesmo `HEAD` custa um `rev-parse`.
- A marca chega ao agente junto com o arquivo (`[not checked: …]`), com o aviso de que a regra pode estar velha, de que ele a confirme no código antes de se apoiar nela e de que diga quando o fez.
- **A marca só sai por uma mudança aprovada que atualiza o cabeçalho.** Não há botão de "marcar como conferida": quem confere é a pessoa, pela revisão do pull request.

### A execução de documentação

Em Configurações › Documentação, **Criar a documentação** (ou **Atualizar**, quando há algo não conferido) inicia, para um repositório, uma execução própria, **sem issue** (`Run.docs`, ao lado de `Run.subject`; a issue sintetizada é `docs:<repo>`, e vale uma execução por vez por repositório). Ela parte da ponta do remoto num worktree de ramo `cycle/docs-<repo>-<AAAAMMDD>` (um segundo rascunho no mesmo dia dá `branch-exists`).

- **O fluxo** (`docs-flow`, ao lado do fluxo das issues, que não é tocado): `docs-draft` (o rascunho) → `docs-gate` (**o gate da pessoa sobre o rascunho**, que devolve ao rascunho com o motivo) → `docs-publish` (aplica o que a pessoa pediu e escreve a descrição do pull request) → espera do merge. São duas etapas que escrevem para que o push só seja proposto **depois** do gate. Não há etapa de revisão: a revisão é a do pull request, pela pessoa.
- **O agente** é o `docs-writer` ("Redator da documentação"), um agente comum do time: permissão `worktree`, sem shell e sem rastreador, autônomo (o gate e o "sim" do push são o freio), modelo `deep`. Aparece em Configurações › Time e se edita como qualquer outro. **O modelo é aplicado no primeiro clique em Criar, depois de uma confirmação** que diz o que entra (o agente e o fluxo); uma configuração que já tem um agente com esse id o mantém.
- **Onde escreve:** o agente só escreve dentro de `.coxia/` (o guarda recusa o resto, nos dois motores) e lê o worktree inteiro. **Numa execução de documentação o agente não tem porta de comando nenhuma**, qualquer que seja o `shell` dele em Configurações › Time: nenhum sandbox nem sessão do computador é aberto, porque a ferramenta de shell não passa pelo guarda de escrita. A `.coxia/` precisa ser uma pasta de verdade do repositório, não um link simbólico: com um link no lugar, a execução não começa (ou a etapa falha, se o link aparece depois). A pasta do ciclo da execução fica em `.coxia/.run/`, ignorada por um `.coxia/.gitignore` de uma linha que vai no pull request; o registro e a memória da execução não vão. Esse `.gitignore` e o `.run/` são do app: o guarda recusa o agente que tenta escrevê-los (senão uma linha apagada levaria o registro da execução para o pull request). Um arquivo de `.coxia/` que seja link simbólico não é lido nem reescrito pela verificação de texto e pelo carimbo; a conversa da execução o diz.
- **A importação:** o rascunho lê o `CLAUDE.md` e o `.claude/` **do próprio repositório** e importa o que é fato do projeto (arquitetura, regras de domínio, comandos de construir e testar); deixa de fora o que é regra de uma sessão ou de outro sistema (quem faz push, papéis de subagente, procedimentos de merge, identidade de commit de uma ferramenta). O que ficou de fora vai para `IMPORT_NOTES.md`, com o motivo de cada item, e a descrição do pull request o lista, para a pessoa poder discordar. **Notas do Claude Code guardadas acima do repositório** (numa pasta que reúne vários) **não são importadas**: o agente só lê dentro do worktree.
- **O pull request** tem o modelo `docs-pr` (o que isto acrescenta, o que veio do Claude Code, o que ficou de fora e por quê, o que conferir) e **não termina com `Closes #<n>`**: não fecha issue nenhuma. O push e o pull request esperam o "sim" em Ações, como os de qualquer execução; num workspace de teste são propostos e recusados na confirmação.
- **O fluxo `docs` é editável** (também por importação de configuração), mas uma execução de documentação não tem issue: o app ignora o que dependeria dela (o rótulo de status das etapas, a prioridade, o rótulo de squad, o pedido de issue a outro squad, a espera por rótulo ou por resposta, que não terminam sozinhas e se pulam pela pessoa).
- **Atualizar** é a mesma execução com `mode: 'update'`: o resumo lista os arquivos não conferidos com o motivo, e o agente os verifica contra o código, corrige o que não é mais verdade e acrescenta o que falta.

### Mantida nas execuções comuns

Uma mudança de documentação feita no ramo de uma execução comum segue no **mesmo pull request**. A etapa que muda código recebe a seção da documentação (já escolhida pela etapa, pelo papel e pelos caminhos) e a instrução de corrigir, no mesmo ramo, uma regra que a sua mudança torna falsa, sem escrever `checked-commit` nem `checked-date`. A etapa de **revisão** recebe as regras não conferidas cuja evidência cobre código que o ramo mudou e que o ramo não atualizou: cada uma é **um achado** que não bloqueia por padrão (o revisor pode elevá-lo se verificou que a regra ficou falsa). Uma regra que já estava velha antes do ramo e que nada do ramo toca não é cobrada. Sem `.coxia/`, nada disto existe.

### O texto é conferido, e o carimbo

Quando uma etapa que muda o ramo escreve arquivos de `.coxia/`, o app, antes do commit e muito antes do push, reescreve no **corpo** de cada arquivo os caminhos locais (para um caminho do repositório ou o último nome) e mascara o que parece credencial (`[redacted]`, `[key]`, `[email]`); **nunca no cabeçalho**; **só a prosa**: blocos de código (cercas) e trechos entre crases ficam como o autor escreveu (`apiKey: string;`, `/var/log/app/app.log`), salvo uma credencial pelo formato (uma chave com prefixo conhecido, um token, um e-mail, uma cadeia opaca longa) e um caminho do próprio worktree, que são locais onde estiverem. Dentro de código, a atribuição de um literal entre aspas a um nome que parece segredo (`password = "…"`) é mascarada, mas um identificador ou um tipo (`apiKey: string`, `token = next()`) não. Uma versão fixada (`pnpm@9.0.0`, `uses: x@v4.1.1`) e um remoto ssh (`git@host:org/repo.git`) não são tomados por e-mail, em código nem em prosa; um e-mail de verdade em prosa continua mascarado. Não recusa nada: a revisão da pessoa no pull request é o gate. A conversa da execução diz, arquivo por arquivo, quantos caminhos e credenciais foram reescritos, e um arquivo cujo cabeçalho ficou inválido também é dito. Depois do commit da passada, o app escreve `checked-commit` (o hash de 40 caracteres desse commit) e `checked-date` (hoje, em UTC) **só nos arquivos que a passada mexeu**, num segundo commit de assunto "update the documentation check", com a mesma identidade. Como o app, e não o agente, escreve o commit, a regra de `git log -S` acima resolve os três modos de mesclar o pull request.

### Configurações › Documentação

Só no desktop: um navegador pareado não a vê, e os canais `docs:status` e `docs:start` lhe são negados. Por repositório, mostra se `.coxia/` existe (senão, "não há documentação padrão" e **Criar a documentação**), quantas regras, skills e papéis, a visão geral, os arquivos **não conferidos** com o motivo, a data e o commit curto do cabeçalho, os arquivos não lidos, o commit e a data do `HEAD` lido, se há uma execução de documentação em andamento, e um aviso de que o `CLAUDE.md` e o `.claude/` do repositório são do Claude Code e os agentes do app não os leem. Abaixo, as **fontes extras** (as mesmas listas do assistente inicial, no mesmo componente). A leitura é do checkout de cada repositório: depois de mesclar um rascunho, atualize o checkout (o app não faz `pull`).

### Não verificado

- **O padrão do SDK sobre `CLAUDE.md`, `.claude/` e memória automática vem só dos tipos** do SDK instalado; nenhuma execução real o confirmou. Se não carregava, a mudança é inócua para o SDK; se `settingSources: []` não cobrir a memória automática, ela passa. A verificação à mão (uma menção com um arquivo-marca, antes e depois) está no plano de teste da issue.
- O `git log -S` num histórico que passou por squash, por rebase e por merge só foi exercitado com repositórios temporários; um clone raso ou uma história reescrita dá `unverified`.
- Como a tela de Ações mostra o push e o pull request de uma execução sem issue (sem "#0") só foi lido, não visto.
- O orçamento reduzido pela janela de contexto não foi medido com um modelo pequeno de verdade.
- Um modelo real pode classificar errado o que é fato do projeto e o que é regra de sessão ao importar; a lista de "o que ficou de fora" e a revisão do pull request são o freio.

---

## English

Each repository can have a **`.coxia/`** folder at its root: the project documentation the agents of the app read, kept with the code and reviewed in a pull request like it. It says what the project is and how it is built and tested, the rules of each domain (each with the evidence it rests on), the procedures an agent follows and notes per role of the team. A workspace with several repositories has one per repository; there is no new list to configure, the folder is found by convention. This page is the home of the format and the behavior; the other documents point here.

Claude Code stays the owner of `.claude/` and `CLAUDE.md`: the app **only reads them**, to import what is a fact of the project, and never writes to them.

### The format

```
.coxia/
  README.md          the overview: what the project is, how it is built and tested (every agent gets it)
  rules/<id>.md      a domain rule: the rule, why, the evidence and the tests that guard it
  skills/<id>.md     a procedure an agent follows
  roles/<id>.md      notes for a role of the team (`<id>` is the id of the agent)
```

`<id>` follows the id pattern of the rest of the configuration (`^[a-z0-9][a-z0-9_-]{0,47}$`). One level only: `rules/a/b.md` is not read. The kind of a file comes from its path, never from its content. `.coxia/.run/` and `.coxia/.gitignore` are the app's own and are left out of the count; any other file shows in Settings › Documentation as "not read" and nothing more.

Every file opens with a **header** between two `---` lines, in a subset of YAML the app reads by itself (`key: value`, and lists inline or in a block; the app has no YAML dependency):

```markdown
---
checked-commit: 3f9a1c2
checked-date: 2026-10-06
evidence: [src/billing/invoice.ts:40-88, src/billing/tax/]
stages: [review, development]
roles: [reviewer]
summary: How an invoice total is computed and rounded
---

# Invoice totals
...
```

| Field | Value | Required |
|---|---|---|
| `checked-commit` | hexadecimal, 7 to 40 characters: the commit the file was checked against | yes, in every file |
| `checked-date` | `YYYY-MM-DD` | yes, in every file |
| `evidence` | paths relative to the repository root, each with an optional `:line` or `:line-line`; a trailing `/` means the whole folder | the key is required in `rules/`, with a non-empty list; optional elsewhere |
| `stages` | ids of stages **or** kinds of stages (`development`, `review`, `qa`…) the file is meant for | no |
| `roles` | ids of agents of the team the file is meant for | no |
| `summary` | one line, up to 160 characters, shown in the index | no (recommended) |

An unknown key is kept and ignored (a newer app can add fields). An absolute path, a `..` or a `~` in `evidence` makes the header invalid: evidence belongs to the repository, and this keeps a local path out of a versioned file. Globs do not exist.

A file with no valid header is not dropped and not trusted: it is **invalid** (`no-header`, `bad-commit`, `bad-date`, `no-evidence` or `bad-evidence`), counts as **not checked**, and always reaches the agent marked (only the `README.md` and the `roles/<id of the agent>.md` go whole; the others appear in the index only).

**The app writes `checked-commit` and `checked-date`**, not the agent: the agent does not know the commit that is yet to exist (see [the stamp](#the-text-is-checked-and-the-stamp)). **A commit hash belongs in the header only:** in the body, any long string with a letter and a digit is masked as a credential by the text check, and the hash would become `[redacted]`.

### What the agents read, and what they stop reading

- **The agents of the team** (a stage of a run, a mention, a question of the chain, a request between squads, the documentation run) read the `.coxia/` of the repositories they work in, the **extra sources** the person listed in `docs` on purpose (`claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`) and the `.mcp.json` of each project. **Nothing of Claude Code reaches them**: neither the `CLAUDE.md` and `.claude/` of the project nor those of the person's `~/.claude`.
  - On the **Claude Agent SDK engine** the call carries `settingSources: []` and `settings: { autoMemoryEnabled: false }`: Claude Code does not load `CLAUDE.md`, `.claude/`, the `settings.json` files or the automatic memory on its own. What the app used from those settings it passes explicitly (permissions, tools, hooks, model, environment and MCP). A company's managed policy still applies, since `[]` does not turn it off.
  - On the **open engine** the reading of `CLAUDE.md` up the tree and of `.claude/` in the `cwd` and the home folder (`defaultDocSources`) does not happen: the call carries explicit lists, empty when there is nothing.
  - **`autoDetect` changed meaning, not format:** it is still a `boolean` in the same place, and `CONFIG_SCHEMA_VERSION` stays 13 (no migration step: the file of an existing workspace is valid before and after). It now applies to the **ceremonies** (it adds `~/.claude`, `<project>/.claude` and `CLAUDE.md`) and, for every agent, it adds the `.mcp.json` of each project. The lists the person already filled in still count; in Settings › Documentation the ones that point at Claude Code files carry a "from Claude Code" badge.
- **The ceremonies stay as they are.** The five system agents (`turn`, `reply`, `deep`, `teams`, `fix`) **still read Claude Code's files**, as always, and do not start reading `.coxia/` because of this change. It is a choice of scope (the specification left the ceremonies out), and they use the issue MCP server, which only they have. Isolating them too is an issue of its own.
- **What is lost.** With `settingSources: []`, the skills and subagents of `~/.claude` and `<project>/.claude` are **no longer found by the SDK's `Skill` and `Agent` tools** in the agents of the team. The `skills/` of `.coxia/` replace them, as text the agent reads; the `tools.skills` switch still exists and only stops finding skills on the SDK path.

### What each agent receives

The app builds **one text**, appended to the system text, the same on both engines (the files stay readable, so the agent can go deeper with `Read`). The caller says the repository, the stage and the paths the work touches; for a run, the paths are the ones the branch already changed plus the ones the text of the spec and the plan cites.

- **The overview (`README.md`) always goes**, up to 40% of the budget.
- A file of `rules/`, `skills/` or `roles/` is **chosen** when its `stages` holds the id or the kind of the stage, or its `roles` holds the id of the agent (`roles/<id>.md` counts by name), or an `evidence` entry covers a path the work touches. The files not chosen go into an **index** (name and `summary`).
- **Budget per call: 24,000 characters** (about 6 thousand tokens), **reduced by the context window** when the provider declares it: `min(24,000, 3 × window × 0.15)`, with a floor of 3,000. In priority order: the notes of the agent's role, the rules covering most paths, those chosen by stage, the skills. A file that does not fit whole goes cut, with a note of the cut, if 600 characters fit; what did not fit becomes a "did not fit" line with the names. **Nothing is cut in silence.** **The number is that of the whole text delivered**: the head, the "not checked" marks, the index and the "did not fit" line count, and the share of the files is lowered until the total fits (the selection estimates what each part costs, and the real length decides). Several repositories in one conversation share the budget. The number shows in Settings › Documentation.
- **A repository without `.coxia/`: no new text**, not even a "there is no documentation" line. Nothing stops it from running: the agent works from the code and the extra sources, and the screen says the documentation does not exist.

### "Not checked"

The app cannot know whether a rule is still true; it can know whether a file the rule cites **changed since the commit it was checked against**. For each file with `evidence` it compares the `checked-commit` with the working tree (evidence paths only, outside `.coxia/`): changed, deleted or renamed is `stale`, with the list of files; a change not yet committed counts. **Limit:** a new file that is not tracked yet, in an evidence folder, only counts as a change once it is added (`git add`) or committed, because the comparison is a `git diff`, which does not list an untracked file. A file with no evidence (overview, skill, role) is always checked: there is nothing to compare.

- If the `checked-commit` is not an ancestor of `HEAD` (a squash or a rebase of the pull request removed it), the reference is the earliest commit that wrote that value into the file (`git log -S`): after a squash, that is the merge commit, which holds the rule and the code change together. If nothing finds it, or git fails, or a repository takes more than 5 seconds, the state is `unverified`: **never "checked"**. A shallow clone (`--depth`) or a rewritten history can land there; the screen says why.
- The result is cached by repository, `HEAD` and the files of `.coxia/`; a second call on the same `HEAD` costs a `rev-parse`.
- The mark reaches the agent with the file (`[not checked: …]`), with a note that the rule may be out of date, that it should confirm it against the code before relying on it, and say when it did.
- **The mark only goes away through an approved change that updates the header.** There is no "mark as checked" button: the person checks, by reviewing the pull request.

### The documentation run

In Settings › Documentation, **Create the documentation** (or **Update**, when something is not checked) starts, for one repository, a run of its own, **with no issue** (`Run.docs`, next to `Run.subject`; the synthesized issue is `docs:<repo>`, and one run at a time per repository). It starts from the tip of the remote in a worktree on the branch `cycle/docs-<repo>-<YYYYMMDD>` (a second draft on the same day gets `branch-exists`).

- **The flow** (`docs-flow`, next to the flow of the issues, which is not touched): `docs-draft` (the draft) → `docs-gate` (**the person's gate over the draft**, which returns to the draft with the reason) → `docs-publish` (applies what the person asked and writes the pull request description) → wait for the merge. There are two stages that write so that the push is only proposed **after** the gate. There is no review stage: the review is the pull request's, by the person.
- **The agent** is `docs-writer` ("Documentation writer"), a normal agent of the team: `worktree` permission, no shell and no tracker, autonomous (the gate and the "yes" of the push are the brake), `deep` model. It shows in Settings › Team and is edited like any other. **The template is applied on the first click on Create, after a confirmation** that says what enters (the agent and the flow); a configuration that already has an agent with that id keeps it.
- **Where it writes:** the agent writes only inside `.coxia/` (the guard refuses the rest, on both engines) and reads the whole worktree. **In a documentation run the agent has no command door at all**, whatever its `shell` says in Settings › Team: no sandbox and no session on the computer is opened, because the shell tool does not pass the guard of the writes. `.coxia/` must be a real folder of the repository, not a symbolic link: with a link in its place the run does not start (or the stage fails, if the link appears later). The run's cycle folder lives in `.coxia/.run/`, ignored by a one-line `.coxia/.gitignore` that goes in the pull request; the run's record and memory do not. That `.gitignore` and `.run/` belong to the app: the guard refuses an agent that tries to write them (a deleted line would put the run's record in the pull request). A file of `.coxia/` that is a symbolic link is neither read nor rewritten by the text check and the stamp; the run's thread says so.
- **The import:** the draft reads the `CLAUDE.md` and `.claude/` **of the repository itself** and imports what is a fact of the project (architecture, domain rules, build and test commands); it leaves out what is a rule of a session or of another system (who pushes, subagent roles, merge procedures, a tool's commit identity). What was left out goes into `IMPORT_NOTES.md`, with the reason for each item, and the pull request description lists it, so the person can disagree. **Claude Code notes kept above the repository** (in a folder that holds several) **are not imported**: the agent only reads inside the worktree.
- **The pull request** uses the `docs-pr` template (what this adds, what came from Claude Code, what was left out and why, what to check) and **does not end with `Closes #<n>`**: it closes no issue. The push and the pull request wait for the "yes" in Actions like any run's; in a test workspace they are proposed and refused at confirmation.
- **The `docs` flow is editable** (by importing a configuration too), but a documentation run has no issue: the app ignores what would depend on one (the status label of the stages, the priority, the squad label, the request for an issue to another squad, the wait for a label or a reply, which never end by themselves and are skipped by the person).
- **Update** is the same run with `mode: 'update'`: the summary lists the files not checked with the reason, and the agent verifies them against the code, corrects what is no longer true and adds what is missing.

### Kept in ordinary runs

A documentation change made on the branch of an ordinary run goes in the **same pull request**. The stage that changes code receives the documentation section (already chosen by stage, role and paths) and the instruction to correct, on the same branch, a rule its change makes false, without writing `checked-commit` or `checked-date`. The **review** stage receives the rules that are not checked, whose evidence covers code the branch changed and that the branch did not update: each is **one finding**, not blocking by default (the reviewer may raise it if it checked that the rule became false). A rule that was already out of date before the branch and that nothing of the branch touches is not charged to it. Without `.coxia/` none of this exists.

### The text is checked, and the stamp

When a stage that changes the branch writes files of `.coxia/`, the app, before the commit and long before the push, rewrites in the **body** of each file the local paths (to a path of the repository or the last name) and masks what looks like a credential (`[redacted]`, `[key]`, `[email]`); **never in the header**; **prose only**: code blocks (fences) and spans between backticks stay as the author wrote them (`apiKey: string;`, `/var/log/app/app.log`), except for a credential by its shape (a key with a known prefix, a token, an email, a long opaque string) and a path of the worktree itself, which are local wherever they stand. Inside code, the assignment of a quoted literal to a name that looks like a secret (`password = "…"`) is masked, an identifier or a type (`apiKey: string`, `token = next()`) is not. A pinned version (`pnpm@9.0.0`, `uses: x@v4.1.1`) and an ssh remote (`git@host:org/repo.git`) are not taken for an email, in code or in prose; a real email in prose is still masked. It refuses nothing: the person's review of the pull request is the gate. The run's thread says, file by file, how many paths and credentials were rewritten, and a file whose header became invalid is said too. After the pass's commit, the app writes `checked-commit` (the 40-character hash of that commit) and `checked-date` (today, UTC) **only in the files the pass touched**, in a second commit with the subject "update the documentation check", under the same identity. Since the app, not the agent, writes the commit, the `git log -S` rule above resolves all three ways of merging the pull request.

### Settings › Documentation

Desktop only: a paired browser does not see it, and the `docs:status` and `docs:start` channels are refused to it. Per repository it shows whether `.coxia/` exists (if not, "no standard documentation" and **Create the documentation**), how many rules, skills and roles, the overview, the files **not checked** with the reason, the date and short commit of the header, the files not read, the commit and date of the `HEAD` read, whether a documentation run is going, and a warning that the repository's `CLAUDE.md` and `.claude/` are Claude Code's and the agents of the app do not read them. Below, the **extra sources** (the same lists as the setup wizard, in the same component). It reads the checkout of each repository: after a draft is merged, update the checkout (the app does not `pull`).

### Not verified

- **The SDK's default about `CLAUDE.md`, `.claude/` and the automatic memory comes only from the types** of the installed SDK; no real run confirmed it. If it did not load them, the change is inert for the SDK; if `settingSources: []` does not cover the automatic memory, it gets through. The check by hand (a mention with a marker file, before and after) is in the issue's test plan.
- `git log -S` on a history that went through squash, rebase and merge was only exercised with temporary repositories; a shallow clone or a rewritten history gives `unverified`.
- How the Actions screen shows the push and the pull request of a run with no issue (no "#0") was only read, not seen.
- The budget reduced by the context window was not measured with a real small model.
- A real model may misclassify what is a fact of the project and what is a session rule when importing; the "what was left out" list and the review of the pull request are the brake.
