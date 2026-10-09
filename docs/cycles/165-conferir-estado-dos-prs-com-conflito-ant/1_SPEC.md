# Conferência dos pedidos de mudança com conflito antes do corte da próxima versão

## O que muda para quem usa

Nada muda na tela ou no comportamento do produto. O pedido é de conferência do próprio fluxo de trabalho antes do próximo lançamento: dois pedidos de mudança que ficaram de lado por conflito são reavaliados, e a decisão sobre cada um (rebasear e juntar, ou por por entregue de outro jeito) fica registrada, em vez de silenciosa. Quem acompanha o ciclo vê, antes do corte, um veredito explícito por pedido em vez de um estado ambíguo deixado pela retrospectiva.

## Regras

1. Antes de cortar qualquer nova versão (abrir a próxima linha de release, nova beta ou estável), os dois pedidos de mudança em causa — os ligados às issues #142 e #121 — são conferidos um a um no host de código.
2. A conferência de cada pedido registra: se está aberto ou fechado, qual é a base dele (a linha principal ou uma ramificação de release), e se ainda conflita com a base de hoje.
3. Para cada pedido, uma das decisões abaixo é tomada e fica registrada no próprio pedido (comentário ou fechamento):
   - **Rebase e juntar:** o pedido ainda traz algo que a linha principal não tem; ele é rebaseado sobre a base atual, o CI fica verde e é juntado pelo fluxo normal.
   - **Por por entregue:** o conteúdo já entrou na linha principal por outro caminho; o pedido é fechado com um comentário apontando entrou por onde (o registro de mudanças mostra o assunto de ambos nos catálogos das versões 0.8.0 e 0.9.0-beta.2).
4. A conferência acontece antes de qualquer nova etiqueta de versão, não depois: se um dos pedidos ainda estiver aberto e conflitando no momento do corte, o corte só prossegue depois da decisãoficar registrada.
5. Nenhum conteúdo novo é escritono produto por esta ação: se uma conferência revelar que algum assunto das duas entregas falta na linha principal, isso vira um pedido novo, e não entra por aqui.

## O que fica fora

- Mudança de comportamento do app, de telas ou de testes.
- Conferência de outros pedidos de mudança além dos dois citados.
- Automatização do passo (torná-lo parte rotineira de um ciclo de release) — se fizer sentido, vira pedido próprio depois.
- Reproduzir o rebase nesta ação: o rebase, quando decidido, é a ação normal no pedido no host, com CI.

## Critérios de aceite

1. **Estado registrado:** abrir cada um dos dois pedidos no host e ler nele (ou no comentário deixado) o estado atual: aberto ou fechado, a base, e se ainda conflita. O que se vê: cada pedido ou está fechado com comentário, ou está pronto para rebase sem conflito registrado como pendente.
2. **Decisão por pedido:** cada um dos dois pedidos carrega exatamente uma das duas decisões das regras, com um comentatório de quem decidiu dizendo o porquê (rebase e juntar, ou por por entregue, com o caminho indicado).
3. **Cortecom confita:** se algum dos dois pedidos ainda estiver aberto e conflitando, o corte da próxima versão não acontece antes da decisãoficar registrada. O que se vê: na hora do corte seguinte, nenhum dos dois pedidos fica num estado pendente, sem decisão.
4. **Nada duplicado:** depois das decisões, a linha principalenv orçada não ganha o mesmo conteúdo duas vezes — ou o pedido foi juntado, ou foi fechado por por entregue, nunca ambos.

## Perguntas abertas

- O estado atual dos dois pedidos no host (aberto ou fechado, base, conflito atual): a conferência do critério 1 responde, e é justamente o que pede esta ação.
- Se um dos pedidos ainda estiver aberto e valendo algo: rebasear agora ou fechar por por entregue é decisão final do mantenedor, com os dados do critério 1 na mão.
