# O que foi exercitado no confinamento de leitura de uma execução

## O que esta etapa fez

Rodou os portões do projeto sobre a árvore do trabalho (a que carrega a mudança) e conferiu, por
execução, cada critério de aceite da especificação que já tem teste: o guarda de leitura do agente
de uma execução, a composição dele com o que já existia, a ligação da raiz nas três chamadas de
leitor, e o que fica de fora. Os números de comando citados abaixo são os desta rodada.

Nada foi exercitado com um modelo de verdade, uma rede ou um host de código. O motor do Claude Agent
SDK foi exercitado com a consulta dele trocada por uma falsa (os testes do arquivo), e o motor aberto
com o provedor local falso de `test/helpers/` — o que se observou foi o conjunto de opções, os hooks
e as recusas que o app entrega ao motor, não o comportamento do SDK real.

## Como o teste foi feito

O caminho que a issue nomeia (um agente leitor no motor do Claude Agent SDK) não tem como ser
exercitado de ponta a ponta aqui: um modelo real está fora de questão e o SDK é trocado por uma
consulta falsa. O que os testes fazem é montar a chamada como o executor a monta e exercitar os
hooks que o app entrega ao motor — a mesma guarda que recusaria a leitura. O guarda de caminho em si
é exercitado direto, e o motor aberto é exercitado de ponta a ponta com o provedor falso, incluindo
o texto da recusa que o modelo lê.

## O que foi executado, por critério

Cada linha diz o que foi rodado e o resultado. Onde diz "lido", foi só leitura de código; nenhuma
linha foi dada como feita sem o comando correspondente.

Os comandos por arquivo foram rodados de uma vez, sobre os dez arquivos tocados pela mudança:
`test/worktree-guard.test.ts`, `test/runner-agent.test.ts`, `test/runner-agent-open.test.ts`,
`test/runner-lifecycle.test.ts`, `test/runner-chain.test.ts`, `test/forum-mentions.test.ts`,
`test/mentions-call-line.test.ts`, `test/runner-squads-requests.test.ts`, `test/agent-roles.test.ts`
e `test/gitlab-catalogs-unchanged.test.ts` — **10 arquivos, 148 testes, todos verdes** (comando 2).
Foi essa execução que cobriu os pontos abaixo; quatro casos específicos foram rodados também
sozinhos, para mostrar o resultado deles em separado (comandos 10, 11, 15 e 16), e três arquivos
inteiros foram rodados sozinhos (comandos 17, 18 e 19).

### O guarda de leitura (critérios 2 a 7 e 9)

`npx vitest run test/worktree-guard.test.ts` — verde, dentro dos 10 arquivos abaixo.

- Leitura dentro da pasta de trabalho e da própria raiz: liberada.
- Caminho absoluto fora: recusado (`outside`), e a recusa nomeia o alvo que o agente tentou.
- `..` em qualquer posição: recusado (`traversal`), inclusive em padrão de `Glob`.
- `~`: recusado.
- Link simbólico que leva para fora: recusado; link que não leva a lugar nenhum: recusado;
  link que fica dentro: liberado.
- `.git` em qualquer profundidade e por link: recusado (`git`).
- Arquivo de nome de segredo: recusado pelo filtro que roda na frente do guarda.
- O que já existia não foi afrouxado: no mesmo arquivo, um leitor confinado continua recusando
  nome de segredo, busca ampla e a censura do resultado de busca (o guarda **soma** aos hooks das
  cerimônias, não substitui).

### O motor aberto, de ponta a ponta (critérios 2 a 7, 8 e 9)

`npx vitest run test/runner-agent-open.test.ts` — verde (o arquivo inteiro rodado sozinho, comando
19: 8/8).

Um agente leitor confinado, com o provedor local falso, pede cinco leituras: uma dentro passa,
quatro fora (absoluto, `..`, `~`, `.git`) são recusadas e o modelo lê o motivo na resposta da
ferramenta. A chamada aparece como **bloqueada** na atividade ao vivo, e o relato da recusa chega
ao `onDenied` do runner (o que vira a linha da conversa). O leitor não recebe `Write`, `Edit` nem
`Bash`.

### A raiz ligada nos três caminhos de leitor (critérios 1, 8 e 10)

- `npx vitest run test/runner-lifecycle.test.ts` — verde (e o caso da menção numa conversa de
  execução rodado sozinho, comando 15, passa). Uma execução de verdade, com o motor
  falso: as etapas de leitura (refinamento, QA, revisão) saem com a raiz de leitura igual à pasta
  de trabalho e com os hooks; o developer (que escreve) sai com o confinamento de escrita e **sem**
  raiz de leitura. A recusa de leitura de uma etapa é registrada na conversa da execução com agente,
  ferramenta e alvo (caso rodado sozinho, comando 16, passa).
- `npx vitest run test/runner-chain.test.ts` — verde (arquivo inteiro rodado sozinho, comando 17,
  10/10). O agente que responde a uma pergunta da cadeia sai com a raiz de leitura igual à pasta de
  trabalho.
- `npx vitest run test/forum-mentions.test.ts test/mentions-call-line.test.ts` — verdes (no comando
  2). A menção numa conversa de execução recebe o confinamento; a menção num canal recebe
  `undefined` (sem confinamento) e a menção de cerimônia idem.

### O que fica de fora (critério 10)

- `npx vitest run test/runner-squads-requests.test.ts` — verde (arquivo inteiro rodado sozinho,
  comando 18: 10/10). O contato de um squad chamado por outro lê o repositório do próprio squad e
  **não** recebe confinamento de leitura.
- `test/forum-mentions.test.ts` e `test/mentions-call-line.test.ts`, no comando 2: canal, conversa
  geral e cerimônia sem confinamento.

### As pastas de documentação permitidas (critério 11)

- `npx vitest run test/agent-roles.test.ts` — verde (no comando 2). A lista de raízes extras de
  leitura é a mesma que o motor já recebe como diretórios adicionais, sem as pastas achadas por
  auto-detect dentro da pasta de trabalho, e é vazia quando a pasta de trabalho não é absoluta.
- `test/worktree-guard.test.ts` e `test/runner-agent-open.test.ts` (ambos no comando 2): um caminho
  dentro de uma pasta
  de documentação permitida passa; uma pasta irmã fora da lista é recusada.

### O motor do Claude Agent SDK (critério 1 e a promessa central da issue)

`npx vitest run test/runner-agent.test.ts` — verde (no comando 2 e sozinho, comando 11), e o caso
"confines the file tools of a reading agent of a run on the SDK" rodado sozinho: passa.

O caso roda um agente leitor com o confinamento de leitura pelo caminho do SDK (a consulta do SDK
trocada por uma falsa que só registra as opções) e confere: os hooks vêm do confinamento de leitura
(`Read|Grep|Glob`, `Grep|Glob`, `PostToolUse`); `Edit`, `Write`, `Bash`, `NotebookEdit` e a rede
seguem negados; a pasta de documentação permitida entra nos diretórios adicionais; e uma recusa de
leitura chega ao `onDenied` do runner, enquanto uma leitura permitida não gera recusa.

### Onde o resultado do trabalho é guardado

Os documentos da etapa e a memória da execução são escritos pelo **app** na pasta do ciclo, dentro
da pasta de trabalho, e commitados por ele. Nesta árvore os arquivos da execução estão na pasta do
ciclo (`0_ISSUE.md` a `4_REVIEW.md` e a memória), e a mudança de código segue em quatro commits na
ordem do plano. Conferido por leitura da pasta e dos documentos desta execução; o commit desta
etapa não foi feito por esta etapa (o app faz).

### Depois de reabrir o app

`npx vitest run test/runner-lifecycle.test.ts -t "starts over the stage"` — verde. Um app que
reabre no meio de uma etapa reinicia a etapa, e o caso passa com a mudança no lugar. A raiz de
leitura é montada em toda partida de etapa, então a etapa reiniciada também a recebe — isso é o que
o caso exercita, e não uma promessa.

## Portões do projeto nesta rodada

Todos rodados nesta rodada, na árvore com a mudança. O Node da máquina é o `26.5.1` (o mesmo do
`.nvmrc`); `nvm` não está instalado, então o comando de versão do projeto não roda.

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | limpo |
| `npx vitest run test/worktree-guard.test.ts …` (os 10 arquivos tocados) | 10 arquivos, **148 testes, todos verdes** |
| `npx vitest run` (suíte completa) | **3678 passam, 0 falham, em 222 arquivos** |
| `node scripts/theme-audit.mjs` | verde (as mesmas 8 cores literais de `api.ts`) |
| `npm run i18n:lint` | verde (4054 chaves nos dois idiomas, 0 sem tradução) |
| `node scripts/public-audit.mjs` | verde (911 arquivos; 912 com este documento na árvore) — rodado antes e depois da build, sem o falso positivo que a pasta `out/` causou em rodadas anteriores |
| `npx electron-vite build` | construiu (a maior saída é o pacote do renderer) |

## Cenários

| # | Cenário | Resultado | Como foi conferido |
|---|---|---|---|
| 1 | Leitura dentro da pasta de trabalho funciona como hoje | passou | teste automatizado com agente leitor (critério 1) |
| 2 | Caminho absoluto fora da pasta de trabalho | passou | teste (critério 2) |
| 3 | Caminho com `..` | passou | teste (critério 3) |
| 4 | Caminho com `~` | passou | teste (critério 4) |
| 5 | Link simbólico que leva para fora | passou | teste (critério 5) |
| 6 | Qualquer coisa dentro de `.git` | passou | teste (critério 6) |
| 7 | Arquivo que parece guardar um segredo | passou | teste (critério 7) |
| 8 | A recusa vira linha na conversa e chamada bloqueada na atividade | passou | teste (critério 8) |
| 9 | Segredo, censura do resultado e busca ampla seguem valendo | passou | teste (critério 9) |
| 10 | Menção na conversa de uma execução; menção fora e pedido entre squads como hoje | passou | teste (critério 10) |
| 11 | Pasta de documentação na lista explícita alcançável; fora dela, recusada | passou | teste (critério 11) |
| 12 | Um leitor confinado não ganha `Edit`, `Write` nem shell | passou | teste nos dois motores |
| 13 | O agente que escreve não muda | passou | teste de regressão na suíte |
| 14 | O SDK real, com um modelo de verdade, um host ou a rede | não rodado | não há modelo nem host neste ambiente: só o conjunto de opções e os hooks entregues ao motor foram observados |

## O que não foi verificado

- **O comportamento do Claude Agent SDK de verdade não foi observado.** O teste do caminho do SDK
  troca a consulta do SDK por uma falsa: o que se observou foi o conjunto de opções e os hooks que
  o app entrega a ele, não o SDK em execução. Nenhum modelo real, nenhuma rede e nenhum host de
  código foram exercitados. Nada exercitou o motor aberto contra um servidor de verdade, só contra o
  provedor local falso.
- O `nvm use` não é executável nesta máquina (`nvm` não está instalado).
- Uma pasta de documentação achada por **auto-detect fora** da pasta de trabalho deixa de ser
  alcançável pelo leitor da execução, e não há passo de migração para cadastrá-la. Isso é um efeito
  conhecido e aceito, registrado por leitura do código e da configuração; a lista em si foi
  exercitada por teste.
- Um detalhe de teste, não do produto: o caso novo do SDK troca a lista de raízes extras **depois**
  de o confinamento montar os hooks, então aquela guarda específica não recebeu a pasta de
  documentação como raiz. O caminho de permissão está coberto por outros dois testes. É observação
  não bloqueante.
- As três falhas de tempo limite que a etapa de desenvolvimento viu na suíte completa não
  reapareceram nesta rodada; ficam como instabilidade sob carga.

## Leitura segura para a próxima etapa

A promessa da issue — um agente que só lê numa execução lê só dentro da pasta de trabalho dela, no
motor do Claude Agent SDK, com a recusa dita na conversa e na atividade — está exercitada no que o
app **entrega** ao motor (hooks, ferramentas negadas, diretórios adicionais, relato da recusa) e de
ponta a ponta no motor aberto. A verificação que falta é a do SDK real com um modelo, que este
ambiente não alcança. Nada foi afrouxado: os três guardas que já existiam compõem com o novo.
