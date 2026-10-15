# Orçamento / Budget

[Português](#português) | [English](#english)

---

## Português

O Coxia guarda um **orçamento de operação** que a pessoa define: um total por mês e um limite por categoria (`model`, `infrastructure`, `domains` e as que vierem depois). Tudo que custa dinheiro é conferido contra ele **antes** de rodar e entra num **livro** com valor, fornecedor, recorrência, motivo e a linha de auditoria. É um limite de operação, **não uma garantia**: o limite do cartão, o teto de gasto do próprio provedor e os backups são da pessoa, fora do app.

### A configuração

`budget` na configuração do workspace (esquema 37; ver [`configuration.md`](configuration.md)):

```json
{ "budget": { "currency": "USD", "monthly": 50, "categories": { "model": 30, "infrastructure": 15 } } }
```

- `monthly` e cada categoria são números de zero ou mais; **ausente ou `null` é sem limite**. Um workspace que já existia ganha `monthly: null` e nenhuma categoria: nada muda para ele.
- `currency` é a moeda de todo limite e de todo valor (um código ISO 4217: `USD`, `BRL`, `EUR`…), escolhida em Configurações › Orçamento. Ela só muda num mês **sem gastos** ainda: as linhas do mês na moeda antiga seriam somadas como se fossem da nova.
- `rates` (opcional) diz quanto **uma unidade de outra moeda vale** na do orçamento, como a pessoa definiu: `{ "currency": "BRL", "rates": { "USD": 5.45 } }`. Um gasto cobrado numa moeda listada é convertido por essa cotação **antes** de ser conferido e gravado. Um cobrado numa moeda sem cotação é **recusado**, nunca lido como 1:1. O app não busca cotação em lugar nenhum: ela é da pessoa.
- O modelo é cobrado em `USD`, então um orçamento em outra moeda **precisa da cotação do `USD`**: sem ela, salvar é recusado, porque o custo de cada etapa seria recusado no livro.
- O mês é o mês civil em UTC. Quando ele vira, o que foi gasto no anterior deixa de contar e o que estava parado segue.
- Nenhuma credencial entra aqui, nem no livro: o que um gasto precisar para falar com o fornecedor é uma **referência de segredo**, nunca o valor.

### O livro

`<pasta do workspace>/budget/ledger.jsonl`, um JSON por linha, só acrescenta (modo `0600`). Cada linha: `id`, `at`, `category`, `vendor`, `amount`, `currency`, `recurrence` (`once`, `monthly`, `yearly`), `nextChargeAt` (só recorrente), `reason`, `allowedBy`, `auditRef`, `kind`, na linha conciliada `reconciles` (o `id` da estimada que ela substitui) e, na linha convertida de outra moeda, `original` (`amount`, `currency` e a `rate` usada: o preço como foi cobrado). `amount` e `currency` são sempre os do orçamento; a auditoria leva os dois valores e a cotação.

- **`allowedBy`**: `person` (o "sim" da pessoa), `grant:<id>` (uma concessão de autonomia) ou `estimate` (uso de modelo que o app estimou sem perguntar a ninguém). A autonomia em si é outra issue; aqui só se grava o que existe.
- **`auditRef`**: o `origin.key` da linha `spend` em `auditoria.jsonl`, ou o id da auditoria do "sim" que permitiu o gasto, quando quem chama o informa. Vendor e motivo passam pela mascaração de segredos antes de gravar.
- Um gasto que **não cabe** não roda: `checkSpend({ category, amount })` devolve a recusa com o código `budget-exceeded` e o texto com a categoria (ou o mês), o limite e o que resta. A recusa só é auditada quando quem chama pede (`audit: true`), para não encher o log com a olhada repetida do runner.

### Custo de modelo

O custo de modelo conta na mesma categoria (`model`). O motor aberto não recebe o custo do servidor em todo caso, então:

- o que o provedor ou o SDK informou na chamada entra como **`reconciled`** ("o provedor disse que cobrou"), e o que é só preço de lista (o SDK fora da API da Anthropic) ou uma conta de tokens × preço de lista entra como **`estimated`**; as duas somas aparecem **separadas**;
- `estimateFromTokens` faz a conta de tokens × preço de lista; hoje o processo principal não tem uma tabela de preços ligada ao runner, então uma etapa sem custo informado e sem preço não entra no livro;
- **não há conciliação com a API de cobrança de um provedor** ainda. O campo `reconciles` existe para quando houver: a linha conciliada substitui a estimada na soma, e as duas continuam no livro.

### O que pausa no limite

Quando a categoria `model` ou o mês chega ao limite:

- **o runner**: nenhuma etapa nova começa; a execução fica esperando (`wait.kind: budget`, provedor `workspace-budget`) com o motivo na conversa e na tela da execução, e nenhuma execução é iniciada sozinha pela etiqueta;
- **a agenda**: os agendamentos (iniciativa própria do app) não disparam; continuam vencidos e disparam quando houver folga;
- **as compras**: quem for gastar chama `checkSpend` antes (o trabalho de provisionamento).

Seguem funcionando: a instância, as cerimônias, o acesso pela web e a administração. Subir o limite, ou o mês virar, retoma sozinho na próxima varredura do runner.

### Canais

- `budget:get`: limites, mês, gasto por categoria (estimado e conciliado à parte), o que resta, se está pausado e por quê, e os custos recorrentes com a próxima cobrança (`proposeCancel`: o app só **propõe** cancelar; cancelar é do provisionamento, depois de um "sim").
- `budget:ledger(offset, limit)`: o livro em páginas, o mais novo primeiro.
- `budget:set`: define a moeda, as cotações e os limites. A janela do computador, a porta de administração local e um navegador pareado **com passkey** (um aparelho administrador): nele a seção aparece em Configurações e salvar pede a passkey na hora. Um navegador sem passkey não vê a seção e a chamada é recusada (`webPolicy.ts`); a persona não muda o orçamento. A mudança é auditada como qualquer salvamento de configuração.

Em Configurações › Configurações e workspaces › Orçamento há os campos do total e das categorias e uma linha "gasto / resta" por categoria.

### O que não foi verificado

- Nenhuma compra de verdade foi feita ainda. Além dos testes, a moeda e as cotações foram exercitadas como caixa preta num núcleo headless: pela porta de administração (pedido, "sim", liquidação em BRL e em USD, moeda sem cotação, troca de moeda com gasto no mês) e pelo painel web de um aparelho com passkey (definir BRL com a cotação do USD, a recusa sem ela e o gasto convertido na tela).
- O gasto de modelo foi exercitado com motores falsos; não com um provedor real nem com a API de cobrança de nenhum.
- O mês é UTC; perto da virada, a tela do computador pode mostrar o mês anterior por algumas horas.

---

## English

Coxia keeps an **operating budget** the person sets: a monthly total and a limit per category (`model`, `infrastructure`, `domains`, and the ones added later). Everything that costs money is checked against it **before** it runs and lands in a **ledger** with amount, vendor, recurrence, reason and the audit entry. It is an operating limit, **not a guarantee**: the card limit, the provider's own spending cap and backups are the person's, outside the app.

### The configuration

`budget` in the workspace configuration (schema 37; see [`configuration.md`](configuration.md)):

```json
{ "budget": { "currency": "USD", "monthly": 50, "categories": { "model": 30, "infrastructure": 15 } } }
```

- `monthly` and each category are numbers of zero or more; **absent or `null` means no limit**. A workspace that already existed gets `monthly: null` and no category: nothing changes for it.
- `currency` is the currency of every limit and every figure (an ISO 4217 code: `USD`, `BRL`, `EUR`…), chosen in Settings › Budget. It changes only in a month with **no spends** yet: the month's lines in the old one would be summed as if they were in the new one.
- `rates` (optional) says what **one unit of another currency is worth** in the budget's, as the person set it: `{ "currency": "BRL", "rates": { "USD": 5.45 } }`. A spend charged in a listed currency is converted at that rate **before** it is checked and recorded. One charged in a currency with no rate is **refused**, never read as 1:1. The app fetches no rate from anywhere: the rate is the person's.
- The model is priced in `USD`, so a budget in another currency **needs the `USD` rate**: without it, saving is refused, because every stage's cost would be refused at the ledger.
- The month is the calendar month in UTC. When it turns, what was spent in the previous one stops counting and what was held goes on.
- No credential goes here or in the ledger: whatever a spend needs to talk to a vendor is a **secret reference**, never the value.

### The ledger

`<workspace folder>/budget/ledger.jsonl`, one JSON per line, append-only (mode `0600`). Each line: `id`, `at`, `category`, `vendor`, `amount`, `currency`, `recurrence` (`once`, `monthly`, `yearly`), `nextChargeAt` (recurring only), `reason`, `allowedBy`, `auditRef`, `kind`, on a reconciled line `reconciles` (the `id` of the estimated line it replaces) and, on a line converted from another currency, `original` (`amount`, `currency` and the `rate` used: the price as it was charged). `amount` and `currency` are always the budget's; the audit carries both figures and the rate.

- **`allowedBy`**: `person` (the person's "yes"), `grant:<id>` (an autonomy grant) or `estimate` (model use the app estimated without asking anyone). Autonomy itself is another issue; this only records what exists.
- **`auditRef`**: the `origin.key` of the `spend` line in `auditoria.jsonl`, or the audit id of the "yes" that allowed the spend when the caller gives it. Vendor and reason go through the secret masking before they are written.
- A spend that **does not fit** does not run: `checkSpend({ category, amount })` returns the refusal with the code `budget-exceeded` and a text naming the category (or the month), the limit and what is left. A refusal is audited only when the caller asks (`audit: true`), so the runner's repeated look does not fill the log.

### Model cost

Model cost counts against the same category (`model`). The open engine does not always receive the cost from the server, so:

- what the provider or the SDK reported on the call is entered as **`reconciled`** ("the provider said it charged this"), and what is only a list price (the SDK outside Anthropic's own API) or a tokens × list price sum is entered as **`estimated`**; the two sums are shown **apart**;
- `estimateFromTokens` does the tokens × list price sum; today the main process has no price table wired to the runner, so a stage with no reported cost and no price is not entered in the ledger;
- there is **no reconciliation with a provider's billing API** yet. The `reconciles` field exists for when there is: the reconciled line replaces the estimated one in the sum, and both stay in the ledger.

### What pauses at the limit

When the `model` category or the month reaches its limit:

- **the runner**: no new stage starts; the run waits (`wait.kind: budget`, provider `workspace-budget`) with the reason in the conversation and on the run's screen, and no run is started by itself from the trigger label;
- **the scheduler**: schedules (the app's own initiative) do not fire; they stay due and fire when there is room;
- **purchases**: whoever is about to spend calls `checkSpend` first (the provisioning work).

Still working: the instance, the ceremonies, web access and admin. Raising the limit, or the month turning, resumes by itself at the runner's next sweep.

### Channels

- `budget:get`: limits, the month, spend per category (estimated and reconciled apart), what is left, whether it is paused and why, and the recurring costs with their next charge (`proposeCancel`: the app only **proposes** cancelling; cancelling belongs to provisioning, after a "yes").
- `budget:ledger(offset, limit)`: the ledger in pages, newest first.
- `budget:set`: sets the currency, the rates and the limits. The computer's window, the local admin door and a paired browser **with a passkey** (an admin device): there the section shows in Settings and saving asks for the passkey at that moment. A browser with no passkey does not see the section and the call is refused (`webPolicy.ts`); the persona does not change the budget. The change is audited like any configuration save.

Settings › Configuration and workspaces › Budget has the fields for the total and the categories and a "spent / left" line per category.

### What was not verified

- No real purchase was made yet. Beyond the tests, the currency and the rates were exercised as a black box on a headless core: through the admin door (request, yes, settlement in BRL and in USD, a currency with no rate, a change of currency with spends in the month) and through the web panel of a device with a passkey (setting BRL with the USD rate, the refusal without it and the converted spend on the screen).
- Model spend was exercised with fake engines, not with a real provider or any billing API.
- The month is UTC; near the turn, the computer's screen may show the previous month for a few hours.
