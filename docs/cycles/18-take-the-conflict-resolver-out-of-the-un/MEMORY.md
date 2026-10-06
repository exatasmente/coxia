# Memória do ciclo

## Decisões

- A issue 18 é um pedido de funcionalidade (enhancement), não um bug: retirar o painel de conflito da tela de desbloqueio e deixar o bloqueio apontar para o botão que já existe na tela de Hoje.
- Escopo fixado no comentário de quem abriu: só a retirada do painel, o apontamento do bloqueio e a limpeza do que fica órfão (os dois textos do painel e a marca de lugar `'deep'`). Sem migração de configuração.
- Prioridade mantida em low; marco nenhum. Especificação em 1_SPEC.md (sete critérios de aceite) e plano em 2_PLAN.md; implementação feita como planejado, sem desvio.
- Nada de novo foi decidido na implementação: o plano estava fechado e foi seguido ponto a ponto.

## Restrições

- A detecção de conflito (`conflictMrs`) e a forma de resolver conflito não mudaram; os dois pontos do botão na tela de Hoje (`TodayParts.tsx:114` e `:224`) não foram tocados.
- A linha do bloqueio (`dashboard.ts:208-221`) já carrega `conflictCard`/`conflictRef`; não foi mexida.
- A guarda de escrita externa vive no processo principal (`approveAction` → `assertExternalWrite`; o push da resolução passa por ela). O botão de conflito só cria a ação e abre a tela do conflito; nada preso ao painel saiu com ele.
- Os textos saem por inteiro: os dois catálogos (`ui-call.*.json`) e as duas cópias em `test/fixtures/catalogs-main/` andam juntos.
- A tela de desbloqueio continua sendo destino válido de outros caminhos (linha do bloqueio e pergunta aberta); só o painel saiu.

## Tentado e descartado

- Perguntar a quem abriu: descartado; a issue e o comentário respondem o que faltaria.
- Mudar a linha de bloqueio para apontar para outro lugar: descartado; o apontamento já funciona.
- Ajustar o roteiro de teste do ciclo 20 (`3_TEST_PLAN.md`, checagem 2): não feito.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Implementação feita e não commitada (o app commita): a seção do painel saiu de `Deep.tsx` com os imports das linhas 15 e 16; `ConflictPlace` em `ResolveConflict.tsx:10` passou a `'need' | 'act'`; `ui.deep.conflict` e `ui.deep.conflictNote` saíram dos dois catálogos e das duas cópias de teste. Nada mais mudou.
- Portões: `npx tsc --noEmit` passou (0); `node scripts/theme-audit.mjs` passou; `npm run i18n:lint` passou (4052 chaves nos dois idiomas, 0 soltas); `node scripts/public-audit.mjs` passou (909 arquivos) e o literal `deep` de `ResolveConflict.tsx` não é mais acusado (segue legítimo em `custo.ts` e em `ui.settings.role.deep.*`).
- `npx vitest run`: não ficou verde. Na primeira execução (o log foi nomeado `.runlogs-vitest.log`) falharam 14 testes em três arquivos — `test/conflict-resolve.test.ts` (tempo limite de teste em execução pesada e a trava "este conflito já tem um passo em andamento" vinda de uma execução anterior), `test/release-git.test.ts` (hook de 10 s estourando e uma asserção de trava órfã) e `test/runner-chain.test.ts` (1 teste). São áreas que esta mudança não toca. Os vizinhos da mudança passaram: `test/resolve-conflict-button.test.ts` (10), `test/dashboard.test.ts` (25) e `test/main-catalogs.test.ts` (5).
- A segunda execução da suíte (`.runlogs-vitest2.log`) terminou o estágio ainda em andamento; o pedaço lido mostra que o log termina no meio (1420 linhas, sem o resumo final), então a repetição não pode ser dada como concluída. É o item que fica aberto para quem vier depois.
- Nada verificado em execução além dos portões: nenhuma tela foi aberta.
- Pendência ao alcance da próxima etapa: `docs/cycles/20-resolve-conflict-button/3_TEST_PLAN.md`, checagem 2, ainda diz que a tela de desbloqueio mostra o painel. Ajustar quando o arquivo estiver no caminho da issue.
- Passagem support → product-owner: Retirar o painel de conflito da tela de desbloqueio: apagar o bloco da seção que hospeda o botão, remover a marca de lugar 'deep' do componente do botão e os textos ui.deep.conflict / ui.deep.conflictNote dos dois catálogos e das cópias nos fixtures de teste. Deixar a linha do bloqueio apontando para o botão que já existe na tela de Hoje. Confirmar que nenhum controle de escrita externa fica órfão com a remoção e que nenhum teste afirma que a tela de desbloqueio mostra o painel. Não alterar a detecção de conflito nem os pontos onde o botão já aparece em Hoje. <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejar e implementar a retirada. 1) Apagar a seção inteira do painel de conflito no terceiro painel da tela de desbloqueio (Deep.tsx:245-251), junto com o import do botão (Deep.tsx:15) e o de conflictMrs (Deep.tsx:16) se ficarem sem uso. 2) Tirar 'deep' de ConflictPlace (ResolveConflict.tsx:10); conferir que place="need" e place="act" seguem intactos e que a chave de jobs (prefixo conflictmr:place:ref:) não quebra. 3) Remover as chaves ui.deep.conflict e ui.deep.conflictNote de src/shared/i18n/ui-call.en.json e ui-call.pt-BR.json (linhas 105-106) e das cópias espelhadas em test/fixtures/cata… <!-- handoff:11 -->
- Passagem tl-experiencia → pessoa: Implementar conforme 2_PLAN.md: apagar a seção do painel em Deep.tsx:245-251 e os imports das linhas 15 e 16; tirar 'deep' de ConflictPlace (ResolveConflict.tsx:10) mantendo place="need" (TodayParts.tsx:114) e place="act" (:224) intactos; remover ui.deep.conflict e ui.deep.conflictNote de src/shared/i18n/ui-call.en.json e ui-call.pt-BR.json e de test/fixtures/catalogs-main/ui-call.en.json e ui-call.pt-BR.json (linhas 105-106 nos quatro). Não tocar em conflictMrs, na linha do bloqueio (dashboard.ts:208-221) nem nos pontos da tela de Hoje. Rodar npx tsc --noEmit, npx vitest run, node scripts/the… <!-- handoff:37 -->
