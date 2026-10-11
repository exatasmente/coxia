# As discussões de uma MR que não é card do dia

- Issue: #257 "Open a merge request's discussions from a conversation when the MR is not a card of the day".
- Etapa: Refinamento. A triagem está em `0_TRIAGE.md`.

## O que muda para quem usa

Quem está conversando pede as discussões de uma merge request e a tela abre, com os threads não
resolvidos daquela MR, **mesmo quando ela não é um card do dia**. Hoje a tela de discussões só
existe dentro de um card do dia: ela recebe a referência de um card, procura o card entre os de
hoje e tira a MR da lista de MRs daquele card; um número de MR nunca serve de referência, então a
pedida cai no aviso "Atividade não encontrada" e não há como ver nem seguir as discussões.

Duas superfícies levam hoje a esse pedido, e as duas passam a funcionar: os **botões** que a
persona oferece sob uma resposta no chat, e uma **resposta de agente numa conversa** (o app não tem
hoje nenhuma ferramenta de ação fora da persona — ver "Onde o trabalho está").

O que muda, em uma frase: a MR deixa de ter de ser card do dia para as discussões dela serem vistas
numa tela aberta da conversa.

## Onde o trabalho está (o que a spec resolve e o que não)

Tudo abaixo foi conferido por leitura neste worktree; **nada foi executado e nenhuma tela foi vista
funcionando**.

| O que | Onde está hoje |
|---|---|
| A tela de discussões é roteada pela referência de um card; sem card carregado devolve "Atividade não encontrada" | `src/renderer/src/App.tsx:69`, `App.tsx:259`; `src/renderer/src/screens/Discussions.tsx:134-136`; texto `src/shared/i18n/ui-gate.en.json:38` |
| A lista de MRs da tela vem só de `card.mrPaths` | `src/renderer/src/screens/Discussions.tsx:42`; `src/shared/types.ts:20`; os `mrPaths` nascem das MRs ligadas à issue (`src/main/cards.ts:102`, `src/main/vcs/cards.ts:166-170`) |
| O número da MR nunca é referência de card: `ref` é a da issue (`#n`) | `src/main/vcs/cards.ts:190`; `src/main/conflictFromMr.ts:11-25` |
| A leitura de threads por projeto + número já existe | `src/main/vcs/readTool.ts:7`, `readTool.ts:83-88` |
| A restrição de projeto do workspace só existe na ferramenta de leitura do agente, não no caminho da tela | `src/main/vcs/readTool.ts:48-64`; `src/main/feedback.ts:402-407` |
| O rigor de quem pode ser perguntado, numa conversa | `src/main/mentions/answer.ts:201-216`, `answer.ts:397-399` |
| O destino `discussions` da notificação e do botão exige `ref`, e a tradução dele exige `ref` | `src/shared/push.ts:28`, `push.ts:44-48`; `src/renderer/src/pushTarget.ts:29`; `src/main/persona/openScreen.ts:60-63`, `openScreen.ts:80-84` |
| Os botões são palavras do app, não do modelo | `src/renderer/src/chatModel.ts:132-169`; `src/shared/i18n/ui-persona.en.json:11` |
| Hoje nenhum agente fora da persona tem ferramenta de ação: só leitura, chamada a um par e as tarefas da persona | `src/main/mentions/answer.ts:395-435` |
| O esquema da configuração vai até 30; `runner.mcpState` é a v24, `runner.unconfined` a v25, os pools a v26, `runner.sharedMemory` e `docs.roadmapFile` a v27, `runner.showReasoning` a v28, os turnos dos subagentes a v29, `kind` da persona a v30 | `src/shared/config/types.ts:5`; `src/shared/config/migrations.ts:41-60` |
| O motor de configuração é o `agentFlow`: "Refine" no rank 2, `produces: ['1_SPEC.md']` | `src/shared/cycles/templates/agentFlow.ts:7-29` |

## Regras

Numeradas; o que fica de fora está em "Fora de escopo".

1. **A tela de discussões passa a poder ser aberta por uma MR identificada por projeto e número**,
   sem card do dia carregado. O número da MR é o `iid` que o host mostra, e o projeto é o
   `group/repo` como nos `mrPaths`.
2. **A porta é a conversa.** O pedido chega por uma destas duas superfícies; nada mais abre a tela
   por projeto + número:
   - o **botão** que a persona oferece sob a resposta (regra 9);
   - a **ferramenta de ação de um agente que responde numa conversa** (regra 15).
3. **A MR tem de estar ao alcance de quem pediu.** Antes de abrir, o app confere a MR ao alcance do
   dono do pedido (regra 4) e, ao abrir a tela e a explicação, confere de novo o projeto da MR
   contra os projetos do workspace (regra 5).
4. **Quem pode pedir:**
   - numa conversa **do computador ou de um navegador pareado**, a persona (o pedido é o botão) e
     qualquer agente que responda ali pelo fluxo normal de menção;
   - numa **execução** (a conversa de uma run): todos, porque o escopo já é a execução e a lista de
     projetos permitidos é escolhida por ela;
   - a persona é sempre do workspace e não tem estreitamento de escopo.
5. **A leitura da tela fica com o rigor do workspace.** Hoje `listDiscussions` e `explainDiscussion`
   chamam o provedor direto, sem lista de projetos permitidos (`src/main/feedback.ts:402-412`).
   Passam a conferir o projeto da MR contra os projetos do workspace, com o mesmo `projectAllowed` e
   o mesmo "strict" da ferramenta de leitura (`src/main/vcs/readTool.ts:48-64`): o projeto de issues
   quando o workspace não nomeia repositórios, ou os repositórios nomeados; um workspace que não
   nomeia nenhum projeto recusa a leitura com o motivo, nunca em silêncio.
6. **A recusa diz o motivo e o que fazer.** Uma MR fora do alcance não abre a tela: a resposta diz
   o que aconteceu (a MR não é deste workspace / o agente não a alcança), em português e inglês, nas
   palavras do app. A recusa chega como texto ao modelo (que a repete na resposta) e/ou como aviso
   na tela, nunca como um "não encontrado" sem razão.
7. **A tela abre com os threads não resolvidos da MR pedida.** O comportamento da lista e da
   explicação é o de hoje: só threads não resolvidos (`isUnresolved`), a explicação como está, a
   lista lida de novo quando a tela abre se o trabalho anterior não está mais na memória
   (`src/main/feedback.ts:402-407`, `src/renderer/src/screens/Discussions.tsx:57-60`).
8. **Um card do dia continua abrindo a tela como hoje.** As entradas existentes (a linha de
   discussões de um card no dia, o botão de discussões da reentrada) não mudam de comportamento, e
   o `ref` continua sendo a referência da issue.
9. **O botão da persona passa a valer sem card do dia.** O destino `discussions` deixa de exigir a
   referência de um card do dia; passa a levar **projeto + número** da MR, e o botão abre a tela
   pela MR. Onde houver card, a referência continua valendo como hoje.
   - O **número da MR não é hoje um campo do destino**: `PushTarget` tem `ref`, `id` e `mr` e
     nenhum deles é o número (`src/shared/push.ts:4-9`). A spec pede um campo de número no destino —
     o nome dele é decisão da proposta técnica (Q1).
   - As regras do botão continuam: o app escreve as palavras do botão, no máximo quatro por
     resposta, o destino é validado de novo pelo app, e um botão já dado não se repete
     (`src/main/persona/openScreen.ts:14-15`, `openScreen.ts:39-51`).
10. **O rótulo do botão de discussões passa a poder ser dito com a MR**, não com a referência do
    card: em vez de "Abrir as discussões de #123", algo como "Abrir as discussões de
    <group/repo>!<n>". A chave nova vai nos **dois** catálogos (`src/shared/i18n/ui-persona.pt-BR.json`,
    `ui-persona.en.json`).
11. **Toda string nova passa por `t()`**, nos dois catálogos, e o texto do botão continua sendo do
    app, nunca do modelo.
12. **O host decide o que uma MR é.** A leitura de threads continua sendo a que o provedor já
    oferece (`listMrThreads`/`getMrThread`): a mesma chamada, o mesmo caminho neutro, o mesmo
    provedor primário. Nada de um endpoint novo por host.
13. **A explicação de um thread não depende mais de um card inteiro.** Hoje a explicação recebe o
    card e usa a referência, o título e a especificação dele no texto entregue ao agente
    (`src/main/feedback.ts:409-419`). Onde houver card (regra 8), a explicação continua como está;
    onde não houver, ela explica com o que existe (a MR e o thread) — o texto do prompt perde a
    linha do card quando ela não existe. A **proposta de resposta/resolução** continua como está:
    exige o card (`src/main/feedback.ts:458-479`), e sem card a tela não oferece propor.
14. **Nada é escrito no host por esta mudança.** A fila de Ações continua igual: uma resposta ou uma
    resolução só viram proposta com um card, e a confirmação continua na tela de Ações
    (`src/main/feedback.ts:446-447`).
15. **Um agente que responde numa conversa ganha uma ferramenta de ação, e só esta:** abrir as
    discussões de uma MR. Ela:
    - recebe o **projeto** e o **número** da MR, e confere os dois contra o que o agente alcança
      (regras 4 e 5), numa run contra a lista de projetos da execução;
    - **não abre nada no servidor**: devolve ao agente o destino que a conversa já usa (como
      `OpenScreen` faz hoje), e a tela abre quando a pessoa toca;
    - entra pela lista de ferramentas de conversa da resposta (`call.runnerTools`,
      `src/main/mentions/answer.ts:395-435`), que é também por onde a persona recebe a dela (o
      encaixe é da proposta técnica, Q2).
16. **Quando quem pede não é a persona, a conversa abre o alvo no dispositivo do pedido.** O
    destino não vira botão: a tela abre no dispositivo que está à frente do pedido — a janela quando
    o pedido partiu do computador, o navegador pareado quando partiu dele —, e as linhas do sistema
    no thread dizem que a tela foi aberta, com projeto e número da MR. É a única forma hoje de um
    agente abrir uma tela numa conversa: a persona só oferece, e nenhum outro agente tinha
    ferramenta de ação.
17. **Uma run vira um aviso.** Quando o pedido parte de uma conversa de execução, abrir uma tela não
    mexe na janela de ninguém (pode não haver ninguém olhando). A conversa da run registra a linha
    com o pedido e o alvo, e a pessoa abre a tela pelo aviso.
18. **A pessoa pode recusar.** A conversa oferece "abrir" e "deixar aqui" no pedido, e o pedido não
    abre a tela se a pessoa não tocar. (A forma de apresentar o pedido é decisão técnica, Q2; o que
    é produto é que a abertura nunca aconteça sem um ato da pessoa.)
19. **Um aviso que leva à tela leva projeto e número.** Onde a tela `discussions` continuar a ser
    destino de notificação ou de push, o pagamento é feito com os dois campos, e a tela abre a MR
    certa. Um aviso sem os dois continua recusado (como hoje), com motivo.
20. **A varredura de feedback não muda de escopo.** O detector continua lendo as MRs dos cards do dia
    (`src/main/feedback.ts:188-196`). Esta mudança não faz o app vigiar MR que não é card do dia.
21. **Parede invisível.** Um número que não é MR, ou um projeto fora do formato `group/repo`, é
    recusado com o motivo, como o `VcsRead` recusa (`src/main/vcs/readTool.ts:38-40`; `checkIid`,
    `src/main/vcs/util.ts`).
22. **Um só provedor.** A leitura é a do provedor primário da integração; issues em um host e código
    em outro continuam fora (`docs/vcs-providers.md`).

## Fora de escopo

- **Escrever sem proposta.** A fila de Ações fica como está: nada chega ao host sem o "sim" da
  pessoa (`src/main/feedback.ts:446-447`).
- **Ler os threads de uma MR pela ferramenta `VcsRead`** (`mr_threads`/`mr_comments`), que já
  funciona hoje (`src/main/vcs/readTool.ts:83-88`). O que faltava era a superfície da tela.
- **Uma ferramenta de ação geral para a persona** (aprovar ações, escrever no host, rodar comando).
  A única ferramenta nova desta mudança é a de abrir as discussões (regra 15).
- **Trocar a conversa do agente que não é a persona** por um fluxo de botões; ela continua com a
  resposta estruturada que já tem.
- **A regra que exige `ref` para os cards do dia** continua intacta (`src/shared/push.ts:28`).
- **Varrer MRs que não são do dia** (regra 20).
- **Voz, notificação nova, ou um painel de discussões fora do card.**
- **Um botão que abre a tela em qualquer dispositivo** que não seja o que tocou.

## Critérios de aceite

Cada um é uma verificação de tela ou de teste, com a pasta de dados apontada para uma vazia e um
modelo falso. Nada aqui foi executado nesta etapa.

1. **O caso da issue.** Numa conversa, pedir as discussões de uma MR que **não** é card do dia: a
   tela abre com os threads não resolvidos daquela MR. (Antes: a tela devolve "Atividade não
   encontrada".)
2. **Projeto fora do workspace.** Pedir as discussões de uma MR de um projeto fora do escopo: a
   resposta diz que a MR não é deste workspace, sem abrir a tela, nos dois idiomas.
3. **Um card do dia continua igual.** Abrir as discussões de um card do dia pela linha do dia: a
   tela abre como hoje, com o `ref` da issue.
4. **Um agente que não é a persona.** Numa conversa com um agente (não a persona), pedir as
   discussões de uma MR que não é card do dia: o pedido chega com o alvo, a pessoa toca e a tela
   abre no dispositivo onde ela tocou; o thread mostra a linha do que foi aberto.
5. **Uma conversa de execução.** Numa conversa de run, o pedido de um agente vira uma linha com o
   alvo e um aviso; a janela de ninguém é movida sem um ato da pessoa.
6. **Recusa por número inválido.** Um número de MR que não existe, ou fora do formato, dá recusa com
   o motivo (nunca uma tela aberta em branco).
7. **Recusa por workspace sem projetos.** Um workspace que não nomeia projeto de issues nem
   repositórios não abre a tela, e a recusa diz o que fazer (nomear o projeto nas configurações).
8. **A leitura restrita.** A lista e a explicação da tela conferem o projeto da MR contra os projetos
   do workspace: um projeto fora da lista não é lido pelo provedor.
9. **O botão novo.** A persona oferece um botão com a MR (projeto + número) e ele abre a tela; o
   rótulo vem dos catálogos e cita a MR; o destino passa na validação de novo.
10. **O teto de botões não muda.** Quatro botões por resposta, sem repetição, como hoje.
11. **Nada é escrito.** Mesmo com a tela aberta por uma MR sem card, responder ou resolver continua
    virando uma proposta que espera o "sim" em Ações.
12. **A explicação sem card.** Explicar um thread de uma MR que não é card do dia funciona (o texto
    da explicação não traz a linha da especificação de um card, e não quebra).

## Decisões e sugestões desta etapa

- **Prioridade proposta: `priority:medium`.** O motivo, no resumo: a limitação tem contorno (a
  leitura por ferramenta já existe), mas é fricção diária de quem acompanha MR numa conversa — o
  vocabulário do rótulo é exatamente "small, daily friction". Não é `priority:high` (não é dinheiro,
  confiança ou fronteira de segurança) nem `priority:low` (não é uma direção nova).
- **Marco: o próximo ciclo** (nenhum marco é configurado; ver Q5).
- **Squad proposto: `experiencia`**, como na triagem: a mudança é de superfície (a tela, a rota, a
  recusa nos dois idiomas) e a leitura já existe na fronteira neutra de código.
- **A etapa de plano precisa dos dois pontos que a triagem achou:** o rigor de projeto (regra 5) e a
  explicação sem card (regra 13) — não são o comportamento de hoje, têm de ser construídos.

## Como foi conferido

Por leitura, neste worktree: a issue #257 e o comentário dela, `0_TRIAGE.md`, e no código as linhas
citadas em "Onde o trabalho está" — o roteamento e a tela de discussões, os `mrPaths` desde o
relatório até o card, a ferramenta `VcsRead` e o `projectAllowed`, a lista e a explicação de
discussões e a fila de propostas, a lista de ferramentas de conversa e o `CallAgent`, o `OpenScreen`
da persona, a validação dos destinos de notificação e a tradução deles para tela, os catálogos e os
rótulos de botão, os estágios do `agentFlow` e as versões do esquema.

Buscas no quadro de issues (GitHub, `is:issue`): "discussions card of the day" (só esta issue) e
"persona button screen" (nada). Nenhuma duplicada.

**Não verificado:** nada foi executado (nenhum comando, nenhum teste), a tela não foi aberta, e o
comportamento de hoje é o que a leitura do código diz.

## Perguntas abertas

As que são decisão da pessoa estão marcadas; as demais bloqueiam a proposta técnica.

- **Q1. Onde o número da MR entra no destino.** O `PushTarget` tem `ref`, `id` e `mr` e nenhum é o
  número. Opções: um campo novo (ex.: `num`), usar `id` (hoje "o id de uma run, de um conflito ou de
  uma conversa"), ou `mr` carregar `project!iid`. Decisão técnica, com a pessoa no aceite.
- **Q2. Como o pedido de um agente que não é a persona aparece na conversa.** A forma (tool call,
  texto, um "abrir" que a pessoa toca) e o encaixe da ferramenta são da proposta técnica; o que é
  produto é a regra 18 (nunca abre sem um ato da pessoa) e a regra 16 (abre no dispositivo do
  pedido). **A pessoa decide** se a forma geral de um agente abrir uma tela deve ser esta.
- **Q3. O que acontece quando o pedido parte de um dispositivo que não é o da pessoa que pediu.** A
  regra 16 resolve: o dispositivo do pedido. Resta saber se a pessoa quer que o celular pareado
  também possa receber o pedido. **Decisão da pessoa.**
- **Q4. Explicar sem card.** Sem card, a explicação perde a linha da especificação. A spec confirma
  que a explicação continua (regra 13) — **decisão da pessoa**, com a alternativa de a tela só
  listar os threads quando não houver card.
- **Q5. Marco.** Nenhum marco está configurado e não há fila declarada; a spec propõe "o próximo
  ciclo" sem nome. **Decisão da pessoa.**

## Riscos

- **A superfície de abrir uma tela por projeto + número não é só renderer.** `push.ts`,
  `pushTarget.ts` e o `OpenScreen` da persona também exigem a referência; uma mudança só no renderer
  deixa o caminho do botão e o do aviso quebrados.
- **O workspace sem projetos.** `projectAllowed` com lista vazia e "strict" recusa tudo; a recusa
  precisa de texto nos dois idiomas, e a spec não fixa o texto.
- **Escopo de um agente em conversa.** Hoje só a persona tem escopo de tela; um agente de conversa é
  um agente de leitura como qualquer outro, e o rigor dele precisa ser o mesmo da regra 5 para não
  virar uma porta mais larga.
- **O dispositivo certo.** Um pedido feito no celular pareado não pode abrir a tela no computador (e
  vice-versa); a regra 16 depende de o app saber qual superfície respondeu.
- **A explicação gasta modelo.** Ela chama o papel `deep` (`src/main/feedback.ts:421-426`); uma tela
  aberta sem card continua gastando, e isso é o comportamento de hoje.
