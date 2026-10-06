# Revisão: o número da issue no título da pull request e na mensagem dos commits

## Veredito

Mudanças pedidas.

O comportamento pedido está de pé e foi exercitado nesta etapa: o título da pull
request sai dos dois moldes com o número, a execução sem issue não deixa `#` solto, a
migração leva um arquivo guardado ao número, o commit do conflito passa a levar o número
da issue e o campo novo é aceito pela tela Time no navegador. A entrega, porém, não pode
passar como está: seis arquivos de teste ficaram sem acompanhar a mudança e derrubam a
checagem de tipos e a suíte, dois textos novos da interface dizem "pull request" no
catálogo português (a verificação que impede uma palavra de um host aparecer em outro
falha por causa disso) e as chaves novas ficaram fora da ordem alfabética que os
catálogos exigem. O caminho de escrita no host de código não cresceu em lugar nenhum.

## O que foi verificado nesta etapa

### Rodado

- `npx tsc --noEmit`: **falha**, com erro de sintaxe em `test/runner-publish.test.ts`, nas
  linhas 638 a 641. É a única falha de tipo da árvore.
- `npx vitest run` (a suíte inteira, esta rodada): **3647 testes passam, 12 falham**, em
  10 arquivos de 222. As falhas estão em
  `test/runner-publish.test.ts` (sintaxe; nenhum teste chega a ser coletado),
  `test/agent-team.test.ts` (3), `test/config-schema.test.ts` (2),
  `test/config-transfer.test.ts` (1), `test/comment-config.test.ts` (1),
  `test/wizard-shared.test.ts` (1), `test/runner-config.test.ts` (1),
  `test/team-runner-edit.test.ts` (1), `test/host-terms-leak.test.ts` (1) e
  `test/ui-i18n.test.ts` (1).
- `node scripts/public-audit.mjs`: passa — "911 files, nothing that belongs to a company
  or a person".
- `node scripts/theme-audit.mjs`: passa — os 8 usos de cor literal de `api.ts` já
  existiam antes desta mudança.
- `npm run i18n:lint`: passa — "4059 in both languages (11 catalogs)".
- Arquivos rodados inteiros e verdes: `test/runner-units.test.ts` (29),
  `test/config-migrations.test.ts` (28), `test/conflict-resolve.test.ts` (22),
  `test/config-web-scope.test.ts` (20), `test/runner-lifecycle.test.ts` (52);
  `test/runner-e2e.test.ts` e `test/runner-lifecycle.test.ts` juntos, 57 passando.
- A suíte completa foi rodada dividida por arquivos, um comando por vez, dentro do limite
  de tempo de cada comando.

### Lido e conferido no código

- Os dois moldes têm `{iid}` obrigatório, além de `{summary}` no de commit e `{title}` no
  de título, no validador e no editor (`src/shared/config/validate.ts:143-148`,
  `src/renderer/src/screens/team/runnerEdit.ts:132-138`), e as três mensagens de recusa
  têm chave nos dois catálogos.
- O título é montado pela mesma função pura nos dois momentos: no rascunho
  (`src/main/runner/publish.ts:674`) e na proposta que vira a criação no host
  (`:692`, alimentando `planWrite({ op: 'createMr', ... })` em `:697`). O texto gravado no
  registro é o mesmo que vai ao host.
- O corte de 120 caracteres vale sobre o título do agente, antes de o número entrar, e um
  título que já traz uma referência `#<n>` mantém a dele sem receber outra; execução sem
  issue larga o `#` e o número.
- A migração `v12ToV13` está ao fim de `STEPS` e roda pela cadeia que já existia; anexa
  ` #{iid}` a um `commitMessage` guardado sem o número, cria `prTitle` com o padrão e não
  toca no resto (`src/shared/config/migrations.ts:266-276`).
- `runner.prTitle` entrou em `WEB_EDITABLE` (`src/main/configScope.ts:25`) e nas duas
  listas do canal `config:cycle-save` em `docs/configuration.md` (`:118` e `:266`).
- O commit do conflito monta a mensagem com o molde do workspace e com o número que a ação
  já carrega, na mesma leitura de configuração que a identidade já fazia
  (`src/main/actions.ts:709-711` e `:861`); sem número, a mensagem de hoje continua sendo a
  base (`src/main/conflictGit.ts:331-339`).
- Os merges de uma release não foram tocados.
- A fronteira de segurança: nada nesta mudança cria caminho de escrita no host fora da
  porta das Ações. O diff não acrescenta chamada de escrita ao host, canal novo nem
  permissão nova; o campo novo só entra numa lista de caminhos que a tela Time já podia
  gravar.

## Achados

### 1. O arquivo de teste não compila

`test/runner-publish.test.ts` termina com quatro linhas repetidas de um trecho que já
aparece acima (linhas 634 a 637) e mais um pedaço de frase solto. O `npx tsc --noEmit`
falha nesse ponto e nenhum teste do arquivo chega a rodar. É a correção mais urgente,
porque derruba a checagem de tipos e leva o arquivo inteiro com ela.

### 2. Seis arquivos de teste ficaram com a versão 12 do esquema

Um documento com `schemaVersion` 12 que chega à validação sem migração é recusado como
"de um app mais novo", e há testes que esperam o contrário:

- `test/config-schema.test.ts:80` (espera a mensagem de recusa de um documento 13) e
  `:109` (espera que um documento 12 seja aceito e preenchido pelos padrões);
- `test/agent-team.test.ts:35`, `:43` e `:266` (os cinco agentes nativos voltam, os
  papéis semeiam o agente, a autonomia do time);
- `test/config-transfer.test.ts:182` (um arquivo de importação 13 deveria ser recusado por
  ser mais novo, e agora é o esquema corrente);
- `test/comment-config.test.ts:154` (a mesma recusa com 13);
- `test/wizard-shared.test.ts:114` (o nome do usuário de um documento 12).

São seis arquivos, não os três que a implementação apontou, e o `npx tsc --noEmit` não os
pega: só rodando cada arquivo de teste eles aparecem.

### 3. O objeto do runner do teste não tem o campo novo

`test/runner-config.test.ts:12` fixa o objeto `runner` campo a campo e não ganhou
`prTitle`; o padrão o tem e a expectativa não, e o teste falha. O próprio plano já pedia
"atualizar, não contornar".

### 4. O teste do editor não acompanhou o molde de commit

`test/team-runner-edit.test.ts:92` espera só `error:commitSummary` para `feat: stuff`,
mas o molde sem `{iid}` agora produz a segunda mensagem, `error:commitIssue`. O teste é
anterior à mudança e ficou para trás.

### 5. Dois textos novos dizem gitlab no que é do produto

A verificação que impede a palavra de um host aparecer em outro renderiza cada texto do
catálogo em cada host. `ui.runner.prTitle` ("Título da pull request") e
`ui.runner.err.prTitleIssue` ("toda pull request de uma execução…") são gravados no
catálogo português com a palavra de outro host e falham nessa verificação
(`test/host-terms-leak.test.ts`, as duas entradas de
`src/shared/i18n/ui-team.pt-BR.json:189` e `:203`). Os textos vizinhos do mesmo
formulário usam o substantivo do host (`ui.comments.event.pr`,
`ui.runner.soleMaintainerHint`), e as mesmas chaves em inglês usam `{crLong}`
(`src/shared/i18n/ui-team.en.json:189` e `:203`).

### 6. As chaves novas ficaram fora da ordem dos catálogos

`ui.runner.prTitle`, `ui.runner.prTitleHint`, `ui.runner.err.commitIssue`,
`ui.runner.err.prTitleIssue` e `ui.runner.err.prTitleTitle` estão fora da ordem
alfabética em `ui-team.en.json` e em `ui-team.pt-BR.json`, e a verificação que exige a
ordem falha (`test/ui-i18n.test.ts`).

### 7. A lista de campos do runner na documentação ficou sem o campo novo

`docs/configuration.md:42` e `:190` listam os campos de `runner` sem o molde do título,
embora o parágrafo logo abaixo o descreva nos dois idiomas. Quem lê a tabela não encontra
o campo que a mudança acrescentou.

### 8. A proposta do pull request não passa pelo molde de novo

O rascunho é montado pelo molde no fim de cada etapa (`src/main/runner/publish.ts:674`) e
a proposta usa o título já guardado no registro (`:692`). A especificação pede que o
título seja montado "quando o rascunho é feito e de novo quando a proposta é feita":
com um registro `pr` guardado antes desta mudança, sem `title`, a proposta cai no título
sem número da issue e abre a pull request fora do molde.

## O que a revisão decidiu sobre os dois pontos que o desenvolvedor levantou

### A regra do título que já traz o número

O que ficou implementado é o que a especificação pede: "Um título que já traz o número
não recebe o número de novo". A implementação é mais generosa que a letra mínima —
reconhece qualquer referência `#<n>` e, nesse caso, deixa o molde inteiro sem o número,
em vez de reconhecer só o número daquela issue. Isso não deixa o número de fora numa
execução normal (ele já está lá, escrito pelo agente) e é a direção segura em relação ao
que a issue pede. Está fixado em teste com o número no fim, no começo e no meio. Não é
um defeito.

### O `commitMessage` que já tem `{iid}`

A migração não o reescreve, e isso é o que a especificação pede ("Nada mais da
configuração se move"). Sem reparo a fazer.

## O que ficou fora desta revisão

- O build do CI (o empacotamento de produção): não foi rodado.
- Uma execução de verdade abrindo uma pull request num host de código: nenhuma foi feita;
  o comportamento foi exercitado por teste.
- O comportamento num navegador pareado de verdade: o que foi conferido é a lista de
  caminhos aceitos e os testes dela, não a tela em uso.
- O commit do conflito em si (um merge real num worktree de conflito): conferido por
  leitura do código e pelos testes do caminho, não reproduzido à mão.
- Nenhuma migração foi executada sobre um arquivo de verdade de um espaço de trabalho.
