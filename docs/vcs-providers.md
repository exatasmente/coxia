# Provedores de VCS / VCS providers

[Português](#português) | [English](#english)

---

## Português

Tudo que o Coxia lê ou escreve num host de código (issues, merge e pull requests, discussões, pipelines) passa por um **provedor** em `src/main/vcs/`: GitLab, GitHub (github.com e Enterprise Server) ou Bitbucket Cloud. Os módulos do app (cartões, ações rápidas, feedback, efeitos, vigias, radar, conflito a partir de MR, agentes) falam com a interface neutra, nunca com `glab` nem com um endpoint de GitLab.

### Como o provedor é escolhido

`vcs[]` do `WorkspaceConfig` descreve as integrações (`id`, `kind`, `host`, `apiUrl`, `user`, `secretRef`, `cliPreference`, `cliCommand`). A integração **primária** é a de `projects.issues.vcsId`, ou a primeira. `projects.issues` diz onde moram as issues (`project` = `grupo/nome`, `refPrefix`); `projects.repos[].vcsId` e `.projectPath` ligam repositórios a uma integração.

| `cliPreference` | O que acontece |
|---|---|
| `cli` | sempre o CLI (`glab`, `gh`), com o login dele. É o caso de quem já usava o `glab` (config migrada). |
| `api` | sempre `fetch` com o token de `secretRef`. |
| `auto` | **com token configurado, a API** (quem digitou um token quis usá-lo); sem token, o CLI se estiver instalado. Bitbucket não tem CLI: sempre API. |

O token vem do cofre de segredos (`secretRef`: `stored`, `command` ou `env`, ver `configuration.md`). Ele só vai em cabeçalho HTTP para o host configurado; um caminho que nomeia outro host é recusado.

### O que cada provedor usa

| | GitLab | GitHub | Bitbucket Cloud |
|---|---|---|---|
| API | REST v4 (`/api/v4`) e um GraphQL só para ler o status do work item | REST (`api.github.com` ou `/api/v3`) e GraphQL para threads de revisão e rascunho | REST 2.0 (`api.bitbucket.org/2.0`) |
| `apiUrl` vazio | `https://<host>/api/v4` | `api.github.com` ou `https://<host>/api/v3` | `https://api.bitbucket.org/2.0` |
| Credencial | `PRIVATE-TOKEN` | `Authorization: Bearer` | `usuario:senha-de-app` (Basic) ou token de acesso puro (Bearer) |
| CLI opcional | `glab` (`GITLAB_HOST`) | `gh` (`GH_HOST` em Enterprise) | nenhum |
| Issues | issues do projeto, com status do work item | issues (sem status próprio: o estágio vem das labels e dos PRs) | rastreador de issues (opcional por repositório), o estado é o status |
| Issues do projeto ("todas" e "por label") | `projects/<id>/issues?scope=all&state=opened`; por label, uma leitura por label (o filtro "qualquer uma" é de plano pago), reunidas pelo número | busca `is:issue is:open repo:<r>` e, por label, `label:"a","b"` (a vírgula é OU); a busca deixa os PRs fora da conta de páginas | `issues?q=` com os estados abertos, sem filtro de responsável; por label, não existe (o rastreador não tem labels) |
| Lista "minhas" | `issues?scope=assigned_to_me`, `merge_requests?scope=created_by_me` e `reviewer_username` | `issues?filter=assigned`, busca `is:pr author:` e `review-requested:` | `pullrequests/{uuid}`; revisão pedida e issues nos repositórios configurados |

### Permissões do token

O app **lê** por padrão. As escritas (comentar, responder e resolver discussão, labels, status, revisor, rascunho) só acontecem depois de uma proposta que você confirma em Ações; elas precisam de permissão a mais.

| Provedor | Leitura (tudo que os cartões, o feedback e os vigias fazem) | Escrita (depois do seu "seguir") |
|---|---|---|
| GitLab | `read_api` | `api` |
| GitHub, token clássico | `repo` | `repo` |
| GitHub, token fine-grained | Metadata, Contents, Issues, Pull requests e Actions, só leitura | Issues e Pull requests com leitura e escrita |
| Bitbucket Cloud | `account`, `repository`, `pullrequest`, `issue` | `pullrequest:write`, `issue:write` |

Com o login do CLI (`cliPreference: cli`) valem as permissões da sessão do CLI. O teste da integração (abaixo) diz o que falta.

### Quem usa o quê

| Recurso | Lê | Propõe (escrita) |
|---|---|---|
| Cartões do dia sem comando externo (`vcs/cardSource.ts`) | as issues abertas que o escopo do workspace escolhe (as minhas por padrão), meus MRs e os pedidos de revisão, CI e aprovações | n/d |
| Ações rápidas (`gitlabQuick.ts`) | MR, pipeline e jobs, membros do projeto, issue e status | revisor, tirar de rascunho, rodar job manual, status e labels da issue |
| Feedback e reentrada (`feedback.ts`) | threads de MR (resolvidas ou não), notas do QA em issue e MR | responder uma discussão, marcar como resolvida |
| Efeitos da pré-daily (`efeitos.ts`) | MR, commits, pipelines, jobs, comentários, labels, estado da issue | n/d |
| Vigias (`watchers.ts`) | issue, MRs ligados, labels de versão | n/d |
| Radar (`radar.ts`) | arquivos e diffs de cada MR aberto | n/d |
| Conflito a partir de um MR (`actions.ts`) | MR, branch padrão, sha da branch alvo | o push é outra ação, com seu "sim" |
| Comentário do QA (`actions.ts`) | comentários da issue | editar a nota |
| Agentes das cerimônias | ver "Leitura dos agentes" | nada |

### Escritas: um só caminho

1. Um módulo descreve a escrita com `provider.planWrite(op)` (operações neutras: `commentIssue`, `commentMr`, `replyThread`, `resolveThread`, `editIssueNote`, `editMrNote`, `setIssueLabels`, `setIssueStatus`, `addReviewer`, `setDraft`, `playJob`, `submitReview`, `createMr`, `createIssue`, `closeIssue`, `deleteNote`). O provedor só **descreve**: devolve comandos, não executa.
2. `proposeVcsAction` (`actions.ts`, antes `proposeGitlabAction`, o nome antigo continua) valida o comando com o validador do provedor e guarda uma ação pendente. Comandos de GitLab viram `kind: 'gitlab'` (como as ações salvas antes dos provedores); os de GitHub e Bitbucket, `kind: 'vcs'`.
3. Você vê o comando exato em Ações e confirma. `approveAction` julga o comando de novo (ele pode ter vindo do disco), o executor roda e `auditoria.jsonl` registra uma linha, com o corpo e sem token.
4. Só `vcs/runtime.ts` importa os executores e só `actions.ts` os chama; `test/vcs-writes.test.ts` falha se isso mudar. Um workspace de teste recusa a confirmação.
5. Duas variações, ambas pela mesma porta: **um grupo** (`proposeVcsGroup`: várias escritas que são uma coisa só para a pessoa, como uma rodada de revisão, esperam **um** "sim"; rodam em ordem, cada uma auditada, a primeira que falha para o resto e confirmar de novo continua de onde parou) e **a escrita de um agente autônomo** (`runVcsAuto`: sem "sim", mas pelo mesmo caminho, a mesma recusa em workspace de teste e o mesmo `auditoria.jsonl`, com o agente em `by` e o hash do corpo em `bodyHash`). Quem as usa é o runner, só por `runner/door.ts` ([`runner.md`](runner.md)). O push da branch de uma execução (`proposeRunPush`) não é um comando do provedor, é git: uma ação própria (`run-push`) que sempre espera o seu "sim".

Os validadores aceitam só estas formas (qualquer outra é recusada antes de gravar e antes de executar): GitLab, `projects/<id|grupo%2Fnome>/...` e uma mutação GraphQL de status (e, para as discussões do MR, a criação do MR e a edição de uma nota do MR, só os campos da lista: `body` e `position[...]` com hashes e números de linha conferidos); GitHub, comentários, labels, revisores, resposta de thread, estado da issue, a edição de um comentário, uma revisão (`POST pulls/N/reviews`, com `event` só `COMMENT` ou `REQUEST_CHANGES` — **nunca `APPROVE`** —, `commit_id` e comentários de linha com `path`, `line`, `side` e `start_line`), um comentário de arquivo (`subject_type: file`), a criação do PR e três mutações GraphQL (resolver thread, pronto para revisão, voltar a rascunho); Bitbucket, comentários (também em linha, com `inline`), resolver, estado da issue, `PUT` do PR com `title`, `reviewers` e `draft`, a edição de um comentário, a criação do PR e `request-changes`.

Limites por provedor: status de issue do GitLab depende dos ids de status da instância (a lista `devCycle.quickTransitions` de cada workspace; `gitlabQuick.ts` só a lê); no GitHub o "status" é abrir ou fechar; no Bitbucket não há labels nem jobs manuais.

### Revisão em linhas, nota editada e pull request

Quatro operações novas (`deleteNote` desfaz um comentário automático do runner), mapeadas assim (o runner as usa; veja [`runner.md`](runner.md)):

| Operação | GitHub | GitLab | Bitbucket Cloud |
|---|---|---|---|
| `editMrNote` | `PATCH issues/comments/{id}` (os comentários da conversa de um PR são comentários de issue) | `PUT merge_requests/{iid}/notes/{id}` | `PUT pullrequests/{id}/comments/{id}` |
| `deleteNote` (`target`: `issue`, `mr` ou `review`) | `DELETE issues/comments/{id}` (comentário de conversa de uma issue ou de um PR) ou `DELETE pulls/comments/{id}` (comentário de linha ou de arquivo de uma revisão) | `DELETE issues/{iid}/notes/{id}` ou `DELETE merge_requests/{iid}/notes/{id}` (o comentário de uma revisão é uma nota do MR) | `DELETE issues/{id}/comments/{id}` ou `DELETE pullrequests/{id}/comments/{id}` |
| `createMr` | `POST pulls` (`title`, `head`, `base`, `body`) | `POST merge_requests` (`source_branch`, `target_branch`, `title`, `description`) | `POST pullrequests` (`title`, `description`, `source`, `destination`) |
| `submitReview`, a revisão | **uma** chamada `POST pulls/{n}/reviews` com `event` (`REQUEST_CHANGES` ou `COMMENT`), `body`, `commit_id` e os comentários de linha | uma **discussão** por comentário, com a posição, e uma nota com o texto geral | um comentário **inline** por comentário e um comentário com o texto geral |
| o veredito | o `event` da revisão | não há chamada de "pedir alterações": o veredito está na primeira linha do texto geral | `POST pullrequests/{id}/request-changes`, por último, só quando pede alterações |
| comentário numa linha | `line` e `side` (`RIGHT` novo, `LEFT` removida); faixa com `start_line` e `start_side` | `position[new_line]` (linha adicionada), `position[old_line]` (removida) ou os dois (linha que não mudou), com `base_sha`, `start_sha` e `head_sha` do `diff_refs` do MR lidos na hora; uma faixa fica na última linha | `inline: { path, to }` (arquivo novo) ou `{ path, from }` (antigo); sem faixa: fica na última linha |
| comentário no arquivo | um comentário de revisão à parte (`POST pulls/{n}/comments`, `subject_type: file`): o endpoint de revisões não aceita comentário de arquivo | `position[position_type]=file` a partir do GitLab 16.10 (a versão vem de `GET version`); antes disso, ou se a versão não for lida, na primeira linha que a mudança toca, com "este comentário é sobre o arquivo inteiro" | na primeira linha que a mudança toca, com a mesma frase (não há comentário de arquivo) |
| sugestão de troca | bloco ` ```suggestion ` | bloco ` ```suggestion:-N+0 `, com N = última linha − primeira da faixa | só descrita, em bloco de código comum (não há sugestão) |

O GitLab recusa colocar a revisão se a cabeça do MR andou desde que os comentários foram posicionados (o runner posiciona pelo diff atual e passa o commit que usou). `ExecMeta.response` devolve ao chamador o JSON que o host respondeu (o id do comentário, o número do PR), que o executor também continua devolvendo como texto cortado.

`deleteNote` é a única exclusão que a lista fechada de escritas aceita: o validador de cada provedor só deixa passar um `DELETE` no endereço de um comentário (no GitLab, qualquer outro `DELETE` sob `projects/` passou a ser recusado; no GitHub e no Bitbucket, cada um dos dois endereços é uma entrada da lista), sem corpo, e o id do comentário tem de ser um número inteiro positivo. No GitHub, o texto geral de uma revisão enviada **é a revisão**, que o host não apaga: desfazer uma rodada apaga os comentários de linha e de arquivo dela e deixa esse texto. O DELETE do GitLab e do GitHub responde 204 sem corpo, e o executor trata isso como sucesso.

### Criar uma issue

A operação `createIssue` (`project`, `title`, `body`, `labels`) é o que um pedido entre squads vira quando o contato que o recebeu o transforma em trabalho do squad dele (o runner a usa, só por `runner/publish.ts` e `runner/door.ts`; veja [`runner.md`](runner.md)). Uma escrita externa como as outras: pela autonomia do contato (autônomo: pela porta, auditada; senão, uma proposta em Ações), recusada em workspace de teste.

| | GitHub | GitLab | Bitbucket Cloud |
|---|---|---|---|
| Chamada | `POST repos/{o}/{r}/issues` com `{ title, body, labels? }` | `POST projects/{id}/issues` com os campos `title`, `description`, `labels?` | `POST repositories/{w}/{r}/issues` com `{ title, content: { raw } }` |
| Rótulos | a lista `labels` | `labels` como texto, separados por vírgula (um rótulo com vírgula é recusado: viraria dois) | **não há**: as issues do Bitbucket não têm rótulos, e o rótulo do squad fica de fora |
| Número da issue na resposta | `number` | `iid` | `id` |

O título vira uma linha só e tem de ter texto (até 256 caracteres); um rótulo não pode ter vírgula nem quebra de linha. Os validadores aceitam só esta forma para criar issue: no GitHub, o endereço `repos/{o}/{r}/issues` (e não o de uma issue que já existe) com só `title` e `body` (e `labels`, uma lista de textos), no GitLab só `title`, `description` e `labels` (e `title` obrigatório e com texto), no Bitbucket só `title` e `content` (com `raw` em texto); qualquer outra chave, outro método, outro transporte ou corpo em formato errado é recusado antes de gravar e antes de executar.

### Para uma release

Duas leituras e uma escrita que só uma execução de release usa ([`runner.md`](runner.md#uma-release)). **`listMrsByTarget(projeto, branch)`** lista os pull requests (merge requests) que apontam para uma branch, abertos e integrados (os fechados sem integrar ficam de fora; a aprovação e as verificações vêm de `getMr`, um a um): GitHub `GET repos/{o}/{r}/pulls?base=…` em duas leituras, `state=open` (todas, até um limite de páginas) e `state=closed` (as integradas), de modo que muitos fechados não empurram um aberto para fora da lista; GitLab `GET projects/{id}/merge_requests?target_branch=…&state=all`, Bitbucket `GET repositories/{w}/{r}/pullrequests` com a consulta `destination.branch.name="…" AND (state="OPEN" OR state="MERGED")`. No **Bitbucket** o commit de um pull request vem com 12 caracteres: o provedor lê o commit inteiro (`GET repositories/{w}/{r}/commit/{hash}`) para os abertos e para `getMr`, e se não consegue (ou o host responde outro commit) deixa o curto, com o qual nada compara igual. Cada um traz se vem de um **fork** (`fromFork`: o `merge-pr` o recusa). O que `getMr` diz da aprovação serve ao portão do `merge-pr`: no GitHub, `onHead` é verdadeiro só se há revisão `APPROVED` **sobre o commit da cabeça** de alguém que é dono, membro ou colaborador (`commit_id`, `author_association`) e nenhuma mudança pedida de um deles; no GitLab e no Bitbucket a API não dá o commit de uma aprovação, então `onHead` fica ausente e vale só a aprovação; nos três, uma verificação (CI) que não se consegue ler é `running`, nunca verde. **`getRelease(projeto, tag)`** devolve a release que o host publicou para uma tag, ou `null`: GitHub `GET repos/{o}/{r}/releases/tags/{tag}` (um rascunho não aparece: é `null`), GitLab `GET projects/{id}/releases/{tag}` (`upcoming_release` ou sem data é rascunho), e **Bitbucket não tem releases: devolve `null` sem perguntar ao host**. **`closeIssue`** (`project`, `iid`) fecha uma issue: GitHub `PATCH issues/{n}` com `{ state: "closed" }`, GitLab `PUT issues/{iid}` com `state_event=close`, Bitbucket `PUT issues/{id}` com `{ state: "closed" }`; uma escrita externa como as outras (autonomia do agente, ou uma proposta; recusada em workspace de teste), e o validador de cada host só a aceita nessa forma.

### Cartões e estágios

Sem `externalTools.cardSource`, os cartões vêm do provedor (`vcs/cards.ts`): uma issue por issue atribuída a você (ou, conforme `projects.issues.cardScope`, por issue aberta do projeto de issues ou só pelas que têm alguma das `cardLabels`: [`configuration.md`](configuration.md); sem o projeto de issues, sem labels ou no Bitbucket, que não tem labels nas issues, vale "atribuídas a você"), MRs ligados por `Closes #n` no texto, no nome da branch ou pelo que o host diz. O estágio vem do mapeamento do workspace (`devCycle.stages`: `match` contra o status e as labels, o de maior `rank` vence). Com `devCycle.stages` vazio valem padrões por provedor (`vcs/stages.ts`): "In progress", "In review", "Ready to test", "Done" e equivalentes em inglês; sem sinal nenhum, o estágio sai do que os MRs fazem (rascunho, aberto, aprovado, mergeado). O item de issue leva também as labels, o milestone e a hora da última atualização (`updated_at`), de onde saem a prioridade do cartão e a ordem da lista ([`cycles.md`](cycles.md#prioridade)). O que mudou desde o começo do dia fica em `vcs-cards.json` do workspace.

O escopo dos cartões (`all`, `labels`) usa os mesmos limites de antes: no máximo 100 issues saem da fonte (duas páginas de 100 no GitHub e no Bitbucket, as páginas que o limite pede no GitLab), a ligação com MRs lê no máximo 25 issues sem MR no texto, e o que passa de 8 na chamada vai para a lista "fora da pauta". Uma issue além das 100 mais recentes não vira cartão, e isso não é avisado (vale também para `assigned`). A busca do GitHub tem limite de taxa próprio (mais baixo) e pode demorar a mostrar uma issue recém-criada; o relatório fica em cache por 5 minutos, mas salvar outra escolha de escopo o refaz na hora. Os MRs dos cartões não mudam com o escopo.

### O que a interface mostra por host

Os textos dizem o host configurado e o seu vocabulário (`{vcsName}`, `{cr}`, `{crMark}`: [`cycles.md`](cycles.md)): "MR" e `app!7` no GitLab, "PR" e `app#7` no GitHub e no Bitbucket, "checks" (e não "pipeline") no GitHub. O que o host não tem some em vez de ser renomeado: o bloco de status de issue da tela de ações rápidas só existe no GitLab (a lista de transições dentro dele, só com `devCycle.quickTransitions`); jobs manuais só no GitLab; "escolher outro reviewer substitui os atuais" só no GitLab; a chave "agentes leem o VCS" vale para a CLI do host quando há uma e para a ferramenta `VcsRead` quando não há, e a chave do MCP do tracker aparece sempre no GitLab e, no GitHub, no Bitbucket e sem integração, só com um servidor configurado. Uma issue e um MR de mesmo número no Bitbucket (as duas numerações são separadas) não colidem: o MR ganha o caminho completo na referência. Não coberto: issues em um host e código em outro (os cartões, as ações rápidas e o feedback usam só a integração principal).

### Leitura dos agentes

| Integração | O que o agente pode rodar |
|---|---|
| GitLab com CLI | `glab api projects/...` (MR, issue, discussões, notas, aprovações, changes, pipelines), `glab mr view`, `glab issue view` |
| GitHub com CLI | `gh api repos/...` (PRs, issues, comentários, reviews, arquivos, commits, timeline, check-runs, Actions), `gh pr view`, `gh issue view`; sem flags além de `--paginate` (`-f`, `-F`, `--input`, `--method` viram escrita no `gh api`) |
| Bitbucket, ou qualquer integração só com API | o shell fica fechado; a ferramenta `VcsRead` (issue, comentários, MR, threads, changes, CI) lê pelo app. No motor aberto é uma ferramenta própria; no Claude SDK, um servidor MCP em processo (`coxia_vcs`) |

As listas são expressões regulares estritas (um comando, sem `;`, `&&`, pipes além de `| head`, sem `..` nos caminhos): `GLAB_READ` e `GH_READ` em `vcs/readPolicy.ts`, testadas em `test/shell-allowlist.test.ts` e `test/vcs-read-policy.test.ts`. O interruptor "agentes leem o VCS" (`agents.tools.vcsCli`) desliga tudo.

### Erros, limites e tentativas

Toda chamada tem tempo limite (30 s na API, 60 s no CLI). Uma leitura repete em falha de rede, tempo esgotado e 502/503/504; um limite de taxa (`Retry-After`, `x-ratelimit-reset`) é esperado só se a espera for curta, senão a mensagem diz quanto esperar. Uma escrita nunca é repetida. As mensagens saem em pt-BR ou en pela configuração de idioma e nunca levam o token. O CLI e a API dão os mesmos códigos de erro (`auth`, `forbidden`, `not_found`, `rate_limited`, `network`, `timeout`, `server`, `invalid`, `unsupported`, `cli_missing`, `no_token`).

### Testar a integração (assistente)

`probeVcs(integracao)` em `src/main/vcs/index.ts` é o que o botão "Testar" do assistente chama: confere a credencial, diz quem você é, lê as permissões do token (GitLab: `personal_access_tokens/self`; GitHub clássico e Bitbucket OAuth: cabeçalho `x-oauth-scopes`; tokens fine-grained e senhas de app não informam), mostra uma amostra de issues e MRs, o limite de taxa e o que falta para escrever. O canal `vcs:probe` aceita também um token digitado e ainda não guardado (só desktop).

### Não verificado

- GitHub e Bitbucket só foram testados contra servidores falsos com respostas modeladas na documentação; nenhuma conta real. As **escritas** de qualquer provedor (inclusive o executor via API do GitLab e o `gh api --input`) não rodaram em host real: o único uso real foi uma leitura (`GET`) no GitLab, pelo login do `glab`.
- `all` e `labels` dos cartões só rodaram contra servidores falsos (a busca do GitHub com `label:"a","b"` como OU e o `labels=` do GitLab seguem a documentação; não foram conferidos num host real).
- O GraphQL de threads do GitHub (`reviewThreads`) e de rascunho (`markPullRequestReadyForReview`) segue o esquema público, sem conta para conferir.
- Bitbucket: `resolve` de comentário, `draft` no PR e `conflito` (não há campo) dependem da versão da API.
- **Apagar um comentário** (`deleteNote`): só rodou contra hosts falsos modelados na documentação. Não se viu um host real aceitar o `DELETE` de um comentário de revisão (`pulls/comments/{id}` no GitHub, uma nota de discussão no GitLab, um comentário `inline` no Bitbucket), nem o que cada host faz com as respostas a um comentário apagado; o token precisa de permissão de escrita nas issues e nos pull requests, e um comentário de outra pessoa é recusado pelo host (o runner só apaga o que ele mesmo postou).
- **Criar uma issue** (`createIssue`): só rodou contra hosts falsos modelados na documentação; nenhum host real foi visto aceitando o `POST` com esses campos (em particular `labels` como texto separado por vírgula no GitLab e o `content.raw` do Bitbucket, cujo rastreador de issues pode estar desligado no repositório). O número da issue criada é lido da resposta (`number`, `iid` ou `id`); uma resposta sem ele deixa a execução que pediu seguir sabendo que a issue não foi confirmada.
- **Revisão, nota editada e criação de PR** (`submitReview`, `editMrNote`, `createMr`): só rodaram contra hosts falsos modelados na documentação. Em particular: o limite do GitLab para `position_type=file` (16.10) é um palpite conservador; se for mais cedo, o comentário só vai na primeira linha da mudança; `position[...]` como campos de formulário (API) ou `-f` do `glab` (que o transforma em JSON aninhado) não foi visto aceito por um GitLab real; `POST pullrequests/{id}/request-changes` do Bitbucket e o `inline` sem `from`/`to` seguem a documentação, sem conta; no GitHub, comentários de arquivo são chamadas à parte e aparecem como comentários de revisão soltos, não dentro da revisão.
- **Para uma release** (`listMrsByTarget`, `getRelease`, `closeIssue`): só rodaram contra hosts falsos modelados na documentação. Não se viu o GitHub de verdade achar a release de uma pré-release publicada pelo endereço de tags (e o que ele diz de um rascunho), o `released_at` e o `upcoming_release` do GitLab de uma release que o fluxo do projeto nem cria, nem o `PUT state_event=close` e o `PATCH state` fecharem uma issue.
- A ferramenta `VcsRead` no Claude SDK usa `zod` (peer do SDK): se não carregar, o agente fica sem ela.

---

## English

Everything Coxia reads from or writes to a code host (issues, merge and pull requests, discussions, pipelines) goes through a **provider** in `src/main/vcs/`: GitLab, GitHub (github.com and Enterprise Server) or Bitbucket Cloud. The app's modules (cards, quick actions, feedback, effects, watchers, radar, conflict from an MR, agents) talk to the neutral interface, never to `glab` or a GitLab endpoint.

### How the provider is chosen

`vcs[]` in `WorkspaceConfig` describes the integrations (`id`, `kind`, `host`, `apiUrl`, `user`, `secretRef`, `cliPreference`, `cliCommand`). The **primary** one is the integration `projects.issues.vcsId` names, or the first. `projects.issues` says where the issues live (`project` = `group/name`, `refPrefix`); `projects.repos[].vcsId` and `.projectPath` tie repositories to an integration.

| `cliPreference` | What happens |
|---|---|
| `cli` | always the CLI (`glab`, `gh`), with its own login. This is a migrated config's case: someone who already used `glab`. |
| `api` | always `fetch` with the token of `secretRef`. |
| `auto` | **with a token configured, the API** (whoever typed a token meant to use it); without one, the CLI when installed. Bitbucket has no CLI: always the API. |

The token comes from the secrets store (`secretRef`: `stored`, `command` or `env`, see `configuration.md`). It only travels in an HTTP header to the configured host; a path that names another host is refused.

### What each provider uses

| | GitLab | GitHub | Bitbucket Cloud |
|---|---|---|---|
| API | REST v4 (`/api/v4`), and one GraphQL read for the work item status | REST (`api.github.com` or `/api/v3`), GraphQL for review threads and draft | REST 2.0 (`api.bitbucket.org/2.0`) |
| Empty `apiUrl` | `https://<host>/api/v4` | `api.github.com` or `https://<host>/api/v3` | `https://api.bitbucket.org/2.0` |
| Credential | `PRIVATE-TOKEN` | `Authorization: Bearer` | `user:app-password` (Basic) or a bare access token (Bearer) |
| Optional CLI | `glab` (`GITLAB_HOST`) | `gh` (`GH_HOST` on Enterprise) | none |
| Issues | project issues, with the work item status | issues (no status of their own: the stage comes from labels and PRs) | issue tracker (optional per repository), the state is the status |
| Project issues ("all" and "by label") | `projects/<id>/issues?scope=all&state=opened`; by label, one read per label (the "any of" filter is a paid-tier feature), merged by number | search `is:issue is:open repo:<r>` and, by label, `label:"a","b"` (the comma is OR); the search keeps PRs out of the page count | `issues?q=` with the open states and no assignee filter; by label, none (the tracker has no labels) |
| "Mine" lists | `issues?scope=assigned_to_me`, `merge_requests?scope=created_by_me` and `reviewer_username` | `issues?filter=assigned`, searches `is:pr author:` and `review-requested:` | `pullrequests/{uuid}`; requested reviews and issues in the configured repositories |

### Token permissions

The app **reads** by default. Writes (comment, reply to and resolve a discussion, labels, status, reviewer, draft) only happen after a proposal you confirm in Actions; they need extra permission.

| Provider | Read (everything cards, feedback and watchers do) | Write (after your "go") |
|---|---|---|
| GitLab | `read_api` | `api` |
| GitHub, classic token | `repo` | `repo` |
| GitHub, fine-grained token | Metadata, Contents, Issues, Pull requests and Actions, read-only | Issues and Pull requests with read and write |
| Bitbucket Cloud | `account`, `repository`, `pullrequest`, `issue` | `pullrequest:write`, `issue:write` |

With the CLI login (`cliPreference: cli`) the CLI session's permissions apply. The integration test (below) tells what is missing.

### Who uses what

| Feature | Reads | Proposes (write) |
|---|---|---|
| Day cards without an external command (`vcs/cardSource.ts`) | the open issues the workspace's scope picks (mine by default), my MRs and review requests, CI and approvals | n/a |
| Quick actions (`gitlabQuick.ts`) | MR, pipeline and jobs, project members, issue and status | reviewer, take out of draft, play a manual job, issue status and labels |
| Feedback and re-entry (`feedback.ts`) | MR threads (resolved or not), QA notes on issues and MRs | reply to a discussion, mark it resolved |
| Pre-daily effects (`efeitos.ts`) | MR, commits, pipelines, jobs, comments, labels, issue state | n/a |
| Watchers (`watchers.ts`) | issue, linked MRs, version labels | n/a |
| Radar (`radar.ts`) | files and diffs of every open MR | n/a |
| Conflict from an MR (`actions.ts`) | MR, default branch, target branch sha | the push is another action, with your "yes" |
| QA comment (`actions.ts`) | issue comments | edit the note |
| Ceremony agents | see "What agents may read" | nothing |

### Writes: one door

1. A module describes the write with `provider.planWrite(op)` (neutral operations: `commentIssue`, `commentMr`, `replyThread`, `resolveThread`, `editIssueNote`, `editMrNote`, `setIssueLabels`, `setIssueStatus`, `addReviewer`, `setDraft`, `playJob`, `submitReview`, `createMr`, `createIssue`, `closeIssue`, `deleteNote`). The provider only **describes**: it returns commands, it does not run them.
2. `proposeVcsAction` (`actions.ts`, formerly `proposeGitlabAction`, the old name still works) checks the command with the provider's validator and stores a pending action. GitLab commands become `kind: 'gitlab'` (like the actions saved before providers); GitHub and Bitbucket ones, `kind: 'vcs'`.
3. You see the exact command in Actions and confirm. `approveAction` judges the command again (it may have come from disk), the executor runs it and `auditoria.jsonl` records one line, with the body and without the token.
4. Only `vcs/runtime.ts` imports the executors and only `actions.ts` calls them; `test/vcs-writes.test.ts` fails if that changes. A test workspace refuses the confirmation.
5. Two variations, both through the same door: **a group** (`proposeVcsGroup`: several writes that are one thing to the person, such as a review round, wait for **one** "yes"; they run in order, each audited, the first that fails stops the rest, and confirming again goes on from where it stopped) and **the write of an autonomous agent** (`runVcsAuto`: no "yes", but the same path, the same refusal in a test workspace and the same `auditoria.jsonl`, with the agent in `by` and the body's hash in `bodyHash`). The runner uses them, only through `runner/door.ts` ([`runner.md`](runner.md)). The push of a run's branch (`proposeRunPush`) is not a provider command, it is git: an action of its own (`run-push`) that always waits for your "yes".

The validators accept only these shapes (anything else is refused before it is stored and before it runs): GitLab, `projects/<id|group%2Fname>/...` and one GraphQL status mutation (and, for MR discussions, creating the MR and editing an MR note, only the listed fields: `body` and `position[...]` with checked hashes and line numbers); GitHub, comments, labels, reviewers, thread replies, issue state, editing a comment, a review (`POST pulls/N/reviews`, with `event` only `COMMENT` or `REQUEST_CHANGES` — **never `APPROVE`** —, `commit_id` and line comments with `path`, `line`, `side` and `start_line`), a file comment (`subject_type: file`), creating the PR and three GraphQL mutations (resolve a thread, ready for review, back to draft); Bitbucket, comments (also inline, with `inline`), resolve, issue state, a PR `PUT` with `title`, `reviewers` and `draft`, editing a comment, creating the PR and `request-changes`.

Limits per provider: GitLab issue status depends on the instance's status ids (each workspace's `devCycle.quickTransitions` list, which `gitlabQuick.ts` only reads); on GitHub "status" is open or closed; Bitbucket has no labels or manual jobs.

### Line review, an edited note and a pull request

Four new operations (`deleteNote` takes back an automatic comment of the runner), mapped like this (the runner uses them; see [`runner.md`](runner.md)):

| Operation | GitHub | GitLab | Bitbucket Cloud |
|---|---|---|---|
| `editMrNote` | `PATCH issues/comments/{id}` (a PR's conversation comments are issue comments) | `PUT merge_requests/{iid}/notes/{id}` | `PUT pullrequests/{id}/comments/{id}` |
| `deleteNote` (`target`: `issue`, `mr` or `review`) | `DELETE issues/comments/{id}` (the conversation comment of an issue or a PR) or `DELETE pulls/comments/{id}` (a review's comment on a line or a file) | `DELETE issues/{iid}/notes/{id}` or `DELETE merge_requests/{iid}/notes/{id}` (a review's comment is a note of the MR) | `DELETE issues/{id}/comments/{id}` or `DELETE pullrequests/{id}/comments/{id}` |
| `createMr` | `POST pulls` (`title`, `head`, `base`, `body`) | `POST merge_requests` (`source_branch`, `target_branch`, `title`, `description`) | `POST pullrequests` (`title`, `description`, `source`, `destination`) |
| `submitReview`, the review | **one** call, `POST pulls/{n}/reviews`, with `event` (`REQUEST_CHANGES` or `COMMENT`), `body`, `commit_id` and the line comments | one **discussion** per comment, with the position, and a note with the general text | one **inline** comment per comment and a comment with the general text |
| the verdict | the review's `event` | there is no "request changes" call: the verdict is in the first line of the general text | `POST pullrequests/{id}/request-changes`, last, only when it asks for changes |
| a comment on a line | `line` and `side` (`RIGHT` new, `LEFT` removed); a range with `start_line` and `start_side` | `position[new_line]` (added line), `position[old_line]` (removed) or both (a line that did not change), with `base_sha`, `start_sha` and `head_sha` from the MR's `diff_refs`, read at that moment; a range stands on its last line | `inline: { path, to }` (new file) or `{ path, from }` (old); no range: it stands on the last line |
| a comment on a file | a review comment of its own (`POST pulls/{n}/comments`, `subject_type: file`): the reviews endpoint takes no file comment | `position[position_type]=file` from GitLab 16.10 (the version comes from `GET version`); before that, or when the version cannot be read, on the first line the change touches, saying "this comment is about the whole file" | on the first line the change touches, with the same sentence (there is no file comment) |
| a suggested replacement | a ` ```suggestion ` block | a ` ```suggestion:-N+0 ` block, N = last line − first line of the range | only described, in a plain code block (there is no suggestion) |

GitLab refuses to place the review when the MR's head moved since the comments were positioned (the runner positions from the current diff and passes the commit it used). `ExecMeta.response` hands the caller the JSON the host answered (the comment's id, the PR's number), which the executor still returns as cut text too.

`deleteNote` is the only deletion the closed list of writes accepts: each provider's validator lets a `DELETE` through only at the address of a comment (on GitLab, any other `DELETE` under `projects/` is now refused; on GitHub and Bitbucket each of the two addresses is an entry of the list), with no body, and the comment id must be a positive whole number. On GitHub the general text of a submitted review **is the review**, which the host does not delete: undoing a round deletes its line and file comments and leaves that text. GitLab's and GitHub's DELETE answer 204 with no body, and the executor treats that as success.

### Creating an issue

The `createIssue` operation (`project`, `title`, `body`, `labels`) is what a request between squads becomes when the liaison that received it turns it into work of its squad (the runner uses it, only through `runner/publish.ts` and `runner/door.ts`; see [`runner.md`](runner.md)). An external write like the others: under the liaison's autonomy (autonomous: through the door, audited; otherwise a proposal in Actions), refused in a test workspace.

| | GitHub | GitLab | Bitbucket Cloud |
|---|---|---|---|
| Call | `POST repos/{o}/{r}/issues` with `{ title, body, labels? }` | `POST projects/{id}/issues` with the fields `title`, `description`, `labels?` | `POST repositories/{w}/{r}/issues` with `{ title, content: { raw } }` |
| Labels | the `labels` list | `labels` as text, comma separated (a label with a comma is refused: it would become two) | **none**: Bitbucket's issues have no labels, and the squad's label is left out |
| The issue's number in the answer | `number` | `iid` | `id` |

The title becomes one line and must have text (up to 256 characters); a label may have no comma or line break. The validators accept only this shape to create an issue: on GitHub, the address `repos/{o}/{r}/issues` (not that of an issue that exists) with only `title` and `body` (and `labels`, a list of text), on GitLab only `title`, `description` and `labels` (and a `title` that is required and has text), on Bitbucket only `title` and `content` (with `raw` as text); any other key, another method, another transport or a body in the wrong format is refused before it is stored and before it runs.

### For a release

Two reads and a write that only a release run uses ([`runner.md`](runner.md#a-release)). **`listMrsByTarget(project, branch)`** lists the pull requests (merge requests) aimed at a branch, open and merged (those closed without a merge are left out; the approval and the checks come from `getMr`, one by one): GitHub `GET repos/{o}/{r}/pulls?base=…` as two reads, `state=open` (all of them, up to a page bound) and `state=closed` (the merged ones), so that many closed ones cannot push an open one off the list; GitLab `GET projects/{id}/merge_requests?target_branch=…&state=all`, Bitbucket `GET repositories/{w}/{r}/pullrequests` with the query `destination.branch.name="…" AND (state="OPEN" OR state="MERGED")`. On **Bitbucket** the commit of a pull request comes as 12 characters: the provider reads the full commit (`GET repositories/{w}/{r}/commit/{hash}`) for the open ones and for `getMr`, and when it cannot (or the host answers another commit) it keeps the short one, which nothing compares equal to. Each says whether it comes from a **fork** (`fromFork`: `merge-pr` refuses it). What `getMr` says of the approval serves the gate of `merge-pr`: on GitHub `onHead` is true only when there is an `APPROVED` review **on the head's commit** by an owner, member or collaborator (`commit_id`, `author_association`) and no changes requested by one of them; on GitLab and Bitbucket the API does not give the commit of an approval, so `onHead` is absent and only the approval counts; on all three a check (CI) that cannot be read is `running`, never green. **`getRelease(project, tag)`** returns the release the host published for a tag, or `null`: GitHub `GET repos/{o}/{r}/releases/tags/{tag}` (a draft is not shown: `null`), GitLab `GET projects/{id}/releases/{tag}` (`upcoming_release` or no date is a draft), and **Bitbucket has no releases: it returns `null` without asking the host**. **`closeIssue`** (`project`, `iid`) closes an issue: GitHub `PATCH issues/{n}` with `{ state: "closed" }`, GitLab `PUT issues/{iid}` with `state_event=close`, Bitbucket `PUT issues/{id}` with `{ state: "closed" }`; an external write like the others (the agent's autonomy, or a proposal; refused in a test workspace), and each host's validator accepts it only in that shape.

### Cards and stages

Without `externalTools.cardSource`, cards come from the provider (`vcs/cards.ts`): one card per issue assigned to you (or, by `projects.issues.cardScope`, per open issue of the issue project or only those with one of the `cardLabels`: [`configuration.md`](configuration.md); with no issue project, no labels, or on Bitbucket, whose issues have no labels, "assigned to you" applies), MRs linked by `Closes #n` in their text, the branch name or what the host says. The stage comes from the workspace mapping (`devCycle.stages`: `match` against the status and labels, the highest `rank` wins). With `devCycle.stages` empty, per-provider defaults apply (`vcs/stages.ts`): "In progress", "In review", "Ready to test", "Done" and equivalents; with no signal at all the stage comes from what the MRs are doing (draft, open, approved, merged). An issue item also carries the labels, the milestone and the time of the last update (`updated_at`), which is where a card's priority and the order of the list come from ([`cycles.md`](cycles.md#priority)). What changed since the day began is kept in the workspace's `vcs-cards.json`.

The card scope (`all`, `labels`) keeps the same limits as before: at most 100 issues leave the source (two pages of 100 on GitHub and Bitbucket, the pages the limit needs on GitLab), the MR linking reads at most 25 issues with no MR in any text, and what goes past 8 in the call lands in the "left out" list. An issue beyond the 100 most recent does not become a card, and that is not announced (true of `assigned` as well). GitHub's search has a rate limit of its own (lower) and may be slow to show a just-created issue; the report is cached for 5 minutes, but saving another scope rebuilds it at once. The MRs of the cards do not change with the scope.

### What the interface shows per host

Texts name the configured host and its vocabulary (`{vcsName}`, `{cr}`, `{crMark}`: [`cycles.md`](cycles.md)): "MR" and `app!7` on GitLab, "PR" and `app#7` on GitHub and Bitbucket, "checks" (not "pipeline") on GitHub. What the host does not have is hidden rather than renamed: the issue status block of the Quick actions screen exists only on GitLab (the list of transitions inside it only with `devCycle.quickTransitions`); manual jobs only on GitLab; "choosing another reviewer replaces the current ones" only on GitLab; the "agents read the VCS" switch governs the host's CLI when it has one and the `VcsRead` tool when it does not, and the tracker MCP switch always shows on GitLab and, on GitHub, Bitbucket or with no integration, only with a configured server. An issue and a pull request of the same number on Bitbucket (the two are numbered separately) do not collide: the pull request gets its full path in the ref. Not covered: issues on one host and code on another (the cards, the quick actions and the feedback use only the primary integration).

### What agents may read

| Integration | What the agent may run |
|---|---|
| GitLab with CLI | `glab api projects/...` (MR, issue, discussions, notes, approvals, changes, pipelines), `glab mr view`, `glab issue view` |
| GitHub with CLI | `gh api repos/...` (PRs, issues, comments, reviews, files, commits, timeline, check runs, Actions), `gh pr view`, `gh issue view`; no flag but `--paginate` (`-f`, `-F`, `--input`, `--method` turn `gh api` into a write) |
| Bitbucket, or any API-only integration | the shell stays closed; the `VcsRead` tool (issue, comments, MR, threads, changes, CI) reads through the app. On the open engine it is a tool of its own; on the Claude SDK, an in-process MCP server (`coxia_vcs`) |

The lists are strict regular expressions (one command, no `;`, `&&`, no pipes beyond `| head`, no `..` in paths): `GLAB_READ` and `GH_READ` in `vcs/readPolicy.ts`, tested in `test/shell-allowlist.test.ts` and `test/vcs-read-policy.test.ts`. The "agents read the VCS" switch (`agents.tools.vcsCli`) turns everything off.

### Errors, limits and retries

Every call has a timeout (30 s on the API, 60 s on the CLI). A read retries on network failure, timeout and 502/503/504; a rate limit (`Retry-After`, `x-ratelimit-reset`) is waited out only if the wait is short, otherwise the message says how long to wait. A write is never retried. Messages come in pt-BR or en by the language setting and never carry the token. The CLI and the API give the same error codes (`auth`, `forbidden`, `not_found`, `rate_limited`, `network`, `timeout`, `server`, `invalid`, `unsupported`, `cli_missing`, `no_token`).

### Testing an integration (the wizard)

`probeVcs(integration)` in `src/main/vcs/index.ts` is what the wizard's "Test" button calls: it checks the credential, says who you are, reads the token's permissions (GitLab: `personal_access_tokens/self`; classic GitHub and Bitbucket OAuth: the `x-oauth-scopes` header; fine-grained tokens and app passwords do not say), shows a sample of issues and MRs, the rate limit and what is missing to write. The `vcs:probe` channel also takes a typed token that is not stored yet (desktop only).

### Not verified

- GitHub and Bitbucket were only tested against fake servers with answers modelled on the documentation; no real account. **Writes** of any provider (including the GitLab API executor and `gh api --input`) never ran against a real host: the only real use was a read (`GET`) on GitLab through the `glab` login.
- GitHub's GraphQL for threads (`reviewThreads`) and draft (`markPullRequestReadyForReview`) follows the public schema, with no account to check against.
- Bitbucket: comment `resolve`, PR `draft` and the conflict flag (there is no field) depend on the API version.
- **Deleting a comment** (`deleteNote`): it only ran against fake hosts modelled on the documentation. No real host was seen to accept the `DELETE` of a review comment (`pulls/comments/{id}` on GitHub, a discussion note on GitLab, an `inline` comment on Bitbucket), nor what each host does with the replies to a deleted comment; the token needs write access to issues and pull requests, and someone else's comment is refused by the host (the runner only deletes what it posted).
- **Creating an issue** (`createIssue`): it only ran against fake hosts modelled on the documentation; no real host was seen to accept the `POST` with these fields (in particular `labels` as comma-separated text on GitLab and Bitbucket's `content.raw`, whose issue tracker may be switched off in the repository). The number of the created issue is read from the answer (`number`, `iid` or `id`); an answer without it lets the run that asked go on knowing the issue was not confirmed.
- **Review, edited note and PR creation** (`submitReview`, `editMrNote`, `createMr`): they only ran against fake hosts modelled on the documentation. In particular: GitLab's threshold for `position_type=file` (16.10) is a conservative guess; if it is earlier, the comment just goes on the first line of the change; `position[...]` as form fields (API) or `glab`'s `-f` (which turns it into nested JSON) was not seen accepted by a real GitLab; Bitbucket's `POST pullrequests/{id}/request-changes` and `inline` without `from`/`to` follow the documentation, with no account; on GitHub, file comments are separate calls and show as loose review comments, not inside the review.
- **For a release** (`listMrsByTarget`, `getRelease`, `closeIssue`): they only ran against fake hosts modelled on the documentation. Real GitHub was not seen finding the release of a published pre-release through the tags address (and what it says of a draft), nor GitLab's `released_at` and `upcoming_release` of a release that the project's workflow does not even make, nor the `PUT state_event=close` and the `PATCH state` closing an issue.
- The `VcsRead` tool on the Claude SDK uses `zod` (a peer of the SDK): if it cannot load, the agent runs without the tool.
- The `all` and `labels` card scopes only ran against fake servers (GitHub's search with `label:"a","b"` as OR and GitLab's `labels=` follow the documentation; neither was checked on a real host).
