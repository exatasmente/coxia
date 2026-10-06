# Memória do ciclo

## Decisões

- A issue é um pedido de funcionalidade (`enhancement`), não um defeito: falta um atalho na lista do motor aberto.
- Escopo reduzido por quem abriu: entrada de atalho no motor aberto, uma linha em `docs/llm-providers.md` e o texto novo nos dois catálogos. O aviso do wizard para `unrecognized_model` fica fora — outra issue, se fizer falta.
- Squad: `plataforma` (atalhos de provedor e configuração do motor aberto; o catálogo acompanha a entrada nova).
- Prioridade proposta: `priority:medium`, como já está no rótulo. Marco proposto: nenhum.
- Especificação fixada em `1_SPEC.md`, nas palavras do produto, sem projetar solução: identificador próprio com rótulo "DeepInfra" nos dois idiomas, endereço base `https://api.deepinfra.com/v1/openai`, chave exigida com o link "criar chave", modelo sugerido de partida trocado pelo teste de conexão, e a linha na tabela de testados nos dois idiomas. Critérios de aceite 1 a 7 no documento.
- Nenhuma pergunta a quem abriu: a issue basta.

## Restrições

- Regras do repositório para o atalho: cada atalho precisa da chave `wizard.preset.<id>` nos dois catálogos (`test/wizard-i18n.test.ts` cobra, expandindo a família a partir de `OPEN_PRESETS`) e de uma linha na tabela de testados em `docs/llm-providers.md`.
- Escolher um atalho preenche o endereço base e reinicia o modelo (`ModelsStep.tsx:96-100`); `keyRequired` governa o campo de chave e `keyUrl` vira o link "criar chave".
- Nada foi executado nesta etapa: é leitura de código e da issue. O teste de conexão contra o serviço real segue não verificado.

## Tentado e descartado

- Perguntar a quem abriu pelo endereço da página de chave ou pelo modelo sugerido: descartado. A issue diz "a página de chave como `keyUrl`" e traz um modelo sugerido; é detalhe público.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Refinamento concluído: `1_SPEC.md` na pasta do ciclo, com regras, critérios de aceite e fora do escopo. A próxima etapa é o plano técnico.
- Fatos lidos: `OPEN_PRESETS` e `PresetId` em `src/shared/wizard.ts:86-109`; rótulos `wizard.preset.*` em `src/shared/i18n/wizard.en.json:88` e `wizard.pt-BR.json:88`; `keyUrl`, `keyRequired` e o seletor em `src/renderer/src/wizard/steps/ModelsStep.tsx:82-100,284-295`; tabela de testados em `docs/llm-providers.md:80-95` e `:184-199`. Nenhuma menção ao serviço no código.
- Passagem product-owner → plano: escrever o plano técnico a partir de `1_SPEC.md`; manter fora o aviso de `unrecognized_model`. O teste de conexão contra o serviço real ainda não foi exercitado — precisa ser rodado por uma etapa posterior. <!-- handoff:8 -->
- Passagem support → product-owner: Refinar a issue 60 em uma especificação: fixar a entrada nova de atalho no motor aberto (id, rótulo nos dois catálogos, endereço base, chave exigida, `keyUrl` e modelo sugerido) e a linha na tabela de `docs/llm-providers.md`; confirmar que o aviso de wizard para modelo não reconhecido fica fora; confirmar o squad proposto (plataforma) e a prioridade (sugerida: priority:medium). A implementação ainda não foi exercitada contra o serviço real — o teste de conexão precisa ser rodado por uma etapa posterior. <!-- handoff:7 -->
