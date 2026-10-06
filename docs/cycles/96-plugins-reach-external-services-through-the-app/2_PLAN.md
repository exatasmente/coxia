# Como o aplicativo faz as requisições de um plugin

## Decisões de mecanismo

### 1. A declaração ganha `settings` e `requests`

```json
{
  "settings": [
    { "key": "url", "label": "Instance URL", "kind": "url", "required": true },
    { "key": "token", "label": "API key", "kind": "secret" }
  ],
  "requests": [
    {
      "id": "search",
      "method": "GET",
      "url": "{settings.url}/search",
      "secret": { "setting": "token", "in": "header", "name": "Authorization", "format": "Bearer {secret}" },
      "pick": { "items": "results", "fields": ["title", "url", "content"] }
    },
    { "id": "post", "method": "POST", "url": "https://hooks.example.com/notify", "write": true, "reversible": false }
  ]
}
```

- `settings[].kind`: `text`, `url` ou `secret`. Chave e rótulo validados pela leitura pura
  (`src/shared/plugins/declaration.ts`), como o resto da declaração.
- `requests[].url`: um URL absoluto `https://` ou um que comece por `{settings.<key>}`
  de uma configuração `url` (aí vale `http://` também: é a instância local da pessoa).
  O caminho declarado é o prefixo permitido; o plugin pode acrescentar caminho e
  parâmetros dentro dele.
- `requests[].secret`: uma configuração `secret` e onde o valor entra (`header` com nome
  e formato, ou `query` com nome).
- `requests[].write`/`reversible`: escrita (com o mesmo sentido de hoje; sem
  `reversible` é irreversível). Sem `write`, é leitura.
- `requests[].pick` (opcional): o aplicativo também entrega a resposta JSON reduzida a
  linhas separadas por tabulação com os campos pedidos de cada item. Assim um plugin em
  shell lê o resultado sem depender de `jq` na máquina da pessoa. A resposta inteira
  continua disponível.

### 2. Onde ficam os valores

- `PluginConfig` ganha `settings: Record<string, string>` com os valores `text` e `url`.
  Uma configuração `secret` vai para o cofre com a referência `plugin.<id>.<key>`; a
  configuração não guarda nada dela, e a lista diz só se está preenchida
  (`secrets().has`).
- Esquema: se o 14 ainda não saiu num beta quando isto entrar, o campo entra no 14; senão,
  degrau `v14ToV15`. Os três espelhos (`types.ts`, `defaults.ts`, `schema.ts`) andam
  juntos.
- Exportação: `plugins.list` já não viaja; a importação já mantém a seção do destino.
- Canais novos: `plugins:set-setting(id, key, value)` e `plugins:set-secret(id, key,
  value)`, ambos em `DESKTOP_ONLY`.

### 3. O protocolo de rodadas

A sessão da sandbox já roda vários comandos em fila (`session.exec`). A execução de um
plugin vira até **3 rodadas** na mesma sessão:

1. O aplicativo roda o script com o acontecimento em `$1` e a rodada em `COXIA_ROUND=1`.
2. Cada linha da saída que comece por `::coxia-request ` seguida de um JSON
   (`{"id": "search", "path": "...", "query": {...}, "body": "..."}`) é um pedido; o
   resto da saída é o resultado, como hoje.
3. Os pedidos de leitura são feitos pelo aplicativo (até 5 por rodada). As respostas vão
   para `/tmp/coxia/responses.json` (e `/tmp/coxia/<id>.tsv` quando há `pick`) dentro da
   sessão, por um comando que só escreve o arquivo, e o script roda de novo com
   `COXIA_ROUND=2`.
4. Uma rodada sem pedido de leitura encerra; o resultado dela é o resultado do plugin.

Os pedidos de escrita não voltam ao plugin: são juntados e, depois da execução, seguem o
caminho da escrita de hoje (`pluginWriteStep`): saem, são anunciados ou viram pedido. Num
pedido `plugin-ask` de escrita, a requisição inteira vai na `unit`, e a resposta da
pessoa a executa.

### 4. Quem faz a chamada

Um módulo novo, `src/main/plugins/requests.ts`, faz a chamada no processo principal,
sem passar pela sandbox:

- Confere o pedido contra a declaração (método, destino, prefixo do caminho) e contra as
  configurações preenchidas; recusa com o motivo.
- Põe a chave pelo `secrets().resolve(ref)` só no objeto da chamada; nunca no log.
- Usa `fetch` com tempo máximo (15 s), sem seguir redirecionamento para outro destino,
  e corta a resposta em 200 KB.
- Tira da resposta o valor da chave e a mascara (`redact`) antes de devolvê-la.
- Grava uma linha de auditoria por chamada (`recordWrite` com `via: 'plugin'`), sem
  corpo e sem chave; uma escrita passa por `audited` como toda escrita, com
  `assertExternalWrite`.

### 5. A permissão

- Requisição de leitura = necessidade `network`. `mayReachNetwork` passa a considerar os
  hosts declarados **e** as requisições de leitura declaradas: sem permissão, o plugin
  não roda e abre o pedido de hoje.
- Requisição de escrita = necessidade `write`, com o `reversible` dela.
- Nada novo no contrato: uma vez, sessão, sempre, recusar; aviso com prazo; teste
  recusa.

### 6. Tela

Na lista de plugins, por plugin: os campos das configurações (texto e URL editáveis,
chave como campo de senha que só grava e mostra "preenchida"), as requisições declaradas
(método, destino, leitura ou escrita) e o aviso de configuração obrigatória faltando.
Chaves novas nos dois catálogos, só tokens de tema.

## Ordem

1. Declaração (`settings`, `requests`) e testes das recusas.
2. Configuração (`settings` por plugin) e esquema.
3. `requests.ts` (conferência, chamada, chave, máscara, limites, auditoria) com `fetch`
   injetado nos testes.
4. Rodadas no `runtime.ts`.
5. Permissão e escrita por requisição no serviço.
6. Canais, política do navegador, tela.
7. Kit: o README e um exemplo.

## Riscos

- **Chave vazando.** Só `requests.ts` chama `resolve`; a resposta tem o valor retirado;
  um teste confere que a chave não aparece na resposta, no log nem na auditoria.
- **Destino trocado pelo plugin.** A conferência é contra a declaração e as
  configurações; um teste tenta host, esquema, porta, método e caminho diferentes.
- **Redirecionamento.** `redirect: 'manual'`, e um redirecionamento é recusado.
- **Plugin travando a etapa.** Limite de rodadas, de pedidos, de tempo e de tamanho.

## Testes

Declaração: configurações e requisições válidas e recusadas. Serviço: rodadas com sandbox
falsa; leitura com e sem permissão; escrita por requisição em cada caminho (sai,
anuncia, pede); teste do espaço de teste. `requests.ts`: `fetch` falso, conferência,
chave no cabeçalho, chave retirada da resposta, limites, redirecionamento, auditoria.
Configuração: esquema e espelhos. Política: canais novos negados ao navegador.

## Não verificado nesta etapa

Nada foi executado; isto é o plano. A primeira prova de uso real é o plugin de busca.
