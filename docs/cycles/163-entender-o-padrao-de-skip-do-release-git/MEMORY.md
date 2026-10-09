# Memória do ciclo

## Decisões

- Issue 163 é pedido de investigação (retro de 08/10/2026, dimensão release): examinar o que leva cada skip nas execuções 75 (dezenas), 151 (6) e 115 (5) antes de fechar a próxima release.
- Squad: plataforma; priority:medium; marco: antes do corte da próxima beta.
- Spec aprovada (1_SPEC.md): todo skip listado individualmente com etapa, quem pulou e motivo registrado; classificação em decisão em portão, decisão em espera, pendente por refazer, outro, sem rastro; padrões repetidos nomeados; contagem por liberação bate com o registro da própria liberação; conclusão curta; leitura apenas.
- Do exame (3_IMPLEMENTATION.md, revisado): passos release-git ficam no catálogo de Ações do espaço de trabalho (grupo `<runId>:<etapa>:<tentativa>`), não no arquivo de run; o catálogo não grava autor por salto, "quem" é inferência marcada. Contagens do registro: #75 = 25, #151 = 4, #115 = 8 (37 total); a contagem da retro (dezenas/6/5) diverge e ficou registrada como achado. Três padrões: refazeres descartam propostas em lote; recusas do script viram skipped em vez de failed (11/37); só 1 decisão real registrada de 37 (espera "Aprovada" na 115). Causa raiz recorrente: checkout da branch de release em outro worktree (9 ocorrências).
- Revisão (4_REVIEW.md): aprovada, dois achados de sugestão. QA (5_TEST_PLAN.md): nenhuma falha de critério de aceite; os dois achados da revisão persistem no texto do relatório (nota aritmética "7 + 12 − 1 + 6 = 24..." da #75 não reproduz a soma; recusas repetidas resumidas em vez de literais) — sugestão, não bloqueio.
- Comunicação (6_RELEASE_NOTE.md): nota escrita em palavras simples para quem abriu a issue — o que o exame encontrou (37 saltos, 1 decisão, rastro mecânico e recusas do script como causas principais), o que o padrão sugere mudar como pedidos próprios e os limites (leitura apenas, só as três liberações, autor por salto é inferência). Sem caminho de arquivo nem contato.

## Restrições

- Nenhuma mudança de código, regra de fluxo, texto ou dado nesta entrega nem na do exame; mudanças nascem de pedido próprio depois dos achados.
- O exame cobre só as liberações 75, 151 e 115; estados skipped fora de release (wizard, conflito, cards de sugestão) ficam fora do escopo.
- Motivos citados como registrados, sem tradução nem resumo.
- Script temporário, se houver, não fica na worktree: pasta de saída e descarte.

## Tentado e descartado

- Bater as contagens contra os registros brutos nesta árvore: os registros das execuções 75, 151 e 115 não están nesta árvore de trabalho (confirmado pela revisão); não verificado pelas etapas do ciclo.
- Rodar a suíte completa nesta sandbox: não executável (node_modules montado em leitura; o vitest tenta escrever node_modules/.vite-temp para carregar a config). Contornos (renomear config, config apontada para fora, config inline via API) falham ou distorcem o setup global dos testes (test/setup.ts); log da tentativa ficou como achado, sem veredito de produto.

## Perguntas abertas

- Não verificado pelas etapas deste ciclo: se as execuções 75, 151 e 115 têm todos os registros preservados (o exame diz que sim; revisão e QA não releram o bruto).
- Não verificado: issues duplicadas/relacionadas no tracker.
- Pendente do exame, sem atestar o que aconteceu: na #115, nem a main nem a tag da estável mostram envio pela execution e ainda assim ela terminou done e a issue foi fechada.
- Não verificado pela QA: que a suíte completa passa nesta árvore (bloqueio do ambiente); a CI do repositório deve cobri-la.

## Onde o trabalho está

- Ciclo completo: 0_ISSUE a 6_RELEASE_NOTE na pasta docs/cycles/[redacted]; sem mudança de código (commits só de documentos). QA aprovou: portão público da árvore (1279 arquivos), tsc, árvore limpa e consistência interna das contagens 25/4/8/37 confirmadas por script. Comunicação entregou a nota e o comentário na tracker.
- Pendências de produto (pedidos futuros): autor por salto; descartes na substituição; estado de recusa do script; conflito de checkout do worktree. Correções de texto do relatório (#75 nota aritmética; citações literais) pendentes também.
- Passagem tl-plataforma → pessoa: Exame executado e plano de testes conferido pela QA; ciclo pronto para fechar. <!-- handoff:24 -->
- Passagem qa-plataforma-2 → pessoa: Ciclo pronto para fechar: a QA concluiu sem falha de critério de aceite. Pendente apenas como pedidos próprios futuros (já apontados pela conclusão do exame): gravar autor por salto no catálogo de ações, descartar na hora do refazer as propostas da tentativa anterior, estado próprio para recusa do script e tratar o conflito de checkout da branch de release em outro worktree. As duas correções de texto do relatório (nota aritmética da liberação 75 e citações literais das recusas repetidas) seguem abertas como sugestão da revisão. <!-- handoff:179 -->
- Passagem support → product-owner: A issue vai ao refinamento como pedido de investigação, sem mudança de código ainda: o exame das execuções 75, 151 e 115 deve listar cada skip (etapa, motivo, tipo) antes de cortar a próxima beta. <!-- handoff:7 -->
- Passagem product-owner → pessoa: Executar o exame: ler os registros das execuções 75, 151 e 115 (histórico das etapas e fórum de cada ciclo), listar cada passo skipped com etapa, quem pulou e motivo, classificar cada salto (decisão em portão/espera, pendente por refazer, outro, sem rastro), identificar padrões repetidos e escrever o registro por liberação com conclusão curta — antes do corte da próxima beta. Não alterar código nesta entrega; qualquer mudança no fluxo nasce de pedido próprio depois dos achados. <!-- handoff:12 -->
