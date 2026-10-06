# Memória do ciclo

## Decisões

- A issue é um pedido de funcionalidade (`enhancement`): faltava um atalho na lista do motor aberto. Escopo reduzido por quem abriu: entrada de atalho, uma linha em `docs/llm-providers.md` e o texto novo nos dois catálogos; o aviso do wizard para `unrecognized_model` fica fora. Squad `plataforma`, `priority:medium`, sem marco. Gate 1 e Gate 2 aprovados.
- Desenho implementado: id `deepinfra` em `PresetId` e em `OPEN_PRESETS` (`src/shared/wizard.ts`), com `baseUrl: 'https://api.deepinfra.com/v1/openai'`, `local: false`, `keyRequired: true`, `suggestedModels: ['meta-llama/Meta-Llama-3.1-8B-Instruct']`, `keyUrl: 'https://deepinfra.com/dash/api_keys'`, `headers: {}`. Entrada entre `deepseek` e `ollama`.
- Rótulo `wizard.preset.deepinfra` = "DeepInfra" nos dois catálogos do wizard. A linha do serviço entrou nas duas tabelas de `docs/llm-providers.md` com a legenda "esperado funcionar; não testado" (pt-BR) / "expected to work; untested" (inglês), e uma linha em `CHANGELOG.md` sob `## [Unreleased] › ### Added`.
- Não tocar em `wizard.kind.openai-compatible.hint` (chave existente do snapshot) nem em `test/fixtures/catalogs-main/` (a chave nova não está no snapshot; nenhuma chave antiga mudou de texto). Nenhum arquivo do renderer muda.

## Restrições

- Cada atalho precisa da chave `wizard.preset.<id>` nos dois catálogos (`test/wizard-i18n.test.ts` expande a família a partir de `OPEN_PRESETS`); os dois catálogos têm de ter as mesmas chaves e os mesmos placeholders (`test/i18n.test.ts`). `test/gitlab-catalogs-unchanged.test.ts` compara o texto de cada chave do snapshot; a chave nova não está lá, então o fixture não muda.
- `test/host-terms-leak.test.ts` e `test/voice-terminology.test.ts` varrem todas as chaves: "DeepInfra" não dispara nenhum padrão.
- Nenhum teste da árvore pode chamar a rede; o teste de conexão real é manual.

## Tentado e descartado

- Mudar o texto de `wizard.kind.openai-compatible.hint`: descartado (chave existente do snapshot, fora do escopo).
- Acrescentar a chave nova ao fixture `test/fixtures/catalogs-main/`: descartado; o teste só cobra as chaves do snapshot.
- Afirmar "testado" na tabela sem exercitar o serviço: descartado; a linha diz "esperado funcionar; não testado".

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Implementação concluída no worktree. Arquivos mudados: `src/shared/wizard.ts` (`PresetId`, `OPEN_PRESETS`), `src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json` (chave nova), `docs/llm-providers.md` (duas linhas), `CHANGELOG.md` (uma linha), `test/wizard-shared.test.ts` (caso novo). Nada commitado; o commit é do app.
- Verificações rodadas nesta etapa: `npx tsc --noEmit` (0), `node scripts/theme-audit.mjs` (0), `npm run i18n:lint` (0, 4055 chaves), `node scripts/public-audit.mjs` (0, 909 arquivos). `npx vitest run` rodou até o fim com 5 arquivos falhando por estouro de tempo sob carga paralela (`conflict-resolve`, `release-git`, `update-script`, `runner-chain`, um caso de `host-terms-leak`), sem relação com a mudança; os seis testes que tocam o atalho/catálogos/varredura de texto passaram em isolamento (52 casos).
- Não verificado: o teste de conexão contra o serviço real (conversa, ferramentas, `json_schema`), a página de chave e o modelo sugerido contra a lista real, e a tela aberta. A legenda da tabela só vira "testado" com esse exercício.
- Próxima etapa: revisão/QA. Passagem implementação → próxima: conferir a entrada nova, os dois catálogos, as duas tabelas e o changelog; exercitar o teste de conexão real se houver chave, trocando a legenda só com esse resultado. <!-- handoff:26 -->
- Passagem support → product-owner: Refinar a issue 60 em uma especificação: fixar a entrada nova de atalho no motor aberto (id, rótulo nos dois catálogos, endereço base, chave exigida, `keyUrl` e modelo sugerido) e a linha na tabela de `docs/llm-providers.md`; confirmar que o aviso de wizard para modelo não reconhecido fica fora; confirmar o squad proposto (plataforma) e a prioridade (sugerida: priority:medium). A implementação ainda não foi exercitada contra o serviço real — o teste de conexão precisa ser rodado por uma etapa posterior. <!-- handoff:7 -->
- Passagem product-owner → pessoa: A próxima etapa é o plano técnico a partir de `1_SPEC.md`: fixar a entrada nova em `OPEN_PRESETS` (`src/shared/wizard.ts`) e no tipo `PresetId`, a chave `wizard.preset.<id>` nos dois catálogos (`src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json`), e a linha na tabela de testados de `docs/llm-providers.md` (português e inglês). Manter fora o aviso de wizard para `unrecognized_model`, conforme a decisão de quem abriu. O teste de conexão contra o serviço real (conversa, ferramentas e `json_schema`) continua não verificado: precisa ser exercitado por uma etapa posterior — nenhuma ferramenta o r… <!-- handoff:16 -->
