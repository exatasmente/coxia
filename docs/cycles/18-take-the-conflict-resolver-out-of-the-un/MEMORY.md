# Memória do ciclo

## Decisões

- A issue 18 é um pedido de funcionalidade (enhancement), não um bug: retirar o painel de conflito da tela de desbloqueio e deixar o bloqueio apontar para o botão que já existe na tela de Hoje.
- Escopo fixado no comentário de quem abriu: só a retirada do painel, o apontamento do bloqueio e a limpeza do que fica órfão (os dois textos do painel e a marca de lugar `'deep'`). Sem migração de configuração.
- Prioridade mantida em low; marco nenhum. Especificação em 1_SPEC.md e plano em 2_PLAN.md; implementação feita como planejado, sem desvio.
- Na revisão, a pessoa decidiu que o critério de aceite 3 passa a descrever o comportamento entregue: a linha do bloqueio continua levando à tela de desbloqueio, e não ao ponto onde o botão está. O critério fica reescrito assim; não há divergência aberta e a mudança segue aprovada.
- Resposta: descreve o comportamento entregue <!-- answer:192 -->

## Restrições

- A detecção de conflito (`conflictMrs`) e a forma de resolver conflito não mudaram; os dois pontos do botão na tela de Hoje (`TodayParts.tsx:114` e `:224`) não foram tocados.
- A linha do bloqueio (`dashboard.ts:208-221`) já carrega `conflictCard`/`conflictRef` e não foi mexida; ela aponta para a tela de desbloqueio e continua assim.
- A guarda de escrita externa vive no processo principal (`approveAction` → `assertExternalWrite`; o push da resolução passa por ela). O botão de conflito só cria a ação e abre a tela do conflito; nada preso ao painel saiu com ele.
- Os textos saem por inteiro: os dois catálogos (`ui-call.*.json`) e as duas cópias em `test/fixtures/catalogs-main/` andam juntos.
- A tela de desbloqueio continua sendo destino válido de outros caminhos (linha do bloqueio e pergunta aberta); só o painel saiu.

## Tentado e descartado

- Perguntar a quem abriu: descartado; a issue e o comentário respondem o que faltaria.
- Mudar a linha de bloqueio para apontar para outro lugar: descartado; o apontamento já funciona e o critério foi reescrito em vez de mexer na linha.
- Ajustar o roteiro de teste do ciclo 20 (`3_TEST_PLAN.md`, checagem 2): não feito.
- Corrigir os três testes que falham por tempo limite/estado: fora do escopo desta issue.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Implementação feita e não commitada (o app commita): a seção do painel saiu de `Deep.tsx` com os imports das linhas 15 e 16; `ConflictPlace` em `ResolveConflict.tsx:10` passou a `'need' | 'act'`; `ui.deep.conflict` e `ui.deep.conflictNote` saíram dos dois catálogos e das duas cópias de teste. Nada mais mudou.
- Portões (registrados pela implementação, não repetidos na revisão): `npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` (4052 chaves nos dois idiomas, 0 soltas) e `node scripts/public-audit.mjs` (909 arquivos) passaram; o literal `deep` de `ResolveConflict.tsx` não é mais acusado (segue legítimo em `custo.ts` e em `ui.settings.role.deep.*`).
- `npx vitest run`, primeira execução (log `.runlogs-vitest.log`, agora lido até o resumo): 222 arquivos, 3650 testes aprovados, 14 reprovados em três arquivos — `test/conflict-resolve.test.ts` (tempo limite de teste em execução pesada e a trava "este conflito já tem um passo em andamento" vinda de uma execução anterior), `test/release-git.test.ts` (hook de 10 s estourando e uma asserção de trava órfã) e `test/runner-chain.test.ts` (1 teste). São áreas que esta mudança não toca; os vizinhos da mudança passaram (`test/resolve-conflict-button.test.ts`, `test/dashboard.test.ts`, `test/main-catalogs.test.ts`).
- A segunda execução (`.runlogs-vitest2.log`) não tem resultado final: o registro para no meio, no mesmo ponto da primeira (reprovados em `test/release-git.test.ts`), sem o resumo. Fica como não verificado; não há indício de falha nova.
- Nada verificado em execução: nenhuma tela foi aberta.
- Pendência ao alcance de outra etapa: `docs/cycles/20-resolve-conflict-button/3_TEST_PLAN.md`, checagem 2, ainda diz que a tela de desbloqueio mostra o painel. Ajustar quando o arquivo estiver no caminho da issue.
- Passagem tl-experiencia → próxima etapa: revisão aprovada em 4_REVIEW.md; nenhuma correção de código pedida. A descrição do pull request e o comentário da tracker seguem com a mudança.
- Passagem support → product-owner: Retirar o painel de conflito da tela de desbloqueio: apagar o bloco da seção que hospeda o botão, remover a marca de lugar 'deep' do componente do botão e os textos ui.deep.conflict / ui.deep.conflictNote dos dois catálogos e das cópias nos fixtures de teste. Deixar a linha do bloqueio apontando para o botão que já existe na tela de Hoje. Confirmar que nenhum controle de escrita externa fica órfão com a remoção e que nenhum teste afirma que a tela de desbloqueio mostra o painel. Não alterar a detecção de conflito nem os pontos onde o botão já aparece em Hoje. <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejar e implementar a retirada. 1) Apagar a seção inteira do painel de conflito no terceiro painel da tela de desbloqueio (Deep.tsx:245-251), junto com o import do botão (Deep.tsx:15) e o de conflictMrs (Deep.tsx:16) se ficarem sem uso. 2) Tirar 'deep' de ConflictPlace (ResolveConflict.tsx:10); conferir que place="need" e place="act" seguem intactos e que a chave de jobs (prefixo conflictmr:place:ref:) não quebra. 3) Remover as chaves ui.deep.conflict e ui.deep.conflictNote de src/shared/i18n/ui-call.en.json e ui-call.pt-BR.json (linhas 105-106) e das cópias espelhadas em test/fixtures/cata… <!-- handoff:11 -->
- Passagem tl-experiencia → pessoa: Implementar conforme 2_PLAN.md: apagar a seção do painel em Deep.tsx:245-251 e os imports das linhas 15 e 16; tirar 'deep' de ConflictPlace (ResolveConflict.tsx:10) mantendo place="need" (TodayParts.tsx:114) e place="act" (:224) intactos; remover ui.deep.conflict e ui.deep.conflictNote de src/shared/i18n/ui-call.en.json e ui-call.pt-BR.json e de test/fixtures/catalogs-main/ui-call.en.json e ui-call.pt-BR.json (linhas 105-106 nos quatro). Não tocar em conflictMrs, na linha do bloqueio (dashboard.ts:208-221) nem nos pontos da tela de Hoje. Rodar npx tsc --noEmit, npx vitest run, node scripts/the… <!-- handoff:37 -->
- Passagem dev-experiencia → tl-experiencia: Conferir o que esta passada deixou aberto: (1) terminar de rodar `npx vitest run` e confirmar que as três falhas (`test/conflict-resolve.test.ts`, `test/release-git.test.ts`, `test/runner-chain.test.ts`) são de tempo limite/estado do ambiente, não da retirada — na primeira execução elas somaram 14 testes e nenhuma toca o arquivo alterado; (2) ajustar a checagem 2 de `docs/cycles/20-resolve-conflict-button/3_TEST_PLAN.md`, que ainda diz que a tela de desbloqueio mostra o painel; (3) se houver acesso a uma tela, abrir a conversa de desbloqueio de um card com conflito e ver a conversa sem o paine… <!-- handoff:64 -->
