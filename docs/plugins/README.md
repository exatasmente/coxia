# O kit de plugins / The plugin kit

[Português](#português) | [English](#english)

---

## Português

Coxia aceita plugins: cada plugin é uma pasta com uma declaração (`plugin.json`) e, quando observa um
acontecimento, um script. O plugin é código da equipe — não se baixa nem se instala nada. A plataforma lê a
declaração, confere que ela é válida e liga o que ela oferece. Um plugin desligado não oferece nada e não é
executado.

- A pasta de plugins do espaço de trabalho: a seção `plugins` da configuração (`plugins.dir`), com a lista
  do que está ligado e as permissões. Veja [`configuration.md`](../configuration.md).
- O contrato, os tipos de tudo o que atravessa a fronteira e a lista fixa de acontecimentos:
  [`src/shared/plugins/`](../../src/shared/plugins/) (`declaration.ts`, `events.ts`).
- O exemplo que compila e roda, base da primeira entrega (busca na web para os agentes):
  [`example-web-search/`](example-web-search/).

### O contrato

Um plugin publica `plugin.json`:

| Campo | O que é |
|---|---|
| `id` | identidade estável (letras minúsculas, dígitos, `.` e `-`) |
| `name` | nome mostrado à pessoa |
| `contract` | versão de contrato que o plugin segue (esta entrega entende a `1`) |
| `offers.events` | acontecimentos observados, da lista fixa |
| `offers.documents` | tipos de documento novos do ciclo (`name`, `label`) |
| `offers.network` | destinos que o plugin declara precisar, por nome de host |
| `offers.write` | destino neutro da escrita externa (um exemplo, nunca um serviço de terceiro) |
| `offers.entry` | script rodado quando um acontecimento observado acontece, dentro da pasta do plugin |

A leitura é uma função pura: o mesmo caminho roda no Linux, no macOS e no Windows, e nada no plugin depende de
um carregador de biblioteca nativa.

### Os acontecimentos

Lista fixa e pública:

- `stage-entered` — uma etapa do ciclo entrou;
- `stage-finished` — uma etapa do ciclo terminou;
- `gate-decided` — um gate foi decidido;
- `run-finished` — uma execução terminou.

Um acontecimento fora da lista é recusado com o motivo. Isto não é o canal de interface entre a janela e o
navegador pareado: é um ponto de extensão à parte.

O aplicativo dispara cada um no lugar onde ele já acontece: `stage-entered` quando uma execução entra numa
etapa, `stage-finished` quando uma etapa conclui, `gate-decided` quando a pessoa decide um gate e `run-finished`
quando uma execução termina. Um plugin que falha não derruba a execução nem o aplicativo.

### A fronteira

- O script do plugin roda dentro da **mesma** sandbox que o aplicativo já dá a uma etapa: sem rede por padrão e
  com a rede só para os destinos que a pessoa listou para o espaço de trabalho. Não existe uma sandbox própria
  do plugin.
- O que o plugin pode alcançar está declarado nele e é dito na lista de plugins; o que não estiver declarado é
  recusado, com o motivo.
- Um plugin nunca escreve por conta própria: ele descreve o pedido, e o pedido entra na porta única de Ações,
  espera o "sim" e entra no registro de auditoria. Num espaço de trabalho de teste a confirmação é recusada.
- Texto que vem de um plugin entra como material, entre as marcas que o aplicativo já usa; nada dele é tratado
  como instrução.
- Ampliar o que um plugin alcança é decisão da pessoa, no computador; um navegador pareado não liga, desliga nem
  amplia. Onde este kit mostra uma permissão, mostra também o que é recusado sem ela.

---

## English

Coxia accepts plugins: each plugin is a folder with a declaration (`plugin.json`) and, when it observes an event,
a script. A plugin is the team's own code — nothing is downloaded or installed. The platform reads the
declaration, checks that it is valid and turns on what it offers. A plugin that is off offers nothing and is not
run.

- The workspace's plugins folder: the `plugins` section of the configuration (`plugins.dir`), with the list of
  what is on and the permissions. See [`configuration.md`](../configuration.md).
- The contract, the types of everything that crosses the boundary and the fixed list of events:
  [`src/shared/plugins/`](../../src/shared/plugins/) (`declaration.ts`, `events.ts`).
- The example that compiles and runs, the base of the first delivery (web search for the agents):
  [`example-web-search/`](example-web-search/).

### The contract

A plugin publishes `plugin.json`:

| Field | What it is |
|---|---|
| `id` | stable identity (lowercase letters, digits, `.` and `-`) |
| `name` | name shown to the person |
| `contract` | contract version the plugin follows (this delivery understands `1`) |
| `offers.events` | events it observes, from the fixed list |
| `offers.documents` | new cycle document types (`name`, `label`) |
| `offers.network` | destinations the plugin declares it needs, by host name |
| `offers.write` | neutral destination of the external write (an example, never a third-party service) |
| `offers.entry` | script run when an observed event happens, inside the plugin folder |

The reading is a pure function: the same path runs on Linux, macOS and Windows, and nothing in the plugin
depends on a native library loader.

### The events

Fixed and public list:

- `stage-entered` — a cycle stage was entered;
- `stage-finished` — a cycle stage finished;
- `gate-decided` — a gate was decided;
- `run-finished` — a run finished.

An event outside the list is refused with the reason. This is not the interface channel between the window and
the paired browser: it is a separate extension point.

The app fires each one where it already happens: `stage-entered` when a run enters a stage, `stage-finished`
when a stage concludes, `gate-decided` when the person decides a gate and `run-finished` when a run finishes. A
plugin that fails brings down neither the run nor the app.

### The boundary

- The plugin script runs inside the **same** sandbox the app already gives a stage: no network by default and
  the network only for the destinations the person listed for the workspace. There is no sandbox of the plugin's
  own.
- What a plugin may reach is declared in it and is said in the plugin list; whatever is not declared is refused,
  with the reason.
- A plugin never writes by itself: it describes the request, and the request goes into the single door of
  Actions, waits for the "yes" and lands in the audit log. In a test workspace the confirmation is refused.
- Text that comes from a plugin enters as material, between the markers the app already uses; none of it is
  treated as instruction.
- Widening what a plugin may reach is the person's decision, on the computer; a paired browser neither turns a
  plugin on or off nor widens it. Where this kit shows a permission, it also shows what is refused without it.
