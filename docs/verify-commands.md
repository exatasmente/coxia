# Comandos de verificação de conflitos

Comando por projeto que o Coxia roda na worktree do conflito, depois de aplicar a resolução e antes do commit do merge (Configurações › Verificação de conflitos). Roda com `bash -lc` dentro da worktree, com `CLONE_DIR` (seu clone) e `WORKTREE_DIR`. Os arquivos do merge vêm de `git diff --cached --name-only HEAD`. Código de saída diferente de zero reprova a verificação.

## De quem é o comando

O comando é do **workspace**: fica no `config.json` dele (`projects.verifyCommands`, um mapa `grupo/projeto` → comando; [`configuration.md`](configuration.md)), vai junto na exportação e na importação, e a prévia da importação o mostra entre os programas que o arquivo mandaria rodar. Dois workspaces com o mesmo projeto podem ter comandos diferentes.

A tela lista os repositórios do workspace (pelo `projectPath` ou pelo caminho do `remoteUrl`; um repositório sem remoto não tem projeto), os projetos dos espelhos da sincronização de release e os projetos que já têm comando aqui. Outro projeto entra pelo campo "grupo/projeto". Só a janela do app grava: um navegador pareado lê, mas não escolhe o que o Aplicar executa.

### Quem já tinha comandos

Antes, os comandos ficavam num arquivo só, `<dados>/conflict-verify.json`, comum a todos os workspaces. No primeiro início depois da atualização o app copia cada comando para os workspaces cujo repositório ou espelho é aquele projeto (sem trocar um comando que o workspace já tenha) e renomeia o arquivo para `conflict-verify.json.migrated`. Se o `config.json` de algum workspace estiver inválido, o arquivo fica onde está e o próximo início tenta de novo.

Um comando de um projeto que nenhum workspace lista não se perde: continua no `.migrated`, em `conflict-verify.unclaimed.json` e, só os nomes, em `workspaces/migration.log`, e a tela mostra uma nota "Comandos da lista compartilhada anterior" com **Usar aqui** (preenche o campo; salve para valer). Para recuperar à mão, copie o comando do `.migrated` para o campo do projeto no workspace certo.

O botão **Sugestão (Node)** da tela de configurações preenche o campo do projeto com o comando abaixo (`src/renderer/src/conflictVerifyDefaults.ts`). Salve para valer.

## Projeto Node

Instala as dependências na worktree (ou liga o `node_modules` do seu clone), confere os tipos e roda os testes relacionados aos arquivos `.ts` alterados. O `nvm use` lê o `.nvmrc` do projeto. Falhas pré-existentes na branch principal aparecem aqui: compare com ela antes de culpar a resolução.

```sh
set -e; . "$HOME/.nvm/nvm.sh" >/dev/null; nvm use >/dev/null; if [ -f package-lock.json ]; then npm ci --prefer-offline --no-audit --no-fund --loglevel=error || { lock=$(mktemp); cp package-lock.json "$lock"; npm install --prefer-offline --no-audit --no-fund --loglevel=error; cp "$lock" package-lock.json; rm -f "$lock"; }; else ln -sfn "$CLONE_DIR/node_modules" node_modules; fi; npx tsc --noEmit --incremental false --skipLibCheck -p tsconfig.json; files=$(git diff --cached --name-only --diff-filter=AM HEAD -- "*.ts" | tr "\n" " "); if [ -n "$files" ]; then npx jest --passWithNoTests --findRelatedTests $files; else echo "nenhum arquivo de código mudou no merge"; fi
```

## Outras pilhas

Escreva o comando que o seu projeto precisa: um `php -l` nos arquivos alterados, um `go vet ./...`, um `pytest` nos arquivos tocados, um `docker run` com a imagem de testes. Duas regras valem para qualquer um:

- não escreva fora da worktree (o cache e os artefatos ficam nela ou em `/tmp`);
- saia com código diferente de zero quando algo reprovar, e use `set -e` para parar no primeiro erro.

---

# Conflict verification commands (English)

A command per project that Coxia runs in the conflict worktree, after the resolution is applied and before the merge commit (Settings › Conflict verification). It runs with `bash -lc` inside the worktree, with `CLONE_DIR` (your clone) and `WORKTREE_DIR`. The files of the merge come from `git diff --cached --name-only HEAD`. A non-zero exit code fails the verification. The **Suggestion (Node)** button fills the project's field with the Node command above (`src/renderer/src/conflictVerifyDefaults.ts`); save for it to count. For other stacks, write the command your project needs and follow the two rules above (stay inside the worktree, exit non-zero on failure, `set -e`).

## Whose command it is

The command belongs to the **workspace**: it lives in its `config.json` (`projects.verifyCommands`, a map `group/project` to command; [`configuration.md`](configuration.md)), goes out and in with export and import, and the import preview lists it among the programs the file would run. Two workspaces with the same project can have different commands.

The screen lists the workspace's repositories (by `projectPath`, or the path of the `remoteUrl`; a repo with no remote has no project), the projects of its release mirrors and the projects that already have a command here. Another project is added with the "group/project" field. Only the app window writes: a paired browser can read but cannot choose what Apply executes.

### If you already had commands

They used to live in one file, `<data>/conflict-verify.json`, shared by every workspace. At the first start after the update the app copies each command into the workspaces whose repository or mirror is that project (without replacing a command the workspace already has) and renames the file to `conflict-verify.json.migrated`. If some workspace's `config.json` is invalid, the file stays where it is and the next start tries again.

A command whose project no workspace lists is not lost: it stays in the `.migrated` file, in `conflict-verify.unclaimed.json` and, as names only, in `workspaces/migration.log`, and the screen shows a "Commands from the earlier shared list" note with **Use here** (it fills the field; save for it to count). To recover by hand, copy the command from the `.migrated` file into the project's field in the right workspace.

### Not verified

Only fakes and temporary folders were used: the move was exercised on layouts built by the tests, never on a real installation, and the screen's note was checked by reading the code and the build, not in a running app.
