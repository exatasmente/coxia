# Remote Control pela API bridge: a sessão aparece e o espelho não entrega entrada

## Situação desta tentativa (3)

A revisão devolveu o trabalho ao planejamento com o veredito "mudanças". O 2_PLAN.md recebido ainda descreve a ponte como uma opção em `sdkOptions` (passo 3) e a auditoria sem o id de `createCodeSession` (passo 4). Implementar esse plano produziria código que não cumpre o critério 1. Por isso esta tentativa não mudou código, teste, configuração nem texto de interface, e não rodou nenhum portão. A etapa volta à tl-plataforma para refazer o plano.

## O que foi feito antes (tentativa 2)

A pessoa escolheu seguir pela API `./bridge` do SDK, que é alpha, com uma sondagem com login antes do código de produto. Só essa sondagem foi feita.

## Sondagem com login (ev-6, ev-7, ev-8)

- Ambiente: `@anthropic-ai/claude-agent-sdk` 0.3.287, export `./bridge`, base `https://api.anthropic.com`. O token é o OAuth que o Claude Code já guarda no computador (escopo `user:sessions:claude_code`). O script lê o token e nunca o imprime. Não foi passado token de dispositivo confiável.
- Sequência: `createCodeSession` (título e tag) → `fetchRemoteCredentials` → `attachBridgeSession` → duas mensagens com `write()`, `sendResult()` → processo vivo por alguns minutos → `close()`.
- Cada passo de criação foi confirmado pela pessoa antes de rodar.

### Modo `mirror` (`outboundOnly: true`)

- A sessão apareceu no topo de Recentes em claude.ai/code, com as duas mensagens e a marca "Conectado via Controle Remoto".
- Uma mensagem digitada na página e o botão Parar não chegaram ao processo: 0 entradas recebidas (ev-6).
- **A página não mostra recusa.** Ela aceita a mensagem, mostra "executando / Processando…" e só para quando alguém clica em Parar. Para o critério 3, o Coxia teria de avisar por conta própria, por exemplo com uma mensagem fixa de "somente leitura" ao abrir. Isso não foi testado.

### Modo `control` (`outboundOnly: false`)

- A sessão apareceu na lista.
- A mensagem digitada na página chegou ao processo por `onInboundMessage`, e o Parar chegou por `onInterrupt` (ev-7).
- A entrada remota passa pelo Coxia, que decide o que fazer com ela. Ela pode passar pelas aprovações do Coxia em vez de contorná-las. Isso não foi testado.

### Outros fatos vistos

- A sessão continua na lista da conta depois de `close()`, marcada "Sem atividade". As duas sessões de teste não foram arquivadas.
- Abrir pelo endereço `cse_…` às vezes não carrega a página. Pela lista, o endereço é `session_…` e carrega.
- O seletor de modelo da página mostra "Modelo não suportado" para uma sessão criada assim.

## O que o plano revisado precisa trazer

- **Passo 3:** a ponte é aberta por um módulo novo no processo principal (`createCodeSession` → `fetchRemoteCredentials` → `attachBridgeSession` → `write()` de cada mensagem do `query()` → `close`), isolado atrás de uma interface mínima e testado com um fake. `EngineRequest` pode levar o nível decidido, mas não é `sdkOptions` que age.
- **Passo 4:** a linha de auditoria e a deduplicação usam o id devolvido por `createCodeSession`.
- **Decisões a fixar:**
  1. de onde vem o token (credencial do Claude Code ou login próprio);
  2. como a recusa aparece no espelho, ou a reescrita do critério 3;
  3. se a entrada do modo `control` passa pelas aprovações do Coxia;
  4. o que acontece em `untrusted_device`, `session_stale_relogin` e `oauth_rejected` (proposta: a etapa roda sem ponte e registra o motivo);
  5. se as sessões são arquivadas no fim.
- Sugeridas pela revisão: filtrar ou não o que é repassado a claude.ai; o que fazer quando a credencial do worker expira (46800 s).
- Continuam valendo: os passos 1, 2, 5, 6 e 8.

## O que não foi verificado

- Se a sessão aparece no app Claude do celular.
- A duração real da credencial do worker e a renovação com `reconnectTransport`.
- Se outras contas vão exigir o token de dispositivo confiável.
- Como a auditoria da #268 registra um evento que não é escrita no host de código.
- Portões do repositório (`tsc`, `vitest`, `theme-audit`, `i18n:lint`, `public-audit`): não rodados, porque o código não mudou.
