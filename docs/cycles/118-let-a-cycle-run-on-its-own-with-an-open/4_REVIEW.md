# A autonomia lida em cada decisão, a sandbox na rede e a lista de comandos: a revisão desta passada

## Veredito

**Aprovado.** Os quatro bloqueios da revisão anterior foram escritos e conferidos nesta máquina, e os critérios de aceite 1, 6 e 8 deixam de estar em falta. Ficam duas observações que não bloqueiam.

## 1. O que foi revisado

Nesta passada o trabalho foi lido direto nos arquivos do worktree e os portões foram rodados nesta máquina. O que se olhou:

- **A publicação**: `src/main/runner/publish.ts` (o resolvedor lido no ponto da decisão, o push pela porta, o pull request pela porta), `src/main/runner/door.ts` (a única porta) e `src/main/actions.ts` (`pushRunBranchAuto`, a linha de auditoria, a substituição de propostas antigas, o aviso que faz o pull request seguir).
- **A lista de comandos**: `src/shared/runCommands.ts` (o agrupamento puro), `src/main/runner/service.ts` (`postRunCommands`, o ponto único em que a execução termina) e `src/renderer/src/screens/cycle/CommandsSection.tsx`.
- **O cabeçalho e as telas**: `src/renderer/src/screens/cycle/AutonomyNote.tsx`, `src/renderer/src/screens/team/AutonomyFields.tsx`, `RunnerSection.tsx`, `FlowEditor.tsx` e `flowEdit.ts`.
- **A configuração**: `src/shared/config/autonomy.ts` (o resolvedor), `types.ts`, `defaults.ts`, `schema.ts`, `migrations.ts` (`CONFIG_SCHEMA_VERSION` 16 e o passo `v15ToV16`) e `src/main/configScope.ts` (`WEB_EDITABLE` e `raisedAutonomy`).
- **A marca do comando no computador**: `src/main/runner/executor.ts` (`hostApproval`).
- **A documentação**: `docs/runner.md` e `CHANGELOG.md`.
- **Portões rodados nesta máquina**, com o resultado que voltou: verificação de tipos **limpa**; a suíte inteira em uma corrida — **4156 casos verdes em 255 arquivos**, com duas falhas que passam sozinhas e que esta mudança não toca (uma estourou o tempo sob carga e a outra é do script de atualização); auditoria de cores com só as cores literais já conhecidas; catálogo de textos com **4422 chaves** nos dois idiomas; auditoria de repositório público com **1092 arquivos** e nada de empresa ou pessoa.

## 2. Os quatro bloqueios da revisão anterior

### 2.1 O push e o pull request saem sozinhos

A escolha é lida onde a decisão acontece, na publicação, e o resultado é o certo: com a chave geral e a escolha do push ligadas, a branch sai pela porta e a mensagem da conversa diz que foi a autonomia do ciclo que a enviou, como escrita auditada; o pull request é aberto logo depois, pela mesma porta, e a conversa diz que ele foi criado. Nenhum dos dois vira proposta em Ações. Com o push desligado, a proposta volta a ser feita como sempre foi.

**Uma execução de release fica fora das duas escolhas por construção**, e não por acaso: o próprio resolvedor da publicação devolve "não" quando a execução tem um assunto de versão, antes de olhar o bloco. Os passos de um corte (`beta`, `stable`, `push-branch`, `push-tag`) continuam esperando o "sim", e o teste da unidade de release fixa exatamente esses quatro. Um espaço de trabalho de teste continua recusando o push e o pull request: a recusa vem da porta, a conversa diz por quê, e nada sai.

### 2.2 A lista de comandos existe, viva e no fim

O agrupamento puro é usado nos dois lugares. Na tela da execução há uma seção logo abaixo da linha do tempo, que lê a conversa viva — cada mensagem nova de comando a faz aparecer de novo, sem canal novo. No fim da execução há **uma** mensagem na conversa, postada de um ponto único, quando a execução chega a concluída, cancelada ou falhou; ela é protegida contra postar duas vezes e não posta nada quando não houve comando nenhum. O texto sai da mesma lista, por agente e por etapa, e a seção diz que a lista é feita do que a execução já registra. Nada disso toca o host de código: a lista é montada a partir da conversa.

### 2.3 O cabeçalho da execução

O cabeçalho da tela da execução diz que a execução roda sozinha, quais das quatro escolhas estão ligadas e de onde vem a decisão: do bloco do espaço de trabalho, ou do bloco do fluxo com o nome do fluxo (e, no fluxo principal, a palavra que o nomeia). Numa execução de release a linha não aparece, porque o bloco não decide o push nem o pull request dela.

### 2.4 As telas dos dois blocos

O bloco do espaço de trabalho está em Configurações › Runner: os cinco campos, com os quatro de baixo desabilitados enquanto a chave geral está desligada. O bloco de cada fluxo está na edição do fluxo, com o interruptor "Usar a configuração do espaço de trabalho" ligado por padrão, os campos do fluxo desabilitados e a dica de que o espaço de trabalho decide enquanto ele está ligado. Um navegador pareado vê o bloco do espaço de trabalho e não o muda; o bloco do fluxo, que o navegador pode salvar, recusa qualquer campo que passe de desligado para ligado e recusa desligar o interruptor que entrega a decisão ao fluxo. Um bloco de um fluxo que o editor não mostra (a release, a documentação) fica como está.

## 3. As três observações da revisão anterior

- **A marca do comando sob autonomia**: quando a escolha libera um comando no computador, a conversa ganha uma linha dizendo que ele rodou aqui sob a autonomia do ciclo. A recomendação que a especificação registrava foi seguida.
- **A rede aberta na seção "Não verificado"**: o documento do runner passa a dizer que a rede aberta nasce **não exercitada**, e diz isso quanto a **alcançar** um endereço público, não só quanto a resolver o nome. Foi lido no documento.
- **A execução de release fora das duas escolhas**: deixou de ser um acidente (nada era lido) e passou a ser uma exclusão explícita no resolvedor, fixada por teste.

## 4. Observações que não bloqueiam

1. **O rótulo da etapa na lista de comandos não é traduzido.** O nome do agente passa pelo texto do catálogo, mas o da etapa vai como o identificador interno. Numa conversa em inglês, com um ciclo cujas etapas têm rótulos em português, a linha "na etapa" mostra o identificador, não o rótulo que a tela do fluxo mostra para a mesma etapa. É uma inconsistência de palavras, não um defeito de comportamento.
2. **O que entra na lista do fim é o que virou linha de conversa.** Um comando recusado antes de escrever qualquer linha não aparece na lista final, ainda que a especificação peça que um comando recusado apareça com o resultado que teve. O efeito prático é pequeno, mas vale saber onde está a fronteira.

## 5. O que não foi revisado

- **Nada do comportamento novo foi visto funcionando no aplicativo**: nenhuma tela foi aberta, nenhum bloco foi ligado à mão e nenhuma execução foi rodada de ponta a ponta. O que se viu foi o código, os portões e os testes.
- **A rede aberta não alcançou um endereço público de verdade**: o que o teste real mostra é que existe uma interface da máquina dentro da sandbox e que um nome público é resolvido; uma conexão completa não foi observada.
- O push autônomo e o pull request autônomo só rodaram contra o host falso com memória, num repositório git temporário; **nenhum host real**.

## 6. Como foi conferido

Leitura direta dos arquivos citados e execução dos portões nesta máquina: verificação de tipos, a suíte inteira de testes, auditoria de cores, catálogo de textos e auditoria de repositório público. Os quatro bloqueios foram conferidos pelo código que os escreve e pelos testes que os fixam, e não por ausência: há leitura do bloco no arquivo que publica, há uso do agrupamento nos dois lugares, há componente de cabeçalho, há seção de comandos e há chave de catálogo para a mensagem final. Nada disso foi visto rodando no aplicativo, e está dito assim.
