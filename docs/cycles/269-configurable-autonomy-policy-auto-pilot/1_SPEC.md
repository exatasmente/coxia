# Especificação: política de autonomia configurável

## O que muda para quem usa

Hoje todo passo irreversível dado pela persona no navegador do app pede a aprovação da pessoa. Com a política, a pessoa define quais tipos de passo a persona executa sozinha e quais continuam pedindo. Quem não configura nada não vê mudança.

A política vale em três níveis (agente, squad e workspace) e a tela de configurações mostra, para cada tipo de passo, se ele está **retido** (pede aprovação) ou **autônomo** (roda sem pedir) e de qual nível vem essa decisão.

## Tipos de passo

São os motivos de retenção que o app já tem, sem tipos novos:

1. envio de formulário;
2. nome do controle (o controle tem um nome que indica ato irreversível);
3. atalho de teclado;
4. diálogo;
5. passo não reconhecido (o app não consegue ler o que o passo faz);
6. confirmação pedida pelo próprio agente.

## Regras

1. A política diz, para cada tipo de passo acima, se ele é **retido** ou **autônomo**.
2. A política é configurável em três níveis: agente, squad e workspace.
3. Precedência: vale o nível do agente se configurado; senão o do squad; senão o do workspace. A decisão é por tipo de passo: um nível que configura só alguns tipos deixa os demais para o nível seguinte.
4. O padrão mantém tudo retido; o comportamento de hoje não muda sem configuração.
5. Pagamento, envio a pessoas, segredos e dados de cartão ficam sempre retidos, em qualquer nível e em qualquer tipo de passo. Se a política tenta liberá-los, a liberação é ignorada e a pessoa vê um aviso. Esses casos são detectados como hoje: por palavras no nome do controle (e nas palavras da confirmação do agente). Essa detecção vale **antes** da política: um passo de "nome do controle" ou de "confirmação do agente" liberado continua retido se o nome cai numa dessas quatro categorias.
6. O aviso da regra 5 aparece onde a pessoa configura, e também quando um passo é retido por esse motivo apesar de a política o ter liberado, para que a pessoa saiba por que foi perguntada.
7. Um passo liberado pela política roda sem perguntar e gera um registro de auditoria que diz que foi autônomo, por qual política e de qual nível (o formato do registro é o da auditoria dos passos autônomos).
8. O texto das regras de tela do prompt (`runner.rules.screen*`) é gerado a partir da política em vigor para aquele agente, de modo que o prompt nunca diga uma coisa e o app faça outra. Para um agente sem nenhuma configuração, o prompt continua o mesmo de hoje, palavra por palavra.
9. Mudar a política vale a partir da próxima etapa; etapas em andamento seguem com a política com que começaram. Cada mudança é registrada (quem, quando, o que mudou e em qual nível).
10. `screen_handoff` continua existindo e funciona como hoje; a política não o altera.
11. A tela de configurações mostra, por tipo de passo, o modo (retido ou autônomo) e o nível de origem (agente, squad, workspace ou padrão), para o agente escolhido.
12. Todo texto novo para a pessoa passa por `t()` com os dois catálogos (en e pt-BR) atualizados, sem cores literais; a seção `Unreleased` do CHANGELOG.md é atualizada.
13. O nome da política na interface deve se distinguir do que o app já chama de "autonomia" (as chaves de autonomia do ciclo, do fluxo, do squad e do agente, que governam outra coisa: se etapas começam e passam sozinhas). A política trata só dos passos irreversíveis da persona na tela.
14. Esta mudança não vai à produção sem a auditoria dos passos autônomos (#268).

## Fora do escopo

- Tipos de passo novos.
- Qualquer liberação de pagamento, envio a pessoas, segredos ou dados de cartão.
- Mudar a heurística de palavras além do necessário para separar as quatro categorias sempre retidas.
- Mudar o "sim para o resto desta tela neste site" dado hoje a passos não reconhecidos.
- Mudar `screen_handoff`.

## Critérios de aceite

1. Sem nada configurado, num passo "Enviar pagamento" o app pede aprovação, como hoje: ver a janela de aprovação.
2. Com "nome do controle" liberado no workspace, um clique num controle com nome de ato não pertencente às quatro categorias (por exemplo "Salvar rascunho") roda sem pedir e aparece um registro de auditoria marcado como autônomo.
3. Com "nome do controle" liberado, um clique em "Pagar agora" continua pedindo aprovação e a pessoa vê o aviso.
4. O mesmo vale para um controle que envia a pessoas ("Enviar mensagem"), um campo de senha ou segredo e um campo de cartão: seguem retidos, com aviso.
5. Ao tentar liberar essas categorias na configuração, a liberação é ignorada e o aviso é mostrado; a tela segue mostrando o passo como retido.
6. Precedência: com o workspace autônomo, o squad retido e o agente sem configuração, o passo do agente fica retido (squad vence workspace); com o agente autônomo e o squad retido, o passo roda (agente vence squad). Cobertos por testes com fakes.
7. A tela de configurações mostra, para cada um dos seis tipos de passo, o modo e o nível de origem; mudar o nível de origem atualiza a exibição.
8. Mudar a política durante uma etapa não altera essa etapa; a etapa seguinte usa a nova política, e a mudança aparece registrada.
9. O texto das regras de tela no prompt de um agente com um tipo liberado diz que esse tipo roda sem pedir; com tudo retido o texto é idêntico ao de hoje.
10. `screen_handoff` se comporta como antes (oferta, respostas e prompt inalterados).
11. Textos novos existem em en e pt-BR (`npm run i18n:lint` passa); CHANGELOG atualizado.
12. Os checks do repositório do AGENTS.md passam (tsc, vitest, theme-audit, i18n:lint, public-audit).

## Perguntas em aberto

Nenhuma bloqueia a continuação. Para o planejamento decidir:

- Ambiguidade de "nome do controle": a lista de palavras de hoje mistura pagar/comprar/enviar/compartilhar com salvar/apagar. A política precisa de uma detecção própria das quatro categorias sempre retidas; as palavras para segredos e cartão não constam da lista de hoje e precisam ser definidas (não verificado se a leitura da página já marca campos de senha ou cartão). A heurística segue com os limites já documentados (um controle chamado "Ir" que paga não é pego).
- Confirmações do agente: ver se a confirmação já traz o tipo do que confirma, para aplicar a regra 5.
- Onde fica a política no armazenamento por nível (agente, squad, workspace) e como o registro de mudanças se liga ao registro da auditoria de #268 (não verificado: formato e sobreposição dos registros).
- Nome da política na interface (regra 13).

## Prioridade proposta

priority:medium: é opcional para quem não configura, mas só entra em produção junto com #268. Sem marco proposto (a memória do workspace não tem roadmap).
