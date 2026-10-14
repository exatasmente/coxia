# Contas externas / External accounts

[Português](#português) | [English](#english)

---

## Português

O Coxia mantém **um registro** das contas externas em que age: provedor de VPS, registrador, e-mail, pagamento, monitoramento, ferramentas. Cada conta é aberta **pela pessoa** (um provedor exige uma pessoa no cadastro, na verificação de identidade e nos termos); o Coxia age **dentro** dela pela API oficial do provedor. Quando um passo num site precisa de uma pessoa (um CAPTCHA, uma verificação de identidade), o Coxia **entrega a tela** à pessoa pela passagem de tela que já existe e continua depois.

### O que uma conta guarda

`{ id, provider, purpose, secretRefs, monthlyCost?, notes? }` em `accounts` da configuração do workspace (esquema 39). `provider` é o nome que a integração usa (`hetzner`, `github.com`), comparado sem diferença de maiúsculas. `secretRefs` são **referências** do cofre de segredos, nunca valores. `accounts:list` devolve, para cada referência, se ela **resolve agora** (`resolves`), e as concessões de autonomia ligadas à conta ([`autonomy.md`](autonomy.md)).

### A regra

`assertAccount(provider)` (`src/main/accounts.ts`) recusa um provedor que não está no registro. Toda integração nova com um provedor externo (provisionamento, e-mail, DNS) chama antes de pegar uma credencial. O servidor de código do workspace **não** passa por ela: a migração para o esquema 39 **lista** cada servidor de código configurado (`code-host-<id>`, com a referência do token), de modo que a regra vale para ele sem quebrar nenhum workspace. Um servidor de código adicionado depois não é listado sozinho.

### Remover

`accounts:remove` revoga **toda concessão ligada à conta** (auditada, tipo `autonomy`, `op: account`) e tira a conta. Uma concessão cuja conta saiu do registro por outro caminho (um salvamento da configuração) deixa de valer.

### Exportar

`accounts:export` devolve o registro sem nenhum valor de segredo: só as referências. O teste procura o valor de um segredo de teste na saída.

### Quem pode

`accounts:list` e `accounts:export`: o navegador pareado lê. `accounts:add`, `accounts:update` e `accounts:remove`: janela, socket de admin e aparelho com passkey, que pede a de tipo **`secret`** (a conta decide que credencial vale para qual provedor). A persona não tem os canais. `accounts:assert({ provider })` é de um cliente externo (o provisionamento): só a janela e o socket de admin, e devolve `{ id, provider, secretRefs }` ou `forbidden` ([`autonomy.md`](autonomy.md)).

### O que não foi feito

O custo mensal ainda não alimenta os itens recorrentes do orçamento (o livro só recebe e nunca reescreve; fica para depois). Não há tela. Nenhum caminho de plugin nomeia um provedor, então `assertAccount` ainda não é chamado por plugins.

---

## English

Coxia keeps **one registry** of the external accounts it acts in: VPS provider, registrar, email, payment, monitoring, tools. The **person** opens every account (a provider needs a person for sign-up, identity verification and terms); Coxia acts **inside** it through the provider's official API. When a step on a site needs a person (a CAPTCHA, an identity check), Coxia **hands the screen** to the person through the screen handover that exists and continues afterwards.

### What an account holds

`{ id, provider, purpose, secretRefs, monthlyCost?, notes? }` in `accounts` of the workspace configuration (schema 39). `provider` is the name an integration uses (`hetzner`, `github.com`), compared case-insensitively. `secretRefs` are **references** into the secrets store, never values. `accounts:list` returns, for each reference, whether it **resolves now** (`resolves`), and the grants of autonomy tied to the account ([`autonomy.md`](autonomy.md)).

### The rule

`assertAccount(provider)` (`src/main/accounts.ts`) refuses a provider that is not in the registry. Every new integration with an external provider (provisioning, email, DNS) calls it before it reaches for a credential. The workspace's code host does **not** go through it: the migration to schema 39 **lists** every configured code host (`code-host-<id>`, with the token's reference), so the rule holds for it without breaking any workspace. A code host added later is not listed by itself.

### Removing

`accounts:remove` revokes **every grant tied to the account** (audited, kind `autonomy`, `op: account`) and takes the account away. A grant whose account left the registry some other way (a configuration save) stops standing.

### Exporting

`accounts:export` returns the registry without any secret value: references only. The test searches the output for the value of a test secret.

### Who may

`accounts:list` and `accounts:export`: a paired browser reads. `accounts:add`, `accounts:update` and `accounts:remove`: window, admin socket and a passkey device, which asks for the **`secret`** passkey (the account decides which credential is for which provider). The persona does not have the channels. `accounts:assert({ provider })` is for an external client (provisioning): only the window and the admin socket, and it returns `{ id, provider, secretRefs }` or `forbidden` ([`autonomy.md`](autonomy.md)).

### What was not done

The monthly cost does not yet feed the budget's recurring items (the ledger only appends and never rewrites; a follow-up). There is no view. No plugin path names a provider, so plugins do not call `assertAccount` yet.
