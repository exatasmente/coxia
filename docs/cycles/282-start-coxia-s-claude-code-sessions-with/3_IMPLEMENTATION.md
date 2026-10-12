# Remote Control pela API bridge: a sessão aparece e o espelho não entrega entrada

## O que foi feito

A pessoa escolheu seguir pela API `./bridge` do SDK, que é alpha, com uma sondagem com login antes do código de produto. Esta tentativa fez só essa sondagem. Nenhum código de produto, teste, configuração, migração ou texto de interface mudou.

## Sondagem com login (ev-6, ev-7, ev-8)

- Ambiente: `@anthropic-ai/claude-agent-sdk` 0.3.287, export `./bridge`, base `https://api.anthropic.com`. O token é o OAuth que o Claude Code já guarda no computador (escopo `user:sessions:claude_code`). O script lê o token e nunca o imprime. Não foi passado token de dispositivo confiável.
- Sequência: `createCodeSession` (título e tag) → `fetchRemoteCredentials` → `attachBridgeSession` → duas mensagens com `write()`, `sendResult()` → processo vivo por alguns minutos → `close()`.
- Cada passo de criação foi confirmado pela pessoa antes de rodar.

### Modo `mirror` (`outboundOnly: true`)

- A sessão "Coxia probe (mirror)" apareceu no topo de Recentes em claude.ai/code, com as duas mensagens e a marca "Conectado via Controle Remoto".
- Uma mensagem digitada na página e o botão Parar não chegaram ao processo: 0 entradas recebidas (ev-6).
- **A página não mostra recusa.** Ela aceita a mensagem, mostra "executando / Processando…" e só para quando alguém clica em Parar. Para o critério 3 ("a entrada é recusada"), o Coxia teria de avisar por conta própria. Uma opção é escrever na sessão uma mensagem fixa de "somente leitura" ao abrir. Isso não foi testado.

### Modo `control` (`outboundOnly: false`)

- A sessão "Coxia probe (control)" apareceu na lista.
- A mensagem digitada na página chegou ao processo por `onInboundMessage`, e o Parar chegou por `onInterrupt` (ev-7).
- Então a entrada remota passa pelo Coxia, que decide o que fazer com ela. O controle pode passar pelas aprovações do Coxia em vez de contorná-las. Isso não foi testado.

### Outros fatos vistos

- A sessão continua na lista da conta depois de `close()`, marcada "Sem atividade". As duas sessões de teste não foram arquivadas e continuam na conta da pessoa.
- Abrir a sessão pelo endereço `cse_…` às vezes não carrega a página. Pela lista, o endereço é `session_…` e carrega.
- O seletor de modelo da página mostra "Modelo não suportado" para uma sessão criada assim.

## Consequência para o plano (2_PLAN.md)

O plano está errado no passo 3 e incompleto no passo 4. Por isso a etapa volta ao planejamento em vez de improvisar.

- **Passo 3 (ligação ao motor):** passar uma opção ao `query()` não abre a ponte (sondagens anteriores, ev-1 e ev-4). O caminho é o próprio processo do Coxia:
  - criar a sessão com `createCodeSession`;
  - emitir a credencial do worker;
  - ligar com `attachBridgeSession`;
  - repassar cada mensagem do `query()` com `write()`;
  - fechar a sessão no fim da etapa.
  `EngineRequest` pode continuar levando o nível decidido, mas quem age é um módulo novo no processo principal, não `sdkOptions`.
- **Passo 4 (auditoria):** o id da sessão para a linha e para a deduplicação é o que `createCodeSession` devolve.
- **Decisões novas para o plano:**
  1. De onde vem o token: ler a credencial que o Claude Code já guarda, ou ter um login próprio no Coxia.
  2. Como mostrar a recusa no espelho.
  3. Se, no modo `control`, a entrada remota passa pelas aprovações do Coxia.
  4. O que fazer com `untrusted_device`, `session_stale_relogin` e `oauth_rejected`: a etapa roda sem ponte e registra o motivo.
  5. Arquivar ou não as sessões no fim.
- Continuam valendo: política pura (1), configuração e migração (2), fronteira em `webPolicy` (5), interface com aviso (6) e documentação (8).

## O que não foi verificado

- Se a sessão aparece no app Claude do celular.
- Quanto a credencial do worker dura numa etapa longa (`expires_in` informado: 46800 s), e a renovação com `reconnectTransport`.
- Se outras contas, ou o servidor no futuro, vão exigir o token de dispositivo confiável.
- Como a auditoria da #268 registra um evento que não é escrita no host de código.
- Portões do repositório (`tsc`, `vitest`, `theme-audit`, `i18n:lint`, `public-audit`): não rodados, porque o código não mudou.
