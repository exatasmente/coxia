# Memória do ciclo

## Decisões

- Etapa do fluxo ganha o campo "Executor": "Agente do Coxia" (padrão) ou "Sessão do Claude Code", aceito em qualquer etapa com agente (type work).
- Opção global "Entregar tarefas ao Claude Code": `runner.claudeCodeTasks`, desligada por padrão, só desktop (fora de WEB_EDITABLE). O campo só aparece e só é escolhível com ela ligada. Celular pareado: `executorRaised` em refusedPaths. Persona: `claudeCodeRaised` em `config:save` (byPersona).
- Opção desligada ou workspace test: true: a execução recusa (claude-code-off / claude-code-test) antes de abrir qualquer coisa, sem cair no agente normal.
- Resultado da sessão substitui a resposta da etapa; transcrição fica como registro (arquivo em dataDir/claude-code + mensagem do app). Sessão sem resultado ou com erro: a etapa falha como qualquer agente.
- Plano (2_PLAN.md): Agent SDK, não ACP; cerca de escrita = os confine.hooks da etapa + checkPath em canUseTool; sem Bash nativo; permissões pelo porto askCommand com o relógio pausado; settingSources [] ; sem rodadas de reparo.
- FlowStage.executor só entra no snapshot quando 'claude-code' (hash dos fluxos existentes não muda).
- Independente da #280; reconciliar passo de migração (v34→v35) e opções na integração.
- Um `executor` inválido no arquivo de configuração é descartado sozinho no reparo, com teste.
- Resposta da pessoa: volta e pede as correções (tentativa 6).
- Resposta: (1) Como a etapa é configurada: um campo na própria etapa do fluxo, "Executor", com duas opções: "Agente do Coxia" (padrão, o que existe hoje) e "Sessão do Claude Code". Quem não mexe no campo não vê mudança. O campo só aparece e só pode ser escolhido com a opção global "Entregar tarefas ao Claude Code" ligada (desligada por padrão, só desktop). Com a opção desligada, ou em workspace test: true, a etapa não alcança nenhuma sessão: a execução recusa com mensagem clara, sem cair silenciosamente no agente normal. Celular pareado e persona não podem ligar a opção nem escolher o executor. (2) Resul… <!-- answer:22 -->
- Resposta: Volta e pede as correções <!-- answer:132 -->

## Restrições

- Pedido de funcionalidade. Relacionadas #262, #280 (dependência), #282.
- Toda escrita externa passa por Actions; repositório público; testes só com sessões simuladas, nada de ~/.claude.
- Portões: tsc, vitest, theme-audit, i18n:lint, public-audit.

## Tentado e descartado

- ACP: dependência nova e segunda via de permissões.
- Bash nativo na sessão: não dá para impor o limite de escrita.
- Canal `runs:claudeTranscript`: não criado; transcrição é arquivo + mensagem da conversa.

## Perguntas abertas

- Não verificado: se `config:save` recebe a config inteira pela porta da persona (Settings.set path/valor); registro de código para `main.forum.code.runner.claudeCode.transcript`; tipos (tsc) de firstRun e do cast de loadClaudeQuery.

## Onde o trabalho está

- No código (escrito, não executado): esquema/migração v35, FlowStage.executor, guardExecutor, executorRaised, claudeCodeRaised, `src/main/runner/claudeCodeTask.ts`, ramo em executor.ts, fiação em service.ts/module.ts, i18n da mensagem de transcrição, CHANGELOG, testes `test/claude-code-task.test.ts` e `test/claude-code-executor-guard.test.ts`.
- Falta: interface (campo Executor, botão em RunnerSection, link da transcrição), i18n da UI, docs/, flow-check, teste do executeStage com claude-code.
- Nenhum comando rodado em nenhuma etapa: tudo não verificado.
- Próximo: developer roda tsc e os três testes tocados, corrige, faz a interface e docs e roda os cinco portões; nova revisão.
- Passagem support → product-owner: Planejar: escolher ACP vs. Agent SDK (SDK já embarcado), como impor o limite de escrita ao worktree, o campo "Executor" no esquema do fluxo (qualquer etapa) e o encaixe com os canais de sessões da #280 (recusa quando desligado, persona/celular negados). <!-- handoff:35 -->
- Passagem product-owner → pessoa: Planejar: escolher ACP vs. Agent SDK (SDK já embarcado em src/main/claudeSdk.ts), como impor o limite de escrita ao worktree, o campo "Executor" em FlowStage (src/shared/runs/types.ts) e o encaixe com a #280, cujo módulo de sessões não foi achado nesta worktree (conferir se a base já a inclui). <!-- handoff:45 -->
- Passagem tl-plataforma → pessoa: Implementar 2_PLAN.md: (1) esquema/migração (StageDef.executor, runner.claudeCodeTasks, passo v34→v35, hash do fluxo estável); (2) fronteira em configScope/persona; (3) src/main/runner/claudeCodeTask.ts com Agent SDK; (4) guarda e ramo em executor.ts; (5) UI e i18n; (6) testes com sessão simulada. Antes de codar: confirmar o formato de readOutput, o destino da transcrição e o ponto de recusa da persona. <!-- handoff:59 -->
- Passagem developer → revisor-plataforma: Continuar a implementação a partir do passo 2 de 2_PLAN.md; o passo 1 já está no worktree. Antes de tudo, rodar `npx tsc --noEmit` e `npx vitest run test/config-migrations.test.ts`. Acrescentar um teste para o descarte do `executor` inválido no reparo e atualizar o comentário \"schema 34\" no topo de `schema.ts`. Depois seguir com os passos 2 a 7 e os testes da tabela do plano, e rodar os cinco portões do AGENTS.md. <!-- handoff:91 -->
- Passagem revisor-plataforma → developer: Revisão pelo diff e pelos documentos; nada foi executado (nenhum portão rodado). Só o passo 1 do plano (esquema e migração) está no código. Os critérios de aceite 1 a 9 da spec não são atendidos, e o campo `executor` já é aceito e salvo sem nenhum efeito, então uma etapa marcada como Claude Code rodaria no agente do Coxia, o que a regra 4 proíbe. Veredito: mudanças. [bloqueia] src/shared/config/schema.ts:177: O campo `executor` já é aceito e salvo, mas nada na execução o lê. Uma etapa marcada como Claude Code, com a opção ligada ou desligada, rodaria no agente do Coxia, o que a regra 4 e o cri… <!-- handoff:99 -->
- Passagem developer → revisor-plataforma: Developer: rodar `npx tsc --noEmit` e `npx vitest run test/claude-code-executor-guard.test.ts test/config-migrations.test.ts`; corrigir o que falhar. Depois fazer o passo 4 (claudeCodeTask.ts), trocar o throw provisório em executor.ts pela chamada da sessão e ligar `d.claudeCode`, a recusa da persona, a interface, o i18n restante, a documentação e o CHANGELOG, e rodar os cinco portões. <!-- handoff:123 -->
- Passagem pessoa → developer: Volta e pede as correções <!-- handoff:133 -->
