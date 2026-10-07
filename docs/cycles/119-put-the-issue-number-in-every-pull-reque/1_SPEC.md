# O número da issue no título da pull request e em toda mensagem de commit de uma execução

## O que se pede

A issue pede que "every pull request (merge request) a run opens carries the issue's number in its title, and every commit the app makes for an issue run carries it in its message", nos dois casos a partir de um molde em Configurações › Runner "that cannot leave the number out".

Hoje, nas palavras da issue:

> **Commits**: `runner.commitMessage` defaults to `feat: {summary} #{iid}` (`src/main/runner/git.ts`, `commitMessage`), but validation only requires `{summary}` (`src/shared/config/validate.ts`): a template without `{iid}` is accepted and the commits go out without the number.
>
> **Pull request title**: the title the agent wrote (`output.pr.title`) or the issue's title, never the number (`src/main/runner/publish.ts`, where the `pr` draft and the `createMr` proposal are built).

O pedido tem três partes, como a issue as escreve:

> ### 1. A template for the pull request title
>
> - A new field, `runner.prTitle`, next to `runner.commitMessage`, with the placeholders `{title}` (the title the agent wrote, or the issue's title) and `{iid}`. Default: `{title} #{iid}`.
> - The title is built from the template when the draft is made and again when the proposal is made, so the proposal, Actions and the code host show the same text. The 120-character cap applies to `{title}`, never cuts the number.
> - A title that already carries the number (the agent wrote `#123` in it) does not get it twice.
>
> ### 2. The number cannot be left out
>
> - Both templates must contain `{iid}` (and `commitMessage` still `{summary}`, `prTitle` `{title}`); validation refuses a template without it, in the editor and on import.
> - A run with no issue (a release run, a documentation run: `iid` 0) drops the number and the `#` before it, as `commitMessage` already does.
> - Migration: a stored `commitMessage` without `{iid}` gets ` #{iid}` appended; `prTitle` is added with the default. Nothing else moves.
>
> ### 3. Every commit of an issue run
>
> Every commit the app makes for an issue run goes through `commitMessage`: the stage commits, the issue record, the cycle memory and the commit of a conflict resolution made for a run's branch (`src/main/conflictGit.ts`, `mergeMessage`). Merge commits of a release (`src/main/releaseGit.ts`) keep their own messages.

## O que muda para quem usa

Quem mantém um repositório passa a poder escolher como o título da pull request e a mensagem dos commits levam o número da issue, e não consegue mais configurar um molde que deixe o número de fora.

No dia a dia:

- Uma execução de uma issue abre a pull request com o número no título, no formato escolhido em Configurações › Runner. O mesmo texto aparece na proposta em Ações, na tela da execução e no host de código.
- Todo commit que o app faz para uma execução de issue leva o número, inclusive o commit que resolve um conflito da branch dessa execução — que hoje sai sem número.
- Um título escrito pelo agente que já traz o número não ganha o número duas vezes.
- Um molde de título ou de commit sem o número é recusado ao salvar e ao importar, dizendo o motivo; o campo novo fica ao lado do molde de commit, que continua existindo.
- Execuções que não são de uma issue, como uma release ou uma execução de documentação, não ficam com um `#` solto no título nem na mensagem.
- Espaços de trabalho já existentes continuam funcionando: um molde de commit sem o número ganha o número anexado ao ser lido, e o molde de título nasce com o formato padrão.

## Regras

### O título da pull request

1. Existe um molde próprio para o título, ao lado do molde da mensagem de commit, com dois espaços a preencher: o título (o que o agente escreveu ou, sem ele, o título da issue) e o número da issue.
2. O formato padrão é o título seguido do número da issue.
3. O título é montado com esse molde nos dois momentos em que ele existe hoje: quando o rascunho do pull request é escrito e quando a proposta que cria o pull request é feita. O texto é o mesmo nos dois, e é ele que a proposta em Ações, a tela da execução e o host de código mostram.
4. O limite de 120 caracteres vale para o título escrito pelo agente; o número e o que o molde põe em volta dele não são cortados.
5. Um título que já traz o número da issue não recebe o número de novo.

### O número não pode ficar de fora

6. Os dois moldes precisam do espaço do número; o molde de commit continua precisando do resumo, e o de título continua precisando do título. Um molde sem o número é recusado com o motivo, tanto ao salvar no editor quanto ao importar um arquivo de configuração.
7. Uma execução sem issue não deixa número nem `#` sobrando: o número e o `#` antes dele saem do texto, como já acontece hoje com o molde de commit.
8. Um molde de commit guardado sem o número é lido como um molde com o número anexado; o molde do título entra com o formato padrão. Nada mais da configuração se move.

### Os commits de uma execução de issue

9. Todo commit que o app faz para uma execução de issue leva o número: os commits de etapa, o registro da issue, a memória do ciclo e o commit que resolve um conflito da branch dessa execução.
10. Os merges de uma release continuam com as mensagens próprias deles.

### Onde a pessoa mexe

11. O campo novo fica em Configurações › Runner, ao lado do molde da mensagem de commit, e aparece nos dois idiomas da interface.
12. A tela Time, usada também por um navegador pareado, salva o campo novo como já salva o molde da mensagem.

## Fora do escopo

- Commits que uma pessoa faz à mão na branch da execução.
- O título de uma pull request que já existe: o app não a renomeia.
- As mensagens dos merges de uma release, que seguem como estão.
- O texto do título e do resumo em si: o molde não muda o que o agente escreveu, só onde o número entra.
- Um commit que o app faz fora do fluxo de uma execução e que não passa pelo molde de commit hoje.

## Critérios de aceite

Exemplos escritos com número de issue neutro (o número de exemplo que a issue usa não pode aparecer em arquivo público; um número de exemplo como `#321` serve).

1. Uma execução de uma issue com os valores padrão abre uma pull request com o título formado pelo título e pelo número da issue; o mesmo título aparece na proposta em Ações e no host de código.
2. Com o molde de título em `#{iid} {title}`, a pull request abre com o número antes do título.
3. Um título escrito pelo agente que já termina no número da issue não fica com o número duas vezes.
4. Salvar e importar um molde de commit sem o número são recusados, com o motivo; o mesmo para o molde de título.
5. Salvar e importar um molde de título sem o espaço do título são recusados, com o motivo.
6. Um título longo escrito pelo agente é cortado no limite, e o número continua no fim do título final.
7. Um espaço de trabalho cujo molde de commit guardado não tem o número passa a valer com o número anexado, e todo commit de uma execução de issue leva `#<n>` — inclusive o commit que resolve um conflito da branch dessa execução.
8. Uma execução sem issue produz título e commits sem `#` solto.
9. Salvar o molde do título pela tela Time no navegador pareado funciona.
10. Os merges de uma release continuam com as mensagens próprias deles.

## O que foi conferido nesta etapa, e o que não foi

Leitura de código, sem executar nada e sem ver a mudança funcionando:

- O estado atual que a issue descreve confere, como a triagem já apontava: o título do rascunho do pull request e o da proposta saem hoje do título do agente ou do da issue, com corte em 120 caracteres, sem número; a mensagem de commit tem um molde com número no padrão e não exige o número na validação; o commit do conflito da branch de uma execução usa uma mensagem própria, sem número ("Merge branch 'main' into '<branch>'"); os merges de release têm mensagem própria.
- O número da issue chega ao commit do conflito a partir da ação de conflito, que já carrega o número da issue e cujo registro guarda o número da pull request e a branch de origem — mas **não há, por leitura, nenhum caminho que hoje transporte esse número nem um molde até esse commit**; ligar isso é decisão de desenho, não desta etapa.
- O molde do título precisa entrar na lista de caminhos que a gravação da tela Time pelo navegador aceita, e há também o `prTitle` que precisa ser escrito de volta ao formular o rascunho. Ambas as coisas foram lidas no código; nenhuma foi exercitada.
- Não verificado: nenhum teste foi rodado, nenhum comportamento foi reproduzido, nenhuma migração foi executada, e nenhum auditoria pública foi executada. Os nomes de arquivo, funções e linhas da seção técnica vêm de leitura; os testes que a mudança obriga a mover foram identificados por leitura e não foram rodados.
