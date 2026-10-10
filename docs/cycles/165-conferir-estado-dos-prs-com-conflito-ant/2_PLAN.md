# Plano para conferir os dois pedidos de mudança antes do corte

## O que o plano entrega

Nenhuma mudança de código ou de telas. O plano organiza a conferência no host de código exigida pela especificação: para cada um dos dois pedidos de mudança (os ligados às issues #142 e #121), ler o estado no host, registrar o estado no próprio pedido e deixar registrada uma das duas decisões — rebase e juntar, ou fechar por já entregue por outro caminho — antes de qualquer próxima etiqueta de versão.

## Ordem da conferência

1. **Ler o estado de cada pedido no host** (uma leitura por pedido, sem escrita ainda): aberto ou fechado, base atual, e se ainda conflita com a base. Este passo usa a leitura do host que a etapa de implementação/verificação tem; o estado não foi conferido em etapa anterior (não verificado até aqui).
2. **Cruzar com o registro de mudanças em mãos**: as informações do passo 1 contra as entradas dos catálogos `## [0.8.0]` (assunto da #121) e `## [0.9.0-beta.2]` (assunto da #142), já confirmadas por leitura do registro de mudanças no trabalho de triagem.
3. **Tomar e registrar a decisão por pedido**, no próprio pedido no host:
   - Se ainda traz algo que a linha principal não tem → recomendar **rebase e juntar** ao mantenedor (o rebase em si é ação normal no host, com verificação contínua; não é reproduzida aqui).
   - Se o conteúdo já veio por outro caminho → **fechar por entregue**, com comentário apontando a entrada do catálogo que já carrega o assunto.
   - A decisão final de aceitação é do mantenedor, com os dados da conferência em mão; o papel desta ação é deixar o estado e a recomendação registrados e claros.
4. **Fechar o registro no ciclo**: uma nota na pasta do ciclo com o estado lido e a decisão de cada pedido, para o histórico do repositório.
5. **Só depois das decisões registradas** o corte da próxima versão pode avançar. Se algum pedido ficar aberto e conflitando, a etapa declara o bloqueio do corte em vez de seguir.

## Comportamentos e como se confere cada um

| Comportamento (do critério de aceite da spec) | Como o plano garante | Onde se vê |
|---|---|---|
| Estado registrado por pedido | Passo 1 lê o estado; ele é escrito na nota do ciclo e, quando fechado por entregue, no comentário do pedido | Nota do ciclo; host |
| Uma decisão por pedido, com o porquê | Passo 3 registra exatamente uma decisão por pedido, com comentário do mantenedor | Host; nota do ciclo |
| Corte só depois das decisões | Passo 5 torna a decisão pré-condição do corte; bloqueio explícito se algo ficar pendente | Nota do ciclo |
| Nada duplicado | As decisões "rebase e juntar" e "fechar por entregue" são mutuamente exclusivas por pedido; o passo 2 impede fechar por entregue quando o conteúdo não está na main | Nota do ciclo |

## Riscos e como se evitam

- **O estado mudou desde a issue (conflito citado de 08/10/2026):** a leitura é feita no dia da conferência, não no registro antigo; nada se assume do passado.
- **Fechar por entregue com conteúdo incompleto na main:** o passo 2 exige apontar a entrada do catálogo correspondente; sem ela, a decisão não se fecha e o caso vai para o mantenedor, podendo virar pedido novo (a spec manda: conteúdo faltante não entra por aqui).
- **Decisão registrada sem dono:** a recomendação da etapa e a decisão final do mantenedor ficam distintas no registro, para não se atribuir ao agente o que decide a pessoa.
- **Escapar para outros pedidos de mudança:** o escopo tem só os dois nomeados; qualquer terceiro caso vira pedido próprio.

## Decisões e o porquê

- **Ação no host, não código:** a especificação define conferência de fluxo; mudança de produto está fora do escopo declarado. Por isso o plano não tem arquivo de código nem teste automatizado — as verificações são os critérios de aceite, conferidos contra o estado real do host.
- **Registrar no ciclo além do host:** o host guarda a decisão por pedido; a nota do ciclo guarda a trilha da conferência para a retro e para a próxima conferência de corte.
- **Bloqueio explícito do corte:** a regra 4 da spec só vale se houver alguém declarando o bloqueio na hora; o passo 5 transforma o critério 3 em comportamento concreto.

## O que um critério de aceite não cobre e o plano diz

- O critério 1 depende de o pedido aceitar comentário legível no host; se um pedido não aceitar comentário (por estar em estado especial), a nota do ciclo registra o estado e o impasse vai ao mantenedor como pergunta da etapa.
- O conteúdo da conferência depende de acesso de rede ao host; sem ele, nada nesta etapa é afirmado como conferido, apenas planejado.

## Não verificado neste plano

Estado atual dos dois pedidos no host, base de cada um e conflito atual: **não verificado** nesta etapa de plano; é o primeiro passo da implementação/verificação.
