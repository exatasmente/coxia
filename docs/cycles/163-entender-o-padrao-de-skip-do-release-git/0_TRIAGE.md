# Investigação do padrão de skips nos passos de release

**Tipo:** pedido de investigação (não é bug, nem pedido de mudança de comportamento, nem pergunta de suporte). Vem de uma retro de 08/10/2026, na dimensão release, e pede um exame: entender o que leva cada skip acumulado pelas executions de release antes de fechar a próxima release.

## Dá para entender como está

Sim, como pedido escrita. A issue afirma que a release listada na issue 75 acumulou dezenas de passos marcados como skipped, a da 151 teve 6 e a da 115 teve 5 antes de virar done, e pede examinar as causas. O mecanismo existe e é verificável no código lido:

- Os passos de uma release são ações do tipo `release-git` (abrir branch, fazer merge de PR, cortar beta, empurrar branch/tag) e o estado delas inclui `skipped` ao lado de pending, running, done e failed.
- Uma etapa de gate pode ser pulada pela pessoa com um motivo (a decisão fica registrada no fórum do ciclo), e uma etapa de espera pode deixar de esperar pelo mesmo mecanismo.
- Dentro de um grupo de passos da mesma etapa da release, um passo pulado pela pessoa é considerado decisão dela e não bloqueia os passos subsequentes; os passos ficam agrupados por etapa (`r:<etapa>:<n>`) e um redo cria um grupo novo, o que tende a deixar o grupo anterior com passos pendentes que acabam pulados.

O que só a leitura do código mostrou e a issue não diz: a contagem de skips por release não pode ser verificada nesta etapa, porque depende dos registros das próprias executions citadas (75, 151, 115), que não estão nesta árvore de trabalho. Isso faz parte do que a investigação pedida deve fazer.

## O que falta

Nada que impeça o exame: a issue diz o que quer (causas de cada skip antes da próxima release) e dá as executions onde os dados estão.

## Related / relacionadas

Nenhuma duplicata ou relacionada identificada; a busca por issues relacionadas no tracker não pôde ser feita a partir desta árvore de trabalho, portanto não verificado.

## Sugestão (não decisão)

- Squad sugerido: `priority:medium` — a issue é de entendimento e prepara uma possível mudança no fluxo de release; não trava nenhuma release hoje.
- Pipeline: Plataforma é o squad cujo escopo cobre ações de release e a mecânica de gates/esperas; a investigação deve produzir, no fim, um registro de por que cada skip aconteceu (motivo dado, passo duplicado por redo, etc.) antes do corte da beta seguinte.

## Próximo passo

Encaminhar ao planejamento: acessar o histórico das executions citadas (75, 151 e 115), listar skipped por etapa e padrão, e classificar cada skip (decisão da pessoa em gate/espera, redo de grupo, falha reaprovada) antes da próxima cut.
