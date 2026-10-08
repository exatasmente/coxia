# Como fazer a etapa de QA comprovar o que diz que rodou e não perder o que olhou

## O que este plano resolve

Esta etapa é técnica: parte da spec funcional (`1_SPEC.md`) e fecha os pontos que ela deixou
para o plano. Ela **leu o código** e **não executou nada** — nenhum comando, nenhuma tela,
nenhum run. Tudo o que está dito como existente vem de leitura nesta cópia de trabalho; o que
não foi lido está marcado como não verificado.

Os quatro pontos que a spec deixou abertos, e a decisão de cada um:

1. **Onde cabe a rodada de reparo.** Dentro de `runStage`, **antes** do `finally` que fecha a
   sandbox. Lido o código: hoje a sessão é fechada no `finally` do `try` que envolve a chamada
   ao motor, **antes** de o app ler e conferir a resposta
   (`src/main/runner/executor.ts:721-735`; a leitura é a linha 737, depois do `finally`).
   Como a conferência precisa do `log` da sandbox e a segunda chamada precisa das ferramentas
   e da própria sandbox, esse fecho tem de ser **adiado**: a leitura da primeira resposta, a
   conferência dos cenários, a rodada de reparo e a guarda das imagens olhadas passam para
   dentro do `try`, e só depois a sessão fecha. O `finally` do `runStage` continua fechando a
   sandbox mesmo quando algo falha (só que mais tarde), e o `finally` de `executeStage` (linhas
   434-438) continua sendo a rede de segurança.
2. **Como o app sabe qual imagem o agente olhou.** Por um registro que a ferramenta deixa:
   a `ViewImage` dos dois motores passa por `lookAtImage`
   (`src/main/sandbox/tool.ts:115-125`), e é lá que o caminho da imagem olhada é anotado. É o
   único ponto por onde as duas engines veem imagem (leitura de `src/main/sandbox/engineTool.ts`
   e de `src/main/agents.ts:501-505`), então um só gancho basta. O reconhecimento por conteúdo
   foi descartado: uma varredura por conteúdo guardaria imagem que ninguém olhou e não saberia
   separar uma imagem repetida de uma nova.
3. **A fonte única do que se publica.** Os cenários são calculados **uma vez**, depois da
   rodada de reparo e das conferências que o app já faz, e o mesmo resultado alimenta o
   registro (`recordQa`), o `5_TEST_PLAN.md` gravado e o comentário. O `5_TEST_PLAN.md` deixa
   de ser gravado como o agente o escreveu por inteiro: as linhas de cenário são reescritas a
   partir do registro, e as outras seções ficam como o agente as escreveu.
4. **As chaves de catálogo.** Lista fechada abaixo, nas duas famílias, com uma conferência de
   catálogo que já existe e que trava se uma chave faltar em um idioma.

## Decisões de desenho

### 1. A rodada de reparo (regra 1 da spec)

- **Onde.** Dentro do `try` de `runStage`, com a sandbox ainda aberta. O bloco atual
  (`executor.ts:721-735`) faz a chamada ao motor e, no `finally`, fecha a sessão; depois dele
  vêm a leitura da resposta (linha 737), o `readOutput` e o `backEvidence` (linha 752). A
  mudança é **reordenar**: a leitura da resposta e a conferência dos cenários acontecem dentro
  do `try`, com o `log` da sessão ainda disponível; se houver cenário sem respaldo
  (`unbacked: true`), a rodada de reparo roda ali; a guarda das imagens olhadas roda em
  seguida; só então a sessão fecha no `finally`. O `readOutput`/`backEvidence` que hoje rodam
  fora passam a rodar onde o `log` e as ferramentas ainda existem, ou o `log` é capturado antes
  do fecho — a escolha é do desenvolvimento, desde que (a) a rodada de reparo e a guarda fiquem
  antes do fecho da sandbox, (b) os dois tetos de tempo contem a etapa toda e (c) o fecho
  continue acontecendo mesmo quando algo falha.
- **Quantas.** No máximo uma, guardada numa variável local do próprio `runStage` (por
  tentativa, não por run): uma segunda leva de sem-respaldo depois dela é rebaixada sem nova
  chamada. Um contador no `Run` não é necessário e não deve ser criado — a etapa não gira, o
  `runStage` é uma tentativa só.
- **O que o app manda.** Um texto novo de catálogo (`prompt.sdd.runner.repair.unbacked`) que
  nomeia cada cenário sem respaldo, diz que ele foi afirmado como executado sem um comando que
  o sustente, lista os comandos que a sandbox da etapa viu numerados, e dá as quatro saídas do
  agente: guardar a comprovação e apontar o comando; apontar o comando; assumir como lido;
  assumir como não rodado. O texto é entregue como mensagem de entrada da etapa, pelo mesmo
  caminho de `call.incoming` que já entrega uma mensagem da pessoa (`executor.ts:617-621`,
  `src/main/engine/incoming.ts`), marcada entre `<data>` como qualquer material de fora.
- **A segunda chamada.** Reusa o mesmo `AgentCall` da primeira, com o mesmo `exec`, o mesmo
  `evidence`, o mesmo `watch` (o cão de guarda não é recriado: os dois tetos contam a etapa
  toda, como a spec manda) e o mesmo `schema`. O motor devolve a resposta inteira outra vez
  (`summary`, `artifacts` com o plano de teste, `comment`, `scenarios`), e **essa** resposta é
  a que o app lê, grava e publica. É o mesmo padrão do reparo de formato que já existe no motor
  aberto (`src/main/engine/open/loop.ts:543-549`): uma volta, com as ferramentas da etapa, e o
  resultado só depois dela.
- **O teto de tempo.** O `watchdog` (`executor.ts:192-251`) é criado por tentativa
  (`executor.ts:610`) e o `guard` arma o relógio e o teto de silêncio a cada trabalho que
  vigia, com o teto de relógio reiniciado no começo de cada `guard` (`capLeft = limits.maxMs`).
  Como hoje cada `guard` conta do zero, a segunda chamada precisa correr **dentro do mesmo
  `guard`** da primeira (as duas chamadas na mesma promessa vigiada), e não num `guard` novo,
  senão o teto de relógio passaria a valer duas vezes e a etapa poderia durar o dobro do
  configurado. **Não verificado:** não foi lido um caminho que hoje faça o motor ser chamado
  duas vezes na mesma tentativa; a segunda chamada é trabalho novo, e o lugar exato onde ela
  entra no `guard` é o ponto que o desenvolvimento precisa confirmar (ao vivo e com teste).
- **A linha na conversa.** O pedido e o desfecho da rodada são escritos na conversa da
  execução como linha de sistema (código novo, `main.forum.code.runner.qa.repair` e
  `main.forum.code.runner.qa.unbacked`), no mesmo formato de `runner.qa.commands`
  (`executor.ts:501`). A linha do rebaixamento só sai para o cenário que **continuou** sem
  respaldo depois da volta; o que o agente guardou ou apontou não gera essa linha, porque já
  aparece como comprovação ou comando na própria conversa.
- **A etapa sem sandbox.** `backEvidence(..., !!session)` já devolve tudo como `read` quando
  não há sessão. A rodada só é pedida quando `session` existe e há cenário `unbacked`; sem
  sandbox, nada muda (regra 9).
- **A falha da etapa.** Um erro que venha da segunda chamada (tempo, passos, orçamento) sobe
  como hoje pela mesma via do `try/finally`; a etapa falha como falharia na primeira.

### 2. A fonte única do que se publica (regras 11-15)

- **Um cálculo só.** Depois da rodada de reparo, o app calcula `output.scenarios` **uma vez**
  (o resultado de `backEvidence` da resposta que fica). Esse mesmo vetor é o que vai para
  `recordQa` (`src/main/runner/service.ts:694`), para o documento e para o comentário. Hoje o
  `out` que chega ao comentário e ao `recordQa` é o mesmo objeto da resposta
  (`service.ts:643-708`), então basta o executor já devolver `output.scenarios` normalizado e
  o comentário deixar de ler o texto do agente para os cenários.
- **O `5_TEST_PLAN.md`.** Hoje `writeArtifact` grava o conteúdo como o agente mandou
  (`executor.ts:765`, `src/main/runner/cycleFolder.ts:113-134,137-145`). Passa a haver uma
  função pura, por exemplo `testPlanWithResults(content, scenarios)`, em `src/shared/runs/`,
  que reescreve as linhas de cenário a partir do registro e deixa as outras seções intactas.
  Ela roda **antes** do `tidyArtifact`/`writeArtifact`, para o cabeçalho continuar sendo
  normalizado como hoje.
- **O comentário.** `renderComment` (`src/shared/runs/comment.ts:56-78`) continua montando as
  seções a partir do texto do agente, mas as partes que falam de cenários passam a vir do
  registro: `resultWord`, `notesTail` e `evidenceTail` já leem `end.output.scenarios`
  (`src/main/runner/publish.ts:574-597`), então o que muda é o `StageEnd.output` ser o já
  normalizado, e a seção do padrão que lista cenários executados dizer só o que o registro
  sustenta. Um cenário rebaixado nunca aparece como executado em nenhuma das três saídas.
- **O que continua do agente.** O que o agente escreveu sobre o que fez e viu continua sendo
  dele (regra 15): só o **resultado** de cada cenário e a **marca de como foi checado** passam
  a vir do registro.

### 3. O que o agente olhou e não guardou (regras 16-21)

- **O registro.** Um conjunto de caminhos olhados por etapa, mantido em memória no escopo do
  `runStage` (não vai a disco, não é config). O gancho é `lookAtImage`
  (`src/main/sandbox/tool.ts:115-125`), que passa a notificar quem o chamou — um callback
  `onLooked(path)` que o executor já fornece quando monta as ferramentas, no mesmo lugar em que
  monta `evidenceToolsOf` (`executor.ts:563-585`). Um id de comprovação (`ev-N`) olhado **não**
  entra no conjunto: a comprovação já existe.
- **A guarda no fecho.** Depois da resposta final (com a rodada de reparo, quando houver) e
  **antes** do `finally` que fecha a sandbox, o app percorre o conjunto, e para cada caminho
  que ainda não é comprovação guardada chama o caminho de guarda já existente — a mesma
  `putEvidence` (`src/main/evidence/store.ts:58-95`), que lê a pasta de saída pelo mesmo
  resolvedor de caminho (`src/main/evidence/paths.ts:44-76`), confere o tipo pelo conteúdo e
  respeita o teto de tamanho. O título é novo (`main.evidence.keptByApp`, com o texto que a
  ferramenta trouxe na descrição, quando trouxe) e o registro sai pelo mesmo `onKept` que
  publica a comprovação na conversa e a guarda em `Run.evidence`.
- **O que não der certo.** O que o agente abriu e não puder ser guardado (não é imagem, passa
  do teto, o arquivo já não está lá) vira uma linha de sistema `runner.qa.lookNotKept` com o
  motivo, uma por item. Só quando houver o que dizer; sem imagem olhada, nenhuma linha
  (regra 21).
- **Uma vez só.** Uma imagem que o agente já guardou durante a etapa não é guardada de novo:
  o conjunto guarda o caminho olhado, e a guarda no fecho confere se ele já é uma comprovação
  da etapa antes de chamar `putEvidence`. Imagem repetida olhada duas vezes é uma linha no
  conjunto (o conjunto é de caminhos), então é guardada uma vez.
- **A ordem com o reparo.** A guarda roda depois da rodada de reparo, para que o que for
  guardado no fecho seja comprovação da resposta que fica registrada (regra 17).
- **Não verificado / a maior incerteza.** Não foi lido um registro de cada imagem que o agente
  abriu; o gancho em `lookAtImage` é o que o plano propõe criar, e é a parte de maior risco.
  Se ao implementar o gancho se mostrar que a `ViewImage` passa por mais de um caminho (por
  exemplo um caminho do SDK que não seja o `lookAtImage`), é preciso cobrir os dois antes de a
  guarda automática valer. Se a guarda automática se revelar impossível, a saída honesta é a
  outra opção da issue — dizer na conversa o que foi olhado e não guardado — e isso precisa
  ser dito na entrega (é o que a spec admite em "Se algo aqui se revelar impossível").

### 4. O texto (chaves de catálogo)

Todas nas duas famílias (`main.*` e `prompt.*`), em `src/shared/i18n/main.en.json` e
`main.pt-BR.json`, com os mesmos `{placeholders}` nos dois — é o que `test/i18n.test.ts:61-87`
e `npm run i18n:lint` conferem. Chaves a criar:

- `prompt.sdd.runner.repair.unbacked` — o texto da rodada de reparo para o agente.
- `main.forum.code.runner.qa.repair` — a linha do pedido de reparo na conversa.
- `main.forum.code.runner.qa.unbacked` — a linha do rebaixamento, com o nome do cenário.
- `main.forum.code.runner.qa.lookNotKept` — a linha de "visto, não guardado", com o motivo.
- `main.forum.code.runner.qa.lookKept` — a linha de quantas imagens foram guardadas no fecho.
- `main.evidence.keptByApp` — o título da comprovação guardada pelo app.

As linhas de `runner.qa.*` e `main.evidence.*` falam com a pessoa e passam pelas conferências
de comentário (`src/shared/runs/comment.ts:108-269`), que recusam primeira pessoa, nome de
ferramenta e a palavra "fórum": o texto novo precisa respeitar isso.

### 5. Correções de passagem

- **A regra que ficou falsa.** `.coxia/rules/runner.md:65-67` diz que a afirmação de um agente
  não é conferida pelo app. Já é falso hoje no caso estreito do respaldo de um cenário de QA
  (`backEvidence` compara com os comandos da etapa desde antes desta issue), e fica mais falso
  com a rodada de reparo. É corrigida nesta mesma mudança, no arquivo dela.
- **Um erro de digitação** no comentário sobre a classificação de um comando (o do modo
  aplicativo) fica na mesma passagem que esta issue mexe, conforme a spec já aponta.
- **Um teto divergente**: o comentário do módulo de comprovação fala de um teto que difere do
  teto em uso, e a conferência pública isenta o arquivo por um falso positivo. Fica como ponto
  a limpar quando esta issue passar por ali, não como afirmação de que o comportamento está
  errado. Não foi lido nenhum lugar em uso cujo cálculo dê aquele teto.

## Ordem de implementação

1. **O registro da imagem olhada** (`lookAtImage` + callback), com teste, porque é a maior
   incerteza e não depende do resto.
2. **A rodada de reparo** no `runStage`, com as chaves de texto e as linhas na conversa.
3. **A fonte única**: `output.scenarios` normalizado depois do reparo, o `5_TEST_PLAN.md`
   reescrito a partir do registro, e o comentário deixando de dizer executado onde o registro
   diz lido.
4. **A guarda automática no fecho** e as linhas de visto-não-guardado e de contagem.
5. **As correções de passagem** e a linha do `CHANGELOG.md` sob `## [Unreleased]` (mudança
   visível ao usuário).

## Riscos e como são cobertos

- **A segunda chamada não caber no ciclo de vida da sandbox.** Hoje o fecho da sessão está
  antes da leitura da resposta (`executor.ts:721-735,737`); a mudança **adia** esse fecho para
  depois da rodada de reparo e da guarda das imagens, mantendo-o no `finally` para o caminho
  de falha. **Não verificado:** nenhum run foi exercitado; é o primeiro ponto a confirmar ao
  vivo.
- **O teto de relógio da etapa valer duas vezes.** Coberto por as duas chamadas correrem dentro
  do mesmo trabalho vigiado pelo `guard`, com teste que confere o número de chamadas ao motor
  e não um limite de tempo real.
- **O gancho da imagem não cobrir todos os caminhos.** Coberto por o gancho ficar no único
  ponto comum às duas engines (`lookAtImage`), com teste que olha uma imagem e confere que ela
  foi registrada. Se aparecer outro caminho, cobrir antes de a guarda valer.
- **O cabeçalho do documento engolir a lista de cenários.** A normalização de `tidyArtifact`
  (`cycleFolder.ts:113-134`) remove a primeira lista de fatos do registro da issue logo abaixo
  do título. A reescrita das linhas de cenário é feita dentro de uma seção do documento, não
  logo abaixo do título, e o plano a coloca **antes** do `tidyArtifact`, para o cabeçalho ser
  normalizado como hoje. Um teste com um plano de teste cujo título é seguido de uma lista de
  cenários confere que nenhuma linha de cenário some. **Não verificado:** não foi lido um caso
  real; é o teste que o cobre.
- **A guarda automática guardar o que ninguém olhou ou duas vezes.** Coberto por a guarda só
  olhar o conjunto das imagens efetivamente abertas e por conferir a comprovação existente
  antes de guardar.
- **Duas contas diferentes para os cenários.** Coberto por o vetor normalizado ser calculado
  uma vez e ser o mesmo objeto entregue a `recordQa`, ao documento e ao comentário.
- **A guarda ler caminho fora da pasta de saída.** Continua valendo o resolvedor existente
  (`paths.ts`), com a conferência de link e de tamanho; a guarda não inventa leitura nova.

## Como será testado

Testes com fakes, sem modelo, host nem rede, seguindo `test/runner-evidence.test.ts` (o mundo
de pasta temporária) e `test/runs-scenario.test.ts` (as funções puras):

- **A rodada de reparo:** um teste de executor com um motor falso que responde duas vezes —
  a primeira com um cenário `executed` sem comando, a segunda com o comando apontado — e
  confere que houve **uma** segunda chamada e que o cenário ficou `executed` no registro.
- **O rebaixamento depois da volta:** o motor falso não resolve na volta; confere que o
  cenário fica `read` com `unbacked`, que só houve uma rodada e que a linha do rebaixamento
  está na conversa.
- **A fonte única:** um teste puro que, dado o vetor normalizado, confere que o
  `5_TEST_PLAN.md` reescrito e o comentário não chamam de executado um cenário que o registro
  tem como lido, e que um cenário `not-run` aparece como não rodado.
- **A imagem olhada:** um teste que abre uma imagem da pasta de saída fora da guarda e confere
  que ela foi registrada; um teste do fecho confere que ela termina como comprovação da etapa,
  com o título que diz que foi guardada pelo app, e que uma imagem já guardada não é guardada
  de novo.
- **O visto-não-guardado:** uma imagem acima do teto e um arquivo que não é imagem terminam
  como "visto, não guardado" na conversa, com o motivo.
- **A etapa sem sandbox:** nenhuma rodada extra e todos os cenários lidos.
- **Os catálogos:** `test/i18n.test.ts` e `npm run i18n:lint` conferem as chaves novas nos dois
  idiomas.
- **A conferência de fecho:** as portas de `CONTRIBUTING.md` (`npx tsc --noEmit`,
  `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`,
  `node scripts/public-audit.mjs`).

## O que este plano não decidiu

- **A prioridade e o marco** são da spec (`1_SPEC.md`), não deste plano: prioridade a mais alta
  dos níveis configurados, nenhum marco.
- **O comportamento de uma etapa sem sandbox** fica como hoje, por decisão da spec.
- **Nada de fora do escopo da spec**: não se lê o texto de dentro de uma imagem, não se guarda
  o que não é imagem, nem o que a etapa não abriu, e o rebaixamento não reprova a etapa.

## O que esta etapa não verificou

Esta etapa é de plano: leu a issue, a triagem, a spec e o código citado, e **não executou
nada** — nenhum comando foi rodado, nenhuma tela foi aberta e nenhum run foi reproduzido. Toda
afirmação sobre o comportamento de hoje vem de leitura do código nesta cópia.

Não verificado, e a confirmar no desenvolvimento:

- Se uma segunda chamada ao motor cabe no ciclo de vida da sandbox com o mesmo conjunto de
  ferramentas nos dois motores. Lido: a sandbox é fechada no `finally` do `try` que envolve a
  chamada (`executor.ts:721-735`) e a resposta é lida depois dele (linha 737), então o fecho
  precisa ser adiado; não foi lido um caso que já faça duas chamadas na mesma tentativa.
- Se o gancho em `lookAtImage` cobre todos os caminhos pelos quais as duas engines mostram
  imagem. Lido: as duas passam por `lookAtImage` (`sandbox/tool.ts:115-125`,
  `sandbox/engineTool.ts`, `agents.ts:501-505`); não foi exercitado.
- Se o cabeçalho de um documento de etapa engole uma lista de cenários logo abaixo do título.
  Lido o normalizador (`cycleFolder.ts:113-134`); não foi exercitado.
- Se as chaves de catálogo novas bastam e se algum teste de catálogo trava a lista. Lido
  `test/i18n.test.ts:61-87`; os testes não foram rodados.
- Nada disto foi exercitado; nenhum host, modelo ou sandbox real foi usado nesta etapa.
