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
      "secret": { "setting": "token", "in": "header", "name": "Authorization", "format": "Bearer {secret}" }
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
- `offers.entry` terminado em `.mjs` é um **plugin em JavaScript** (abaixo); um script
  de shell continua valendo como hoje, sem `settings` nem `requests`.

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

### 3. Plugin em JavaScript (decisão da pessoa no gate)

Um plugin pode ser um módulo JavaScript (`index.mjs`) com uma função padrão que recebe o
contexto e devolve o resultado. O kit publica os tipos (`docs/plugins/kit/coxia-plugin.d.ts`),
e o exemplo é escrito contra eles.

```js
/** @param {import('./coxia-plugin').PluginContext} ctx */
export default async function (ctx) {
  const asked = await ctx.readCycleFile('SEARCH_REQUESTS.md');
  const res = await ctx.request('search', { query: { q: 'example', format: 'json' } });
  return { document: `# Results\n\n${res.body}` };
}
```

- **Onde roda.** Na mesma sandbox da etapa, pelo próprio executável do aplicativo em
  modo Node (`ELECTRON_RUN_AS_NODE=1`), com a pasta do executável montada só para
  leitura. Não depende de Node instalado na máquina. Conferido nesta etapa: o Electron
  do app roda como Node dentro da sandbox real e importa um módulo de `/tmp`; o
  empacotamento não desliga o modo Node (sem fuses no `electron-builder.yml`).
- **Como o código entra.** A pasta do plugin não é montada (fica nos dados do app). O
  aplicativo lê os arquivos `.mjs`, `.js` e `.json` dela (sem link, sem subir pasta, até
  256 KiB no total) e os entrega à sessão, junto com um arnês do aplicativo que monta o
  contexto e chama a função.
- **O contexto.** `event`, `issue`, `stage`; `settings` (só as que não são chave);
  `readCycleFile(nome)` (os documentos da pasta do ciclo, lidos da worktree montada
  só para leitura); `request(id, { path, query, body })` (leitura feita pelo aplicativo);
  `write(id, { path, query, body })` (escrita que segue o contrato de permissão);
  `log(texto)`.
- **Rodadas por repetição.** A sessão não conversa com o plugin enquanto ele roda, então
  `request` funciona por repetição: na primeira rodada, a primeira chamada sem resposta
  encerra a execução e devolve os pedidos; o aplicativo os faz e roda o plugin de novo
  com as respostas guardadas, que `request` devolve na ordem. Até 3 rodadas e 5 pedidos
  por rodada. O plugin precisa pedir as mesmas coisas na mesma ordem a cada rodada (o
  kit diz isso).
- **O resultado.** O arnês imprime uma linha `::coxia-result` com o JSON (`document`,
  `writes`, pedidos pendentes); o resto da saída é log.

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
4. Runtime JS: arnês, entrega do código, rodadas por repetição, no `runtime.ts`.
5. Permissão e escrita por requisição no serviço.
6. Canais, política do navegador, tela.
7. Kit: o README, os tipos (`coxia-plugin.d.ts`) e um exemplo em JavaScript.

## Riscos

- **Chave vazando.** Só `requests.ts` chama `resolve`; a resposta tem o valor retirado;
  um teste confere que a chave não aparece na resposta, no log nem na auditoria.
- **Destino trocado pelo plugin.** A conferência é contra a declaração e as
  configurações; um teste tenta host, esquema, porta, método e caminho diferentes.
- **Redirecionamento.** `redirect: 'manual'`, e um redirecionamento é recusado.
- **Plugin travando a etapa.** Limite de rodadas, de pedidos, de tempo e de tamanho.

## Testes

Declaração: configurações e requisições válidas e recusadas. Arnês: rodado em Node de
verdade num teste (sem sandbox), com repetição e respostas. Uma prova na sandbox real
quando ela existe na máquina. Serviço: rodadas com sandbox falsa; leitura com e sem permissão; escrita por requisição em cada caminho (sai,
anuncia, pede); teste do espaço de teste. `requests.ts`: `fetch` falso, conferência,
chave no cabeçalho, chave retirada da resposta, limites, redirecionamento, auditoria.
Configuração: esquema e espelhos. Política: canais novos negados ao navegador.

## Não verificado nesta etapa

Nada foi executado; isto é o plano. A primeira prova de uso real é o plugin de busca.
