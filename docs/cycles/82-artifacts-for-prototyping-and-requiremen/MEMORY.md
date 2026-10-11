# Memória do ciclo

## Decisões

- Refino de 82 (tentativa 1): `1_SPEC.md` entregue; os cinco pontos da triagem fixados nas Regras 1 a 6.
- Plano de 82 (tentativa 1): `2_PLAN.md` entregue; o mecanismo que a spec deixou ao plano é decisão fechada.
- Campo `flow` na declaração de documento (`{ gate?: 1|2; phase?: { label?, before } }`); sem `flow` o tipo é colateral (portão 2, fora da fase).
- Plugin embutido = declaração sem código e sem alcance lida da pasta `plugins` do aplicativo (`PLUGINS_BUILT_IN_DIR`, sobe no pacote), ligada por padrão sem migração de config; cópia na pasta do workspace vence; busca web segue manual e desligada.
- O nome que a declaração do aplicativo carrega é do fluxo e fica com ele: um plugin da pasta do workspace que declare um deles é recusado na leitura (com o motivo, no catálogo e na auditoria) e não oferece nada; a posse dura enquanto a declaração do aplicativo estiver lida e ligada; sem a pasta do aplicativo, nada é retido.
- Produção: `produces` nos dois modelos (refine+REQUIREMENTS.md, plan+PROTOTYPE.md, communicate+USER_MANUAL.md; engenharia sem manual), migração v24→v25 só por igualdade exata da lista antiga, sem mudança de formato.
- Portão: um botão por artefato (chave pelo arquivo) e `startGate(card, gate, file?)`; o arquivo só vale se casar com opção calculada daquele cartão.
- Revisão (tentativa 5): veredito `changes` — um bloqueante, que esta tentativa corrigiu; as sugestões 3, 4 e 5 também foram atendidas (a 2 fica como risco aceito, abaixo).

## Restrições

- Fora de escopo, ditos pela issue: protótipo em alta fidelidade; publicar o manual fora da execução; acrescentar os três aos demais ciclos; formato e conteúdo dos documentos.
- Marcado como QA, não coberto por teste: aceites 1-3 numa execução real com modelos, 7 (tela sem reiniciar), 9 (quarto tipo numa tela), 10 (espaço real antigo), o clique dos botões do portão.
- Execuções em andamento seguem no fluxo com que começaram.
- Público: `plugin.json`, docs, testes e código neutros; `public-audit` verde em 1591 arquivos em 2026-10-10.

## Tentado e descartado

- Pôr os três tipos no `SpecLayout`/`phaseFiles`; copiar a pasta embutida para o workspace; rank numérico compartilhado; ancorar o manual ao portão 2 — todos descartados no plano.
- Recusar a declaração do workspace dentro de `readPluginDeclaration`: descartado — a função é pura e não conhece a pasta do aplicativo; a recusa fica em `readPlugins`, que é quem lê as duas pastas, e o filtro por capacidade (declaração sem código e sem alcance) é o que marca o nome como do fluxo.
- Manter a recusa com texto literal em inglês (como as demais recusas de declaração, que não passam por `t()`): descartado — a pessoa lê esse motivo na lista de plugins, então virou chave de catálogo nos dois idiomas.
- Revisão (sugestão 2): o `startGate` ainda aceita outra opção calculada do mesmo cartão via metadado de uma proposta; risco aceito (nada sai do cartão; pior caso é abrir o artefato errado do mesmo portão).

## Perguntas abertas

Nenhuma que pause.

## Onde o trabalho está

- Implementação concluída (`3_IMPLEMENTATION.md`, reescrito nesta tentativa). Mudança original: `flow` na declaração, junção pura da fase, leitor da fase, portão por artefato, plugin embutido por capacidade, produção nos dois modelos, migração v24→v25, seis chaves i18n, docs e changelog.
- Correção desta tentativa (bloqueante da revisão): `PluginDocumentType.chain` marca o documento lido da pasta do aplicativo; `readPlugins` recusa, na leitura da pasta do workspace, a declaração que declare um nome desses (a posse vale enquanto a declaração do aplicativo estiver ligada); `writePluginDocument` recusa escrever um documento `chain`. Chave nova `main.plugins.refused.flowDocument` nos dois catálogos; `PluginRecord.documents` passou a `PluginDocumentType[]`. Docs de plugins e `CHANGELOG` (Unreleased) acompanham.
- Sugestões da revisão atendidas: dado de prova de `plugins-core` renomeado para `notes-plugin`/`7_NOTES.md`; linha nova no fim de `plugins/cycle-artifacts/plugin.json` e `README.md`; a do ouro (`test/golden/legacy-prompts.json`) fica registrada como ponto que muda se alguém ligar um plugin naquele caminho (nada a mudar hoje).
- Verificado nesta tentativa (2026-10-10): `npx tsc --noEmit` sem erros; suíte completa 416 arquivos / 6952 testes verdes / 3 pulados; os arquivos tocados (plugin-builtin 11, plugin-runtime 11, plugins-core 25, gate-plugin-documents 10, config-getters 10) verdes; `theme-audit` verde; `i18n:lint` 5483 chaves nos dois idiomas, 12 catálogos; `public-audit` 1591 arquivos, 0 achados; `electron-vite build` exit 0.
- Próximas etapas: QA (aceites 1-3, 7, 9, 10, clique dos botões) e a revisão da correção. Issue e rótulos inalterados.
- Passagem support → product-owner: Seguir para o refino: fixar os nomes e os lugares dos documentos de requisitos, protótipo e manual, em qual etapa cada um entra e é lido, onde o manual aparece, se o plugin embutido vem ligado por padrão e se os documentos de plugin também movem a fase. A-base da plataforma foi conferida por leitura, não executada. <!-- handoff:34 -->
- Passagem product-owner → pessoa: Plano (tech-lead): escrever 2_PLAN.md a partir da 1_SPEC.md — entregar as regras sem trocar os leitores de hoje: como os três tipos novos entram na leitura da fase e na de cada portão (hoje o portão só os oferece no segundo e o primeiro falharia com pasta só de tipos novos), a produção nas etapas refine/plan/communicate do ciclo de agentes, o plugin embutido declarativo ligado por padrão com migração para espaços existentes, os rótulos e as fases nos dois catálogos (i18n), a distinção entre documentos do fluxo e documentos colaterais de plugin, e os testes de regressão (nada foi executado na b… <!-- handoff:47 -->
- Passagem tl-plataforma → pessoa: Implementar seguindo o 2_PLAN.md, na ordem dos 12 passos dele, sem reabrir escopo: (1) campo `flow` em `src/shared/plugins/declaration.ts` (gate 1|2, `phase.label` e `phase.before` com o nome de arquivo simples, recusa própria em `REASONS`); (2) junção pura em `src/shared/plugins/phase.ts` (`withPhaseDocuments`: insere antes da âncora, ignora âncora ausente, não muta a lista); (3) seis chaves novas nos catálogos `en.json` e `pt-BR.json` (`cycle.agentFlow.phase.requirements|prototype|userManual`, `cycle.agentFlow.gate.requirements|prototype|userManual`); (4) leitor da fase em `src/main/cards.ts… <!-- handoff:67 -->
- Passagem developer → revisor-plataforma: Revisar a mudança contra o 2_PLAN.md e o comportamento pedido: campo `flow` e validação em declaration.ts, junção pura em plugins/phase.ts, leitura da fase em cards.ts, portão e artefato do botão em gate.ts/Gate.tsx (startGate com file?), plugin embutido por capacidade em plugins/read.ts + module.ts, produção nos dois modelos em agentFlow.ts e migração v24→v25 sem mudança de formato. Os portões rodaram: tipos sem erros, os testes que a mudança toca verdes (o lote completo e o do núcleo), tema, i18n e área pública verdes. O que sobra é de QA: aceites 1-3 e 10 com modelos de verdade e um espaço … <!-- handoff:157 -->
- Passagem revisor-plataforma → developer: Revisão de 82 contra a spec, o plano e o diff (72 arquivos, 918+/220-): a declaração com `flow`, a junção pura da fase, o leitor da fase, o portão por artefato, o plugin embutido por capacidade, a produção nos dois modelos e a migração v24→v25 conferem com o pedido, e o critério 5 (pasta só com requisitos ainda abre o portão 1, onde hoje ele falharia) está atendido por teste de unidade mais a leitura do código. Nesta tentativa rodaram verdes, de fato: `npx tsc --noEmit`, a suíte completa (416 arquivos, 6948 testes verdes, 3 pulados), os 8 arquivos do núcleo da mudança (239 testes), config-sche… <!-- handoff:314 -->
