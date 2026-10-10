# Conferência dos dois pedidos no host, feita e registrada

## O que esta etapa fez

Leu no host de código, no dia da conferência (2026-10-09), o estado atual dos dois pedidos de mudança citados pela conferência — o ligado à issue da etapa de QA e o ligado à issue das comprovações — e cruzou cada estado com o registro de mudanças. Os resultados, um por pedido:

## Pedido ligado à #142 (pull request #146)

- **Estado lido:** juntado no host em 08/10/2026 (aberto em 07/10/2026); ramificação de origem `cycle/142-make-a-qa-stage-back-what-it-says-it-ran`, ramificação alvo `release/0.8.0`; verificação contínua verde no commit juntado.
- **Cruzamento com o registro de mudanças:** a entrada `## [0.8.0]` - 2026-10-08 traz "A QA stage has to back what it says it ran, and the screenshots it looked at are not lost" — o assunto deste pedido — e `## [0.9.0-beta.2]` traz desdobramento posterior da mesma features.
- **Decisão registrada:** nada pendente. O pedido já foi juntado; não cabe rebase-e-merge (nada está aberto) nem fechar-por-entregue (não está aberto a fechar). O marcador de conflito que o host ainda mostra vale contra a base de hoje, e não anda nada: a ramificação de origem não tem mais o que entrar.

## Pedido ligado à #121 (pull request #131)

- **Estado lido:** juntado no host em 07/10/2026 (aberto em 07/10/2026); ramificação de origem `cycle/121-let-agents-keep-evidence-of-their-work-a`, ramificação alvo `release/0.8.0`; verificação contínua verde no commit juntado.
- **Cruzamento com o registro de mudanças:** a entrada `## [0.8.0]` - 2026-10-08 traz "An agent keeps evidence of what it saw, and can mark up an image" — o assunto deste pedido — e `## [0.9.0-beta.1]`/`[0.9.0-beta.2]` trazem desdobramentos (comprovação de estágio no computador, correção da sobreescrita de comprovações).
- **Decisão registrada:** nada pendente, mesmo raciocínio do pedido anterior — já juntado, sem rebase nem fechamento a fazer.

## O corte da próxima versão

Nenhum dos dois pedidos fica aberto e conflitando na hora de o próximo corte avançar: os dois terminaram juntados, com verificação verde, e seus assuntos estão nos catálogos já publicados (0.8.0 e havendo desdobramentos na 0.9.0-beta.2). **O corte da próxima versão não está bloqueado por estes dois pedidos** — a pré-condição da especificação (decisão registrada por pedido antes de qualquer nova etiqueta) está satisfeita pelo estado real do host, e não por eleição desta etapa: a decisão existente em cada pedido (juntado) é do mantenedor, feita no fluxo normal do host.

## O que não foi mexido

- Nenhum arquivo de código, teste ou tela mudou — a especificação é de conferência de fluxo, sem mudança de produto.
- Nenhum comentário novo foi escrito no host: nenhum pedido precisou de fechamento ou recado, porque ambos já carregam estado final juntado.
- Nenhum conteúdo faltante foi descoberto: o cruzamento com o registro de mudanças encontrou os assuntos de ambos nos catálogos correspondentes.

## O que fica não verificado

- Que o conteúdo juntado em cada pedido está exatamente na linha principal hoje, commit a commit: conferido pelo registro de mudanças e pelo estado de juntado no host, não por comparação de árvore.

## Comprovante

A leitura do host e o cruzamento com o registro de mudanças estão guardados como comprovação desta etapa (ev-1).
