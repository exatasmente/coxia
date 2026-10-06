# Como o Coxia passa a carregar plugins e a executá-los dentro da fronteira que já existe

## O que este plano resolve

A spec fixou o comportamento (Regras 1 a 14), o kit e a primeira entrega. Falta o
mecanismo. Este plano decide, em ordem:

1. onde a declaração de um plugin vive, como é lida e como é validada;
2. como o catálogo de acontecimentos é publicado no kit e conferido pela plataforma;
3. como o script do plugin roda dentro da fronteira que já existe (sandbox por etapa,
   sem rede por padrão, rede só pela lista que a pessoa escreveu);
4. como o pedido de escrita externa de um plugin entra na porta única de Ações;
5. como um tipo de documento novo entra na pasta do ciclo e é lido por um gate sem
   tocar no código que lê os tipos de hoje;
6. como ligar e desligar um plugin vale a partir da próxima coisa que usa a capacidade,
   sem reiniciar o aplicativo.

Nada aqui reabre a spec. As duas perguntas em aberto dela são da pessoa e não travam o
contrato mínimo das Regras 6 a 8.

## Decisões de mecanismo

### 1. Onde o plugin vive e como é declarado

- `WorkspaceConfig` ganha uma seção `plugins` (schema 13, ver `technical`). Ela guarda
  uma pasta de plugins, a lista de plugins ligados e as permissões que a pessoa concedeu
  a cada um. Nada mais.
- Cada plugin é uma pasta dentro da pasta de plugins do espaço de trabalho. A pasta
  traz uma declaração (`plugin.json`) e nenhum carregador nativo: nada de `.node`,
  nada de binário por plataforma (Regra 2).
- A declaração é um documento pequeno, com **nome**, **identidade** (id estável),
  **versão de contrato** e as listas do que ele oferece: os acontecimentos que observa,
  os tipos de documento que acrescenta, o que ele declara precisar da rede e o destino
  neutro da escrita externa da primeira entrega. A forma exata está em `technical`.
- A leitura do plugin é separada da execução dele: uma função pura de leitura e
  validação recebe o texto da declaração e o espaço de trabalho, e devolve ou o plugin
  desdobrado (com o motivo de qualquer parte recusada) ou a recusa com o motivo. O
  mesmo caminho roda nas três plataformas, porque não toca em nada do sistema.
- Recusas que a leitura faz, cada uma com motivo próprio: falta de nome, falta de
  identidade, identidade repetida dentro da pasta, versão de contrato que este
  aplicativo não entende, acontecimento fora do catálogo, e caminho que escapa da pasta
  do plugin. Uma declaração recusada não impede o Coxia de abrir (Regra 12).

### 2. A lista de plugins e o ligar/desligar

- A lista é do espaço de trabalho: nome, o que oferece, o que pode alcançar e o estado.
  Ela é montada do mesmo documento que a validação deixa pronto, e é publicada para a
  interface como uma lista só (Regra 4), sem uma tela nova por plugin.
- Ligar e desligar é a pessoa, no computador. Um navegador pareado não liga nem
  desliga plugin: a chamada que muda essa lista entra no que o navegador já não pode
  alcançar, como as demais decisões de fronteira.
- Desligado (ou recusado) é desligado (Regra 5): o plugin não aparece entre o que
  oferece, nenhum hook dele é chamado e nada que ele registre é lido. A pasta continua
  no disco; o que muda é o que o aplicativo lê dela.
- Ligar e desligar vale a partir da próxima coisa que usa a capacidade: a lista é lida
  pela cara que consome a capacidade (o catálogo de acontecimentos, o desdobrador de
  documentos, a abertura da sandbox de uma etapa) no momento do uso, e as etapas em
  andamento terminam com o que começaram (Regra 3). Não há reinício.

### 3. Os hooks e o catálogo de acontecimentos

- O catálogo é **fixo e público**: uma lista curta de acontecimentos que o aplicativo já
  publica hoje (a etapa do ciclo entrou, a etapa terminou com o documento escrito, um
  gate foi decidido, uma execução terminou). Ele mora no kit e é a única fonte: a
  plataforma recusa um acontecimento que não esteja nele (Regra 6).
- O catálogo não é o canal de interface (`AppEvent`, `src/shared/types.ts:444`): aquele
  é o que a janela e o navegador seguem. Aqui é um ponto de extensão à parte, com nome
  próprio, e não substitui nem amplia o canal.
- Quem chama um hook é o próprio aplicativo, no lugar onde o acontecimento já acontece
  (o fim de uma etapa, a decisão de um gate, o fim de uma execução). A chamada é um
  serviço do lado do computador: o aplicativo pega o script que o plugin declarou, roda
  dentro da sandbox da etapa (item 4) e recolhe o resultado como material.
- Um hook que falha não derruba a etapa nem o aplicativo: o motivo entra na lista
  (Regra 12). Um hook que volta texto entra como material, entre as marcas que o
  aplicativo já usa, nunca como instrução (Regra 11).

### 4. Onde o código do plugin roda

O ponto de partida é o que já existe: a sandbox é montada por etapa a partir de uma
política pura (`src/main/sandbox/policy.ts`), sem rede por padrão, sem a pasta pessoal,
com o ambiente construído do zero; a rede de uma sandbox só sai pela lista de destinos
que o espaço de trabalho escreveu, pelo modo de registro (`SANDBOX_NETWORKS` /
`RunnerSandbox`, `src/shared/config/types.ts:687-715`; `src/main/sandbox/proxy.ts`).

O código do plugin reaproveita essa fronteira em vez de criar uma segunda:

- **Reaproveitar, não duplicar.** O plugin roda pela mesma porta que o aplicativo já usa
  para dar uma sandbox a uma etapa: a sessão de sandbox é aberta pelo serviço que já
  existe (`SandboxService.open`), com a política que já existe, e o script do plugin
  roda por ela. Não se escreve uma sandbox nova; o que a etapa usa é o que o plugin usa.
- **Sem autoridade do aplicativo.** O script do plugin nunca recebe o processo do
  aplicativo, nem o caminho de arquivo de uma chave, nem a pasta do espaço de trabalho
  fora da pasta dele. O que ele alcança está na declaração e é dito na lista (Regra 9);
  o que não está declarado é recusado, com o motivo.
- **A chave morta.** O valor de uma permissão só pode entrar no ambiente da sandbox
  depois que a pessoa a concede no computador, nunca por conta do plugin (Regra 10). Um
  espaço de trabalho de teste não amplia.
- **A rede.** Só pela lista que a pessoa já escreveu para o espaço de trabalho, e a
  leitura falha com o motivo quando a lista não cobre o destino (Regra 14). O resultado
  que volta carrega a fonte e entra como material; nada dele é escrito de volta no
  aplicativo sem passar pela porta única (item 5).

### 5. A escrita externa pela porta única

- Um plugin **não** ganha um caminho de escrita. Ele descreve o pedido; a porta única
  decide e executa. O pedido entra pela mesma proposta que já existe
  (`proposeVcsAction` em `src/main/actions.ts`), com o tipo de ação que a torna visível
  na tela de Ações e a faz esperar o "sim"; ele é recusado num espaço de trabalho de
  teste e entra no registro de auditoria de sempre (`audited`).
- O destino da escrita é um destino neutro declarado pelo próprio plugin (spec, Regra 7
  e `Fora do escopo`): um exemplo do kit, não um serviço de terceiro nomeado.
- A aprovação passa pela checagem que a porta única já faz antes de qualquer escrita
  (`assertExternalWrite`), e o que a aprovação deixa vai para o log de auditoria.

### 6. Um tipo de documento novo

Hoje os tipos de documento do ciclo são um conjunto fechado de nomes: cada etapa recebe
os documentos das etapas anteriores por `readFolder` (`src/main/runner/cycleFolder.ts`),
que aceita qualquer nome que passe o padrão de nome de documento (`ARTIFACT_NAME`,
`src/shared/runs/output.ts:133`) e o confere contra o guarda de caminho; os gates leem o
que a configuração de ciclo descreve (`SpecLayout`/`GateFiles`). Ou seja: o leitor de
documentos **já não é uma lista fechada de nomes**, e o ponto de extensão aproveita isso
em vez de mudá-lo.

- O plugin declara o nome do documento (a forma da pasta e do arquivo) e o rótulo com
  que ele aparece. O desdobrador de documentos liga esse tipo à pasta da execução:
  o arquivo é escrito pelo mesmo caminho de hoje (`writeArtifact`, com o mesmo nome
  padrão e o mesmo guarda de caminho).
- A leitura por um gate passa a ter uma fonte a mais, além da configuração do ciclo: os
  tipos que os plugins ligados oferecem entram na lista que o gate percorre hoje
  (`gateOptions`, `src/main/gate.ts:102-109`). É uma soma de duas fontes; nenhuma linha
  do leitor dos tipos atuais muda por causa disso.
- Desligar o plugin retira o tipo da lista e o documento volta a ser um arquivo comum
  na pasta, do jeito que era antes (aceitação 2).

### 7. A primeira entrega

O plugin de busca na web é a prova da plataforma e usa a plataforma como qualquer
plugin a usaria:

- **Acontecimento.** O fim de uma etapa do ciclo é o gatilho (item 3); o plugin é
  chamado ali.
- **Documento novo.** O resultado da busca entra na pasta da execução como um tipo de
  documento novo, com as fontes consultadas (item 6).
- **Escrita externa.** O que o plugin pede para fora entra na porta única e espera o
  "sim"; num espaço de trabalho de teste a confirmação é recusada (item 5).

A busca em si é do plugin; o provedor de verdade fica para outra issue (spec, `Fora do
escopo`).

## O kit

- O kit é uma pasta no repositório: o contrato (os tipos de tudo que atravessa a
  fronteira), a lista dos acontecimentos e dos gatilhos, o jeito de declarar um tipo de
  documento, o jeito de pedir uma escrita externa, o jeito de declarar o que se precisa
  da rede, e um exemplo que compila e roda — o esqueleto da primeira entrega.
- O caminho de carga que vale nas três plataformas é o mesmo: declaração lida por uma
  função pura, script rodado pela sandbox da etapa, nenhuma biblioteca nativa (Regra 2).
- A única entrada de configuração de um plugin é a configuração do espaço de trabalho;
  o plugin não tem um segundo arquivo de configuração próprio.
- Onde o kit mostra uma permissão, mostra o que é recusado sem ela (spec).
- O kit é documentação e exemplo, não um segundo produto; ele passa pela auditoria
  pública como o resto do repositório (aceitação 11).

## Peças tocadas

- **Configuração (compartilhada):** a seção `plugins` em `types.ts`, o espelho em
  `schema.ts`, o valor neutro em `defaults.ts`, o degrau de migração em `migrations.ts`
  (o esquema sobe de 12 para 13) e o teste que falha quando os três divergem.
- **Núcleo de plugins (compartilhado, puro):** a leitura e validação da declaração e o
  desdobramento do plugin em capacidades; é o módulo que os testes cobrem diretamente.
- **Catálogo de acontecimentos (compartilhado):** a lista fixa e pública, e a checagem
  de que um acontecimento declarado está nela.
- **Serviço de plugins (principal):** a leitura da pasta, a lista para a interface, o
  ligar/desligar e a chamada de um hook no lugar do acontecimento.
- **Sandbox:** nenhuma política nova; o serviço de plugins usa a abertura que já existe.
- **Ações:** um tipo de pedido de escrita de plugin na porta única, esperando o "sim" e
  indo para a auditoria.
- **Ciclo:** os tipos de documento que os plugins ligados oferecem entram na lista que o
  gate percorre; o leitor de documentos de hoje não muda.
- **Interface:** um lugar que lista os plugins do espaço de trabalho (nome, o que
  oferece, o que alcança, ligado/desligado) e o interruptor, com todo texto pelo
  catálogo nos dois idiomas e só tokens de tema.
- **Kit:** a pasta do kit com o contrato, a lista de acontecimentos, o exemplo que
  compila e o esqueleto da primeira entrega.

## Riscos e como são cobertos

- **A fronteira virar duas.** O maior risco é o plugin abrir uma segunda sandbox com
  regras próprias. A defesa é o serviço de plugins usar a mesma abertura e a mesma
  política da etapa; um teste confirma que o plugin não recebe uma sessão com política
  diferente da configurada e que a rede continua fechada sem a lista.
- **Vazamento de segredo.** O script do plugin não recebe o processo do aplicativo nem o
  caminho de uma chave, e a negação de leitura de segredo que já existe continua valendo;
  o que entra no ambiente passa pela decisão da pessoa. Um teste cobre a recusa de uma
  leitura de chave e de um caminho fora do declarado.
- **Um caminho de escrita fora da porta.** O pedido de escrita do plugin não tem um
  executor próprio: ele entra na proposta que já existe. Um teste confirma que a
  proposta espera o "sim", é recusada num espaço de trabalho de teste e entra na
  auditoria.
- **Um tipo de documento novo que quebra os gates.** O desdobrador de tipos só soma à
  lista que o gate já percorre; nenhum nome de hoje muda. Um teste cobre um tipo de
  plugin lido por um gate junto com os tipos atuais.
- **Um plugin derrubando o aplicativo.** A leitura da declaração é pura e devolve a
  recusa com motivo; um hook que falha não propaga. Um teste cobre a declaração inválida
  e o hook que falha com o Coxia seguindo.
- **Ligar/desligar sem reiniciar.** O risco é o aplicativo guardar o resultado da
  leitura numa memória de arranque e o desligar não valer. A leitura é feita no momento
  do uso, e um teste confirma que desligar retira hooks e tipos sem reinício.
- **Plugin de terceiro entrando pela porta.** A spec põe os plugins como código da
  equipe. A plataforma não distingue, então esta entrega não traz download, assinatura
  nem catálogo; um plugin é uma pasta local (spec, `Fora do escopo`).

## Como será testado

Ainda não verificado nesta etapa: nada de código foi escrito, nenhum teste foi rodado e
nenhuma configuração foi exercitada. O que segue é o que a implementação e a revisão
devem rodar.

- **Núcleo puro (Vitest, em `test/`):** declaração válida desdobra o plugin; declaração
  sem nome, sem identidade, com identidade repetida, com acontecimento fora do catálogo
  ou com caminho que escapa é recusada com o motivo; um plugin desligado não oferece
  nada; ligar/desligar vale sem reinício.
- **Configuração:** `types.ts`, `schema.ts` e `defaults.ts` batem (o teste que já existe);
  a migração de 12 para 13 dá a um espaço de trabalho sem plugins os valores neutros e
  não muda o comportamento dele (aceitação 9); um espaço de trabalho sem plugins continua
  válido.
- **Sandbox:** o código do plugin roda na mesma sandbox da etapa, com a mesma política;
  sem a lista de rede a leitura falha com o motivo; com a lista, o destino listado
  responde e um destino fora dela é recusado (aceitação 6).
- **Porta única:** o pedido de escrita do plugin espera o "sim"; num espaço de trabalho
  de teste é recusado e nada é escrito; o que for aprovado fica na auditoria
  (aceitação 7).
- **Ciclo:** um tipo de documento declarado por um plugin entra na pasta da execução e é
  lido por um gate junto com os tipos atuais, sem mudar o leitor de hoje (aceitação 5);
  desligar o plugin retira o tipo.
- **Fronteira:** uma tentativa de alcançar uma chave guardada, a pasta pessoal ou o dado
  de outro espaço de trabalho é recusada com o motivo (aceitação 8).
- **Interface (sem tela, no núcleo):** a lista traz nome, o que oferece, o que alcança e
  o estado (aceitação 1); o mesmo caminho não liga/desliga pelo navegador pareado.
- **Portões do repositório:** tipos, a suíte inteira, a auditoria de tema, o lint de
  catálogos e `node scripts/public-audit.mjs` (aceitação 11); nenhum teste do kit
  alcança modelo, host real ou a rede.
- **Conferência na revisão:** a pasta de plugins com um plugin válido, o interruptor
  valendo sem reiniciar, o documento novo aparecendo e sumindo, e a recusa de rede com
  o motivo — no aplicativo de computador.

## O que foi conferido nesta etapa

Só leitura de código nesta árvore de trabalho; nenhum teste, portão ou uso do
aplicativo, e a plataforma pedida não existe para ser vista funcionando. Conferido na
leitura: a sandbox por etapa é feita de uma política pura e sem rede por padrão, e a
rede de uma sandbox só sai por lista pelo modo de registro; a porta única de escrita
externa descreve, valida, espera o "sim" e audita toda escrita, e tem um só caminho de
execução; os documentos do ciclo são lidos por um padrão de nome (não por uma lista
fechada) e os gates os leem a partir da configuração de ciclo; o canal de acontecimentos
da interface é separado do que seria um ponto de extensão; a configuração tem versão de
esquema e migração degrau a degrau, com os três arquivos que precisam andar juntos.
Não verificado: qualquer execução, o resultado dos portões e o comportamento em tela.
