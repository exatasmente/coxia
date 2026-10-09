# Revisão: o passo de release para cedo quando a branch está presa em outro worktree

## O que foi revisado

O diff completo da branch contra a spec (1_SPEC.md) e o plano (2_PLAN.md), arquivo por arquivo: changes de `src/main/releaseGit.ts`, `src/main/actions.ts`, `src/main/index.ts`, `src/shared/types.ts`, `src/shared/apiChannels.ts`, `src/shared/auditoria.ts`, as telas (`Actions.tsx`, `Auditoria.tsx`), os catálogos e o `CHANGELOG.md`, mais os quatro arquivos de teste e o ajuste em `release-git.test.ts`.

## Conformidade com a spec

- **Regras 1-3 (detectar cedo e resolver com o sim da pessoa):** atendidas. `assertBranchFree` roda em `runReleaseOp` depois de `assertRepo` e antes de `prepareWorktree` — conferido no código, o test de conflito prova que a pasta do worktree da run nem chega a existir e que nenhuma outra chamada é feita ao repositório quando a recusa dispara. A liberação vai por `freeReleaseCheckout`, dentro de `audited` (mesma porta de toda escrita, recusada em workspace de teste, com linha de auditoria `kind: 'worktree'`); nada a expõe a agentes.
- **Critério 2 (sem novo pulado ao repetir):** verificado do lado automatico: o test de `freeReleaseCheckout` devolve a action a `state: 'pending'` com `conflict` limpo e, na mesma sequência, o passo beta é aprovado e concluído (`done`), sem novo registro de pulado. A leitura do feed de ações da interface em execução real não foi feita nesta revisão (não verificado); a tela está coberta por `test/release-conflict-screen.test.ts` (a oferta e o texto aparecem só no card de release falhado com conflito, em ambos os idiomas, e a confirmação não vem antes do clique).
- **Critério 3 (nada muda com a branch livre):** verificado do lado automático: com a branch no próprio worktree da run, o beta corta como hoje; `open` e `stable` não deparam com a recusa cedo. O corte de beta simulado em repositório de teste pela interface não foi feito nesta revisão (não verificado).
- **Critérios 4 (orientação nas recusas) e 5 (skip manual):** `scriptFailGuidance` acrescenta a orientação ao fim da saída crua em "tag already exists" e "[Unreleased] is empty" e nada nas demais; as chaves novas existem nos dois catálogos e o `i18n:lint` passou. O skip manual não mudou (sem diff nele).

## Portões rodados nesta revisão

`npx tsc --noEmit` limpo; `npx vitest run` nos quatro arquivos tocados: 111 testes passando; `node scripts/theme-audit.mjs`, `npm run i18n:lint` (5375 chaves nos dois idiomas, 12 catálogos) e `node scripts/public-audit.mjs` (1516 arquivos) limpos. A suite completa não foi re-rodada nesta revisão; o relato da implementação (6558 passando, falhas restantes de ambiente) foi lido, não re-verificado.

## Segurança e repositório público

Toda escrita passa pelas portas existentes: `runReleaseOp` já atráis de `audited`, a liberação nova também; nenhum caminho de escrita ao host de código foi acrescentado; nada expõe `freeReleaseCheckout` pelo runner. O `public-audit` passou sobre a árvore inteira. Catálogos levam as chaves em par; a tela usa tokens de tema (botões `btn-amber`/`btn-red` existentes), e o `theme-audit` passou.

## Achados

Nenhum bloqueante. Uma sugestão: a expressão que deriva o worktree de steps (`release-{versão}-steps`) aparece em dois lugares de `src/main/actions.ts` e pode se desviar.

## Veredito

Aprovado.
