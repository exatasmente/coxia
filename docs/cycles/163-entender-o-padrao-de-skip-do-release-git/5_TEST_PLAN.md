# Plano de testes da entrega do exame de skips

Este plano traduz os critérios de aceite da especificação em cenários numerados, com o
que fazer, o que esperar e como cada um foi comprovado. A entrega não muda código,
texto de interface nem dados: ela é o exame dos saltos das liberações citadas, dado
como documento. Não há portanto cenário de interface; o que se pôde rodar nesta árvore
(portões do repositório e uma checagem mecânica das contagens do relatório) foi rodado,
e o que depende dos registros brutos ficou explicado como não executável daqui.

## Cenários

### 01 — A contagem do relatório bate com a soma das suas próprias seções
**Faz:** recomputar, a partir do texto do relatório do exame, a soma das subseções da
liberação da issue 75 (recusa do script 7, descartes de refazer 12, descartes de
cancelamento 6), os totais das outras duas liberações (4 e 8) e o total geral.
**Espera:** cada soma deve bater com o total anunciado: 25, 4, 8 e 37 (critério 3,
parte interna, sem os registros brutos).
**Resultado:** pass, executado. Um script de conferência rodou sobre o texto do
relatório e confirmou 25 = 7 + 12 + 6, 4, 8, total 37. Comprovação: ev-3.
Observação registrada: a nota entre parênteses do relatório que tenta explicar o 25
("7 + 12 − 1 duplicada + 6 = 24...") não reproduz a própria conta — o achado de
sugestão da revisão persiste no texto (não bloqueia; o total vem das somas das seções).

### 02 — Cada salto listado individualmente, com um tipo e uma fonte ao lado
**Faz:** ler o relatório do exame contra os critérios 1, 2, 4, 5, 6 e 7 da spec:
liberação da 75 com as três subseções cobrindo todos os grupos e nada amostrado,
liberações 151 e 115 com as 4 e as 8 linhas, cada linha com etapa, motivo registrado
(ou nota de falta de motivo), quem pulou (inferência marcada onde o catálogo de ações
não grava autor), exatamente um tipo (decisão em portão, decisão em espera, pendente
por refazer, outro, sem rastro), fonte (Ações, fórum ou ambos), padrões repetidos
nomeados e conclusão curta encaminhando mudanças a pedidos próprios.
**Espera:** todos os critérios citados visíveis no texto.
**Resultado:** pass, somente leitura. Todos os itens citados estão no relatório,
confirmado pela revisão e reconferido por leitura. Comprovação: ev-6.
Dois achados de texto legados da revisão, ambos sugestão e não bloqueio: a nota
aritmética do cenário 01 e as recusas repetidas da 75 citadas como "a mesma recusa"
em vez do texto literal registrado (regra 6 da spec).

### 03 — Contagens conferidas contra os registros brutos das liberações
**Faz:** reler os arquivos de run e o catálogo de Ações das três execuções e bater o
número de cada linha do relatório contra o registro de origem, inclusive os motivos
citados.
**Espera:** zero divergência; qualquer divergência vira achado.
**Resultado:** not-run. Os registros brutos ficam na área de dados do espaço de
trabalho, fora desta árvore de trabalho, e esta etapa não os alcança; o exame é quem
os leu e a revisão os aceitou como lidos. Não verificado aqui.

### 04 — O registro do exame está entregue antes do corte da próxima beta
**Faz:** confirmar que o documento do exame existe na pasta do ciclo e que a entrega
precede qualquer corte de beta.
**Espera:** documento presente na pasta do ciclo (critério 8).
**Resultado:** pass, somente leitura. O documento está na pasta do ciclo e o histórico
dos commits da árvore mostra a entrega já registrada. Comprovação: ev-6.

### 05 — A árvore passa no portão público e está limpa de entregas a mais
**Faz:** conferir que a árvore de trabalho está limpa, que os commits são só de
documentos do ciclo e que o portão público (nenhum nome de empresa, pessoa, host,
issue real ou segredo) passa.
**Espera:** árvore limpa, histórico só de documentos, portão passando.
**Resultado:** pass, executado. Status da árvore limpo; histórico com commits apenas
de documentos do ciclo; portão público: 1279 arquivos, nada que pertença a empresa ou
pessoa. Comprovação: ev-4 e ev-7.

### 06 — O type-check do repositório continua passando
**Faz:** rodar a checagem de tipos (tsc --noEmit).
**Espera:** saída 0, nenhum erro.
**Resultado:** pass, executado. Saída 0. Comprovação: ev-4.

### 07 — A suíte de testes do repositório passa
**Faz:** rodar a suíte completa (vitest run).
**Espera:** nenhum teste falhando.
**Resultado:** not-run. O ambiente desta etapa monta as dependências em leitura e a
suíte precisa escrever um arquivo temporário dentro delas para carregar a própria
configuração; toda tentativa (config renomeada, config apontada para fora, config
inline via API) fracassou ou distorceu o preparo global dos testes (o preparo
(test/setup.ts) não rodou de verdade no contorno), então o resultado obtido não serve
como veredito — registrou-se o log da tentativa, não um pass nem um fail do produto.
Comprovação da tentativa: ev-5. A entrega não muda código, então este cenário não
bloqueia.

### 08 — Cenário de interface
Não aplicável: a entrega não altera nenhum comportamento de interface. Nada a executar.

## Não executado e por quê (resumo)

- Bater as contagens e os motivos contra os registros brutos das liberações: os
  arquivos de run e o catálogo de Ações estão fora desta árvore (cenário 03).
- Suíte de testes completa: bloqueio do ambiente de execução (cenário 07); os portões
  que rodaram (cenários 05 e 06) cobrem a parte aplicável desta entrega, que não
  muda código.
- Interface: sem mudança de comportamento a verificar (cenário 08).

## Resultado dos cenários

- 01 Counts of the report match their own section sums: passou (executado na sandbox) — Script recomputed the 3_IMPLEMENTATION.md subtotals: 75 = 7+12+6 = 25, 151 = 4, 115 = 8, grand total 37; all match the stated totals. The report's explanatory note for 25 (7 + 12 − 1 + 6 = 24 ...) does not reproduce its own arithmetic (review finding persists, non-blocking; the total stands from the section sums).
- 02 Each skip listed with one type, source, patterns named, conclusion present: passou (lido) — Read check of 3_IMPLEMENTATION.md against spec criteria 1, 2, 4, 5, 6, 7: nothing sampled away, one type per row, sources carried, patterns named, conclusion routed to future requests. Known non-blocking text findings from the review persist (arithmetic note; refusals summarized instead of quoted).
- 03 Counts cross-checked against the raw records of each release: não rodou (lido) — The run files and the actions catalog live in the workspace data area, outside this worktree; this stage cannot read them. The exam stage is the one that read them; counts against raw records are not verified here.
- 04 Exam report delivered before the next beta cut: passou (lido) — The exam document exists in the cycle folder and the tree's commit history shows the delivery already recorded; criterion 8 holds as delivered.
- 05 Public audit and read-only delivery (clean tree, docs-only commits): passou (executado na sandbox) — git status clean, history carries only cycle documents (triage, refine, plan, implementation, review), and the public audit passed: 1279 files, nothing that belongs to a company or a person. A mistaken markdown draft was written during authoring and removed; the tree returned clean.
- 06 Type-check gate on the tree: passou (executado na sandbox) — npx tsc --noEmit exited 0.
- 07 Full test suite: não rodou (executado na sandbox) — Not executable in this sandbox: dependencies are mounted read-only and the test loader writes a temporary config file inside them (node_modules/.vite-temp); every workaround (renamed, relocated or inline config via the API) either failed or distorted the global test setup (test/setup.ts), so the run log is inconclusive rather than a pass or fail. The delivery changes no code, so this does not block. Attempt log kept as evidence.
- 08 Interface scenario: não rodou (lido) — Not applicable: the delivery is documentation only; no behavior of the interface changes.
