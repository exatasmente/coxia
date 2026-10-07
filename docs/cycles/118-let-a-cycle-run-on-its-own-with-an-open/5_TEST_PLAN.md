# O que a verificação da autonomia, da rede e da lista de comandos encontrou

## 1. Como a entrega foi verificada

Esta passada exercitou o comportamento **de ponta a ponta** contra um host de código falso com memória e um motor de agente roteirizado — nenhum modelo, nenhum host e nenhuma rede de verdade (a única exceção é a sandbox real da rede aberta, abaixo). A verificação passou pelas portas do próprio app: o runner, o resolvedor de autonomia, a porta das Ações, a migração do esquema e uma sandbox `bwrap` real na máquina.

Os portões foram rodados nesta máquina, com o resultado que voltou:

| Portão | Resultado |
|---|---|
| Verificação de tipos | **limpa** (código de saída 0) |
| Suíte inteira de testes | **4173 casos verdes em 256 arquivos** |
| Auditoria de cores | limpa, com as 8 cores literais já conhecidas |
| Catálogo de textos | **4422 chaves** nos dois idiomas, 0 fora de ordem |
| Auditoria de repositório público | **1093 arquivos**, nada de empresa ou pessoa |
| Empacotamento (`electron-vite build`) | concluído |

Durante a verificação apareceu **um defeito** e ele foi corrigido; o item 2 o descreve. Depois da correção, a suíte inteira voltou a ficar verde.

## 2. O defeito que a verificação encontrou

**O gate nunca era aprovado pelo próprio app.** Com a escolha **Gates passam sozinhos** ligada, uma execução chegava ao gate e **parava**, esperando a pessoa — ao contrário do que o aceite 1 pede (a execução vai do começo ao pull request sem esperar) e do que o aceite 8 pede (o gate aprovado pela autonomia aparece como aprovação automática).

A causa está no laço que conduz a execução: a chamada que aprova o gate de sozinho estava atrás de uma condição que só é verdadeira quando **nada** mudou na execução — e terminar uma etapa **sempre** muda a execução, de modo que o caminho nunca era alcançado. Nenhum teste cobria esse caminho: a suíte passava porque nenhum caso conduzia uma execução até um gate com a escolha ligada.

A correção move a leitura para logo depois de cada etapa: a execução que ficou num gate é aprovada na hora, e o laço segue; uma etapa que não mudou nada (uma etapa que a pessoa precisa iniciar, uma falha, uma pergunta) continua parando como antes.

Depois da correção, a execução com o bloco ligado **vai até o fim** e o pull request é aberto, como mostram os cenários abaixo.

## 3. Os cenários exercitados e o que se viu

Cada cenário foi rodado contra um host falso e um motor roteirizado. O resultado é o que os comandos imprimiram.

| # | Cenário | Resultado |
|---|---|---|
| 1 | **Aceite 1 e 8 — a execução sozinha.** Bloco do espaço de trabalho com as cinco escolhas ligadas; execução com dois gates, um agente que escreve e um QA. | **Passou.** `status=done`, pull request **aberto**, nenhuma proposta em Ações, os dois gates aprovados com `by=app`. O motivo gravado é "Approved by the app: the cycle runs on its own (the workspace's autonomy setting)". A conversa carrega a decisão do app e há a linha de auditoria do pull request. |
| 2 | **Aceite 1 (negativo) — com as escolhas desligadas.** | **Passou.** A execução termina com o push **proposto** (`state=pending`) e nenhum pull request aberto: aquele passo espera como antes. |
| 3 | **Aceite 2 — o bloco do fluxo decide.** `useWorkspace` desligado no fluxo principal, com `push`/`pullRequest` desligados nele e o bloco do espaço de trabalho com tudo ligado. | **Passou.** Dois gates aprovados pelo app (o fluxo decidiu), mas o push **esperou** como proposta — o bloco do fluxo, e não o do espaço de trabalho, é quem decidiu. |
| 4 | **Aceite 3 — espaço de trabalho de teste.** As duas escolhas de escrita ligadas. | **Passou.** Nenhuma escrita chegou ao host, nenhum pull request abriu, e a recusa apareceu na conversa. |
| 5 | **Aceite 4 — o navegador pareado.** | **Passou.** Subir qualquer campo do bloco do fluxo é recusado (`cycle`, `hostCommands`, `gates`, `push`); descer é aceito; a rede `open` pelo caminho do navegador é recusada; o bloco do espaço de trabalho é recusado por inteiro. |
| 6 | **Aceite 5 — a rede `open` numa sandbox real.** | **Passou.** A sandbox com `network: open` **alcançou um endereço público de verdade**: `https://example.com` respondeu `HTTP 200`; com `network: off` a mesma conexão deu `HTTP 000` (sem rota). Este era o ponto que a revisão marcava como nunca observado. |
| 7 | **Aceite 6 — a lista de comandos.** Um agente rodando comandos na sandbox. | **Passou.** A execução termina em `done` e posta **uma** mensagem na conversa com a lista por agente (`developer(implement)`, 1 comando). |
| 8 | **Aceite 7 — a migração.** Um config no esquema 15 com a rede em `registry`. | **Passou.** Vira esquema 16, os cinco campos do bloco ficam `false`, o mapa de fluxos fica vazio e a rede continua `registry` — a migração não elevou nada. |
| 9 | **A marca do comando `host` sob autonomia.** | **Passou.** Com **Comandos no computador sem perguntar** ligado, a conversa não pediu permissão nenhuma e ficou **uma** linha dizendo que o comando rodou neste computador sob a autonomia do ciclo (`npm test`). |

## 4. O que não foi verificado

- **Nenhuma dessas execuções viu um modelo de verdade.** O motor foi roteirizado: o que cada agente "faz" é o que o roteiro manda. O que um modelo real faz com os textos desta mudança não foi medido.
- **Nenhum host de código real foi tocado.** Tudo rodou contra um host falso com memória; a rede `open` alcançou um endereço público, que é o único tráfego de rede de verdade desta verificação.
- **A tela não foi aberta.** Cabeçalho da execução, seção **Comandos**, o bloco do espaço de trabalho e o do fluxo foram conferidos pelo código e pelos testes que os fixam, e pelo comportamento que eles alimentam — nunca numa janela do aplicativo. **Nada foi visto numa tela.**
- **A interface (usabilidade) não foi exercitada**: não se viu um bloco ligado à mão, um campo do fluxo aparecer desabilitado com a dica, nem a lista se atualizar ao vivo na tela.
- **A execução de release não foi conduzida de ponta a ponta nesta passada** até os quatro passos (`beta`, `stable`, `push-branch`, `push-tag`): a exclusão da release das escolhas de push e pull request é fixada pelos testes da unidade de release, e foi **só lida** aqui.
- **A rede `open` fora deste Linux**, em macOS ou Windows, e sem `bwrap`: a escolha não existe lá e não foi exercitada.
- A observação conhecida da revisão (**o rótulo da etapa na lista sai como o identificador interno**, e um comando recusado antes de virar linha da conversa fica fora da mensagem final) continua valendo: não foi corrigida nesta passada e não impede a entrega.
- Duas corridas da suíte inteira, sob carga, mostraram falhas de tempo em `sandbox-gui` e nos testes de conflito; em corrida limpa a suíte passa inteira (4173 casos), e nenhuma dessas falhas toca arquivo desta mudança.

## 5. Como foi conferido

Leitura direta dos arquivos do worktree (o runner, o resolvedor de autonomia, a porta das Ações, a migração, a sandbox e as telas) e execução: a verificação de tipos, a suíte inteira de testes, a auditoria de cores, o catálogo de textos, a auditoria de repositório público e o empacotamento; e o exercício de ponta a ponta do comportamento contra um host falso com memória, um motor roteirizado e uma sandbox `bwrap` real com a rede aberta. O que os cenários mostram é o que os comandos imprimiram, e está dito assim onde importa.
