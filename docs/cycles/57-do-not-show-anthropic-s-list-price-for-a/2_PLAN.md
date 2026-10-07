# O custo da etapa passa a dizer de onde veio o número

## Como a mudança será feita

A decisão sobre o número de custo passa a ser tomada onde o provedor da chamada é
conhecido: no caminho do SDK, antes de virar o custo da etapa.

Na API própria da Anthropic o valor que o SDK devolve continua sendo o custo cobrado.
Em qualquer outro provedor — nuvem (Bedrock, Vertex, Foundry) ou um endereço próprio — o
número deixa de ser o preço cobrado e passa a valer como estimativa marcada; quando o
provedor não devolve preço nenhum, a etapa mostra um valor estimado, nunca "desconhecido"
e nunca uma célula vazia.

O registro da etapa passa a guardar, junto com os números, a procedência do custo, e essa
procedência sobe até a linha do tempo da execução. A frase que acompanha o valor deixa de
afirmar que todo valor presente foi informado pelo provedor e passa a distinguir valor
cobrado de valor estimado.

Como o pedido é que a etapa nunca fique sem valor, a estimativa precisa de um preço de
origem. Essa origem não está definida e não cabe a esta etapa decidir: enquanto ela não
estiver definida, a implementação mantém o valor que já existe hoje, marcado como
estimativa. Com isso, o comportamento medido na issue — um valor de preço de lista
mostrado como preço pago — deixa de acontecer, e a etapa continua mostrando um número com
a marca correta.

## O que muda, por área

- **Provedores e motores de agente.** A decisão sobre o custo de uma chamada que roda pelo
  caminho do SDK passa a levar em conta o provedor que a atendeu: só a API própria da
  Anthropic trata o número do SDK como preço cobrado.
- **Registro de uso da etapa.** O registro da etapa passa a carregar a procedência do custo
  (cobrado ou estimado), somada entre as tentativas da etapa com uma regra explícita.
- **Tela da execução.** A linha de uso do modelo na etapa passa a dizer se o valor é o
  cobrado ou uma estimativa, em vez de dizer que todo valor foi informado pelo provedor.
- **Documentação.** A descrição de provedores e a do runner deixam de afirmar que o app não
  estima preço e passam a descrever a estimativa marcada como tal, com uma linha sob
  `## [Unreleased]` no changelog.
- **Tokens.** Não mudam: os totais enviados, recebidos e servidos do cache continuam iguais
  aos de hoje.
- **Fora do escopo.** O total único de cerimônias e execuções (ficou com outro número,
  citado na própria issue); o painel de custo e a retenção das sessões das execuções;
  moeda que não seja dólar.

## Decisões que ficam fixadas para a implementação

1. **O que é a API própria da Anthropic.** O provedor cujo `kind` é `anthropic` e cujo
   `baseUrl` é exatamente o endereço da API (o mesmo teste que o runtime já usa para
   decidir como autenticar). Tudo o mais não é: `bedrock`, `vertex`, `foundry`, um
   endereço próprio marcado como legado, e qualquer provedor de outro tipo.
2. **O caminho do motor aberto não muda.** Lá o custo só existe quando o provedor o
   informa; sem ele o motor estima os tokens, não o preço. Uma etapa do motor aberto com
   custo informado continua com o valor cobrado.
3. **A decisão não vai para o runner.** O runner continua gravando o que o motor reporta;
   ele não passa a estimar preço por conta própria. Quem decide é o caminho do SDK, que
   recebe o alvo resolvido da chamada.
4. **A combinação entre tentativas.** O custo em dólar continua sendo somado como hoje. A
   procedência da etapa é estimada se, e só se, o custo da etapa não for nulo por causa de
   algum valor estimado: qualquer valor cobrado presente torna a etapa cobrada. A conta é
   explícita na função de soma e no registro do uso.
5. **A marca nasce com o valor.** O relatório de uso emitido pelo caminho do SDK passa a
   dizer se o custo que ele carrega é estimado, e quem soma preserva essa marca. Um
   relatório sem custo não mexe na procedência da etapa.
6. **Os dois significados da marca.** O texto da tela distingue tokens estimados (o
   servidor não informou o uso — já existe hoje) de custo sem cobrança real (novo). O
   contrato de uso ganha um campo próprio para o custo estimado, em vez de sobrecarregar o
   campo que hoje só diz que os tokens foram estimados.
7. **Compatibilidade do arquivo da execução.** A execução já gravada continua abrindo: a
   procedência é opcional no formato e um registro sem ela é lido como cobrado (é o que o
   campo já significava). Nenhum campo novo é obrigatório e a versão do formato não muda,
   logo não há passo em `STEPS` — a mudança não toca a configuração.
8. **O formato do arquivo é verificado.** O esquema do arquivo da execução precisa aceitar
   o campo novo, ou a execução gravada com ele seria recusada na próxima leitura.

## Onde cada mudança entra

- `src/main/agents.ts` — o caminho do SDK: hoje lê o custo do resultado e o emite sem olhar
  o provedor; passa a decidir pelo alvo resolvido da chamada, que já recebe.
- `src/shared/runs/usage.ts` — o relatório de uso e a soma: preservar a procedência e
  aplicar a regra de combinação.
- `src/shared/runs/types.ts`, `src/shared/runs/schema.ts` — o registro da etapa e o
  esquema do arquivo.
- `src/main/runner/service.ts`, `src/shared/runs/transitions.ts` — o que o runner grava na
  etapa não muda de forma; a novidade vem dentro do valor somado.
- `src/shared/runs/view.ts`, `src/renderer/src/screens/cycle/StageTimeline.tsx`,
  `src/shared/i18n/ui-cycle.pt-BR.json` e `ui-cycle.en.json` — a procedência chega ao
  texto da tela, com as chaves nos dois catálogos.
- `docs/llm-providers.md`, `docs/runner.md`, `CHANGELOG.md` — a documentação e a nota de
  lançamento.

## Riscos e como são cobertos

- **Tratar como "não Anthropic" um endereço que é a própria API** (por barra final, por
  caixa ou por espaço): o teste do endereço precisa ser o mesmo que o runtime já usa para
  autenticar, e não uma comparação nova escrita à mão. Coberto por teste que exercita a
  API própria e um endereço próprio.
- **Uma execução com mais de um provedor nas mesmas tentativas**: a regra de combinação
  escolhida pela implementação precisa ser explícita (a decisão 4) e coberta por teste com
  uma tentativa cobrada e uma estimada.
- **A marca de token estimado virar marca de custo estimado** e o texto da tela confundir
  as duas origens: os dois casos precisam de campo e de texto próprios, e de teste.
- **A estimativa sem origem de preço**: se a implementação inventar um preço, a etapa passa
  a mostrar um número que ninguém cobrou. Enquanto a origem não for decidida, o valor
  existente é mantido marcado como estimativa; a implementação não inventa preço.
- **Uma execução já gravada deixar de abrir**: o campo novo é opcional no esquema e o
  registro sem ele é lido como cobrado; coberto pelo teste de leitura do arquivo.
- **Um teste que alcance o provedor de verdade**: os testes usam o SDK simulado e os
  motores falsos, como os que já existem para o uso da etapa e para o caminho do SDK.

## Como será testado

- **Caminho do SDK, API própria da Anthropic**: o custo do SDK continua virando o custo
  cobrado da etapa, sem marca de estimativa.
- **Caminho do SDK, provedor que não é a API própria** (endereço próprio, Bedrock, Vertex,
  Foundry): o número do SDK não vira o valor cobrado; a etapa mostra um valor marcado como
  estimativa, e nunca ausência de valor.
- **Soma e registro**: os totais de tokens continuam exatamente iguais aos de hoje
  (enviados, recebidos e do cache) e a procedência é combinada entre tentativas conforme a
  regra fixada.
- **Motor aberto**: uma etapa com custo informado pelo provedor continua marcada como
  cobrada, e os tokens estimados continuam marcados como tokens estimados, sem se
  confundirem com o custo.
- **Tela**: o texto ao lado do valor deixa de afirmar que todo valor presente foi informado
  pelo provedor; as duas origens se distinguem, nos dois idiomas.
- **Formato do arquivo**: uma execução gravada com o campo novo é aceita na leitura, e uma
  gravada sem ele continua abrindo.
- **Nenhum teste alcança a rede**: o SDK e os motores continuam simulados.

Esta etapa não executou nada: nenhum teste, nenhum comando e nenhuma reprodução da
distorção relatada. Tudo o que o plano afirma sobre o código vem de leitura dos arquivos, e
o comportamento em execução é não verificado.

## O que fica em aberto

- **A origem do preço da estimativa.** Sem uma cobrança real do provedor, a estimativa
  precisa vir de um preço em algum lugar, e de onde ele vem não está definido: a leitura
  desta etapa não encontrou nenhuma tabela de preços no repositório para o caminho do SDK,
  e o único pedido de custo por geração que existe hoje é o do painel de custo, feito pela
  interface do provedor reconhecido pelo endereço. A issue decidiu que a estimativa é
  mostrada, não de onde o preço vem.
- **O que a tela faz com uma etapa cujo custo ficou estimado em moeda que não seja dólar.**
  Fora do escopo, mas registrado: nenhuma conversão é feita e o valor é lido como dólar,
  como hoje.
- **Renomear o rótulo do grupo de sessões do app no ajuste de retenção**, que hoje diz
  "Claude": é uma precisão de texto, não uma mudança de comportamento, e não é desta
  entrega.
