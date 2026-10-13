# Contrato dos clientes / The client contract

[Português](#português) | [English](#english)

---

## Português

Todo cliente do Coxia (a janela do desktop, o navegador pareado, o celular e os que vierem) fala o **mesmo contrato** com uma instância. O contrato está em `src/shared/contract.ts`, sem nada do processo principal, para qualquer cliente poder importá-lo.

### O que o contrato diz

- **Os canais.** `CHANNELS` lista todos os canais que a instância registra (os do núcleo, os dos dispositivos do navegador e os dois da janela do desktop). Um teste (`test/contract.test.ts`) sobe o núcleo e falha quando a instância registra um canal que não está na lista, e quando a lista traz um que ninguém registra.
- **Entrada e saída.** Os canais que os métodos tipados de `Api` já nomeiam (`src/shared/apiChannels.ts`) e o `contract:hello` têm tipo de entrada e de saída (`Input<C>`, `Output<C>`). Os outros estão na lista com `unknown`, até serem tipados um a um; `TYPED_CHANNELS` diz quais já têm tipo.
- **Erros.** Uma chamada que falha responde `{ code, message }`. O `code` vem de uma lista fechada (`ERROR_CODES`) e é para o programa; o `message` é o texto traduzido, só para mostrar. Uma classe de erro com código da lista o mantém (os códigos de um domínio vêm com o domínio na frente: `sandbox:unavailable`, `runner:bad-ref`); qualquer outra falha vira `internal`. Na porta HTTP o corpo é `{ error, code }`.
- **A versão.** `CONTRACT_VERSION` sobe quando um canal muda de um jeito que um cliente antigo não acompanha (canal removido ou renomeado, forma diferente de entrada ou saída, código de erro novo que o cliente precisa tratar).

### A conversa de versão

- **Na janela do desktop (IPC)**, ao abrir, a janela chama `contract:hello(versão)`. A instância responde `{ version }` quando as versões batem e recusa com `contract-mismatch` quando não, com as duas versões na mensagem; a janela então mostra a recusa no lugar do app. O IPC do Electron só leva a mensagem de um erro lançado, então o processo principal responde cada chamada como `{ ok, value }` ou `{ ok: false, error: { code, message } }` e a ponte da janela devolve o erro com o código.
- **No navegador (HTTP)**, toda chamada leva o cabeçalho `X-Coxia-Contract` com a versão em que a página foi construída. A instância recusa com **409** e `contract-mismatch` uma versão diferente, com as duas na mensagem, antes de qualquer outra coisa. Uma requisição **sem** o cabeçalho passa: é uma página de antes do contrato (ou o fluxo de eventos, que o navegador não deixa marcar), e recusá-la trancaria todo celular que guardou a página antes desta versão.
- **O que cada um pode fazer continua sendo da instância** (`src/main/webPolicy.ts`), não do cliente. `contract:hello` está aberto a todo navegador pareado.

### O que não foi verificado

O contrato foi testado contra o servidor HTTP e o registro de canais reais, sem a janela do Electron nem um celular pareado. A ponte da janela (o `contextBridge` entregando o código do erro) não rodou num Electron de verdade.

---

## English

Every Coxia client (the desktop window, a paired browser, the phone, and any that come next) speaks the **same contract** to an instance. It lives in `src/shared/contract.ts`, with nothing from the main process, so any client can import it.

### What the contract says

- **The channels.** `CHANNELS` lists every channel the instance registers (the core's, the browser devices', and the desktop window's two). A test (`test/contract.test.ts`) starts the core and fails when the instance registers a channel that is not in the list, and when the list names one nobody registers.
- **Input and output.** The channels that the typed `Api` methods already name (`src/shared/apiChannels.ts`) and `contract:hello` have an input and an output type (`Input<C>`, `Output<C>`). The others are in the list with `unknown` until each is typed; `TYPED_CHANNELS` says which ones already are.
- **Errors.** A call that fails answers `{ code, message }`. The `code` comes from a closed list (`ERROR_CODES`) and is for programs; the `message` is the translated text, for display only. An error class with a code in the list keeps it (a domain's codes come with the domain in front: `sandbox:unavailable`, `runner:bad-ref`); any other failure becomes `internal`. On the HTTP door the body is `{ error, code }`.
- **The version.** `CONTRACT_VERSION` goes up when a channel changes in a way an older client cannot follow (a removed or renamed channel, a different shape of an input or output, a new error code a client must handle).

### The version exchange

- **In the desktop window (IPC)**, at start the window calls `contract:hello(version)`. The instance answers `{ version }` when the versions match and refuses with `contract-mismatch` when they do not, with both versions in the message; the window then shows the refusal in place of the app. Electron's IPC carries only the message of a thrown error, so the main process answers every call as `{ ok, value }` or `{ ok: false, error: { code, message } }` and the window's bridge gives the error back with its code.
- **In the browser (HTTP)**, every call carries the `X-Coxia-Contract` header with the version the page was built with. The instance refuses a different version with **409** and `contract-mismatch`, both versions in the message, before anything else. A request **without** the header is let through: it is a page from before the contract (or the event stream, which a browser cannot add headers to), and refusing it would lock out every phone that cached its page before this version.
- **What each caller may do stays the instance's decision** (`src/main/webPolicy.ts`), not the client's. `contract:hello` is open to every paired browser.

### What was not verified

The contract was tested against the real HTTP server and the real channel registry, without the Electron window or a paired phone. The window's bridge (`contextBridge` handing over the error code) did not run in a real Electron.
