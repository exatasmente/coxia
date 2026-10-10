# Triagem da investigação do padrão de gate skip em releases

## Tipo
Pedido de investigação (pergunta sobre o comportamento do app), não um bug: o skip de um step é por decisão da pessoa e é um comportamento previsto; o que a issue pede é entender por que releases acumularam dezenas de skips antes de terminar — mais um ajuste de processo/robustez do corte do que uma falha pontual de código.

## Dá para entender ou reproduzir
Dá para entender e começa a dar para examinar.

- O mecanismo citado existe e foi lido no código: um step em espera ou num portão pode ser pulado pela pessoa com um motivo obrigatório, e a decisão fica registrada no histórico do run ('gate-skipped' / 'wait-skipped', estado 'skipped').
- Quem abriu confirmou onde os registros estão: no feed de ações do próprio app (aba de ações do workspace, cada passo release-git com sua saída), em arquivo externo nenhum.
- O padrão extraído desses registros, lido por quem abriu (contagens conferidas no feed hoje; podem divergir um pouco do texto da retro):
  - Issue 75 (0.6.1): ~25 steps release-git skipped entre 05 e 06/10. Gatilho dominante: a branch release/0.6.1 com checkout em outro worktree ("uma branch não pode ter checkout duas vezes"); ao voltar, o passo estável recusou com "tag v0.6.1 already exists".
  - Issue 115 (0.7.0): o mesmo gatilho de checkout duplo, mais a guarda de ordem "envie main primeiro: a tag v0.7.0 ainda não está em origin/main" e um skip sem efeito ("o remoto já tem v0.7.0-beta.9, nada mudou no host").
  - Issue 151 (0.9.0): um skip real de conteúdo — "CHANGELOG.md: [Unreleased] is empty … describe the changes first" — bloqueando o corte da próxima beta; os outros dois foram pushes sem nada a enviar depois do passo anterior ter concluído.
- Gatilho comum: estado ambiente, não conteúdo da release — checkout duplo da branch de release em worktrees, tag já existente, CHANGELOG vazio.
- Não verificado nesta etapa: as contagens e os motivos não foram reexaminados nos registros pelo app nestes agentes; a leitura do feed é relato de quem abriu.

## O que falta
Nada para a investigação em si: a fonte dos registros está identificada e o padrão foi extraído. O que segue é decisão de refino, não dado que falta:
- Se a correção sugerida (antes de cortar, liberar o checkout da branch de release nos demais worktrees e proteger o corte de beta com o [Unreleased] preenchido) vira um ou mais issues, e para qual squad.
- Prioridade, proposta pelo refino do produto.

## Issues duplicadas ou relacionadas
Nenhuma encontrada nesta etapa. As issues 75, 115 e 151 são as fontes dos dados que a 190 examina, não duplicadas — mas podem receber o resultado da investigação.

## Squad e prioridade (sugestões)
- Squad: plataforma — o padrão toca o runner, os worktrees e o fluxo do release, não as telas.
- Prioridade sugerida: priority:medium — o problema já custou dezenas de skips em uma release e volta a cada corte; os gatilhos são conhecidos e a correção sugerida é pequena, mas nada trava hoje.
