# Memória do ciclo para execuções longas

## Tipo

Pedido de funcionalidade. Não relata defeito, não é pergunta e não repete outra issue: pede que cada execução mantenha um registro curto e estruturado do ciclo — decisões, restrições, o que foi tentado e descartado, perguntas abertas e onde o trabalho está —, lido por inteiro em toda etapa, atualizado por cada etapa, alimentado pelo que se decide na conversa, visível e corrigível pela pessoa, e com as entradas da etapa atual preservadas quando os documentos não couberem.

## Dá para entender como está escrita

Dá. O comportamento descrito confere com o código que a issue cita:

- O texto de cada etapa é montado do zero (`stagePrompt`, `src/main/runner/prompt.ts:147`); nada do que uma etapa concluiu é reaproveitado pela seguinte além do que a pasta do ciclo, a conversa e os recados carregam.
- A pasta do ciclo é lida com a issue primeiro e depois em ordem de nome, com teto de 30.000 caracteres por arquivo e 120.000 no total (`readFolder`, `src/main/runner/cycleFolder.ts:63-84`). Como o corte é por ordem de nome, os documentos das etapas mais novas são os primeiros a serem cortados.
- O orçamento da pasta é gasto **antes** do filtro que decide quais documentos a etapa recebe (`src/main/runner/executor.ts:379`): o corte pode cair sobre arquivos que a etapa nem leria, e as entradas declaradas da própria etapa são cortadas junto. É o ponto que a issue aponta como "o orçamento da pasta favorece a etapa atual" ainda por fazer.
- A conversa entra pela janela das últimas 40 mensagens, cada uma cortada em 1.500 caracteres (`src/main/runner/executor.ts:380`; `src/main/runner/prompt.ts:66,79`).
- A etapa recebe o último recado deixado para ela, a resposta pendente da pessoa e no máximo as últimas quatro rodadas de revisão da etapa (`src/main/runner/executor.ts:382-383,392`).
- A nota da issue de que um ciclo acima do orçamento e um laço de devolução nunca foram exercitados com um modelo de verdade confere com `docs/runner.md`, seção "Não verificado": os laços de devolução entre a revisão ou a QA e o desenvolvedor estão listados ali como não exercitados com modelo de verdade.

Ressalva: o número citado de cerca de 61.000 caracteres de um ciclo recente deste repositório (24.000 no plano) não foi medido — a afirmação foi apenas lida; só os limites de tamanho do código foram conferidos.

Verificação: leitura da issue, do código citado e da documentação do runner. Nada foi executado e o comportamento não foi reproduzido no aplicativo.

## O que falta

Nada que a triagem precise ouvir de quem abriu para seguir. O nome fixo do arquivo, o teto próprio do registro e a forma de editá-lo na tela são decisões do refino, não da triagem.

## Issues relacionadas

- Issue do runner e do ciclo de agentes (#9): criou a pasta do ciclo, os documentos das etapas e o texto de cada etapa — a estrutura que esta issue estende com um registro que atravessa as etapas. Relacionada, não duplicata.
- Issue das permissões dos agentes (#30): define o que cada agente pode ler e escrever e as regras dos documentos (o material de fora entre marcas, o segredo mascarado, a auditoria pública); um registro novo seguiria essas regras. Relacionada, não duplicata.
- Nenhuma issue encontrada que repita esta.
