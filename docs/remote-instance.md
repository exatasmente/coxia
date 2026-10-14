# Desktop em uma instância remota / Desktop on a remote instance

[Português](#português) | [English](#english)

---

## Português

O desktop pode rodar o núcleo neste computador, como sempre, ou ser **cliente** de uma instância do Coxia em um servidor (uma VPS, uma nuvem). A instância do servidor escuta só em `localhost`; o desktop chega a ela por um túnel SSH, com uma chave que ele guarda como segredo. Nada de administração fica exposto à internet, e a página continua sendo um contexto seguro (microfone e passkeys funcionam). Um endereço público para o celular, atrás de TLS, vem depois, quando a instância tiver domínio. Não foi verificado contra um servidor SSH real: foi testado com um `ssh` de mentira que encaminha o soquete para o núcleo de um processo de teste.

### Como funciona

O processo do servidor (`out/headless/coxia.mjs`, [núcleo sem desktop](headless.md)) abre o **soquete de administração** do workspace (`<pasta de dados>/workspaces/<id>/admin.sock`). O desktop chega a ele de um de dois modos (`via`, escolhido ao adicionar a instância):

- **`server`** (o padrão): é o modo de uma VPS montada com o `coxia-server`. O soquete é `0600` e pertence ao usuário de serviço (`coxia`, sem login), e o usuário SSH é o **usuário administrador**, que não o abre. O desktop roda `ssh -T … usuario@host coxia-server bridge <workspace>`; o `bridge` conecta ao soquete como o usuário de serviço e copia bytes nos dois sentidos entre o soquete e o stdin/stdout do `ssh`. A pasta de dados no servidor não é usada neste modo. O id do workspace é validado (letras minúsculas, dígitos e hífens) porque o `ssh` junta os argumentos com espaços para o shell remoto.
- **`socket`**: para um núcleo sem desktop rodado pelo próprio usuário SSH. O desktop roda `ssh -N -L <soquete local temporário>:<soquete do servidor>`. Entradas salvas antes da escolha existir continuam neste modo.

Nos dois, o desktop fala o protocolo da porta de administração (inalterado): um `hello` com a versão do contrato, chamadas com `id` e os eventos. Cada chamada da janela vai para a instância, com os direitos da janela (o modelo de confiança da porta: quem chega ao soquete é o usuário que roda o núcleo). Os eventos da instância voltam como eventos da janela. Gravações de voz (`voice:transcribe`) e outros valores binários cruzam a porta como `{ "$bytes": "<base64>" }`, a mesma codificação da porta web; só valores com essa marca são decodificados.

Enquanto uma instância remota está escolhida, **nada do núcleo roda neste computador**: o desktop não cria nem inicia o núcleo, e todos os canais, menos os da própria janela (área de transferência, notificações, lista de instâncias), vão para o servidor. O que a janela mostra (workspaces, configuração, o runner) é o da instância.

### Escolher a instância

Configurações › Configurações e workspaces › **Instâncias**: a lista (este computador e os servidores), adicionar, testar a conexão, usar e remover. Escolher uma instância reinicia o app, como trocar de workspace; voltar para "Este computador" também. Não precisa reinstalar nada. A lista fica em `<pasta de dados>/instances.json` (0600), sem a chave: só o nome do segredo (`instance.<id>.ssh-key`) no cofre de segredos deste computador, guardado, lido de uma variável de ambiente ou obtido de um comando (`cat ~/.ssh/id_ed25519`).

Cada servidor tem: nome, endereço SSH (`usuario@host` ou `usuario@host:porta`; no modo `server`, o usuário administrador), como chegar nele (`server` ou `socket`), a pasta de dados no servidor (padrão `/var/lib/coxia/data`; só o modo `socket` a usa), o id do workspace e a chave.

### Chave do servidor (host key)

A verificação é estrita (`StrictHostKeyChecking=yes`, com um `known_hosts` próprio do app em `<pasta de dados>/instances/known_hosts`, sem ler o `~/.ssh` nem a configuração do usuário). Na primeira conexão, "Testar conexão" mostra a **impressão digital** das chaves que o servidor apresenta; compare com a que o dono do servidor informar e só então confie. Se a chave mudar depois, o ssh recusa, e o app não a aceita sozinho.

### Estado da conexão e perda de conexão

Uma faixa no canto da janela diz a qual instância ela está conectada, se o enlace está conectado, reconectando ou perdido, e se a instância é a **dona** do workspace ou uma cliente (`ownership:status`, [propriedade do workspace](headless.md)). Quando o enlace cai, o desktop reconecta sozinho, com espera crescente (1 s até 30 s). **Uma chamada em andamento quando o enlace cai falha com `connection-lost` e não é reenviada**: ela pode ou não ter rodado no servidor, e a mensagem diz para conferir antes de repetir. Uma chamada feita com o enlace caído falha na hora, sem enfileirar. Ao reconectar, a janela relê o que mostra (o mesmo evento que um navegador pareado usa quando o fluxo volta). A chave privada vira um arquivo temporário `0600` só para o processo `ssh`, apagado assim que o túnel abre (modo `socket`) ou que o `hello` é respondido (modo `server`, que não tem arquivo de soquete para esperar), ou quando o processo termina.

### Limites

- O que escolhe um arquivo ou abre uma janela do sistema (importar, escolher pasta) roda no servidor, que não tem janela: responde `host-unavailable`.
- A atualização do app é a do servidor, não a deste desktop, enquanto ele é cliente.
- Só `ssh`, `ssh-keyscan` e `ssh-keygen` do sistema; sem `ProxyJump` nem opções do `~/.ssh/config`.

---

## English

The desktop can run the core on this computer, as before, or be a **client** of a Coxia instance on a server (a VPS, a cloud). The server's instance listens on `localhost` only; the desktop reaches it through an SSH tunnel with a key it holds as a secret. Nothing admin is exposed to the internet and the page stays a secure context (the microphone and passkeys work). A public web address for the phone, behind TLS, comes later, once the instance has a domain. Not verified against a real SSH server: it was tested with a fake `ssh` that forwards the socket to the core of a test process.

### How it works

The server process (`out/headless/coxia.mjs`, [the core without the desktop](headless.md)) opens the workspace's **admin socket** (`<data dir>/workspaces/<id>/admin.sock`). The desktop reaches it in one of two ways (`via`, chosen when the instance is added):

- **`server`** (the default): the mode for a VPS set up with `coxia-server`. The socket is `0600` and belongs to the service user (`coxia`, no login), and the SSH user is the **admin user**, who cannot open it. The desktop runs `ssh -T … user@host coxia-server bridge <workspace>`; the `bridge` connects to the socket as the service user and copies bytes both ways between the socket and the `ssh` child's stdin/stdout. The data folder on the server is not used in this mode. The workspace id is validated (lowercase letters, digits and hyphens) because `ssh` joins the arguments with spaces for the remote shell.
- **`socket`**: for a core without the desktop run by the SSH user itself. The desktop runs `ssh -N -L <temporary local socket>:<the server's socket>`. Entries saved before the choice existed stay in this mode.

In both, the desktop speaks the admin door's protocol (unchanged): a `hello` with the contract version, id-matched calls, and events. Every call of the window goes to the instance with the window's rights (the door's trust model: whoever reaches the socket is the user the core runs as). The instance's events come back as events of the window. Voice recordings (`voice:transcribe`) and other binary values cross the door as `{ "$bytes": "<base64>" }`, the web door's encoding; only values carrying that marker are decoded.

While a remote instance is selected, **nothing of the core runs on this computer**: the desktop neither creates nor starts the core, and every channel but the window's own (clipboard, notifications, the list of instances) goes to the server. What the window shows (workspaces, configuration, the runner) is the instance's.

### Choosing the instance

Settings › Configuration and workspaces › **Instances**: the list (this computer and the servers), add, test the connection, use and remove. Choosing an instance relaunches the app, like switching workspace; going back to "This computer" does too. Nothing to reinstall. The list is in `<data dir>/instances.json` (0600) and never holds the key: only the name of the secret (`instance.<id>.ssh-key`) in this computer's secrets store, stored, read from an environment variable or obtained from a command (`cat ~/.ssh/id_ed25519`).

Each server has a name, an SSH address (`user@host` or `user@host:port`; in `server` mode, the admin user), how to reach it (`server` or `socket`), the data folder on the server (default `/var/lib/coxia/data`; only `socket` mode uses it), the workspace id and the key.

### Host key

Checking is strict (`StrictHostKeyChecking=yes`, with the app's own `known_hosts` in `<data dir>/instances/known_hosts`; neither `~/.ssh` nor the user's configuration is read). On the first connection, "Test connection" shows the **fingerprint** of the keys the server presents; compare it with the one the server's owner gives you, and only then trust it. If the key changes later, ssh refuses and the app does not accept it by itself.

### Connection state and loss

A bar in the corner of the window says which instance it is connected to, whether the link is connected, reconnecting or lost, and whether that instance **owns** the workspace or is a client (`ownership:status`, [workspace ownership](headless.md)). When the link drops, the desktop reconnects by itself with a growing wait (1 s up to 30 s). **A call in flight when the link drops fails with `connection-lost` and is not sent again**: it may or may not have run on the server, and the message says to check before repeating. A call made while the link is down fails at once, with no queue. After reconnecting the window reads again what it shows (the same event a paired browser uses when its stream comes back). The private key becomes a temporary `0600` file for the `ssh` process only, removed as soon as the tunnel opens (`socket` mode) or the `hello` is answered (`server` mode, which has no socket file to wait for), or the process ends.

### Limits

- What picks a file or opens a system window (import, choose a folder) runs on the server, which has no window: it answers `host-unavailable`.
- The app update is the server's, not this desktop's, while it is a client.
- Only the system's `ssh`, `ssh-keyscan` and `ssh-keygen`; no `ProxyJump` or options from `~/.ssh/config`.
