# O que a verificação da autonomia, da rede e da lista de comandos encontrou

## 1. Como a entrega foi verificada

Esta etapa re-confirmou a entrega no estado em que a revisão aprovou: desde o veredito anterior só entrou um commit de documentação do registro do ciclo, sem mudar o código. A verificação passou pelos portões do próprio repositório (tipos, a suíte inteira de testes, a auditoria de cores, o catálogo de textos, a auditoria de repositório público e o empacotamento) e relêu os pontos de código que implementam cada critério de aceite. O comportamento de ponta a ponta (contra um host de código falso com memória e um motor de agente roteirizado, e uma sandbox `bwrap` real para a rede aberta) foi exercitado na passada de QA anterior, sobre o mesmo código; o resultado continua valendo porque o código não mudou desde então, e está registrado na seção 3.

Os portões foram rodados nesta máquina, com o resultado que voltou:

| Portão | Resultado |
|---|---|
| Verificação de tipos | **limpa** (código de saída 0) |
| Suíte inteira de testes | **4173 casos verdes em 256 arquivos** |
| Auditoria de cores | limpa, só as 8 cores literais já conhecidas |
| Catálogo de textos | **4422 chaves** nos dois idiomas, 0 fora de ordem |
| Auditoria de repositório público | **1093 arquivos**, nada de empresa ou pessoa |
| Empacotamento (`electron-vite build`) | concluído |

Além da suíte inteira, os testes que prendem cada critério de aceite também foram rodados em foco e passaram: o resolvedor de autonomia e a precedência dos dois blocos, o esquema da configuração, a migração do esquema, a publicação (push e pull request com e sem as escolhas, e a release fora), a lista de comandos, a política do navegador pareado, a política da sandbox, o comando no computador sob a autonomia e o gate que a execução conduz.

## 2. O que a leitura do código confirmou, critério por critério

- **Os dois blocos e a precedência (aceite 2).** O bloco de cinco campos (`cycle`, `hostCommands`, `gates`, `push`, `pullRequest`) mora em `runner.autonomy` (espaço de trabalho) e em `devCycle.autonomy` (um mapa por fluxo, com `useWorkspace` ligado por padrão). O resolvedor devolve o bloco efetivo: sem bloco do fluxo ou com `useWorkspace` ligado, vale o do espaço de trabalho; desligado, vale o do fluxo. As quatro escolhas de baixo nunca valem sozinhas, só sob `cycle`.
- **Lida na decisão.** A autonomia efetiva é lida no início da etapa, no gate, no comando no computador, no push e no pull request — sempre no ponto da decisão, de modo que trocar um campo vale a partir da próxima decisão, nunca a meio.
- **Gate aprovado pelo app (aceites 1 e 8).** A execução que fica num gate com a escolha ligada é aprovada pelo próprio app, com `by: 'app'` e um motivo que diz de onde veio a decisão (espaço de trabalho ou fluxo). A chamada fica logo depois de cada etapa, antes do laço decidir que "nada mudou", o que era exatamente o defeito que a passada anterior encontrou e corrigiu.
- **Push e pull request (aceites 1 e 3).** As duas escolhas são lidas no ponto da publicação; com a escolha ligada, o push sai pela porta de Ações e o pull request é aberto pela mesma porta, auditados; uma execução de **release** fica fora das duas escolhas por construção (`run.subject → false`), e um espaço de trabalho de teste continua recusando pela porta, com a recusa dita na conversa.
- **Navegador pareado (aceite 4).** O bloco do espaço de trabalho e a rede da sandbox ficam fora do que o navegador salva; o bloco do fluxo aceita só a descida (recusa qualquer campo que passe de desligado para ligado e recusa desligar o interruptor), e a rede `open` não pode ser escolhida de um navegador pareado.
- **Rede aberta na sandbox (aceite 5).** A rede da sandbox tem o terceiro valor `open`; a montagem deixa de pôr `--unshare-net` só nesse valor (os outros unshares e o `--disable-userns` continuam), não põe as variáveis de proxy e monta o alvo real de `/etc/resolv.conf` (que costuma ser um link para fora de `/etc`) somente leitura. O texto da etapa e o de uma menção dizem ao agente, com `open`, que ele tem a rede.
- **A lista de comandos (aceite 6).** Uma seção da tela lê a conversa viva e agrupa por agente e por etapa, com número, onde rodou, como terminou e quanto durou; quando a execução termina (concluída, cancelada ou falhou), o app posta **uma** mensagem com a mesma lista, protegida contra postar duas vezes. Nada disso toca o host de código.
- **A migração (aceite 7).** O passo `v15ToV16` cria o bloco do espaço de trabalho com os cinco campos desligados e o mapa de fluxos vazio (idempotente), e **não toca** na rede da sandbox: a migração nunca eleva nada. O teste da migração mostrou um config no esquema 15 com a rede em `registry` virar esquema 16 com os cinco campos `false`, o mapa vazio e a rede ainda `registry`.
- **Uma execução de release (aceite 10).** Os passos de release (`beta`, `stable`, `push-branch`, `push-tag`) continuam sempre esperando o "sim"; a exclusão está no código (a escolha devolve `false` para uma release antes de se olhar o bloco) e é fixada pelos testes da unidade de release.

## 3. Os cenários exercitados e o que se viu

Na passada de QA anterior, sobre o mesmo código, cada cenário foi rodado contra um host falso e um motor roteirizado; o resultado é o que os comandos imprimiram. Esta etapa re-confirmou, por leitura do código e pelos testes em foco, que o comportamento segue no lugar (e a suíte inteira verde nesta máquina).

| # | Cenário | Resultado |
|---|---|---|
| 1 | **Aceite 1 e 8 — a execução sozinha.** Bloco do espaço de trabalho com as cinco escolhas ligadas; execução com dois gates, um agente que escreve e uma QA. | **Passou.** `status=done`, pull request **aberto**, nenhuma proposta em Ações, os dois gates aprovados com `by=app` e o motivo com a origem. |
| 2 | **Aceite 1 (negativo) — com as escolhas desligadas.** | **Passou.** A execução termina com o push **proposto** e nenhum pull request aberto: aquele passo espera como antes. |
| 3 | **Aceite 2 — o bloco do fluxo decide.** `useWorkspace` desligado no fluxo principal, com `push`/`pullRequest` desligados nele e o bloco do espaço de trabalho com tudo ligado. | **Passou.** Os gates aprovados pelo app (o fluxo decidiu), mas o push **esperou** como proposta — o bloco do fluxo, e não o do espaço de trabalho, é quem decidiu. |
| 4 | **Aceite 3 — espaço de trabalho de teste.** As duas escolhas de escrita ligadas. | **Passou.** Nenhuma escrita chegou ao host, nenhum pull request abriu, e a recusa apareceu na conversa. |
| 5 | **Aceite 4 — o navegador pareado.** | **Passou.** Subir qualquer campo do bloco do fluxo é recusado; descer é aceito; a rede `open` pelo caminho do navegador é recusada; o bloco do espaço de trabalho é recusado por inteiro. |
| 6 | **Aceite 5 — a rede `open` numa sandbox real.** | **Passou.** A sandbox com `network: open` **alcançou um endereço público de verdade**: `https://example.com` respondeu `HTTP 200`; com `network: off` a mesma conexão deu `HTTP 000` (sem rota). |
| 7 | **Aceite 6 — a lista de comandos.** Um agente rodando comandos na sandbox. | **Passou.** A execução termina em `done` e posta **uma** mensagem na conversa com a lista por agente. |
| 8 | **Aceite 7 — a migração.** Um config no esquema 15 com a rede em `registry`. | **Passou.** Vira esquema 16, os cinco campos do bloco ficam `false`, o mapa de fluxos fica vazio e a rede continua `registry` — a migração não elevou nada. |
| 9 | **A marca do comando no computador sob autonomia.** | **Passou.** Com **Comandos no computador sem perguntar** ligado, a conversa não pediu permissão e ficou **uma** linha dizendo que o comando rodou neste computador sob a autonomia do ciclo. |

## 4. O que não foi verificado

- **Nenhuma execução viu um modelo de verdade.** O motor foi roteirizado; o que um modelo real faz com os textos desta mudança não foi medido.
- **Nenhum host de código real foi tocado.** Tudo rodou contra um host falso; o único tráfego de rede de verdade foi a sandbox da rede aberta alcançando um endereço público.
- **A tela não foi aberta.** Cabeçalho da execução, seção **Comandos**, os dois blocos e a dica do fluxo foram conferidos pelo código e pelos testes que os fixam, nunca numa janela do aplicativo.
- **A interface (usabilidade) não foi exercitada**: não se viu um bloco ligado à mão, um campo do fluxo desabilitado com a dica, nem a lista se atualizando ao vivo na tela.
- **A execução de release não foi conduzida de ponta a ponta** até os quatro passos: a exclusão da release das escolhas é fixada pelos testes da unidade de release, e foi só lida aqui.
- **A rede `open` fora deste Linux**, em macOS e Windows, e sem `bwrap`: a escolha não existe lá e não foi exercitada.
- **Diferença pequena não resolvida na documentação**: o trecho "Não verificado" do runner ainda diz que "alcançar um endereço público de verdade não foi observado", embora a verificação desta entrega (item 6) o tenha observado numa sandbox real. É uma frase de documentação defasada frente ao que a verificação fez, não um defeito de comportamento, e não entra nesta mudança.
- As duas observações conhecidas da revisão seguem valendo e não bloqueiam: o rótulo da etapa na lista de comandos sai como o identificador interno (não traduzido), e um comando recusado antes de virar linha da conversa fica fora da mensagem final.

## 5. Como foi conferido

Leitura direta dos arquivos do worktree (o resolvedor de autonomia, o laço que conduz a execução com o gate aprovado pelo app logo depois da etapa, a publicação com a release fora e o espaço de teste recusando, a porta, a migração v15ToV16 que não toca a rede, a lista de comandos, os campos do bloco, a política do navegador pareado, a rede `open` da sandbox e os textos do catálogo) e execução nesta máquina: verificação de tipos, a suíte inteira de testes (4173 casos), os testes em foco de cada critério, a auditoria de cores, o catálogo de textos, a auditoria de repositório público e o empacotamento. O comportamento de ponta a ponta foi exercitado na passada de QA anterior sobre o mesmo código (host falso com memória, motor roteirizado e uma sandbox `bwrap` real para a rede aberta) e permanece válido porque o código não mudou desde a revisão. O que os cenários mostram é o que os comandos imprimiram, e está dito assim onde importa.
