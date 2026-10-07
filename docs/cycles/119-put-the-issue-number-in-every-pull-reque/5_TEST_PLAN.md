# Plano de teste: o número da issue no título da pull request e em todo commit de uma execução

## O que este plano cobre

Os dez critérios de aceite de `1_SPEC.md`, exercitados pelo que a mudança
entregou: a função que monta o título a partir do molde, a validação que recusa um
molde sem o número, a migração de esquema, a mensagem do commit do conflito, o
caminho que a tela Time pelo navegador aceita e a documentação da configuração.

O que foi rodado nesta etapa, e o resultado:

- A suíte de oito arquivos que tocam a mudança, **167 testes, todos passando**:
  `runner-units`, `runner-config`, `config-migrations`, `config-web-scope`,
  `team-runner-edit`, `conflict-resolve`, `runner-publish` e `config-schema`.
- `npx tsc --noEmit`: limpo.
- Um roteiro próprio de caixa preta, escrito nesta etapa e rodado contra as fontes
  compiladas, com **19 de 19 verificações passando** (detalhado abaixo).
- `node scripts/public-audit.mjs` (911 arquivos), `npm run i18n:lint` (4059 chaves
  nos dois idiomas) e `node scripts/theme-audit.mjs`: passam.
- A suíte inteira (`npx vitest run`): 3663 passando, 13 falhas em 4 arquivos, todas
  por tempo de espera sob carga paralela (`runner-release` com um gancho estourando
  10 s, `conflict-resolve` com testes estourando 5 s e um encadeamento de conflito
  travando o próximo, `runner-chain` com um estado lido tarde demais, e a falha
  conhecida de `update-script`). Os quatro arquivos, rodados sozinhos, passam com
  **67 testes, nenhuma falha**, o que mostra que a carga, não a mudança, causou as
  falhas. Ver a seção "Não verificado" para o que isso ainda deixa em aberto.

## Caixa preta, pelo que a pessoa veria

Roteiro escrito nesta etapa, carregando as fontes do repository sem o app: exercita
as funções puras e a migração exatamente como o produto as chama, sem modelo, sem
host de código e sem rede. Resultado: **19 de 19**.

Título da pull request:

- Molde padrão: `{title} #{iid}` com o título `Add the thing`, issue 321 → `Add the thing #321`.
- Molde com o número primeiro: `#{iid} {title}` → `#321 Add the thing`.
- Um título que já termina no número (`Add the thing #321`) não fica com o número duas vezes.
- Um título de 200 caracteres é cortado em 120 e o `#321` continua no fim.
- Uma execução sem issue (número 0): `Release 9.9.9` sai sem `#` solto; o molde
  `#{iid} {title}` também larga o `#` e o número.

O número não pode ficar de fora:

- Um `prTitle` sem `{iid}` é recusado pela validação.
- Um `commitMessage` sem `{iid}` é recusado pela validação.
- Um `prTitle` sem `{title}` é recusado pela validação.
- O documento padrão (com os dois moldes completos) valida.

Migração:

- Um arquivo que guardou `fix: {summary}` ganha ` #{iid}` na leitura, e o
  `prTitle` nasce com `{title} #{iid}`.
- Um arquivo que já guardou `chore({iid}): {summary}` não é reescrito.

Commits:

- A mensagem do commit de uma etapa de issue carrega o número (`feat: add the thing #321`).
- A mensagem de uma execução sem issue (registro de release) larga o número e o `#`.
- A montagem da mensagem do conflito (a mesma função pura, com o resumo
  `Merge branch 'main' into '<branch>'`) carrega o número quando há issue e volta à
  mensagem simples sem número quando não há.

Tela Time pelo navegador:

- Salvar o caminho `runner.prTitle` é aceito.
- O caminho `runner.commands` continua recusado.

## O que só foi lido

- A tela renderizada em si (`RunnerSection.tsx`, o rascunho `runnerEdit.ts`, os dois
  catálogos de idioma): conferidos por leitura; nenhuma tela foi aberta num navegador.
- A doc `docs/configuration.md` (a lista de campos, o histórico do esquema com o
  `v13`, a linha do canal `config:cycle-save` nos dois idiomas) e o `CHANGELOG.md`:
  conferidos por leitura.
- Os logs de release (`src/main/releaseGit.ts`) mantêm as mensagens próprias
  (`Merge pull request #<n> from <source>` e `Merge <branch>`): conferidos por
  leitura; nenhum merge de release foi executado nesta etapa.

## Não verificado

- Uma execução real do app abrindo uma pull request num host de código: o roteiro
  exercita a função pura, não o app inteiro; o caminho de ponta a ponta não foi visto.
- A tela num navegador pareado de verdade: o que há é o teste da lista de caminhos
  aceitos e o roteiro próprio sobre `refusedPaths`, não a tela em uso.
- O commit do conflito como um `git merge` real num worktree de conflito: exercitado
  pela função pura e pelos testes do caminho, não reproduzido à mão.
- Nenhuma migração foi aplicada sobre o arquivo de configuração de um espaço de
  trabalho real: o que há é a migração sobre documentos de teste.
- As 13 falhas da suíte completa sob carga paralela, todas de tempo de espera:
  nenhuma aponta para a mudança (os mesmos arquivos passam sozinhos, e nenhuma
  mensagem de falha toca no título, na migração ou na mensagem do commit), mas
  ficam registradas como risco de execução paralela, não como comportamento
  verificado.
