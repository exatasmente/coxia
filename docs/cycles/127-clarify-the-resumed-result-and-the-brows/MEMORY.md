# Memória do ciclo

## Decisões

- Triagem: bug de esclarecimento (linha do tempo de execução retomada; linha do tempo do navegador sem emenda de outra execução) mais arquivo de teste ruim. Squad: experiência. priority:low mantida.
- Plano: atribuição de documento a tentativa via `artifactAttempts` opcional no registro de etapa, distintivo na StageTimeline com `ui.cycle.stage.attemptOf`; backfill de reconexão do navegador estreitado (`backfillLive`, variante live-only no store de atividade, abertura de tela inalterada); trecho de documentação NÃO entra nesta issue (decidido pelo tech-lead).
- Implementação: o "arquivo que não compila" era o teste falhando de test/runner-chain.test.ts (corrida de polling, não regressão) — loop fixo de 80 esperas trocado por espera por estado com timeout. Desvio do plano declarado: StageRow em src/shared/runs/view.ts não mudou; `StageRow.record` já carrega o campo até a tela.
- Revisão: aprovado, sem bloqueantes; dois apontamentos de sugestão em test/stage-timeline.test.ts.
- QA: aprovado, doze cenários — finalizou na retomada 4 sem execução nova; todos os resultados e comprovações vêm de execuções anteriores desta mesma QA. Ao vivo: distintivo "tentativa 1/2" ("attempt 1/2") em cada documento da etapa e contagem no cabeçalho; a regra de não-desenhar quando a etapa tem 1 tentativa está no desenho e nos testes.
- Comunicação: nota de lançamento e comentário ao autor escritos; nenhum código mudado.
- Resposta: Prossiga deixe o @tech-lead decidir <!-- answer:9 -->

## Restrições

- priority:low; sem voz; mudanças confinadas à linha do tempo/distintivo do run screen e aos testes citados.

## Tentado e descartado

- As duas linhas de i18n que a suíte imprime ('1 untranslated strings', 'unknown scope "nowhere"'): stderr que os próprios testes de lint provocam; nada vaza.
- Rodar arquivos de teste isolados num harness próprio: falharam por diferença do harness; a suíte completa rodou verde pelo mesmo harness — evidência da suíte completa é a que vale.

## Perguntas abertas

- O relatório próprio para o trecho de documentação da revisão ainda precisa ser arquivado.
- Não reproduzido end-to-end: queda e volta do stream num navegador realmente pareado sobre uma execução a correr (critério de aceite 3) — coberto pelos testes unitários do store (backfillLive), não pelo caminho de eventos em realidade.
- NOTA DE AMBIENTE: duas falhas de test/voice-setup.test.ts ("disk-low") — checagem lê disco real menor que o necessário para modelos; não é código.

## Onde o trabalho está

- Portas nesta árvore: tsc --noEmit limpo, electron-vite build ok, vitest completo verde exceto as 2 de voice-setup, theme-audit, i18n:lint e public-audit passando.
- Aprovado pela revisão e pela QA (etapa 4 só entregou a resposta, sem execuções novas); nota de lançamento e comentário entregues pelo suporte. Próxima etapa: fechamento do ciclo. Corpus do commit: código, testes, CHANGELOG, documentos do ciclo.
- Passagem support → product-owner: Squad experiência (proposto): ajustar o que a linha do tempo da execução diz sobre o resultado retomado vs. a tentativa anterior, garantir que a linha do tempo do navegador pareado não mostre emenda de outra execução (catálogos t() atualizados) e consertar o arquivo de teste que não compila (encontrado pelo tsc). Em aberto para o tech-lead decidir: o trecho de documentação citado pela revisão entra nesta issue (com critério de aceite) ou em outra — o nome do arquivo de teste também deve ser conferido pelo comando de compilação. Prioridade sugerida: manter priority:low. <!-- handoff:13 -->
- Passagem product-owner → pessoa: Implementação e revisão: aplicar a spec. Antes de tudo rodar a conferência de compilação na árvore inteira, nomear o arquivo de teste que não compila e consertá-lo. Depois os dois acertos de comportamento: (1) fazer a linha do tempo da execução dizer de qual tentativa é o texto mostrado quando uma tentativa é retomada, com as duas chaves t() nos catálogos; (2) garantir que, quando a stream do navegador pareado cai e volta, o que é buscado de volta não emende linhas de uma execução anterior na linha do tempo da execução em curso (a junção hoje se dá pela chave execução:sequência; a busca de vol… <!-- handoff:21 -->
- Passagem tl-experiencia → pessoa: Implementação pelo squad experiência, na ordem do plano. (1) Passo 1: diagnosticar o teste falhando em test/runner-chain.test.ts, "is not answered by an agent once the person has answered it", alinhá-lo a aguardar a pergunta mantida por tech-lead deterministicamente (ou mover a correção para o código de cadeia se o estado não puder mais ocorrer); executá-lo duas vezes. (2) Passo 2: atribuição de documento por tentativa (artifactAttempts opcional em types/schema/transitions, distintivo na StageTimeline, ui.cycle.stage.attemptOf em ambos os catálogos). (3) Passo 3: estreitar apenas o backfill de… <!-- handoff:36 -->
- Passagem qa-experiencia → pessoa: Approved by QA. For closure: the delivered behaviour is verified (live badge, green gates, suite green except environment-only voice-setup disk failures). Still unverified and worth one line in the handoff: the real reconnect of a paired browser over a live run (acceptance criterion 3) — covered by store unit tests only. Out-of-issue pending, already decided elsewhere: the documentation snippet report. <!-- handoff:189 -->
- Passagem pessoa → qa-experiencia: Roda somente os 2 testes de GUI para eu validar a nova funcionalidade do app Coxia para stream das telas dos agentes Contexto para o pedido acima, não trabalho novo: o que a revisão e a QA deixaram em aberto. O que o QA não aprovou ou não conseguiu verificar: - Paired browser drops and returns its stream over a live run: no seam (não rodou): Not run: needs a run actually working against a code host with a paired browser attached, then a forced stream drop and return. Not available in this workspace; the refetch narrowing is covered by the store tests (see scenario 4), but the event path end to… <!-- handoff:202 -->
