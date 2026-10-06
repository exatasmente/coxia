# Memória do ciclo

## Decisões

- A issue é um pedido de funcionalidade (`enhancement`), não um defeito: falta um atalho na lista do motor aberto.
- Escopo reduzido por quem abriu: entrada de atalho no motor aberto, uma linha em `docs/llm-providers.md` e o texto novo nos dois catálogos. O aviso do wizard para `unrecognized_model` fica fora — outra issue, se fizer falta.
- Squad: `plataforma`. Prioridade: `priority:medium`. Marco: nenhum. Gate 1 aprovado.
- Especificação em `1_SPEC.md`; plano técnico em `2_PLAN.md`. Desenho fixado: id do atalho `deepinfra` (`PresetId` e `OPEN_PRESETS`, `src/shared/wizard.ts`), `baseUrl: 'https://api.deepinfra.com/v1/openai'`, `local: false`, `keyRequired: true`, `keyUrl` da página de chave, `headers: {}`, sugestão de modelo que o teste de conexão troca pela lista real; rótulo `wizard.preset.deepinfra` = "DeepInfra" nos dois catálogos; linha nas duas tabelas de `docs/llm-providers.md`; linha em `CHANGELOG.md` sob `## [Unreleased] › ### Added`.
- A entrada fica entre as de nuvem e `custom`. `buildProvider` usa o id do atalho como base (`deepinfra`, `deepinfra-2`); nada a mudar. Nenhum arquivo do renderer muda.
- Não acrescentar "DeepInfra" ao texto de `wizard.kind.openai-compatible.hint`: é chave existente do snapshot e a mudança não é do escopo.

## Restrições

- Cada atalho precisa da chave `wizard.preset.<id>` nos dois catálogos (`test/wizard-i18n.test.ts` expande a família a partir de `OPEN_PRESETS`) e os dois catálogos têm de ter as mesmas chaves e os mesmos placeholders (`test/i18n.test.ts`). `npm run i18n:lint` (`--keys`) só compara os dois arquivos da pasta `src/shared/i18n`; não acusa chave não usada.
- `test/gitlab-catalogs-unchanged.test.ts` compara o texto de cada chave do snapshot `test/fixtures/catalogs-main/`; a chave nova não está no snapshot e nenhuma chave antiga muda de texto, então nenhuma lista `INTENDED` é precisa e o fixture não é tocado.
- `test/host-terms-leak.test.ts` e `test/voice-terminology.test.ts` varrem todas as chaves dos catálogos: "DeepInfra" não carrega palavra de outro host nem a palavra restrita dos testes de voz.
- Nada foi executado nesta etapa: é leitura de código e de documentação. O teste de conexão contra o serviço real (conversa, ferramentas, `json_schema`) segue não verificado.

## Tentado e descartado

- Perguntar a quem abriu pelo endereço da página de chave ou pelo modelo sugerido: descartado; a issue traz os dois.
- Mudar o texto de `wizard.kind.openai-compatible.hint` para citar o serviço: descartado (chave existente do snapshot, fora do escopo do atalho).
- Acrescentar a chave nova ao fixture `test/fixtures/catalogs-main/`: descartado; não é preciso, porque o teste só cobra as chaves do snapshot.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Plano técnico concluído: `2_PLAN.md` na pasta do ciclo. A próxima etapa é a implementação.
- Fatos lidos: `PresetId` e `OPEN_PRESETS` em `src/shared/wizard.ts:86-109`; `buildProvider` (:153-177); `ModelsStep.tsx:31,82-100,283-295` (preenche endereço, reinicia modelo, `keyRequired`, `keyUrl`, teste de conexão em :111-123); `wizard.preset.*` em `wizard.en.json:88` e `wizard.pt-BR.json:88`; `test/wizard-i18n.test.ts:28,79-84`; `test/i18n.test.ts:61-69`; `test/gitlab-catalogs-unchanged.test.ts`; `test/wizard-shared.test.ts:58-62`; `docs/llm-providers.md:80-95` e `:184-199`; `CHANGELOG.md:9-11`; `CONTRIBUTING.md:127-129`; `docs/i18n.md`.
- Nenhuma menção ao serviço no código.
- Passagem plano → implementação: implementar a entrada, a chave nos dois catálogos, a linha na tabela e a linha do changelog; rodar as cinco verificações do `CLAUDE.md`; exercitar, se houver chave, o teste de conexão contra o serviço real e registrar na tabela só o que foi exercitado. O aviso de `unrecognized_model` fica fora. <!-- handoff:21 -->
- Passagem product-owner → plano: escrever o plano técnico a partir de `1_SPEC.md`, com a entrada em `OPEN_PRESETS`/`PresetId`, a chave `wizard.preset.<id>` nos dois catálogos e a linha na tabela de testados (português e inglês). O teste de conexão contra o serviço real segue não verificado. <!-- handoff:16 -->
- Passagem support → product-owner: refinar a issue 60 em uma especificação: fixar a entrada nova de atalho no motor aberto (id, rótulo nos dois catálogos, endereço base, chave exigida, `keyUrl` e modelo sugerido) e a linha na tabela; confirmar que o aviso de `unrecognized_model` fica fora, o squad (plataforma) e a prioridade (`priority:medium`). <!-- handoff:7 -->
- Passagem plano (esta etapa): plano técnico em `2_PLAN.md`, sem código alterado. Sem pergunta em aberto. <!-- handoff:23 -->
