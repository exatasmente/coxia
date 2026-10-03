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
| `stages` | o vocabulário de etapas: `id`, `label`, `match` (expressões regulares), `kind` (`backlog`, `development`, `review`, `reviewApproved`, `qa`, `qaApproved`, `returned`, `done`, `blocked`), `rank`; e, para o ciclo de agentes, `agentId` (o agente que trabalha a etapa), `artifacts` (arquivos que a etapa produz na pasta do ciclo) e `human` (um gate: espera a pessoa) |
| `stageMapping` | regras que ligam o que o provedor informa a uma etapa: `{ provider, source, name, pattern, stage }`; `source` é `label`, `status`, `field` (campo de quadro, ex.: `Status` do GitHub Projects), `state` ou `column`. A primeira regra que casa vence; o que sobra cai nos `match` das etapas |
| `meanings` | o que é "bloqueio" (`stageKinds` + texto), "pergunta para mim" (liga/desliga + texto) e "pronto para o QA" (`stageKinds`, `requiresSpec`, texto) |
| `enrichment` | o que o agente recebe de cada cartão: `specFolder` (procura a pasta da issue), `cardFields` (quais campos do cartão), `extraFiles` (documentos que o cartão cita quando existem) |
| `specLayout` | onde ficam os documentos: `folderPrefix`, `phaseFiles` (o arquivo que mais avançou diz a fase), `planFiles`, `gateFiles` (artefato de cada gate), `decisionLog.heading` (a seção do plano onde as decisões vão; vazio: nunca escreve no plano), `documents` |
| `comments` | os modelos dos comentários que o runner deixa na tracker, por id de etapa e por evento (`gate`, `question`, `pr`): `{ title, status, sections[{ heading, guidance }], technicalDetail }`. Sem modelo para uma etapa, nada é postado (veja abaixo) |
| `priority` | as labels que dizem a urgência de uma issue (`labels`, da mais alta para a mais baixa, cada uma uma expressão regular sem diferenciar maiúsculas); vazio: o workspace não tem labels de prioridade |
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
| Ciclo de agentes (`agent-flow`) | pré-daily, desbloqueio, gate, retro | Refine, Gate 1, Plan, Gate 2, Implement, Review, QA, Ready | `1_SPEC.md` a `5_TEST_PLAN.md` na pasta do ciclo |

Todos produzem um app útil sem arquivo de spec: os cartões vêm do provedor de VCS (ou da fonte de cartões), e as etapas são lidas por `stageMapping`. O SDD é o comportamento que o app já tinha, sem empresa: a conta de QA, o prefixo das issues, as skills do playbook e a ferramenta de release vêm de campos da configuração, preenchidos pelo perfil migrado (`legacy.ts`).

A disponibilidade final de uma cerimônia é "ligada no ciclo **e** com o que ela precisa": o gate exige a pasta de specs e artefatos nomeados; a passagem ao QA exige a pasta de specs.

### O ciclo de agentes

O modelo `agent-flow` descreve o trabalho de um time de agentes, não os status do tracker. As etapas são `refine`, `gate1`, `plan`, `gate2`, `implement`, `review`, `qa` e `ready`; as de trabalho nomeiam o agente (`agentId`) e os arquivos que devem produzir (`artifacts`: `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md`, `4_REVIEW.md`, `5_TEST_PLAN.md`, direto na pasta do ciclo, sem subpasta), os dois gates têm `human: true` (esperam a pessoa) e `ready` é o fim. O `specLayout` casa com isso: os gates leem a spec e o plano, e a fase do cartão é o último arquivo presente. `stageMapping` fica vazio: a etapa do tracker não é movida pelo ciclo.

O modelo traz um time padrão (`team` do modelo): Refinador, Planejador, Desenvolvedor, Revisor e QA, todos autônomos, com as permissões `read`, `read`, `worktree`, `read`, `read`. Só o desenvolvedor pode alterar arquivos, e só dentro do worktree da execução. Cada agente liga ou desliga a própria autonomia, então o ciclo pode ser híbrido: agentes autônomos, gates da pessoa e agentes que esperam por ela. Aplicar o modelo a um workspace que já tem agentes **mantém os agentes da pessoa**: o que já existe com o mesmo `id` não é tocado, os que faltam são acrescentados, e as etapas que o novo ciclo não tem saem da lista `stages` de cada agente. Um arquivo de modelo exportado leva os agentes que não são nativos. As definições do time, do `agentId` e da permissão estão em [`configuration.md`](configuration.md).

O executor que leva uma issue por essas etapas é o [runner](runner.md).

#### Modelos de comentário (`devCycle.comments`)

O que cada etapa deixa na tracker é decidido pelo ciclo, não pelo código: `comments` tem um modelo por id de etapa de trabalho e por evento (`gate`: uma decisão de gate, `question`: uma pergunta de agente, `pr`: a descrição do pull request). Um modelo é `{ title, status, sections, technicalDetail }`:

- `title`: como o comentário se chama onde o app o lista (Ações, conversa); não aparece no corpo.
- `status`: a **primeira linha** do comentário, com `{stage}`, `{round}`, `{result}`, `{decision}` e `{ref}` (por exemplo `Revisão: {result} (rodada {round})`).
- `sections`: as seções depois do status, na ordem, cada uma com `heading` e `guidance` (o que ela deve dizer, o texto que o agente recebe). Uma seção sem nada a dizer sai do comentário. As primeiras seções são para quem não lê código (produto, suporte, quem abriu a issue): comportamento, não implementação.
- `technicalDetail`: acrescenta, por último, a seção recolhida "Detalhe técnico" (`<details>`), onde ficam os nomes de arquivo, função e linha.

Os textos são chaves do catálogo (`cycle.agentFlow.comment.<id>.*`) ou literais, como os outros textos do ciclo, e o idioma do comentário é o do workspace. O ciclo de agentes traz os modelos de refine, plan, implement, review, qa, gate, question e pr; **os outros ciclos não trazem nenhum**, e uma etapa sem modelo não posta nada. Trocar de ciclo troca os modelos; exportar um ciclo leva os dele. O que o runner faz com eles (como escreve, confere e publica) está em [`runner.md`](runner.md).

### Execuções

Uma **execução** (*run*) é uma issue passando pelo ciclo de agentes: a etapa em que está, o que cada etapa produziu, quem trabalha, o que espera a pessoa e o histórico. Fica em um arquivo JSON por execução em `<dados>/workspaces/<id>/runs/<id>.json`, gravado de forma atômica e conferido contra um JSON Schema a cada leitura (`src/shared/runs/schema.ts`): um arquivo gravado por um app mais novo não é usado nem sobrescrito, e um arquivo que não bate com o esquema é listado como ilegível, nunca apagado. Só pode haver uma execução em andamento por issue.

O estado muda por funções puras em `src/shared/runs/transitions.ts` (`startRun`, `stageDone`, `gateApprove`, `gateReject`, `gateSkip`, `ask`, `answer`, `handBack`, `reviewReturn`, `stageFailed`, `retry`, `cancel`, `resumeAfterRestart`), cada uma devolvendo a execução nova e as mensagens que o fórum deve registrar, na ordem. Reprovar um gate devolve a execução à etapa que produziu o artefato, com o motivo como passagem (*handoff*); pular exige motivo e fica registrado como decisão; uma pergunta pausa a etapa até a resposta; a revisão devolve o trabalho ao desenvolvedor e, na segunda rodada com apontamentos, a execução para e pergunta à pessoa; depois de reabrir o app, a etapa interrompida recomeça. Uma etapa sem agente não começa e diz isso. Quando o agente da etapa **não é autônomo**, a execução tem dois estados de espera a mais: `to-start` (a etapa foi alcançada e espera a pessoa iniciar: `startStage`) e `to-accept` (o agente terminou e o resultado espera a pessoa aceitar, `acceptStage`, ou devolver com uma nota, `returnStage`; só então saem a passagem e a etapa seguinte; achados de revisão e devoluções também esperam, e a rodada só conta quando aceitos). Quem começa a execução inicia a primeira etapa, e o que a própria pessoa manda (reprovar um gate, responder ao limite de revisão, tentar de novo, devolver com uma nota) começa na hora. Cada etapa guarda a autonomia que o agente tinha quando ela foi alcançada: uma mudança do campo vale na próxima partida de etapa, nunca no meio de uma. Cada etapa guarda no máximo **um** comentário no tracker, editado no lugar: a execução só registra onde ele está (`comments`, por etapa e `pr` para o pull request: alvo, id da nota, endereço, hash do corpo, estado). Nada disso é publicado nesta fase.

### O fórum

Cada execução tem uma conversa (*thread*), e há conversas gerais. É onde os agentes dizem o que fizeram e onde a pessoa lê, responde e redireciona. Uma conversa é um arquivo `<dados>/workspaces/<id>/forum/<conversa>.jsonl`, só de acréscimo: a primeira linha é o cabeçalho, depois uma mensagem por linha, numeradas 1, 2, 3 sem buraco. Uma linha que não lê é ignorada, e uma linha cortada por uma queda é fechada antes da próxima mensagem. O nome da conversa vira nome de arquivo, então só passa o que casa com `^[a-z0-9][a-z0-9_-]{0,63}$` (a de uma execução é `run-<id da execução>`).

Uma mensagem tem um tipo (`post`: o que um agente fez; `question`: precisa da pessoa e a etapa espera; `answer`: guarda de qual pergunta é; `handoff`: de um agente para o próximo, com o que foi produzido e o que fazer; `decision`: resultado de um gate ou um pulo com o motivo; `system`: mudança de etapa), o autor (um agente, a pessoa ou o app), o texto, os agentes mencionados (`@developer`, só ids que existem no time), referências a artefatos, a etapa e a passagem. As mensagens que o app redige (`system`, e o cabeçalho de uma `decision`) guardam um `code` e `params`, e o texto sai na hora de mostrar, no idioma de então. O que um agente escreve passa pela redação de segredos antes de ser gravado. `public` marca o que pode aparecer no tracker (o que um agente fez, perguntou, a resposta e as decisões; passagens e mudanças de etapa ficam internas) e `published` guarda o link depois que a mensagem foi espelhada; como o arquivo não se reescreve, o link é uma linha de anotação que a leitura junta à mensagem. Ser público não publica: espelhar exige a opção do workspace e um "sim" próprio (fase seguinte).

Canais (todos abertos ao navegador pareado, pois só tocam nos arquivos do próprio workspace): `forum:list`, `forum:read(conversa, depoisDe?, limite?)`, `forum:post(conversa, texto)` (uma mensagem da pessoa, com as menções resolvidas contra o time) e `forum:create(título)` (uma conversa geral). Cada mensagem nova também é empurrada como o evento `forum:message`, pelo mesmo caminho do `agent:activity`. Quem executa uma menção é o [runner](runner.md), e só com um agente que lê; uma mensagem da pessoa na conversa de uma execução que espera uma resposta é a resposta (por isso `forum:post` não passa só pelo arquivo da conversa).

### Prioridade

O cartão leva o que o tracker diz da issue: as labels, o milestone, o projeto e a hora da última atualização (`updatedAt`). A **prioridade** do cartão é a primeira entrada de `devCycle.priority.labels` que casa com alguma label da issue; guarda a posição (`rank`, 0 é a mais alta) e a label da issue que casou. Sem entradas, ou sem casamento, o cartão não tem prioridade. Ela aparece no cartão da tela Hoje (e no detalhe, junto com o milestone) e na call; o agente do turno lê `priority` e `milestone` quando `enrichment.cardFields` os lista, e é instruído a citá-los só quando mudam o que importa agora. O milestone é só contexto: não entra na ordem. Uma fonte de cartões por comando (`externalTools.cardSource`) pode informar `labels`, `milestone` e `updated_at` nos itens de issue; sem eles o cartão não tem prioridade.

```json
{ "devCycle": { "priority": { "labels": ["^P0$", "^P1$", "^P2$"] } } }
```

**Uma ordem só.** Hoje e a call listam os cartões na mesma ordem (`compareCards` em `src/shared/priority.ts`): bloqueados primeiro, depois a prioridade (quem não tem, por último), depois o atualizado mais recentemente (quem não tem hora, por último). Empate não se desfaz pelo texto da referência: ficam na ordem em que o tracker os entregou. Uma reunião mais tarde no mesmo dia ainda põe por último o cartão que não mudou e não está bloqueado (`agendaOrder`). Hoje lista o que a call vai seguir, sem reordenar; as faixas de urgência antigas (pergunta pendente, volta do QA, perto do QA) saíram da ordem porque contradiziam esta.

**Nada some em silêncio.** A call leva as primeiras 8 atividades da ordem. As que não cabem não são descartadas: `cards:load` devolve também `rest` (na mesma ordem) e o `total`. A abertura da call diz quantas ficaram de fora, a coluna da pauta lista as que ficaram, no fim, cada uma com "Trazer" (ela entra logo depois da atividade em andamento), e Hoje mostra a contagem. Uma conversa salva antes disso não tem `rest` e não mostra nada.

**Reajustar a prioridade na call.** Dizer "esta vai primeiro", "deixa a #12 para a semana que vem" ou "sobe a #7" produz uma decisão de prioridade para aquele cartão. O agente da resposta tem o campo opcional `prioridade: { para }` (esquema `agent:reply`; texto em `prompt.sdd.reply.priority*`): `para` é `first` (o nível mais alto), `later` (o mais baixo) ou um dos rótulos de `devCycle.priority.labels` (só os que são nome de rótulo simples, com ou sem `^` e `$`; um nível que é padrão ordena cartões mas não dá para gravar). O app resolve o pedido contra o cartão (`resolvePriority`): a label nova entra, **toda** label de prioridade que a issue já tinha sai e as outras ficam. A decisão aparece na call antes do próximo cartão, com o destino ("proposta em Ações" ou "ata, não gravado no tracker: <motivo>"), no painel de decisões e na ata. Ela **não** reordena o resto da pauta.

Sem rótulos de prioridade configurados, o agente só oferece `first` e `later`, e a decisão fica na ata com a linha dizendo que não foi gravada no tracker. O mesmo vale para um nível que é padrão, para uma issue que já tem aquele rótulo, para um cartão sem issue identificada e para o Bitbucket (a troca de rótulos não é suportada nele).

**Gravar como proposta.** Ao salvar a ata (`ata:save`), cada decisão de prioridade marcada de um cartão cujo workspace tem labels de prioridade vira uma proposta de troca de label (`setIssueLabels` pelo `proposeVcsCommands`, a mesma via de toda escrita no host): sai a label de prioridade antiga, entra a nova, as outras ficam. Ela espera em Ações pelo "sim" daquela ação; aprovar troca a label no tracker, com o registro de auditoria de sempre. A chave da proposta é `priority:<cartão>:<label>:<dia>`, então repetir a mesma decisão no mesmo dia não cria outra. Um workspace de testes recusa (ao salvar e, se a proposta já existir, ao aprovar). Sem labels de prioridade, ou no Bitbucket, a proposta não é criada: a decisão fica na ata, com a linha que diz que não foi gravada no tracker.

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
| `stages` | the stage vocabulary: `id`, `label`, `match` (regular expressions), `kind` (`backlog`, `development`, `review`, `reviewApproved`, `qa`, `qaApproved`, `returned`, `done`, `blocked`), `rank`; and, for the agent cycle, `agentId` (the agent that works the stage), `artifacts` (files the stage produces in the cycle folder) and `human` (a gate: waits for the person) |
| `stageMapping` | rules that tie what a provider reports to a stage: `{ provider, source, name, pattern, stage }`; `source` is `label`, `status`, `field` (a board field, e.g. GitHub Projects' `Status`), `state` or `column`. The first matching rule wins; what is left falls to the stages' `match` patterns |
| `meanings` | what a "blocker" is (`stageKinds` + text), a "question for me" (on/off + text) and "ready for QA" (`stageKinds`, `requiresSpec`, text) |
| `enrichment` | what the agent gets about each card: `specFolder` (looks up the issue folder), `cardFields` (which card fields), `extraFiles` (documents the card names when they exist) |
| `specLayout` | where the documents live: `folderPrefix`, `phaseFiles` (the most advanced file present says the phase), `planFiles`, `gateFiles` (each gate's artifact), `decisionLog.heading` (the plan section decisions go to; empty: never written to the plan), `documents` |
| `comments` | the templates of the comments the runner leaves on the tracker, by stage id and by event (`gate`, `question`, `pr`): `{ title, status, sections[{ heading, guidance }], technicalDetail }`. A stage with no template posts nothing (see below) |
| `priority` | the labels that say how urgent an issue is (`labels`, highest first, each a case-insensitive regular expression); empty: the workspace has no priority labels |
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
| Agent cycle (`agent-flow`) | pre-daily, unblock, gate, retro | Refine, Gate 1, Plan, Gate 2, Implement, Review, QA, Ready | `1_SPEC.md` to `5_TEST_PLAN.md` in the cycle folder |

All of them produce a useful app without a spec file: cards come from the VCS provider (or the card source), and stages are read through `stageMapping`. SDD is the behavior the app already had, with the company left out: the QA account, the issue prefix, the playbook skills and the release tool come from configuration fields, filled by the migrated profile (`legacy.ts`).

The final availability of a ceremony is "on in the cycle **and** with what it needs": the gate needs the specs folder and named artifacts; the QA hand-off needs the specs folder.

### The agent cycle

The `agent-flow` template describes the work of a team of agents, not tracker statuses. The stages are `refine`, `gate1`, `plan`, `gate2`, `implement`, `review`, `qa` and `ready`; the work stages name their agent (`agentId`) and the files they must produce (`artifacts`: `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md`, `4_REVIEW.md`, `5_TEST_PLAN.md`, directly in the cycle folder, no sub-folder), the two gates have `human: true` (they wait for the person) and `ready` is the end. `specLayout` matches: the gates read the spec and the plan, and a card's phase is the latest file present. `stageMapping` is empty: the cycle does not move the tracker's stage.

The template brings a default team (the template's `team`): Refiner, Planner, Developer, Reviewer and QA, all autonomous, with permissions `read`, `read`, `worktree`, `read`, `read`. Only the developer may change files, and only inside the run's worktree. Each agent switches its own autonomy on or off, so a cycle can be hybrid: autonomous agents, the person's gates and agents that wait for the person. Applying the template to a workspace that already has agents **keeps the person's agents**: one with the same `id` is not touched, missing ones are added, and the stages the new cycle lacks are dropped from every agent's `stages`. An exported template file carries the agents that are not built in. The definitions of the team, `agentId` and the permission are in [`configuration.md`](configuration.md).

The executor that takes an issue through these stages is the [runner](runner.md).

#### Comment templates (`devCycle.comments`)

What each stage leaves on the tracker is decided by the cycle, not by code: `comments` holds one template per work-stage id and per event (`gate`: a gate decision, `question`: an agent's question, `pr`: the pull request description). A template is `{ title, status, sections, technicalDetail }`:

- `title`: what the comment is called where the app lists it (Actions, the thread); it does not appear in the body.
- `status`: the **first line** of the comment, which may use `{stage}`, `{round}`, `{result}`, `{decision}` and `{ref}` (for example `Review: {result} (round {round})`).
- `sections`: the sections after the status, in order, each with a `heading` and a `guidance` (what it must say, the text the agent is given). A section with nothing to say is left out. The first sections are for people who do not read code (product, support, whoever opened the issue): behavior, not implementation.
- `technicalDetail`: adds, last, the collapsed "Technical detail" section (`<details>`), where file, function and line names go.

The texts are catalog keys (`cycle.agentFlow.comment.<id>.*`) or literals, like the cycle's other texts, and the comment's language is the workspace's. The agent cycle brings templates for refine, plan, implement, review, qa, gate, question and pr; **the other cycles bring none**, and a stage with no template posts nothing. Switching cycle switches the templates; exporting a cycle takes its own along. What the runner does with them (how it writes, checks and publishes) is in [`runner.md`](runner.md).

### Runs

A **run** is an issue going through the agent cycle: the stage it is in, what each stage produced, who is working, what waits for the person, and its history. It is one JSON file per run in `<data>/workspaces/<id>/runs/<id>.json`, written atomically and checked against a JSON Schema on every read (`src/shared/runs/schema.ts`): a file written by a newer app is neither used nor overwritten, and a file that does not match the schema is listed as unreadable, never deleted. There can be one run in progress per issue.

The state changes through pure functions in `src/shared/runs/transitions.ts` (`startRun`, `stageDone`, `gateApprove`, `gateReject`, `gateSkip`, `ask`, `answer`, `handBack`, `reviewReturn`, `stageFailed`, `retry`, `cancel`, `resumeAfterRestart`), each returning the new run and the messages the forum is to record, in order. Rejecting a gate returns the run to the stage that produced the artifact, with the reason as a handoff; skipping needs a reason and is recorded as a decision; a question pauses the stage until it is answered; the review hands the work back to the developer and, on the second round with findings, the run stops and asks the person; after the app restarts the interrupted stage starts over. A stage with no agent does not start and says so. When the stage's agent is **not autonomous** the run has two more waiting states: `to-start` (the stage was reached and waits for the person to start it: `startStage`) and `to-accept` (the agent finished and the result waits for the person to accept it, `acceptStage`, or send it back with a note, `returnStage`; only then do the handoff and the next stage go out; review findings and hand backs wait too, and a round only counts once accepted). Whoever starts the run starts its first stage, and what the person directs (rejecting a gate, answering the review limit, retrying, sending back with a note) starts at once. Each stage keeps the autonomy its agent had when the stage was reached: a change of the flag applies at the next stage start, never in the middle of one. Each stage keeps at most **one** comment on the tracker, edited in place: the run only records where it stands (`comments`, by stage and `pr` for the pull request: target, note id, address, body hash, status). Nothing of this is published at this stage.

### The forum

Every run has a thread, and there are general threads. It is where agents say what they did and where the person reads, answers and redirects. A thread is a file `<data>/workspaces/<id>/forum/<thread>.jsonl`, append only: the first line is the header, then one message per line, numbered 1, 2, 3 with no gap. A line that does not read is ignored, and a line torn by a crash is closed before the next message. The thread name becomes a file name, so only what matches `^[a-z0-9][a-z0-9_-]{0,63}$` gets through (a run's is `run-<run id>`).

A message has a kind (`post`: what an agent did; `question`: needs the person and the stage waits; `answer`: remembers which question it answers; `handoff`: from one agent to the next, with what was produced and what to do; `decision`: a gate result or a skip with its reason; `system`: a stage change), an author (an agent, the person or the app), the text, the agents mentioned (`@developer`, only ids the team has), references to artifacts, the stage and the handoff target. The messages the app words (`system`, and the heading of a `decision`) store a `code` and `params`, and the text is produced when it is shown, in the language of the moment. What an agent writes goes through secret redaction before it is stored. `public` marks what may appear on the tracker (what an agent did, asked, the answer and the decisions; handoffs and stage changes stay internal) and `published` holds the link once the message was mirrored; since the file is never rewritten, the link is an annotation line that reading folds into the message. Being public does not publish: mirroring needs the workspace option and its own "yes" (next phase).

Channels (all open to a paired browser, since they only touch the workspace's own files): `forum:list`, `forum:read(thread, afterSeq?, limit?)`, `forum:post(thread, text)` (a person's message, with mentions resolved against the team) and `forum:create(title)` (a general thread). Each new message is also pushed as the `forum:message` event, through the same path as `agent:activity`. Running a mention is the [runner](runner.md)'s job, and only with an agent that reads; a person's message in the thread of a run that waits for an answer is the answer (so `forum:post` does not go through the thread file alone).

### Priority

The card carries what the tracker says about the issue: its labels, milestone, project and the time of its last update (`updatedAt`). The card's **priority** is the first entry of `devCycle.priority.labels` that matches one of the issue's labels; it keeps the position (`rank`, 0 is the highest) and the issue's own label that matched. With no entries, or no match, the card has no priority. It shows on the card in Today (and in its detail, with the milestone) and in the call; the turn agent reads `priority` and `milestone` when `enrichment.cardFields` lists them, and is told to mention them only when they change what matters now. The milestone is context only: it does not enter the order. A command card source (`externalTools.cardSource`) may report `labels`, `milestone` and `updated_at` on its issue items; without them the card has no priority.

```json
{ "devCycle": { "priority": { "labels": ["^P0$", "^P1$", "^P2$"] } } }
```

**One order.** Today and the call list the cards in the same order (`compareCards` in `src/shared/priority.ts`): blocked first, then priority (a card with none last), then the most recently updated (a card with no time last). A tie is not broken by the reference text: tied cards keep the order the tracker handed them over in. A later meeting on the same day still puts a card that did not change and is not blocked last (`agendaOrder`). Today lists what the call will follow, without sorting again; the old urgency bands (pending question, back from QA, close to QA) left the order because they contradicted this one.

**Nothing is dropped silently.** The call takes the first 8 activities of the order. The ones that do not fit are not discarded: `cards:load` also returns `rest` (in the same order) and the `total`. The call's opening says how many were left out, the agenda column lists them at the end, each with "Bring in" (it joins right after the activity in progress), and Today shows the count. A conversation saved before this has no `rest` and shows nothing.

**Readjusting priority in the call.** Saying "this one goes first", "leave #12 for next week" or "raise #7" produces a priority decision for that card. The reply agent has the optional field `prioridade: { para }` (the `agent:reply` schema; text in `prompt.sdd.reply.priority*`): `para` is `first` (the highest level), `later` (the lowest) or one of the labels of `devCycle.priority.labels` (only those that are plain label names, with or without `^` and `$`; a level that is a pattern ranks cards but cannot be written). The app resolves the request against the card (`resolvePriority`): the new label goes on, **every** priority label the issue already had comes off and the others stay. The decision shows in the call before the next card, with its destination ("proposal in Actions" or "minutes, not written to the tracker: <reason>"), in the decisions panel and in the minutes. It does **not** reorder the rest of the agenda.

With no priority labels configured the agent is only offered `first` and `later`, and the decision stays in the minutes with the line saying it was not written to the tracker. The same goes for a level that is a pattern, an issue that already has that label, a card whose issue is not identified and Bitbucket (label changes are not supported there).

**Persisting as a proposal.** When the minutes are saved (`ata:save`), each selected priority decision of a card in a workspace that has priority labels becomes a label change proposal (`setIssueLabels` through `proposeVcsCommands`, the same path as every write to the host): the old priority label comes off, the new one goes on, the others stay. It waits in Actions for that action's own "yes"; approving it changes the label on the tracker, with the usual audit entry. The proposal's key is `priority:<card>:<label>:<day>`, so repeating the same decision on the same day does not create another. A test workspace refuses it (at the save and, if the proposal already exists, at the approval). With no priority labels, or on Bitbucket, no proposal is created: the decision stays in the minutes with the line saying it was not written to the tracker.

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
