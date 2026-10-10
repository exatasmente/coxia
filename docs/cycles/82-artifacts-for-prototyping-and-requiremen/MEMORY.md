# Memória do ciclo

## Decisões

- Refino de 82 (tentativa 1): `1_SPEC.md` entregue; os cinco pontos da triagem fixados nas Regras 1 a 6.
- Plano de 82 (tentativa 1): `2_PLAN.md` entregue; o mecanismo que a spec deixou ao plano é decisão fechada.
- Campo `flow` na declaração de documento (`{ gate?: 1|2; phase?: { label?, before } }`); sem `flow` o tipo é colateral (portão 2, fora da fase).
- Plugin embutido = declaração sem código e sem alcance lida da pasta `plugins` do aplicativo (`PLUGINS_BUILT_IN_DIR`, sobe no pacote), ligada por padrão sem migração de config; cópia na pasta do workspace vence; busca web segue manual e desligada.
- Produção: `produces` nos dois modelos (refine+REQUIREMENTS.md, plan+PROTOTYPE.md, communicate+USER_MANUAL.md; engenharia sem manual), migração v24→v25 só por igualdade exata da lista antiga, sem mudança de formato.
- Portão: um botão por artefato (chave pelo arquivo) e `startGate(card, gate, file?)`; o arquivo só vale se casar com opção calculada daquele cartão.
- Revisão (tentativa 5): veredito `changes` — um bloqueante (ver abaixo); o resto são sugestões e não travam.
- Revisão: os critérios 1-10 conferem com o código, inclusive o 5 (pasta só com requisitos abre o portão 1) e o 4/6 (colateral fora da fase, no portão 2).

## Restrições

- Fora de escopo, ditos pela issue: protótipo em alta fidelidade; publicar o manual fora da execução; acrescentar os três aos demais ciclos; formato e conteúdo dos documentos.
- Marcado como QA, não coberto por teste: aceites 1-3 numa execução real com modelos, 7 (tela sem reiniciar), 9 (quarto tipo numa tela), 10 (espaço real antigo), o clique dos botões do portão.
- Execuções em andamento seguem no fluxo com que começaram.
- Público: `plugin.json`, docs, testes e código neutros; `public-audit` verde em 1590 arquivos nesta revisão.

## Tentado e descartado

- Pôr os três tipos no `SpecLayout`/`phaseFiles`; copiar a pasta embutida para o workspace; rank numérico compartilhado; ancorar o manual ao portão 2 — todos descartados no plano.
- Revisão: tratado como não-bloqueante o `startGate` aceitar outra opção calculada do mesmo cartão via metadado de uma proposta (nada sai do cartão; virou sugestão 2).

## Perguntas abertas

Nenhuma que pause. O bloqueante não é pergunta: a correção é de implementação (nome reservado / recusa da declaração que copie o embutido).

## Onde o trabalho está

- Implementação concluída (`3_IMPLEMENTATION.md`); a tentativa interrompida pelo reinício deixou faltas (bump para 25, `flow` no `ENGINEERING_FLOW_STAGES`, fio `pluginsDeps.read → PLUGINS_BUILT_IN_DIR`, sobras de texto duplicado) que foram corrigidas.
- Revisão (tentativa 5): `4_REVIEW.md` entregue, veredito `changes`. Rodou verde: `npx tsc --noEmit`, suíte completa (416 arquivos, 6948 testes, 3 pulados), theme-audit, `npm run i18n:lint` (5482 chaves), `public-audit` (1590 arquivos, 0 achados), `electron-vite build` (exit 0), 8 arquivos do núcleo (239 testes), config-schema + goldens (29 testes). A dúvida sobre timeouts ambientais está encerrada.
- Bloqueante a corrigir: um plugin de terceiro que declare `USER_MANUAL.md` grava por cima do manual do usuário (o embutido vence o rótulo, não a escrita): `src/main/plugins/read.ts:137-147` + `src/main/gate.ts:123-128` + `src/main/plugins/runtime.ts:96-112`. Sugestões: artefato do portão pelo metadado de proposta; nomes do dado de prova de `plugins-core`; linha nova no fim de `plugin.json`/`README.md` embutidos; ouro das cerimônias preso ao metadado do cartão.
- Próximas etapas: implementação (bloqueante) e QA (aceites 1-3, 7, 9, 10, clique dos botões). Issue e rótulos inalterados.
- Passagem support → product-owner: Seguir para o refino: fixar os nomes e os lugares dos documentos de requisitos, protótipo e manual, em qual etapa cada um entra e é lido, onde o manual aparece, se o plugin embutido vem ligado por padrão e se os documentos de plugin também movem a fase. A-base da plataforma foi conferida por leitura, não executada. <!-- handoff:34 -->
- Passagem product-owner → pessoa: Plano (tech-lead): escrever 2_PLAN.md a partir da 1_SPEC.md — entregar as regras sem trocar os leitores de hoje: como os três tipos novos entram na leitura da fase e na de cada portão (hoje o portão só os oferece no segundo e o primeiro falharia com pasta só de tipos novos), a produção nas etapas refine/plan/communicate do ciclo de agentes, o plugin embutido declarativo ligado por padrão com migração para espaços existentes, os rótulos e as fases nos dois catálogos (i18n), a distinção entre documentos do fluxo e documentos colaterais de plugin, e os testes de regressão (nada foi executado na b… <!-- handoff:47 -->
- Passagem tl-plataforma → pessoa: Implementar seguindo o 2_PLAN.md, na ordem dos 12 passos dele, sem reabrir escopo: (1) campo `flow` em `src/shared/plugins/declaration.ts` (gate 1|2, `phase.label` e `phase.before` com o nome de arquivo simples, recusa própria em `REASONS`); (2) junção pura em `src/shared/plugins/phase.ts` (`withPhaseDocuments`: insere antes da âncora, ignora âncora ausente, não muta a lista); (3) seis chaves novas nos catálogos `en.json` e `pt-BR.json` (`cycle.agentFlow.phase.requirements|prototype|userManual`, `cycle.agentFlow.gate.requirements|prototype|userManual`); (4) leitor da fase em `src/main/cards.ts… <!-- handoff:67 -->
- Passagem developer → revisor-plataforma: Revisar a mudança contra o 2_PLAN.md e o comportamento pedido: campo `flow` e validação em declaration.ts, junção pura em plugins/phase.ts, leitura da fase em cards.ts, portão e artefato do botão em gate.ts/Gate.tsx (startGate com file?), plugin embutido por capacidade em plugins/read.ts + module.ts, produção nos dois modelos em agentFlow.ts e migração v24→v25 sem mudança de formato. Os portões rodaram: tipos sem erros, os testes que a mudança toca verdes (o lote completo e o do núcleo), tema, i18n e área pública verdes. O que sobra é de QA: aceites 1-3 e 10 com modelos de verdade e um espaço … <!-- handoff:157 -->
