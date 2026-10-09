# Memória do ciclo

## Decisões

- Refino de 82 (tentativa 1): `1_SPEC.md` entregue; os cinco pontos que a triagem deixou para o refino estão fixados nas Regras 1 a 6 da spec.
- Plano de 82 (tentativa 1): `2_PLAN.md` entregue, sem pergunta; o mecanismo que a spec deixou ao plano é agora decisão fechada.
- Campo `flow` na declaração de documento (`{ gate?: 1|2; phase?: { label?, before } }`): documento de fluxo declara portão e âncora de fase (entra "logo acima de" um arquivo que o ciclo já conta); sem `flow`, colateral — portão 2 como hoje e fora da fase. Âncora ausente = a fase não muda: é o que preserva os demais ciclos.
- Plugin embutido = declaração **sem código e sem alcance** lida da pasta `plugins` do próprio aplicativo (`PLUGINS_BUILT_IN_DIR`, que sobe no pacote): ligada por padrão sem migração de configuração (`choice?.enabled ?? true` só para o embutido); escolha guardada vale nos dois sentidos; cópia na pasta do workspace vence; a busca web (tem código e configuração) continua manual e desligada.
- Produção: `produces` nos dois modelos do ciclo de agentes (refine + REQUIREMENTS, plan + PROTOTYPE, communicate + USER_MANUAL; o de engenharia sem communicate, logo sem manual) e migração **v24→v25** que só troca lista idêntica à antiga, com nota; lista tocada pela pessoa não muda; sem mudança de formato (`defaults.ts`/`schema.ts` intocados).
- Tela do portão: um botão por artefato (chave pelo arquivo — hoje duas opções do mesmo número dividem chave) e `startGate(card, gate, file?)`, com o arquivo aceito só se casar com opção calculada daquele cartão; sem nome, primeira opção do número (o de hoje).
- Manual sem `gate` no `flow`: não é artefato de portão nenhum.
- Rótulos: seis chaves novas nos dois catálogos (`cycle.agentFlow.phase.*` e `cycle.agentFlow.gate.*`); plugin de terceiro continua livre para usar literal.
- Do refino, continua valendo: `REQUIREMENTS.md`, `PROTOTYPE.md` e `USER_MANUAL.md` na raiz da pasta do ciclo; fase conta os três documentos do fluxo e não conta colateral; plugin ligado por padrão.

## Restrições

- Esta etapa só leu e escreveu documentos: **nenhum portão rodou** (tipos, testes, tema, i18n, área pública, compilação) — é da implementação e da revisão. Comprovações: ev-2 (leituras deste plano) e ev-1 (da spec).
- Fora de escopo, ditos pela issue: protótipo em alta fidelidade; publicar o manual fora da execução; acrescentar os três aos demais ciclos; formato e conteúdo dos documentos.
- Marcado no plano como verificação de QA, não coberto por teste: aceites 1-3 numa execução real com modelos, 7 (tela mudando sem reiniciar), 9 (quarto tipo mostrado na tela) e 10 (abrir um espaço real antigo).
- Execuções em andamento continuam no fluxo com que começaram; o fluxo é editável e a pessoa pode tirar um dos documentos ou o manual.
- Público: `plugin.json` e docs neutros — sem número de issue, host ou pessoa.

## Tentado e descartado

- Pôr os três tipos no `SpecLayout`/`phaseFiles` da configuração — descartado: mexeria no formato (outra migração nos três arquivos) e a fase deixaria de obedecer ao desligar o plugin.
- Copiar a pasta embutida para a pasta de plugins do workspace no primeiro uso — descartado: some quando a pessoa aponta `plugins.dir` para outro lugar e duplicaria com cópia da própria pessoa.
- Rank numérico compartilhado entre configuração e plugin — descartado: não existe escala comum entre as duas listas.
- Tratar toda a pasta de plugins do aplicativo como embutida — descartado: faria a busca web aparecer em todo espaço e mudaria o procedimento documentado; a regra é por capacidade.
- Ancorar o manual ao portão 2 (onde todo documento de plugin cai hoje) — descartado: o manual não tem portão.
- Refino: perguntar nomes, etapas, lugar do manual e estado inicial do plugin — descartado naquele ponto; nenhum desses temas voltou a ser dúvida.

## Perguntas abertas

Nenhuma que pause. Fica só o que o plano declara como verificação no aplicativo (aceites 1-3, 7, 9, 10) — é QA, não decisão.

## Onde o trabalho está

- `2_PLAN.md` entregue nesta tentativa, na pasta do ciclo; `1_SPEC.md`, `0_TRIAGE.md` e `0_ISSUE.md` seguem como estavam; issue e rótulos inalterados.
- Lido e marcado, com a lista completa em ev-2 (nada executado): fase (`src/main/cards.ts:28-40`), portão (`src/main/gate.ts:106-125,174-176`, `src/main/plugins/module.ts:665`, `Gate.tsx:196-200`), declaração (`src/shared/plugins/declaration.ts:16-22,102-121,197-203`), padrão desligado (`src/main/plugins/read.ts:105-111`), produção (`agentFlow.ts:14-38,74-92`, `prompt.ts:288`, `executor.ts:744,1163-1175,1246-1263`, `flowCheck.ts:97-101`), migração (`types.ts:5`, `migrations.ts:10-45,207-226,379`), idiomas (`i18n/index.ts:35-38`, `cycles/text.ts:24-27`, `en/pt-BR.json:616-636`, `ui-gate.*:102`), pacote (`paths.ts:8-11`, `electron-builder.yml:23-31`).
- Próxima etapa: implementação (desenvolvedor), na ordem dos 12 passos do plano.
- Passagem: implementar seguindo o 2_PLAN.md, sem reabrir escopo: campo `flow` e validação, junção de fase, seis chaves nos dois catálogos, leitor da fase, portão com artefato escolhido por botão, plugin embutido por capacidade ligado por padrão, `produces` nos dois modelos com roteiros falsos ajustados, migração v24→v25 por igualdade exata, testes um por comportamento e docs/changelog. Nada rodou ainda: os portões são o primeiro passo. O que depende de tela ou execução real está marcado no fim do plano como verificação de QA.
- Passagem support → product-owner: Seguir para o refino: fixar os nomes e os lugares dos documentos de requisitos, protótipo e manual, em qual etapa cada um entra e é lido, onde o manual aparece, se o plugin embutido vem ligado por padrão e se os documentos de plugin também movem a fase. A-base da plataforma foi conferida por leitura, não executada. <!-- handoff:34 -->
- Passagem product-owner → pessoa: Plano (tech-lead): escrever 2_PLAN.md a partir da 1_SPEC.md — entregar as regras sem trocar os leitores de hoje: como os três tipos novos entram na leitura da fase e na de cada portão (hoje o portão só os oferece no segundo e o primeiro falharia com pasta só de tipos novos), a produção nas etapas refine/plan/communicate do ciclo de agentes, o plugin embutido declarativo ligado por padrão com migração para espaços existentes, os rótulos e as fases nos dois catálogos (i18n), a distinção entre documentos do fluxo e documentos colaterais de plugin, e os testes de regressão (nada foi executado na b… <!-- handoff:47 -->
