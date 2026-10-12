# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível como escrito. Sugestão priority:medium; squad plataforma.
- Refino: 1_SPEC.md (16 regras, 12 critérios). Prioridade proposta priority:medium; sem marco.
- Plano (2_PLAN.md): chave `claudeSessions.enabled` (migração v35, types/defaults/schema); prefixo negado `/^claudeSessions:/` em webPolicy.ts; canais em EXCLUDED (motivo `machine`); auditoria `claude-session` (ações message/permission/stop/start, sem texto); novo `emitWindow` em ModuleContext (o `emit` atual faz broadcast ao celular); fila de permissões própria copiada de turnAsks-core, resposta só se viaOf()==='window'; test:true recusa send/start antes do SDK; registro `owned` compartilhado com #282 (Remote Control fica lá).
- Passo 0 (implementação, tentativa 1): decisão 8 vale inteira, sem a versão reduzida. Sessões em execução e em segundo plano vêm de `~/.claude/sessions/<pid>.json` (campos pid, sessionId, cwd, kind 'interactive'|'background', status 'idle'|'busy', updatedAt; vivo = process.kill(pid,0)). Bifurcação: o sessionId está num <pid>.json vivo que não está em `owned`. Detalhes na nota m-7d7da8eb.

## Restrições

- Opt-in, desligado por padrão, só desktop; nunca abrir ~/.claude/.credentials.json, sessions/*.key, daemon/control.key (único ponto de disco: guardedRead, que só aceita sessions/<digits>.json e só devolve a lista de campos); negado ao celular; persona em EXCLUDED; nada de ~/.claude em testes; eventos só à janela.
- Config nova exige step em STEPS + types.ts, defaults.ts, schema.ts.

## Tentado e descartado

- Fonte reduzida da decisão 8: descartada, porque a fonte limpa existe.

## Perguntas abertas

- Função de redação a reutilizar: a localizar (candidatas em shared/activity.ts, shared/runs/comment.ts).

## Onde o trabalho está

- Triagem, spec e plano prontos. Implementação, tentativa 1: só o passo 0 feito (npm ci no worktree, API do SDK confirmada: listSessions, getSessionMessages, forkSession, canUseTool, resume/forkSession, Query.interrupt). Nenhum código mudou; os passos 1 a 7 e os portões estão pendentes.
- Relacionadas: #262 (entrega 3 lá), #274 (entregue), #282 (vizinha, Remote Control), #281.
- Passagem support → product-owner: Refino: confirmar a fonte das sessões em execução/em segundo plano sem tocar nas chaves, checar a API do SDK instalado, achar onde entra o prefixo negado em webPolicy.ts e alinhar com #262 e #282. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano: resolver a fonte de sessões em execução/segundo plano sem abrir chaves e verificar a API do SDK instalado (instalar dependências); o prefixo negado entra como novo padrão em webPolicy.ts (lista de padrões na linha ~120, ex.: /^claudeSessions:/); incluir o recurso em EXCLUDED de doorTable.ts; combinar com #282 o ciclo de vida das sessões iniciadas pelo Coxia. <!-- handoff:21 -->
- Passagem tl-plataforma → pessoa: Implementação: começar pelo passo 0 do plano (instalar dependências e confirmar no SDK instalado listSessions, leitura de mensagens, resume/forkSession, canUseTool, interrupt e a fonte de sessões em execução/segundo plano sem abrir chaves); só então seguir a ordem 1 a 7. Se a fonte limpa não existir, aplicar a versão reduzida da decisão 8 e avisar o product owner. <!-- handoff:36 -->
