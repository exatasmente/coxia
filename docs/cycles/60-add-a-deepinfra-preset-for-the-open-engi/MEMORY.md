# Memória do ciclo

## Decisões

- A issue é um pedido de funcionalidade (`enhancement`): faltava um atalho na lista do motor aberto. Escopo reduzido por quem abriu: entrada de atalho, uma linha em `docs/llm-providers.md` e o texto novo nos dois catálogos; o aviso do wizard para `unrecognized_model` fica fora. Squad `plataforma`, `priority:medium`, sem marco. Gate 1 e Gate 2 aprovados.
- Desenho implementado: id `deepinfra` em `PresetId` e em `OPEN_PRESETS` (`src/shared/wizard.ts`), com `baseUrl: 'https://api.deepinfra.com/v1/openai'`, `local: false`, `keyRequired: true`, `suggestedModels: ['meta-llama/Meta-Llama-3.1-8B-Instruct']`, `keyUrl: 'https://deepinfra.com/dash/api_keys'`, `headers: {}`. Entrada entre `deepseek` e `ollama`.
- Rótulo `wizard.preset.deepinfra` = "DeepInfra" nos dois catálogos do wizard; linha do serviço nas duas tabelas de `docs/llm-providers.md` com "esperado funcionar; não testado" / "expected to work; untested"; linha em `CHANGELOG.md` sob `## [Unreleased] › ### Added`. Nada mais mudou: nenhum arquivo do renderer, nenhum teste de texto, nenhum fixture, nenhum texto de chave existente.
- Revisão aprovada com dois achados: (1) bloqueante — linha solta `s.` no fim de `docs/llm-providers.md`, resíduo de edição dentro do commit do código; (2) sugestão — a cobertura nova prende endereço base, `local`, `keyRequired`, `keyUrl` com `https://`, sugestão não vazia e ids únicos, mas não prende `headers: {}`, a posição na lista nem a igualdade com as entradas existentes.

## Restrições

- Cada atalho precisa da chave `wizard.preset.<id>` nos dois catálogos (`test/wizard-i18n.test.ts` expande a família a partir de `OPEN_PRESETS`); os dois catálogos têm de ter as mesmas chaves e os mesmos placeholders (`test/i18n.test.ts`). `test/gitlab-catalogs-unchanged.test.ts` compara o texto de cada chave do snapshot `test/fixtures/catalogs-main/`; a chave nova não está lá, então o fixture não muda.
- `test/host-terms-leak.test.ts` e `test/voice-terminology.test.ts` varrem todas as chaves: "DeepInfra" não dispara nenhum padrão.
- Nenhum teste da árvore pode chamar a rede; o teste de conexão real é manual.
- O atalho novo não mexe em esquema, migração nem tipagem de configuração: nenhum caminho novo escreve no host de código, e a escrita segue passando por Ações.

## Tentado e descartado

- Mudar o texto de `wizard.kind.openai-compatible.hint`: descartado (chave existente do snapshot, fora do escopo).
- Acrescentar a chave nova ao fixture `test/fixtures/catalogs-main/`: descartado; o teste só cobra as chaves do snapshot.
- Afirmar "testado" na tabela sem exercitar o serviço: descartado; a linha diz "esperado funcionar; não testado".
- Corrigir o `s.` do fim de `docs/llm-providers.md` nesta etapa: descartado; a etapa só lê, e o achado vai ao pull request.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Implementação concluída e commitada (`feat: add a deepinfra preset to the open engine #60`). Mudança: `src/shared/wizard.ts`, os dois catálogos do wizard, `docs/llm-providers.md` (duas linhas), `CHANGELOG.md` (uma linha), `test/wizard-shared.test.ts` (caso novo). Nada versionado fora disso além dos documentos do ciclo.
- Verificado na revisão: `npx tsc --noEmit` (0), `node scripts/theme-audit.mjs` (0), `npm run i18n:lint` (0, 4055 chaves), `node scripts/public-audit.mjs` (0, 910 arquivos). Leitura do atalho, dos dois catálogos e do snapshot, das duas tabelas, do changelog e dos testes que os cobram.
- Exercitado fora da suíte: o provedor montado pelo atalho passa pelo esquema da configuração e pela validação; a exportação com ele volta a importar; a exportação sem ele também; os oito atalhos produzem provedor válido.
- Suíte completa: 5 arquivos falharam, todas as falhas por estouro de tempo sob carga paralela mais um caso de disputa de tempo em `test/runner-chain.test.ts`. Em isolamento passam `test/wizard-shared`, `test/wizard-i18n`, `test/i18n`, `test/gitlab-catalogs-unchanged`, `test/voice-terminology`, `test/config-transfer`, `test/wizard-core`, `test/host-terms-leak`, `test/conflict-from-mr`, `test/conflict-resolve`, `test/runner-chain` e `test/updates-source`.
- Não verificado: o resultado final da re-execução isolada de `test/release-git.test.ts` (a etapa terminou antes); o teste de conexão contra o serviço real (conversa, ferramentas, `json_schema`), o endereço da página de chave, o modelo sugerido contra a lista real e a tela aberta.
- Próxima etapa: o pull request. Antes de aceitá-lo, remover a linha solta `s.` do fim de `docs/llm-providers.md`. A legenda da tabela só vira "testado" com o serviço real exercitado.
- Passagem revisor-plataforma → próxima: os achados acima; nada mais pende da revisão.
- Passagem support → product-owner: Refinar a issue 60 em uma especificação: fixar a entrada nova de atalho no motor aberto (id, rótulo nos dois catálogos, endereço base, chave exigida, `keyUrl` e modelo sugerido) e a linha na tabela de `docs/llm-providers.md`; confirmar que o aviso de wizard para modelo não reconhecido fica fora; confirmar o squad proposto (plataforma) e a prioridade (sugerida: priority:medium). A implementação ainda não foi exercitada contra o serviço real — o teste de conexão precisa ser rodado por uma etapa posterior. <!-- handoff:7 -->
- Passagem product-owner → pessoa: A próxima etapa é o plano técnico a partir de `1_SPEC.md`: fixar a entrada nova em `OPEN_PRESETS` (`src/shared/wizard.ts`) e no tipo `PresetId`, a chave `wizard.preset.<id>` nos dois catálogos (`src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json`), e a linha na tabela de testados de `docs/llm-providers.md` (português e inglês). Manter fora o aviso de wizard para `unrecognized_model`, conforme a decisão de quem abriu. O teste de conexão contra o serviço real (conversa, ferramentas e `json_schema`) continua não verificado: precisa ser exercitado por uma etapa posterior — nenhuma ferramenta o r… <!-- handoff:16 -->
- Passagem tl-plataforma → pessoa: Implementar o plano de `2_PLAN.md`: acrescentar `'deepinfra'` a `PresetId` e a entrada nova em `OPEN_PRESETS` (`src/shared/wizard.ts`) com `baseUrl: 'https://api.deepinfra.com/v1/openai'`, `local: false`, `keyRequired: true`, `suggestedModels` com o modelo que a issue traz, o `keyUrl` da página de chave e `headers: {}`; acrescentar `wizard.preset.deepinfra` ("DeepInfra") em `src/shared/i18n/wizard.pt-BR.json` e `wizard.en.json`; acrescentar a linha do serviço nas duas tabelas de `docs/llm-providers.md` e a linha em `CHANGELOG.md` sob `## [Unreleased]` › `### Added`. Não tocar em `test/fixtures… <!-- handoff:26 -->
- Passagem developer → revisor-plataforma: Revisão e QA do atalho do DeepInfra: conferir que a entrada nova (`deepinfra`) em `OPEN_PRESETS`/`PresetId` está no lugar certo da lista, que a chave `wizard.preset.deepinfra` está nos dois catálogos, que a linha do serviço está nas duas tabelas de `docs/llm-providers.md` e no changelog, e que nenhum texto de chave existente nem o snapshot `test/fixtures/catalogs-main/` mudou. O teste de conexão contra o serviço real (conversa, ferramentas, `json_schema`) segue não verificado — quem tiver uma chave válida deve exercitá-lo e trocar a legenda da linha para "testado" só com esse resultado. As fal… <!-- handoff:53 -->
