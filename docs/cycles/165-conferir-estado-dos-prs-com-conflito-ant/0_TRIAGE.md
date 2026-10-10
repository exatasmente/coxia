# Conferir os pedidos de mudança com conflito antes do próximo corte

## Tipo

**Pedido de funcionalidade / tarefa de processo**, na dimensão "integração pós-release". Não é bug: não descreve um comportamento errado de código, e sim uma ação de conferência — antes de o próximo release abrir ou avançar, checar como estão os pedidos de mudança das issues #142 e #121 (que, segundo a issue, conflitaram um com a release/0.8.0 e o outro com a main, foram deixados de lado e depois refletidos por novas ações) e decidir se o merge de cada um espera um rebase.

## Dá para entender? Como foi conferido

Dá para entender como está escrito: nomeia as duas issues, o tipo de conflito de cada uma e o momento da ação (antes do corte seguinte). Conferido **por leitura apenas** — esta etapa não rodou nada. O que a leitura achou:

- A memória do ciclo da #142 (`docs/cycles/142-make-a-qa-stage-back-what-it-says-it-ran/MEMORY.md`) mostra a entrega aprovada em revisão (tentativa 3), com as portas rodadas na cópia verde; a memória do ciclo da #121 (`docs/cycles/121-let-agents-keep-evidence-of-their-work-a/MEMORY.md`) mostra QA feito após nova rodada de revisão. Nenhuma das duas memórias registra o conflito citado — isso está só na issue.
- O `CHANGELOG.md` mostra que os assuntos das duas entregas já chegaram à linha principal: a #121 no `## [0.8.0]` e a #142 no `## [0.9.0-beta.2]` (a etapa de host citando `
#121`). A última linha publicada no catálogo é 0.9.0-beta.2 (2026-10-08), e não existe seção 0.9.0 estável — o "próximo release" na prática seria fechar a linha 0.9.0.
- Isso convém com o que a issue diz ("ambos skipados e refletidos depois por novas ações"): o conteúdo das duas entregas parece já estar na main por outro caminho. Não verificado: o estado dos PRs no host hoje (abertos/fechados, se ainda conflitam, com qual base).

**Não verificado nesta etapa:** o estado atual dos dois PRs no host. Conflito e estado de PR só se confirmam lendo o host (o app tem a integração para isso; os agentes do ciclo dos releases listam os PRs abertos da versão) ou dando rebase num clone com as referências do dia; leitura de arquivos e memória aqui não substitui isso.

## O que falta

Nada que impeça o andamento: o objeto da ação (os dois PRs) e o momento (antes do próximo corte) estão na issue. A decisão de aceitação — rebasear cada PR ou fechar o pedido de mudança e considerá-lo entregue pelo caminho que já levou o conteúdo à main — é do refino do produto e do mantenedor, e depende dos dados do host que esta etapa não viu.

## Issues relacionadas

- **#142** — uma das duas entregas conferidas; assunto já presente no catálogo de mudanças da 0.9.0-beta.2.
- **#121** — a outra; assunto presente no catálogo da 0.8.0.
- Nenhuma duplicata encontrada nas pastas de ciclo existentes.

## Sugestões (não decisão)

- Prioridade sugerida: `priority:medium` — é uma conferência de higiene antes do próximo corte, semничo apontado para além dos dois PRs conhecidos. A prioridade final é do refinamento do produto.
- A conferência em si cabe melhor numa ação do ciclo de release (o ciclo de release já lista os PRs da versão) ou como tarefa pontual do mantenedor, do que como um ciclo de funcionalidade tradicional.
