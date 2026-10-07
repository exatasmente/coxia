# O bloco de autonomia ligado nos pontos de decisão, a rede aberta na sandbox e a lista dos comandos de cada agente

## Estado desta passada

A implementação está **no worktree, sem novo commit desta etapa** (quem commita é o app): os arquivos já estavam commitados nas passadas anteriores do ciclo, e esta etapa conferiu o estado, veredito que a revisão aprovou e a verificação de QA encontrara um defeito que já foi corrigido e commitado. Esta passada da implementação re-leu os pontos de código, rodou os portões e reescreveu este documento com o que está realmente no trabalho.

A passada anterior desta etapa deixara três buracos (o push e o pull request autônomos não ligados, a lista de comandos e a mensagem final sem existir, e nem o cabeçalho nem as telas do bloco escritas); a revisão seguinte os fez escrever, e a verificação de QA achou e corrigiu **um defeito de bloqueio** (o gate aprovado pelo próprio app nunca acontecia). Tudo isso já está no código commitado e conferido aqui.

## O que foi implementado

### O bloco de autonomia e o resolvedor

- Um **bloco de cinco campos** (`cycle`, `hostCommands`, `gates`, `push`, `pullRequest`) mora em dois lugares da configuração: `runner.autonomy` (espaço de trabalho) e `devCycle.autonomy` (um mapa por fluxo, com a chave `''` para o fluxo principal, o id do squad para o de cada squad e `release` para o de release), cada fluxo com `useWorkspace` ligado por padrão.
- Um resolvedor puro novo (`src/shared/config/autonomy.ts`) decide o bloco efetivo de uma execução: sem bloco do fluxo, ou com `useWorkspace` ligado, vale o do espaço de trabalho; com o interruptor desligado, vale o do fluxo. `choiceOn` só é `true` com `cycle` ligado. O mesmo arquivo nomeia a origem da decisão (`from` e qual fluxo) para o cabeçalho da tela e o registro do gate.
- Tipos, padrões neutros (`neutralAutonomy`), esquema e o passo de migração andaram juntos; a migração é a **v15ToV16** (o esquema vai a **16**, porque a release 0.7.0 já estava no 15). Ela cria `runner.autonomy` com os cinco campos desligados e `devCycle.autonomy` vazio (um mapa já presente é mantido — idempotente) e **não toca** em `runner.sandbox.network`: a migração nunca eleva a rede.
- **A autonomia é lida em cada ponto de decisão**: início da etapa (`cycleAutonomous` guardado no registro da etapa), o gate, o comando `host`, o push e o pull request. Trocar um campo vale a partir da próxima decisão, nunca no meio de uma.

### Os quatro pontos de decisão

- **Etapa**: uma etapa com o `cycle` ligado começa e entrega o resultado sem esperar, qualquer que seja a chave `autonomous` do agente e do squad.
- **Gate**: com a escolha `gates` ligada, o app aprova o gate sozinho ao entrar nele, registrado como **aprovação automática** (`by: 'app'`) com o motivo e a origem. Foi aqui que a verificação achou o defeito: a chamada que aprova estava atrás de `rev === run.rev` (só quando nada mudou) e terminar uma etapa sempre muda a execução, de modo que o caminho era inalcançável — a execução parava no gate. A chamada foi movida para logo depois de `step(run)`, antes de o laço decidir que "nada mudou", e agora a execução que fica num gate é aprovada na hora.
- **Comando `host`**: com a escolha ligada, o comando roda sem a pergunta, e a conversa ganha uma linha dizendo que ele rodou neste computador sob a autonomia do ciclo (`runner.command.autonomy`).
- **Push e pull request**: com as escolhas ligadas, o push sai pela porta de Ações (`door.push`, auditado) e o pull request é aberto pela mesma porta (`door.post`, auditado), em vez de virarem propostas. Uma **execução de release** fica fora das duas escolhas por construção (`run.subject ? false : ...`), e um espaço de trabalho de teste continua recusando pelo `door.refusal()`, com a recusa dita na conversa.

### A lista dos comandos de cada agente

- Um módulo puro novo (`src/shared/runCommands.ts`) agrupa, por agente e por etapa, as mensagens `runner.exec` / `runner.exec.host` que a execução já escreve (agente, etapa, número, comando, onde rodou, resultado e duração).
- A seção **Comandos** da tela da execução lê a conversa viva e monta a lista por agente e por etapa, atualizando ao vivo.
- Quando a execução termina (concluída, cancelada ou falhou), o app posta **uma** mensagem `runner.commands.list` na conversa, de um ponto único e protegida contra postar duas vezes. Nada disso toca o host de código.

### O cabeçalho e as telas do bloco

- **AutonomyNote**: no cabeçalho da tela da execução, diz que a execução roda sozinha, quais das quatro escolhas estão ligadas e de onde vem a decisão (espaço de trabalho ou fluxo); some numa release.
- **AutonomyFields**: os cinco campos, com os quatro de baixo desabilitados enquanto `cycle` está desligado; usado no bloco do espaço de trabalho (Settings › Runner) e no bloco de cada fluxo (Settings › Time e ciclo), este com o interruptor "Usar a configuração do espaço de trabalho" ligado por padrão, os campos desabilitados e a dica enquanto ele está ligado.
- Os editores de configuração do runner e do fluxo carregam e gravam os dois blocos; um fluxo que o editor não mostra fica como está.

### Navegador pareado

- `runner.autonomy` e `runner.sandbox` ficam **fora** da lista editável pelo navegador; `devCycle.autonomy` entra nela com uma checagem própria (`raisedAutonomy`) que recusa qualquer campo passando de desligado para ligado e recusa desligar o interruptor `useWorkspace` — o navegador só **desce**. A rede `open` não pode ser escolhida de um navegador pareado.

### A rede aberta na sandbox

- `runner.sandbox.network` ganha o terceiro valor **`open`**: a montagem deixa de pôr `--unshare-net` só nesse valor (os outros unshares e o `--disable-userns` continuam), não põe as variáveis de proxy, e monta o alvo real de `/etc/resolv.conf` (que costuma ser um link para fora de `/etc`) somente leitura, com o que o alvo precisar para existir (`/run/systemd/resolve` ou `/run/resolvconf`), sem abrir mais nada de `/run` nem `/var`. O que não existir na máquina é ignorado; se nada for encontrado, a sandbox ainda sobe e o prompt diz que a resolução pode não funcionar. `open` só existe no desktop, desligada por padrão, e uma instalação nova continua com `off`.
- O texto da etapa e o de uma menção dizem ao agente, quando a rede é `open`, que ele tem a rede do computador (chave `prompt.sdd.runner.rules.shell.open`), nos dois idiomas.

### Documentação

- `docs/runner.md`: o bloco de autonomia e cada escolha, a exceção do `shell: host`, o push e o pull request condicionais à escolha (com a release fora e o espaço de trabalho de teste recusando), a rede `open` na descrição da sandbox (e o aviso de que é a rede do computador inteira, por escolha da pessoa, padrão fechado), o cabeçalho e a seção "Comandos", a linha do navegador pareado e a seção "Não verificado" dizendo que a rede `open` nasce não exercitada.
- `docs/configuration.md`: o bloco do espaço de trabalho e o do fluxo, o histórico do esquema com o passo v16 e a tabela do que o navegador pode salvar.
- `CHANGELOG.md`, em `## [Unreleased]`: o bloco de autonomia, a rede `open` e a lista dos comandos.

## O que foi verificado

- **Portões rodados nesta passada**, com o resultado que voltou: `npx tsc --noEmit` limpo; a suíte inteira de testes **4173 casos verdes em 256 arquivos** (numa corrida limpa; sob carga, dois arquivos estouraram o tempo de 5 s e passam sozinhos — falha de carga, não de código); `theme-audit` limpo (só as 8 cores literais já conhecidas em `api.ts`); `i18n:lint` com **4422 chaves nos dois idiomas**, 0 fora de ordem; `public-audit` com **1093 arquivos**, nada de empresa ou pessoa; `electron-vite build` concluído.
- Os pontos de código foram relidos diretamente: o resolvedor de autonomia, o laço que conduz a execução (o gate automático logo depois de `step(run)`), a publicação (as escolhas lidas e a release fora), a porta, a migração v15ToV16 (que não toca a rede), a lista de comandos, a política do navegador pareado e as chaves novas do catálogo.
- A verificação de QA desta mesma entrega, registrada no `5_TEST_PLAN.md`, **exercitou o comportamento de ponta a ponta** contra um host de código falso com memória e um motor roteirizado (nenhum modelo, nenhum host real): a execução com o bloco ligado vai ao fim e abre o pull request, com os dois gates aprovados pelo app e o motivo com a origem; com as escolhas desligadas o push espera como proposta; o bloco do fluxo decide quando o interruptor está desligado; o espaço de trabalho de teste recusa; o navegador pareado só desce; a rede `open` numa sandbox `bwrap` real **alcançou um endereço público de verdade** (`https://example.com` respondeu `HTTP 200`; com `off`, sem rota); a migração v15→v16 não elevou nada e manteve a rede; a lista por agente e a mensagem única no fim; e a marca do comando no computador.
- O defeito do gate, encontrado pela QA, **foi corrigido e verificado**: antes da correção a execução parava no gate mesmo com `cycle`+`gates` ligados; depois, o mesmo cenário chega ao fim e o pull request abre.
- A suíte passou inteira uma vez verde nesta passada, e a verificação de QA registrou que passou verde em duas corridas limpas com a correção.

## O que não foi verificado

- **Nada do comportamento novo foi visto funcionando numa tela**: nenhuma janela foi aberta, nenhum bloco foi ligado à mão, nenhum campo do fluxo apareceu desabilitado com a dica nem a lista se atualizou ao vivo — o que se viu foi o código, os portões e os testes, e o comportamento de ponta a ponta exercitado pelo motor roteirizado.
- A execução de release não foi conduzida até os quatro passos (`beta`, `stable`, `push-branch`, `push-tag`): a exclusão da release das escolhas de push e pull request está no código e é fixada pelos testes da unidade de release, mas não foi vista rodando de ponta a ponta.
- A rede `open` fora deste Linux com `bwrap`, em macOS ou Windows, não foi exercitada (a escolha não existe lá).
- Nenhum modelo de verdade foi usado nas execuções (o motor foi roteirizado) e nenhum host de código real foi tocado.
- As duas observações conhecidas da revisão permanecem sem correção e não bloqueiam: o rótulo da etapa na lista de comandos vai como identificador interno (não passa pelo catálogo), e um comando recusado antes de virar linha da conversa fica fora da mensagem final.
