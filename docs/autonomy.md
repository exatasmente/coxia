# Autonomia por tipo de efeito / Autonomy by kind of effect

[Português](#português) | [English](#english)

---

## Português

Todo **tipo de efeito externo** começa **perguntando**. A autonomia de um tipo é **conquistada** (o histórico do tipo) e **concedida** (pela pessoa): depois de N propostas do tipo aprovadas, seguidas e sem nenhuma desfeita, o Coxia **oferece**; a pessoa confirma. Nenhum tipo fica de fora. Um agente nunca concede autonomia a si mesmo.

### Os tipos

`push`, `pull-request`, `comment`, `review`, `tracker` (rótulo, status, revisor, abrir e fechar issue), `deploy`, `email`, `dns`, `spend`, `budget-raise`, `permission-raise`. A lista é fechada em `src/shared/effects.ts` e cresce em um lugar só. Hoje as ações existentes viram:

| Ação | Tipo |
|---|---|
| push da branch de uma execução, push de resolução de conflito | `push` |
| release: `push-branch`, `push-tag` | `push` |
| criar pull request; `open` e `merge-pr` de um release | `pull-request` |
| comentário, resposta, nota | `comment` |
| revisão e aprovação | `review` |
| rótulo, status, revisor, rascunho, issue | `tracker` |
| release: `beta`, `stable` | `deploy` |

`email`, `dns`, `spend`, `budget-raise` e `permission-raise` ainda não têm integração: entram quando ela existir, pela mesma porta (`authorize` e `consume` em `src/main/effectGrants.ts`; `authorizeSpend` para um gasto).

### O histórico e a oferta

Por workspace, em `<atas>/autonomy/record.json`: **propostas, aprovadas, recusadas, desfeitas** e **feitas sozinhas** de cada tipo, mais a **sequência** (aprovadas seguidas sem desfazer; uma desfeita ou uma revogação a zera). Quando a sequência chega a **N** e não há concessão, o tipo é **oferecido**. N é 5; muda em `effects.offerAfter` ou, por tipo, em `effects.perKind`, e aparece em Ajustes › Configuração e workspaces › Autonomia, junto do histórico. Sem oferta, `autonomy:grant` recusa.

**Como se sabe que uma ação foi desfeita.** Não existe no app uma noção automática de "desfeito" (o `runs:undoPost` só propõe apagar um comentário do runner). Por isso a pessoa informa: `autonomy:mark-reverted(actionId)` marca uma decisão do histórico como desfeita, zera a sequência e, se o tipo tem concessão, conta como incidente; `autonomy:incident(kind, nota)` registra um incidente sem ação.

### A concessão

`autonomy:grant(kind, limite?, conta?)`: `{ id, kind, threshold?, grantedAt, grantedBy: 'person', via }` em `<atas>/autonomy/grants.json`. O **limite** de `spend` é o maior valor de **um** gasto (obrigatório); nos outros é o máximo de ações feitas sozinhas **por hora** (opcional). Quem pode: a janela, o socket de admin e um aparelho com passkey, que é perguntada na hora, **com o tipo de passkey do efeito** (`spend` e `budget-raise`: `budget`; `dns` e `deploy`: `infrastructure`; os outros: `permission`). A persona e os agentes não têm o canal. Uma concessão pode ser **ligada a uma conta** do registro ([`accounts.md`](accounts.md)): remover a conta a revoga, auditada.

**Onde a concessão vale: a saída única.** Quando uma proposta de um tipo concedido é feita (`proposeVcsAction`, o push do runner, ...), ela roda na hora pelo mesmo `approveAction` interno, **sem perguntar**, e a linha de auditoria traz `grant: "grant:<id>"` (a decisão e a escrita). Dentro do limite e do orçamento; acima, fica na fila e **pergunta**, como sempre. Não rodam por concessão: a proposta da **persona** (a pessoa a confirma), os passos de **release** (`alwaysWaits`: beta, stable e os pushes esperam sempre) e o push de resolução de conflito. Um gasto concedido anota `allowedBy: grant:<id>` no livro do orçamento e continua sujeito ao `checkSpend`.

### As chaves antigas

`runner.autonomy.push` e `.pullRequest` (com `cycle` ligado, no bloco do workspace ou de um fluxo) são **lidas como concessões da pessoa** (`legacy-push`, `legacy-pull-request`, `via: config`): não se copia nada, o runner decide como antes, e o push e o pull request que ele solta sozinho passam a trazer o `grant` na auditoria. Revogar o tipo desliga a chave. Nada que funciona hoje para.

### Revogar e incidente

`autonomy:revoke(kind)` apaga a concessão (e desliga a chave antiga); a **próxima** ação do tipo pergunta, sem cache: os arquivos são lidos a cada decisão. `autonomy:incident(kind, nota)` revoga, **avisa** (aviso e auditoria) e zera a sequência. Pode vir de qualquer cliente admin; num aparelho com passkey, pede a de tipo `permission`.

### Canais

`autonomy:status` (o navegador pareado lê), `autonomy:grant`, `autonomy:revoke`, `autonomy:incident`, `autonomy:mark-reverted` (janela, socket de admin e aparelho com passkey). Fora da porta da persona. Auditoria: tipo `autonomy` (`grant`, `revoke`, `incident`, `reverted`, `account`).

### Relação com outras autonomias

Os blocos de autonomia do runner (`cycle`, `gates`, `hostCommands`) e a política dos passos de tela (#269) seguem como estão: a política de tela decide passos irreversíveis de uma persona num site; esta aqui decide tipos de efeito pelo histórico.

### O que não foi verificado

Nenhuma integração real de e-mail, DNS, deploy ou gasto existe ainda; a classificação de uma escrita no host é lida do endpoint (heurística por provedor).

---

## English

Every **kind of external effect** starts out **asking**. Autonomy for a kind is **earned** (the kind's track record) and **granted** (by the person): after N proposals of the kind approved in a row with none reverted, Coxia **offers** it and the person confirms. No kind is excluded. An agent never grants autonomy to itself.

### The kinds

`push`, `pull-request`, `comment`, `review`, `tracker` (label, status, reviewer, open and close an issue), `deploy`, `email`, `dns`, `spend`, `budget-raise`, `permission-raise`. The list is closed in `src/shared/effects.ts` and grows in one place. Today's actions map to:

| Action | Kind |
|---|---|
| push of a run's branch, push of a conflict resolution | `push` |
| a release's `push-branch`, `push-tag` | `push` |
| creating a pull request; a release's `open` and `merge-pr` | `pull-request` |
| comment, reply, note | `comment` |
| review and approval | `review` |
| label, status, reviewer, draft, issue | `tracker` |
| a release's `beta`, `stable` | `deploy` |

`email`, `dns`, `spend`, `budget-raise` and `permission-raise` have no integration yet: they join when one exists, through the same door (`authorize` and `consume` in `src/main/effectGrants.ts`; `authorizeSpend` for a spend).

### The track record and the offer

Per workspace, in `<atas>/autonomy/record.json`: **proposed, approved, refused, reverted** and **done on its own** for each kind, plus the **streak** (approved in a row without a revert; a revert or a revocation sets it to zero). When the streak reaches **N** and no grant stands, the kind is **offered**. N is 5; change it in `effects.offerAfter` or, per kind, `effects.perKind`; it shows in Settings › Configuration and workspaces › Autonomy next to the record. With no offer, `autonomy:grant` refuses.

**How a revert is known.** The app has no automatic notion of "reverted" (`runs:undoPost` only proposes deleting a runner comment). So the person says it: `autonomy:mark-reverted(actionId)` marks a decision of the record as reverted, resets the streak and, if the kind has a grant, counts as an incident; `autonomy:incident(kind, note)` records an incident with no action.

### The grant

`autonomy:grant(kind, threshold?, account?)`: `{ id, kind, threshold?, grantedAt, grantedBy: 'person', via }` in `<atas>/autonomy/grants.json`. For `spend` the **threshold** is the most **one** spend may be (required); for the others it is the most actions done on its own **per hour** (optional). Who may: the window, the admin socket and a passkey device, asked at that moment **with the passkey kind of the effect** (`spend` and `budget-raise`: `budget`; `dns` and `deploy`: `infrastructure`; the rest: `permission`). The persona and the agents do not have the channel. A grant may be **tied to an account** of the registry ([`accounts.md`](accounts.md)): removing the account revokes it, audited.

**Where a grant applies: the single exit.** When a proposal of a granted kind is made (`proposeVcsAction`, the runner's push, ...) it runs at once through the same internal `approveAction`, **without asking**, and the audit line carries `grant: "grant:<id>"` (the decision and the write). Inside the threshold and the budget; above it the proposal stays in the queue and **asks**, as ever. A grant does not run: the **persona's** proposals (the person confirms them), the **release** steps (`alwaysWaits`: beta, stable and the pushes always wait) and the push of a conflict resolution. A granted spend writes `allowedBy: grant:<id>` in the budget ledger and is still subject to `checkSpend`.

### The old switches

`runner.autonomy.push` and `.pullRequest` (with `cycle` on, in the workspace's block or a flow's) are **read as grants by the person** (`legacy-push`, `legacy-pull-request`, `via: config`): nothing is copied, the runner decides as before, and the push and pull request it lets out by itself now carry the `grant` in the audit. Revoking the kind turns the switch off. Nothing that works today stops.

### Revoking and incidents

`autonomy:revoke(kind)` deletes the grant (and turns the old switch off); the **next** action of the kind asks, with no cache: the files are read at every decision. `autonomy:incident(kind, note)` revokes, **tells the person** (a notice and the audit) and resets the streak. It may come from any admin client; on a passkey device it asks for the `permission` passkey.

### Channels

`autonomy:status` (a paired browser reads), `autonomy:grant`, `autonomy:revoke`, `autonomy:incident`, `autonomy:mark-reverted` (window, admin socket and passkey device). Outside the persona's door. Audit: kind `autonomy` (`grant`, `revoke`, `incident`, `reverted`, `account`).

### How it relates to other autonomy

The runner's autonomy blocks (`cycle`, `gates`, `hostCommands`) and the screen-step policy (#269) stay as they are: the screen policy decides the persona's irreversible steps on a site; this decides kinds of effect by track record.

### What was not verified

No real email, DNS, deploy or spend integration exists yet; the classification of a host write is read from the endpoint (a heuristic per provider).
