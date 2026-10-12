# Plano: sessões do Claude Code da máquina no Coxia

Base: 1_SPEC.md (16 regras, 12 critérios). Tudo abaixo vem de leitura do código; nada foi executado. O que depende do SDK instalado está marcado **não verificado** e é fechado no passo 0.

## O que existe hoje (lido)

- `src/main/webPolicy.ts`: `webAccess(channel)` nega por padrões de prefixo (`SCREEN_INPUT = /^screen:/`, `MCP_STATE_ADMIN = /^mcpstate:/`); a lista de padrões está na linha ~120.
- `src/main/persona/doorTable.ts`: `EXCLUDED` (linha ~280) agrupa canais por motivo; o motivo `machine` (lê ou muda o computador) serve ao recurso.
- `src/main/turnAsks-core.ts` e `turnAsks.ts`: fila em memória de pedidos pendentes, uma resposta por id, auditoria por `recordWrite({ kind: 'turn-limit' })`, `viaOf()` diz a porta (window, paired, persona). É o modelo dos pedidos de permissão.
- `src/main/module.ts`: `ModuleContext.emit` é o `emit` de `src/main/index.ts` (linha ~66), que envia à janela **e** chama `broadcast` (celular pareado). Não existe emissor só da janela: precisa ser criado.
- `src/main/claudeSdk.ts`: `loadClaudeSdkModule()` é o ponto único de carga do SDK.
- `src/shared/auditoria.ts` (linha 4): união `AuditKind`. Configuração: `CONFIG_SCHEMA_VERSION = 34`; opt-in de exemplo: `mcpState` (types, defaults, schema, migração v24/v32).
- `src/shared/activity.ts`: visão de atividade (`ActivityEntry`, `ACTIVITY_EVENT`) usada pelas execuções.
- Não existe uso de `listSessions`, `forkSession` ou `canUseTool` do SDK no repositório (busca feita); o `listSessions` de `src/main/engine/open/session.ts` é de outro motor.

## Decisões

1. **Chave**: `claudeSessions: { enabled: boolean }`, padrão `false`. Migração v35 (`CONFIG_SCHEMA_VERSION` 35) em `STEPS` de `migrations.ts`, e os três: `types.ts`, `defaults.ts`, `schema.ts`. Motivo: regra do squad; segue o modelo do `mcpState`.
2. **Prefixo negado**: `CLAUDE_SESSIONS = /^claudeSessions:/` em `webPolicy.ts`, na lista de `deny`, para todo canal presente e futuro, com ou sem a chave de efeitos externos. Eventos têm nome com o mesmo prefixo.
3. **Persona**: todos os canais entram em `EXCLUDED` com motivo `machine`; o teste que cruza canais registrados com `OPS`/`EXCLUDED` já existente falha se faltar algum.
4. **Eventos só da janela**: novo `emitWindow(ev)` em `ModuleContext` (implementado em `index.ts` só com `win.webContents.send`, sem `broadcast`). O módulo usa só ele. Motivo: `emit` atual vazaria ao celular.
5. **Auditoria**: novo tipo `claude-session` em `AuditKind`; um `recordWrite` por mensagem, resposta de permissão, parada e início, `target: claude:<sessionId>`, `fields: { action: 'message'|'permission'|'stop'|'start', ... }`. Texto da mensagem não vai na linha (só tamanho); catálogo `auditModel.ts`/`Auditoria.tsx` ganha o rótulo (en e pt-BR).
6. **Permissões**: nova fila `claudeSessions/asks-core.ts` (cópia enxuta de `turnAsks-core`, com `ask(input, signal)`, `answer(id, allow|deny, through)`), ligada ao gancho `canUseTool` do SDK. O canal de resposta recusa quando `viaOf() !== 'window'` (defesa extra além do prefixo negado e do `EXCLUDED`). A sessão espera sem prazo; abortar a vez resolve como negado.
7. **Redação**: todo texto de transcrição e de atividade passa pela função de ocultação que o app já usa em `src/shared` (a localizar no passo 0; candidatas em `shared/activity.ts` e `shared/runs/comment.ts`) antes de sair do processo principal.
8. **Fontes de sessões** (porta `MachineSessions` com implementação real e falsa):
   - transcrições: `listSessions` do SDK (não verificado) e leitura das mensagens por `getSessionMessages` (não verificado);
   - em execução e em segundo plano: depende do passo 0. Regra firme: nenhum arquivo `.credentials.json`, `*.key` ou `control.key` é aberto; qualquer leitura de disco passa por `guardedRead(path)` que recusa esses nomes e só devolve campos da lista permitida (id da sessão, pasta, estado). Se nenhuma fonte limpa existir, "em execução" mostra só as sessões que o próprio Coxia iniciou e as alteradas há pouco, e "em segundo plano" fica vazio com aviso; isso é dito na tela e levado ao product owner como lacuna do critério 2.
9. **Ciclo de vida com #282**: o registro `owned` (sessões iniciadas pelo Coxia: id, processo, `AbortController`) fica em `src/main/claudeSessions/owned.ts`; #282 só acrescenta a opção de Remote Control ao iniciar e consome esse registro. Este ciclo não implementa Remote Control.
10. **Bifurcação**: se a fonte indica que outro processo mantém a sessão aberta, o envio usa `resume` com bifurcação e a tela mostra "cópia"; caso contrário, `resume` simples. Detecção real não verificada (passo 0).
11. **Workspace `test: true`**: `send` e `start` retornam `{ ok:false, reason:'test-workspace' }` antes de tocar o SDK; `list`/`read` seguem. Motivo: regra 14.
12. **Acompanhar ao vivo (critério 3)**: relê as mensagens da sessão aberta por intervalo curto (2 s) enquanto a tela está aberta e emite só o que mudou; transmissão da resposta de mensagem enviada pelo Coxia vem direto do fluxo do `query`.

## Mudanças, em ordem

0. **Sondagem (bloqueia o resto)**: instalar dependências no ambiente de desenvolvimento e confirmar nos tipos do SDK instalado: `listSessions`, leitura de mensagens, `resume`, `forkSession`, `canUseTool`, `interrupt`; e como obter sessões em execução/em segundo plano sem abrir chaves. Resultado vira nota de memória. Se algo faltar, ajustar as decisões 8 e 10 e avisar o product owner.
1. **Configuração**: `types.ts` (`ClaudeSessionsConfig`), `defaults.ts`, `schema.ts` (descrição), `migrations.ts` (step v35 + comentário de versão). Teste: `test/config-migrations.test.ts` (migra v34 para v35 com `enabled:false`; documento v35 válido; v36 recusado como já é hoje).
2. **Fronteira**: `webPolicy.ts` (padrão novo), `doorTable.ts` (canais em `EXCLUDED`). Testes: `test/webPolicy.test.ts` (todo canal `claudeSessions:*`, inclusive um inventado, nega com a chave de efeitos ligada e desligada), teste da tabela da porta (cada canal do módulo está em `EXCLUDED`).
3. **Emissor da janela**: `module.ts`, `index.ts`. Teste: módulo com contexto falso mostra que o evento chega só em `emitWindow` e nunca em `emit`.
4. **Núcleo** em `src/main/claudeSessions/`: `source.ts` (porta, `guardedRead`), `asks-core.ts`, `owned.ts`, `service.ts` (`list`, `read`, `send`, `answer`, `stop`, `start`, guarda de `test:true`, auditoria, redação), `module.ts` (registra canais só quando `enabled`; desligado não registra nada e a tela não aparece). Registro em `src/main/index.ts`.
5. **Auditoria**: `shared/auditoria.ts`, `renderer/src/auditModel.ts`, rótulos. Teste: `test/auditoria.test.ts` (linha por mensagem, permissão e parada, cita a sessão, sem o texto).
6. **Tela** (Plataforma entrega os canais; Experiência a tela): `renderer/src/screens/ClaudeSessions.tsx` (três grupos, abrir sessão na visão de atividade existente, campo de mensagem, itens pendentes com permitir/negar, parar, encerrar só se `owned`, iniciar em pasta do workspace, avisos de CLI ausente/sem login e de cópia); entrada de navegação e opção em Configurações só com o recurso ligado; `t()` com catálogos en e pt-BR; só tokens de tema.
7. **Documentação**: `CHANGELOG.md` (Unreleased), `docs/` do recurso e da fronteira (negado ao celular, fora da persona, nunca abre chaves). `AGENTS.md` não muda.

## Testes (um por comportamento; todos com fakes, nada de `~/.claude`)

| Comportamento | Arquivo |
|---|---|
| Desligado: nenhum canal registrado | `test/claude-sessions-module.test.ts` |
| Lista transcrições, em execução e em segundo plano (fonte falsa) | idem |
| `guardedRead` recusa `.credentials.json`, `*.key`, `control.key` e devolve só campos permitidos | `test/claude-sessions-source.test.ts` |
| Texto com segredo sai oculto | `test/claude-sessions-service.test.ts` |
| Enviar chama resume; sessão presa por outro processo usa bifurcação | idem |
| Pedido de permissão vira pendente; negar segue sem a ferramenta; permitir roda; abort nega | `test/claude-sessions-asks.test.ts` |
| Resposta por persona ou paired recusada | idem |
| Parar interrompe; encerrar só em `owned` | `test/claude-sessions-service.test.ts` |
| `test:true` recusa enviar e iniciar, permite listar | idem |
| Auditoria: uma linha por ação, sessão citada | `test/auditoria.test.ts` |
| Celular nega todo canal e não recebe evento | `test/webPolicy.test.ts`, módulo |
| Persona: canais em `EXCLUDED` | teste da tabela da porta |
| Migração e esquema | `test/config-migrations.test.ts` |
| Tela: lista, pendente, avisos | teste de visão em `test/` do renderer (modelo puro, como `turnAskView`) |

Portões antes de entregar: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`. Nenhum foi rodado nesta etapa.

## Riscos

- **API do SDK diferente da suposta**: passo 0 antes de codar; porta com fake isola o resto.
- **Vazamento ao celular**: `emit` atual faz broadcast; mitigado por `emitWindow` e teste que o prova; prefixo negado cobre canais futuros.
- **Abrir chave proibida**: `guardedRead` único ponto de disco, com teste; busca estática no teste garante que o módulo não importa `fs` fora dele.
- **Segredo em transcrição**: redação na borda do processo principal, com teste.
- **Permissão respondida por quem não deve**: três camadas (prefixo negado, `EXCLUDED`, checagem de `viaOf`).
- **Colisão com #282**: registro `owned` compartilhado, sem Remote Control aqui.
- **Repositório público**: fixtures sintéticas, sem nomes ou pastas reais.

## Critérios que o plano não cobre por inteiro

- Critério 2 (sessões em execução e em segundo plano reais) e critério 5 (cópia quando outro processo segura a sessão) dependem do passo 0; sem fonte limpa, o recurso entrega uma versão reduzida e a lacuna volta ao product owner.
- Critérios 3, 4 e 6 contra o Claude Code real são verificação manual na etapa de QA; os testes automáticos usam fakes.
