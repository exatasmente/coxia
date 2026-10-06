# Conversa direta com um agente e as propostas que ela levanta

Este plano decide o *como* das duas coisas que a especificação fixou: a conversa que
pertence a um agente do time e a resposta que pode propor escritas no rastreador,
além do ajuste de permissões por agente que a pessoa pediu no refino. Ele não reabre
o comportamento: cada regra fechada na especificação é tratada como dada.

## O que o plano decide, e com quê

### 1. Onde mora a conversa direta

A conversa direta é uma quinta forma de conversa, ao lado de `run`, `general` e
`channel`. Hoje o tipo da conversa é um dos três (`src/shared/forum.ts:80`), o
cabeçalho que o formato aceita carrega `kind`, `runId`, `squad` e `title` e recusa o
resto (`src/main/forum-core.ts:80-94`, `:271`), e nada numa conversa pertence a um
agente (`src/main/mentions/place.ts:29-46`).

**Decisão:**

- Entra um quarto tipo de conversa, `agent`, em `THREAD_KINDS` (`src/shared/forum.ts`)
  e no `enum` do cabeçalho. O agente dono é gravado no campo `squad` do cabeçalho,
  que já existe e já é aceito (o campo é do canal de um squad; passa a carregar
  também o agente dono de uma conversa direta). Nada de campo novo no cabeçalho: o
  formato do arquivo continua o mesmo, e um app anterior recusa o tipo novo em vez de
  reparar o arquivo.
- O id da conversa é `agent-<id do agente>`; a conversa é única por agente e é criada
  de forma idempotente pelo mesmo caminho que cria os canais de squad
  (`ensureThread`, `src/main/forum-channels.ts:13`), com um título que nomeia o agente.
  Ela é criada na primeira vez que a pessoa abre o agente na equipe, e o
  `forum:list` a garante como já garante a conversa geral e os canais
  (`src/main/forum.ts:52-59`).
- `placeOfThread` passa a reconhecer `agent`: um lugar `kind: 'channel'` com
  `squad: null`, repos do espaço de trabalho, para que o agente leia o que já lê numa
  menção fora de uma execução. Não nasce um tipo de lugar novo — só um tipo de
  conversa. A janela de contexto continua a das últimas 40 mensagens
  (`src/main/mentions/call.ts:90`), e não nasce arquivo de memória.
- A conversa é listada pelo fórum como uma conversa (não como canal), porque
  pertence a um agente e não a um grupo de trabalho: `forumLists`
  (`src/shared/forumView.ts:147`) classifica por `kind === 'channel'` e pelo id da
  conversa geral, então uma conversa `agent` cai na lista de conversas. O filtro por
  squad continua mostrando só o que é daquele squad — a conversa de um agente aparece
  na lista completa.

**Como a conversa responde sem `@`:** o módulo de menções (que já responde tudo fora
de uma execução, `src/main/mentions/module.ts:27-52`) passa a tratar uma mensagem de
uma pessoa numa conversa `agent` como uma chamada ao agente dono, mesmo sem menção.
O agente dono é atendido antes dos mencionados (se alguém escrever `@outro`, o dono
responde e o outro também é chamado, respeitando o teto de 3 menções
`src/shared/forum.ts:157-158`). Uma mensagem de um agente numa conversa direta não
chama ninguém, como hoje nenhum texto de agente chama outro (`callsOf`,
`src/main/mentions/module.ts:22-25`).

**Como o telefone abre:** a lista e a leitura do fórum já são abertas ao navegador
pareado (`src/main/webPolicy.ts:22-25`), e a tela do fórum mostra qualquer conversa
pelo id (`src/renderer/src/screens/cycle/ForumScreen.tsx`). Como a conversa direta é
uma conversa do fórum com id estável, ela aparece e é lida no telefone sem canal novo
e sem mudança na política de acesso. A tela do fórum ganha um atalho para abrir a
conversa de um agente a partir da equipe. O que **não** é verificado nesta etapa é a
conversa exercitada no navegador pareado; fica como verificação (ver "Como será
testado").

### 2. O que uma resposta pode propor

Hoje uma resposta só pode propor uma issue nova, e só dentro de uma execução:
`proposesIssue` devolve `false` fora de uma thread de execução
(`src/main/mentions/answer.ts:77-81`), o publicador só existe na execução
(`src/main/runner/service.ts:1052`) e o módulo dos outros lugares não passa nenhum
(`src/main/mentions/module.ts:38-44`). O esquema da resposta só carrega o campo de
issue quando o lugar é uma execução (`src/main/mentions/call.ts:94`).

**Decisão:** um campo `proposals` no esquema da resposta, ao lado de `text`, com as
operações que o app já escreve na porta: comentar uma issue, pôr/tirar rótulos, mudar
o estado, fechar e abrir uma issue. As operações já existem em `VcsWriteOp`
(`src/main/vcs/types.ts:191`, `:196`, `:198`, `:220`, `:218`) e passam pelo mesmo
caminho (planejar, propor, validar na proposta e na aprovação, executar auditado,
`src/main/actions.ts:167-197`, `:274-276`).

Forma proposta (validada por leitura leniente, como `readProposedIssue`,
`src/main/mentions/call.ts:42-49`):

```
proposals: [
  { op: 'comment',        issue, body }
  { op: 'labels',         issue, add: string[], remove: string[] }
  { op: 'status',         issue, status: string }
  { op: 'close',          issue, body }
  { op: 'createIssue',    title, body, labels: string[] }
] | null
```

O campo entra sempre que o agente **lê o rastreador** (a mesma condição de
`proposesIssue`: `def.tracker` com o padrão do papel, `src/main/mentions/answer.ts:80`)
e o lugar tem um publicador — hoje só a execução tem. Abrir uma issue continua sendo
uma proposta como as outras e depende dessa leitura (regra 8 da especificação).

**Como uma issue nova passa a ser proposta fora de uma execução:** o módulo de
menções ganha um caminho próprio de proposta, sem depender do publicador da execução:
ele monta o comando por `planWrite` e propõe pela mesma porta (`proposeVcsAction`,
`src/main/actions.ts:167`), com a issue do espaço de trabalho como alvo do registro.
Isto estende a proposta de issue (hoje só na execução) para a conversa direta, o canal
e a conversa geral, ao mesmo tempo que estende o campo para as quatro operações de
escrita. As duas mudanças andam juntas porque compartilham o mesmo caminho.

**Quais opções de rótulo e estado:** as opções saem do que o app e o host já
oferem, não de uma lista nova. Rótulos: os que o próprio agente leu do host (ele
tem a leitura) e o rótulo de prioridade e o rótulo de marco que o espaço de trabalho
já conhece (`devCycle.priority.labels`, o rótulo do marco). Estado: os nomes que o
host aceita — no Bitbucket os estados da issue, no GitHub `open`/`closed`, no GitLab
os ids numéricos dos estados da instância. O agente é instruído a só usar o que o
host mostra.

**Como um host sem a operação é dito (regra 15):** a proposta é montada com
`planWrite` e, quando o host não tem a operação, `planWrite` levanta `unsupported`
— é o que já acontece com os rótulos de uma issue no Bitbucket
(`src/main/vcs/bitbucket.ts:463-464`; `issueLabels: false`, `src/shared/vcsCaps.ts:25`)
e com um estado que o host não aceita (`github.ts:538-540`, `gitlab.ts:516-519`). A
proposta indisponível não vira uma proposta em Ações: a conversa recebe uma linha de
sistema dizendo que aquela escrita não existe ali, com o motivo, e nada é escrito.
A verificação usa `vcsCaps` e o `unsupported` que os provedores já levantam; nenhuma
tentativa de uma forma parecida.

**Fechar versus mudar o estado:** são duas coisas. Fechar é a operação de fechar a
issue (`closeIssue`), oferecida onde existe; o estado próprio da issue é
`setIssueStatus`, oferecido onde o host tem um estado. Fechar igual em todo host
**não** é possível com o que o app tem, e isso é decisão registrada da pessoa
(pergunta 3 da especificação); o plano apenas implementa a recomendação: fechar é
fechar onde existe, e o estado próprio é dito com os nomes do host.

### 3. A chave que torna as propostas distintas e não repete

Hoje uma proposta é deduplicada pela `key` em Ações: a mesma key não é criada duas
vezes enquanto está pendente, rodando ou feita (`src/main/actions.ts:181`), e um
lote já roda com uma key por comando (`proposeVcsCommands`, `:274-276`, sufixo `#n`).

**Decisão:** cada proposta de uma resposta leva uma key derivada de
`mention:<thread>:<seq da resposta>:<by>:<n>:<hash do comando>`, em que:

- `<seq>` é a sequência da mensagem da resposta na conversa (as propostas de uma
  mesma resposta nunca colidem com as de outra);
- `<n>` é o índice da proposta dentro da resposta (duas escritas iguais na mesma
  resposta continuam distintas);
- `<hash do comando>` é o hash do corpo/comando planejado, que também é o que a
  auditoria guarda hoje (`bodyHash`, `src/main/actions.ts:447`, `:473`).

Esse desenho é o mesmo princípio do `supersede` já existente: uma proposta mais nova
do mesmo assunto substitui a que espera (`src/main/actions.ts:157-161`), sem que uma
proposta diferente seja engolida pela outra.

### 4. A autonomia por agente fora de uma execução

Hoje a autonomia governa só o que o runner publica (`src/main/runner/publish.ts:930`,
`:1011`, `:1308`) e as escritas diretas auditadas (`runVcsAuto`,
`src/main/actions.ts:461-476`). Fora de uma execução, nenhuma escrita nasce de uma
resposta.

**Decisão:** quando a pessoa ligou `autonomous` naquele agente, uma proposta de
**comentário** ou de **rótulos** roda sozinha, pelo caminho de `runVcsAuto` (mesma
porta, mesma auditoria, com o agente como autor e o hash do corpo). **Fechar e mudar o
estado sempre esperam a pessoa**, qualquer que seja o interruptor: a proposta dessas
duas é sempre criada como proposta em Ações. Abrir uma issue também espera (é uma
escrita que cria um item no rastreador e a especificação não a lista como de baixo
risco). A autonomia é lida no agente **daquela** resposta; o valor da autonomia é
resolvido no momento da resposta e vale para as propostas daquela resposta.

### 5. O "sim" em lote em Ações

Uma resposta pode trazer várias propostas. Hoje cada proposta é uma linha em Ações e
o "sim" é por linha (`approveAction`, `src/main/actions.ts:481`), e já existe o
agrupamento `proposeVcsGroup` para escritas que são uma coisa só (`:203`).

**Decisão:** as propostas de uma mesma resposta são agrupadas por um identificador
comum (`unit.batch`, o `seq` da resposta e a conversa) e a tela de Ações as oferece
juntas: um "sim a todas" aprova cada `ReleaseAction` por si, uma após a outra, com
uma pergunta de confirmação só para o lote. Cada escrita é um registro de auditoria
próprio (o caminho já audita por comando, `src/main/actions.ts:511-523`), e recusar o
lote ou parte dele não escreve o resto. **A tela de Ações é o único lugar de
aprovação** — nada muda nessa fronteira (`src/main/webPolicy.ts:20`).

### 6. As ferramentas ditas por agente

Hoje o que um agente lê do rastreador (`tracker`), o que pode rodar (`shell`) e os
comandos liberados sempre (`allowedCommands`) já são por agente
(`src/shared/config/types.ts:523`, `:527`, `:533`), mas as **ferramentas** (arquivos,
skills, ferramentas do rastreador, CLI do host, subagentes) são uma escolha única do
espaço de trabalho (`AgentToolsConfig`, `:475-485`, campo `tools` em `:592`; padrões
em `src/shared/config/defaults.ts:54`; uso em `src/main/agents.ts:56-66`).

**Decisão:**

- Nasce um campo opcional `tools` no próprio agente, com a mesma forma de
  `AgentToolsConfig`. Ausente, o agente usa o do espaço de trabalho (é o ponto de
  partida, regra 12). Presente, ele **sobrepõe** o do espaço de trabalho para aquele
  agente — campo a campo, de modo que ligar uma ferramenta desligada no espaço de
  trabalho só para aquele agente seja possível (`tools.files: true` no agente mesmo
  com `agents.tools.files: false` no espaço).
- Onde o agente entra: `allowedFor` (`src/main/agents.ts:56`) lê hoje
  `getConfig().agents.tools`; passa a receber as ferramentas efetivas do agente que
  chamou. `wantsVcsTool` (`:447`) e `toolsOf` (`:995`) seguem a mesma resolução.
- **A mudança é de configuração e exige migração:** o esquema do agente ganha o campo
  em `src/shared/config/schema.ts`, o tipo em `types.ts` e os padrões em
  `defaults.ts`; `CONFIG_SCHEMA_VERSION` sobe de 12 para 13
  (`src/shared/config/types.ts:5`) e entra um passo `v12ToV13` em `STEPS`
  (`src/shared/config/migrations.ts:263`). O passo **não levanta nada**: um agente
  sem `tools` continua usando o do espaço de trabalho. A migração não lê o disco nem
  a máquina (`migrations.ts:29-30`).
- A tela do agente (`src/renderer/src/screens/team/TeamSection.tsx:172-180`,
  `:235-259`) ganha os interruptores de ferramentas por agente, com o valor do espaço
  de trabalho mostrado como o de partida e um "seguir o espaço de trabalho" claro.
- **A escrita em arquivos continua impossível por uma conversa.** Mesmo com
  `tools.files` ligado só para aquele agente, uma chamada de menção não recebe
  `confine`: `toolsOf` devolve `Edit`/`Write` apenas com `call.confine`
  (`src/main/agents.ts:998`), e `sdkOptions` mantém `Edit`/`Write` em
  `disallowedTools` fora de uma confinada (`:402-409`). O ajuste por agente é de
  **ferramentas de leitura e de rastreador**, não de confinamento — a regra 13 da
  especificação fica garantida pelo próprio desenho do runtime, não por uma checagem
  de texto.

### 7. Consequências no runtime (o que precisa casar)

- `MentionPlace.kind` ganha `'agent'` ou reusa `'channel'`; a decisão é **reusar
  `channel`** para não espalhar o tipo por todo o caminho de menção, com o agente dono
  vindo do cabeçalho da conversa. `placeOfThread` (`src/main/mentions/place.ts`) lê o
  dono de uma conversa `agent` e o devolve no `MentionPlace`.
- `answerMentions` passa a receber o agente dono do lugar e a propor pelo caminho do
  módulo (não só pelo publicador da execução): hoje a proposta de issue é chamada só
  para `place.kind === 'run'` (`src/main/mentions/answer.ts:153-156`); passa a valer
  para qualquer lugar com o agente dono ou menção, com um `propose` injetado.
- `mentionCall` (`src/main/mentions/call.ts:94`) recebe `proposals: boolean` em vez de
  `issue: boolean` (a issue vira uma das propostas) — ou mantém `issue` e ganha o
  campo novo; a decisão é **substituir** `issue` por `proposals`, mais simples de
  ler, ajustando os dois chamadores (`answer.ts`, `ceremony.ts`). A cerimônia continua
  sem propostas (`issue: false`, `src/main/mentions/ceremony.ts:67`).
- O texto de sistema da menção ganha uma linha dizendo que o agente pode propor
  escritas e que elas esperam o sim em Ações (`prompt.sdd.runner.mention.issue` já
  diz isso para a issue; ganha a versão para as demais operações, nos dois catálogos
  de idioma).
- O lugar `host` de um agente com `shell: host` numa conversa direta: hoje um lugar
  de menção não tem tela para perguntar e a sessão de host recusa toda comando
  (`approve` devolve `{ ok: false }`, `src/main/mentions/answer.ts:213-216`). **Não
  muda nesta entrega** — a conversa direta é um lugar de menção como os outros, e o
  agente que roda no computador continua precisando de um lugar com tela de pedido (a
  execução). Isso fica explícito no plano de teste como comportamento não prometido.

## Riscos e como são cobertos

| Risco | Cobertura |
|---|---|
| A conversa `agent` quebra o arquivo do fórum para um app anterior | Tipo novo no `enum` do cabeçalho: um app anterior **recusa** o arquivo em vez de reparar (mesmo padrão da versão 4 de configuração, `migrations.ts:14-15`). O id e o dono vão em campos que já existem. |
| Uma proposta fora da execução fica sem dono no registro de Ações | Toda proposta leva a issue-projeto do espaço de trabalho como alvo e a chave derivada da conversa/resposta; a auditoria guarda `origin` com a chave e o `by` do agente (`src/main/actions.ts:436-448`). |
| Fechar em um host que não tem o conceito | `planWrite` levanta `unsupported` e a proposta não é criada; a conversa diz o motivo (regra 15). Teste por host com os `caps`. |
| Autonomia rodando o que não devia fora de uma execução | Só comentário e rótulos passam por `runVcsAuto`; fechar, estado e abrir issue sempre propõem. A regra é testada com o interruptor ligado. |
| Uma ferramenta ligada só para um agente furar a leitura somente | `confine` continua ausente numa menção: `Edit`/`Write` só existem numa execução. Teste do `toolsOf` e do `sdkOptions` com `tools.files` ligado num agente. |
| Migração de configuração perdendo o que a pessoa tinha | O passo só acrescenta o campo opcional; nada é levantado, e um agente sem o campo usa o do espaço de trabalho. Teste de migração v12→v13. |

## Como será testado

Testes de unidade (vitest, falsos em `test/helpers/`; nenhum teste alcança um modelo
real, um host real ou a rede):

1. **Fórum:** uma conversa `agent` é criada por agente, é idempotente, aparece na
   lista como conversa (não como canal), e o cabeçalho é aceito pelo formato.
2. **Lugar e chamada:** uma mensagem de pessoa numa conversa `agent` chama o agente
   dono sem `@`; com `@outro`, os dois são chamados dentro do teto; uma mensagem de
   agente não chama ninguém; duas mensagens seguidas são respondidas em ordem.
3. **Esquema da resposta:** uma resposta com `proposals` é lida lenientemente; uma
   proposta inválida é descartada sem derrubar a resposta.
4. **Proposta por operação:** comentar, pôr/tirar rótulos e fechar geram as propostas
   certas em Ações; a chave distingue duas propostas iguais na mesma resposta e não
   repete entre respostas.
5. **Host sem a operação:** com `caps.issueLabels: false` a proposta de rótulos é dita
   indisponível e nada é proposto; o mesmo para um estado que o host recusa.
6. **Autonomia:** com o interruptor ligado, comentário e rótulos rodam por
   `runVcsAuto` e ficam auditados; fechar e mudar estado continuam propostas.
7. **Lote:** o "sim a todas" aprova cada escrita por si e gera um registro por
   escrita; recusar parte não escreve o resto.
8. **Permissões por agente:** um agente com `tools` sobrepõe o do espaço de trabalho,
   inclusive ligando uma ferramenta desligada no espaço; os outros agentes não mudam;
   e uma menção nunca recebe `Edit`/`Write` mesmo com a ferramenta ligada.
9. **Migração:** um config v12 sem `tools` por agente migra para v13 sem levantar nada
   e mantém o comportamento.
10. **Espaço de teste:** num espaço de trabalho de teste toda proposta dessas é
    recusada na confirmação (o guarda de efeito externo já recusa,
    `src/main/actions.ts:440`).

Verificações de tela (as que a especificação marca como não verificadas e precisam ser
fechadas no teste, não aqui):

- **O telefone pareado:** abrir a conversa direta no navegador pareado, ler e
  responder. A lista e a leitura do fórum já são abertas (`webPolicy.ts:22-25`), mas a
  tela da conversa em si **não foi vista**; fica como verificação do plano de teste.
- **Sem memória entre conversas:** abrir duas conversas diretas seguidas e confirmar
  que a segunda não traz o contexto da primeira.

Gates do repositório, ao final do desenvolvimento: `npx tsc --noEmit`,
`npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`,
`node scripts/public-audit.mjs`.

## O que fica fora deste plano, de propósito

- Uma forma nova de aprovar fora de Ações.
- Memória entre conversas, resumo ou arquivo que a guarde.
- Um canal entre dois agentes.
- Dar escrita em arquivos a uma conversa.
- Mudar o que um agente lê do host (só o que ele pode **propor** muda).
- Empacotar o SDK.
- Um pedido de comando (`shell: host`) por uma conversa: continua sendo da execução,
  onde há tela para perguntar.

## Onde o plano encosta no que já existe (arquivos, funções)

- Fórum: `src/shared/forum.ts` (`THREAD_KINDS`), `src/main/forum-core.ts` (cabeçalho,
  `ensureThread`), `src/main/forum.ts` (`forum:list`, criação), `src/shared/forumView.ts`
  (lista), `src/main/forum-channels.ts` (criação idempotente).
- Menção: `src/main/mentions/place.ts` (`placeOfThread`), `src/main/mentions/call.ts`
  (esquema e texto), `src/main/mentions/answer.ts` (`proposesIssue`, proposta),
  `src/main/mentions/module.ts` (chamada sem `@`, caminho de proposta),
  `src/main/mentions/ceremony.ts` (segue sem propostas).
- Porta de Ações: `src/main/actions.ts` (`proposeVcsAction`, `proposeVcsGroup`,
  `runVcsAuto`, `approveAction`), `src/main/vcs/types.ts` (`VcsWriteOp`),
  `src/main/vcs/validate.ts` (forma do comando).
- Configuração: `src/shared/config/types.ts`, `defaults.ts`, `schema.ts`,
  `migrations.ts` (`STEPS`, v12→v13), `src/main/agents.ts` (`allowedFor`, `toolsOf`,
  `sdkOptions`), `src/renderer/src/screens/team/TeamSection.tsx`.
- Tela: `src/renderer/src/screens/cycle/ForumScreen.tsx` (conversa direta e atalho),
  `src/renderer/src/screens/Actions.tsx` (lote).

## Estado do que foi conferido nesta etapa

Todo o levantamento é **leitura do código desta árvore de trabalho**; nada foi
executado e nada foi visto funcionando no aplicativo. Não verificado: a conversa
direta no telefone pareado e a ausência de memória entre conversas, que a verificação
precisa fechar; e a proposta de issue pelo módulo de menções fora da execução, que
hoje não existe (`src/main/mentions/module.ts:38-44`).
