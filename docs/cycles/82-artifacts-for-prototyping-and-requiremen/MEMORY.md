# Memória do ciclo

## Decisões

- Refino de 82 (tentativa 1): `1_SPEC.md` entregue; os cinco pontos que a triagem deixou para o refino estão fixados nas Regras 1 a 6 da spec.
- Plano de 82 (tentativa 1): `2_PLAN.md` entregue, sem pergunta; o mecanismo que a spec deixou ao plano é decisão fechada.
- Campo `flow` na declaração de documento (`{ gate?: 1|2; phase?: { label?, before } }`): documento de fluxo declara portão e âncora de fase (entra "logo acima de" um arquivo que o ciclo já conta); sem `flow`, colateral — portão 2 e fora da fase. Âncora ausente = a fase não muda.
- Plugin embutido = declaração sem código e sem alcance lida da pasta `plugins` do próprio aplicativo (`PLUGINS_BUILT_IN_DIR`, sobe no pacote): ligado por padrão sem migração de configuração (`choice?.enabled ?? true` só para o embutido); escolha guardada vale nos dois sentidos; cópia na pasta do workspace vence; busca web (tem código e configuração) continua manual e desligada.
- Produção: `produces` nos dois modelos do ciclo de agentes (refine + REQUIREMENTS.md, plan + PROTOTYPE.md, communicate + USER_MANUAL.md; o de engenharia só refine/plan, sem manual). Migração **v24→v25** por igualdade exata da lista antiga, com nota; lista tocada pela pessoa não muda; sem mudança de formato (`defaults.ts`/`schema.ts` intocados).
- Tela do portão: um botão por artefato (chave pelo arquivo) e `startGate(card, gate, file?)`; o arquivo só vale se casar com opção calculada daquele cartão, senão primeira opção do número. Manual sem `gate` no `flow`: não é artefato de portão nenhum.
- Rótulos: seis chaves novas nos dois catálogos (`cycle.agentFlow.phase.*` e `cycle.agentFlow.gate.*`); plugin de terceiro continua livre para literal.
- Goldens do runner (`test/runner-golden.test.ts`) gravam o traço completo da execução e se regravam com `UPDATE_GOLDEN=1`; mudou o que as etapas produzem, os traços mudam junto (mecânico).

## Restrições

- Fora de escopo, ditos pela issue: protótipo em alta fidelidade; publicar o manual fora da execução; acrescentar os três aos demais ciclos; formato e conteúdo dos documentos.
- Marcado no plano como verificação de QA, não coberto por teste: aceites 1-3 numa execução real com modelos, 7 (tela mudando sem reiniciar), 9 (quarto tipo numa tela), 10 (espaço real antigo), o clique dos botões do portão e `electron-vite build`.
- Execuções em andamento seguem no fluxo com que começaram; o fluxo é editado e a pessoa pode tirar documentos ou o manual.
- Público: `plugin.json`, docs e código neutros — sem número de issue, host ou pessoa.

## Tentado e descartado

- Pôr os três tipos no `SpecLayout`/`phaseFiles` — descartado no plano: mudaria o formato e a fase deixaria de obedecer ao desligar o plugin.
- Copiar a pasta embutida para o workspace no primeiro uso — descartado: some com `plugins.dir` próprio e duplicaria.
- Rank numérico compartilhado entre configuração e plugin — descartado: sem escala comum.
- Ancorar o manual ao portão 2 — descartado: o manual não tem portão.
- Refino: perguntar nomes, etapas, lugar do manual e estado inicial do plugin — descartado naquele ponto.

## Perguntas abertas

Nenhuma que pause. O que resta é de QA: aceites 1-3, 7, 9, 10, clique dos botões do portão, build do pacote e uma suíte completa sem a carga alheia da máquina.

## Onde o trabalho está

- Implementação concluída, com `3_IMPLEMENTATION.md`. A tentativa interrompida pelo reinício deixou o código meio escrito: faltava o bump `CONFIG_SCHEMA_VERSION` para 25, o `flow` dos três documentos no `ENGINEERING_FLOW_STAGES`, o fio `pluginsDeps.read → PLUGINS_BUILT_IN_DIR`, e havia sobras de texto duplicado no fim de `agentFlow.ts`, `gate.ts` e `config-migrations.test.ts` (corrigidas aqui).
- Verificado nesta etapa (nada além disto): `npx tsc --noEmit` sem erros; testes que a mudança toca verdes (núcleo: 12 arquivos/340 testes; lote: 37 arquivos/433 testes com 1 falha só por timeout ambiental, verde ao rodar sozinho depois); goldens regravados e conferidos 6/6; `scripts/theme-audit.mjs` verde (ev-3); `npm run i18n:lint` sem problemas; `scripts/public-audit.mjs` verde em 1589 arquivos (ev-4). Duas passagens da suíte completa foram lidas e classificadas (falhas reais corrigidas; resto: timeouts de 5 s em arquivos não tocados, sob carga de outro trabalho na máquina); a terceira passagem ficou rodando e não pôde ser lida. `electron-vite build` não rodou.
- Próximas etapas: revisão (tech-lead) e QA, com a lista acima do que não foi verificado. Issue e rótulos inalterados.
- Passagem support → product-owner: Seguir para o refino: fixar os nomes e os lugares dos documentos de requisitos, protótipo e manual, em qual etapa cada um entra e é lido, onde o manual aparece, se o plugin embutido vem ligado por padrão e se os documentos de plugin também movem a fase. A-base da plataforma foi conferida por leitura, não executada. <!-- handoff:34 -->
- Passagem product-owner → pessoa: Plano (tech-lead): escrever 2_PLAN.md a partir da 1_SPEC.md — entregar as regras sem trocar os leitores de hoje: como os três tipos novos entram na leitura da fase e na de cada portão (hoje o portão só os oferece no segundo e o primeiro falharia com pasta só de tipos novos), a produção nas etapas refine/plan/communicate do ciclo de agentes, o plugin embutido declarativo ligado por padrão com migração para espaços existentes, os rótulos e as fases nos dois catálogos (i18n), a distinção entre documentos do fluxo e documentos colaterais de plugin, e os testes de regressão (nada foi executado na b… <!-- handoff:47 -->
- Passagem tl-plataforma → pessoa: Implementar seguindo o 2_PLAN.md, na ordem dos 12 passos dele, sem reabrir escopo: (1) campo `flow` em `src/shared/plugins/declaration.ts` (gate 1|2, `phase.label` e `phase.before` com o nome de arquivo simples, recusa própria em `REASONS`); (2) junção pura em `src/shared/plugins/phase.ts` (`withPhaseDocuments`: insere antes da âncora, ignora âncora ausente, não muta a lista); (3) seis chaves novas nos catálogos `en.json` e `pt-BR.json` (`cycle.agentFlow.phase.requirements|prototype|userManual`, `cycle.agentFlow.gate.requirements|prototype|userManual`); (4) leitor da fase em `src/main/cards.ts… <!-- handoff:67 -->
