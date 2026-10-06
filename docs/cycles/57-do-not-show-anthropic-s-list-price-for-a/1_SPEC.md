# O custo de uma etapa passa a ser o que o provedor cobrou

## O que muda para quem usa

Numa execução que roda pelo caminho do SDK, o valor em dólar mostrado na etapa passa a
corresponder ao provedor que atendeu a chamada.

Fora da API própria da Anthropic, o preço de lista dela deixa de aparecer: um provedor que
serve um modelo Claude sem ser a API da Anthropic — nuvem (Bedrock, Vertex, Foundry) ou um
endereço próprio — não gera mais o número que o SDK calcula como se a chamada tivesse ido
para a Anthropic. A execução da issue medida aparecia como US$ 51,55 quando o provedor
cobrou cerca de US$ 1,5; esse valor deixa de ser mostrado como um preço pago.

Quando o provedor em uso informa quanto a chamada custou, esse número continua sendo o da
etapa, apresentado como o valor cobrado. Quando ele não informa, a etapa continua mostrando
um valor, marcado como estimativa: a pessoa vê explicitamente que aquele número é uma
aproximação, e não o que foi cobrado. Nenhuma etapa passa a mostrar "desconhecido" no lugar
do custo.

Os tokens (enviados, recebidos e os servidos do cache) continuam sendo registrados por
resposta, como hoje, e a contagem não muda com esta mudança.

## O que se pede

Nas palavras da issue:

> Do not show Anthropic's list price for a call that went to another provider through the
> SDK, and carry "estimated" to the screen.
>
> - When the provider of the role is not Anthropic's own API, the SDK's `total_cost_usd`
>   does not become the stage's cost: it is left unknown, or marked as an estimate.
> - The `estimated` flag the open engine already reports reaches `StageUsage` and the run
>   timeline.
> - The token counts already recorded stay as they are.

E, no comentário de quem abriu, sobre o escopo reduzido:

> Escopo reduzido: os tokens de uma chamada do SDK já são contados por resposta
> (`src/main/agents.ts`). Fica aqui só não mostrar o preço de lista da Anthropic fora da
> Anthropic e levar a marca de estimativa até a tela. O total único de cerimônias e
> execuções foi para #104. Prioridade alta mantida.

A resposta dada na conversa fecha a leitura que faltava: fora da API própria da Anthropic,
em nenhum outro provedor — inclusive Bedrock, Vertex e Foundry — o número do SDK vira o
preço da etapa, e quando o provedor não oferece a cobrança real a etapa mostra o valor
marcado como estimativa, nunca "desconhecido".

## Regras

1. O custo de uma etapa é o que o provedor que atendeu a chamada informou, ou uma
   estimativa marcada como tal. O número de preço de lista da Anthropic só vale na API
   própria da Anthropic.
2. Fora da API própria da Anthropic, um valor estimado não pode ser mostrado sem a marca de
   estimativa — nem na etapa, nem em qualquer lugar que some ou repita o custo da etapa.
3. A marca de estimativa da etapa cobre duas origens, e as duas são distinguíveis pelo texto
   da tela: tokens estimados, quando o servidor não informa o uso (já existe hoje), e custo
   sem cobrança real do provedor (novo).
4. Os tokens registrados por etapa não mudam de comportamento com esta mudança.
5. A precisão da frase que descreve o custo ao lado do valor é parte da entrega: hoje ela
   diz "informados pelo provedor" para qualquer valor presente, inclusive um que não é o
   preço pago.

## Fora do escopo

- O total único de cerimônias e execuções: saiu desta issue por decisão de quem a abriu e
  ficou com outro número, citado na própria issue.
- Definir e implementar a origem do preço usado na estimativa. Com a cobrança real do
  provedor ausente, a estimativa precisa vir de um preço em algum lugar, e de onde esse
  preço vem ainda não está definido.
- Ligar a marca de estimativa ao painel de custo e à tela de retenção, que hoje não
  reconhecem as sessões das execuções.
- Tratar cobrança em moeda que não seja dólar.

## Perguntas em aberto

- De onde vem o preço usado na estimativa quando o provedor não informa a cobrança. A
  leitura do código desta etapa não encontrou nenhuma tabela de preços no repositório, e
  nenhum pedido de cobrança por geração é feito hoje a partir de uma chamada do SDK; a
  issue não decidiu a origem. A pessoa aceita a estimativa, não a origem dela.

## Critérios de aceite

Cada item abaixo foi redigido para poder ser conferido lendo a tela ou a documentação. Nada
nesta etapa foi executado: nenhum teste, nenhum comando e nenhuma reprodução da distorção
relatada; a leitura do código e dos documentos foi feita apenas por leitura dos arquivos.

1. Numa execução cuja etapa rodou por um provedor que não é a API própria da Anthropic —
   nuvem (Bedrock, Vertex, Foundry) ou um endereço próprio —, o número de preço de lista da
   Anthropic não aparece como o custo da etapa.
2. Nessa mesma etapa, quando o provedor informa o custo, a tela mostra esse valor.
3. Nessa mesma etapa, quando o provedor não informa o custo, a tela mostra um valor
   marcado como estimativa. Não aparece "desconhecido" nem célula vazia no lugar do custo.
4. Numa etapa que rodou na API própria da Anthropic, o custo do SDK continua sendo mostrado
   como o valor cobrado.
5. Uma etapa que rodou pelo motor aberto com custo informado pelo provedor continua marcada
   como o valor cobrado, e não como estimativa.
6. Quando o servidor não informa o uso e os tokens são estimados, o texto a distingue do
   caso de custo sem cobrança real, para que as duas origens não se confundam.
7. Os totais de tokens de uma etapa (enviados, recebidos e os servidos do cache) continuam
   iguais aos de antes da mudança.
8. A frase ao lado do valor deixa de afirmar que todo valor presente foi informado pelo
   provedor.
9. A documentação de provedores deixa de afirmar que o custo aparece sempre que o provedor
   ou o SDK o informa, e passa a descrever a estimativa marcada como tal.
10. Nenhum teste automatizado passa a alcançar um modelo de verdade, um host de código real
    ou a rede.
