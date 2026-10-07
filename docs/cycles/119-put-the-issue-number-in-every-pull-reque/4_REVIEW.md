# Revisão: os cinco achados fechados e as portas repetidas

## Veredito

Aprovado.

Os cinco achados que a revisão anterior deixou abertos foram fechados, e o que foi
fechado está confirmado por execução. O comportamento central do pedido continua de
pé: o molde do título da pull request, a exigência do número nos dois moldes, a
migração do esquema, o número no commit do conflito e o campo novo aceito pela tela
Time no navegador. A suíte inteira passa e nenhuma porta fica vermelha. Nada nesta
mudança cria caminho de escrita no host de código fora da porta das Ações.

## O que segue aberto de rondas anteriores

Nada. Os cinco achados da rodada anterior estão fechados, como se confere abaixo:

- As duas versões de esquema esquecidas em `test/agent-team.test.ts` passaram para a
  versão corrente (13) — conferido nas linhas 35, 43 e 266 do arquivo, as três agora
  na mesma versão.
- A recusa de um documento de um aplicativo mais novo em `test/config-schema.test.ts`
  passou a usar a versão seguinte à corrente (14) — conferido na linha 80, que agora
  espera a mensagem de recusa e a recebe.
- O objeto do padrão do runner em `test/runner-config.test.ts` ganhou o campo do título
  — conferido na linha 12, que agora traz o molde novo ao lado do molde da mensagem.
- As recusas somadas do editor em `test/team-runner-edit.test.ts` entraram — conferido
  nas linhas 92 a 94, que esperam as duas recusas, do resumo e do número.
- A montagem do título na proposta deixou de partir do título guardado sem checar o
  registro — conferido em `src/main/runner/publish.ts`, que agora prefere o título do
  registro e, quando ele não serve, o título da issue, os dois passando pelo molde.
- O campo novo entrou na tabela de campos do runner na documentação, nos dois idiomas
  — conferido nas duas tabelas e no histórico do esquema, que descrevem a versão nova.

## O que foi verificado nesta etapa

### Rodado

- `npx tsc --noEmit`: **passa**, sem nenhuma saída.
- `npx vitest run` de toda a árvore: **3676 testes passam, nenhuma falha**, em 222
  arquivos. A falha de `test/update-script.test.ts` que a passada anterior relatou não
  reproduz nesta execução; o arquivo, rodado à parte, passa com 12 de 12. Isso confirma
  que era flutuação de tempo da execução paralela e não regressão.
- Os nove arquivos de configuração, runner e conflito, juntos: **200 testes passam,
  nenhuma falha**.
- `node scripts/public-audit.mjs`: passa — "911 files, nothing that belongs to a
  company or a person".
- `npm run i18n:lint`: passa — "4059 in both languages (11 catalogs)".
- `node scripts/theme-audit.mjs`: passa — os 8 usos de cor literal de `api.ts` são
  anteriores a esta mudança.
- `npx electron-vite build` (o empacotamento que o CI roda): **passa**, construído em
  1 min 14 s.

### Lido e conferido no código

- A fronteira de segurança: o diff de `src/main/` não acrescenta chamada de escrita ao
  host, canal novo nem permissão nova. O campo do título só entra numa lista de
  caminhos que a tela Time já podia gravar, a montagem do título é uma função pura
  usada onde o texto já era montado, e a mensagem do commit do conflito lê o número do
  registro da execução e o molde do config onde a identidade do commit já era lida.
- A regra da migração só toca em `runner.commitMessage` e `runner.prTitle`; um molde de
  mensagem que já traz o número não é reescrito.
- A validação recusa o molde de título sem o título e sem o número, e o molde de
  mensagem sem o resumo e sem o número; os dois continuam exigindo uma linha.
- A tela Time pelo navegador salva o campo novo: o caminho entrou na lista de caminhos
  aceitos, e a documentação dos canais nos dois idiomas o cita.

## O que ficou fora desta revisão

- Uma execução de verdade abrindo uma pull request num host de código: nenhuma foi
  feita; o comportamento foi exercitado por teste e pela função de montagem do título,
  não visto no app.
- O comportamento num navegador pareado de verdade: o que foi conferido é a lista de
  caminhos aceitos e os testes dela, não a tela em uso.
- O commit do conflito em si (um merge real num worktree de conflito): conferido por
  leitura do código e pelos testes do caminho, não reproduzido à mão.
- Nenhuma migração foi executada sobre o arquivo de configuração de um espaço de
  trabalho real.
