# Como o plugin de busca é feito

## Onde fica

`plugins/web-search/` no repositório (pasta nova na raiz, ao lado de `docs/`):

- `plugin.json`: `id: web-search`, `events: ["stage-finished"]`, documento
  `WEB_SEARCH.md`, configuração `url` (obrigatória, `kind: url`) e a requisição `search`
  (`GET {settings.url}/search`, leitura).
- `index.mjs`: a função do plugin.
- `lib/requests.mjs` (lê as perguntas do arquivo de pedidos e as já respondidas do
  documento) e `lib/document.mjs` (monta o documento a partir das respostas do
  SearXNG).
- `README.md`: como apontar a pasta de plugins do espaço de trabalho para
  `plugins/` (ou copiar a pasta), como ligar o JSON no SearXNG (`search.formats: [html,
  json]`) e a linha a acrescentar às instruções extras dos agentes.

## O fluxo

1. `ctx.readCycleFile('SEARCH_REQUESTS.md')`: itens de lista viram perguntas (sem
   repetidas, até 300 caracteres cada).
2. `ctx.readCycleFile('WEB_SEARCH.md')`: as perguntas já respondidas ficam de fora.
3. Até cinco perguntas novas, pedidas juntas (`Promise.all` de
   `ctx.request('search', { query: { q, format: 'json' } })`), numa rodada só.
4. De cada resposta, os cinco primeiros `results[]` (`title`, `url`, `content`), com o
   texto cortado; uma resposta que não é JSON ou dá erro vira uma linha dizendo isso.
5. O documento é o anterior mais uma seção por pergunta nova; nada novo, nenhum
   documento (o anterior fica como está).

## Como uma etapa lê o documento

O runner entrega à etapa os documentos da pasta do ciclo (`readFolder`, respeitando o
`reads` da etapa quando ela o declara). Uma etapa sem `reads` lê `WEB_SEARCH.md`; uma
com `reads` precisa listá-lo: o README do plugin diz isso.

## Testes

`test/web-search-plugin.test.ts` importa `plugins/web-search/index.mjs` e o chama com um
contexto falso (sem sandbox e sem rede): pedidos lidos, perguntas já respondidas
puladas, limite de cinco, documento com fontes, resposta quebrada, nada novo. Um teste
confere que `plugin.json` passa pela leitura da plataforma (`readPluginDeclaration`).

## Não verificado nesta etapa

Uma instância de SearXNG de verdade; fica para a conferência na revisão, com o
endereço local da pessoa.
