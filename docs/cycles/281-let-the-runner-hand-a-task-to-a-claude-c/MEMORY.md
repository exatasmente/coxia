# Memória do ciclo

## Decisões

- Etapa do fluxo ganha o campo "Executor": "Agente do Coxia" (padrão) ou "Sessão do Claude Code", aceito em qualquer etapa com agente (type work).
- Opção global "Entregar tarefas ao Claude Code": `runner.claudeCodeTasks`, desligada por padrão, só desktop (fora de WEB_EDITABLE). O campo só aparece e só é escolhível com ela ligada. Celular pareado e persona não ligam a opção nem escolhem o executor (executorRaised em configScope + recusa na persona, esta ainda por fazer).
- Opção desligada ou workspace test: true: a execução recusa (claude-code-off / claude-code-test) antes de abrir qualquer coisa, sem cair no agente normal.
- Resultado da sessão substitui a resposta da etapa; transcrição fica como registro. Sessão sem resultado ou com erro: a etapa falha como qualquer agente.
- Plano (2_PLAN.md): Agent SDK, não ACP; limite de escrita por confinedHooks + realpath em canUseTool; sem Bash nativo; permissões pelo porto askCommand com o relógio pausado; isolated: true; sem rodadas de reparo.
- FlowStage.executor só entra no snapshot quando 'claude-code' (hash dos fluxos existentes não muda).
- Independente da #280; reconciliar passo de migração (v34→v35) e opções na integração.
- Um `executor` inválido no arquivo de configuração é descartado sozinho no reparo (poolKeyAt), com teste.
- Resposta: (1) Como a etapa é configurada: um campo na própria etapa do fluxo, "Executor", com duas opções: "Agente do Coxia" (padrão, o que existe hoje) e "Sessão do Claude Code". Quem não mexe no campo não vê mudança. O campo só aparece e só pode ser escolhido com a opção global "Entregar tarefas ao Claude Code" ligada (desligada por padrão, só desktop). Com a opção desligada, ou em workspace test: true, a etapa não alcança nenhuma sessão: a execução recusa com mensagem clara, sem cair silenciosamente no agente normal. Celular pareado e persona não podem ligar a opção nem escolher o executor. (2) Resul… <!-- answer:22 -->

## Restrições

- Pedido de funcionalidade. Relacionadas #262, #280 (dependência), #282.
- Toda escrita externa passa por Actions; repositório público; testes só com sessões simuladas, nada de ~/.claude.
- Portões: tsc, vitest, theme-audit, i18n:lint, public-audit.

## Tentado e descartado

- ACP: dependência nova e segunda via de permissões.
- Bash nativo na sessão: não dá para impor o limite de escrita.

## Perguntas abertas

- Não verificado: formato aceito por readOutput para etapa de trabalho sem schema; destino da transcrição (arquivo + canal runs:claudeTranscript ou evidência); ponto exato da recusa da persona em persona/assist.ts.

## Onde o trabalho está

- No código (lido, não executado): esquema, defaults, migração v34→v35, descarte de executor inválido, claudeCode.ts, FlowStage.executor, guardExecutor + códigos claude-code-off/test + i18n, executorRaised, test/claude-code-executor-guard.test.ts.
- Revisão rodada 2: bloqueantes de comentário, teste do descarte e queda no agente tratados (por leitura). Segue bloqueando: claudeCodeTask.ts não existe, então critérios 1-4 não atendidos e a etapa claude-code sempre falha com claude-code-off (throw provisório em executor.ts); persona não recusada; sem UI, i18n da UI, docs, CHANGELOG nem testes dos critérios 1-4 e 8; d.claudeCode não ligado na produção.
- Nenhum comando rodado ainda em nenhuma etapa (tsc, vitest, auditorias): tudo não verificado.
- Próximo: developer roda tsc e os dois testes tocados, implementa o que falta, roda os cinco portões; nova revisão.
- Passagem support → product-owner: Planejar: escolher ACP vs. Agent SDK (SDK já embarcado), como impor o limite de escrita ao worktree, o campo "Executor" no esquema do fluxo (qualquer etapa) e o encaixe com os canais de sessões da #280 (recusa quando desligado, persona/celular negados). <!-- handoff:35 -->
- Passagem product-owner → pessoa: Planejar: escolher ACP vs. Agent SDK (SDK já embarcado em src/main/claudeSdk.ts), como impor o limite de escrita ao worktree, o campo "Executor" em FlowStage (src/shared/runs/types.ts) e o encaixe com a #280, cujo módulo de sessões não foi achado nesta worktree (conferir se a base já a inclui). <!-- handoff:45 -->
- Passagem tl-plataforma → pessoa: Implementar 2_PLAN.md: (1) esquema/migração (StageDef.executor, runner.claudeCodeTasks, passo v34→v35, hash do fluxo estável); (2) fronteira em configScope/persona; (3) src/main/runner/claudeCodeTask.ts com Agent SDK; (4) guarda e ramo em executor.ts; (5) UI e i18n; (6) testes com sessão simulada. Antes de codar: confirmar o formato de readOutput, o destino da transcrição e o ponto de recusa da persona. <!-- handoff:59 -->
- Passagem developer → revisor-plataforma: Continuar a implementação a partir do passo 2 de 2_PLAN.md; o passo 1 já está no worktree. Antes de tudo, rodar `npx tsc --noEmit` e `npx vitest run test/config-migrations.test.ts`. Acrescentar um teste para o descarte do `executor` inválido no reparo e atualizar o comentário \"schema 34\" no topo de `schema.ts`. Depois seguir com os passos 2 a 7 e os testes da tabela do plano, e rodar os cinco portões do AGENTS.md. <!-- handoff:91 -->
- Passagem revisor-plataforma → developer: Revisão pelo diff e pelos documentos; nada foi executado (nenhum portão rodado). Só o passo 1 do plano (esquema e migração) está no código. Os critérios de aceite 1 a 9 da spec não são atendidos, e o campo `executor` já é aceito e salvo sem nenhum efeito, então uma etapa marcada como Claude Code rodaria no agente do Coxia, o que a regra 4 proíbe. Veredito: mudanças. [bloqueia] src/shared/config/schema.ts:177: O campo `executor` já é aceito e salvo, mas nada na execução o lê. Uma etapa marcada como Claude Code, com a opção ligada ou desligada, rodaria no agente do Coxia, o que a regra 4 e o cri… <!-- handoff:99 -->
- Passagem developer → revisor-plataforma: Developer: rodar `npx tsc --noEmit` e `npx vitest run test/claude-code-executor-guard.test.ts test/config-migrations.test.ts`; corrigir o que falhar. Depois fazer o passo 4 (claudeCodeTask.ts), trocar o throw provisório em executor.ts pela chamada da sessão e ligar `d.claudeCode`, a recusa da persona, a interface, o i18n restante, a documentação e o CHANGELOG, e rodar os cinco portões. <!-- handoff:123 -->
