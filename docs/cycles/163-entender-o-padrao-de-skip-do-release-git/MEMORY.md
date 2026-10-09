# Memória do ciclo

## Decisões

- Issue 163 é pedido de investigação (retro de 08/10/2026, dimensão release): examinar o que leva cada skip nas execuções 75 (dezenas), 151 (6) e 115 (5) antes de fechar a próxima release.
- Squad: plataforma; priority:medium; marco: antes do corte da próxima beta.
- Spec aprovada (1_SPEC.md): todo skip listado individualmente com etapa, quem pulou e motivo registrado; classificação em decisão em portão, decisão em espera, pendente por refazer, outro, sem rastro; padrões repetidos nomeados; contagem por liberação bate com o registro da própria liberação; conclusão curta; leitura apenas.
- Plano (2_PLAN.md) fixa a mecânica do exame: registros em `<workspace>/runs/<id>.json` (`src/main/runs.ts`); entradas de histórico `gate-skipped`/`wait-skipped` (`src/shared/runs/types.ts`, `src/shared/runs/transitions.ts:361-369` e `:858-859`) e decisões públicas no fórum (`gate.skipped`/`wait.skipped`); extração mecânica dos arquivos de run, cruzamento com o fórum registrando a fonte de cada entrada, classificação por tabela de decisão fixa (histórico → autor → razão → supersessão de grupo), contagem e conclusão por liberação.
- Skip de gate/espera só acontece com razão não vazia do autor pessoa; razão vazia em ação release-git pula aponta fortemente para pendente por refazer (buscar grupo novo da mesma etapa antes de cair em outro/sem rastro).

## Restrições

- Nenhuma mudança de código, regra de fluxo, texto ou dado nesta entrega nem na do exame; mudanças nascem de pedido próprio depois dos achados.
- O exame cobre só as liberações das issues 75, 151, 115; estados `skipped` fora do trabalho de release (wizard, verificação de conflito, cards de sugestão) ficam fora do escopo.
- Motivos citados como registrados, sem tradução nem resumo.
- Script temporário de extração, se houver, não fica na worktree: vai para a pasta de saída e é descartado.

## Tentado e descartado

- Contar os skips das execuções 75, 151 e 115 nesta árvore: os registros dessas execuções não estão nesta árvore de trabalho; o exame é quem os lê. Primeira etapa do exame verifica existência e integridade dos três arquivos de run e dos fóruns; se faltar rastro, a regra 7 da spec ("sem rastro") cobre.

## Perguntas abertas

- Não verificado: se os registros (histórico e fórum) das execuções 75, 151 e 115 estão preservados o suficiente para listar motivos; primeira coisa que o exame confere.
- Não verificado: issues duplicadas/relacionadas no tracker.

## Onde o trabalho está

- `0_TRIAGE.md`, `1_SPEC.md` e `2_PLAN.md` escritos e entregues. A etapa do plano não muda código (sem commit).
- Próxima etapa: executar o exame conforme 2_PLAN.md — extrair, cruzar com o fórum, classificar, contabilizar, nomear padrões e escrever o registro por liberação com conclusão curta, antes do corte da próxima beta.
- Recado support → product-owner: o exame das execuções 75, 151 e 115 deve listar cada skip (etapa, motivo, tipo) antes de cortar a próxima beta. <!-- handoff:7 -->
- Passagem product-owner → pessoa: Executar o exame: ler os registros das execuções 75, 151 e 115 (histórico das etapas e fórum de cada ciclo), listar cada passo skipped com etapa, quem pulou e motivo, classificar cada salto (decisão em portão/espera, pendente por refazer, outro, sem rastro), identificar padrões repetidos e escrever o registro por liberação com conclusão curta — antes do corte da próxima beta. Não alterar código nesta entrega; qualquer mudança no fluxo nasce de pedido próprio depois dos achados. <!-- handoff:12 -->
