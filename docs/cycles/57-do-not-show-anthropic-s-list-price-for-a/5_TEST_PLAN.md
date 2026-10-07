# O que foi conferido no custo de uma etapa que roda pelo SDK

## Como a verificação foi feita

O comportamento foi exercitado por um teste de caixa preta novo, que segue o mesmo caminho que a
tela percorre: uma chamada pelo caminho do SDK do Claude (o SDK é simulado, nunca um modelo, host
ou rede), o relatório de uso que ela emite, a soma no registro da etapa e o texto que a linha do
tempo mostraria. Cada provedor é apontado por configuração, sem alcançar serviço nenhum.

Além disso, os gates do repositório foram rodados nesta cópia do código e os arquivos de teste que
a mudança toca foram exercitados junto com o novo.

Nada do que segue foi dado como feito por leitura: o resultado de cada cenário vem de um comando
que terminou com sucesso.

## Cenários e resultado

### 1. A API própria da Anthropic mantém o número do SDK como custo cobrado (critério 4)

Provedor do tipo `anthropic` apontado para `https://api.anthropic.com`, uma chamada cujo resultado
traz apenas o custo total. O relatório emitido é o número cru, sem marca de estimativa, e o texto da
linha do tempo mostra o valor cobrado.

Resultado: passa. O relatório é `{ promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0.0123 }`
e a tela devolve `$0.0123` como valor cobrado.

### 2. Fora da API própria, o mesmo número é mostrado como estimativa, nunca como cobrado (critérios 1 e 2)

Quatro provedores exercitados com o mesmo número da issue (US$ 51,55): um endereço próprio do tipo
`anthropic` marcado como legado, e Bedrock, Vertex e Foundry. Em todos, o relatório carrega o mesmo
valor com a marca de estimativa, e o texto da linha do tempo mostra o valor dito como estimado, não
como valor cobrado.

Resultado: passa nos quatro casos. O valor não desaparece e não aparece como preço pago.

### 3. Os tokens registrados não mudam com a mudança (critério 7)

Uma chamada em um provedor que não é a API própria, com uso da resposta (100 enviados, 10 recebidos,
40 do cache) e com o custo no fim. Os totais de enviados, recebidos e servidos do cache continuam
iguais aos de antes, e a etapa é marcada como estimada.

Resultado: passa. Os totais ficam em 140 enviados, 10 recebidos e 40 do cache.

### 4. Um resultado do SDK sem custo nenhum (critério 3)

Um resultado do SDK sem `total_cost_usd` foi exercitado para medir o limite do critério 3, que pede um
valor marcado como estimativa quando o provedor não informa o custo. Sem o campo, nenhum relatório de
uso é emitido e a etapa fica sem custo — a linha do tempo mostraria a frase de uso sem custo, não um
valor estimado.

Resultado: o comportamento pedido no critério 3 não acontece nesse caso. O caso pode ser inalcançável:
os tipos do próprio SDK declaram `total_cost_usd` como um `number` obrigatório, então o SDK não produz
um resultado sem ele. Fica registrado como observação não bloqueante, porque o comportamento medido na
issue não depende desse caso.

### 5. A frase ao lado do valor deixa de dizer que todo valor presente foi informado pelo provedor (critério 8)

A linha do tempo escolhe entre três frases: valor cobrado, valor estimado e uso sem custo. A frase
antiga, que afirmava ser informado pelo provedor, deixou de ser usada para todo valor presente.

Resultado: passa. As duas frases existem nos dois idiomas e o lint de i18n confirma as chaves.

### 6. O motor aberto não confunde custo com token estimado (critérios 5 e 6)

No motor aberto, o custo só existe quando o provedor o informa e continua marcado como cobrado; a
marca de token estimado, quando o servidor não informa uso, é um campo separado e não vira marca de
custo. A distinção entre as duas origens, porém, não tem texto próprio: a marca de tokens estimados é
descartada na soma e a distinção se apoia na ausência de texto para esse caso — o mesmo comportamento
de antes da mudança.

Resultado: o custo informado continua cobrado (passa). A distinção por texto do critério 6 não tem uma
frase própria; registrado como observação não bloqueante.

### 7. O arquivo da execução continua abrindo (compatibilidade)

Um registro gravado com o campo novo de procedência e um gravado sem ele foram lidos de volta. O
primeiro preserva a marca; o segundo, sem o campo, é lido como cobrado.

Resultado: passa. Nenhum campo novo é obrigatório e a versão do arquivo não mudou.

### 8. A documentação e a nota de lançamento (critério 9)

A descrição de provedores deixou de afirmar que o custo aparece sempre que o provedor o informa e passa
a dizer que, fora da API própria da Anthropic, o número do SDK aparece marcado como estimativa. A
descrição do runner e a nota de lançamento seguem a mesma ideia.

Resultado: passa por leitura do texto final; a auditoria pública não encontra nada sensível no que foi
escrito.

### 9. Nenhum teste alcança modelo, host ou rede (critério 10)

Os testes usam o SDK simulado e os motores falsos, e o provedor é apontado por configuração.

Resultado: passa. Nenhum serviço real foi alcançado durante a verificação.

## Gates do repositório

- Verificação de tipos: passa, sem erros.
- Auditoria de tema: passa, sem cor literal nova.
- Lint de i18n: passa, com a chave nova nos dois idiomas.
- Auditoria pública: passa.
- Conjunto de testes exercitado nesta etapa: 121 testes em 6 arquivos, todos verdes — os quatro
  arquivos tocados pela mudança, o de deriva do esquema de configuração e o teste de caixa preta novo.

A suíte inteira do repositório não foi rodada nesta etapa; a revisão anterior relatou nela 21 falhas
por estouro de tempo em testes que dependem de git, ambientais desta cópia e alheias à mudança, e o
conjunto de arquivos que tocam este comportamento passa isoladamente.

## O que não foi verificado

- O comportamento numa execução real contra um provedor que não seja a API própria da Anthropic:
  nenhum modelo de verdade, host reale rede foi alcançado.
- A origem do preço usado na estimativa continua não decidida; o número marcado como estimativa é o
  preço de lista da Anthropic para um modelo Claude, a mesma magnitude que a issue mediu como cerca de
  30 vezes o cobrado. A marca corrige a honestidade da exibição, não o valor.
- O critério 3, no caso de um resultado do SDK sem `total_cost_usd`, que pelos tipos do SDK não parece
  ser produzido.
- O texto do critério 6 para tokens estimados, que não existe.
- O painel de custo e a retenção das sessões das execuções, que ficaram fora do escopo.
