# Releasing / Publicar uma versão

[Português](#português) | [English](#english)

How an update reaches the apps that are already installed: [`docs/updates.md`](docs/updates.md).

---

## Português

### Publicar um release (`electron-builder --publish`)

Só vale para versões públicas, instaladas de um release. Quem instala pelo código (`scripts/install-local.sh`) não usa isto.

**Uma vez:** em `electron-builder.yml`, bloco `publish`, troque `OWNER` e `REPO` pelo repositório do GitHub onde os releases ficam. Enquanto os marcadores estiverem lá, os apps publicados **não consultam nada** (de propósito). Mantenha `provider: github` ou `generic` com URL **HTTPS**; o app recusa outra coisa.

**A cada versão:**

1. Suba a `version` em `package.json` (semver). Versão final: `0.3.0`. Beta: `0.3.0-beta.1`.
2. Confira: `npm ci`, `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `node scripts/theme-audit.mjs`.
3. Gere e envie, com um token de acesso do GitHub (escopo de escrita em releases) no ambiente, **sem colá-lo em arquivo nem em histórico**:

   ```bash
   npx electron-vite build
   GH_TOKEN=... npx electron-builder --linux AppImage deb --publish always
   ```

   `releaseType: draft` faz o `electron-builder` criar o release como **rascunho** no GitHub e anexar os arquivos. Rascunho não é visto pelos apps: revise e clique em *Publish release*. Para um beta, rode com `--config.publish.releaseType=prerelease` (ou marque como *pre-release* na página).
4. Escreva as notas do release na página do GitHub. O app as mostra como texto simples (o `electron-updater` as lê do release).
5. Publique o rascunho. A partir daí, os apps começam a achá-lo na próxima verificação.

**Quais arquivos têm de estar no release** (o `electron-builder` envia todos com `--publish always`; se for subir à mão, são estes):

| Arquivo | Para quê |
|---|---|
| `cerimonias-<versão>.AppImage` | o app; leva o mapa de blocos embutido (download diferencial) |
| `latest-linux.yml` | o que o app lê no canal **estável**: versão, nome do arquivo, `sha512`, tamanho, data |
| `beta-linux.yml` | idem, no canal **beta** (o `electron-builder` o gera no lugar do `latest-linux.yml` quando a versão tem sufixo, como `-beta.1`) |
| `cerimonias_<versão>_amd64.deb` | instalação manual por `dpkg`/`apt`; o app **não** o usa para atualizar |

Não suba `builder-debug.yml` nem a pasta `linux-unpacked`. O nome do AppImage dentro do `latest-linux.yml` tem de bater com o arquivo anexado, e o `sha512` com o conteúdo: **nunca troque um arquivo de um release já publicado** (quem já baixou o `latest-linux.yml` passa a falhar a conferência); publique uma versão nova.

Windows e macOS (ainda **sem assinatura**, então a atualização automática não vale lá) gerariam, no mesmo release: `latest.yml` + `.exe` + `.exe.blockmap` e `latest-mac.yml` + `.zip` + `.dmg`.

**Sem publicar pelo `electron-builder`** (`npm run dist` ou `--publish never`): os arquivos ficam em `dist/`; crie o release no GitHub e anexe à mão os da tabela.

### Depois de publicar

- Abra o release numa janela anônima e confira que `latest-linux.yml` abre (HTTPS, `200`).
- Num AppImage da versão anterior (não no seu instalado de uso), Configurações › Atualizações › Verificar agora deve achar a versão nova e baixar.
- Um release ruim não tem volta automática (o app não faz downgrade sozinho): despublique-o e publique uma versão de correção maior.

### Testar sem publicar nada

`scripts/update-e2e.mjs` faz o caminho inteiro contra um servidor local (veja [`docs/updates.md`](docs/updates.md#testar-uma-atualização-localmente)).

---

## English

### Publishing a release (`electron-builder --publish`)

This is for public versions installed from a release. Whoever installs from source (`scripts/install-local.sh`) does not use it.

**Once:** in `electron-builder.yml`, `publish` block, replace `OWNER` and `REPO` with the GitHub repository the releases live in. While the placeholders are there, published apps **query nothing** (on purpose). Keep `provider: github`, or `generic` with an **HTTPS** URL; the app refuses anything else.

**For every version:**

1. Bump `version` in `package.json` (semver). Final: `0.3.0`. Beta: `0.3.0-beta.1`.
2. Check: `npm ci`, `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `node scripts/theme-audit.mjs`.
3. Build and upload, with a GitHub access token (write access to releases) in the environment, **never pasted into a file or into shell history**:

   ```bash
   npx electron-vite build
   GH_TOKEN=... npx electron-builder --linux AppImage deb --publish always
   ```

   `releaseType: draft` makes `electron-builder` create the release as a **draft** on GitHub and attach the files. Apps do not see a draft: review it and click *Publish release*. For a beta run with `--config.publish.releaseType=prerelease` (or tick *pre-release* on the page).
4. Write the release notes on the GitHub page. The app shows them as plain text (`electron-updater` reads them from the release).
5. Publish the draft. From then on apps find it at their next check.

**Which files must be in the release** (`electron-builder` uploads all of them with `--publish always`; if you upload by hand, these are the ones):

| File | What for |
|---|---|
| `cerimonias-<version>.AppImage` | the app; carries its block map embedded (differential download) |
| `latest-linux.yml` | what the app reads on the **stable** channel: version, file name, `sha512`, size, date |
| `beta-linux.yml` | the same, on the **beta** channel (`electron-builder` writes it instead of `latest-linux.yml` when the version has a suffix such as `-beta.1`) |
| `cerimonias_<version>_amd64.deb` | manual install with `dpkg`/`apt`; the app does **not** use it to update |

Do not upload `builder-debug.yml` or the `linux-unpacked` folder. The AppImage name inside `latest-linux.yml` must match the attached file, and the `sha512` its content: **never replace a file of an already published release** (anyone who already fetched `latest-linux.yml` starts failing the check); publish a new version instead.

Windows and macOS (still **unsigned**, so automatic update does not apply there) would produce, in the same release: `latest.yml` + `.exe` + `.exe.blockmap` and `latest-mac.yml` + `.zip` + `.dmg`.

**Without publishing through `electron-builder`** (`npm run dist` or `--publish never`): the files stay in `dist/`; create the release on GitHub and attach those in the table by hand.

### After publishing

- Open the release in a private window and check that `latest-linux.yml` opens (HTTPS, `200`).
- On an AppImage of the previous version (not your everyday install), Settings › Updates › Check now must find the new version and download it.
- A bad release has no automatic way back (the app never downgrades by itself): unpublish it and publish a higher fix version.

### Testing without publishing anything

`scripts/update-e2e.mjs` runs the whole path against a local server (see [`docs/updates.md`](docs/updates.md#testing-an-update-locally)).
