# Discussões de uma MR fora dos cards do dia

- Tipo: pedido de funcionalidade (`enhancement`).
- Título da nota de lançamento sugerido: “As discussões de uma MR abrem a partir da conversa, mesmo quando ela não é um card do dia”.
- Prioridade sugerida: `priority:low`, como veio da issue; o refino propôs `priority:medium` e a decisão é da pessoa (nenhum campo de prioridade foi preenchido por esta etapa).

## Dá para entender ou reproduzir

Dá para entender como está escrita, e a descrição confere ponto a ponto com o código. A pergunta feita a quem abriu — o que exatamente aparece na tela — foi respondida: o que aparece é o aviso de atividade não encontrada, e não outra mensagem. A conferência foi só por leitura: a issue não foi reproduzida na interface e nenhum comando foi executado para exercitar a tela.

O que foi lido e confere:

- a tela de discussões é roteada por uma referência de card, e o card é procurado nessa referência entre os cards de hoje: `src/renderer/src/App.tsx:69`, `App.tsx:260`;
- a lista de MRs da tela vem só de `card.mrPaths`: `src/renderer/src/screens/Discussions.tsx:42`; os `mrPaths` nascem das MRs ligadas à issue: `src/main/cards.ts:102`, `src/main/cards.ts:83-94`;
- o número da MR nunca é referência de card: a `ref` do card é a da issue (`#n`), e a referência de uma MR é composta de outro jeito: `src/main/vcs/cards.ts:88-91`, `src/shared/vcs.ts:70-73`;
- sem card a tela devolve o aviso de “não encontrada”, com um botão de voltar: `Discussions.tsx:138-140`, texto em `src/shared/i18n/ui-gate.pt-BR.json:38` / `ui-gate.en.json:38`;
- a leitura dos threads por projeto + número da MR já existe na ferramenta `VcsRead`, com a checagem de projeto permitido: `src/main/vcs/readTool.ts:8`, `readTool.ts:48-51`, `readTool.ts:57-63`, `readTool.ts:83-88`;
- o comportamento de “só proposta” da fila de Ações continua igual: `src/main/feedback.ts:446`, `src/main/actions.ts:176-213`;
- nenhuma superfície de conversa carrega projeto + número da MR hoje: a mensagem de conversa (`src/shared/forum.ts:88-123`), o payload de trabalho (`src/renderer/src/useJobs.ts:6`) e o destino de notificação (`src/shared/push.ts:29`, `push.ts:46`) não têm campo de projeto nem de número, e a tela `discussions` está na lista que exige referência; a tradução desse destino para tela também exige: `src/renderer/src/pushTarget.ts:27-28`.

### Pontos que a descrição não cobre e a próxima etapa precisa tratar

- **A restrição de projeto da leitura não existe hoje no caminho da tela.** A issue pede que a leitura fique “com o mesmo rigor do `VcsRead`”, mas a verificação de projeto permitido está só na ferramenta de leitura do agente (`src/main/vcs/readTool.ts:48-63`); as leituras que a tela usa vão direto ao provedor, sem lista de projetos permitidos: `src/main/feedback.ts:402-404` (lista) e `feedback.ts:409-412` (explicação). A validação que existe ali confere só o formato do projeto e do número (`src/main/feedback.ts:68-71`). Ou seja, o rigor pedido precisa ser construído, não é o comportamento atual.
- **A explicação de cada thread depende de um card inteiro.** A assinatura de `explainDiscussion` recebe um card e usa a referência, o título e a especificação dele no texto entregue ao agente (`src/main/feedback.ts:409`, `feedback.ts:415-424`). Sem card do dia, esses dados não existem; a proposta de resposta e de resolução também exige o card (`src/main/feedback.ts:447-469`). A leitura mais barata é a lista continuar a funcionar e a explicação perder a linha da especificação.
- **O número da MR não é campo de nenhum destino, e a referência é exigida em três lugares.** Mesmo com uma superfície nova, o destino `discussions` é recusado sem `ref` no caminho de notificação (`src/shared/push.ts:29`, `push.ts:46`), a tradução desse destino exige `ref` (`src/renderer/src/pushTarget.ts:27-28`) e o botão da persona também exige que a referência esteja entre os cards carregados (`src/main/persona/openScreen.ts:60-63`).

## O que falta

Nada de quem abriu: a pergunta da triagem foi respondida e o resto é dedutível do código. O único ponto em aberto é de produto — se a explicação de cada thread continua sem o card (com menos contexto no prompt) ou se a tela só lista os threads nesse caso — e é decisão do refino, não de quem abriu a issue.

## Issues duplicadas ou relacionadas

Nenhuma duplicada. Nada no repositório (`docs/`, `CHANGELOG.md` em `[Unreleased]`, specs dos ciclos) nem no quadro de issues já pede abrir as discussões de uma MR a partir da conversa quando ela não é um card do dia. As buscas nos registros das issues por “discussions”, “thread”, “card of the day”, “merge request”, “screen”, “conversation”, “projectAllowed” e “notification” devolveram só esta issue.

Relacionadas, sem sobreposição:

- #247 “Persona: the agent type, its wizard and a chat home in place of Today and the ceremony screen” — a relação mais próxima: é ela que criou o único recurso que abre uma tela a partir do chat e que declara a recusa de `discussions` quando o card não está carregado. Esta issue é a continuação direta dessa limitação; não mexe na conversa da persona, no assistente nem na tela do dia.
- #30 “Agent permissions: code host read and sandboxed execution per agent” — fixou a política de leitura do host e o escopo de projeto (`projectAllowed`, leitura estrita) que esta issue diz que o caminho novo deve igualar; a implementação de hoje não estende esse escopo além da ferramenta de leitura.
- #32 “Confine reading agents of a run to their worktree on the Claude Agent SDK engine” — mesma exigência de que a recusa diga o motivo, mas sobre arquivos, não sobre MRs.
- #53 “Let a person call an agent with @ wherever they talk in the app” — define que uma menção fora de uma execução responde só leitura; é a conversa de onde esta issue parte.
- #71 “Chat directly with an agent and let it propose the actions it recommends” — a mesma família de “o agente age a partir da conversa”, mas trata de propor efeitos no host, não de abrir uma tela.
- #29 “Show that an agent called in a run's thread is working” — menciona o quadro de trabalhos e threads de conversa, sem abrir tela a partir da conversa.
- #83 “Own board in Coxia with optional code-host integration” — separa cards do quadro de cards do host; os cards do dia que hoje carregam MRs são o que esta issue quer poder dispensar.
- #91 “Agent asked in a run's thread answers under the Claude Code rules instead of doing the job” — mesmo tema de fundo (o agente não consegue fazer, onde a pessoa pede, o que a conversa promete), sem sobreposição.
- #120 “Let a person send files in the conversations and the agents open them” — a conversa alcançando coisas, mas só arquivos do próprio thread.
- #122 “Let working agents exchange messages and call each other during a run” — liga agentes entre si durante uma execução, sem ligação de tela.

## Decisões e sugestões desta etapa

- Não confirmei nada executando o app; o que está dito acima é leitura de código.
- A issue cita a tela e a ferramenta de leitura, mas não cita `src/shared/push.ts`, `src/renderer/src/pushTarget.ts` nem o `openScreen` da persona, que também exigem a referência — a implementação precisa dos três.
- A descrição fala em “abrir a tela a partir da conversa”, que hoje só existe como botão da persona; um agente que responde numa conversa não tem ferramenta de ação. Isso não é um encaixe, é trabalho novo, e a próxima etapa precisa decidir como o pedido chega à tela.
- Sugestão de squad: `experiencia`, porque a mudança é de superfície (a tela, a rota, a recusa em português e inglês) e a parte de leitura já existe na fronteira neutra de código; o squad de plataforma não é o dono natural desta entrega.
- A prioridade `priority:low` que a issue traz soa plausível: é uma limitação de alcance da tela, com contorno pela ferramenta de leitura, sem perda de dado nem escrita indevida. O refino propôs `medium` pelo mesmo motivo inverso (fricção diária); a decisão é da pessoa.
