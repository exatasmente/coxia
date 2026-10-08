# Memória do ciclo

## Decisões

- Resposta: Prossiga deixe o @tech-lead decidir <!-- answer:9 -->
- Triagem: bug de esclarecimento (linha do tempo de execução retomada; linha do tempo do navegador sem emenda de outra execução) mais arquivo de teste ruim. Squad: experiência. priority:low mantida.
- Plano (2_PLAN.md): atribuição de documento a tentativa via `artifactAttempts` opcional no registro de etapa, distintivo na StageTimeline com `ui.cycle.stage.attemptOf`; backfill de reconexão do navegador estreitado (`backfillLive`, variante live-only no store de atividade, abertura de tela inalterada); trecho de documentação NÃO entra nesta issue.
- Implementação: o "arquivo que não compila" era o teste falhando de test/runner-chain.test.ts (corrida de polling, não regressão) — loop fixo de 80 esperas trocado por espera por estado com timeout. Desvio do plano declarado: StageRow em src/shared/runs/view.ts não mudou; `StageRow.record` já carrega o campo até a tela.
- Revisão (4_REVIEW.md): verdicto aprovado, sem bloqueantes; dois apontamentos de sugestão em test/stage-timeline.test.ts.
- QA (5_TEST_PLAN.md): aprovado, doze cenários. Ao vivo, no app compilado com pasta de dados descartável e execução semeada de dois estágios (Triage com 2 tentativas e nomes repetidos/follow-up): distintivo "tentativa 1/2" em cada documento da etapa e contagem no cabeçalho; em inglês "attempt 1/2". Vista no vivo, a regra de não-desenhar quando a etapa tem 1 tentativa está no desenho e nos testes (revisada estaticamente, sem sessão própria no vivo). NOTA DE AMBIENTE: duas falhas de test/voice-setup.test.ts ("disk-low") — a checagem lê disco real menor que o necessário para modelos; não é código. Trabalho da sandbox: node_modules é symlink de leitura, o vite recusa escrever seu pacote de config ali; vitest rodou com config inline guardada na pasta de saída.

## Restrições

- priority:low; sem voz; mudanças confinadas à linha do tempo/distintivo do run screen e aos testes citados.

## Tentado e descartado

- As duas linhas de i18n que a suíte imprime ('1 untranslated strings', 'unknown scope "nowhere"'): stderr que os próprios testes de lint provocam (test/ui-i18n.test.ts temp file; test/i18n.test.ts escopo inválido); nada vaza.
- Rodar arquivos de teste isolados num harness próprio (config inline): arquivos isolados falharam por diferença do harness, mas a suíte completa rodou verde pelo mesmo harness — evidência da suíte completa é a que vale.

## Perguntas abertas

- O relatório próprio para o trecho de documentação da revisão ainda precisa ser arquivado.
- Não reproduzido end-to-end: queda e volta do stream num navegador realmente pareado sobre uma execução a correr (critério de aceite 3) — coberto pelos testes unitários do store (backfillLive), não pelo caminho de eventos em realidade.

## Onde o trabalho está

- Portas verificadas pela QA nesta árvore: tsc --noEmit limpo, electron-vite build ok, vitest completo 4821/4824 (só as 2 de voice-setup, ambiente), theme-audit, i18n:lint e public-audit passando.
- Aprovado pela revisão e pela QA; próxima etapa: fechamento do ciclo. Corpus do commit: código, testes, CHANGELOG, documentos do ciclo escritos.
<!-- remember: distinto de distinctive -->
- Passagem support → product-owner: Squad experiência (proposto): ajustar o que a linha do tempo da execução diz sobre o resultado retomado vs. a tentativa anterior, garantir que a linha do tempo do navegador pareado não mostre emenda de outra execução (catálogos t() atualizados) e consertar o arquivo de teste que não compila (encontrado pelo tsc). Em aberto para o tech-lead decidir: o trecho de documentação citado pela revisão entra nesta issue (com critério de aceite) ou em outra — o nome do arquivo de teste também deve ser conferido pelo comando de compilação. Prioridade sugerida: manter priority:low. <!-- handoff:13 -->
- Passagem product-owner → pessoa: Implementação e revisão: aplicar a spec. Antes de tudo rodar a conferência de compilação na árvore inteira, nomear o arquivo de teste que não compila e consertá-lo. Depois os dois acertos de comportamento: (1) fazer a linha do tempo da execução dizer de qual tentativa é o texto mostrado quando uma tentativa é retomada, com as duas chaves t() nos catálogos; (2) garantir que, quando a stream do navegador pareado cai e volta, o que é buscado de volta não emende linhas de uma execução anterior na linha do tempo da execução em curso (a junção hoje se dá pela chave execução:sequência; a busca de vol… <!-- handoff:21 -->
- Passagem tl-experiencia → pessoa: Implementação pelo squad experiência, na ordem do plano. (1) Passo 1: diagnosticar o teste falhando em test/runner-chain.test.ts, "is not answered by an agent once the person has answered it", alinhá-lo a aguardar a pergunta mantida por tech-lead deterministicamente (ou mover a correção para o código de cadeia se o estado não puder mais ocorrer); executá-lo duas vezes. (2) Passo 2: atribuição de documento por tentativa (artifactAttempts opcional em types/schema/transitions, distintivo na StageTimeline, ui.cycle.stage.attemptOf em ambos os catálogos). (3) Passo 3: estreitar apenas o backfill de… <!-- handoff:36 -->
