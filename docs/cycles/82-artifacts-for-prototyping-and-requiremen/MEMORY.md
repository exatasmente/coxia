# Memória do ciclo

## Decisões

- Refino de 82 (tentativa 1): `1_SPEC.md` entregue; os cinco pontos da triagem fixados nas Regras 1 a 6.
- Plano de 82 (tentativa 1): `2_PLAN.md` entregue; o mecanismo que a spec deixou ao plano é decisão fechada.
- Campo `flow` na declaração de documento (`{ gate?: 1|2; phase?: { label?, before } }`); sem `flow` o tipo é colateral (portão 2, fora da fase).
- Plugin embutido = declaração sem código e sem alcance lida da pasta `plugins` do aplicativo (`PLUGINS_BUILT_IN_DIR`, sobe no pacote), ligada por padrão sem migração de config; cópia na pasta do workspace vence; busca web segue manual e desligada.
- O nome que a declaração do aplicativo carrega é do fluxo e fica com ele: um plugin da pasta do workspace que declare um deles é recusado na leitura (com o motivo, no catálogo e na auditoria) e não oferece nada; a posse dura enquanto a declaração do aplicativo estiver lida e ligada; sem a pasta do aplicativo, nada é retido.
- Produção: `produces` nos dois modelos (refine+REQUIREMENTS.md, plan+PROTOTYPE.md, communicate+USER_MANUAL.md; engenharia sem manual), migração v24→v25 só por igualdade exata da lista antiga, sem mudança de formato.
- Portão: um botão por artefato (chave pelo arquivo) e `startGate(card, gate, file?)`; o arquivo só vale se casar com opção calculada daquele cartão.
- Revisão (tentativa 6): veredito `approved` — o bloqueante da rodada 1 está fechado no código e por teste; as sugestões 3, 4 e 5 atendidas; a 2 fica como risco aceito.

## Restrições

- Fora de escopo, ditos pela issue: protótipo em alta fidelidade; publicar o manual fora da execução; acrescentar os três aos demais ciclos; formato e conteúdo dos documentos.
- Marcado como QA, não coberto por teste: aceites 1-3 numa execução real com modelos, 7 (tela sem reiniciar), 9 (quarto tipo numa tela), 10 (espaço real antigo), o clique dos botões do portão e a recusa de um plugin do workspace vista na lista.
- Execuções em andamento seguem no fluxo com que começaram.
- Público: `plugin.json`, docs, testes e código neutros; `public-audit` verde em 1591 arquivos em 2026-10-10.

## Tentado e descartado

- Pôr os três tipos no `SpecLayout`/`phaseFiles`; copiar a pasta embutida para o workspace; rank numérico compartilhado; ancorar o manual ao portão 2 — todos descartados no plano.
- Recusar a declaração do workspace dentro de `readPluginDeclaration`: descartado — a função é pura e não conhece a pasta do aplicativo; a recusa fica em `readPlugins`, e o filtro por capacidade (declaração sem código e sem alcance) é o que marca o nome como do fluxo.
- Manter a recusa com texto literal em inglês: descartado — a pessoa lê esse motivo na lista de plugins, então virou chave de catálogo nos dois idiomas.
- Revisão (sugestão 2): o `startGate` ainda aceita outra opção calculada do mesmo cartão via metadado de uma proposta; risco aceito (nada sai do cartão; pior caso é abrir o artefato errado do mesmo portão).

## Perguntas abertas

Nenhuma que pause.

## Onde o trabalho está

- Implementação concluída (`3_IMPLEMENTATION.md`). Mudança: `flow` na declaração, junção pura da fase, leitor da fase, portão por artefato, plugin embutido por capacidade, produção nos dois modelos, migração v24→v25, seis chaves i18n, docs e changelog. Correção do bloqueante: `chain` no tipo de documento, recusa na leitura da pasta do workspace, guarda de escrita em `writePluginDocument`, `PluginRecord.documents` como `PluginDocumentType[]`, chave `main.plugins.refused.flowDocument` nos dois catálogos.
- Revisão (rodada 2, 2026-10-10): veredito `approved`. O bloqueante da rodada 1 (um plugin de terceiro gravando por cima do manual) está fechado e coberto por `test/plugin-builtin.test.ts` e `test/plugin-runtime.test.ts`; as sugestões 3 (dado de prova neutro), 4 (linha nova no fim dos dois arquivos novos) e 5 (ouro registrado como risco) atendidas; a 2 segue risco aceito.
- Verificado na revisão (2026-10-10): `npx tsc --noEmit` sem erros; suíte completa 416 arquivos / 6952 testes verdes / 3 pulados; os 8 arquivos do núcleo da mudança (248 testes) e config-schema/golden/host-gui (56 testes) verdes; `theme-audit` verde; `i18n:lint` 5483 chaves nos dois idiomas, 12 catálogos; `public-audit` 1591 arquivos, 0 achados; `electron-vite build` exit 0.
- Próximas etapas: QA (aceites 1-3, 7, 9, 10, clique dos botões, recusa na lista de plugins). Issue e rótulos inalterados.
- Passagem support → product-owner: Seguir para o refino: fixar os nomes e os lugares dos documentos de requisitos, protótipo e manual, em qual etapa cada um entra e é lido, onde o manual aparece, se o plugin embutido vem ligado por padrão e se os documentos de plugin também movem a fase. A base da plataforma foi conferida por leitura, não executada. <!-- handoff:34 -->
- Passagem product-owner → pessoa: Plano (tech-lead): escrever 2_PLAN.md a partir da 1_SPEC.md — entregar as regras sem trocar os leitores de hoje: como os três tipos novos entram na leitura da fase e na de cada portão, a produção nas etapas refine/plan/communicate, o plugin embutido declarativo ligado por padrão com migração, os rótulos e as fases nos dois catálogos, a distinção entre documentos do fluxo e colaterais, e os testes de regressão. <!-- handoff:47 -->
- Passagem tl-plataforma → pessoa: Implementar seguindo o 2_PLAN.md, na ordem dos 12 passos dele, sem reabrir escopo. <!-- handoff:67 -->
- Passagem developer → revisor-plataforma: Revisar a mudança contra o 2_PLAN.md e o comportamento pedido. O que sobra é de QA: aceites 1-3 e 10 com modelos de verdade e um espaço real. <!-- handoff:157 -->
- Passagem revisor-plataforma → developer: Revisão de 82: um bloqueante (o embutido vencia o rótulo, não a escrita). <!-- handoff:314 -->
- Passagem developer → revisor-plataforma: Revisar a correção do bloqueante e depois a QA (aceites 1-3, 7, 9, 10, clique dos botões, recusa na lista de plugins). <!-- handoff:342 -->
- Passagem revisor-plataforma → QA: Revisão da correção aprovada (`4_REVIEW.md`); o bloqueante está fechado e coberto por teste; falta a QA dos aceites com modelos de verdade e na tela. <!-- handoff:400 -->
