# Memória do ciclo

## Decisões

- Issue 163 classificada como pedido de investigação (retro de 08/10/2026, dimensão release): examinar o que leva cada skip das execuções de release (dezenas na 75, 6 na 151, 5 na 115) antes de fechar a próxima release.
- Squad sugerido: plataforma (ações `release-git`, gates/esperas e mecânica de skip vivem no escopo dela).
- Prioridade sugerida: priority:medium (entendimento, não trava release).

## Restrições

- Nenhum código alterado nesta etapa (triagem só lê).
- Skip verificado no código como mecanismo real: `ActionState` inclui `skipped`; gate/waits podem ser pulados com motivo registrados (`src/shared/runs/transitions.ts`); passos pulados por pessoa não bloqueiam o grupo (`src/shared/release.ts`); grupos por etapa, redo cria grupo novo (`src/shared/release.ts`, template `releaseFlow.ts`).

## Tentado e descartado

- Verificar contagens de skips das execuções 75, 151 e 115: não verificado, os registros das execuções não estão nesta árvore; cabe à investigação pedida.

## Perguntas abertas

- Nenhuma pendente na triagem; sem pergunta à pessoa nem ao autor.
- Não verificado: issues duplicadas/relacionadas no tracker.

## Onde o trabalho está

- `0_TRIAGE.md` escrito e entregue (classificação, verificação de entendimento, relacionadas, sugestões). Próxima etapa: refinamento/planejamento do exame dos skips.
