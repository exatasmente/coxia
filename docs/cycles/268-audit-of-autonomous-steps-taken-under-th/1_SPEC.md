# Registro de tudo o que a persona faz sem pedir

## O que muda para quem usa

Hoje alguns passos da persona já ficam no registro de auditoria, mas o registro não diz sob qual política o passo saiu nem de qual nível ela veio, e a mudança da própria política não deixa rastro. Depois desta mudança, a pessoa abre o registro e vê, para cada passo que a persona deu sem perguntar: o que foi feito, quando, por qual agente e qual política estava valendo (com o nível de onde ela veio). Os passos que ficaram retidos esperando um "sim" e foram aprovados ou recusados também aparecem, assim como cada mudança de política. A persona não consegue apagar nem alterar esses registros.

## Palavras da issue

> Every step the persona takes without asking is recorded, so the person can see what was done on their behalf, when, and under which policy.

## O que conta como "passo autônomo"

Todo ponto em que a política de autonomia decide no lugar de um "sim" da pessoa:

- início de etapa do ciclo;
- comando executado no host;
- portão que seguiu sem aprovação;
- push;
- abertura de pull request;
- escrita do quadro no host de código (a escolha do quadro é do workspace).

Um passo que a pessoa aprovou antes de sair não é autônomo; ele é registrado como decisão sobre passo retido (regra 2).

## Regras

1. Cada passo autônomo gera um registro com: o passo, a hora, o agente e a política em vigor, incluindo o nível de onde ela veio.
2. Cada passo retido que a pessoa aprovou ou recusou gera um registro, com a decisão (aprovado ou recusado), a hora e quem decidiu.
3. A persona não pode apagar nem editar registros de auditoria; só a pessoa e o app, por caminhos que a persona não alcança.
4. Toda mudança de política (qualquer nível) gera um registro com o valor anterior, o novo, o nível e a hora.
5. "Política em vigor" é a política efetivamente aplicada naquele passo: as escolhas ligadas ou desligadas e a origem (workspace ou fluxo/squad; os níveis agente, squad e workspace da #269 quando existirem). O nome do nível é o mesmo que a #269 usa.
6. Um passo recusado ou que falhou também é registrado, com o resultado; nenhum passo autônomo sai sem registro.
7. Todo texto novo visível passa por `t()` com os dois catálogos atualizados; a seção `Unreleased` do CHANGELOG é atualizada.

## Fora do escopo

- Criar ou mudar a política de autonomia em si: é a #269.
- Tela nova de consulta, filtro ou exportação do registro, além do que a visão atual do log já mostra (a decidir; ver perguntas).
- Retenção, rotação ou limite de tamanho do log.
- Passos que a pessoa executa sozinha.
- Registros antigos, anteriores a esta mudança, não são reescritos com política/nível.

## Critérios de aceite

1. Com uma política que permite um comando no host, a persona roda um comando; no registro há uma entrada com o passo, a hora, o agente, a política e o nível de origem. Repetir para início de etapa, portão, push, pull request e escrita do quadro.
2. Com a política desligada para um passo, a persona pede o "sim"; ao aprovar, aparece um registro de aprovação; ao recusar, aparece um registro de recusa e o passo não acontece.
3. Nos testes com fakes, a persona (suas ferramentas e canais) não tem como apagar nem alterar o arquivo ou as entradas do registro; uma tentativa falha e o registro fica igual.
4. Mudar a política (por exemplo, ligar "push" no workspace e depois num fluxo) cria um registro por mudança, com antes, depois e nível.
5. O mesmo passo sob política vinda do workspace e sob política vinda de um fluxo mostra níveis diferentes no registro.
6. Os textos novos existem nos dois catálogos (a checagem de idiomas passa) e o CHANGELOG `Unreleased` descreve a mudança.
7. As verificações do projeto (tipos, testes, cores do tema, idiomas, auditoria pública) passam.

## Perguntas em aberto (não bloqueiam o início)

1. Formato exato do campo "nível" (agente, squad, workspace, fluxo): depende da #269; enquanto ela não definir, usar workspace e fluxo, que já existem.
2. A lista de passos autônomos acima cobre tudo? A spec original do product owner chegou truncada; confirmar contra o texto completo se houver critério extra.
3. A visão do log já mostra os novos campos ou uma tela nova é desejada? Proposta: só os campos novos na visão existente.

## Verificado nesta etapa

Lido: o tipo de entrada do log (tem `by`, sem política/nível, sem tipo para mudança de política) e o cálculo da política efetiva e de sua origem. Não verificado: os caminhos de escrita ou remoção que a persona tem hoje no log; nada foi executado.
