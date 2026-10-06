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
| `offers.write` | a escrita externa: `{ "to": "<nome>", "reversible": true\|false }`, para a caixa de saída do plugin neste espaço de trabalho (um destino neutro, nunca um serviço de terceiro). Sem `reversible`, conta como irreversível |
| `offers.entry` | script de shell da pasta do plugin, rodado quando um acontecimento observado acontece; o aplicativo lê o texto dele e o entrega à sandbox como o próprio comando (a pasta não é montada), com o acontecimento em `$1`; o que ele imprime é o resultado |

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

- O script do plugin roda dentro da **mesma** sandbox que o aplicativo já dá a uma etapa, entregue como o próprio
  comando (a pasta do plugin não é montada). Sem rede por padrão; com a permissão, a rede alcança **só** os
  destinos que o plugin declarou — não os que o espaço de trabalho libera para as etapas. Não existe uma sandbox
  própria do plugin.
- O que o plugin pode alcançar está declarado nele e é dito na lista de plugins (Configurações → Plugins); o que
  não estiver declarado é recusado, com o motivo.
- O que o plugin imprime vira o documento que ele declarou na pasta do ciclo da execução, escrito pelo
  aplicativo pelo mesmo caminho dos documentos de uma etapa.
- Um plugin nunca escreve por conta própria: a escrita declarada sai pela porta única de Ações, só com a
  permissão, e entra no registro de auditoria. Num espaço de trabalho de teste nada é pedido e nada sai.

### As permissões

- Um plugin que precisa de rede ou de escrita e não tem permissão abre um **pedido** em Ações. A pessoa responde
  **uma vez** (só aquele pedido), **nesta sessão** (até o aplicativo fechar), **sempre** (fica na lista de
  permissões do plugin) ou **recusar**.
- Enquanto um pedido de uma execução espera, a execução não começa a etapa seguinte. Uma recusa não derruba a
  execução: o plugin não roda (ou a escrita não sai), e a conversa da execução diz por quê. O plugin volta a
  pedir enquanto não tiver "sempre".
- Uma escrita **irreversível** só aceita "sempre" (acrescentar à lista) ou recusar. Já permitida, cada vez que vai
  sair ela é **anunciada** em Ações com uma contagem (`plugins.confirmSeconds`, 30 s por padrão); nesse intervalo a
  pessoa pode **bloquear** (só aquela vez) ou **revogar** (aquela vez e a permissão).
- "Sempre" sobrevive a desligar e religar o plugin e não viaja numa exportação de configuração; uma importação
  mantém a lista do espaço de trabalho de destino. Retirar é na lista de plugins, no computador.
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
| `offers.write` | the external write: `{ "to": "<name>", "reversible": true\|false }`, to the plugin's outbox in this workspace (a neutral destination, never a third-party service). Without `reversible`, it counts as irreversible |
| `offers.entry` | a shell script of the plugin folder, run when an observed event happens; the app reads its text and hands it to the sandbox as the command itself (the folder is not mounted), with the event as `$1`; what it prints is its result |

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

- The plugin script runs inside the **same** sandbox the app already gives a stage, handed over as the command
  itself (the plugin folder is not mounted). No network by default; with the permission, the network reaches
  **only** the destinations the plugin declared — not the ones the workspace lets its stages reach. There is no
  sandbox of the plugin's own.
- What a plugin may reach is declared in it and is said in the plugin list (Settings → Plugins); whatever is not
  declared is refused, with the reason.
- What the plugin prints becomes the document it declared in the run's cycle folder, written by the app through
  the same path as the documents of a stage.
- A plugin never writes by itself: its declared write goes out through the single door of Actions, only with the
  permission, and lands in the audit log. In a test workspace nothing is asked and nothing goes out.

### The permissions

- A plugin that needs the network or its write and was not allowed opens a **request** in Actions. The person
  answers **once** (that request only), **for this session** (until the app closes), **always** (it stays in the
  plugin's list of permissions) or **refuse**.
- While a request of a run waits, the run does not start its next stage. A refusal does not bring the run down:
  the plugin does not run (or the write does not go out), and the run's conversation says why. The plugin keeps
  asking until it has "always".
- An **irreversible** write only takes "always" (add to the list) or refuse. Once allowed, every time it is about
  to go out it is **announced** in Actions with a countdown (`plugins.confirmSeconds`, 30 s by default); meanwhile
  the person may **block** it (that time only) or **revoke** it (that time and the permission).
- "Always" survives switching the plugin off and on and does not travel in a configuration export; an import
  keeps the list of the target workspace. Taking it back is in the plugin list, on the computer.
- Text that comes from a plugin enters as material, between the markers the app already uses; none of it is
  treated as instruction.
- Widening what a plugin may reach is the person's decision, on the computer; a paired browser neither turns a
  plugin on or off nor widens it. Where this kit shows a permission, it also shows what is refused without it.
