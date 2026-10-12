# Etapas de um agente aparecem em claude.ai/code, só para leitura

## O que esta tentativa fez

A tentativa anterior deixou o código no worktree, mas não atualizou este documento. Esta tentativa (6) retomou o trabalho a partir desse código.

Antes da correção, `npx vitest run` com o conjunto completo deu 1 falha em 8948 testes. A falha estava em `test/runs-policy.test.ts`: a regra diz que só `door.ts` pergunta ao workspace se ele é de teste, e `runner/module.ts` passava `isTestWorkspace` à porta do Remote Control.

A correção: `createRemoteControlPort` (`src/main/remoteBridge.ts`) passou a ter `test` opcional, com `isTestWorkspace` como padrão, e `module.ts` não importa mais essa função.

## Decisões tomadas na implementação

A pessoa mandou desenvolver e levar as dúvidas ao team lead. O 2_PLAN.md não foi refeito, então estas decisões ficam para a revisão confirmar:

1. **Token**: é a credencial OAuth que o Claude Code já guarda no computador (`~/.claude/.credentials.json`). Ela é lida quando uma sessão abre e nunca é guardada nem registrada. Se faltar ou estiver vencida, a etapa roda sem ponte.
2. **Só o espelho**: os níveis são `off` e `mirror`, e `control` não existe no tipo nem na interface. A ponte é anexada com `outboundOnly: true`, e o que chegar por ela é descartado.
3. **Critério 3**: a página não mostra recusa por conta própria (ev-6). A primeira mensagem de toda sessão espelhada diz que ela é somente leitura, e a entrada nunca chega à sessão. Isso é um desvio do texto literal do critério.
4. **Falhas da ponte** (`untrusted_device`, `session_stale_relogin`, `oauth_rejected`, falta de credencial, SDK que não carrega): a etapa roda sem ponte, aparece uma linha na conversa com o motivo, e nenhuma linha vai para a auditoria.
5. **Fim da sessão**: `close()` quando a tentativa da etapa termina, seja qual for o fim. A sessão não é arquivada.
6. **Escopo**: só as etapas de uma execução. Chamadas, cerimônias e a persona não abrem a ponte.
7. **Precedência**: `resolveRemoteControl` aceita um nível da execução que só pode baixar o do agente. A interface ainda não oferece a escolha por execução.

## O que mudou

- **Política pura**: `src/shared/remoteControl.ts` (`resolveRemoteControl`, `remoteControlRank`). Ela recusa a persona, o navegador pareado e o workspace de teste.
- **Ponte**: `src/main/remoteBridge.ts` é o único ponto que fala com `@anthropic-ai/claude-agent-sdk/bridge`. A sequência é `createCodeSession` (com a tag `coxia`) → `fetchRemoteCredentials` → `attachBridgeSession` (só de saída) → mensagem de somente leitura. Só as mensagens `assistant`, `user` e `result` são repassadas. O módulo nunca lança erro. `createRemoteControlPort` decide, abre, faz a auditoria (deduplicada pelo id da sessão) e avisa na conversa.
- **Motor**: `EngineRequest.mirror` em `engine/contract.ts`, um campo próprio e não `extra`. `agents.ts` repassa cada mensagem do `query()` e encerra o turno no `result`.
- **Runner**: `executor.ts` abre a ponte antes da chamada e a fecha no `finally`. `service.ts` e `module.ts` ligam a porta.
- **Configuração**: `AgentDef.remoteControl` e `REMOTE_CONTROL_MODES` em `types.ts`, o enum em `schema.ts`, a migração v34→v35 (o campo ausente vale `off`, e nada é gravado) e `newAgent` em `team.ts`.
- **Fronteira**: em `configScope.ts`, `remoteControlRaised` faz parte de `refusedPaths`: o celular pareado e a persona podem desligar, nunca ligar. Em `webPolicy.ts`, `REMOTE_CONTROL_ADMIN` deixa `remoteControl:*` só no desktop. Em `cycles/apply.ts`, um modelo de ciclo nunca leva o campo.
- **Auditoria**: o tipo `remote-control` entra em `shared/auditoria.ts`, e `Auditoria.tsx` mostra a linha.
- **Interface**: `RemoteControlField` no editor de agente. Fica oculto no celular pareado e preso em `off` com o motivo num workspace de teste. O aviso aparece assim que "só leitura" é escolhido, antes de Salvar. Os textos estão nos catálogos `en` e `pt-BR` (ui-team, main, ui-today).
- **Documentação**: `CHANGELOG.md` (Unreleased) e `docs/configuration.md`.

## Testes

- `test/remote-control-policy.test.ts`: o padrão `off`, a precedência e `decidedBy`, a recusa em workspace de teste, no celular pareado e na persona, a subida de nível recusada pelo `configScope` e o modelo de ciclo sem o campo.
- `test/remote-control-bridge.test.ts`: a ponte só de saída com a tag e a mensagem de somente leitura em primeiro lugar, a entrada descartada, o filtro de mensagens, o módulo que nunca lança erro, nada aberto sem credencial, exatamente uma linha de auditoria por id e nenhuma em falha, e a leitura da credencial.
- `test/runner-remote-control.test.ts`: a etapa entrega o espelho ao motor, fecha-o e grava uma linha. Com o nível desligado, nada é carregado.
- `test/remote-control-ui.test.ts`: o campo desligado em workspace novo, o aviso antes de Salvar nos dois idiomas, o campo ausente no celular pareado, preso em workspace de teste, e o salvamento.
- `test/config-migrations.test.ts`: o passo v34→v35.

## Verificado nesta tentativa

- `npx vitest run` (conjunto completo, antes da correção): 545 arquivos passaram e 1 falhou (`runs-policy`), com 8943 testes passando e 1 falhando.
- Depois da correção:
  - `npx tsc --noEmit`: sem erro.
  - `npx vitest run` em runs-policy, nos quatro arquivos de remote-control e em config-migrations: 6 arquivos e 157 testes passaram.
  - `node scripts/theme-audit.mjs`: saída 0.
  - `npm run i18n:lint`: 0 problemas.
  - `node scripts/public-audit.mjs`: nada encontrado.

## Não verificado

- O conjunto completo de testes depois da correção (só os arquivos afetados rodaram de novo).
- `electron-vite build`.
- Os critérios 1 e 3 contra a conta real, com o app rodando: só a sondagem (ev-6, ev-7) os viu, fora do app.
- A sessão no app Claude do celular.
- A renovação da credencial do worker em etapas longas (46800 s).
- A interface no app em execução: só o teste de componente cobre.

## Fora desta entrega

- O modo control, porque a entrada remota ainda não tem um caminho pelas aprovações.
- A escolha por execução na interface: o critério 10 está coberto só pela função de resolução.
- A tela de sessões, a retomada no terminal e a bifurcação (critério 9), que dependem da issue de sessões.
- O arquivamento das sessões no fim.
