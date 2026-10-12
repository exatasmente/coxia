# Memória do ciclo

## Decisões

- Resposta: C <!-- answer:68 -->
- Resposta: 1 <!-- answer:85 -->: seguir pela API `./bridge` (alpha) do SDK, com sondagem com login antes do código.
- Revisão (rodadas 1 e 2): veredito "mudanças", porque não havia código.
- Resposta: volta e pede para ele desenvolver, qualquer duvida ele chama o team lead ou a persona ou o PO <!-- answer:144 -->
- Implementação (tentativas 5 e 6), decisões que a revisão deve confirmar, porque o plano não foi refeito:
  - o token é a credencial OAuth do Claude Code no computador (lida ao abrir a sessão, nunca guardada);
  - só os níveis `off` e `mirror`, sem `control`;
  - o espelho abre com uma mensagem fixa de somente leitura (desvio do texto literal do critério 3);
  - numa falha da ponte, a etapa roda sem ela, com uma linha na conversa e sem linha de auditoria;
  - close() no fim da tentativa, sem arquivar;
  - só as etapas de uma execução abrem a ponte;
  - a execução só baixa o nível do agente (na função; a interface por execução não existe).

## Restrições

- Regra 12 da spec: não ofertar como se funcionasse.
- Persona, celular pareado, workspace `test: true` e modelos de ciclo nunca ligam o Remote Control.
- Uma linha de auditoria por id de `createCodeSession`.
- `test/runs-policy.test.ts`: nenhum arquivo de `src/main/runner/` além de `door.ts` pode citar `isTestWorkspace`. Por isso a consulta mora em `remoteBridge.ts`.
- A API `./bridge` é alpha: só `src/main/remoteBridge.ts` a importa, e os testes usam fake.

## Tentado e descartado

- `remoteControlAtStartup` + `--remote-control` no `query()`: nenhuma ponte abre (ev-1, ev-4).

## Perguntas abertas

- O modo `control` (a entrada remota pelas aprovações) fica para uma issue própria.
- A escolha por execução na interface (critério 10).
- A tela de sessões (critério 9) depende da issue de sessões.
- A renovação da credencial do worker (46800 s) e o arquivamento das sessões.

## Onde o trabalho está

- O código está no worktree:
  - `src/shared/remoteControl.ts` (política), `src/main/remoteBridge.ts` (ponte, porta e auditoria);
  - `EngineRequest.mirror`, executor, migração v35, `configScope.remoteControlRaised`, `webPolicy` `remoteControl:*`;
  - editor de agente com aviso, catálogos, CHANGELOG e `docs/configuration.md`;
  - testes `test/remote-control-*.test.ts` e `test/runner-remote-control.test.ts`.
- Tentativa 6:
  - corrigiu a falha do runs-policy;
  - tsc passou, os 6 arquivos afetados passaram (157 testes), e theme-audit, i18n:lint e public-audit também passaram;
  - o conjunto completo antes da correção tinha só essa falha e não rodou de novo depois dela;
  - `electron-vite build` não rodou.
- Os critérios 1 e 3 com a conta real seguem não verificados no app (QA manual).
- Duas sessões de teste da sondagem continuam na conta da pessoa.
- Próximo passo: a revisão.
- Passagem support → product-owner: Especificação: verificar no SDK se uma sessão iniciada pelo Agent SDK abre a ponte (remoteControlAtStartup/autoUploadSessions não verificados), definir nível por agente vs por run, espelho só de leitura, e a dependência da issue de sessões (sem ciclo). Pontos de entrada: src/main/agents.ts sdkOptions, src/main/webPolicy.ts DESKTOP_ONLY/PERSONA_UNLISTED, auditoria da #268. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: primeiro verificar no SDK se uma sessão não interativa abre a ponte e se há espelho só de leitura; definir a precedência agente x execução; apoiar-se em sdkOptions (agents.ts), DESKTOP_ONLY/PERSONA_UNLISTED (webPolicy.ts), recusa em test:true e o mecanismo de auditoria da #268. Registrar a dependência da issue de sessões. <!-- handoff:20 -->
- Passagem tl-plataforma → pessoa: Implementação: executar primeiro a etapa 0 (sondagem do SDK: ponte em sessão não interativa e espelho só de leitura) e registrar o resultado; se a ponte não abrir, parar e devolver ao product owner o comportamento alternativo (regra 12). Só então seguir 1 a 6 e 8 de 2_PLAN.md. Verificar como a auditoria das ações autônomas (#268) pode registrar um evento que não é escrita no host de código. A tela de sessões (item 7) fica fora até a issue de sessões existir. <!-- handoff:33 -->
- Passagem developer → revisor-plataforma: Planejamento (tl-plataforma): revisar 2_PLAN.md com o resultado da sondagem (3_IMPLEMENTATION.md, ev-6/ev-7). O passo 3 muda: a ponte é aberta pelo processo principal do Coxia pela API `./bridge` (createCodeSession → fetchRemoteCredentials → attachBridgeSession com outboundOnly para mirror → write() de cada mensagem do query() → close), não por sdkOptions. A auditoria usa o id devolvido por createCodeSession. Faltam decidir: (1) a origem do token (ler a credencial que o Claude Code já guarda, ou login próprio); (2) a recusa visível no espelho, porque a página aceita a mensagem e fica em "execu… <!-- handoff:117 -->
- Passagem revisor-plataforma → developer: Não há código de produto para aprovar: a branch só tem documentos do ciclo, e a implementação fez apenas a sondagem da API de ponte. O resultado dela invalida o passo 3 do plano e deixa cinco decisões abertas. Veredito: mudanças, devolvendo ao planejamento. [bloqueia] docs/cycles/[redacted]/2_PLAN.md: O passo 3 (opção do SDK em sdkOptions) e o passo 4 (auditoria) estão invalidados pela sondagem: passar opção ao query() não abre a ponte; a ponte é aberta pelo processo principal via API ./bridge, e o id da auditoria vem de createCodeSession. Cinco decisões de segurança (origem do token, recusa n… <!-- handoff:127 -->
- Passagem developer → revisor-plataforma: Planejamento (tl-plataforma): refazer 2_PLAN.md antes de qualquer código. O passo 3 passa a ser um módulo do processo principal, isolado e com fake: createCodeSession → fetchRemoteCredentials → attachBridgeSession (outboundOnly no mirror) → write() de cada mensagem do query() → close. Ele não usa sdkOptions. A auditoria (passo 4) usa o id de createCodeSession. Faltam fixar: (1) a origem do token; (2) a recusa visível no espelho ou a reescrita do critério 3; (3) se a entrada do modo control passa pelas aprovações; (4) o comportamento em untrusted_device, session_stale_relogin e oauth_rejected; … <!-- handoff:136 -->
- Passagem pessoa → developer: volta e pede para ele desenvolver, qualquer duvida ele chama o team lead ou a persona ou o PO <!-- handoff:145 -->
