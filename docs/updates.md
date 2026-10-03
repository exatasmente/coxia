# Atualizações / Updates

[Português](#português) | [English](#english)

---

## Português

O Coxia se atualiza de duas formas, conforme **como foi instalado**. O app descobre sozinho (Configurações › Atualizações mostra o modo e o motivo) e a pessoa pode forçar um dos dois.

| Modo | Quando | Como atualiza |
|---|---|---|
| **Versão publicada** (`release`) | AppImage baixado de um release (ou Windows/macOS instalados de um release) | `electron-updater`: verifica, baixa em segundo plano e reinicia na versão nova |
| **Código-fonte** (`source`) | instalado por `scripts/install-local.sh` a partir de uma árvore de código que ainda existe | o app só avisa que a `main` da árvore tem commits novos; o botão roda `scripts/update.sh` (recompila) |
| Pacote `.deb` | instalado com `dpkg`/`apt` | **não se atualiza sozinho**: quem atualiza é o gerenciador de pacotes |
| Desenvolvimento | `npx electron .`, `npm run dev` | nada; rode `scripts/update.sh` num terminal |

### Como o modo é escolhido

1. `install-local.sh` grava `~/.local/state/cerimonias/install-source.json` (`{"source": "<árvore>", "appImage": "<AppImage instalado>"}`). Se o registro aponta **para este AppImage** e a árvore ainda existe, o modo é `source`. `CERIMONIAS_SOURCE_DIR` faz o papel do registro (testes, layouts incomuns).
2. Senão, se roda de um AppImage (`APPIMAGE` definido) e o `app-update.yml` embutido tem um endereço configurado, o modo é `release`.
3. Rodando de um pacote `.deb` (sem `APPIMAGE`), o modo é `package`.
4. A configuração **Modo de atualização** (Detectar sozinho / Versão publicada / Código-fonte) vence a detecção. Forçar um modo que não dá (código-fonte sem árvore, versão publicada com endereço inválido) resulta em "sem atualização", com o motivo na tela, e não num palpite.

### Versão publicada

- **Estados:** `idle` → `checking` → `available` → `downloading` → `downloaded` → `installing`, ou `error`. A máquina de estados é pura (`src/shared/updates.ts`, `reduceRelease`) e testada: uma verificação posterior nunca joga fora uma atualização já baixada, e um erro também não.
- **Quando verifica:** 30 s depois de abrir o app e a cada N horas (padrão 6; 1 a 168), se "Verificar atualizações automaticamente" estiver ligado. "Verificar agora" sempre funciona. Achou, baixa em segundo plano.
- **Canais:** `estável` lê `latest-linux.yml` e ignora pré-lançamentos; `beta` lê `beta-linux.yml` (e, no GitHub, também pré-lançamentos). Trocar de canal **nunca** leva o app a uma versão mais velha: o `electron-updater` liga `allowDowngrade` sozinho ao definir o canal, e o app o desliga de volta. A única volta é o botão explícito "Voltar para a versão estável" (aparece só numa versão beta com o canal estável), que vale para aquela verificação.
- **Download diferencial:** o AppImage leva o mapa de blocos embutido (`blockMapSize` no `latest-linux.yml`). O app compara com o AppImage que está instalado e baixa só os blocos que mudaram.
- **Aplicar:** o aviso "Versão X pronta para instalar" (e a seção em Configurações) oferece **Reiniciar para atualizar**. Ao confirmar, o app pede que a janela grave a cerimônia do dia (o mesmo caminho `update:flush` do `update.sh`), troca o AppImage, encerra os processos que ele abriu (voz, `git`, `glab`...) e fecha. Um ajudante separado espera o processo sumir, fecha os arquivos herdados (os do ponto de montagem antigo e o socket de depuração) e abre o AppImage novo; sem essa espera, a instância nova encontraria o bloqueio de instância única ainda ocupado e sairia. Na primeira abertura depois, o aviso "Atualizado para X" aparece uma vez.
- **Ou ao sair:** se você simplesmente fechar o app (Sair na bandeja), a atualização baixada é instalada nesse momento, sem reabrir.
- **Nunca no meio de algo:** com uma chamada, a fala, uma execução de agente em andamento (a janela avisa o processo principal), o aviso some, "Reiniciar" pede confirmação ("Reiniciar mesmo assim") e sair do app **não** instala. O estado fica salvo de qualquer forma; o que se perde é a chamada ou execução em curso.
- **Notas da versão:** vêm do `releaseNotes` do `latest-linux.yml` (ou do texto do release no GitHub), mostradas como texto simples (marcação removida, 4.000 caracteres no máximo).
- **Erros:** qualquer falha (rede, `404` do `latest*.yml`, checksum que não confere, instalação) vai para o log de erros do app (origem `update:release`, visível em Saúde) e para a seção, sem diálogo.

### Entrar no canal beta

Uma versão passa por três degraus antes de chegar a todos: o ramo `release/X.Y.Z`, onde o trabalho se junta, a **beta** (`X.Y.Z-beta.1`, `beta.2`...) e, quando a beta está boa, a **estável** `X.Y.Z` ([`RELEASING.md`](../RELEASING.md)). Quem está no canal beta é o primeiro anel: recebe cada beta assim que ela é publicada, e depois a estável.

1. Em Configurações › Atualizações, escolha **Canal › Beta** e clique em **Verificar agora**. A escolha vale para esta máquina (`channel` em `updates.json`).
2. O app lê `beta-linux.yml` (e, no GitHub, os pré-lançamentos); quem fica no canal **estável** lê `latest-linux.yml` e nunca vê uma beta, porque uma beta não gera esse arquivo.
3. Uma beta é instalada como qualquer atualização (baixa em segundo plano, **Reiniciar para atualizar**). Quando a versão estável `X.Y.Z` sai, ela é mais nova que `X.Y.Z-beta.N` e chega pelo mesmo canal.
4. Para sair do beta, volte o canal para **Estável**: o app **não** troca para uma versão mais velha sozinho; numa beta, o botão "Voltar para a versão estável" faz isso uma vez.

Só o AppImage se atualiza assim, e, como no resto desta página, só há atualização para outras pessoas quando o repositório (e os seus releases) é público. Um problema numa beta se relata como qualquer outro; a correção entra no mesmo ramo e vira a próxima beta.

### Plataformas

| Plataforma | Estado |
|---|---|
| Linux AppImage | suportado e testado de ponta a ponta (abaixo) |
| Linux `.deb` | sem atualização automática; use `apt`/`dpkg` |
| Windows (NSIS) | **ligado, não testado, exige assinatura de código**: sem ela o Windows avisa e a atualização pode ser bloqueada. Não há assinatura configurada |
| macOS (dmg + zip) | **ligado, não testado, exige assinatura e notarização**: o atualizador do macOS recusa builds sem assinatura. Não há assinatura configurada |

Windows e macOS não fazem parte de `npm run dist`; os blocos `win` e `mac` de `electron-builder.yml` só existem para o dia em que houver certificados.

### Código-fonte

- A verificação roda `git rev-list --count <commit instalado>..main` e `git log` na árvore registrada (**só leitura**: nenhum arquivo, índice ou branch é alterado; `GIT_OPTIONAL_LOCKS=0`). O commit instalado é o do carimbo do build (`+dirty` é descartado).
- Quando: 4 s depois de abrir, a cada 30 min, e quando a janela volta ao primeiro plano (no máximo uma vez por minuto). Desligando "Verificar automaticamente", só "Verificar agora".
- Mostra o aviso **Atualização disponível** na barra de cima do Hoje e, em Configurações › Atualizações, quantos commits são e a lista deles (até 50, os mais novos primeiro).
- "Buscar do remoto (`git fetch`) ao verificar" é opcional e vem **desligado**. Ligado, roda `git fetch origin main` (30 s no máximo, sem pedir senha) e mostra, como informação, quantos commits o `origin/main` tem além da `main` local; o aviso continua contando a `main` local, porque é ela que o `update.sh` compila (faça o `git pull` para incluir os do remoto).
- "Atualizar agora" é o fluxo de sempre: `scripts/update.sh` da árvore registrada.

### Configurações (`<dados>/updates.json`, por máquina)

| Campo | Padrão | |
|---|---|---|
| `auto` | `true` | verificar ao abrir e a cada intervalo |
| `channel` | `stable` | `stable` ou `beta` |
| `intervalHours` | `6` | 1 a 168 |
| `mode` | `auto` | `auto`, `release` ou `source` |
| `fetchSource` | `false` | `git fetch` antes de comparar (modo código-fonte) |

Os canais de atualização são só da janela do app: `update:status`, `update:check`, `update:settings-save`, `update:install`, `update:busy` (e os de antes: `update:info`, `update:run`, `update:seen`, `update:flushed`) estão em `DESKTOP_ONLY` em `src/main/webPolicy.ts`. Um navegador pareado (PWA) não os alcança nem com "efeitos externos" ligado. `test/updates-policy.test.ts` falha se um canal `update:*` novo ficar fora da lista; `test/web-server.test.ts` confere a lista exata.

### Segurança

- **HTTPS.** O app só consulta um feed HTTPS. HTTP só para esta própria máquina (loopback), que é o que o teste local usa. Um feed com marcadores `OWNER`/`REPO` (um fork que ainda não trocou o repositório em `electron-builder.yml`) não é consultado: nada vai à rede até haver um repositório de verdade. O provedor tem de ser `github` ou `generic`.
- **Integridade.** O `latest*.yml` traz o `sha512` do AppImage. O `electron-updater` confere esse hash no arquivo baixado (e em cada bloco de um download diferencial); se não bater, o download falha, nada é instalado e o erro vai para o log. **No Linux não há assinatura do AppImage**: a garantia é o TLS do feed mais esse hash, então quem controla o release controla a atualização. Instaladores web (que pulariam parte da conferência) são recusados (`disableWebInstaller`).
- **Sem downgrade** sem pedir (acima).
- **Instalar só com decisão:** `installDecision` (pura, testada) nega a instalação quando nada foi baixado ou quando algo está rodando sem confirmação; só há uma chamada a `quitAndInstall`, atrás dela.
- O app só carrega `electron-updater` quando um build publicado pode se atualizar.

### Tamanho das atualizações

O AppImage de uso pessoal (`npm run dist`) tem cerca de 290 MB, quase tudo é o binário do Claude Code do SDK; o pacote público (`npm run dist:public`) **não leva** o SDK (a pessoa o instala na primeira execução) e tem cerca de 178 MB. No teste local, uma troca de versão sem mudança de código baixou 0,5 MB (0,2 %); uma mudança real baixa os blocos que mudaram (o `app.asar` e o que mais mudar), nunca o binário do SDK enquanto ele for igual. Como o pacote público não leva o binário do SDK, o download completo, quando é preciso, também é menor. Num feed do GitHub o `electron-updater` usa uma requisição por intervalo (não várias por vez); funciona, só com mais idas e vindas. Não foi testado contra o GitHub de verdade.

### Testar uma atualização localmente

`scripts/update-e2e.mjs` roda o caminho inteiro contra um servidor HTTP local (`scripts/update-e2e-server.mjs`, com `Range` e várias faixas), com HOME, `XDG_*` e `CERIMONIAS_DATA_DIR` próprios numa pasta de rascunho. Nada da instalação real é tocado. Precisa de dois AppImages com versões diferentes, feitos com um `publish` genérico apontando para o servidor:

```bash
# um electron-builder.yml de teste, com o bloco publish trocado por:
#   publish: {provider: generic, url: http://127.0.0.1:9326/}
npx electron-vite build
npx electron-builder --config <teste.yml> --linux AppImage --publish never -c.directories.output=scratch/e2e/dist-a -c.extraMetadata.version=0.1.0
npx electron-builder --config <teste.yml> --linux AppImage --publish never -c.directories.output=scratch/e2e/dist-b -c.extraMetadata.version=0.1.1

node scripts/update-e2e.mjs --old scratch/e2e/dist-a/coxia-0.1.0.AppImage --new scratch/e2e/dist-b --work scratch/e2e/run-main --scenario main
```

Cenários: `main` (detecta, baixa de forma diferencial, recusa instalar ocupado, instala, reabre, avisa), `tamper` (sha512 errado: o download falha e nada é instalado), `older` (o feed oferece versão mais velha: nada é oferecido), `beta` (só `beta-linux.yml`), `onquit` (instala ao sair, só se nada estiver rodando) e `source` (precisa de `--commit <commit do build>`: instala por `install-local.sh` a partir de um clone com a `main` dois commits à frente). A janela do app abre na tela durante o teste.

---

## English

Coxia updates itself in one of two ways, depending on **how it was installed**. The app works it out (Settings › Updates shows the mode and why) and the person can force one.

| Mode | When | How it updates |
|---|---|---|
| **Published release** (`release`) | an AppImage downloaded from a release (or Windows/macOS installed from a release) | `electron-updater`: checks, downloads in the background, restarts into the new version |
| **Source tree** (`source`) | installed by `scripts/install-local.sh` from a source tree that still exists | the app only says the tree's `main` has new commits; the button runs `scripts/update.sh` (rebuild) |
| `.deb` package | installed with `dpkg`/`apt` | **does not update itself**: the package manager does |
| Development | `npx electron .`, `npm run dev` | nothing; run `scripts/update.sh` in a terminal |

### How the mode is chosen

1. `install-local.sh` writes `~/.local/state/cerimonias/install-source.json` (`{"source": "<tree>", "appImage": "<installed AppImage>"}`). If the record points **at this very AppImage** and the tree still exists, the mode is `source`. `CERIMONIAS_SOURCE_DIR` stands in for the record (tests, unusual layouts).
2. Otherwise, if it runs from an AppImage (`APPIMAGE` set) and the embedded `app-update.yml` has a configured feed, the mode is `release`.
3. Running from a `.deb` package (no `APPIMAGE`), the mode is `package`.
4. The **Update mode** setting (Detect automatically / Published release / Source tree) beats the detection. Forcing a mode that cannot work (source without a tree, release with a bad feed) ends in "no updates" with the reason on screen, not in a guess.

### Published release

- **States:** `idle` → `checking` → `available` → `downloading` → `downloaded` → `installing`, or `error`. The state machine is pure (`src/shared/updates.ts`, `reduceRelease`) and tested: a later check never throws away an update that is already downloaded, and neither does an error.
- **When it checks:** 30 s after the app starts and every N hours (default 6; 1 to 168) while "Check for updates automatically" is on. "Check now" always works. When it finds one it downloads in the background.
- **Channels:** `stable` reads `latest-linux.yml` and ignores pre-releases; `beta` reads `beta-linux.yml` (and, on GitHub, pre-releases too). Switching channel **never** moves the app to an older version: `electron-updater` turns `allowDowngrade` on by itself when a channel is set, and the app turns it back off. The only way back is the explicit "Go back to the stable version" button (shown only on a beta build with the stable channel), which applies to that one check.
- **Differential download:** the AppImage carries its block map embedded (`blockMapSize` in `latest-linux.yml`). The app compares it with the installed AppImage and downloads only the blocks that changed.
- **Applying:** the "Version X is ready to install" prompt (and the Settings section) offers **Restart to update**. On confirm the app asks the window to save the day's ceremony (the same `update:flush` path as `update.sh`), swaps the AppImage, stops the processes it started (voice, `git`, `glab`...) and quits. A detached helper waits for the process to be gone, closes the inherited descriptors (the old mount's files and the debugging socket) and opens the new AppImage; without that wait the new instance would find the single-instance lock still held and quit.  On the first start after, "Updated to X" shows once.
- **Or on quit:** if you simply quit the app (Quit in the tray), a downloaded update is installed right then, without reopening.
- **Never in the middle of something:** with a call, speech or an agent job running (the window tells the main process), the prompt goes away, "Restart" asks for confirmation ("Restart anyway") and quitting the app does **not** install. The state is saved either way; what is lost is the call or run in progress.
- **Release notes:** from `releaseNotes` in `latest-linux.yml` (or the GitHub release text), shown as plain text (markup stripped, 4,000 characters at most).
- **Errors:** any failure (network, `404` for `latest*.yml`, a checksum that does not match, install) goes to the app's error log (source `update:release`, visible in Saúde) and to the section, with no dialog.

### Joining the beta channel

A version goes through three steps before it reaches everyone: the `release/X.Y.Z` branch, where the work comes together, the **beta** (`X.Y.Z-beta.1`, `beta.2`...) and, when the beta is good, the **stable** `X.Y.Z` ([`RELEASING.md`](../RELEASING.md)). People on the beta channel are the first ring: they receive each beta as soon as it is published, and then the stable.

1. In Settings › Updates, choose **Channel › Beta** and click **Check now**. The choice is per machine (`channel` in `updates.json`).
2. The app reads `beta-linux.yml` (and, on GitHub, pre-releases); people on the **stable** channel read `latest-linux.yml` and never see a beta, because a beta does not produce that file.
3. A beta installs like any update (downloads in the background, **Restart to update**). When the stable `X.Y.Z` comes out it is newer than `X.Y.Z-beta.N` and arrives through the same channel.
4. To leave the beta, set the channel back to **Stable**: the app does **not** move to an older version by itself; on a beta, the "Go back to the stable version" button does it once.

Only the AppImage updates this way and, as on the rest of this page, others only get updates once the repository (and so its releases) is public. A problem in a beta is reported like any other; the fix goes into the same branch and becomes the next beta.

### Platforms

| Platform | Status |
|---|---|
| Linux AppImage | supported and tested end to end (below) |
| Linux `.deb` | no automatic update; use `apt`/`dpkg` |
| Windows (NSIS) | **wired, untested, requires code signing**: without it Windows warns and the update may be blocked. No signing is set up |
| macOS (dmg + zip) | **wired, untested, requires code signing and notarization**: the macOS updater refuses unsigned builds. No signing is set up |

Windows and macOS are not part of `npm run dist`; the `win` and `mac` blocks in `electron-builder.yml` are there for the day there are certificates.

### Source tree

- The check runs `git rev-list --count <installed commit>..main` and `git log` in the recorded tree (**read-only**: no file, index or branch is changed; `GIT_OPTIONAL_LOCKS=0`). The installed commit is the build stamp (`+dirty` is dropped).
- When: 4 s after start, every 30 min, and when the window comes back to the front (at most once a minute). With "Check automatically" off, only "Check now".
- It shows the **Update available** badge in the top bar of Hoje and, in Settings › Updates, how many commits and the list (up to 50, newest first).
- "Fetch from the remote (`git fetch`) when checking" is optional and **off** by default. On, it runs `git fetch origin main` (30 s at most, never asks for a password) and shows, as information, how many commits `origin/main` has beyond the local `main`; the badge still counts the local `main`, because that is what `update.sh` builds (`git pull` to include the remote ones).
- "Update now" is the usual flow: the recorded tree's `scripts/update.sh`.

### Settings (`<data>/updates.json`, per machine)

| Field | Default | |
|---|---|---|
| `auto` | `true` | check at start and every interval |
| `channel` | `stable` | `stable` or `beta` |
| `intervalHours` | `6` | 1 to 168 |
| `mode` | `auto` | `auto`, `release` or `source` |
| `fetchSource` | `false` | `git fetch` before comparing (source mode) |

The update channels belong to the app window only: `update:status`, `update:check`, `update:settings-save`, `update:install`, `update:busy` (and the older `update:info`, `update:run`, `update:seen`, `update:flushed`) are in `DESKTOP_ONLY` in `src/main/webPolicy.ts`. A paired browser (the PWA) cannot reach them, not even with "external effects" on. `test/updates-policy.test.ts` fails if a new `update:*` channel is left out of the list; `test/web-server.test.ts` checks the exact list.

### Security

- **HTTPS.** The app only queries an HTTPS feed. Plain HTTP is accepted only to this very machine (loopback), which is what the local test uses. A feed with `OWNER`/`REPO` placeholders (a fork that has not yet set its repository in `electron-builder.yml`) is not queried: nothing goes to the network until there is a real repository. The provider must be `github` or `generic`.
- **Integrity.** `latest*.yml` carries the AppImage's `sha512`. `electron-updater` checks that hash on the downloaded file (and on every block of a differential download); if it does not match, the download fails, nothing is installed and the error goes to the log. **On Linux the AppImage is not signed**: the guarantee is the feed's TLS plus that hash, so whoever controls the release controls the update. Web installers (which would skip part of the check) are refused (`disableWebInstaller`).
- **No downgrade** unless asked for (above).
- **Install only on a decision:** `installDecision` (pure, tested) refuses to install when nothing is downloaded or when something is running without a confirmation; there is a single `quitAndInstall` call, behind it.
- The app only loads `electron-updater` when a published build can update itself.

### Update sizes

The personal AppImage (`npm run dist`) is about 290 MB, almost all of it the Claude Code binary of the SDK; the public package (`npm run dist:public`) **does not ship** the SDK (it is installed on first run) and is about 178 MB. In the local test a version bump with no code change downloaded 0.5 MB (0.2 %); a real change downloads the blocks that changed (`app.asar` and whatever else changes), never the SDK binary while it stays the same. Since the public package does not ship the SDK binary, a full download, when one is needed, is smaller too. On a GitHub feed `electron-updater` uses one range per request (not several at a time); it works, with more round trips. It has not been tested against real GitHub.

### Testing an update locally

`scripts/update-e2e.mjs` runs the whole path against a local HTTP server (`scripts/update-e2e-server.mjs`, with `Range` and multi-range), with its own HOME, `XDG_*` and `CERIMONIAS_DATA_DIR` in a scratch folder. Nothing of the real install is touched. It needs two AppImages with different versions, built with a generic `publish` pointing at the server:

```bash
# a test electron-builder.yml, with the publish block replaced by:
#   publish: {provider: generic, url: http://127.0.0.1:9326/}
npx electron-vite build
npx electron-builder --config <test.yml> --linux AppImage --publish never -c.directories.output=scratch/e2e/dist-a -c.extraMetadata.version=0.1.0
npx electron-builder --config <test.yml> --linux AppImage --publish never -c.directories.output=scratch/e2e/dist-b -c.extraMetadata.version=0.1.1

node scripts/update-e2e.mjs --old scratch/e2e/dist-a/coxia-0.1.0.AppImage --new scratch/e2e/dist-b --work scratch/e2e/run-main --scenario main
```

Scenarios: `main` (detects, downloads differentially, refuses to install while busy, installs, reopens, announces), `tamper` (wrong sha512: the download fails and nothing is installed), `older` (the feed offers an older version: nothing is offered), `beta` (only `beta-linux.yml`), `onquit` (installs on quit, only when nothing is running) and `source` (needs `--commit <the build's commit>`: installs through `install-local.sh` from a clone whose `main` is two commits ahead). The app window opens on screen during the test.
