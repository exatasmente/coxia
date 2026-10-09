# Memória do ciclo

## Decisões

- Issue 163 é pedido de investigação (retro de 08/10/2026, dimensão release): examinar o que leva cada skip nas execuções 75 (dezenas), 151 (6) e 115 (5) antes de fechar a próxima release.
- Squad: plataforma (ações `release-git`, gates/esperas e mecânica de skip). Prioridade proposta: priority:medium; marco proposto: antes do corte da próxima beta.
- Refinamento especificou o exame em `1_SPEC.md`: lista individual de cada skip (etapa, quem pulou, motivo registrado), classificação por tipo (decisão em portão, decisão em espera, pendente por refazer, outro, sem rastro), saltos sem motivo contam como "sem rastro", padrões repetidos nomeados, e conclusão curta antes do corte da beta. Leitura apenas: nenhuma mudança de fluxo nesta entrega; mudanças nascem de pedido próprio depois dos achados.

## Restrições

- Nenhum código alterado no ciclo até aqui (triagem e refinamento só leem).
- Mecanismo de skip verificado no código nesta árvore: `ActionState` inclui `skipped` (`src/shared/types.ts`); gate escondido só passa com motivo não vazio, registrado como decisão pública (`gateSkip` e transições de espera em `src/shared/runs/transitions.ts`); passo pulado pela pessoa não bloqueia o grupo de passos da mesma etapa (`src/shared/release.ts:167`); grupos por etapa `r:<etapa>:<n>`, redo cria grupo novo (`src/shared/release.ts`, template `releaseFlow.ts`), o que tende a deixar pendentes no grupo anterior.

## Tentado e descartado

- Contar os skips das execuções 75, 151 e 115 nesta estação: os registros dessas execuções não estão nesta árvore de trabalho; o exame pertence à etapa seguinte.

## Perguntas abertas

- Não verificado: se os registros (histórico e fórum) das execuções 75, 151, 115 estão preservados o suficiente para listar motivos; a regra "sem rastro" da spec cobre o faltante.
- Não verificado: issues duplicadas/relacionadas no tracker.

## Onde o trabalho está

- `0_TRIAGE.md` e `1_SPEC.md` escritos e entregues. Próxima etapa: executar o exame dos skips conforme a spec (o handoff detalha o que listar e classificar) antes do corte da próxima beta.
- Recado support → product-owner: o exame das execuções 75, 151 e 115 deve listar cada skip (etapa, motivo, tipo) antes de cortar a próxima beta. <!-- handoff:7 -->
