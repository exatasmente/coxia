# Passkeys e dispositivos administradores / Passkeys and admin devices

[Português](#português) | [English](#english)

---

## Português

Um navegador pareado (o celular, a web da instância) só ganha direitos de administrador se o **aparelho registrou uma passkey** (WebAuthn, com digital, rosto ou PIN). Mesmo assim, toda mudança sensível pede a passkey **na hora**: ter o aparelho, ou o código de pareamento, não basta.

### Quem é administrador

- **Aparelho pareado sem passkey:** os direitos de sempre. Executa as rotinas do ciclo, mas configuração, segredos, pareamento e o resto do que é "do computador" ficam recusados (`src/main/webPolicy.ts`).
- **Aparelho pareado com passkey:** os canais de administração abrem: salvar a configuração, segredos, importar configuração, confirmar segredo do ambiente de teste, aplicar ciclo e agentes, o editor de prompts, pareamento, documentação dos repositórios, assistente de agentes, escrita de procedimentos, a decisão sobre plugins, excluir workspace e marcar workspace de teste. Continuam **só do computador** os canais que mexem na máquina em si: atualização do app, terminal e área de transferência, início automático, retenção de arquivos, comandos de conflito, o assistente de instalação, a instalação da voz, as sessões do Claude Code, o Remote Control, o servidor de estado e a entrada na tela do agente. Quem abrir algum deles para o aparelho com passkey decide depois.
- **A janela do desktop e o soquete de administração local** (`admin.sock`) não pedem passkey. A janela é a própria pessoa na máquina, e quem abre o soquete já é o usuário que roda o núcleo, com acesso ao disco, ao chaveiro e às chaves do app; exigir passkey ali não protegeria nada e travaria uma instalação existente que nunca registrou uma. O ato da persona também não pede (a pessoa o confirma antes).

### O que pede a passkey

Cada pedido leva um **tipo**, e a prova vale para um tipo só, uma vez, por 60 segundos:

| Tipo | Quando |
|---|---|
| `secret` | gravar, remover ou aceitar o armazenamento inseguro de segredo; confirmar ou revogar segredo do ambiente de teste; segredo de plugin |
| `permission` | subir permissão, alcance ou autonomia de um agente em `config:cycle-save`; `config:save`, importar configuração, salvar prompt, aplicar ciclo ou agentes, decisões sobre plugins, marcar workspace de teste |
| `budget` | o limite de gasto (`requireSensitive('budget')`, chamado por quem muda o orçamento) |
| `ownership` | passar a posse de um workspace (`requireSensitive('ownership')`) |
| `infrastructure` | excluir um workspace (e o que vier a destruir infraestrutura) |
| `pairing` | gerar código de pareamento, configurar a porta web, revogar um aparelho |
| `passkey` | remover uma passkey |

Um canal que muda algo sensível chama `requireSensitive(tipo)` (`src/main/passkeyStepUp.ts`). Sem prova fresca, a chamada responde `passkey-required` (HTTP 403 com `code` e `kind`); a página pede a passkey ao aparelho e repete a chamada uma vez com o cabeçalho `X-Coxia-Assertion`.

### Registrar um aparelho

1. Na janela do app, **Configurações › Acesso pelo navegador**, no aparelho, **Permitir passkey**. A permissão vale 10 minutos e uma vez.
2. No aparelho, **Configurações › Passkey deste aparelho › Registrar este aparelho**.

O passo 1 existe para que o código de pareamento sozinho nunca faça um administrador. A passkey só funciona em página segura (`https`, ou `localhost`) e a origem tem de ser a **URL pública** configurada, quando há uma; o `rpId` é o nome do host dela. Remover o aparelho (revogar) apaga as passkeys dele.

### Onde fica

`passkeys.json` na pasta de dados, modo `0600`: só chaves **públicas**, o contador e o nome. Desafios e provas ficam em memória (desafio: 2 minutos, uma vez; prova: 60 segundos, uma vez, presa ao aparelho e ao tipo).

### O que a verificação confere

Feita no servidor com `node:crypto`, sem dependência: tipo, desafio, origem, `rpIdHash`, presença do usuário e **verificação do usuário** obrigatória, assinatura (ES256 e RS256) e contador crescente. A declaração de atestado não é verificada: a passkey prova "o mesmo autenticador do registro", não o modelo dele.

### Modelo de ameaça

Protege contra: um celular perdido ou emprestado com a sessão aberta, um código de pareamento visto por cima do ombro, e um script na rede local ou na web pública que tenha só o cookie da sessão. Não protege contra: um **servidor comprometido** (ele vê a prova e pode acionar o que o núcleo faz), uma pessoa com acesso ao shell da máquina (o soquete local é dela), nem um autenticador clonado sem contador.

### O que não foi verificado

Nenhum autenticador real nem celular real nos testes: o autenticador é um programa de teste que monta os bytes à mão (`test/helpers/fakeAuthenticator.ts`). A chamada do navegador (`navigator.credentials`) não tem teste automatizado.

---

## English

A paired browser (the phone, the instance's web) only gets admin rights if its **device registered a passkey** (WebAuthn, with fingerprint, face or PIN). Even then every sensitive change asks for the passkey **at that moment**: having the device, or the pairing code, is not enough.

### Who is an admin

- **A paired device without a passkey:** the rights it always had. It runs the cycle, but configuration, secrets, pairing and the rest of what belongs to the computer stay refused (`src/main/webPolicy.ts`).
- **A paired device with a passkey:** the admin channels open: saving the configuration, secrets, importing a configuration, confirming a test-environment secret, applying a cycle or agents, the prompt editor, pairing, the repositories' documentation, the agent assistant, writing procedures, the decisions about plugins, deleting a workspace and marking one as test. What acts on the machine itself stays **computer-only**: the app update, terminal and clipboard, login items, file retention, conflict commands, the setup wizard, the voice install, the Claude Code sessions, Remote Control, the state server and input to the agent's screen. Opening any of them to a passkey device is a later decision.
- **The desktop window and the local admin socket** (`admin.sock`) are never asked. The window is the person at the machine, and whoever opens the socket already is the user the core runs as, with the disk, the keychain and the app's keys; a passkey there would protect nothing and would lock out an existing install that never registered one. The persona's act is not asked either (the person confirms it before it runs).

### What asks for the passkey

Each ask carries a **kind**, and the proof is good for one kind, once, for 60 seconds:

| Kind | When |
|---|---|
| `secret` | storing, removing or accepting insecure storage of a secret; confirming or revoking a test-environment secret; a plugin's secret |
| `permission` | raising an agent's permission, reach or autonomy in `config:cycle-save`; `config:save`, importing a configuration, saving a prompt, applying a cycle or agents, plugin decisions, marking a workspace as test |
| `budget` | the spending limit (`requireSensitive('budget')`, called by whoever changes the budget) |
| `ownership` | handing a workspace to another owner (`requireSensitive('ownership')`) |
| `infrastructure` | deleting a workspace (and whatever destroys infrastructure later) |
| `pairing` | making a pairing code, configuring the web door, revoking a device |
| `passkey` | removing a passkey |

A channel that changes something sensitive calls `requireSensitive(kind)` (`src/main/passkeyStepUp.ts`). Without a fresh proof the call answers `passkey-required` (HTTP 403 with `code` and `kind`); the page asks the device for the passkey and repeats the call once with the `X-Coxia-Assertion` header.

### Registering a device

1. In the app window, **Settings › Browser access**, on the device, **Allow passkey**. The allowance lasts 10 minutes and one use.
2. On the device, **Settings › Passkey of this device › Register this device**.

Step 1 exists so that the pairing code alone never makes an admin. A passkey only works on a secure page (`https`, or `localhost`), and the origin must be the configured **public URL** when there is one; the `rpId` is its host name. Removing a device (revoking it) deletes its passkeys.

### Where it lives

`passkeys.json` in the data folder, mode `0600`: **public** keys only, the counter and the name. Challenges and proofs stay in memory (challenge: 2 minutes, once; proof: 60 seconds, once, bound to the device and the kind).

### What the verification checks

Done on the server with `node:crypto`, no dependency: type, challenge, origin, `rpIdHash`, user presence and a required **user verification**, the signature (ES256 and RS256) and a counter that moves forward. The attestation statement is not verified: the passkey proves "the same authenticator as at registration", not its model.

### Threat model

It protects against: a lost or borrowed phone with the session open, a pairing code seen over a shoulder, and a script on the local network or the public web that only has the session cookie. It does not protect against: a **compromised server** (it sees the proof and can drive whatever the core does), a person with a shell on the machine (the local socket is theirs), or a cloned authenticator that has no counter.

### What was not verified

No real authenticator or phone in the tests: the authenticator is a test program that builds the bytes by hand (`test/helpers/fakeAuthenticator.ts`). The browser call (`navigator.credentials`) has no automated test.
