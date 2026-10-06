# O atalho do DeepInfra já aparece na lista do motor aberto

## O que mudou

- A lista de servidores do motor aberto (tipo "Compatível com OpenAI") passou a ter
  **DeepInfra** como opção a mais, entre as de nuvem e o "outro endereço".
- Escolher o DeepInfra preenche o endereço base com
  `https://api.deepinfra.com/v1/openai` (ainda editável no campo), marca a chave como
  obrigatória e mostra o link para criar a chave.
- O campo de modelo passa a trazer uma sugestão de partida, que o teste de conexão
  substitui pelos modelos que o servidor listar.
- As duas tabelas de provedores testados em `docs/llm-providers.md` passam a citar o
  DeepInfra, com a legenda "esperado funcionar; não testado" / "expected to work; untested".
- O changelog ganhou a linha da mudança sob `## [Unreleased] › ### Added`.

## Onde a mudança vive

- `src/shared/wizard.ts`: `'deepinfra'` em `PresetId` e a entrada nova em
  `OPEN_PRESETS`, logo depois de `deepseek` e antes de `ollama`, com
  `baseUrl: 'https://api.deepinfra.com/v1/openai'`, `local: false`, `keyRequired: true`,
  `suggestedModels: ['meta-llama/Meta-Llama-3.1-8B-Instruct']`,
  `keyUrl: 'https://deepinfra.com/dash/api_keys'` e `headers: {}`.
- `src/shared/i18n/wizard.en.json` e `src/shared/i18n/wizard.pt-BR.json`: a chave
  `wizard.preset.deepinfra` com o texto `"DeepInfra"` nos dois idiomas, na mesma posição.
- `docs/llm-providers.md`: uma linha em cada tabela de testados (português e inglês).
- `CHANGELOG.md`: uma linha em `## [Unreleased] › ### Added`.
- `test/wizard-shared.test.ts`: o caso da entrada nova.

Nenhum arquivo do renderer mudou: a tela já lê a lista, o `keyRequired` e o `keyUrl`.
Nenhum texto de chave existente mudou e o snapshot `test/fixtures/catalogs-main/` não foi
tocado.

## Correções dos achados da revisão

A revisão anterior apontou dois achados, ambos resolvidos nesta passagem:

1. **Bloqueante — linha solta `s.` no fim de `docs/llm-providers.md`.** Removida. O
   arquivo termina hoje na última limitação conhecida da seção inglesa, e a conferência
   do fim do arquivo não mostra mais nenhuma linha órfã.
2. **Sugestão — cobertura incompleta.** O caso de `test/wizard-shared.test.ts` passou a
   prender o `keyUrl` exato (`https://deepinfra.com/dash/api_keys`), o `headers: {}`, a
   igualdade das chaves da entrada com as de `OPEN_PRESETS[0]` e a ordem exata dos ids.
   Uma troca de cabeçalhos, um endereço de chave de outro serviço ou uma reordenação
   passam a ser acusadas.

## O que foi verificado nesta passagem

- `npx tsc --noEmit`: sem erros (código de saída 0).
- Os testes que tocam o atalho, os catálogos e as varreduras de texto
  (`test/wizard-shared.test.ts`, `test/wizard-i18n.test.ts`, `test/i18n.test.ts`,
  `test/gitlab-catalogs-unchanged.test.ts`, `test/host-terms-leak.test.ts`,
  `test/voice-terminology.test.ts`): 6 arquivos, 52 casos, todos passam em isolamento.
- Os arquivos que a suíte completa derrubava por estouro de tempo sob carga, rodados em
  isolamento: `test/conflict-from-mr.test.ts`, `test/conflict-resolve.test.ts`,
  `test/runner-chain.test.ts` (3 arquivos, 43 casos), `test/release-git.test.ts` (69 casos)
  e `test/update-script.test.ts` (12 casos). Todos passam; nenhuma falha aponta para a
  mudança.
- `node scripts/theme-audit.mjs`: sem literais de cor novos (código de saída 0).
- `npm run i18n:lint`: 4055 chaves nos dois idiomas, nada a corrigir (código de saída 0).
- `node scripts/public-audit.mjs`: 911 arquivos, nada que pertença a uma empresa ou a uma
  pessoa (código de saída 0).
- Leitura do atalho, dos dois catálogos, do snapshot, das duas tabelas, do changelog e dos
  testes que os cobram; conferência do fim do `docs/llm-providers.md` byte a byte (sem
  resíduo).

A suíte completa (`npx vitest run`) não terminou dentro da janela de tempo de um comando
nesta passagem: ela roda sob carga paralela e alguns arquivos estouram o tempo nesse
regime. Cada arquivo sinalizado em passagens anteriores foi então exercitado em isolamento
e passou, como listado acima.

## O que não foi verificado

- **O teste de conexão contra o serviço real** (conversa, chamadas de ferramenta e
  `json_schema`): não foi exercitado — não houve chave válida nem chamada à rede. Por isso
  a linha da tabela diz "esperado funcionar; não testado" e não "testado".
- **O endereço da página de chave** (`https://deepinfra.com/dash/api_keys`): veio da issue
  e não foi aberto; só se sabe que começa com `https://`, que é o que o teste prende.
- **O modelo sugerido** (`meta-llama/Meta-Llama-3.1-8B-Instruct`): é uma sugestão de
  partida; não foi conferido contra a lista de modelos que o serviço oferece. O campo
  aceita qualquer texto e o teste de conexão troca a sugestão pela lista real.
- **A tela aberta**: nenhuma execução da interface foi feita; o que se conferiu foi o
  código que já lê a lista e o teste que cobre a entrada.

## O que ficou de fora

- O aviso do wizard para `unrecognized_model` num provedor `anthropic` que aponta para um
  endereço que não é da Anthropic: fica para outra issue, por decisão de quem abriu.
- Nada mudou no motor Claude, no endereço em formato Anthropic do DeepInfra, nos outros
  provedores nem no texto de `wizard.kind.openai-compatible.hint`.
