# Reemitir a prioridade por squad com a lista real de squads do workspace

## O que é

O pedido, com as palavras da issue:

> Puxar a lista de squads com mission, scope e liaison do workspace e reemitir a prioridade por squad, com o rótulo de tracker configurado porPrioridade do tracker (regra priority-ordering.md).

> A retro quer prioridade por squad, mas a decisão foi tomada sem a config de squads do workspace, o que arrisca alocação por domínio que não casa com o escopo real de cada squad.

Ou seja: não é uma mudança de código do aplicativo. É uma ação de condução do ciclo — refazer uma decisão de prioridade (sugerida na retro de 2026-10-08 sem a config de squads em mãos) usando agora a lista real de squads do workspace como base, e deixar o rótulo de tracker consistente com a regra de prioridade.

## O que muda para quem usa

- Decisões de prioridade deixam de sair de critério ad hoc de domínio: cada pedido volta a ser olhado contra os escopos reais dos squads configurados (mission, scope, liaison), então o que resulta é um recorte por escopo, não por aproximação por área.
- Quem gerencia o tracker vê a prioridade da issue em que foi decidida com o rótulo do nível de prioridade correspondente, conforme a regra de ordenação do workspace, em vez de rótulo ad hoc.
- O squad a que a ação é atribuída é dito explicitamente numa decisão de prioridade reemitida, com os dados usados (mission, scope, liaison), então qualquer pessoa pode conferir depois por que um pedido foi para um squad e não para outro.

## Regras

1. A lista de squads é a da config do workspace (o campo de squads do aplicativo), não uma lista de memória ou retro: mission, scope (repositórios, labels e paths) e liaison de cada squad, por leitura.
2. A reemissão avalia a decisão por squad e atribui cada trabalho do pedido a um squad pelo scope: o gancho são os paths e as labels de área que cada squad declara no seu escopo; um squad só recebe o que casa com o escopo que declara.
3. Trabalho que não casa com o escopo de nenhum squad segue o squad configurado como "pega o que ninguém reivindica" (unclaimed); se nenhum tiver esse recorte, isso fica como decisão em aberto na seguinte ronda da pessoa.
4. O rótulo de tracker sai da regra priority-ordering.md: o cartão carrega a prioridade da primeira entrada de `devCycle.priority.labels` (da mais alta para a mais baixa) que case com uma label da issue; o repositório e a referência do cartão não desempatam. O rótulo só pode ser uma entrada que seja label simples, não uma expressão de casamento parcial: nunca escrever no tracker um rótulo derivado de expressão de casamento.
5. Gravar prioridade no tracker é proposta auditada: nada é escrito no host de rastreamento antes de a pessoa aceitar; até lá só existe proposta na conversa do ciclo.
6. A reemissão é documentada com: a lista de squads usada (mission, scope, liaison), a análise de aderência por squad (paths e labels), o squad designado e o rótulo final, com a diferença entre o que se pensou antes e o que se decidiu agora.

## O que fica fora

- Qualquer mudança de código: nenhum arquivo do `src` deste repositório é alterado por esta ação.
- Redefinir os squads ou seus escopos em si (isso é a config do workspace, não do ciclo): se os escopos mostram aderência fraca a propósito, isso se torna um pedido seu mais tarde, não se resolve aqui.
- Mudar a prioridade ou a regra: nenhum nível de prioridade é criado, renomeado ou reordenado; o rótulo sai da regra como está.
- Pesquisas indeterminadas por qual squad "deveria" ser: quem executa lê a config real, não opina.

## Critérios de aceite

1. A lista de squads usada na reemissão é listada na saída com mission, scope e liaison de cada squad, e veio da config real do workspace (não de resumo da conversa de triagem).
2. Cada trabalho da ação tem um squad designado, com o motivo — os paths ou labels que casam com o escopo do squad, citados da config.
3. Trabalho sem aderência a escopo algum é marcado como tal, e não é dado por designado.
4. O rótulo de tracker proposto é uma das labels de prioridade válidas da config do workspace, e a escolha segue a ordenação de maior para menor da regra de prioridade.
5. Nada é escrito no rastreador pela execução: o rótulo aparece como proposta esperando aceite da pessoa.
6. A decisão reemitida aparece no registro do ciclo (registro de decisão, na ata seguinte ou no pedido em si) junto do porquê, comparável com a decisão original de 2026-10-08.

## Perguntas em aberto

Nenhuma que bloqueie a execução. Os dois materiais fora do repositório (a regra priority-ordering.md em `.claude/rules/` e a ata da retro de 2026-10-08 na pasta de dados) foram entregues nesta etapa só como resumo; quem executa deve lê-los nos locais informados e tratar o conteúdo como definitivo daí em diante.
