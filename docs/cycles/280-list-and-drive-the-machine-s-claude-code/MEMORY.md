# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível como escrito. Sugestão priority:medium; squad plataforma.
- Refino: 1_SPEC.md (16 regras, 12 critérios). Prioridade proposta priority:medium; sem marco.
- Plano (2_PLAN.md): chave `claudeSessions.enabled` (migração v35, types/defaults/schema); prefixo negado `/^claudeSessions:/` em webPolicy.ts; canais em EXCLUDED (motivo `machine`); auditoria `claude-session` (ações message/permission/stop/start, sem texto); novo `emitWindow` em ModuleContext (o `emit` atual faz broadcast ao celular); fila de permissões própria copiada de turnAsks-core, resposta só se viaOf()==='window'; test:true recusa send/start antes do SDK; registro `owned` compartilhado com #282 (Remote Control fica lá).

## Restrições

- Opt-in, desligado por padrão, só desktop; nunca abrir ~/.claude/.credentials.json, sessions/*.key, daemon/control.key (único ponto de disco: guardedRead com lista de campos); negado ao celular; persona em EXCLUDED; nada de ~/.claude em testes; eventos só à janela.
- Config nova exige step em STEPS + types.ts, defaults.ts, schema.ts.

## Tentado e descartado

- Nada.

## Perguntas abertas

- API do SDK instalado (listSessions, leitura de mensagens, resume/forkSession, canUseTool, interrupt): não verificada, node_modules ausente; passo 0 do plano.
- Fonte limpa de sessões em execução/segundo plano e detecção de sessão presa por outro processo: não resolvida; plano tem versão reduzida como fallback.
- Função de redação a reutilizar: a localizar (candidatas em shared/activity.ts, shared/runs/comment.ts).

## Onde o trabalho está

- Triagem, spec e plano prontos. Próxima etapa: implementação, começando pelo passo 0 (sondagem do SDK). Relacionadas: #262 (entrega 3 lá), #274 (entregue), #282 (vizinha), #281.
- Passagem support → product-owner: Refino: confirmar a fonte das sessões em execução/em segundo plano sem tocar nas chaves, checar a API do SDK instalado, achar onde entra o prefixo negado em webPolicy.ts e alinhar com #262 e #282. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano: resolver a fonte de sessões em execução/segundo plano sem abrir chaves e verificar a API do SDK instalado (instalar dependências); o prefixo negado entra como novo padrão em webPolicy.ts (lista de padrões na linha ~120, ex.: /^claudeSessions:/); incluir o recurso em EXCLUDED de doorTable.ts; combinar com #282 o ciclo de vida das sessões iniciadas pelo Coxia. <!-- handoff:21 -->
