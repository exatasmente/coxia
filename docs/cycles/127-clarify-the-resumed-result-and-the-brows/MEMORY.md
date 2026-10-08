# Memória do ciclo

## Decisões

- Resposta: Prossiga deixe o @tech-lead decidir <!-- answer:9 -->
- Triagem: bug de esclarecimento (linha do tempo de execução retomada: dizer a tentativa anterior vs. resultado retomado; linha do tempo do navegador parado: sem emenda de outra execução) mais um arquivo de teste que não compila. Squad proposto: experiência. Prioridade mantida priority:low.
- Tech-lead (etapa Plano): o trecho de documentação deixado pela revisão NÃO entra nesta issue (sem nome, sem aceitação); é arquivado como relatório próprio.
- Plano escrito em 2_PLAN.md: atribuir cada documento de etapa a uma tentativa via um campo opcional `artifactAttempts` no registro de etapa (types/schema/transitions; sem migração, arquivos antigos válidos), marcado na StageTimeline com `ui.cycle.stage.attemptOf` em ambos os catálogos; estreitar apenas o backfill de reconexão do navegador (variante live-only no store de atividade, caminho screen-open inalterado por regra 4); pergunta-respondida retoma a mesma tentativa, então sem novo número lá.

## Restrições

- Prioridade priority:low mantenida; sem voz nem mudanças fora da linha do tempo/distintivo de execução e o teste de cadeia.

## Tentado e descartado

- O gate de compilação em toda a árvore passa: nada concede na árvore hoje; o item "arquivo de teste que não compila" é, encontrado, o teste que falha em `test/runner-chain.test.ts` ("is not answered by an agent once the person has answered it"; espera a pergunta mantida por tech-lead, obtém uma execução em andamento sem pergunta) — um teste que falha, não um erro de compilação.
- i18n, tema e gate de auditoria Pública passam hoje.

## Perguntas abertas

- O lado da equivalência (equivalent side) na implementação: o teste de cadeia falhando é uma corrida de polling ou uma regressão (o plano exige um diagnóstico antes de alinhar).
- A suíte imprime duas linhas de i18n ("1 untranslated strings", "unknown scope \"nowhere\"") que a lint do renderizador não faz: inexplicado, a implementação deve checar o que as emite.
- O relatório próprio para o trecho de documentação ainda precisa ser arquivado (sem nome; a decisão de não fazê-lo nesta issue está feita).

## Onde o trabalho está

- Triagem, refinamento e plano concluídos (0_TRIAGE.md, 1_SPEC.md, 2_PLAN.md). Próxima etapa: implementação pelo squad experiência, seguindo a ordem do plano: o teste de cadeia primeiro, depois a atribuição de tentativa, depois o backfill estreito, depois CHANGELOG e os cinco gates.
- Passagem support → product-owner: Squad experiência (proposto): ajustar o que a linha do tempo da execução diz sobre o resultado retomado vs. a tentativa anterior, garantir que a linha do tempo do navegador pareado não mostre emenda de outra execução (catálogos t() atualizados) e consertar o arquivo de teste que não compila (encontrado pelo tsc). Em aberto para o tech-lead decidir: o trecho de documentação citado pela revisão entra nesta issue (com critério de aceite) ou em outra — o nome do arquivo de teste também deve ser conferido pelo comando de compilação. Prioridade sugerida: manter priority:low. <!-- handoff:13 -->
- Passagem product-owner → pessoa: Implementação e revisão: aplicar a spec. Antes de tudo rodar a conferência de compilação na árvore inteira, nomear o arquivo de teste que não compila e consertá-lo. Depois os dois acertos de comportamento: (1) fazer a linha do tempo da execução dizer de qual tentativa é o texto mostrado quando uma tentativa é retomada, com as duas chaves t() nos catálogos; (2) garantir que, quando a stream do navegador pareado cai e volta, o que é buscado de volta não emende linhas de uma execução anterior na linha do tempo da execução em curso (a junção hoje se dá pela chave execução:sequência; a busca de vol… <!-- handoff:21 -->
