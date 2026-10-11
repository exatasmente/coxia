# As discussões de uma MR que não é card do dia

Duas superfícies de conversa passam a poder abrir as discussões de uma merge request que não está
no dia: o **botão** que a persona oferece sob a resposta, e uma **resposta de agente numa conversa**,
que ganha uma ferramenta de ação para isso. Projeto e número da MR passam a ser, além da referência
de um card, uma forma de dizer qual MR abrir. A leitura da tela passa a ter o rigor de projeto do
workspace, e a explicação de cada thread passa a funcionar sem o card no prompt.

## O que muda para quem usa

Quem está conversando pede as discussões de uma merge request e a tela abre, com os threads não
resolvidos daquela MR, **mesmo quando ela não é um card do dia**. Hoje a tela de discussões só entra
por um card: ela é roteada pela referência de um card, procura o card entre os carregados (ou usa o
card que veio no próprio pedido) e tira a lista de MRs de dentro daquele card; um número de MR nunca
é a referência de um card, então o pedido cai no aviso "Atividade não encontrada" e não há como ver
nem seguir as discussões.

Quem pede isso o faz por uma conversa: hoje, os botões que a persona oferece ("Open the discussions
for {ref}") ou, quando quem responde é um agente comum, a resposta dele. As duas passam a funcionar
sem o card do dia.

O que muda, em uma frase: a MR deixa de ter de ser card do dia para as discussões dela serem vistas
numa tela aberta da conversa.

## Onde o trabalho está (o que a spec resolve e o que não)

Conferido por leitura neste worktree, arquivo a arquivo; **nada foi executado nesta etapa e nenhuma
tela foi vista funcionando**. Linha a linha é uma foto de hoje: o plano técnico confere antes de
mexer.

| O que | Onde está hoje |
|---|---|
| A tela de discussões é roteada por uma referência de card, e resolve o card entre os carregados ou no card que veio no pedido; sem card devolve "Atividade not found." | `src/renderer/src/App.tsx:69`, `App.tsx:259-260`; `src/renderer/src/screens/Discussions.tsx:138-140`; texto `src/shared/i18n/ui-gate.en.json:38`, `ui-gate.pt-BR.json:38` |
| A lista de MRs da tela vem só de `card.mrPaths`, e a leitura por card acontece no máximo uma vez por MR (a lista viva não é relida enquanto o trabalho do card estiver na memória) | `src/renderer/src/screens/Discussions.tsx:42`, `:58-70`; `src/shared/types.ts:20`; os `mrPaths` nascem das MRs ligadas à issue (`src/main/cards.ts:94`, `cards.ts:102`) |
| Explicar e propor exigem o card | `Discussions.tsx:60`, `:105`; `src/main/feedback.ts:409` (explicação), `feedback.ts:447` e `:471` (proposta) |
| O número da MR nunca é referência de card: a referência é a da issue | `src/main/vcs/cards.ts:88-91`, `:190` |
| A leitura de threads por projeto + número já existe na ferramenta do agente, com a lista de projetos do workspace e a recusa com motivo | `src/main/vcs/readTool.ts:8`, `:39-40`, `:48-51`, `:57-63`, `:83-84`; a lista sai do workspace (`workspaceProjects`), não da execução |
| A restrição de projeto do workspace **não** existe no caminho da tela: `listDiscussions` e `explainDiscussion` chamam o provedor direto; a única validação ali é o formato de projeto, número e referência | `src/main/feedback.ts:402-404`, `:409-412`; `feedback.ts:68-71` |
| O destino `discussions` exige uma referência em três lugares: o destino de notificação, a tradução dele para tela e o botão da persona | `src/shared/push.ts:29`, `:46`; `src/renderer/src/pushTarget.ts:27-28`; `src/main/persona/openScreen.ts:60-63` |
| `PushTarget` tem `to`, `ref`, `id` e `mr`: `mr` é a **referência** de uma MR, e nenhum dos campos é um número de MR | `src/shared/push.ts:4-9`; `pushTarget.ts:28` |
| Os botões são palavras do app, no máximo quatro por resposta, sem repetição; o rótulo de discussões cita a referência | `src/renderer/src/chatModel.ts:131-169`; `src/shared/i18n/ui-persona.en.json:11`; teto e repetição em `src/main/forum-core.ts:113` e `src/main/persona/openScreen.ts:41-45` |
| Hoje nenhum agente fora da persona tem ferramenta de ação: só a chamada a um par e as tarefas da persona | `src/main/mentions/answer.ts:395-435` |
| A explicação consome o papel `deep` | `src/main/feedback.ts:425-430`; o prompt monta a referência, o título e a linha da especificação do card (`feedback.ts:415-424`, chave `prompt.sdd.discussion.specLine` em `src/shared/i18n/en.json:511`) |
| Os cartões do dia já recebem MRs lidas por número, mesmo fora do escopo de issues do dia | `docs/cycles/83-own-board-in-coxia-with-optional-code-ho/phase-2/1_SPEC.md:109` |
| O destino de conversa é do vocabulário de notificação, e a forma é a de hoje: `ref`, `id`, `mr` | `docs/cycles/247-persona-chat/1_SPEC.md:110`, `:116` |

## Regras

Numeradas; o que fica de fora está em "Fora de escopo".

1. **A tela de discussões passa a poder ser aberta por uma MR identificada por projeto e número**,
   sem card carregado. O número da MR é o número que o host mostra para ela, e o projeto é o mesmo
   `group/repo` que os cards carregam.
2. **A porta é a conversa.** Um pedido por projeto + número chega por uma destas duas superfícies;
   nada mais abre a tela por projeto + número:
   - o **botão** que a persona oferece sob a resposta (regra 9);
   - a **ferramenta de ação de um agente que responde numa conversa** (regra 15).
3. **Quem pode pedir:**
   - numa conversa no computador ou num navegador pareado, a persona (o pedido é o botão) e qualquer
     agente que responda ali pelo fluxo normal de menção;
   - numa conversa de execução, todos os agentes que ali respondem.
4. **A MR tem de estar ao alcance do workspace.** A leitura da tela confere o projeto da MR contra os
   projetos do workspace antes de ler qualquer coisa do host, tanto na lista quanto na explicação.
   **No caso de execução, a lista é estreitada pelo escopo da execução**, como na regra 5 de hoje.
5. **A leitura da tela fica com o rigor do workspace.** Onde hoje o caminho da tela vai ao provedor
   direto, a lista e a explicação passam a usar a mesma checagem da ferramenta de leitura: o projeto
   de issues quando o workspace não nomeia repositórios, ou os repositórios nomeados; um workspace
   que não nomeia nenhum projeto recusa a leitura **com o motivo**, nunca em silêncio, e é um erro do
   workspace, não uma tela vazia por MR inexistente.
6. **A recusa diz o motivo e o que fazer.** Uma MR fora do alcance não abre a tela: a recusa chega a
   quem pediu (o modelo que a repete na resposta, e/ou um aviso na tela), em português e em inglês,
   nas palavras do app, nunca como um "não encontrado" sem razão. A leitura continua restrita aos
   projetos permitidos do workspace, com o mesmo rigor da ferramenta de leitura.
7. **A tela abre com os threads não resolvidos da MR pedida.** A lista e a explicação continuam como
   hoje: só threads não resolvidos, uma explicação por vez, a mesma voz. Além do comportamento de
   hoje, uma tela pedida por uma MR **lê a lista quando abre, uma vez por MR**, mesmo que o trabalho
   daquele card esteja na memória (uma MR fora do dia pode ter mudado desde a última leitura).
8. **Um card do dia continua abrindo a tela como hoje.** A linha de discussões de um card no dia e o
   botão de discussões da reentrada não mudam de comportamento, e a referência continua sendo a da
   issue.
9. **O botão da persona passa a valer sem card carregado, e é a escolha explícita da persona.** O
   destino `discussions` deixa de exigir a referência de um card e passa a poder levar **projeto +
   número** da MR; o botão abre a tela pela MR. Onde houver card, a referência continua valendo como
   hoje.
   - As regras do botão continuam: **o app** escreve as palavras do botão, no máximo quatro por
     resposta, sem repetição, e o destino é validado de novo pelo app.
   - O destino passa a ter um **número de MR**: `PushTarget` só tem `ref`, `id` e `mr`, e `mr` é a
     referência de uma MR, não o número. Um dos dois lados tem de ganhar esse campo — o nome dele é
     decisão da proposta técnica (Q1).
10. **O rótulo do botão de discussões passa a poder ser dito com a MR.** Onde hoje o rótulo cita a
    referência do card ("Open the discussions for #123"), a MR aparece como `<group/repo>!<n>`. A
    chave nova vai nos **dois** catálogos (`src/shared/i18n/ui-persona.pt-BR.json`,
    `ui-persona.en.json`), e o rótulo continua sendo do app, nunca do modelo.
11. **Toda string nova passa por `t()`**, nos dois catálogos.
12. **A explicação de um thread não depende de um card.** Hoje a explicação recebe o card e usa a
    referência, o título e a linha da especificação dele no prompt. Onde houver card (regra 8), a
    explicação continua como está; onde não houver, ela explica com o que existe (a MR e o thread) —
    o prompt perde a linha do card quando ela não existe. **A decisão de base é da pessoa** entre as
    duas alternativas em Q4.
13. **A proposta de resposta e de resolução continua exigindo o card.** Sem card, a tela não oferece
    responder nem marcar como resolvida.
14. **Nada é escrito no host por esta mudança.** A fila de Ações continua igual: uma resposta ou uma
    resolução só viram proposta com um card, e a confirmação continua na tela de Ações.
15. **Um agente que responde numa conversa ganha a ferramenta de ação de abrir as discussões de uma
    MR.** Ela:
    - recebe o **projeto** e o **número** da MR, e confere os dois contra o que aquele pedido alcança
      (regras 3, 4 e 5);
    - **não abre nada sozinha**: o pedido fica com o alvo (projeto + número), e a tela abre quando a
      pessoa toca (regra 17);
    - a forma de apresentar o pedido e o encaixe da ferramenta são da proposta técnica (Q2).
16. **Quando quem pede não é a persona, o pedido abre no dispositivo do pedido.** A tela abre no
    dispositivo que está à frente do pedido — a janela quando o pedido partiu do computador, o
    navegador pareado quando partiu dele —, e o thread ganha uma linha de sistema dizendo o que foi
    aberto, com projeto e número da MR. É a primeira ferramenta de ação de um agente que não é a
    persona.
17. **A abertura nunca acontece sem um ato da pessoa**, e a pessoa pode recusar (no mínimo "abrir" e
    "deixar aqui"). O pedido não abre a tela se a pessoa não tocar.
18. **Numa conversa de execução o pedido vira um aviso, não uma janela.** Abrir uma tela não mexe na
    janela de ninguém (pode não haver ninguém olhando); o aviso fica na conversa, com o alvo, e quem
    olha abre a tela por ele.
19. **Um aviso que leva à tela leva projeto e número.** Onde `discussions` continuar a ser destino de
    notificação ou de push, o pagamento é feito com os dois campos, e a tela abre a MR certa. Um
    aviso sem os dois continua recusado, com motivo.
20. **A varredura de feedback não muda de escopo.** O detector continua lendo as MRs dos cards do
    dia. Esta mudança não faz o app vigiar MR que não é card do dia.
21. **Parede invisível.** Um número que não é MR, ou um projeto fora do formato `group/repo`, é
    recusado com o motivo, como a ferramenta de leitura recusa. Quando o host não distingue os dois
    tipos, o **texto da recusa não afirma qual deles o número é** (Q6).
22. **Um só provedor.** A leitura é a do provedor primário da integração; issues em um host e código
    em outro continuam fora (`docs/vcs-providers.md`).

## Fora de escopo

- **Escrever sem proposta.** A fila de Ações fica como está: nada chega ao host sem o "sim" da
  pessoa.
- **Ler os threads de uma MR pela ferramenta de leitura do agente**, que já funciona hoje. O que
  faltava era a superfície da tela.
- **Uma ferramenta de ação geral para um agente de conversa** (aprovar ações, escrever no host,
  rodar comando). A única ferramenta nova desta mudança é a de abrir as discussões (regra 15).
- **Trocar a resposta de um agente que não é a persona** por um fluxo de botões; ela continua com a
  resposta estruturada que já tem.
- **A regra que exige a referência para os cards do dia** continua intacta.
- **Varrer MRs que não são do dia** (regra 20).
- **Voz, notificação nova, ou um painel de discussões fora do card.**
- **Abrir a tela em outro dispositivo** que não seja o do pedido.
- **Editar a configuração a partir da tela de discussões**: um workspace que recusa por não nomear
  projeto (regra 5) diz o que fazer e leva à tela de configuração, e a edição acontece lá.

## Critérios de aceite

Cada um é algo que quem testa faz e vê, com o workspace apontado para uma pasta de dados vazia e um
modelo falso; **nada aqui foi executado nesta etapa**. O idioma é trocado nas configurações e vale
para os textos novos, que aparecem nos dois catálogos.

1. **O caso da issue.** Numa conversa, pedir as discussões de uma MR que **não** é card do dia: o
   pedido traz um botão com a MR, a pessoa toca e a tela abre com os threads não resolvidos daquela
   MR. Antes desta mudança: a tela devolvia "Atividade não encontrada".
2. **Projeto fora do workspace.** Pedir as discussões de uma MR de um projeto fora do escopo do
   workspace: nenhuma tela abre e a recusa **diz que a MR não é deste workspace**; o mesmo em
   português.
3. **Um card do dia continua igual.** Pela linha de discussões de um card do dia no dia: a tela abre
   como hoje, pela referência da issue.
4. **Um agente que não é a persona.** Numa conversa com um agente que não é a persona, pedir as
   discussões de uma MR que não é card do dia: a resposta traz o pedido com o alvo, e **nada abre
   sozinho**; quando a pessoa toca, a tela abre no dispositivo onde ela tocou, e o thread mostra a
   linha do que foi aberto.
5. **Uma conversa de execução.** Numa conversa de execução, o pedido de um agente vira uma linha com
   o alvo e um aviso; a janela de ninguém é movida sem um ato da pessoa.
6. **Recusa por número inválido.** Um número de MR que não existe, ou fora do formato, dá recusa com
   o motivo — nunca uma tela em branco e nunca uma afirmação de que se trata de uma issue.
7. **Recusa por workspace sem projetos.** Um workspace que não nomeia projeto de issues nem
   repositórios não abre a tela, e a recusa diz o que fazer (nomear o projeto nas configurações).
8. **A leitura restrita.** Com um projeto fora da lista do workspace, a tela aberta para ele não
   mostra threads daquele projeto: ou a abertura é recusada com o motivo, ou a lista vem vazia com a
   recusa visível. Nenhuma leitura daquele projeto aparece.
9. **O botão novo.** A persona oferece um botão que cita a MR (projeto + número) e ele abre a tela;
   o rótulo vem dos catálogos, nos dois idiomas; o destino passa na validação de novo.
10. **O teto de botões não muda.** Quatro botões por resposta, sem repetição, como hoje.
11. **Nada é escrito.** Com a tela aberta por uma MR sem card, responder e resolver **não são
    oferecidos**; a pessoa pode voltar ao dia e ver que nada foi proposto.
12. **A explicação sem card.** Explicar um thread de uma MR que não é card do dia funciona: a
    explicação aparece na tela e não quebra. (O texto que vai ao modelo não aparece na tela; conferir
    que a linha do card não está nele é conferência de código, não de tela.)
13. **Nenhum thread aberto.** Pedir uma MR que não é card do dia e que não tem nenhum thread não
    resolvido mostra a mensagem de que não há discussão aberta naquela MR, com a MR certa no texto —
    não a tela de "Atividade não encontrada".
14. **Voltar volta à conversa.** O botão de voltar de uma tela aberta por uma MR de uma conversa leva
    à mesma conversa de onde veio (hoje volta para a home).
15. **Sem tarefa enganosa.** Com a tela aberta por uma MR de uma conversa, a barra de trabalhos não
    mostra um trabalho daquela MR; nada fica preso em "lendo".

## Decisões e sugestões desta etapa

- **Prioridade proposta: `priority:medium`.** A limitação tem contorno (a leitura por ferramenta já
  existe), mas é fricção de todo dia de quem acompanha MR numa conversa; o vocabulário do rótulo é
  exatamente "small, daily friction". Não é `priority:high` (não é dinheiro, confiança nem fronteira
  de segurança) nem `priority:low` (não é uma direção nova).
- **Marco: o próximo ciclo** (nenhum marco é configurado; ver Q7).
- **Squad proposto: `experiencia`**, como na triagem: a mudança é de superfície (a tela, a rota, a
  recusa nos dois idiomas, o rótulo) e a leitura já existe na fronteira neutra de código.
- **Duas decisões de base são da pessoa:** se um agente que não é a persona pode abrir uma tela a
  partir de uma resposta (Q2) e como a explicação se comporta sem o card (Q4). As duas mudam o
  escopo, e por isso bloqueiam a proposta técnica; se a pessoa recusar a primeira, as regras 15 a 18
  saem e a mudança fica nos botões da persona.

## Como foi conferido

Por leitura, neste worktree: a issue e a triagem, a descrição da #247 (a relação mais próxima) e a
spec dela, e no código as linhas citadas em "Onde o trabalho está" — o roteamento e a tela de
discussões (inclusive o guarda de erro no lugar do aviso de não encontrada), a origem dos `mrPaths`,
a ferramenta de leitura e a recusa por projeto, a lista e a explicação de discussões e a fila de
propostas, as ferramentas de uma resposta de conversa e o `OpenScreen` da persona, a validação e a
tradução dos destinos, o teto e a palavra dos botões nos catálogos dos dois idiomas.

**Não verificado:** nada foi executado nesta etapa (nenhum comando, nenhum teste), a tela não foi
aberta, e o comportamento de hoje é o que a leitura do código diz. As linhas citadas são uma foto de
hoje e o plano técnico as confere antes de mexer.

## Perguntas abertas

As marcadas são decisão da pessoa; as duas primeiras bloqueiam a proposta técnica.

- **Q2. Um agente que não é a persona pode abrir uma tela a partir de uma resposta?** A spec propõe
  que sim, com uma ferramenta de ação só para isto, que **entrega o alvo e nunca abre sozinha**
  (regras 15 a 18). A alternativa é não abrir essa superfície agora: a mudança fica nos botões da
  persona, e a #257 fica atendida no caso em que a persona oferece o botão. **Decisão da pessoa.**
- **Q4. Explicar sem card.** Sem card, a explicação perderia a linha da especificação no prompt. Três
  saídas: (a) a explicação continua e perde a linha do card; (b) sem card a tela só lista os threads,
  e explicar exige um card do dia; (c) sem card a tela lista e explica, mas com um recado de que a
  explicação tem menos contexto. A spec assume (a). **Decisão da pessoa.**
- **Q1. Onde o número da MR entra no destino.** `PushTarget` tem `ref`, `id` e `mr` e nenhum é o
  número. Opções: um campo novo (ex.: `num`), usar `id`, ou `mr` carregar `group/repo!n`. Decisão
  técnica, na proposta técnica.
- **Q3. O celular pareado também recebe e abre o pedido?** A regra 16 abre no dispositivo do pedido;
  resta saber se o celular pareado pode pedir e abrir (o mesmo que hoje: ele abre a tela pela tela
  pareada). **Decisão da pessoa, no aceite.**
- **Q5. Quem pode pedir numa conversa de execução.** A spec segue o rigor de hoje: o escopo da
  execução estreita a lista de projetos. Se a pessoa quiser que uma MR fora do escopo da execução
  ainda possa ser aberta (como os cartões do dia já são lidos por número mesmo fora do escopo), esta
  regra muda. **Decisão da pessoa.**
- **Q6. O que a recusa diz quando o número existe mas não é uma merge request.** A spec evita
  afirmar qual tipo de objeto o número é, porque a leitura do host não distingue os dois (Q6 tem uma
  alternativa: investigar o número como issue antes de montar a recusa). **Decisão da pessoa, no
  aceite, e a proposta técnica diz o que é possível.**
- **Q7. Marco.** Nenhum marco está configurado e não há fila declarada; a spec propõe "o próximo
  ciclo", sem nome. **Decisão da pessoa.**

## Riscos

- **A superfície de abrir uma tela por projeto + número não é só do renderer.** O destino de
  notificação, a tradução dele para tela e o botão da persona também exigem a referência; uma
  mudança só no renderer deixa o caminho do botão e o do aviso quebrados.
- **O workspace sem projetos.** A lista de projetos vazia com leitura estrita recusa tudo; a recusa
  precisa de texto nos dois idiomas, e a spec não fixa o texto.
- **Escopo de um agente em conversa.** Hoje só a persona tem escopo de tela; um agente de conversa
  precisa do mesmo rigor da regra 5 para não virar uma porta mais larga.
- **O dispositivo certo.** Um pedido feito no celular pareado não pode abrir a tela no computador (e
  vice-versa); a regra 16 depende de o app saber qual superfície respondeu.
- **A explicação gasta modelo.** Ela chama o papel `deep`; uma tela aberta sem card continua gastando,
  como hoje, e é uma das razões da Q4.
- **O texto do rótulo.** O botão é a única coisa que a pessoa lê antes de decidir; um rótulo que não
  diga qual MR é obriga a abrir para descobrir.
