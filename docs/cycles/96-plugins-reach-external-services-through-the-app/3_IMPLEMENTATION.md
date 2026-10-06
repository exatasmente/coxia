# Requisições feitas pelo aplicativo, com configurações e chave guardada: como ficou

## O que passou a existir

- **Plugin em JavaScript.** Entrada `.mjs`; roda na sandbox da etapa pelo executável do
  aplicativo em modo Node (`ELECTRON_RUN_AS_NODE=1`, pasta do executável montada só para
  leitura). Os arquivos `.mjs`/`.js`/`.json` da pasta do plugin (até 256 KiB, sem link,
  sem `node_modules`) e um arnês do aplicativo (`HARNESS_MJS`) entram pela pasta de
  controle da sessão (`session.put`); o resultado sai pela pasta de saída
  (`session.take`). A saída de comando (6 mil caracteres, mascarada) não é usada para
  o resultado.
- **Contexto do plugin** (`docs/plugins/kit/coxia-plugin.d.ts`): `event`, `issue`,
  `stage`, `round`, `settings` (só texto e URL), `readCycleFile`, `request`, `write`,
  `log`.
- **Rodadas por repetição:** até 3 rodadas, 5 pedidos por rodada; o arnês confere que as
  chamadas se repetem na mesma ordem.
- **Configurações:** `settings` declaradas (`text`, `url`, `secret`); valores de texto e
  URL em `plugins.list[].settings` (esquema 14, ainda não publicado); chave no cofre como
  `plugin.<id>.<key>`. Canais `plugins:set-setting` e `plugins:set-secret`, só no
  computador. A tela mostra os campos; uma chave só se grava e aparece como
  "preenchida".
- **Requisições:** `requests` declaradas (método, URL `https://` ou `{settings.<key>}`,
  chave em cabeçalho ou parâmetro, escrita e reversibilidade). `resolvePluginRequest`
  (puro) confere id, configuração preenchida, caminho dentro do declarado (sem `..`,
  `//`, `%2e`), parâmetros e corpo. `performPluginRequest` faz a chamada no processo
  principal com `fetch`, `redirect: 'manual'`, 15 s, 200 KiB, chave só na chamada, e a
  retira da resposta antes de mascará-la.
- **Permissão:** leituras declaradas contam como a rede do plugin (pedido antes de
  rodar, como os hosts). Escritas pedidas por `ctx.write` seguem o caminho da escrita de
  hoje: saem (pela porta auditada, `auditPluginRequest`), são anunciadas com prazo (o
  aviso leva a requisição) ou viram pedido (`unit.request`), e a resposta da pessoa a
  executa relendo a declaração.
- **Auditoria:** leitura vira linha `plugin-request`; escrita, `plugin-write` por
  `audited` (espaço de trabalho de teste recusa). Nunca a chave, o corpo ou a busca.
- Configuração obrigatória vazia: o plugin não roda, com o motivo.

## Testes

`test/plugin-requests.test.ts` (declaração, conferência, chamada com `fetch` falso),
`test/plugin-js-sandbox.test.ts` (sandbox real com o Electron em modo Node, pulado onde
não há sandbox), `test/plugins-service.test.ts` (plugin JS: rede, configuração
obrigatória, leitura, escrita que sai, que pede e que é anunciada, configurações e
chave), além dos ajustes em `plugins-core`, `config-transfer` e `web-server`.

## Portões

`npx tsc --noEmit` limpo; `npx vitest run`: tudo passa, exceto arquivos que estouram o
tempo sob carga (`release-git`, `release-script`, `runner-release`, `host-terms-leak`,
`public-audit`), que passam rodados sozinhos (195/195). `theme-audit`, `i18n:lint` e
`public-audit` limpos.

## Não verificado

A tela em uso; uma instância real de SearXNG (é a #97); Windows e macOS (a sandbox só
existe no Linux).
