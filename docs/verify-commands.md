# Comandos de verificação de conflitos

Comando por projeto que o Coxia roda na worktree do conflito, depois de aplicar a resolução e antes do commit do merge (Configurações › Verificação de conflitos). Roda com `bash -lc` dentro da worktree, com `CLONE_DIR` (seu clone) e `WORKTREE_DIR`. Os arquivos do merge vêm de `git diff --cached --name-only HEAD`. Código de saída diferente de zero reprova a verificação.

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
