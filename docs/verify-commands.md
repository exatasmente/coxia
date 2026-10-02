# Comandos de verificação de conflitos

Comando por projeto que o cerimonias roda na worktree do conflito, depois de aplicar a resolução e antes do commit do merge (Configurações › Verificação de conflitos). Roda com `bash -lc` dentro da worktree, com `CLONE_DIR` (seu clone) e `WORKTREE_DIR`. Os arquivos do merge vêm de `git diff --cached --name-only HEAD`. Código de saída diferente de zero reprova a verificação.

O botão **Sugestão** da tela de configurações preenche o campo do projeto com o comando abaixo (`src/renderer/src/conflictVerifyDefaults.ts`). Salve para valer.

## broker-whatsapp/hub-whatsapp

Node 18; instala as dependências na worktree e roda os testes dos arquivos alterados. Falhas pré-existentes na main aparecem aqui: compare com a main antes de culpar a resolução.

```sh
set -e; . "$HOME/.nvm/nvm.sh" >/dev/null; nvm use 18 >/dev/null; if [ -f package-lock.json ]; then npm ci --prefer-offline --no-audit --no-fund --loglevel=error || { lock=$(mktemp); cp package-lock.json "$lock"; npm install --prefer-offline --no-audit --no-fund --loglevel=error; cp "$lock" package-lock.json; rm -f "$lock"; }; else ln -sfn "$CLONE_DIR/node_modules" node_modules; fi; npx tsc --noEmit --incremental false --skipLibCheck -p tsconfig.json; files=$(git diff --cached --name-only --diff-filter=AM HEAD -- "*.ts" | tr "\n" " "); if [ -n "$files" ]; then npx jest --passWithNoTests --findRelatedTests $files; else echo "nenhum arquivo de código mudou no merge"; fi
```

## sz4/agent-socket-manager

Node 18; instala as dependências e roda só os testes relacionados aos .js alterados.

```sh
set -e; . "$HOME/.nvm/nvm.sh" >/dev/null; nvm use 18 >/dev/null; if [ -f package-lock.json ]; then npm ci --prefer-offline --no-audit --no-fund --loglevel=error || { lock=$(mktemp); cp package-lock.json "$lock"; npm install --prefer-offline --no-audit --no-fund --loglevel=error; cp "$lock" package-lock.json; rm -f "$lock"; }; else ln -sfn "$CLONE_DIR/node_modules" node_modules; fi; files=$(git diff --cached --name-only --diff-filter=AM HEAD -- "*.js" | tr "\n" " "); if [ -n "$files" ]; then npx jest --passWithNoTests --findRelatedTests $files; else echo "nenhum arquivo de código mudou no merge"; fi
```

## sz4/reports-consumer

Node 22; liga o .env do clone na worktree, confere os tipos e roda os testes relacionados em série.

```sh
set -e; if [ -f "$CLONE_DIR/.env" ] && [ ! -e .env ]; then ln -s "$CLONE_DIR/.env" .env; fi; . "$HOME/.nvm/nvm.sh" >/dev/null; nvm use 22 >/dev/null; if [ -f package-lock.json ]; then npm ci --prefer-offline --no-audit --no-fund --loglevel=error || { lock=$(mktemp); cp package-lock.json "$lock"; npm install --prefer-offline --no-audit --no-fund --loglevel=error; cp "$lock" package-lock.json; rm -f "$lock"; }; else ln -sfn "$CLONE_DIR/node_modules" node_modules; fi; npx tsc --noEmit --incremental false --skipLibCheck -p tsconfig.json; files=$(git diff --cached --name-only --diff-filter=AM HEAD -- "*.ts" | tr "\n" " "); if [ -n "$files" ]; then npx jest --runInBand --passWithNoTests --findRelatedTests $files; else echo "nenhum arquivo de código mudou no merge"; fi
```

## sz4/sz4

Só sintaxe: php -l dentro da imagem do sz4-app nos .php alterados. Não roda PHPUnit.

```sh
set -e; files=$(git diff --cached --name-only --diff-filter=AM HEAD -- "*.php" | tr "\n" " "); if [ -n "$files" ]; then docker run --rm --entrypoint sh -v "$PWD":/w -w /w dark.smartzap.com.br:4567/sz4/sz4/sz4-app:51.0.0 -c 'for f in "$@"; do php -l "$f" || exit 1; done' sh $files; else echo "nenhum PHP mudou no merge"; fi
```

## sz4/sz4-backend

Container efêmero da imagem do sz4-backend, com o volume de node_modules do container sz4-backend em somente leitura. Confere os tipos do código de produção (tsconfig.build.json) e roda os testes Jest relacionados aos .ts alterados no merge. Sem .env. O comando descobre o nome do volume sozinho (docker inspect sz4-backend), então precisa do container sz4-backend criado (não precisa estar rodando).

```sh
set -e; vol=$(docker inspect sz4-backend --format '{{range .Mounts}}{{if eq .Destination "/app/node_modules"}}{{.Name}}{{end}}{{end}}'); [ -n "$vol" ] || { echo "container sz4-backend sem volume de node_modules: crie-o (docker compose up --no-start) antes de verificar"; exit 1; }; files=$(git diff --cached --name-only --diff-filter=ACMR HEAD -- "*.ts" | tr "\n" " "); printf '%s\n' 'const c=require("./jest.config.json");c.moduleNameMapper=Object.assign({},c.moduleNameMapper,{"^src/(.*)$":"<rootDir>/src/$1"});module.exports=c;' > jest.verify.config.js; mkdir -p node_modules; rc=0; docker run --rm --user "$(id -u):$(id -g)" -e FILES="$files" --entrypoint /bin/sh -v "$PWD:/app" -v "$vol:/app/node_modules:ro" -w /app sz4-backend-sz4-backend -c 'node_modules/.bin/tsc --noEmit --incremental false --skipLibCheck -p tsconfig.build.json; t=$?; j=0; if [ -n "$FILES" ]; then node_modules/.bin/jest -c jest.verify.config.js --cacheDirectory /tmp/jest --passWithNoTests --findRelatedTests $FILES; j=$?; else echo "nenhum .ts mudou no merge"; fi; echo "resultado: tsc=$t jest=$j"; [ $t -eq 0 ] && [ $j -eq 0 ]' || rc=$?; rm -f jest.verify.config.js; exit $rc
```

## sz4/sz4-backend: o que esperar

- Os testes Jest do sz4-backend só funcionam no container: `src/...` não resolve fora dele e as dependências vêm do volume de `node_modules` dele. O comando escreve um `jest.verify.config.js` temporário (não versionado, apagado no fim) que carrega o `jest.config.json` do projeto e acrescenta `^src/(.*)$` ao `moduleNameMapper`.
- O type check usa `tsconfig.build.json`: o `tsconfig.json` completo tem erros pré-existentes em specs e em `test/helpers/fake.ts`.
- A main tem falhas de teste pré-existentes (specs `should be defined` de resolvers, controllers e services que não montam o módulo de teste, mais um teste do `AuthResolver`). O comando só reporta: se o merge toca esses módulos, a verificação reprova mesmo sem regressão; compare com a main (mesmos arquivos, sem o merge) antes de decidir.
- Nada é escrito no volume de `node_modules` (montado `:ro`) nem no seu clone; o cache do Jest fica em `/tmp/jest` dentro do container descartável. Os arquivos criados na worktree pertencem ao seu usuário (`--user`).
- Tempo medido: cerca de 30 s para 12 arquivos alterados (21 suítes relacionadas).
