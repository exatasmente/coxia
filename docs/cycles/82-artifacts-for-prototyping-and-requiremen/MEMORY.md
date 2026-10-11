# Memória do ciclo

## Decisões

- Implementação concluída e revisão aprovada.
- QA concluída com 20 cenários de teste.
- Próxima etapa: Comunicação (produzir nota de lançamento e comentário para o autor da issue).

## Restrições

- Nenhuma nova restrição adicionada nesta etapa.

## Tentado e descartado

- Nenhum.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Etapa de Comunicação concluída: nota de lançamento e comentário produzidos.
- Aguardando integração do pull request.
- Passagem support → product-owner: Seguir para o refino: fixar os nomes e os lugares dos documentos de requisitos, protótipo e manual, em qual etapa cada um entra e é lido, onde o manual aparece, se o plugin embutido vem ligado por padrão e se os documentos de plugin também movem a fase. A-base da plataforma foi conferida por leitura, não executada. <!-- handoff:34 -->
- Passagem product-owner → pessoa: Plano (tech-lead): escrever 2_PLAN.md a partir da 1_SPEC.md — entregar as regras sem trocar os leitores de hoje: como os três tipos novos entram na leitura da fase e na de cada portão (hoje o portão só os oferece no segundo e o primeiro falharia com pasta só de tipos novos), a produção nas etapas refine/plan/communicate do ciclo de agentes, o plugin embutido declarativo ligado por padrão com migração para espaços existentes, os rótulos e as fases nos dois catálogos (i18n), a distinção entre documentos do fluxo e documentos colaterais de plugin, e os testes de regressão (nada foi executado na b… <!-- handoff:47 -->
- Passagem tl-plataforma → pessoa: Implementar seguindo o 2_PLAN.md, na ordem dos 12 passos dele, sem reabrir escopo: (1) campo `flow` em `src/shared/plugins/declaration.ts` (gate 1|2, `phase.label` e `phase.before` com o nome de arquivo simples, recusa própria em `REASONS`); (2) junção pura em `src/shared/plugins/phase.ts` (`withPhaseDocuments`: insere antes da âncora, ignora âncora ausente, não muta a lista); (3) seis chaves novas nos catálogos `en.json` e `pt-BR.json` (`cycle.agentFlow.phase.requirements|prototype|userManual`, `cycle.agentFlow.gate.requirements|prototype|userManual`); (4) leitor da fase em `src/main/cards.ts… <!-- handoff:67 -->
- Passagem developer → revisor-plataforma: Revisar a mudança contra o 2_PLAN.md e o comportamento pedido: campo `flow` e validação em declaration.ts, junção pura em plugins/phase.ts, leitura da fase em cards.ts, portão e artefato do botão em gate.ts/Gate.tsx (startGate com file?), plugin embutido por capacidade em plugins/read.ts + module.ts, produção nos dois modelos em agentFlow.ts e migração v24→v25 sem mudança de formato. Os portões rodaram: tipos sem erros, os testes que a mudança toca verdes (o lote completo e o do núcleo), tema, i18n e área pública verdes. O que sobra é de QA: aceites 1-3 e 10 com modelos de verdade e um espaço … <!-- handoff:157 -->
- Passagem revisor-plataforma → developer: Revisão de 82 contra a spec, o plano e o diff (72 arquivos, 918+/220-): a declaração com `flow`, a junção pura da fase, o leitor da fase, o portão por artefato, o plugin embutido por capacidade, a produção nos dois modelos e a migração v24→v25 conferem com o pedido, e o critério 5 (pasta só com requisitos ainda abre o portão 1, onde hoje ele falharia) está atendido por teste de unidade mais a leitura do código. Nesta tentativa rodaram verdes, de fato: `npx tsc --noEmit`, a suíte completa (416 arquivos, 6948 testes verdes, 3 pulados), os 8 arquivos do núcleo da mudança (239 testes), config-sche… <!-- handoff:314 -->
- Passagem developer → revisor-plataforma: Revisar a correção do bloqueante contra o 3_IMPLEMENTATION.md e o código: `chain` em src/shared/plugins/declaration.ts, a recusa em readPlugins (src/main/plugins/read.ts), a guarda de escrita em src/main/plugins/runtime.ts, `PluginRecord.documents` em types.ts, a chave `main.plugins.refused.flowDocument` nos dois catálogos, e as sugestões 3, 4 e 5 atendidas (dado de prova neutro, linha nova no fim dos dois arquivos, ouro registrado como risco). Depois, a QA: aceites 1-3 com modelos de verdade, 7 (tela sem reiniciar), 9 (quarto tipo numa tela), 10 (espaço real antigo), o clique dos botões do po… <!-- handoff:342 -->
- Passagem revisor-plataforma → qa-plataforma-2: Revisão da 82 (rodada 2) aprovada: a correção do bloqueante está no código e coberta por teste, as sugestões da rodada anterior foram atendidas e os portões fecharam verdes. Seguir para a QA: aceites 1-3 com modelos de verdade, 7 (desligar e religar na tela sem reiniciar), 9 (um quarto tipo numa tela), 10 (espaço real antigo), o clique dos botões do portão e a recusa de um plugin do workspace vista na lista de plugins. Risco aceito que segue: o artefato do portão a partir do metadado de uma proposta. <!-- handoff:369 -->
- Passagem qa-plataforma-2 → pessoa: QA da 82 entregue: `5_TEST_PLAN.md` na pasta do ciclo, 20 cenários, o código do produto intocado. Verde por comando nesta etapa: suíte completa (417 arquivos, 6955 testes; 3 vermelhos de ambiente em dois arquivos), lote dos arquivos da mudança (9 arquivos, 253 testes), `tsc`, `theme-audit`, `i18n:lint` (5483 chaves), `public-audit` (1592 arquivos), `electron-vite build`, e 19 vetores de caixa-preta. Os três vermelhos da suíte são de ambiente (sandbox /tmp e /dev/shm pequeno): `harness-finalize` conta caminhos reescritos e o tmpfs transforma o caminho em `~` antes da conta; `voice-setup` falha … <!-- handoff:472 -->
