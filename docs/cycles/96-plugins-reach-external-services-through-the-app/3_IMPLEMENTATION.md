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

## Revisão e o que mudou por ela

A revisão (sessão separada, só leitura) pediu mudanças. Tratados:

- **B1, esquema.** A beta.7 saiu com o esquema 14 enquanto isto era feito. A branch
  trouxe a `release/0.7.0` (beta.7), e as configurações entraram no degrau `v14ToV15`
  (`settings` em cada plugin), com os testes da versão e `configuration.md`.
- **B2, destino privado.** Uma requisição declarada com endereço fixo só aceita nome
  público: nada de IP, `localhost` ou nome local, recusado já na declaração. O `fetch`
  foi trocado por um transporte `http`/`https` com consulta de DNS própria, que recusa
  endereço privado no endereço de fato conectado (cobre DNS rebinding e IP literal). Só
  um destino vindo de uma configuração preenchida pela pessoa alcança endereço local.
- **B3, método.** Só `GET` é leitura; outro método sem `"write": true` é recusado na
  declaração, e a leitura recusa um método que não seja `GET`.
- **C1:** uma escrita só sai para o destino que a pessoa viu; se a declaração ou a
  configuração mudou, ela é recusada, e a auditoria grava o destino calculado.
- **C2:** URL com usuário ou senha é recusada ao salvar.
- **C3:** `%2f`, `%5c`, `%00` e `%25` são recusados no caminho.
- **C4:** a permissão "sempre" agora vale só para o que o plugin declarava quando foi
  dada (`allowedFor`, um resumo dos hosts, das requisições e da escrita); outra
  declaração volta a pedir. A tela mostra para onde cada chave vai. A chave continua
  por plugin, comum aos espaços de trabalho: fica registrado como limite.
- **C5:** num espaço de trabalho de teste, nenhuma leitura de plugin sai.
- **C6:** a chave é retirada da resposta crua, no formato declarado, codificada em URL
  e escapada em JSON.
- **C7:** duas escritas diferentes do mesmo id viram dois pedidos.
- **C8:** exemplo em JavaScript no kit (`docs/plugins/example-notify/`).
- **C9:** testes para cada um dos itens acima, mais um teste do transporte real contra
  um servidor local (loopback recusado sem configuração, redirecionamento não seguido).
- Sugestões tratadas: configuração obrigatória conferida antes de pedir permissão; o
  guia explica o custo de `await` em sequência; o id que o plugin manda é cortado nas
  mensagens; comentários fora do lugar.

Ficam registradas, sem tratar nesta entrega: um token no caminho de uma URL de
configuração aparece no destino da auditoria e do pedido (S3); a escrita anunciada não
leva o plugin como autor na auditoria (S6); e a chave não está ligada ao espaço de
trabalho (C4, parte).
