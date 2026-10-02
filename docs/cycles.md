# Ciclos de desenvolvimento / Development cycles

[Português](#português) | [English](#english)

---

## Português

O Coxia deixou de assumir um processo só. O que as cerimônias fazem (quais existem, como o cartão se chama em cada etapa, onde ficam os documentos, o que os agentes dizem) vem do **ciclo** do workspace: a seção `devCycle` do `WorkspaceConfig` ([`configuration.md`](configuration.md)). Um **modelo de ciclo** (`CycleTemplate`, `src/shared/cycles/`) é essa seção com um nome. Escolher um modelo no assistente, ou em `cycle:apply`, reescreve `devCycle` e mais nada.

### O que um ciclo define

| Campo de `devCycle` | O que decide |
|---|---|
| `templateId` | de qual modelo veio (informativo depois de editado) |
| `ceremonies` | liga ou desliga cada cerimônia: `preDaily`, `unblock`, `gate`, `qaHandoff`, `retro`, `releaseConflicts` |
| `ceremonyParams` | parâmetros de cada uma: nome do time para a preparação do dia (`label`), palavras da fala, leituras do spec, para onde vai o resumo (`summaryTarget`) e como é escrito (`summaryStyle`); número de perguntas e tipos do quiz do gate; dias da janela da retro |
| `stages` | o vocabulário de etapas: `id`, `label`, `match` (expressões regulares), `kind` (`backlog`, `development`, `review`, `reviewApproved`, `qa`, `qaApproved`, `returned`, `done`, `blocked`), `rank` |
| `stageMapping` | regras que ligam o que o provedor informa a uma etapa: `{ provider, source, name, pattern, stage }`; `source` é `label`, `status`, `field` (campo de quadro, ex.: `Status` do GitHub Projects), `state` ou `column`. A primeira regra que casa vence; o que sobra cai nos `match` das etapas |
| `meanings` | o que é "bloqueio" (`stageKinds` + texto), "pergunta para mim" (liga/desliga + texto) e "pronto para o QA" (`stageKinds`, `requiresSpec`, texto) |
| `enrichment` | o que o agente recebe de cada cartão: `specFolder` (procura a pasta da issue), `cardFields` (quais campos do cartão), `extraFiles` (documentos que o cartão cita quando existem) |
| `specLayout` | onde ficam os documentos: `folderPrefix`, `phaseFiles` (o arquivo que mais avançou diz a fase), `planFiles`, `gateFiles` (artefato de cada gate), `decisionLog.heading` (a seção do plano onde as decisões vão; vazio: nunca escreve no plano), `documents` |
| `prompts` | a família de texto de cada papel (`turn`, `reply`, `deep`, `teams`, `gate`, `qa`, `retro`, `conflict`) |
| `promptOverrides` | troca um único texto por id e idioma (ver abaixo) |
| `pipelineSkill`, `releaseLabelPattern`, `qa.user` | a skill que descreve o pipeline do time, a label de versão e a conta de QA: tudo opcional |

Um texto do ciclo (rótulo, nome, estilo) é uma **chave do catálogo** (`cycle.sdd.name`) ou um **texto literal** na língua do time. O app tenta o catálogo e, se a chave não existe, usa o texto como está.

### Os modelos que vêm no app

| Modelo (`id`) | Cerimônias ligadas | Etapas | Documentos |
|---|---|---|---|
| SDD, gates e QA (`sdd`) | todas: pré-daily, desbloqueio, gate, passagem ao QA, retro, conflitos de release | Backlog, Doing, Blocked, Rejected, Code Review, Code Review OK, Ready To Test, Test Fail, Test OK, Done | pasta por issue (`#<n>-`), `0_BUG_REPORT.md` … `ISSUE_COMPLETION.md`, `GATE_QUIZ.md`, `QA_CHECKLIST.md`, seção "Registro" do plano |
| Scrum (`scrum`) | daily scrum, desbloqueio, retro da sprint (14 dias) | Backlog, To Do, In Progress, Blocked, In Review, Testing, Done | nenhum |
| Kanban (`kanban`) | standup, desbloqueio, retro de fluxo | Backlog, Ready, In Progress, Blocked, Review, Done | nenhum |
| GitHub Flow simples (`github-flow`) | standup, desbloqueio | Open, In progress, Blocked, In review, Changes requested, Approved, Merged | nenhum |
| Mínimo (`minimal`) | pré-daily e desbloqueio | To do, Doing, Blocked, Done | nenhum |

Todos produzem um app útil sem arquivo de spec: os cartões vêm do provedor de VCS (ou da fonte de cartões), e as etapas são lidas por `stageMapping`. O SDD é o comportamento que o app já tinha, sem empresa: a conta de QA, o prefixo das issues, as skills do playbook e a ferramenta de release vêm de campos da configuração, preenchidos pelo perfil migrado (`legacy.ts`).

A disponibilidade final de uma cerimônia é "ligada no ciclo **e** com o que ela precisa": o gate exige a pasta de specs e artefatos nomeados; a passagem ao QA exige a pasta de specs.

### Prompts e idiomas

Cada texto que o app manda a um agente vive nos catálogos (`src/shared/i18n/pt-BR.json` e `en.json`) com a chave `prompt.<família>.<id>`; `<id>` é `<cabeça>.<nome>` (`turn.main`, `gate.rules`, `qa.skillsLine`…). A família `sdd` é completa; `scrum` e `kanban` só trazem o que muda (a retro). Um texto que a família do papel não tem cai no `sdd`. `promptOverrides[id][idioma]` troca um texto (inclusive por vazio). Com a voz desligada (`voice.enabled: false`) o app procura antes a chave com o sufixo `.novoice` (as regras de fala, o preâmbulo e o capítulo de chat dizem "a voz está desligada" em vez de "para ser ouvida"), e os marcadores `{mode}` ("por voz" / "em texto"), `{heard}` ("transcrição por voz" / "texto digitado"), `{call}` ("Call" / "Conversa") e `{answered}` tomam a palavra do modo.

Marcadores de lugar: `{theUser}` ("o Bruno", "a Ana", "Bruno", "o usuário"), `{ofUser}`, `{toUser}`, `{he}`, `{him}`, `{his}`, `{TheUser}`, `{userName}` (o nome puro), `{vcsName}`, `{ceremony}` (como o time chama a preparação), `{mode}`, `{heard}`, `{call}`, `{answered}`, `{qaMention}`, `{speechRules}`, `{chatRules}`, `{optionsRule}` e os de cada texto. O nome vem de `userName`; o artigo português (`userArticle`: `o`, `a` ou vazio) só existe porque "o Bruno" e "a Ana" não se escrevem igual: vazio usa o nome sozinho ("de Ana"), que serve para qualquer nome. Sem nome: "o usuário" / "the user". Uma linha que é só um marcador, com valor vazio, some (é assim que uma frase opcional fica de fora).

Quem classifica sessões do app (custo e retenção) lê o começo de cada prompt **dos catálogos** (`openersOf`), então um prompt traduzido ou com outro nome continua reconhecido.

### Trocar de modelo, exportar, importar, criar o seu

- **Aplicar:** assistente (passo Ciclo), ou `cycle:apply(id, { keepQaUser, keepReleaseLabelPattern })`. A conta de QA do workspace é mantida por padrão.
- **A configuração do workspace já leva o ciclo.** Exportar e importar o workspace (`config:export`/`config:import-*`, ver [`configuration.md`](configuration.md)) leva `devCycle` inteiro, inclusive as trocas de prompt.
- **Um modelo é um arquivo.** `cycle:template-export({ id, name, description })` devolve o texto de um arquivo `{ format: "coxia-cycle-template", formatVersion: 1, exportedAt, template: { id, name, description, needs, devCycle } }` com o ciclo atual (sem a conta de QA e sem o que o ciclo neutro já diz). `cycle:template-check(texto)` valida sem gravar (os problemas vêm com o caminho dentro do arquivo); `cycle:template-save(texto)` grava em `<dados>/cycle-templates/<id>.json` e o modelo passa a aparecer na lista; `cycle:template-remove(id)` apaga. Um arquivo não pode ter o id de um modelo que vem no app.
- **Criar o seu:** (1) escolha o modelo mais próximo e ajuste no app (ou edite `config.json`); (2) exporte com um `id` seu; (3) para os textos que sejam seus, use literais na língua do time ou, para valer nos dois idiomas, `promptOverrides` com `pt-BR` e `en`; (4) `stageMapping` com uma regra por estado que o provedor tem; (5) confira com `cycle:template-check`.

### Canais

| Canal | O que faz | Web |
|---|---|---|
| `cycle:view` | o que as telas precisam: cerimônias oferecidas, etapas, rótulo, nome, destinos das decisões | permitido |
| `cycle:templates` | modelos do app e importados, no idioma do workspace | permitido |
| `cycle:template-export`, `cycle:template-check` | texto de um modelo; valida um texto | permitido |
| `cycle:apply`, `cycle:template-save`, `cycle:template-remove`, `cycle:template-pick` | muda a configuração ou toca arquivo | só desktop |
| `agents:propose` | docs propostos para uma varredura | permitido |
| `agents:scan`, `agents:apply`, `agents:summarize` | lê pastas, grava os docs, chama o modelo | só desktop |
| `agents:can-summarize` | há provedor com chave para o resumo? | permitido |

### Preparar agentes (a varredura)

`prepareAgents(config, { home })` (`src/main/cycles.ts`, o assistente chama) olha os projetos do workspace (repos listados, raízes que têm contexto, repositórios git diretamente sob uma raiz com `autoDiscover`) e `~/.claude`. Por projeto: `CLAUDE.md`, `.claude/skills` (só pasta com `SKILL.md`), `rules`, `agents`, `commands`, bases de conhecimento (`.claude/knowledge-base`, `knowledge-base`, `knowledge`), `docs/` (só avisado), `.mcp.json` (**só os nomes dos servidores**), pasta de specs (`.specs`, `specs`, `docs/specs`) e a stack pelos manifestos (`package.json`, `composer.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`…). Nunca abre `.env`, chaves, `settings.json` nem `~/.claude.json`. Segue links simbólicos.

Devolve `{ docs, notes, projects }`: `docs` é a seção `docs` proposta (caminhos com `~/`), `notes` o que ficou de fora e por quê, e `projects[]` um resumo curto por projeto, **sem modelo**, montado do propósito (primeiro parágrafo do `CLAUDE.md` ou do README), da stack e da contagem do contexto. O núcleo (`agentPrep-core.ts`: `scanWorkspace`, `proposeDocs`, `applyDocs`) é puro e testado com árvores de pastas de teste. `agents:summarize` faz **uma** chamada barata (papel `teams`) com os fatos da varredura (nunca o texto de arquivos) e preenche `modelSummary`; só roda quando `canSummarize()` (o provedor tem chave nesta máquina).

### Configuração por papel de agente

`agents.roles[papel]` (`turn`, `reply`, `deep`, `teams`, `fix`) tem: `modelRole`, `extraInstructions`, `promptOverride` (troca o preâmbulo), `persona` (tom, depois da persona geral `agents.persona`), `maxTurns` (limite de cada chamada do papel; `null`: cada chamada fica com o seu) e `docs` (`claudeMd`, `skills`, `rules`, `agents`, `knowledge`, `mcp`: quais fontes de `docs` o papel pode ler).

### Paridade com o comportamento de hoje

O perfil de uma instalação anterior (o arquivo de `COXIA_LEGACY_PROFILE`, veja [`configuration.md`](configuration.md)) é o modelo SDD mais as especificidades da equipe; o exemplo fictício [`examples/legacy-profile.example.json`](examples/legacy-profile.example.json) tem nome "Bruno", artigo "o", resumo para o chat do time, uma conta de QA, uma skill de pipeline, um padrão de versão e 12 trocas de texto em `promptOverrides` para as frases que citam o playbook e as skills. Um `config.json` v2 de antes dos modelos é completado com os padrões neutros.

Prova (regressão de prompts): `test/cycle-parity.test.ts` (voz ligada) e `test/cycle-parity-novoice.test.ts` (voz desligada) rodam cada cerimônia (turno, resposta, desbloqueio, resumo, comentário de release, conflito, gate com as cinco etapas, passagem ao QA, retro, reentrada, discussão) contra um motor de mentira e um provedor de VCS de mentira, e comparam cada prompt, o prompt de sistema, o limite de passos e os arquivos escritos (`GATE_QUIZ.md`, `QA_CHECKLIST.md`, o Registro do plano) com `test/golden/legacy-prompts.json` e `legacy-prompts-novoice.json`. Os arquivos foram capturados do código de antes dos modelos e depois passaram para os dados fictícios do perfil de exemplo (organização `acme`, repositório `acme/web`, pessoas Ana e Bruno); para mudar um prompt de propósito, rode com `UPDATE_GOLDEN=1` e revise o diff. Por haver um vocabulário de etapas: um cartão em estágio `In Testing` ou `Approved in code review` conta como "perto do QA" na ordem da lista; `Done` não conta como estágio concluído no alerta de reprovações do perfil migrado (que não tem etapa `done`); `Failed testing` conta como "depois dos gates".

### Mais de uma conversa no mesmo dia

Cada pré-daily do dia é uma **versão** da ata do dia: `<data>-pre-daily.v<N>.md`, mais o índice `<data>-pre-daily.versions.json` (números, o que cada versão decidiu e gravou). `<data>-pre-daily.md` continua existindo, gerado, com todas as versões. Dias gravados antes disso são separados em versões na primeira leitura; o arquivo antigo fica ao lado como `.legacy.md`. A tela da ata mostra "versão N de hoje", o que mudou desde a versão anterior e o dia inteiro (vale a decisão mais recente de cada atividade); uma decisão já gravada no Registro ou na nota do cartão por uma versão anterior não é gravada de novo.

Uma atividade já tratada hoje é comparada com o que a conversa anterior viu (etapa, MRs, bloqueios, pendências, notas, arquivos do spec; o que o próprio app gravou depois não conta). Sem mudança: turno curto montado a partir do anterior, sem chamar o agente (`turn.sameDay*` e `sameDay.*` nos catálogos). Com mudança: o prompt traz o que mudou, o que foi dito, respondido e decidido. Isso vem antes do reaproveitamento de falas de dias anteriores (`falas.json`).

Excluir uma ata (uma versão ou o dia) move arquivos e registro da cerimônia para `<workspace>/.trash/atas/<carimbo>/`; dá para restaurar na Lixeira do Histórico por 30 dias, depois a rotina de retenção apaga. O que já foi gravado em spec, nota ou fila de efeitos continua onde está. Não dá para excluir a versão de uma call em andamento.

### Não verificado

- Nenhum modelo de verdade foi chamado na verificação: os prompts foram conferidos com um motor de mentira.
- As regras de `stageMapping` para GitHub (campo `Status` do Projects v2), Bitbucket e GitLab foram escritas pela documentação dos provedores e testadas com entradas escritas à mão, sem conta nos serviços. Os cartões dos provedores já usam as regras (`stageOf` em `main/vcs/stages.ts` chama `mapStageByRules` antes dos padrões das etapas e dos padrões do host); um campo de quadro do GitHub Projects (`field`) ainda não chega ao provedor, que só entrega rótulos, status e estado de issues (`StageInput` em `cycles/types.ts`).
- O texto em inglês dos prompts foi escrito por tradução; a qualidade das respostas dos modelos com eles não foi medida.
- Telas além de Hoje (Gate, Passagem ao QA, Retro, Ações) não escondem a si mesmas: a entrada é que some. Quem abrir uma delas por uma notificação antiga ainda a vê.

---

## English

Coxia no longer assumes a single process. What the ceremonies do (which ones exist, what a card's stage is called, where the documents live, what the agents say) comes from the workspace's **cycle**: the `devCycle` section of `WorkspaceConfig` ([`configuration.md`](configuration.md)). A **cycle template** (`CycleTemplate`, `src/shared/cycles/`) is that section with a name. Choosing a template in the wizard, or `cycle:apply`, rewrites `devCycle` and nothing else.

### What a cycle defines

| `devCycle` field | What it decides |
|---|---|
| `templateId` | which template it came from (informational once edited) |
| `ceremonies` | switches each ceremony: `preDaily`, `unblock`, `gate`, `qaHandoff`, `retro`, `releaseConflicts` |
| `ceremonyParams` | each one's parameters: what the team calls the daily preparation (`label`), words of the speech, spec reads, where the summary goes (`summaryTarget`) and how it is written (`summaryStyle`); the gate quiz's question count and kinds; the retro's window in days |
| `stages` | the stage vocabulary: `id`, `label`, `match` (regular expressions), `kind` (`backlog`, `development`, `review`, `reviewApproved`, `qa`, `qaApproved`, `returned`, `done`, `blocked`), `rank` |
| `stageMapping` | rules that tie what a provider reports to a stage: `{ provider, source, name, pattern, stage }`; `source` is `label`, `status`, `field` (a board field, e.g. GitHub Projects' `Status`), `state` or `column`. The first matching rule wins; what is left falls to the stages' `match` patterns |
| `meanings` | what a "blocker" is (`stageKinds` + text), a "question for me" (on/off + text) and "ready for QA" (`stageKinds`, `requiresSpec`, text) |
| `enrichment` | what the agent gets about each card: `specFolder` (looks up the issue folder), `cardFields` (which card fields), `extraFiles` (documents the card names when they exist) |
| `specLayout` | where the documents live: `folderPrefix`, `phaseFiles` (the most advanced file present says the phase), `planFiles`, `gateFiles` (each gate's artifact), `decisionLog.heading` (the plan section decisions go to; empty: never written to the plan), `documents` |
| `prompts` | the text family of each role (`turn`, `reply`, `deep`, `teams`, `gate`, `qa`, `retro`, `conflict`) |
| `promptOverrides` | replaces one text by id and language (see below) |
| `pipelineSkill`, `releaseLabelPattern`, `qa.user` | the skill that describes the team's pipeline, the version label and the QA account: all optional |

A text of the cycle (label, name, style) is a **catalog key** (`cycle.sdd.name`) or a **literal** in the team's language. The app tries the catalog and, when the key does not exist, uses the text as it is.

### The templates that ship with the app

| Template (`id`) | Ceremonies on | Stages | Documents |
|---|---|---|---|
| SDD, gates and QA (`sdd`) | all: pre-daily, unblock, gate, QA hand-off, retro, release conflicts | Backlog, Doing, Blocked, Rejected, Code Review, Code Review OK, Ready To Test, Test Fail, Test OK, Done | a folder per issue (`#<n>-`), `0_BUG_REPORT.md` … `ISSUE_COMPLETION.md`, `GATE_QUIZ.md`, `QA_CHECKLIST.md`, the plan's decision log section |
| Scrum (`scrum`) | daily scrum, unblock, sprint retro (14 days) | Backlog, To Do, In Progress, Blocked, In Review, Testing, Done | none |
| Kanban (`kanban`) | standup, unblock, flow retro | Backlog, Ready, In Progress, Blocked, Review, Done | none |
| Simple GitHub Flow (`github-flow`) | standup, unblock | Open, In progress, Blocked, In review, Changes requested, Approved, Merged | none |
| Minimal (`minimal`) | pre-daily and unblock | To do, Doing, Blocked, Done | none |

All of them produce a useful app without a spec file: cards come from the VCS provider (or the card source), and stages are read through `stageMapping`. SDD is the behavior the app already had, with the company left out: the QA account, the issue prefix, the playbook skills and the release tool come from configuration fields, filled by the migrated profile (`legacy.ts`).

The final availability of a ceremony is "on in the cycle **and** with what it needs": the gate needs the specs folder and named artifacts; the QA hand-off needs the specs folder.

### Prompts and languages

Every text the app sends an agent lives in the catalogs (`src/shared/i18n/pt-BR.json` and `en.json`) under `prompt.<family>.<id>`; `<id>` is `<head>.<name>` (`turn.main`, `gate.rules`, `qa.skillsLine`…). The `sdd` family is complete; `scrum` and `kanban` only carry what differs (the retro). A text the role's family lacks falls to `sdd`. `promptOverrides[id][language]` replaces a text (even with an empty one). With voice off (`voice.enabled: false`) the app looks first for the key with the `.novoice` suffix (the speech rules, the preamble and the chat chapter say "voice is off" instead of "to be heard"), and the placeholders `{mode}` ("by voice" / "in text"), `{heard}` ("voice transcript" / "typed text"), `{call}` ("Call" / "Chat") and `{answered}` take the word of the mode.

Placeholders: `{theUser}` ("o Bruno", "a Ana", "Bruno", "the user"), `{ofUser}`, `{toUser}`, `{he}`, `{him}`, `{his}`, `{TheUser}`, `{userName}` (the bare name), `{vcsName}`, `{ceremony}` (what the team calls the preparation), `{mode}`, `{heard}`, `{call}`, `{answered}`, `{qaMention}`, `{speechRules}`, `{chatRules}`, `{optionsRule}` and each text's own. The name comes from `userName`; the Portuguese article (`userArticle`: `o`, `a` or empty) exists only because "o Bruno" and "a Ana" are not written alike: empty uses the bare name ("de Ana"), which suits any name. With no name: "o usuário" / "the user". A line that is only a placeholder with an empty value disappears (that is how an optional sentence is left out).

What classifies the app's own sessions (cost and retention) reads the start of each prompt **from the catalogs** (`openersOf`), so a translated or reworded prompt is still recognised.

### Changing template, exporting, importing, making your own

- **Apply:** the wizard (Cycle step), or `cycle:apply(id, { keepQaUser, keepReleaseLabelPattern })`. The workspace's QA account is kept by default.
- **The workspace config already carries the cycle.** Exporting and importing the workspace (`config:export`/`config:import-*`, see [`configuration.md`](configuration.md)) carries all of `devCycle`, prompt replacements included.
- **A template is a file.** `cycle:template-export({ id, name, description })` returns the text of a file `{ format: "coxia-cycle-template", formatVersion: 1, exportedAt, template: { id, name, description, needs, devCycle } }` with the current cycle (without the QA account and without what the neutral cycle already says). `cycle:template-check(text)` validates without saving (problems come with their path inside the file); `cycle:template-save(text)` stores it as `<data>/cycle-templates/<id>.json` and the template shows up in the list; `cycle:template-remove(id)` deletes it. A file cannot take the id of a template that ships with the app.
- **Making your own:** (1) pick the closest template and adjust it in the app (or edit `config.json`); (2) export with an `id` of your own; (3) for texts that are yours, use literals in the team's language or, to work in both, `promptOverrides` with `pt-BR` and `en`; (4) `stageMapping` with one rule per state the provider has; (5) check with `cycle:template-check`.

### Channels

| Channel | What it does | Web |
|---|---|---|
| `cycle:view` | what the screens need: ceremonies offered, stages, label, name, decision destinations | allowed |
| `cycle:templates` | the app's and the imported templates, in the workspace language | allowed |
| `cycle:template-export`, `cycle:template-check` | the text of a template; validates a text | allowed |
| `cycle:apply`, `cycle:template-save`, `cycle:template-remove`, `cycle:template-pick` | change the configuration or touch a file | desktop only |
| `agents:propose` | docs proposed for a scan | allowed |
| `agents:scan`, `agents:apply`, `agents:summarize` | read folders, write the docs, call the model | desktop only |
| `agents:can-summarize` | is there a provider with a key for the summary? | allowed |

### Preparing agents (the scan)

`prepareAgents(config, { home })` (`src/main/cycles.ts`, called by the wizard) looks at the workspace's projects (listed repos, roots that carry context, git repos directly under a root with `autoDiscover`) and `~/.claude`. Per project: `CLAUDE.md`, `.claude/skills` (a folder counts only with a `SKILL.md`), `rules`, `agents`, `commands`, knowledge bases (`.claude/knowledge-base`, `knowledge-base`, `knowledge`), `docs/` (only mentioned), `.mcp.json` (**server names only**), a specs folder (`.specs`, `specs`, `docs/specs`) and the stack from the manifests (`package.json`, `composer.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`…). It never opens `.env`, keys, `settings.json` or `~/.claude.json`. It follows symbolic links.

It returns `{ docs, notes, projects }`: `docs` is the proposed `docs` section (paths with `~/`), `notes` what was left out and why, and `projects[]` a short summary per project, **with no model**, built from the purpose (first paragraph of `CLAUDE.md` or the README), the stack and the count of the context. The core (`agentPrep-core.ts`: `scanWorkspace`, `proposeDocs`, `applyDocs`) is pure and tested on fixture folder trees. `agents:summarize` makes **one** cheap call (role `teams`) with the scan's facts (never the text of files) and fills `modelSummary`; it only runs when `canSummarize()` (the provider has a key on this machine).

### Per-role agent configuration

`agents.roles[role]` (`turn`, `reply`, `deep`, `teams`, `fix`) has: `modelRole`, `extraInstructions`, `promptOverride` (replaces the preamble), `persona` (tone, after the shared `agents.persona`), `maxTurns` (limit of each call of the role; `null`: each call keeps its own) and `docs` (`claudeMd`, `skills`, `rules`, `agents`, `knowledge`, `mcp`: which `docs` sources the role may read).

### Parity with today's behavior

The profile of a previous install (the file `COXIA_LEGACY_PROFILE` names, see [`configuration.md`](configuration.md)) is the SDD template plus the team's specifics; the fictional example [`examples/legacy-profile.example.json`](examples/legacy-profile.example.json) has the name "Bruno", article "o", a summary for the team chat, a QA account, a pipeline skill, a version pattern and 12 text replacements in `promptOverrides` for the sentences that cite the playbook and the skills. A v2 `config.json` from before the templates is completed with the neutral defaults.

Evidence (prompt regression): `test/cycle-parity.test.ts` (voice on) and `test/cycle-parity-novoice.test.ts` (voice off) run every ceremony (turn, reply, unblock, summary, release comment, conflict, gate with its five stages, QA hand-off, retro, re-entry, discussion) against a fake engine and a fake VCS provider, and compare each prompt, the system prompt, the turn limit and the files written (`GATE_QUIZ.md`, `QA_CHECKLIST.md`, the plan's decision log) with `test/golden/legacy-prompts.json` and `legacy-prompts-novoice.json`. The files were captured from the code as it was before the templates and then carried over to the fictional data of the example profile (organization `acme`, repository `acme/web`, people Ana and Bruno); to change a prompt on purpose, run with `UPDATE_GOLDEN=1` and review the diff. Since there is a stage vocabulary: a card in stage `In Testing` or `Approved in code review` counts as "close to QA" in the list order; `Done` does not count as a finished stage in the rejections alert of the migrated profile (it has no `done` stage); `Failed testing` counts as "past the gates".

### More than one conversation on a day

Each pre-daily of the day is a **version** of that day's minutes: `<date>-pre-daily.v<N>.md`, plus the index `<date>-pre-daily.versions.json` (numbers, what each version decided and wrote). `<date>-pre-daily.md` still exists, generated, with every version. Days written before this are split into versions the first time they are read; the old file stays next to them as `.legacy.md`. The minutes screen shows "version N of today", what changed since the previous version, and the whole day (the latest decision of each activity wins); a decision an earlier version already wrote to the plan's log or a card note is not written again.

An activity already covered today is compared with what the earlier conversation saw (stage, MRs, blockers, pending items, notes, spec files; what the app itself wrote afterwards does not count). Unchanged: a short turn built from the earlier one, with no agent call (`turn.sameDay*` and `sameDay.*` in the catalogs). Changed: the prompt carries what changed and what was said, answered and decided. This comes before the reuse of earlier days' speeches (`falas.json`).

Deleting minutes (one version or the whole day) moves the files and the ceremony records to `<workspace>/.trash/atas/<stamp>/`; History's Trash restores them for 30 days, after which the retention job erases them. What was already written to a spec, a note or the effects queue stays where it is. A version whose call is still going cannot be deleted.

### Not verified

- No real model was called during verification: prompts were checked with a fake engine.
- The `stageMapping` rules for GitHub (Projects v2 `Status` field), Bitbucket and GitLab were written from the providers' documentation and tested with hand-written inputs, with no account on the services. The providers' cards already use the rules (`stageOf` in `main/vcs/stages.ts` calls `mapStageByRules` before the stage patterns and the host defaults); a GitHub Projects board field (`field`) does not reach the provider yet, which hands over labels, status and issue state only (`StageInput` in `cycles/types.ts`).
- The English prompts were written by translation; the quality of model answers with them was not measured.
- Screens other than Today (Gate, QA hand-off, Retro, Actions) do not hide themselves: their entry points disappear. Someone opening one from an old notification still sees it.
