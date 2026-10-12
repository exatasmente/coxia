# Memória do ciclo

## Decisões

- Resposta: C <!-- answer:68 -->
- Resposta: 1 <!-- answer:85 -->: seguir pela API `./bridge` (alpha) do SDK, com sondagem com login antes do código.
- Revisão rodadas 1 e 2: "mudanças" (não havia código). Rodada 3: **aprovado** com ressalvas.
- Resposta da pessoa: volta e pede para ele desenvolver; dúvidas ao team lead, persona ou PO <!-- answer:144 -->
- Decisões da implementação, confirmadas pela revisão:
  - token = [redacted] OAuth do Claude Code, lida ao abrir e nunca guardada;
  - só `off` e `mirror`, sem `control`;
  - o espelho abre com mensagem fixa de somente leitura (desvio aceito do critério 3);
  - falha da ponte: a etapa roda sem ela, linha na conversa, sem auditoria;
  - close() no fim da tentativa, sem arquivar;
  - só etapas de uma execução abrem a ponte;
  - a execução só baixa o nível (função; sem interface).

## Restrições

- Regra 12 da spec: não ofertar como se funcionasse.
- Persona, celular pareado, workspace `test: true` e modelos de ciclo nunca ligam o Remote Control.
- Uma linha de auditoria por id de `createCodeSession`.
- `test/runs-policy.test.ts`: só `door.ts` cita `isTestWorkspace` em `src/main/runner/`; a consulta mora em `remoteBridge.ts`.
- API `./bridge` alpha: só `src/main/remoteBridge.ts` a importa; testes usam fake.

## Tentado e descartado

- `remoteControlAtStartup` + `--remote-control` no `query()`: nenhuma ponte abre.

## Perguntas abertas

- Modo `control` (entrada remota pelas aprovações): issue própria.
- Escolha por execução na interface (critério 10; `run` nunca é preenchido).
- Tela de sessões (critério 9) depende da issue de sessões.
- Renovação da credencial do worker (46800 s) e arquivamento.
- Sugestões da revisão: não abrir/auditar a ponte quando o motor não é o do Claude; o aviso do editor deve dizer que o conteúdo da etapa é enviado a claude.ai.
- Critérios 1 e 3 com a conta real: nunca verificados.

## Onde o trabalho está

- Código no worktree: `src/shared/remoteControl.ts`, `src/main/remoteBridge.ts`, `EngineRequest.mirror`, executor, migração v35, `configScope.remoteControlRaised`, `webPolicy`, editor de agente, catálogos, CHANGELOG, `docs/configuration.md`, testes `test/remote-control-*.test.ts` e `test/runner-remote-control.test.ts`.
- QA (rodou agora): tsc, vitest completo (8944 passaram, 4 pulados), theme-audit, i18n:lint, public-audit e electron-vite build, todos saída 0 (ev-10). Plano em 5_TEST_PLAN.md.
- Não verificados: critérios 1 e 3 com a conta real, interface no app em execução, celular.
- Duas sessões de teste da sondagem continuam na conta da pessoa.
- Próximo passo: integração.
- Passagem support → product-owner: Especificação: verificar no SDK se uma sessão iniciada pelo Agent SDK abre a ponte (remoteControlAtStartup/autoUploadSessions não verificados), definir nível por agente vs por run, espelho só de leitura, e a dependência da issue de sessões (sem ciclo). Pontos de entrada: src/main/agents.ts sdkOptions, src/main/webPolicy.ts DESKTOP_ONLY/PERSONA_UNLISTED, auditoria da #268. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: primeiro verificar no SDK se uma sessão não interativa abre a ponte e se há espelho só de leitura; definir a precedência agente x execução; apoiar-se em sdkOptions (agents.ts), DESKTOP_ONLY/PERSONA_UNLISTED (webPolicy.ts), recusa em test:true e o mecanismo de auditoria da #268. Registrar a dependência da issue de sessões. <!-- handoff:20 -->
- Passagem tl-plataforma → pessoa: Implementação: executar primeiro a etapa 0 (sondagem do SDK: ponte em sessão não interativa e espelho só de leitura) e registrar o resultado; se a ponte não abrir, parar e devolver ao product owner o comportamento alternativo (regra 12). Só então seguir 1 a 6 e 8 de 2_PLAN.md. Verificar como a auditoria das ações autônomas (#268) pode registrar um evento que não é escrita no host de código. A tela de sessões (item 7) fica fora até a issue de sessões existir. <!-- handoff:33 -->
- Passagem developer → revisor-plataforma: Planejamento (tl-plataforma): revisar 2_PLAN.md com o resultado da sondagem (3_IMPLEMENTATION.md, ev-6/ev-7). O passo 3 muda: a ponte é aberta pelo processo principal do Coxia pela API `./bridge` (createCodeSession → fetchRemoteCredentials → attachBridgeSession com outboundOnly para mirror → write() de cada mensagem do query() → close), não por sdkOptions. A auditoria usa o id devolvido por createCodeSession. Faltam decidir: (1) a origem do token (ler a credencial que o Claude Code já guarda, ou login próprio); (2) a recusa visível no espelho, porque a página aceita a mensagem e fica em "execu… <!-- handoff:117 -->
- Passagem revisor-plataforma → developer: Não há código de produto para aprovar: a branch só tem documentos do ciclo, e a implementação fez apenas a sondagem da API de ponte. O resultado dela invalida o passo 3 do plano e deixa cinco decisões abertas. Veredito: mudanças, devolvendo ao planejamento. [bloqueia] docs/cycles/[redacted]/2_PLAN.md: O passo 3 (opção do SDK em sdkOptions) e o passo 4 (auditoria) estão invalidados pela sondagem: passar opção ao query() não abre a ponte; a ponte é aberta pelo processo principal via API ./bridge, e o id da auditoria vem de createCodeSession. Cinco decisões de segurança (origem do token, recusa n… <!-- handoff:127 -->
- Passagem developer → revisor-plataforma: Planejamento (tl-plataforma): refazer 2_PLAN.md antes de qualquer código. O passo 3 passa a ser um módulo do processo principal, isolado e com fake: createCodeSession → fetchRemoteCredentials → attachBridgeSession (outboundOnly no mirror) → write() de cada mensagem do query() → close. Ele não usa sdkOptions. A auditoria (passo 4) usa o id de createCodeSession. Faltam fixar: (1) a origem do token; (2) a recusa visível no espelho ou a reescrita do critério 3; (3) se a entrada do modo control passa pelas aprovações; (4) o comportamento em untrusted_device, session_stale_relogin e oauth_rejected; … <!-- handoff:136 -->
- Passagem pessoa → developer: volta e pede para ele desenvolver, qualquer duvida ele chama o team lead ou a persona ou o PO <!-- handoff:145 -->
- Passagem developer → revisor-plataforma: Revisão (revisor-plataforma): revisar o código de Remote Control (só leitura) contra a spec, conferindo as decisões tomadas sem plano refeito. São elas: o token é a credencial do Claude Code; o espelho abre com uma mensagem fixa de somente leitura no lugar de uma recusa visível; `control` fica fora; uma falha da ponte faz a etapa rodar sem ela, com uma linha na conversa; a sessão é fechada com close() e não é arquivada; só as etapas de uma execução abrem a ponte. Não foram verificados nesta tentativa: o conjunto completo de testes depois da correção do runs-policy, `electron-vite build` e os c… <!-- handoff:208 -->
- Passagem revisor-plataforma → qa-plataforma-2: Revisão aprovada. QA: rodar o conjunto completo (vitest, tsc, theme-audit, i18n:lint, public-audit) e `electron-vite build`, que não foram verificados aqui; testar manualmente os critérios 1 e 3 com a conta real. Pendentes sem bloqueio: escolha por execução (critério 10), tela de sessões (critério 9), mirror aberto em motor que não é o do Claude. <!-- handoff:214 -->
