# Documentos de requisitos, protótipo e manual no fluxo do ciclo

## Tipo

Pedido de funcionalidade. Não é bug nem pergunta e não duplica outra issue: pede que a pasta de uma execução ganhe documentos de requisitos, protótipo e manual do usuário, declarados por um plugin que vem com o aplicativo e lidos pela fase e pelo gate sem mudar o núcleo. O protótipo em alta fidelidade fica de fora, dito pela própria issue.

## Dá para entender como está escrita

Dá. É um pedido de capacidade nova, com escopo e aceite escritos, escopo confirmado em comentário de quem abriu e dependência declarada da plataforma de plugins. Conferido por leitura nesta árvore, sem executar nada nesta etapa:

- Um plugin pode declarar tipos de documento novos do ciclo: a documentação de plugins descreve essa oferta, e o gate soma os documentos dos plugins ligados aos artefatos que já lê. Existe um teste cobrindo essa soma — lido, não rodado.
- O único plugin que vem no repositório declara um documento só (o de busca web). Nenhum declara requisitos, protótipo ou manual, e a origem não tem conceito de manual do usuário: o pedido ainda não começou.
- O arquivo de regras citado pela issue não existe nesta árvore. A descrição dos artefatos do ciclo está nos documentos do projeto: a fase vem do arquivo configurado de fase que exista na pasta, do mais avançado para o primeiro, e o gate lê o artefato de cada portão.
- A fase é calculada somente com a lista configurada de arquivos de fase: um documento declarado por plugin entra na leitura do gate e, hoje, não move a fase do cartão. Isso foi lido, não exercitado.

## O que falta

Nada que só quem abriu a issue possa dizer: não havendo defeito a reproduzir, o restante que ele só poderia contar (o que viu, como reproduzir, o que esperava) não se aplica, e a confirmação de escopo dele já está nos comentários. O que não está fixado é terreno do refino:

- Os nomes de cada documento e em qual etapa cada um é produzido e lido.
- Onde o manual do usuário aparece, para "ficar onde a pessoa espera encontrá-lo".
- Se o plugin embutido vem ligado por padrão em espaço de trabalho novo ou é ligado pela pessoa.
- Se os documentos novos também movem a fase do cartão ou só entram na leitura do gate.

## Sugestão de prioridade

`priority:low` (a mesma que a issue já traz). Não é defeito, não bloqueia ninguém e acrescenta capacidade ao fluxo; se alguém precisar do manual no processo, pode subir para `priority:medium`.

## Issues relacionadas

Nenhuma duplicata: a busca nos textos das issues do ciclo não achou outro pedido de requisitos, protótipo ou manual.

- #84 — plataforma de plugins: é a dependência declarada e a base já entregue; esta issue pede documentos em cima dela, não repete o pedido.
- #97 — busca web, o primeiro plugin: declara um documento novo do ciclo do mesmo jeito e a etapa seguinte o lê; serve de precedente, não pede a mesma coisa.
- #96 — plugins alcançam serviços externos: mesmo terreno de plataforma, outro pedido (configurações, segredos e requisições).
