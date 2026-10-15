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
| `--public-url <url>` | `COXIA_PUBLIC_URL` | O endereço público **deste processo** (`https://…`, ou `http://` só em `localhost`/`127.0.0.1`). Padrão: o endereço público salvo. A bandeira vale mais que a variável; variável vazia é como ausente; bandeira vazia ou URL inválida é erro de uso (saída 1). Nunca é gravada. |
| `--workspace <id>` | `COXIA_WORKSPACE` | O workspace que este processo roda. Padrão: o que o registro marca como atual. |
| `--no-admin-door` | `COXIA_ADMIN_DOOR=0` | Não abre o soquete de administração. Padrão: aberto. |
| `--init` | | Só cria o registro de workspaces da pasta de dados (com o primeiro workspace), imprime o id dele e sai com 0. Precisa só de `--data-dir`. Para o instalador, antes de o supervisor subir os núcleos. |
| `--import <pasta do pacote>` | | Só importa um pacote de workspace feito por `move:export` e sai (veja [Mover o workspace](#mover-o-workspace-para-outra-máquina)). Precisa de `--data-dir`, `--master-key-file` e `--repos-root <pasta>`, a pasta onde ficam os clones. Não sobe servidor. |
| `--renderer-dir <pasta>` | `COXIA_RENDERER_DIR` | O renderer compilado. Padrão: `out/renderer` ao lado do pacote; sem ele a porta responde a API e nenhuma página. |

### A chave mestra

Sem o desktop não há chaveiro do sistema. Os segredos (`secrets.json`) são cifrados com uma chave de 32 bytes, escrita como 64 dígitos hexadecimais e uma quebra de linha, num arquivo com modo `0600` (`umask 077; openssl rand -hex 32 > master.key`), **fora da pasta de dados** (a pasta é copiada e movida; a chave não vai junto). O arquivo é conferido a cada uso e o processo **não sobe** se ele faltar, estiver legível por outros, for um link ou estiver dentro da pasta de dados. Perder a chave é perder os segredos guardados; eles se cadastram de novo.

### Um processo por workspace

Um processo roda um workspace. Para vários, suba vários processos com `--workspace` e portas diferentes, sobre a mesma pasta de dados. O `--workspace` precisa existir no registro (senão o processo recusa) e **não muda** o workspace atual do registro, que é a escolha do desktop. A bandeira de teste que recusa escritas externas é a do workspace que o processo roda. Trocar de workspace pela tela não existe aqui (`host-unavailable`): é outro processo.

### Um dono por workspace

Um workspace tem **um dono por vez**: só ele roda o runner, o agendador e todo efeito externo. A posse é um arquivo de concessão, `owner.json`, na pasta do workspace: `instanceId`, `host` (o nome da máquina, nada do usuário), `pid`, `startedAt`, `renewedAt` e `expiresAt`. O dono renova a cada 10 s e a concessão vale 30 s. O id da instância é gerado uma vez por pasta de dados e máquina (`instance.json` na raiz), então um processo reiniciado da mesma instância retoma a própria concessão. Um arquivo de trava criado de forma exclusiva (`owner.lock`) serializa a leitura e a escrita: dois processos na mesma máquina não ganham juntos. Em pasta compartilhada entre máquinas a garantia é **de melhor esforço** (criação exclusiva e relógios variam entre sistemas de arquivos): use um dono por pasta.

Dois processos sobre a mesma pasta de dados têm o mesmo id de instância e se distinguem pelo pid: o segundo, com o primeiro vivo, é cliente. Quem abre um workspace que outra instância possui é **cliente**: sobe os canais e as portas (web, administração), mas não o runner nem o agendador, e toda escrita fora da máquina recusa com o código `not-owner`, que nomeia o dono. A linha de pronto do processo e o log dizem quem é; o desktop avisa uma vez. `ownership:status` mostra `owner`, `self`, `expiresAt`, `role` (`owner` ou `client`), `expired` e `handingOver`; um navegador pareado pode ler.

**Passar o workspace.** Na instância dona: `ownership:release` com o `self` da nova (o id da instância e o pid; o dono para a etapa em andamento num ponto seguro, interrompe o que passar do prazo e marca `handingOver`, mantendo a concessão). Na nova: `ownership:claim`: só vale se a concessão foi marcada para ela; ela escreve a própria concessão, passa na verificação de saúde (a configuração lê e a porta web abriu) e só então confirma. O dono antigo só solta depois da confirmação. Se a nova falha na verificação, a concessão volta ao antigo; se a nova não confirma em 60 s, ou ninguém reivindica em 2 min, o antigo retoma o runner. A execução interrompida recomeça na etapa em que estava, no novo dono. Os dois canais são do computador e da porta de administração (`scripts/admin-call.mjs`), nunca de um navegador pareado.

**Concessão expirada.** Se o dono morreu, a instância que sobe não assume sozinha: fica cliente com `expired: true`. Um administrador assume com `ownership:claim`. Na versão atual não há passkey nesse ponto (ela chega com a issue das passkeys; o ponto está marcado no código). Toda reivindicação, passagem, retomada e assunção entra no registro de auditoria (`ownership`).

### Mover o workspace para outra máquina

Um workspace do desktop pode passar a viver num servidor (a ferramenta de provisionamento, `coxia-provision`, conduz isso a partir do computador, pela porta de administração do desktop, ligada pela pessoa). O núcleo faz três coisas, todas só no computador e na porta de administração, nunca num navegador pareado:

1. **Sair.** `ownership:move-out` com `[{ "to": "<descrição do destino, até 200 caracteres>" }]` (por exemplo `vps:hostinger:123`). O dono para o trabalho num ponto seguro, como numa passagem (`ownership:release`), e escreve na concessão `movedOut: { to, at }`: passa a ser **cliente para sempre**. Nenhum temporizador o traz de volta, e uma reinicialização lê a marca na própria concessão e continua cliente (a concessão marcada não expira). Responde o `ownership:status`, que agora traz `movedOut` (`null` enquanto não houve mudança). Recusa com `not-owner` se esta instância não é a dona; repetir com o mesmo `to` só devolve o estado. Entra na auditoria (`ownership move-out`).
2. **Exportar.** `move:export` com `[{ "targetKey": "<64 dígitos hexadecimais>", "out": "<caminho absoluto que não existe>" }]`, só num workspace que saiu (senão `forbidden`). Escreve numa pasta nova (0700; arquivos 0600), montada ao lado e renomeada no fim, de modo que uma falha não deixa meio pacote:

   ```
   manifest.json     format 1, versão do app, versão do contrato, data, workspace, repositórios, segredos, files, bytes
   workspace/        a pasta do workspace, sem owner.json, owner.lock, admin.sock, sandbox/, browser/ nem qualquer *.sock
   registry.json     a entrada do workspace em workspaces.json, como está
   secrets.json      formato de secrets.json (versão 1), só os segredos guardados a que o workspace se refere
   git/<repo>.bundle `git bundle` dos branches das execuções ainda abertas de cada repositório (ausente quando não há)
   ```

   Os segredos a que o workspace se refere são os `secretRef` dos provedores de modelo e dos hosts de código, os das contas externas, os do ambiente de teste e os de cada plugin (`plugin.<id>.*`). Só vão os segredos guardados que a configuração do workspace cita: um segredo guardado que nenhum campo da configuração nomeia não é levado nem listado. Cada segredo **guardado** é lido aqui e **cifrado de novo** com a chave do destino (AES-256-GCM, IV aleatório de 12 bytes, `base64(iv | tag(16) | texto cifrado)`, o formato do arquivo da chave mestra): nada vai em claro. Um segredo `command` ou `env` nomeia algo da máquina antiga e **não vai**: o `manifest.json` o lista em `secrets.notMoved` com o tipo (`command`, `env`, e `missing` ou `unreadable` para uma referência que o cofre não deu) para a pessoa cadastrá-lo de novo. O nome e o e-mail do git vêm de `git config` em cada clone (`null` se não há). **A chave do destino só cifra:** não é registrada, nem auditada, nem guardada, nem repetida numa mensagem de erro. A exportação entra na auditoria sem a chave (`ownership move-export`).
3. **Voltar.** `ownership:claim` na porta de administração (ou na janela) numa concessão com `movedOut` desta mesma instância traz o workspace de volta: passa na verificação de saúde, retoma o runner e o agendador e limpa a marca (auditoria `move-back`). Um navegador pareado, mesmo com passkey, não volta o workspace; outra instância também não o toma.

**A importação, no servidor.** `node out/headless/coxia.mjs --import <pasta do pacote> --data-dir <D> --master-key-file <K> --repos-root <R>` não sobe servidor. Confere o pacote e monta tudo numa pasta temporária dentro de `<D>`; só então coloca no lugar, e desfaz o que já tinha colocado se um passo falha, sem deixar nada pela metade:

- põe `workspace/` em `<D>/workspaces/<id>/` e aponta cada `projects.repos[].path` para `<R>/<id do repositório>` e `projects.roots` para `[<R>]` (os clones são do servidor; `coxia-server import` os cria antes);
- junta `secrets.json` ao `<D>/secrets.json`: cada segredo tem de abrir com a chave mestra `<K>` (senão `bad-key`, e o pacote inteiro é recusado); um que já existe com **outro valor** é recusado com `conflict` (o mesmo valor, ainda que cifrado de novo, é aceito e o que estava lá fica);
- acrescenta a entrada de `registry.json` ao `<D>/workspaces.json` (que é criado se não existe; o workspace atual do registro não muda);
- recusa com `no-remote` um repositório sem endereço remoto, com `newer-format` um pacote de formato mais novo e com `bad-bundle` o que não é um pacote.

Sucesso: saída 0 e uma linha `{"imported":"<id>","repos":[{"id":"app","path":"<R>/app"}]}`. O **mesmo pacote** de novo sai 0 com `"alreadyImported":true` e não escreve nada, mesmo que o workspace tenha mudado desde então (o registro é uma marca do pacote em `<D>/imports/<id>.json`). Outro pacote do mesmo workspace, ou um workspace de mesmo id que já tem trabalho, é `conflict`; o workspace vazio que um `--init` deixou com o mesmo id é substituído. Erro: saída 1 e `<código>: <mensagem>` em stderr.

Uma execução aberta cujo worktree não existe aqui, mas cujo branch está no clone, recebe o worktree de volta quando o dono retoma o trabalho (mesmo nome de pasta, na pasta de worktrees desta máquina); sem o branch continua `worktree-gone`. Fora do escopo (fica como estava no pacote): qualquer outra configuração que nomeie uma pasta da máquina antiga.

### O endereço web é do processo

`--host` e `--port` valem só para este processo: a porta web fica ligada nesse endereço por cima do que está salvo e **nada é gravado** em `web.json` (que é da pasta de dados, comum a todos os workspaces, e não serve a dois processos na mesma porta). Se um cliente pareado chamar `web:configure`, ligar, desligar ou mudar host e porta não faz nada: a vista devolve `addressFixed: true`, a tela de Acesso pelo navegador diz isso e desabilita esses campos. Os outros campos (caminho base, endereço público, proxy confiável, efeitos externos) são salvos como sempre, e o caminho base vale na hora. Atrás de um proxy, ajuste o endereço público nessa tela, ou no desktop.

`--public-url` (ou `COXIA_PUBLIC_URL`) faz o mesmo para o endereço público: o `web.json` é comum a todos os workspaces, e cada processo atrás do proxy tem o seu endereço (por exemplo `https://b.example.com/cerimonias/`). O valor vale **só neste processo**, nunca é gravado e passa pelas mesmas regras do endereço salvo (`https`, ou `http` em `localhost`). Ele é o endereço público em todo lugar onde o processo o lê: a checagem de `Origin` da porta web (que, sem isso, recusa com 403 qualquer origem que não seja o endereço salvo ou `localhost`), as passkeys (a origem aceita e o `rpId`, que é o host dela), o link e o endereço de pareamento e o assunto do push. A linha de pronto ganha uma linha `endereço público: <url>`. O caminho da URL não é conferido com o caminho base: quem decide a relação é o proxy. Se um cliente chamar `web:configure` com `publicUrl`, o valor é descartado e o do servidor continua valendo (o salvo fica como estava, para o desktop e os outros workspaces); os outros campos são salvos como sempre. `web:view` devolve o valor efetivo em `settings.publicUrl` e `publicUrlFixed: true`, e a tela mostra o campo desabilitado com um aviso.

### Saúde

`GET /healthz`, e também `GET <caminho base>/healthz` (padrão `/cerimonias/healthz`), responde sem autenticação `{"ok":true,"version":"…","workspace":"<id>"}`: só isso, sem nome nem caminho. Serve ao gerenciador de serviço e à verificação de saúde de uma atualização.

### Sinais e saída

SIGTERM e SIGINT param o núcleo (timers, porta web, voz, etapa em andamento com prazo de 10 s) e saem com 0; um segundo sinal sai na hora. Falha ao subir (opção ou chave inválida, workspace desconhecido, porta ocupada) sai com 1, com a causa em stderr. Ao ficar pronto, uma linha em stdout traz o endereço e o workspace, sem segredo. Exemplo de unidade do systemd:

```ini
[Service]
ExecStart=/usr/bin/node /opt/coxia/out/headless/coxia.mjs --data-dir /var/lib/coxia --master-key-file /etc/coxia/master.key --workspace principal --port 4330
Restart=on-failure
```

### A porta de administração

Com o processo rodando, o núcleo escuta num soquete Unix na pasta do workspace, `<pasta de dados>/workspaces/<id>/admin.sock`, com modo `0600`, e o apaga ao parar. Quem consegue conectar é o usuário dono do processo (é o SSH que leva alguém remoto até lá): não há token. É por ali que o shell do servidor, a CLI e o SDK chamam os canais do núcleo, com os direitos da janela; a auditoria nomeia a porta como `admin`. As regras do navegador pareado não valem (não é um navegador), e os canais que só a janela serve (`clipboard:copy`, `jobs:notify`) respondem `unknown-channel`. Fica ligada por padrão; `--no-admin-door` (ou `COXIA_ADMIN_DOOR=0`) a desliga. No desktop ela vem **desligada** e só a pessoa a liga, na janela (Configurações, "Porta de administração local"): a escolha fica em `admin-door.json` na pasta de dados, vale na hora e na próxima vez que o app abrir, e os canais que a mudam (`adminDoor:get`, `adminDoor:set`) são só da janela: nem um navegador pareado, nem a própria porta os chamam. Se o caminho passa de 107 caracteres, a pasta não aceita o soquete ou outro processo vivo já escuta ali, a porta fica fechada com o motivo no log e na linha de pronto, e o núcleo sobe do mesmo jeito; só um arquivo que ninguém atende (de um processo morto) é substituído. A linha de pronto traz `porta de administração: <caminho>`, sem segredo.

O protocolo (versão 1; as constantes e os tipos estão em `src/shared/adminDoor.ts`) é JSON, uma linha por objeto, UTF-8, no máximo 8 MiB por linha (uma linha maior fecha a conexão):

1. O cliente abre com `{"hello": <CONTRACT_VERSION>}`. O núcleo responde `{"hello": {"version": 1, "workspace": "<id>"}}`, ou `{"error": {"code": "contract-mismatch", "message": "…"}}` (a mensagem traz as duas versões) e fecha. Qualquer outra primeira linha: `invalid-input` e fecha.
2. Pedido: `{"id": 1, "channel": "web:pair", "args": []}`. Resposta única: `{"id": 1, "ok": true, "value": …}` ou `{"id": 1, "ok": false, "error": {"code": "…", "message": "…"}}`. Vários pedidos podem estar em curso e as respostas vêm em qualquer ordem.
3. Depois do hello o núcleo envia cada evento que emite como `{"event": …}`, o mesmo objeto que a janela recebe. Um cliente que não os quer os ignora. Um cliente que para de ler e deixa mais de 8 MiB sem ser enviado é desconectado (o núcleo nunca espera por ele); ele pode conectar de novo.

`scripts/admin-call.mjs <soquete> <canal> [argumentos em JSON]` faz uma chamada e imprime o valor (ou o código do erro, com saída 1); `web:pair` com ele imprime o código de pareamento.

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
| `--public-url <url>` | `COXIA_PUBLIC_URL` | The public address of **this process** (`https://…`, or `http://` only on `localhost`/`127.0.0.1`). Default: the saved public address. The flag wins over the variable; an empty variable counts as absent; an empty flag or an invalid URL is a usage error (exit 1). Never saved. |
| `--workspace <id>` | `COXIA_WORKSPACE` | The workspace this process runs. Default: the one the registry marks as current. |
| `--no-admin-door` | `COXIA_ADMIN_DOOR=0` | Do not open the admin socket. Default: open. |
| `--init` | | Only create the data folder's workspace registry (with its first workspace), print its id and exit 0. Needs only `--data-dir`. For an installer, before the supervisor starts the cores. |
| `--import <bundle dir>` | | Only import a workspace bundle made by `move:export` and exit (see [Moving the workspace](#moving-the-workspace-to-another-machine)). Needs `--data-dir`, `--master-key-file` and `--repos-root <dir>`, the folder the clones are in. Starts no server. |
| `--renderer-dir <dir>` | `COXIA_RENDERER_DIR` | The built renderer. Default: `out/renderer` next to the bundle; without it the door answers the API and no page. |

### The master key

Without the desktop there is no OS keychain. Secrets (`secrets.json`) are encrypted with a 32-byte key, written as 64 hex digits and a newline, in a file with mode `0600` (`umask 077; openssl rand -hex 32 > master.key`), **outside the data folder** (the folder is copied and moved; the key must not go with it). The file is checked on every use and the process **does not start** when it is missing, readable by others, a link, or inside the data folder. Losing the key loses the stored secrets; they are entered again.

### One process per workspace

A process runs one workspace. For several, start several processes with `--workspace` and different ports over the same data folder. The `--workspace` must exist in the registry (the process refuses otherwise) and does **not** change the registry's current workspace, which is the desktop's choice. The test flag that refuses external writes is the one of the workspace the process runs. Switching workspace from a screen does not exist here (`host-unavailable`): it is another process.

### One owner per workspace

A workspace has **one owner at a time**: only it runs the runner, the scheduler and every external effect. Ownership is a lease file, `owner.json`, in the workspace's folder: `instanceId`, `host` (the machine's name, nothing of its user), `pid`, `startedAt`, `renewedAt` and `expiresAt`. The owner renews every 10 s and a lease holds 30 s. The instance id is generated once per data folder and machine (`instance.json` in the root), so a restarted process of the same instance takes its own lease again. A lock file created exclusive (`owner.lock`) serialises reads and writes: two processes on one machine cannot both win. On a folder shared between machines the guarantee is **best effort** (exclusive creation and clocks differ between filesystems): run one owner per folder.

Two processes over one data folder share the instance id and tell apart by pid: the second, while the first lives, is a client. An instance that opens a workspace another instance owns is a **client**: it brings up the channels and the doors (web, admin) but not the runner or the scheduler, and every write that leaves the machine is refused with the code `not-owner`, which names the owner. The process's ready line and the log say who it is; the desktop shows a notice once. `ownership:status` answers `owner`, `self`, `expiresAt`, `role` (`owner` or `client`), `expired` and `handingOver`; a paired browser may read it.

**Handing the workspace over.** On the owning instance: `ownership:release` with the new one's `self` (its instance id and pid) (the owner stops the stage in progress at a safe point, interrupts what outlives the deadline, and marks `handingOver`, keeping the lease). On the new one: `ownership:claim`: it only works if the lease was marked for it; it writes its own lease, passes its health check (the configuration reads and the web door is up) and only then confirms. The old owner lets go only after the confirmation. If the new one fails the check, the lease goes back to the old one; if the new one does not confirm within 60 s, or nobody claims within 2 min, the old one takes the runner back. An interrupted run starts again at the stage it was in, on the new owner. Both channels belong to the computer and the admin door (`scripts/admin-call.mjs`), never to a paired browser.

**An expired lease.** If the owner died, an instance that starts does not take over by itself: it stays a client with `expired: true`. An admin takes over with `ownership:claim`. There is no passkey at that point yet (it arrives with the passkeys issue; the spot is marked in the code). Every claim, release, take-back and takeover is written to the audit log (`ownership`).

### Moving the workspace to another machine

A workspace on the desktop can come to live on a server (the provisioning tool, `coxia-provision`, drives this from the computer through the desktop's admin door, which the person switched on). The core does three things, all on the computer and the admin door only, never on a paired browser:

1. **Step down.** `ownership:move-out` with `[{ "to": "<description of the target, up to 200 characters>" }]` (for example `vps:hostinger:123`). The owner stops its work at a safe point, as in a handover (`ownership:release`), and writes `movedOut: { to, at }` in the lease: it becomes a **client for good**. No timer brings it back, and a restart reads the mark in its own lease and stays a client (a marked lease does not expire). It answers `ownership:status`, which now carries `movedOut` (`null` while there was no move). It refuses with `not-owner` when this instance is not the owner; repeating it with the same `to` only answers the state. It is audited (`ownership move-out`).
2. **Export.** `move:export` with `[{ "targetKey": "<64 hex digits>", "out": "<absolute path that does not exist>" }]`, only on a workspace that stepped down (else `forbidden`). It writes a new folder (0700; files 0600), built beside it and renamed at the end, so a failure leaves no half bundle:

   ```
   manifest.json     format 1, app version, contract version, date, workspace, repositories, secrets, files, bytes
   workspace/        the workspace's folder, without owner.json, owner.lock, admin.sock, sandbox/, browser/ or any *.sock
   registry.json     the workspace's entry of workspaces.json, as is
   secrets.json      the secrets.json format (version 1), only the stored secrets the workspace refers to
   git/<repo>.bundle `git bundle` of the branches of the runs still open of each repository (absent when there are none)
   ```

   The secrets the workspace refers to are the `secretRef` of the model providers and the code hosts, those of the external accounts, those of the test environment and each plugin's own (`plugin.<id>.*`). Only the stored secrets the workspace's config refers to are carried: a stored secret that no config field names is not carried and not listed. Every **stored** secret is read here and **encrypted again** under the target's key (AES-256-GCM, a random 12-byte IV, `base64(iv | tag(16) | ciphertext)`, the layout of the master key file): nothing goes in clear. A `command` or `env` secret names something of the old machine and **does not go**: `manifest.json` lists it in `secrets.notMoved` with its type (`command`, `env`, and `missing` or `unreadable` for a reference the store could not give) so the person sets it up again. The git name and email come from `git config` in each clone (`null` when unset). **The target key only encrypts:** it is not logged, audited, kept or repeated in an error message. The export is audited without the key (`ownership move-export`).
3. **Move back.** `ownership:claim` on the admin door (or in the window) on a lease with `movedOut` held by this same instance brings the workspace back: it passes the health check, resumes the runner and the scheduler and clears the mark (audit `move-back`). A paired browser, even with a passkey, does not move the workspace back, and another instance does not take it.

**The import, on the server.** `node out/headless/coxia.mjs --import <bundle folder> --data-dir <D> --master-key-file <K> --repos-root <R>` starts no server. It checks the bundle and builds everything in a temporary folder inside `<D>`; only then does it put it in place, and it takes back what it had already placed if a step fails, leaving nothing half done:

- it puts `workspace/` at `<D>/workspaces/<id>/` and points every `projects.repos[].path` at `<R>/<repository id>` and `projects.roots` at `[<R>]` (the clones are the server's; `coxia-server import` makes them first);
- it merges `secrets.json` into `<D>/secrets.json`: every secret must open with the master key `<K>` (else `bad-key`, and the whole bundle is refused); one that already exists with **another value** is refused as `conflict` (the same value, even sealed again, is accepted and what was there stays);
- it adds the entry of `registry.json` to `<D>/workspaces.json` (created when it does not exist; the registry's current workspace does not change);
- it refuses a repository with no remote url as `no-remote`, a bundle of a newer format as `newer-format` and what is not a bundle as `bad-bundle`.

Success: exit 0 and one line `{"imported":"<id>","repos":[{"id":"app","path":"<R>/app"}]}`. The **same bundle** again exits 0 with `"alreadyImported":true` and writes nothing, even if the workspace changed since (the record is a mark of the bundle in `<D>/imports/<id>.json`). Another bundle of the same workspace, or a workspace of the same id that already has work in it, is `conflict`; the empty workspace an `--init` left under the same id is replaced. An error exits 1 with `<code>: <message>` on stderr.

An open run whose worktree is not here but whose branch is in the clone gets its worktree back when the owner resumes its work (same folder name, under this machine's worktrees folder); without the branch it stays `worktree-gone`. Out of scope (left as the bundle had them): any other configuration that names a folder of the old machine.

### The web address belongs to the process

`--host` and `--port` apply to this process alone: the web door listens at that address over what is saved, and **nothing is written** to `web.json` (which lives in the data folder, shared by every workspace, and cannot serve two processes on one port). If a paired client calls `web:configure`, switching the door on or off or changing host and port does nothing: the view carries `addressFixed: true`, and the Browser access screen says so and disables those fields. The other fields (base path, public address, trusted proxy, external effects) are saved as usual, and the base path takes effect at once. Behind a proxy, set the public address on that screen, or on the desktop.

`--public-url` (or `COXIA_PUBLIC_URL`) does the same for the public address: `web.json` is common to every workspace, and each process behind the proxy has its own address (for example `https://b.example.com/cerimonias/`). The value holds for **this process only**, is never written, and follows the same rules as the saved address (`https`, or `http` on `localhost`). It is the public address everywhere the process reads it: the web door's `Origin` check (which otherwise answers 403 to any origin that is not the saved address or `localhost`), the passkeys (the accepted origin and the `rpId`, which is its host), the pairing link and address, and the push subject. The ready output gains a `public address: <url>` line. The URL's path is not checked against the base path: the proxy decides how they relate. If a client calls `web:configure` with `publicUrl`, the value is dropped and the server's keeps winning (the saved one stays as it was, for the desktop and the other workspaces); the other fields are saved as usual. `web:view` returns the effective value in `settings.publicUrl` and `publicUrlFixed: true`, and the screen shows the field disabled with a note.

### Health

`GET /healthz`, and also `GET <base path>/healthz` (default `/cerimonias/healthz`), answers without authentication `{"ok":true,"version":"…","workspace":"<id>"}`: nothing else, no name, no path. It is for the service manager and an update's health check.

### Signals and exit

SIGTERM and SIGINT stop the core (timers, web door, voice, a running stage within a 10 s deadline) and exit 0; a second signal leaves at once. A failure to start (a bad option or key, an unknown workspace, a taken port) exits 1 with the cause on stderr. When ready, one line on stdout names the address and the workspace, no secret. A systemd unit, for example:

```ini
[Service]
ExecStart=/usr/bin/node /opt/coxia/out/headless/coxia.mjs --data-dir /var/lib/coxia --master-key-file /etc/coxia/master.key --workspace principal --port 4330
Restart=on-failure
```

### The admin door

While the process runs, the core listens on a Unix socket in the workspace's folder, `<data dir>/workspaces/<id>/admin.sock`, mode `0600`, and removes it when it stops. Whoever can connect is the user the process runs as (SSH is what brings a remote person there): there is no token. The server's shell, the CLI and the SDK call the core's channels through it, with the window's rights; the audit names the door `admin`. The paired-browser rules do not apply (it is not a browser), and the channels only a window serves (`clipboard:copy`, `jobs:notify`) answer `unknown-channel`. It is on by default; `--no-admin-door` (or `COXIA_ADMIN_DOOR=0`) turns it off. On the desktop it is **off** and only the person turns it on, in the window (Settings, "Local admin door"): the choice is kept in `admin-door.json` in the data folder, takes effect at once and on the next start of the app, and the channels that change it (`adminDoor:get`, `adminDoor:set`) are the window's alone: neither a paired browser nor the door itself calls them. When the path is longer than 107 characters, the folder cannot take the socket, or another live process already listens there, the door stays closed with the reason in the log and on the ready line, and the core starts all the same; only a file nobody answers (left by a dead process) is replaced. The ready output carries `admin door: <path>`, no secret.

The protocol (version 1; the constants and types are in `src/shared/adminDoor.ts`) is JSON, one object per line, UTF-8, at most 8 MiB a line (a longer line closes the connection):

1. The client opens with `{"hello": <CONTRACT_VERSION>}`. The core answers `{"hello": {"version": 1, "workspace": "<id>"}}`, or `{"error": {"code": "contract-mismatch", "message": "…"}}` (the message names both versions) and closes. Any other first line: `invalid-input` and close.
2. A request: `{"id": 1, "channel": "web:pair", "args": []}`. One answer: `{"id": 1, "ok": true, "value": …}` or `{"id": 1, "ok": false, "error": {"code": "…", "message": "…"}}`. Several requests may be in flight and the answers come in any order.
3. After the hello the core sends every event it emits as `{"event": …}`, the same object the window gets. A client that does not want them ignores them. A client that stops reading and leaves more than 8 MiB unsent is disconnected (the core never waits for it); it can connect again.

`scripts/admin-call.mjs <socket> <channel> [JSON arguments]` makes one call and prints the value (or the error code, exit 1); `web:pair` through it prints the pairing code.

### What is missing

Without the desktop there is no file dialog, no workspace switch from a screen and no agent virtual screen (`host-unavailable`). The process does not update itself. Update modes and installing the service are not part of this.
