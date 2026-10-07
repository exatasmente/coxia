# O atalho do DeepInfra: o que a QA exercitou e o que fica por exercitar

## O que esta etapa fez

Foi exercitado o atalho do DeepInfra no motor aberto e as verificações do repositório,
sobre a entrega já revisada (o commit que fechou os achados da revisão está no worktree).
Nada foi alterado no código: esta etapa só rodou e olhou.

## Cenários de caixa preta

Cada cenário diz o que uma pessoa esperaria ver, como foi conferido e o resultado.

### 1. O atalho aparece na lista, com o rótulo e os campos certos

Esperado: escolhendo o motor aberto, a lista de servidores traz o DeepInfra ao lado de
OpenAI, OpenRouter, Groq e DeepSeek; escolhê-lo preenche o endereço base, marca a chave
como obrigatória e oferece o link para criar a chave; o campo de modelo já vem com uma
sugestão.

Como foi conferido: só leitura. A entrada existe em `OPEN_PRESETS`, entre `deepseek` e
`ollama`, com o rótulo `wizard.preset.deepinfra` = "DeepInfra" nos dois catálogos; o
endereço base é `https://api.deepinfra.com/v1/openai`; `keyRequired` é `true`; o `keyUrl`
é `https://deepinfra.com/dash/api_keys`; e há uma sugestão de modelo. A tela já lê a
lista, o `keyRequired` e o `keyUrl` para todos os atalhos, sem caso especial por id, e
nenhum arquivo da tela foi tocado.

Resultado: passa (por leitura do código; a tela não foi aberta).

### 2. O atalho não muda o comportamento dos outros atalhos

Esperado: os atalhos e provedores que já existiam seguem iguais, e nada aparece no motor
Claude.

Como foi conferido: por execução. O teste da lista prende a ordem exata dos oito ids,
com o DeepInfra no lugar decidido e sem id repetido; o teste de catálogos prende que os
dois idiomas têm as mesmas chaves; o teste de snapshot garante que nenhum texto de chave
que já existia mudou. Os dois arquivos de varredura de texto (nome de outro host e
terminologia de voz) continuam passando com a chave nova.

Resultado: passa (6 arquivos, 52 casos, todos verdes).

### 3. As chaves dos catálogos ficam em dia

Esperado: a chave nova existe nos dois idiomas, com o mesmo texto e sem placeholder, e os
dois catálogos não divergem.

Como foi conferido: por execução. A verificação de chaves do repositório (4055 chaves nos
dois idiomas, 0 problemas) e os testes de catálogo e de snapshot.

Resultado: passa.

### 4. O endereço base é aceito pelo motor aberto

Esperado: o endereço do atalho tem o sufixo `/v1/openai`, diferente do `/v1` das outras
entradas de nuvem, e o motor aberto o aceita como raiz — o teste de conexão cairia em
`.../v1/openai/chat/completions` e `.../v1/openai/models`.

Como foi conferido: só leitura. A normalização do endereço remove barras finais e as
rotas `/chat/completions` e `/models` e só reescreve para `/v1` quando o caminho é vazio;
como `/v1/openai` não é vazio, ele é preservado, e as chamadas montam o resto do caminho
a partir dele. A suíte não exercita esse endereço contra um servidor real.

Resultado: passa (por leitura; nenhuma chamada foi feita).

### 5. Os testes e verificações do repositório estão verdes

Esperado: nada quebrou com a mudança.

Como foi conferido: por execução — `tsc --noEmit` (0), a suíte completa (222 arquivos,
3664 casos, todos verdes, código de saída 0), a auditoria de tema (0), a verificação de
chaves de i18n (0, 4055 chaves) e a auditoria de repositório público (0, 911 arquivos).

Resultado: passa.

### 6. O teste de conexão contra o serviço real

Esperado (critério 5 da especificação): com uma chave válida, o teste de conexão devolve
os modelos listados pelo servidor e mostra o que ele sabe fazer (conversa, ferramentas e
`json_schema`).

Como foi conferido: **não exercitado**. Nenhuma chave válida foi usada e nenhuma chamada
saiu para a rede; um teste da árvore não pode chamar a rede, e não havia como fazer a
chamada manual. O que se sabe dele vem da issue, não desta etapa.

Resultado: não rodado. É a lacuna que explica por que a legenda da tabela de provedores
diz "esperado funcionar; não testado".

### 7. O endereço da página de chave e o modelo sugerido

Esperado: o link "criar chave" leva à página de chave do DeepInfra, e a sugestão de modelo
existe no serviço.

Como foi conferido: **não exercitado**. O endereço veio da issue e não foi aberto; o
modelo sugerido não foi conferido contra a lista real do serviço. O teste só garante que
o `keyUrl` começa com `https://` e que há uma sugestão não vazia.

Resultado: não rodado.

## O que não foi verificado

- O teste de conexão contra o serviço real (conversa, ferramentas e `json_schema`) e,
  portanto, o critério 5 da especificação.
- O endereço da página de chave e o modelo sugerido contra o serviço real.
- A tela aberta: o comportamento do atalho foi conferido no código que já lê a lista, não
  numa execução da interface.

## Como uma pessoa confere

1. Abrir o assistente no passo de modelos, adicionar um provedor e escolher o motor aberto
   ("Compatível com OpenAI").
2. Ver o DeepInfra na lista de servidores, ao lado de OpenAI, OpenRouter, Groq e DeepSeek;
   escolhê-lo.
3. Conferir que o endereço base passa a ser `https://api.deepinfra.com/v1/openai` (ainda
   editável), que a chave ficou obrigatória e que o link "criar chave" aponta para a página
   de chave do DeepInfra; o campo de modelo já vem com uma sugestão.
4. Informar uma chave válida e rodar o teste de conexão: os modelos listados pelo servidor
   substituem a sugestão, e o teste mostra o que o servidor sabe fazer.
5. Só depois disso a legenda da linha do DeepInfra em `docs/llm-providers.md` pode passar
   de "esperado funcionar; não testado" para "testado", nos dois idiomas.

## Evidência dos comandos

Os comandos rodados nesta etapa, com o resultado:

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npx vitest run test/wizard-shared.test.ts test/wizard-i18n.test.ts test/i18n.test.ts test/gitlab-catalogs-unchanged.test.ts test/host-terms-leak.test.ts test/voice-terminology.test.ts` | 6 arquivos, 52 casos, 0 |
| `npx vitest run` | 222 arquivos, 3664 casos, 0 |
| `node scripts/theme-audit.mjs` | 0 |
| `npm run i18n:lint` | 0 (4055 chaves nos dois idiomas) |
| `node scripts/public-audit.mjs` | 0 (911 arquivos) |
