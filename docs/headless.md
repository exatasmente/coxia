# Núcleo sem desktop / Core without the desktop

[Português](#português) | [English](#english)

---

## Português

O núcleo do Coxia (as cerimônias, o runner, a porta web) roda num processo Node comum, sem Electron, janela nem bandeja. A pessoa o usa pelo navegador, pareando como no celular ([Acesso pelo navegador](configuration.md)). Não foi verificado em produção: foi testado em processo, contra pastas temporárias, e com o pacote compilado numa máquina Linux.

### Compilar e rodar

```bash
npm ci
npx electron-vite build      # o renderer que a porta web serve (out/renderer)
npm run build:headless       # out/headless/coxia.mjs
node out/headless/coxia.mjs --data-dir /var/lib/coxia --master-key-file /etc/coxia/master.key --port 4330
```

O pacote reúne o código do próprio app; as dependências do npm ficam fora e são lidas do `node_modules` ao lado (`@anthropic-ai/claude-agent-sdk` e o `zod` que ele traz; o `electron-updater` nunca é carregado). `scripts/headless-smoke.mjs` sobe o pacote uma vez numa pasta temporária e confere `/healthz` e a saída 0.

### Opções

| Opção | Variável | O que faz |
|---|---|---|
| `--data-dir <pasta>` | `COXIA_DATA_DIR` (ou `CERIMONIAS_DATA_DIR`) | A pasta de dados. **Obrigatória:** um serviço não cai na pasta do desktop por esquecimento. |
| `--master-key-file <arquivo>` | `COXIA_MASTER_KEY_FILE` | A chave mestra dos segredos guardados. **Obrigatória.** |
| `--port <porta>` | `COXIA_PORT` | A porta da porta web (1024 a 65535). **Obrigatória.** |
| `--host <endereço>` | `COXIA_HOST` | O endereço (IPv4 ou `localhost`). Padrão `127.0.0.1`. |
| `--workspace <id>` | `COXIA_WORKSPACE` | O workspace que este processo roda. Padrão: o que o registro marca como atual. |
| `--renderer-dir <pasta>` | `COXIA_RENDERER_DIR` | O renderer compilado. Padrão: `out/renderer` ao lado do pacote; sem ele a porta responde a API e nenhuma página. |

### A chave mestra

Sem o desktop não há chaveiro do sistema. Os segredos (`secrets.json`) são cifrados com uma chave de 32 bytes, escrita como 64 dígitos hexadecimais e uma quebra de linha, num arquivo com modo `0600` (`umask 077; openssl rand -hex 32 > master.key`), **fora da pasta de dados** (a pasta é copiada e movida; a chave não vai junto). O arquivo é conferido a cada uso e o processo **não sobe** se ele faltar, estiver legível por outros, for um link ou estiver dentro da pasta de dados. Perder a chave é perder os segredos guardados; eles se cadastram de novo.

### Um processo por workspace

Um processo roda um workspace. Para vários, suba vários processos com `--workspace` e portas diferentes, sobre a mesma pasta de dados. O `--workspace` precisa existir no registro (senão o processo recusa) e **não muda** o workspace atual do registro, que é a escolha do desktop. A bandeira de teste que recusa escritas externas é a do workspace que o processo roda. Trocar de workspace pela tela não existe aqui (`host-unavailable`): é outro processo.

### O endereço web é do processo

`--host` e `--port` valem só para este processo: a porta web fica ligada nesse endereço por cima do que está salvo e **nada é gravado** em `web.json` (que é da pasta de dados, comum a todos os workspaces, e não serve a dois processos na mesma porta). Se um cliente pareado chamar `web:configure`, ligar, desligar ou mudar host e porta não faz nada: a vista devolve `addressFixed: true`, a tela de Acesso pelo navegador diz isso e desabilita esses campos. Os outros campos (caminho base, endereço público, proxy confiável, efeitos externos) são salvos como sempre, e o caminho base vale na hora. Atrás de um proxy, ajuste o endereço público nessa tela, ou no desktop.

### Saúde

`GET <caminho base>/healthz` (padrão `/cerimonias/healthz`) responde sem autenticação `{"ok":true,"version":"…","workspace":"<id>"}`: só isso, sem nome nem caminho. Serve ao gerenciador de serviço e à verificação de saúde de uma atualização.

### Sinais e saída

SIGTERM e SIGINT param o núcleo (timers, porta web, voz, etapa em andamento com prazo de 10 s) e saem com 0; um segundo sinal sai na hora. Falha ao subir (opção ou chave inválida, workspace desconhecido, porta ocupada) sai com 1, com a causa em stderr. Ao ficar pronto, uma linha em stdout traz o endereço e o workspace, sem segredo. Exemplo de unidade do systemd:

```ini
[Service]
ExecStart=/usr/bin/node /opt/coxia/out/headless/coxia.mjs --data-dir /var/lib/coxia --master-key-file /etc/coxia/master.key --workspace principal --port 4330
Restart=on-failure
```

### O que falta

Sem desktop não há diálogo de arquivo, troca de workspace pela tela nem tela virtual do agente (`host-unavailable`). O processo não se atualiza sozinho. Os modos de atualização e a instalação do serviço não fazem parte disto.

---

## English

The Coxia core (the ceremonies, the runner, the web door) runs in a plain Node process, with no Electron, window or tray. The person uses it from a browser, paired as with the phone ([Browser access](configuration.md)). Not verified in production: it was tested in process against temporary folders, and with the built bundle on a Linux machine.

### Build and run

```bash
npm ci
npx electron-vite build      # the renderer the web door serves (out/renderer)
npm run build:headless       # out/headless/coxia.mjs
node out/headless/coxia.mjs --data-dir /var/lib/coxia --master-key-file /etc/coxia/master.key --port 4330
```

The bundle holds the app's own code; npm dependencies stay outside and are read from the `node_modules` next to it (`@anthropic-ai/claude-agent-sdk` and the `zod` it brings; `electron-updater` is never loaded). `scripts/headless-smoke.mjs` starts the bundle once in a temporary folder and checks `/healthz` and the exit 0.

### Options

| Option | Variable | What it does |
|---|---|---|
| `--data-dir <dir>` | `COXIA_DATA_DIR` (or `CERIMONIAS_DATA_DIR`) | The data folder. **Required:** a service never falls back to the desktop's folder by a forgotten flag. |
| `--master-key-file <file>` | `COXIA_MASTER_KEY_FILE` | The master key of the stored secrets. **Required.** |
| `--port <port>` | `COXIA_PORT` | The web door's port (1024 to 65535). **Required.** |
| `--host <address>` | `COXIA_HOST` | The address (IPv4 or `localhost`). Default `127.0.0.1`. |
| `--workspace <id>` | `COXIA_WORKSPACE` | The workspace this process runs. Default: the one the registry marks as current. |
| `--renderer-dir <dir>` | `COXIA_RENDERER_DIR` | The built renderer. Default: `out/renderer` next to the bundle; without it the door answers the API and no page. |

### The master key

Without the desktop there is no OS keychain. Secrets (`secrets.json`) are encrypted with a 32-byte key, written as 64 hex digits and a newline, in a file with mode `0600` (`umask 077; openssl rand -hex 32 > master.key`), **outside the data folder** (the folder is copied and moved; the key must not go with it). The file is checked on every use and the process **does not start** when it is missing, readable by others, a link, or inside the data folder. Losing the key loses the stored secrets; they are entered again.

### One process per workspace

A process runs one workspace. For several, start several processes with `--workspace` and different ports over the same data folder. The `--workspace` must exist in the registry (the process refuses otherwise) and does **not** change the registry's current workspace, which is the desktop's choice. The test flag that refuses external writes is the one of the workspace the process runs. Switching workspace from a screen does not exist here (`host-unavailable`): it is another process.

### The web address belongs to the process

`--host` and `--port` apply to this process alone: the web door listens at that address over what is saved, and **nothing is written** to `web.json` (which lives in the data folder, shared by every workspace, and cannot serve two processes on one port). If a paired client calls `web:configure`, switching the door on or off or changing host and port does nothing: the view carries `addressFixed: true`, and the Browser access screen says so and disables those fields. The other fields (base path, public address, trusted proxy, external effects) are saved as usual, and the base path takes effect at once. Behind a proxy, set the public address on that screen, or on the desktop.

### Health

`GET <base path>/healthz` (default `/cerimonias/healthz`) answers without authentication `{"ok":true,"version":"…","workspace":"<id>"}`: nothing else, no name, no path. It is for the service manager and an update's health check.

### Signals and exit

SIGTERM and SIGINT stop the core (timers, web door, voice, a running stage within a 10 s deadline) and exit 0; a second signal leaves at once. A failure to start (a bad option or key, an unknown workspace, a taken port) exits 1 with the cause on stderr. When ready, one line on stdout names the address and the workspace, no secret. A systemd unit, for example:

```ini
[Service]
ExecStart=/usr/bin/node /opt/coxia/out/headless/coxia.mjs --data-dir /var/lib/coxia --master-key-file /etc/coxia/master.key --workspace principal --port 4330
Restart=on-failure
```

### What is missing

Without the desktop there is no file dialog, no workspace switch from a screen and no agent virtual screen (`host-unavailable`). The process does not update itself. Update modes and installing the service are not part of this.
