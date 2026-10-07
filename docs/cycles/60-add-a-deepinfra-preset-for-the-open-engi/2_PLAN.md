# O atalho do DeepInfra na lista do motor aberto

## Como a mudança é feita

A tela em que um provedor de modelo é adicionado, no motor aberto (tipo "Compatível
com OpenAI"), passa a oferecer **DeepInfra** como um atalho a mais na lista de
servidores, ao lado de OpenAI, OpenRouter, Groq e DeepSeek. O atalho é uma entrada nova
na mesma lista que a tela já lê (`OPEN_PRESETS`, em `src/shared/wizard.ts`) e carrega o
endereço base do serviço (`https://api.deepinfra.com/v1/openai`), a marca de chave
exigida, a página de chave como `keyUrl` e um modelo sugerido de partida. Escolher o
atalho preenche o endereço base no campo (que continua editável), marca a chave como
obrigatória e mostra o link para criar a chave — o comportamento que a tela já tem para
qualquer atalho; a mudança é só a entrada nova.

O identificador do atalho é `deepinfra`. O rótulo que a tela mostra vem da chave de
catálogo `wizard.preset.deepinfra`, definida nos dois catálogos do wizard. Nada mais é
tocado: a tela, o teste de conexão e o motor aberto já leem os atalhos, então nada no
comportamento dos outros atalhos, dos outros provedores ou do motor Claude muda.

Na documentação, a tabela "Provedores: o que foi testado" (e a equivalente em inglês)
passa a ter uma linha do DeepInfra dizendo o que se sabe dele. E o lançamento ganha uma
linha em `## [Unreleased]`, porque a mudança é visível para quem usa.

O aviso do wizard para `anthropic` com endereço não-Anthropic (`unrecognized_model`)
fica de fora, conforme a decisão de quem abriu a issue.

## Decisões de desenho

### 1. A entrada na lista de atalhos

- `PresetId` (`src/shared/wizard.ts:86`) ganha `'deepinfra'`.
- `OPEN_PRESETS` (`src/shared/wizard.ts:101`) ganha a entrada, com os mesmos campos das
  vizinhas:

  ```ts
  { id: 'deepinfra', baseUrl: 'https://api.deepinfra.com/v1/openai', local: false,
    keyRequired: true, suggestedModels: ['<modelo sugerido>'],
    keyUrl: '<página de chave>', headers: {} }
  ```

  A entrada fica entre as que não são locais e antes de `custom`, que fecha a lista
  (nada no código depende da posição; ver risco da posição).
- `local: false` e `headers: {}` são o padrão das entradas de nuvem. `keyRequired: true`
  é o que faz o campo de chave ser obrigatório no formulário (`ModelsStep.tsx:83`), e
  `keyUrl` é o que vira o link "criar chave" (`ModelsStep.tsx:295`).
- O modelo sugerido é o que a issue traz; o teste de conexão o substitui pela lista real
  do servidor (`runTest`, `ModelsStep.tsx:111-123`). Se a implementação preferir a lista
  de modelos que o serviço de fato oferece, o valor exato do modelo é decisão da
  implementação, mas a entrada não pode ficar sem sugestão (o campo de modelo precisa de
  um valor de partida para o teste ter por onde começar) nem ganhar sugestões de modelos
  que não existam no serviço.

### 2. O rótulo nos dois catálogos

- `wizard.preset.deepinfra` entra em `src/shared/i18n/wizard.pt-BR.json` (perto de
  `wizard.preset.deepseek`, linha 88) e em `src/shared/i18n/wizard.en.json`. O texto é
  "DeepInfra" nos dois idiomas: é o nome do serviço, não se traduz.
- `test/wizard-i18n.test.ts:28` expande a família `wizard.preset.` a partir de
  `OPEN_PRESETS` e cobra a chave nos dois idiomas, então a entrada nova exige a chave.
- `test/i18n.test.ts:62-64` exige que os dois catálogos tenham exatamente as mesmas
  chaves: a chave entra nos dois arquivos ou o teste cai.
- `test/gitlab-catalogs-unchanged.test.ts` compara o texto de cada chave do snapshot
  `test/fixtures/catalogs-main/` com o texto de hoje para um workspace GitLab no template
  SDD. A chave nova **não está no snapshot**, e a chave antiga nenhuma muda de texto, então
  nenhuma lista `INTENDED` é precisa e o fixture não é tocado. (`test/host-terms-leak.test.ts`
  e `test/voice-terminology.test.ts` varrem todas as chaves dos catálogos: "DeepInfra" não
  carrega a palavra de outro host nem a palavrinha restrita que o teste de voz proíbe.)

### 3. Documentação e lançamento

- `docs/llm-providers.md`: uma linha nova nas **duas** tabelas (português, linha ~95;
  inglês, linha ~199). A frase depende do que a etapa de implementação conseguir
  exercitar; até lá, o honesto é "esperado funcionar; não testado" (o padrão da tabela
  para quem não foi exercitado contra o serviço real), trocado por "testado no runner" só
  se alguém rodar o teste de conexão e uma execução de verdade. A legenda "esperado
  funcionar; não testado" é a mesma das outras linhas, então a regra do par
  pt-BR/inglês se mantém.
- A entrada nova não muda nenhuma frase existente que fale de outro provedor. Em
  particular, `wizard.kind.openai-compatible.hint` (ambos os catálogos, linha 85) lista
  "OpenAI, OpenRouter, Groq, DeepSeek" como exemplos; "DeepInfra" **não** é acrescentado
  a essa lista: é texto que não tem nada a ver com o atalho e mexer nele arriscaria os
  testes de texto. Se a implementação achar que a lista de exemplos deve citar o serviço,
  é uma segunda mudança, com o teste de snapshot correspondente.
- `CHANGELOG.md`, sob `## [Unreleased]` › `### Added`: uma linha dizendo que o DeepInfra
  passa a aparecer entre os servidores do motor aberto, com endereço preenchido, chave
  exigida e link para criar a chave.

### 4. O que a entrada não toca

- `buildProvider` (`src/shared/wizard.ts:153`) usa o id do atalho como base do id do
  provedor: um provedor criado pelo atalho vira `deepinfra` (e `deepinfra-2` numa
  segunda vez), como acontece com os outros atalhos. Nada a mudar.
- `headers: {}` mantém a regra da API: nada de cabeçalho extra.
- O motor aberto e o teste de conexão já tratam qualquer `baseUrl` compatível com
  OpenAI; o endereço do serviço tem o sufixo `/v1/openai`, que a resolução do
  `probeOpenAIProvider` aceita como raiz (ela acrescenta o resto do caminho).
  **Não verificado** nesta etapa: nenhuma chamada foi feita ao serviço.

## Arquivos

**Runtime / configuração de provedores**

- `src/shared/wizard.ts`: `'deepinfra'` em `PresetId`; entrada nova em `OPEN_PRESETS`.

**Interface e catálogos (os dois idiomas)**

- `src/shared/i18n/wizard.pt-BR.json` e `src/shared/i18n/wizard.en.json`: a chave
  `wizard.preset.deepinfra` (`"DeepInfra"`).
- Nenhum arquivo em `src/renderer/` muda: `ModelsStep.tsx` já lê a lista, o `keyUrl` e
  o `keyRequired`.

**Documentação e lançamento**

- `docs/llm-providers.md`: a linha do serviço nas duas tabelas de testados.
- `CHANGELOG.md`: a linha em `## [Unreleased] › ### Added`.
- `test/fixtures/catalogs-main/`: **não** muda (a chave nova não está no snapshot).

## Testes

1. **A lista e o atalho** (`test/wizard-shared.test.ts`, no bloco "every preset points
   at a root URL"): a entrada nova casa `{ baseUrl: 'https://api.deepinfra.com/v1/openai',
   local: false, keyRequired: true }`, tem um `keyUrl` que começa com `https://` e uma
   sugestão de modelo não vazia; os ids continuam únicos.
2. **Os catálogos** (`test/wizard-i18n.test.ts` e `test/i18n.test.ts`): a chave
   `wizard.preset.deepinfra` existe nos dois idiomas com o mesmo texto (sem placeholder),
   e os dois catálogos continuam com as mesmas chaves. Os testes já cobram o resto da
   família a partir de `OPEN_PRESETS`, então a entrada nova entra na varredura sem teste
   novo.
3. **Os atalhos que já existiam** (`test/wizard-shared.test.ts`, `test/i18n.test.ts`,
   `test/gitlab-catalogs-unchanged.test.ts`): a lista antiga continua igual e nenhum texto
   do snapshot muda; a entrada nova não quebra os testes das outras chaves.
4. **A classificação dos testes** (nenhum): não há teste que exija a ordem dos atalhos;
   a ordem é conferida na revisão.
5. **O teste de conexão contra o serviço real** (não é teste de suíte): nenhum teste da
   árvore pode chamar a rede. A verificação de que o serviço responde à conversa, às
   ferramentas e ao `json_schema` é manual, feita pela etapa de implementação/QA com uma
   chave válida, e o resultado vai para a linha de `docs/llm-providers.md`. **Não
   verificado** nesta etapa.
6. **O que a suíte roda**: `npx tsc --noEmit`, `npx vitest run`,
   `node scripts/theme-audit.mjs` (nenhum literal de cor novo — nenhum arquivo de renderer
   muda), `npm run i18n:lint`, `node scripts/public-audit.mjs`. Nenhum deles foi rodado
   nesta etapa; ela é leitura de código.

## Verificação (o que fica para o próximo passo)

Nada foi executado nesta etapa: o que está acima foi lido no código (a lista de atalhos,
a tela, os catálogos, os testes que os cobram) e na documentação. A implementação roda os
comandos do `CLAUDE.md` do repositório e, se alguém conseguir exercitar o serviço real,
registra na tabela o que foi exercitado; sem isso, a linha diz honestamente que não foi
testado.

## Riscos

| Risco | Como é coberto |
|---|---|
| A linha da tabela afirmar "testado" sem ninguém ter exercitado o serviço | A linha só diz "testado" com o teste de conexão (conversa, ferramentas, `json_schema`) e uma execução de verdade registrados; até lá diz "esperado funcionar; não testado", como as outras linhas que ninguém exercitou. |
| A entrada nova ser posta em `OPEN_PRESETS` sem a chave nos dois catálogos | `test/wizard-i18n.test.ts` e `test/i18n.test.ts` cobram; o formulário mostraria a chave crua em vez do rótulo. |
| O `keyUrl` ou o endereço base errados | O endereço vem da issue; a página de chave é conferida na revisão e pelo uso do link. O endereço base é o mesmo que o teste de conexão deve aceitar; erro aparece na primeira execução. |
| O modelo sugerido não existir no serviço | O campo de modelo aceita qualquer texto e o teste de conexão troca a sugestão pela lista real; uma sugestão inexistente só falha o teste de conexão, não o cadastro. |
| A ordem da entrada na lista mudar o que a tela mostra na abertura | A lista é só a fonte do seletor; a tela não seleciona "o primeiro" para nada (o `draft` inicial usa `openai`, `ModelsStep.tsx:31`). A entrada fica entre as de nuvem e `custom`, que fecha a lista. |
| A chave nova disparar o teste de snapshot dos catálogos | O snapshot `test/fixtures/catalogs-main/` não ganha a chave e nenhuma chave antiga muda de texto; a conferência é o próprio teste. |
| "DeepInfra" casar alguma regra dos testes que varrem os catálogos (palavra de host, palavra restrita de "call") | O nome é do serviço e não contém nenhum dos padrões; o risco é conferido pela suíte. |

## Rollback

Reverter o commit tira a entrada da lista, a chave dos dois catálogos, a linha da tabela
e a linha do changelog. Um provedor **já criado** pelo atalho continua funcionando: o que
fica gravado na configuração é o endereço base, os modelos, a referência à chave e os
cabeçalhos, não o id do atalho.

## Próximos passos (fora deste plano)

- O aviso do wizard para um provedor `anthropic` apontando para um endereço não-Anthropic
  que falha por modelo não reconhecido: outra issue, se fizer falta.
- O endereço do DeepInfra em formato Anthropic e qualquer mudança no motor Claude: fora.
