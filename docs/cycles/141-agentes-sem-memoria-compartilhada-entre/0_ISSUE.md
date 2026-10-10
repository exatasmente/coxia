# 141 Agentes sem memória compartilhada entre atividades: QA não sabe de trabalho atribuído a ele

- Endereço: https://github.com/exatasmente/coxia/issues/141
- Estado: open
- Rótulos: coxia, priority:high
- Autor: exatasmente

## Descrição

## Problema (relato)
Um QA estava com uma atividade em teste e não sabia disso, respondendo ao usuário que não tinha teste em andamento. A causa é o desenho atual: há memória de ciclo, mas ela é por run e por worktree — não é compartilhada, não atravessa ciclos, não persiste entre reinícios e não é visível para um agente fora daquele run.

## O que muda para quem usa
O app passa a manter uma memória compartilhada das atividades, transversal a runs, que qualquer agente consulta para saber o que está em andamento, o que cada agente está fazendo no ciclo e onde parou. Isso permite:
- um agente chamado saber o que já está acontecendo com uma atividade (não responder que não há trabalho quando há um atribuído);
- retomar o trabalho de onde parou quando o app é reiniciado;
- agentes chamados em paralelo (por humanos ou outros agentes) terem memória de longo prazo e entre ciclos.

## Regras
- A memória é lida por qualquer agente e atualizada ao longo do ciclo.
- Persiste entre reinícios.
- Não está presa ao worktree de um único run — é compartilhada entre atividades.
- Fica fora do escopo deste produto como implementá-la/armazená-la (etapa de planejamento).

## Critérios de aceite
1. Um agente chamado enquanto outra atividade está em andamento consegue informar o que está acontecendo com ela (não responde mais que não há trabalho quando há um atribuído).
2. Após reiniciar o app, um agente retoma o trabalho de onde parou.
3. Agentes chamados em paralelo consultam o mesmo estado e não se perdem entre ciclos.
4. A memória não depende de um run/worktree específico — é compartilhada entre atividades.

## Prioridade/marco propostos
- Prioridade: high (gera desinformação direta ao usuário e afeta a confiabilidade de todo o ciclo).
- Marco: próximo ciclo normal (proposta, aguarda aceite).

## Comentários

(sem comentários)
