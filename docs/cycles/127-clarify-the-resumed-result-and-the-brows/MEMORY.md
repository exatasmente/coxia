# Memória do ciclo

## Decisões

- Resposta: Prossiga deixe o @tech-lead decidir <!-- answer:9 -->
- Triagem: bug de esclarecimento (linha do tempo de execução retomada; linha do tempo do navegador sem emenda de outra execução) mais arquivo de teste ruim. Squad: experiência. priority:low mantida.
- Plano (2_PLAN.md): atribução de documento a tentativa via `artifactAttempts` opcional no registro de etapa, distintivo na StageTimeline com `ui.cycle.stage.attemptOf`; backfill de reconexão do navegador estreitado (variante live-only no store de atividade, abertura de tela inalterada); trecho de documentação NÃO entra nesta issue (relatório próprio, ainda pendente).
- Implementação: o "arquivo que não compila" era o teste falhando de test/runner-chain.test.ts (corrida de polling, não regressão) — loop fixo de 80 esperas trocado por espera por estado com timeout. Desvio do plano declarado: StageRow em src/shared/runs/view.ts não precisou mudar; `StageRow.record` já carrega o campo até a tela.

## Restrições

- priority:low; sem voz; mudanças confinadas à linha do tempo/distintivo do run screen e aos testes citados.

## Tentado e descartado

- As duas linhas de i18n que a suíte imprime ('1 untranslated strings', 'unknown scope "nowhere"'): rastreadas — são o stderr que os próprios testes de lint provocam (temp file em test/ui-i18n.test.ts e escopo inválido em test/i18n.test.ts); nada vazando, nenhuma mudança de código para elas.
- Um teste do store em que `runActive` recebia array readonly: cast para ActivityEntry[] feito (joinagem muta).

## Perguntas abertas

- O relatório próprio para o trecho de documentação da revisão ainda precisa ser arquivado (decisão de não fazê-lo nesta issue está feita).
- Interface não exercitada ao vivo (sem dev server/navegador pareado nesta etapa): a emenda real de reconexão e o distintivo na tela correram só por testes unitários.

## Onde o trabalho está

- Implementação concluída: código, testes e docs/cycles/[redacted]/3_IMPLEMENTATION.md escritos; CHANGELOG atualizado sob ## [Unreleased]. Todos os cinco gates verdes nesta árvore (tsc, vitest completo 4847 testes, theme-audit, i18n:lint, public-audit). Próxima etapa: revisão/QA do ciclo; pendência fora desta issue: relatório do trecho de documentação.
- Passagem tl-experiencia → pessoa: Implementação pelo squad experiência, na ordem do plano. (1) Passo 1: diagnosticar o teste falhando em test/runner-chain.test.ts, "is not answered by an agent once the person has answered it", alinhá-lo a aguardar a pergunta mantida por tech-lead deterministicamente (ou mover a correção para o código de cadeia se o estado não puder mais ocorrer); executá-lo duas vezes. (2) Passo 2: atribuição de documento por tentativa (artifactAttempts opcional em types/schema/transitions, distintivo na StageTimeline, ui.cycle.stage.attemptOf em ambos os catálogos). (3) Passo 3: estreitar apenas o backfill de reconexão no store de atividade do renderizador (variante live-only), testes de store cobrindo ambos os caminhos. Depois CHANGELOG sob ## [Unreleased] e todas as cinco portas. Dois avisos além do plano: a suíte imprime duas linhas de i18n ("1 untranslated strings", "unknown scope \"nowhere\"") que a lint do renderizador não faz — checar o que as emite durante a implementação; e a decisão do tech-lead sobre o trecho de documentação: ele não entra nesta issue, é um relatório próprio. <!-- handoff:36 -->
- Passagem support → product-owner: Squad experiência (proposto): ajustar o que a linha do tempo da execução diz sobre o resultado retomado vs. a tentativa anterior, garantir que a linha do tempo do navegador pareado não mostre emenda de outra execução (catálogos t() atualizados) e consertar o arquivo de teste que não compila (encontrado pelo tsc). Em aberto para o tech-lead decidir: o trecho de documentação citado pela revisão entra nesta issue (com critério de aceite) ou em outra — o nome do arquivo de teste também deve ser conferido pelo comando de compilação. Prioridade sugerida: manter priority:low. <!-- handoff:13 -->
- Passagem product-owner → pessoa: Implementação e revisão: aplicar a spec. Antes de tudo rodar a conferência de compilação na árvore inteira, nomear o arquivo de teste que não compila e consertá-lo. Depois os dois acertos de comportamento: (1) fazer a linha do tempo da execução dizer de qual tentativa é o texto mostrado quando uma tentativa é retomada, com as duas chaves t() nos catálogos; (2) garantir que, quando a stream do navegador pareado cai e volta, o que é buscado de volta não emende linhas de uma execução anterior na linha do tempo da execução em curso (a junção hoje se dá pela chave execução:sequência; a busca de vol… <!-- handoff:21 -->
