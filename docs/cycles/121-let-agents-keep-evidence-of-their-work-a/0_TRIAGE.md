# Guardar o que um agente viu durante o trabalho, com marcas na imagem

Tipo: pedido de funcionalidade (nova capacidade).

## O que a issue pede

Quem trabalha numa execução passa a poder guardar o que capturou enquanto trabalhava (uma captura de tela, a página da interface web, um registro, um relatório curto) como comprovação da sua etapa, e a poder marcar uma imagem para mostrar o que importa: um retângulo em volta de um campo, uma seta para um botão, um rótulo curto. Quem revisa o produto pode registrar uma validação exploratória, o QA pode embasar cenários, qualquer agente pode mostrar o que viu. A pessoa vê as comprovações na execução e elas podem chegar ao host de código.

A issue descreve quatro partes: guardar a comprovação; marcar a imagem; usar a comprovação (cenário de QA, saída de etapa, telas); e levá-la ao host de código dentro de um comentário ou da descrição do pull request. Fora do escopo, por decisão da própria issue: vídeo e gravação de tela, e edição da comprovação à mão no app.

## Dá para entender

Dá para entender como está escrita: os quatro blocos têm regras próprias, o critério de aceite é verificável item por item e o escopo negativo está delimitado. Só foi lida, junto com a documentação do app e a vizinhança no código; nada foi exercitado, porque a etapa é de triagem e o trabalho é de leitura.

## O que foi conferido na vizinhança (leitura de código, não execução)

- A pasta onde um agente com sandbox grava as capturas é `/coxia/out` (`src/main/sandbox/policy.ts:11`) e ela é apagada quando a etapa termina (`src/main/sandbox/session.ts:179`; `src/main/sandbox/remove.ts:32`). Confere com o que a issue diz.
- A ferramenta `ViewImage` e a função `readOutputImage` que a issue cita **não existem** nesta cópia: só aparecem no texto da própria issue. A issue fala delas como se já existissem.
- Não existe armazenamento de anexos em `src/` nem em `test/`; a única menção à palavra está na própria issue.
- A escolha de onde guardar a comprovação não existe hoje: `Settings › Runner` (`src/renderer/src/screens/team/RunnerSection.tsx`) já é onde ficam o trabalho da execução, os limites da sandbox e as identidades, mas não tem nada sobre comprovação nem sobre a pasta de saída.
- O cenário de QA já tem a noção de comprovação por comando (`src/shared/runs/types.ts:192-205`: `evidence` vale `executed` ou `read`, e `commands` lista números de comandos), e a tela de Revisão e QA mostra os cenários por rodada (`docs/runner.md`). Isso é o "citar números de comando"; evidência em forma de imagem não existe.
- A dependência citada pela issue, a #120 (armazenamento de anexos e a forma como uma mensagem carrega arquivos), **não tem registro neste checkout**: não há pasta de ciclo dela em `docs/cycles/` nem menção no `CHANGELOG.md`. Não foi verificado se esse trabalho está feito, pendente ou em outra branch.
- Nada de desenho de imagem no processo principal: não há biblioteca de imagem nas dependências e o único uso de imagem no processo principal é de ícone de recurso.
- O "resultado de etapa de qualquer agente pode citar ids de comprovação" tem base: a resposta de uma etapa já traz `summary`, `commit`, `artifacts`, `handoff`, `question` e `comment`, e os cenários de QA já citam comprovações; o formato exato do id não está definido em lugar nenhum.
- A "porta de Ações" que a issue cita existe e está documentada (`src/main/actions.ts`; `docs/runner.md`): uma escrita externa feita por agente autônomo sai auditada e qualquer outra espera um "sim"; workspace de teste recusa escrita externa.
- O que a issue chama de "escolha do espaço de trabalho" aparece na documentação do app como configuração por espaço de trabalho (`config.json`), com versão de schema e cadeia de migração; acrescentar um campo é trabalho conhecido do repositório, não foi verificado no código nesta etapa.

## O que falta

Nada falta na issue: ela define o comportamento, os limites e o critério de aceite. O que os números citados não alcançam é trabalho de projeto, e não algo que quem abriu precise dizer:

- A #120 é pré-requisito declarado e não está no checkout; se ela não estiver pronta, esta issue não se sustenta sozinha na parte de anexos, mesmo que as ferramentas de guardar e marcar também sirvam a arquivos da pasta de saída.
- A issue não fixa em que etapa do ciclo isto entra nem a ordem entre as quatro partes. É decisão de produto, não uma informação que quem abriu precise acrescentar.
- Por decisão da própria issue, o projeto da solução fica para o refinamento e o planejamento.

## Issues parecidas ou relacionadas

- #120 — a própria issue diz se apoiar nela (armazenamento de anexos e como uma mensagem carrega arquivos). Sem ela, o item 1 perde a base; não é duplicata, é dependência.
- Nenhuma outra issue deste checkout tem o mesmo pedido. Não foi feita busca além do que está registrado na pasta do ciclo e no código.

## Sugestão de prioridade

Sugiro `priority:medium`: é capacidade nova, não corrige comportamento errado em uso, e tem um pré-requisito declarado que não está no checkout; a prioridade final é do refinamento do produto.

## O que esta triagem não fez

Não reproduziu nem exercitou nada; não propôs solução; não decidiu prioridade. Tudo o que está dito como existente foi lido em arquivo nesta cópia de trabalho, e o resto está marcado como não verificado.
