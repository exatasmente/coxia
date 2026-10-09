# Memória do ciclo

## Decisões

- Issue 163 é pedido de investigação (retro de 08/10/2026, dimensão release): examinar o que leva cada skip nas execuções 75 (dezenas), 151 (6) e 115 (5) antes de fechar a próxima release.
- Squad: plataforma; priority:medium; marco: antes do corte da próxima beta.
- Spec aprovada (1_SPEC.md): todo skip listado individualmente com etapa, quem pulou e motivo registrado; classificação em decisão em portão, decisão em espera, pendente por refazer, outro, sem rastro; padrões repetidos nomeados; contagem por liberação bate com o registro da própria liberação; conclusão curta; leitura apenas.
- Plano (2_PLAN.md) fixa a mecânica do exame: registros em `<workspace>/runs/<id>.json` (`src/main/runs.ts`); entradas `gate-skipped`/`wait-skipped` (`src/shared/runs/transitions.ts:361-369` e `:858-859`) e decisões no fórum (`gate.skipped`/`wait.skipped`); extração mecânica, tabela de decisão fixa, contagem e conclusão por liberação.
- Do exame (3_IMPLEMENTATION.md, revisado): passes corretos ao plano — os passos release-git ficam no catálogo de Ações do espaço de trabalho (grupo `<runId>:<etapa>:<tentativa>`), não no arquivo de run; o catálogo não grava autor por salto, "quem" é inferência marcada. Contagens do registro: #75 = 25, #151 = 4, #115 = 8 (37 total); a contagem da retro (dezenas/6/5) diverge e ficou registrada como achado, sem reconciliação. Três padrões: refazeres deixam descartes mecânicos em lote; recusas do script viram skipped em vez de failed (11/37); só 1 decisão real registrada de 37 (a espera de feedback "Aprovada" na 115). Conclusão: gravar autor por salto, descartar propostas substituídas na hora do refazer, estado próprio para recusa do script, e tratar a causa raiz recorrente (checkout da branch de release em outro worktree, 9 ocorrências).
- Revisão (4_REVIEW.md): aprovada. Nenhum critério de aceite quebra; dois achados de sugestão (nota aritmética do total da #75 e citação resumida em vez de literal em motivos repetidos); mudanças nascem de pedido próprio depois dos achados.

## Restrições

- Nenhuma mudança de código, regra de fluxo, texto ou dado nesta entrega nem na do exame; mudanças nascem de pedido próprio depois dos achados.
- O exame cobre só as liberações das issues 75, 151, 115; estados `skipped` fora do trabalho de release (wizard, verificação de conflito, cards de sugestão) ficam fora do escopo.
- Motivos citados como registrados, sem tradução nem resumo.
- Script temporário de extração, se houver, não fica na worktree: vai para a pasta de saída e é descartado.

## Tentado e descartado

- Conftar os skips das execuções 75, 151 e 115 nesta árvore: os registros dessas execuções não estão nesta árvore de trabalho (confirmado também pela revisão, que não pode reler o bruto fora dela); o exame é quem os lê. Se faltar rastro, a regra 7 da spec ("sem rastro") cobre.

## Perguntas abertas

- Não verificado pelas etapas deste ciclo: se as execuções 75, 151 e 115 têm todos os registros preservados — os arquivos e fóruns existem e guardam rastro segundo o exame; a revisão não releu o bruto.
- Não verificado: issues duplicadas/relacionadas no tracker.
- Pendente do exame, sem atestar o que aconteceu: na #115, nem a main nem a tag da estável mostram envio pela execution e ainda assim ela terminou done e a issue foi fechada.

## Onde o trabalho está

- `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e `4_REVIEW.md` escritos e entregues; ciclo aprovado pela revisão, sem mudança de código (commits são só de documentos do ciclo).
- Pendências de produto apontadas pela conclusão do exame (autor por salto, descartes na substituição, estado de recusa, conflito de checkout), cada uma como pedido próprio futuro — nenhuma aberta neste ciclo.
- Recado support → product-owner: o exame das execuções 75, 151 e 115 deve listar cada skip (etapa, motivo, tipo) antes de cortar a próxima beta. <!-- handoff:7 -->
- Passagem product-owner → pessoa: Executar o exame: ler os registros das execuções 75, 151 e 115 (histórico das etapas e fórum de cada ciclo), listar cada passo skipped com etapa, quem pulou e motivo, classificar cada salto (decisão em portão/espera, pendente por refazer, outro, sem rastro), identificar padrões repetidos e escrever o registro por liberação com conclusão curta — antes do corte da próxima beta. Não alterar código nesta entrega; qualquer mudança no fluxo nasce de pedido próprio depois dos achados. <!-- handoff:12 -->
- Passagem tl-plataforma → pessoa: Execute the exam per 2_PLAN.md: open the run files (and forum threads) of the cycles behind issues 75, 151 and 115, extract every skipped stage and release-git action with stage, who and reason text, cross-check each entry with the forum decisions and record its source (run history, forum, or both), classify each skip with the fixed decision table (gate decision / wait decision / redo leftover / other with description / no trace), tally by release, name repeated patterns, and write the per-release report with a short conclusion — before the next beta cut. Read-only: no code, rule, text or data… <!-- handoff:24 -->
