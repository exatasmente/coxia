# Autonomia por tipo de efeito / Autonomy by kind of effect

[Português](#português) | [English](#english)

---

## Português

Todo **tipo de efeito externo** começa **perguntando**. A autonomia de um tipo é **conquistada** (o histórico do tipo) e **concedida** (pela pessoa): depois de N propostas do tipo aprovadas, seguidas e sem nenhuma desfeita, o Coxia **oferece**; a pessoa confirma. Nenhum tipo fica de fora. Um agente nunca concede autonomia a si mesmo.

### Os tipos

`push`, `pull-request`, `comment`, `review`, `tracker` (rótulo, status, revisor, abrir e fechar issue), `deploy`, `email`, `dns`, `spend`, `destroy`, `budget-raise`, `permission-raise`. A lista é fechada em `src/shared/effects.ts` e cresce em um lugar só. Hoje as ações existentes viram:

| Ação | Tipo |
|---|---|
| push da branch de uma execução, push de resolução de conflito | `push` |
| release: `push-branch`, `push-tag` | `push` |
| criar pull request; `open` e `merge-pr` de um release | `pull-request` |
| comentário, resposta, nota | `comment` |
| revisão e aprovação | `review` |
| rótulo, status, revisor, rascunho, issue | `tracker` |
| release: `beta`, `stable` | `deploy` |

`email`, `dns`, `budget-raise` e `permission-raise` ainda não têm integração: entram quando ela existir, pela mesma porta (`authorize` e `consume` em `src/main/effectGrants.ts`; `authorizeSpend` para um gasto). `spend` e `destroy` têm a porta de um cliente externo, abaixo.

### O histórico e a oferta

Por workspace, em `<atas>/autonomy/record.json`: **propostas, aprovadas, recusadas, desfeitas** e **feitas sozinhas** de cada tipo, mais a **sequência** (aprovadas seguidas sem desfazer; uma desfeita ou uma revogação a zera). Quando a sequência chega a **N** e não há concessão, o tipo é **oferecido**. N é 5; muda em `effects.offerAfter` ou, por tipo, em `effects.perKind`, e aparece em Ajustes › Configuração e workspaces › Autonomia, junto do histórico. Sem oferta, `autonomy:grant` recusa.

**Como se sabe que uma ação foi desfeita.** Não existe no app uma noção automática de "desfeito" (o `runs:undoPost` só propõe apagar um comentário do runner). Por isso a pessoa informa: `autonomy:mark-reverted(actionId)` marca uma decisão do histórico como desfeita, zera a sequência e, se o tipo tem concessão, conta como incidente; `autonomy:incident(kind, nota)` registra um incidente sem ação.

### A concessão

`autonomy:grant(kind, limite?, conta?)`: `{ id, kind, threshold?, grantedAt, grantedBy: 'person', via }` em `<atas>/autonomy/grants.json`. O **limite** de `spend` é o maior valor de **um** gasto (obrigatório); nos outros é o máximo de ações feitas sozinhas **por hora** (opcional). Quem pode: a janela, o socket de admin e um aparelho com passkey, que é perguntada na hora, **com o tipo de passkey do efeito** (`spend` e `budget-raise`: `budget`; `dns`, `deploy` e `destroy`: `infrastructure`; os outros: `permission`). A persona e os agentes não têm o canal. Uma concessão pode ser **ligada a uma conta** do registro ([`accounts.md`](accounts.md)): remover a conta a revoga, auditada.

**Onde a concessão vale: a saída única.** Quando uma proposta de um tipo concedido é feita (`proposeVcsAction`, o push do runner, ...), ela roda na hora pelo mesmo `approveAction` interno, **sem perguntar**, e a linha de auditoria traz `grant: "grant:<id>"` (a decisão e a escrita). Dentro do limite e do orçamento; acima, fica na fila e **pergunta**, como sempre. Não rodam por concessão: a proposta da **persona** (a pessoa a confirma), os passos de **release** (`alwaysWaits`: beta, stable e os pushes esperam sempre) e o push de resolução de conflito. Um gasto concedido anota `allowedBy: grant:<id>` no livro do orçamento e continua sujeito ao `checkSpend`.

### As chaves antigas

`runner.autonomy.push` e `.pullRequest` (com `cycle` ligado, no bloco do workspace ou de um fluxo) são **lidas como concessões da pessoa** (`legacy-push`, `legacy-pull-request`, `via: config`): não se copia nada, o runner decide como antes, e o push e o pull request que ele solta sozinho passam a trazer o `grant` na auditoria. Revogar o tipo desliga a chave. Nada que funciona hoje para.

### Revogar e incidente

`autonomy:revoke(kind)` apaga a concessão (e desliga a chave antiga); a **próxima** ação do tipo pergunta, sem cache: os arquivos são lidos a cada decisão. `autonomy:incident(kind, nota)` revoga, **avisa** (aviso e auditoria) e zera a sequência. Pode vir de qualquer cliente admin; num aparelho com passkey, pede a de tipo `permission`.

### Canais

`autonomy:status` (o navegador pareado lê), `autonomy:grant`, `autonomy:revoke`, `autonomy:incident`, `autonomy:mark-reverted` (janela, socket de admin e aparelho com passkey). Fora da porta da persona. Auditoria: tipo `autonomy` (`grant`, `revoke`, `incident`, `reverted`, `account`).

### Pedidos de um cliente externo

Um cliente na mesma máquina (o `coxia-provision`, pelo socket de admin) pergunta **antes** de comprar ou destruir e conta **depois** o que custou. Três canais, da janela e do socket de admin; o navegador pareado (mesmo um aparelho com passkey) e a persona não os têm.

- `effects:request({ requestId, kind, accountId, summary, amount?, currency?, category?, recurrence?, target? })`. `kind` é `spend` (pede `amount` e `currency`, que é a do orçamento) ou `destroy` (sem valor). `requestId` (`[A-Za-z0-9_-]{8,64}`) é a chave de idempotência: os mesmos argumentos devolvem o mesmo estado e o mesmo bilhete, outros argumentos dão `conflict`. A resposta é `{ state: 'allowed', allowedBy, ticket, expiresAt }` ou `{ state: 'pending', proposalId }`; no `pending` o cliente repete a chamada com o mesmo `requestId` até a pessoa responder.
- A ordem da decisão: **o orçamento primeiro** (`budget-exceeded`, antes de qualquer pergunta; um "sim" depois não passa por cima do limite, que é conferido de novo quando o sim chega), depois uma **concessão** do tipo (`spend` até o limite dela, `destroy` até N por hora; uma concessão ligada a outra conta não vale), e por fim uma **proposta** em Ações (`effect-request`) que a pessoa aprova ou recusa como qualquer outra. Aprovar não faz nada fora: a próxima chamada do cliente recebe o bilhete. Quem não responde em 1 h tem a proposta posta de lado e o cliente lê `forbidden`; a recusa também é `forbidden`.
- `destroy` sem concessão é sempre uma proposta. O "sim" vem do computador, ou de um aparelho admin com a passkey de tipo `infrastructure` (pedida na hora); um navegador pareado sem passkey não aprova. Os outros pedidos mantêm a regra de `actions:approve`.
- `effects:settle({ ticket, actual: { amount, currency, kind?, reference? } })` conta o custo: `kind` é `estimated` (padrão) ou `reconciled`; vira uma linha do livro do orçamento (categoria, fornecedor = o provedor da conta, recorrência, motivo = o resumo, `allowedBy` do bilhete). `amount` 0 só fecha o bilhete. Acima do autorizado, **grava mesmo assim**, audita como estouro e devolve `overrun: true`: o dinheiro já saiu. Um bilhete se liquida **uma vez** (`conflict` na segunda); desconhecido ou vencido é `not-found`.
- `accounts:assert({ provider })` devolve `{ id, provider, secretRefs }` da conta registrada (sem diferença de maiúsculas) ou `forbidden`.

Os bilhetes ficam em `<atas>/effects/<requestId>.json` (0600) e valem **1 h** depois de emitidos (o bilhete sai na chamada que encontra o sim, não no sim). Passada a hora o arquivo some; um pedido com o mesmo `requestId` depois disso recomeça. Auditoria: tipos `spend` (compras e liquidações) e `autonomy` (destruições), alvo `effects:<passo>:<tipo>`.

### Relação com outras autonomias

Os blocos de autonomia do runner (`cycle`, `gates`, `hostCommands`) e a política dos passos de tela (#269) seguem como estão: a política de tela decide passos irreversíveis de uma persona num site; esta aqui decide tipos de efeito pelo histórico.

### O que não foi verificado

Nenhuma integração real de e-mail, DNS, deploy ou gasto existe ainda; a classificação de uma escrita no host é lida do endpoint (heurística por provedor).

---

## English

Every **kind of external effect** starts out **asking**. Autonomy for a kind is **earned** (the kind's track record) and **granted** (by the person): after N proposals of the kind approved in a row with none reverted, Coxia **offers** it and the person confirms. No kind is excluded. An agent never grants autonomy to itself.

### The kinds

`push`, `pull-request`, `comment`, `review`, `tracker` (label, status, reviewer, open and close an issue), `deploy`, `email`, `dns`, `spend`, `destroy`, `budget-raise`, `permission-raise`. The list is closed in `src/shared/effects.ts` and grows in one place. Today's actions map to:

| Action | Kind |
|---|---|
| push of a run's branch, push of a conflict resolution | `push` |
| a release's `push-branch`, `push-tag` | `push` |
| creating a pull request; a release's `open` and `merge-pr` | `pull-request` |
| comment, reply, note | `comment` |
| review and approval | `review` |
| label, status, reviewer, draft, issue | `tracker` |
| a release's `beta`, `stable` | `deploy` |

`email`, `dns`, `budget-raise` and `permission-raise` have no integration yet: they join when one exists, through the same door (`authorize` and `consume` in `src/main/effectGrants.ts`; `authorizeSpend` for a spend). `spend` and `destroy` have the door of an external client, below.

### The track record and the offer

Per workspace, in `<atas>/autonomy/record.json`: **proposed, approved, refused, reverted** and **done on its own** for each kind, plus the **streak** (approved in a row without a revert; a revert or a revocation sets it to zero). When the streak reaches **N** and no grant stands, the kind is **offered**. N is 5; change it in `effects.offerAfter` or, per kind, `effects.perKind`; it shows in Settings › Configuration and workspaces › Autonomy next to the record. With no offer, `autonomy:grant` refuses.

**How a revert is known.** The app has no automatic notion of "reverted" (`runs:undoPost` only proposes deleting a runner comment). So the person says it: `autonomy:mark-reverted(actionId)` marks a decision of the record as reverted, resets the streak and, if the kind has a grant, counts as an incident; `autonomy:incident(kind, note)` records an incident with no action.

### The grant

`autonomy:grant(kind, threshold?, account?)`: `{ id, kind, threshold?, grantedAt, grantedBy: 'person', via }` in `<atas>/autonomy/grants.json`. For `spend` the **threshold** is the most **one** spend may be (required); for the others it is the most actions done on its own **per hour** (optional). Who may: the window, the admin socket and a passkey device, asked at that moment **with the passkey kind of the effect** (`spend` and `budget-raise`: `budget`; `dns`, `deploy` and `destroy`: `infrastructure`; the rest: `permission`). The persona and the agents do not have the channel. A grant may be **tied to an account** of the registry ([`accounts.md`](accounts.md)): removing the account revokes it, audited.

**Where a grant applies: the single exit.** When a proposal of a granted kind is made (`proposeVcsAction`, the runner's push, ...) it runs at once through the same internal `approveAction`, **without asking**, and the audit line carries `grant: "grant:<id>"` (the decision and the write). Inside the threshold and the budget; above it the proposal stays in the queue and **asks**, as ever. A grant does not run: the **persona's** proposals (the person confirms them), the **release** steps (`alwaysWaits`: beta, stable and the pushes always wait) and the push of a conflict resolution. A granted spend writes `allowedBy: grant:<id>` in the budget ledger and is still subject to `checkSpend`.

### The old switches

`runner.autonomy.push` and `.pullRequest` (with `cycle` on, in the workspace's block or a flow's) are **read as grants by the person** (`legacy-push`, `legacy-pull-request`, `via: config`): nothing is copied, the runner decides as before, and the push and pull request it lets out by itself now carry the `grant` in the audit. Revoking the kind turns the switch off. Nothing that works today stops.

### Revoking and incidents

`autonomy:revoke(kind)` deletes the grant (and turns the old switch off); the **next** action of the kind asks, with no cache: the files are read at every decision. `autonomy:incident(kind, note)` revokes, **tells the person** (a notice and the audit) and resets the streak. It may come from any admin client; on a passkey device it asks for the `permission` passkey.

### Channels

`autonomy:status` (a paired browser reads), `autonomy:grant`, `autonomy:revoke`, `autonomy:incident`, `autonomy:mark-reverted` (window, admin socket and passkey device). Outside the persona's door. Audit: kind `autonomy` (`grant`, `revoke`, `incident`, `reverted`, `account`).

### Requests from an external client

A client on the same machine (`coxia-provision`, through the admin socket) asks **before** it buys or destroys something and tells the core **afterwards** what it cost. Three channels, for the window and the admin socket; a paired browser (a passkey device too) and the persona do not have them.

- `effects:request({ requestId, kind, accountId, summary, amount?, currency?, category?, recurrence?, target? })`. `kind` is `spend` (needs `amount` and `currency`, which is the budget's) or `destroy` (no amount). `requestId` (`[A-Za-z0-9_-]{8,64}`) is the idempotency key: the same arguments return the same state and ticket, other arguments are `conflict`. The answer is `{ state: 'allowed', allowedBy, ticket, expiresAt }` or `{ state: 'pending', proposalId }`; on `pending` the client repeats the call with the same `requestId` until the person answers.
- The order of the decision: **the budget first** (`budget-exceeded`, before anyone is asked; a "yes" later does not override the limit, which is checked again when the yes arrives), then a **grant** of the kind (`spend` up to its threshold, `destroy` up to N an hour; a grant tied to another account does not cover it), then a **proposal** in Actions (`effect-request`) that the person approves or refuses like any other. Approving does nothing outside: the client's next call is given the ticket. A proposal nobody answers within 1 h is set aside and the client reads `forbidden`; a refusal is `forbidden` too.
- A `destroy` with no grant is always a proposal. The "yes" comes from the computer, or from an admin device with the passkey of kind `infrastructure`, asked at that moment; a paired browser without a passkey does not approve. Other requests keep the rule of `actions:approve`.
- `effects:settle({ ticket, actual: { amount, currency, kind?, reference? } })` records the cost: `kind` is `estimated` (the default) or `reconciled`; it becomes a line of the budget ledger (category, vendor = the account's provider, recurrence, reason = the summary, `allowedBy` from the ticket). An `amount` of 0 only closes the ticket. Above what was authorized it **records anyway**, audits it as an overrun and answers `overrun: true`: the money is already spent. A ticket is settled **once** (`conflict` the second time); an unknown or expired one is `not-found`.
- `accounts:assert({ provider })` returns `{ id, provider, secretRefs }` of the registered account (case-insensitive) or `forbidden`.

Tickets are kept in `<atas>/effects/<requestId>.json` (0600) and live **1 h** after they are issued (the ticket is issued by the call that finds the yes, not at the yes). After that the file goes; a request with the same `requestId` then starts over. Audit: kinds `spend` (purchases and settlements) and `autonomy` (destroys), target `effects:<step>:<kind>`.

### How it relates to other autonomy

The runner's autonomy blocks (`cycle`, `gates`, `hostCommands`) and the screen-step policy (#269) stay as they are: the screen policy decides the persona's irreversible steps on a site; this decides kinds of effect by track record.

### What was not verified

No real email, DNS, deploy or spend integration exists yet; the classification of a host write is read from the endpoint (a heuristic per provider).
