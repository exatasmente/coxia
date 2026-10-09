# Plano: detectar o conflito de worktree antes de um passo de release rodar

## O que existe hoje (lido, não suposto)

- `src/main/releaseGit.ts` já é o lugar do tema: `checkedOutElsewhere` (linhas 197-205) lista os worktrees e devolve o caminho que segura a branch; `switchTo` (224-230) recusa com `main.release.branchElsewhere` (linha 1831 de ambos os catálogos) quando a branch está em outro worktree — o texto já nomeia branch, caminho e o que fazer. Os que passam pela recusa são `merge-pr`, `beta` e `push-branch` (da release), pelos `switchTo` nas linhas 431, 451 e 500.
- Mas a recusa só chega a quem conduz depois que o passo começou a rodar (`runReleaseOp`, linha 525, só despacha), vem como erro genérico do `runRelease` (`src/main/actions.ts:584`) e é gravada como `state: failed` sem nada que ofereça um caminho de saída; na prática o passo era pulado e tentado de novo, o padrão que a issue documentou.
- `stable` não faz `switchTo` na branch de release (linhas 458-483: ele põe a worktree da run num commit desanexado em `mainBase()` e só mescla a branch dentro dela), então o conflito de checkout não o atinge; `open` recusa antes de rodar quando a branch já existe (`branchExists`, linha 391) e nunca precisa da branch.
- As recusas de conteúdo ficam no script do repositório, `scripts/release.sh`: "tag … already exists" (linhas 139, 249), "[Unreleased] is empty … describe the changes first" (linha 316). Elas chegam à saída do passo cruas, dentro de `main.release.scriptFailed`.
- A action de release (`ReleaseAction`) carrega `state`, `output`, `unit` e nada que diga "este passo parou por conflito de worktree". A tela de ações (`src/renderer/src/screens/Actions.tsx`) já tem o padrão de confirmação de passo (`confirming` → botão vermelho, linhas 151-165) e `api.approveAction` como o jeito de pedir algo ao main.

## Mudanças, na ordem

### 1. Checagem do conflito antes de qualquer efeito (src/main/releaseGit.ts)

- Nova função exportada `assertBranchFree(unit, clone)`:
  ```ts
  if (unit.op !== 'merge-pr' && unit.op !== 'beta' && !(unit.op === 'push-branch' && unit.branch !== 'main')) return;
  const held = await checkedOutElsewhere(clone, releaseBranchOf(unit.version));
  if (held) throw new ReleaseConflictError(t('main.release.branchElsewhere', { branch: releaseBranchOf(unit.version), path: held }), { branch: releaseBranchOf(unit.version), path: held });
  ```
- `ReleaseConflictError` é uma classe de erro nova neste arquivo: além da mensagem traduzida, carrega `{ branch, path }` para o main usar.
- Chamada em `runReleaseOp` (linha 525), depois de `assertRepo` e **antes de `prepareWorktree`**: nenhum diretório do app é criado antes da recusa.
- A chave reusada é `main.release.branchElsewhere` (ver item 3).

### 2. Liberar o checkout do outro worktree, com confirmação da pessoa (src/main/releaseGit.ts + src/main/actions.ts + api + tela)

- `releaseGit.ts` ganha `freeBranchCheckout(clone, branch): Promise<string | null>` (o caminho liberado, ou `null` quando nada havia a fazer — o caso em que a pessoa liberou à mão):
  1. Re-lista os worktrees; se a branch não está mais em outro worktree, devolve `null`.
  2. Se o caminho listado não existe no disco (worktree registrado com pasta apagada; detectá-lo com o teste que `registeredButGone` já faz), recusa com `main.release.worktreeGone` — parar e pedir, nunca inferir (decisão da spec).
  3. Recusa se `rev-parse --git-common-dir` do caminho difere do do clone, com `main.release.worktreeBusy`: só worktree do mesmo repositório é tocado.
  4. Recusa se o outro worktree tem mudanças não commitadas (`status --porcelain`), com `main.release.worktreeDirty`: um checkout com trabalho não guardado não é desanexado.
  5. Recusa se, relida de novo, a branch não é mais a esperada (`main.release.worktreeNotBranch`).
  6. Ao passar: `git -C <outro worktree> switch --quiet --detach` (fica no mesmo commit, nada se perde) e verifica que a branch ficou livre; devolve o caminho.
- `src/main/actions.ts`: função exportada `freeReleaseCheckout(id: string): Promise<ReleaseAction>` que lê a action (`kind === 'release-git'`, `state === 'failed'`, `conflict` presente), resolve o contexto com `releaseContextOf(unit)`, roda `freeBranchCheckout` dentro de `audited(...)` — a mesma porta de toda escrita, com `assertExternalWrite` (recusada num workspace de teste). Linha de auditoria: `kind: 'worktree'`, `target: 'worktree <path> detach (<branch>)'`, `via: 'git'`. Ao fim: limpa `conflict` e devolve a action a `state: 'pending'` (o passo pode ser aprovado de novo de imediato, critério 2 da spec); sai com `main.release.worktreeFreed` no output.
- A confirmação da pessoa é o portão de tela, não uma nova estratégia de confiança: o botão (abaixo) só envia depois que a pessoa clicou no padrão de confirmação já usado por `approveAction` — e nada expõe a função em `runner/door.ts`, então nenhum agente a chama.
- `api` do renderer (`src/renderer/src/api.ts`): nova função `freeReleaseCheckout(id)`, seguindo o padrão de `approveAction`, junto do canal do preload pelo qual as chamadas de action já passam.

### 3. Mensagens de orientação nas recusas do script (src/main/releaseGit.ts + catálogos)

- Onde `script` lança `main.release.scriptFailed` (linha 302), uma função pura `scriptFailGuidance(detail)` casa o fim da saída do script com as frases fixas do repositório e devolve uma orientação traduzida:
  - `/tag v\S+ already exists/` → `main.release.tagExistsNext`: a versão já foi cortada, nada há a repetir; siga para o passo seguinte (enviar a tag ou a branch).
  - `/\[Unreleased\] is empty/` → `main.release.unreleasedEmptyNext`: descreva as alterações no `CHANGELOG.md` antes do corte; o app não as escreve.
  - `/branch .* already exists/` → nada: `open` já recusa antes de rodar (`branchExists`), e a mensagem dele já orienta.
- O texto do `scriptFailed` sai **com a orientação acrescentada depois de uma linha em branco**: a saída crua continua (nada é escondido) e a orientação vai junto ao feed.
- Chaves novas (todas em `src/shared/i18n/main.en.json` e `main.pt-BR.json`, nas seções `main.release.*` e `ui.actions.*` — ambas em par):
  - `main.release.tagExistsNext`, `main.release.unreleasedEmptyNext`
  - `main.release.worktreeGone`, `main.release.worktreeDirty`, `main.release.worktreeNotBranch`, `main.release.worktreeFreed`
  - `ui.actions.freeBranch` (botão), `ui.actions.confirm.freeBranch` (texto de confirmação), `ui.actions.busy.freeBranch`
  - Texto de `main.release.branchElsewhere` ganha um acréscimo curto dizendo que a action pode liberar o checkout.
- `CHANGELOG.md` `## [Unreleased]`: entrada sobre a nova detecção do conflito, a oferta de liberar com confirmação e a orientação nas recusas (mudança visível a quem usa).

### 4. A action falha registra por quê (src/shared/types.ts + src/main/actions.ts)

- `ReleaseAction` ganha um campo opcional `conflict?: { branch: string; path: string }` em `src/shared/types.ts`. A action vive no estado do workspace, não no schema de configuração, então não há migration de `STEPS`; `defaults.ts` e `schema.ts` ficam como estão.
- No `catch` de `approveAction` (linha 638), quando o erro é `ReleaseConflictError`, `update(id, …)` acrescenta `conflict: { branch, path }` antes de devolver a action.
- O campo é opcional e só a tela (item 5) e `freeReleaseCheckout` o leem; a saída continua como está.

### 5. Tela de ações oferece resolver (src/renderer/src/screens/Actions.tsx)

- Em `ActionCard`, quando `a.kind === 'release-git' && a.conflict && a.state === 'failed'`:
  - um botão `btn-amber` (o tom de card de conflito, já no tema) `ui.actions.freeBranch` que entra em `confirming` e, confirmando, roda `api.freeReleaseCheckout(a.id)` pelo padrão `start('approve', …, …)` de hoje;
  - o texto `ui.actions.confirm.freeBranch` diz o que vai acontecer (qual worktree volta a um head desanexado, qual branch fica livre) antes do "sim".
- Nada muda nos cards pendentes nem na ordem dos portões já definidos; tokens de tema, nenhum literal de cor.

## Ordem do trabalho

1. `ReleaseConflictError` + `assertBranchFree` + chamada em `runReleaseOp` (releaseGit.ts) — sem mudança de texto; os testes de hoje continuam passando.
2. `freeBranchCheckout` (releaseGit.ts) e seus casos de recusa.
3. Chaves i18n novas e texto de `branchElsewhere` e `CHANGELOG.md`.
4. `freeReleaseCheckout` + campo `conflict` + mapeamento no `catch` de `approveAction` (actions.ts, types.ts).
5. Botão de tela (Actions.tsx) com as chaves em ambos os catálogos.
6. Testes por comportamento (abaixo) e as portas: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

## Testes, um por comportamento

Todos com repositório git de teste construído em pasta temporária (o padrão que `test/release-git.test.ts` já segue); nenhum chega a rede ou host real.

| Comportamento | Arquivo de teste |
|---|---|
| Passo que precisa da branch (beta) para antes de qualquer efeito quando a branch está em outro worktree: lança `ReleaseConflictError`, e a worktree da release não chega a ser criada (a pasta não existe) | `test/release-git-conflict.test.ts` (novo) |
| `open` e `stable` seguem como hoje com a branch presa em outro worktree (`stable` não passa pela nova checagem) | `test/release-git-conflict.test.ts` |
| `assertBranchFree` fica mudo quando a branch está livre (nada muda) | `test/release-git-conflict.test.ts` |
| `freeBranchCheckout` desanexa o outro worktree e deixa a branch livre (critério 2, lado git) | `test/release-git-conflict.test.ts` |
| `freeBranchCheckout` recusa: worktree com trabalho não commitado; pasta do worktree apagada; worktree de outro repositório; branch já liberada devolve `null` sem erro | `test/release-git-conflict.test.ts` |
| `scriptFailGuidance` acrescenta a orientação certa para "tag … already exists" e "[Unreleased] is empty" e nada para as demais | `test/release-git-conflict.test.ts` (função pura) |
| `approveAction` de um passo que depara com `ReleaseConflictError` grava a action `failed` com `conflict` preenchido; um workspace de teste recusa a escrita e nada sai (regressão da porta) | `test/release-actions.test.ts` (estende) |
| `freeReleaseCheckout` de uma action com `conflict` volta a `pending` com `conflict` limpo e devolve ao passo a possibilidade de ser aprovado de novo | `test/release-actions.test.ts` (estende) |
| Card de release com `conflict` mostra o botão de liberar com o texto de confirmação; sem `conflict`, o card é como hoje | `test/release-conflict-screen.test.ts` (novo, mesmo padrão dos testes de tela existentes) |
| Skip manual continua com motivo e registro (sem mudança de comportamento — regressão) | `test/release-actions.test.ts` (já coberto; não reescrever) |

Os cenários de interface da spec (corte com a branch presa em segundo worktree; confirmação de liberar e o passo repetido sem novo registro de pulado; recusas de tag existente e de changelog vazio lidas no feed) são conferidos na implementação num repositório de teste com o script real local (`test/release-script.test.ts` já segue esse padrão) e pela tela; ficam como executados só se então rodados.

## Riscos e como se evitam

- **Desanexar o worktree errado** (o da pessoa, com trabalho dela dentro). Contido por: o caminho sai só da listagem de `worktree list` com a branch esperada; o `--git-common-dir` precisa igualar o do clone; status não-limpo recusa; e a pessoa confirma com o texto que nomeia caminho e branch antes. O teste de recusas cobre essas três barricadas.
- **O script do repositório muda as frases.** Contido por: a orientação é acrescentada, nunca no lugar da saída crua, e as regex são largas; quando nenhuma casa, fica como hoje.
- **O campo `conflict` numa action gravada por uma versão anterior do app.** Contido por: campo opcional, toda leitura trata ausente.
- **Um segundo worktree aparecer entre a checagem e o passo.** Contido por: o git recusa do mesmo jeito de hoje em `switchTo`, com a mesma mensagem; nada fica pior do que hoje.
- **Confirmar sem ler**: o padrão de tela é o mesmo de `approveAction` (botão neutro → vermelho com o texto do que vai acontecer); a confirmação de liberar não introduz um conceito novo.

## Decisões e porquê

1. **A checagem fica em `runReleaseOp`, não dentro de cada op.** Uma checagem só, antes do único ponto que prepara a worktree, cobre os três passos que precisam e não toca os outros; `open` e `stable` ficam fora porque nenhum deles passa por `switchTo` (lido no código).
2. **Recusa adiantada reusa `checkedOutElsewhere` e a chave `main.release.branchElsewhere`.** A lógica e o texto já dizem o que a spec pede (linha 1831 dos catálogos); inventar mensagem nova é mudança de catálogo sem ganho. O acréscimo é só apontar a ação de liberar.
3. **Erro marcado + campo `conflict` na action.** O feed é onde a pessoa vê por que o passo parou; sem o campo, o card só distinguiria pela saída textual, o que é frágil (tradução, linha em que a falha veio). Com o campo, o botão de resolver existe por dado, não por casar texto.
4. **Resolução como função do main atrás de `audited`, não como nova action / novo op.** Soltar um checkout não é um passo de release (não entra em `ReleaseUnit` nem na ordem dos passos); é uma mutação local do git, digna de linha de auditoria como qualquer escrita que passa da porta. Reusar o portão de tela existente evita um conceito novo de confirmação.
5. **Orientação como acréscimo na saída do script, não recusas reescritas em tradução.** O script é o único que decide se uma versão pode ser cortada (bloco inicial de `releaseGit.ts`); traduzir de novo as regras dele duplicaria as regras. O app acrescenta a orientação, não substitui a mensagem.
6. **Pasta de worktree apagada não se auto-pruna.** Um `git worktree prune` amplo apagaria os registros de worktrees cujas pastas sumiram por outros motivos (drive não montado); a tomada de um caminho desta release já existe só para o da release (`prepareWorktree`). Para caminho alheio, a regra é parar e pedir (decisão da spec).
7. **Sem mudança de schema de configuração.** `conflict` vive em `ReleaseAction` (estado do workspace, não config), então `STEPS`, `defaults.ts` e `schema.ts` ficam fora.
