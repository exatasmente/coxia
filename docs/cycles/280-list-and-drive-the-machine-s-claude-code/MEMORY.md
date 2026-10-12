# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível como escrito. Sugestão priority:medium; squad plataforma.
- Refino: 1_SPEC.md (16 regras, 12 critérios). Prioridade proposta priority:medium; sem marco.
- Plano (2_PLAN.md): chave `claudeSessions.enabled` (v35), prefixo negado `claudeSessions:`, EXCLUDED `machine`, auditoria `claude-session`, `emitWindow`, fila de permissões própria, `test:true` recusa send/start antes do SDK, registro `owned` compartilhado com #282.
- Passo 0: sessões em execução e em segundo plano vêm de `~/.claude/sessions/<pid>.json` (só pid, sessionId, cwd, kind, status, updatedAt; vivo = process.kill(pid,0)). Nota m-7d7da8eb.
- Implementação (tentativa 2): passos 1 a 7 feitos. Desvio: os 12 canais ficam sempre registrados; desligado, todos menos `enabled` e `set-enabled` recusam (não exige reinício). Todo handler recusa porta que não seja a janela. Sessões conduzidas usam `query` em entrada contínua (vivo entre mensagens). A redação reusa `redact` de errorlog-core. Nota m-dfa8dee2.

## Restrições

- Opt-in, desligado por padrão, só desktop; nunca abrir credenciais nem chaves. `guardedRead` (src/main/claudeSessions/source.ts) é o único ponto de disco: só aceita `sessions/<dígitos>.json` como arquivo regular e não segue link. Negado ao celular; persona em EXCLUDED; eventos só por `emitWindow`; nada de ~/.claude em testes.
- Config nova exige step em STEPS + types.ts, defaults.ts, schema.ts e docs/configuration.md (o teste docs-schema-version confere a versão).
- Catálogos `ui-*.json` precisam ficar com as chaves ordenadas; chave de UI precisa aparecer literal no código do renderer.
- Repositório público: fixtures sintéticas.

## Tentado e descartado

- Fonte reduzida da decisão 8: descartada, porque a fonte limpa existe.
- Registrar canais só quando ligado: descartado, porque exigiria reiniciar o app.

## Perguntas abertas

- Pedido de permissão só existe para sessão conduzida pelo app; sessão num terminal pergunta no terminal (dito na documentação).
- Sem auditoria quando o envio ou o início falha após entregar o texto ao SDK, ou quando `interrupt` lança erro.

## Onde o trabalho está

- Código, testes e documentação na branch. Portões desta tentativa: tsc, theme-audit, i18n:lint e public-audit passaram. Vitest completo: passou inteiro (562 arquivos) antes das últimas correções; na rodada final, 2 testes estouraram o limite de 5 s com a máquina carregada e passaram sozinhos (ev-1).
- Não verificado: nada contra o Claude Code real; a tela não foi aberta num app em execução; o build electron-vite não rodou.
- Próximo: revisão e depois QA manual dos critérios 2 a 6 e 8.
- Relacionadas: #262 (entrega 3 lá), #274 (entregue), #282 (Remote Control; consome `owned.ts`), #281.
- Passagem support → product-owner: Refino: confirmar a fonte das sessões em execução/em segundo plano sem tocar nas chaves, checar a API do SDK instalado, achar onde entra o prefixo negado em webPolicy.ts e alinhar com #262 e #282. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano: resolver a fonte de sessões em execução/segundo plano sem abrir chaves e verificar a API do SDK instalado (instalar dependências); o prefixo negado entra como novo padrão em webPolicy.ts (lista de padrões na linha ~120, ex.: /^claudeSessions:/); incluir o recurso em EXCLUDED de doorTable.ts; combinar com #282 o ciclo de vida das sessões iniciadas pelo Coxia. <!-- handoff:21 -->
- Passagem tl-plataforma → pessoa: Implementação: começar pelo passo 0 do plano (instalar dependências e confirmar no SDK instalado listSessions, leitura de mensagens, resume/forkSession, canUseTool, interrupt e a fonte de sessões em execução/segundo plano sem abrir chaves); só então seguir a ordem 1 a 7. Se a fonte limpa não existir, aplicar a versão reduzida da decisão 8 e avisar o product owner. <!-- handoff:36 -->
- Passagem developer → revisor-plataforma: Implementação, nova tentativa: o passo 0 está feito (ver a nota m-7d7da8eb e 3_IMPLEMENTATION.md). A decisão 8 vale inteira, com a fonte `~/.claude/sessions/<pid>.json` e só os campos permitidos. Falta implementar os passos 1 a 7 de 2_PLAN.md, com testes, e rodar os portões (`npx tsc --noEmit`, `npx vitest run`, theme-audit, i18n:lint, public-audit). Nenhum código foi alterado ainda. <!-- handoff:56 -->
- Passagem revisor-plataforma → developer: Revisão devolvida: a branch não tem nenhuma alteração de código fora da pasta do ciclo. Os passos 1 a 7 do plano (configuração, fronteira, emissor só da janela, núcleo, auditoria, tela, documentação) e os testes não existem, então nenhum dos 12 critérios de aceite é atendido. Nenhum portão foi rodado nesta etapa. [bloqueia] docs/cycles/[redacted]/3_IMPLEMENTATION.md: A branch não contém nenhuma alteração de código: só o passo 0 (sondagem) foi feito. Os passos 1 a 7 do plano e os testes correspondentes não existem, então os critérios de aceite da especificação (tela, canais, permissões, parar, … <!-- handoff:63 -->
