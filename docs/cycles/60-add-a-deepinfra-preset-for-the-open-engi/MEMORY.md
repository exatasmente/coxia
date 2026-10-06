# Memória do ciclo

## Decisões

- A issue é um pedido de funcionalidade (`enhancement`): faltava um atalho na lista do motor aberto. Escopo reduzido por quem abriu: entrada de atalho, uma linha em `docs/llm-providers.md` e o texto novo nos dois catálogos; o aviso do wizard para `unrecognized_model` fica fora. Squad `plataforma`, `priority:medium`, sem marco. Gate 1 e Gate 2 aprovados.
- Desenho implementado: id `deepinfra` em `PresetId` e em `OPEN_PRESETS` (`src/shared/wizard.ts`), com `baseUrl: 'https://api.deepinfra.com/v1/openai'`, `local: false`, `keyRequired: true`, `suggestedModels: ['meta-llama/Meta-Llama-3.1-8B-Instruct']`, `keyUrl: 'https://deepinfra.com/dash/api_keys'`, `headers: {}`. Entrada entre `deepseek` e `ollama`.
- Rótulo `wizard.preset.deepinfra` = "DeepInfra" nos dois catálogos do wizard; linha do serviço nas duas tabelas de `docs/llm-providers.md` com "esperado funcionar; não testado" / "expected to work; untested"; linha em `CHANGELOG.md` sob `## [Unreleased] › ### Added`. Nada mais mudou.
- Os dois achados da revisão foram fechados: (1) a linha solta `s.` do fim de `docs/llm-providers.md` foi removida (o arquivo termina na última limitação conhecida da seção inglesa, conferido byte a byte); (2) o caso de `test/wizard-shared.test.ts` passou a prender `keyUrl` exato, `headers: {}`, a igualdade das chaves com `OPEN_PRESETS[0]` e a ordem dos ids.
- Revisão aprovada na rodada 2: os dois achados anteriores fechados, nenhum achado novo, nenhum fato novo no diff desta rodada. A entrega segue correspondendo à spec e ao plano.

## Restrições

- Cada atalho precisa da chave `wizard.preset.<id>` nos dois catálogos (`test/wizard-i18n.test.ts` expande a família a partir de `OPEN_PRESETS`); os dois catálogos têm de ter as mesmas chaves e os mesmos placeholders (`test/i18n.test.ts`). `test/gitlab-catalogs-unchanged.test.ts` compara o texto de cada chave do snapshot `test/fixtures/catalogs-main/`; a chave nova não está lá, então o fixture não muda.
- `test/host-terms-leak.test.ts` e `test/voice-terminology.test.ts` varrem todas as chaves: "DeepInfra" não dispara nenhum padrão.
- Nenhum teste da árvore pode chamar a rede; o teste de conexão real é manual.
- O atalho novo não mexe em esquema, migração nem tipagem de configuração: nenhum caminho novo escreve no host de código, e a escrita segue passando por Ações.
- O endereço base tem o sufixo `/v1/openai`; a resolução do motor aberto o aceita como raiz (normaliza barras finais e as rotas `/chat/completions` e `/models`, sem reescrever caminho não vazio). Conferido por leitura, não por chamada.

## Tentado e descartado

- Mudar o texto de `wizard.kind.openai-compatible.hint`: descartado (chave existente do snapshot, fora do escopo).
- Acrescentar a chave nova ao fixture `test/fixtures/catalogs-main/`: descartado; o teste só cobra as chaves do snapshot.
- Afirmar "testado" na tabela sem exercitar o serviço: descartado; a linha diz "esperado funcionar; não testado".
- Rodar a suíte completa numa passagem: descartado; sob carga paralela ela passa da janela de tempo de um comando. Os arquivos sinalizados foram exercitados em isolamento, um a um, e todos passam.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Implementação concluída e revisão aprovada (rodada 2). Mudança: `src/shared/wizard.ts`, os dois catálogos do wizard, `docs/llm-providers.md` (duas linhas), `CHANGELOG.md` (uma linha), `test/wizard-shared.test.ts` (caso novo). O trabalho está commitado (`caa4a6e` fecha os achados da rodada 1); o app commita os documentos do ciclo. Nada pendente no worktree desta revisão.
- Verificado nesta revisão, por execução: `npx tsc --noEmit` (0); os seis arquivos do atalho/catálogos/varreduras de texto (6 arquivos, 52 casos, todos passam); `node scripts/theme-audit.mjs` (0); `npm run i18n:lint` (0, 4055 chaves em ambos os idiomas); `node scripts/public-audit.mjs` (0, 911 arquivos). Conferido por leitura: fim de `docs/llm-providers.md` byte a byte (sem resíduo), posição e campos da entrada, chaves nos dois catálogos, snapshot intacto, resolução do endereço base no motor aberto e a fronteira de segurança.
- Não verificado: o teste de conexão contra o serviço real (conversa, ferramentas, `json_schema`), o endereço da página de chave, o modelo sugerido contra a lista real e a tela aberta. A suíte completa não foi rodada nesta revisão (janela de tempo sob carga); os arquivos que estouravam foram exercitados em isolamento numa passagem anterior.
- Próxima etapa: o pull request. Se alguém exercitar o serviço real, a legenda da tabela vira "testado"; sem isso, mantém "esperado funcionar; não testado".
- Passagem revisor-plataforma → pessoa (rodada 2): entrega aprovada; abrir o pull request. <!-- handoff:280 -->
- Passagem developer → revisor-plataforma: os dois achados da rodada 1 fechados; a legenda da tabela só vira "testado" com o teste de conexão real. <!-- handoff:267 -->
- Passagem support → product-owner: Refinar a issue 60 em uma especificação: fixar a entrada nova de atalho no motor aberto (id, rótulo nos dois catálogos, endereço base, chave exigida, `keyUrl` e modelo sugerido) e a linha na tabela de `docs/llm-providers.md`; confirmar que o aviso de wizard para modelo não reconhecido fica fora; confirmar o squad proposto (plataforma) e a prioridade (sugerida: priority:medium). A implementação ainda não foi exercitada contra o serviço real — o teste de conexão precisa ser rodado por uma etapa posterior. <!-- handoff:7 -->
- Passagem product-owner → pessoa: A próxima etapa é o plano técnico a partir de `1_SPEC.md`: fixar a entrada nova em `OPEN_PRESETS` (`src/shared/wizard.ts`) e no tipo `PresetId`, a chave `wizard.preset.<id>` nos dois catálogos (`src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json`), e a linha na tabela de testados de `docs/llm-providers.md` (português e inglês). Manter fora o aviso de wizard para `unrecognized_model`, conforme a decisão de quem abriu. O teste de conexão contra o serviço real (conversa, ferramentas e `json_schema`) continua não verificado: precisa ser exercitado por uma etapa posterior — nenhuma ferramenta o r… <!-- handoff:16 -->
- Passagem developer → revisor-plataforma: Revisão e QA do atalho do DeepInfra: conferir que a entrada nova (`deepinfra`) em `OPEN_PRESETS`/`PresetId` está no lugar certo da lista, que a chave `wizard.preset.deepinfra` está nos dois catálogos, que a linha do serviço está nas duas tabelas de `docs/llm-providers.md` e no changelog, e que nenhum texto de chave existente nem o snapshot `test/fixtures/catalogs-main/` mudou. O teste de conexão contra o serviço real (conversa, ferramentas, `json_schema`) segue não verificado — quem tiver uma chave válida deve exercitá-lo e trocar a legenda da linha para "testado" só com esse resultado. As fal… <!-- handoff:53 -->
- Passagem revisor-plataforma → developer: A entrega corresponde à spec e ao plano: o atalho `deepinfra` entrou em `PresetId`/`OPEN_PRESETS` (entre `deepseek` e `ollama`), com o endereço base, `local: false`, `keyRequired: true`, `headers: {}` e `keyUrl`; a chave `wizard.preset.deepinfra` ("DeepInfra") está nos dois catálogos, na mesma posição; as duas tabelas de `docs/llm-providers.md` e o `CHANGELOG.md` ganharam a linha do serviço; nenhum texto de chave existente nem o snapshot `test/fixtures/catalogs-main/` mudou (conferido na leitura e pelo teste de snapshot). Também conferi por execução que o provedor que o assistente monta a part… <!-- handoff:224 -->
