# Memória do ciclo

## Decisões

- Etapa do fluxo ganha o campo "Executor": "Agente do Coxia" (padrão) ou "Sessão do Claude Code"; primeira versão aceita em qualquer etapa com agente.
- Opção global "Entregar tarefas ao Claude Code": `runner.claudeCodeTasks`, desligada por padrão, só desktop (fora de WEB_EDITABLE); campo só aparece/escolhível com ela ligada. Celular pareado e persona não ligam nem escolhem (executorRaised em configScope + recusa na persona).
- Opção desligada ou workspace test: true: a execução recusa (códigos claude-code-off / claude-code-test) antes de abrir qualquer coisa, sem cair no agente normal.
- Resultado da sessão substitui a resposta da etapa; transcrição fica como registro. Sessão sem resultado/erro: etapa falha como qualquer agente.
- Plano (2_PLAN.md): mecanismo = Agent SDK (não ACP: já embarcado, canUseTool e hooks, sem dependência nova). Limite de escrita = confinedHooks de runner/hooks.ts + checagem com realpath em canUseTool; sem Bash nativo na sessão (só shell em sandbox do app). Permissões reaproveitam o porto askCommand (item pendente de comando) com relógio pausado. isolated: true (nada de ~/.claude). Sem rodadas de reparo.
- FlowStage.executor só entra no snapshot quando 'claude-code' (hash dos fluxos existentes não muda).
- Independente da #280: o módulo de sessões não existe nesta base; opção própria. Reconciliar número do passo de migração e as duas opções na integração.
- Spec em 1_SPEC.md (10 critérios). Prioridade proposta: medium.
- Resposta: (1) Como a etapa é configurada: um campo na própria etapa do fluxo, "Executor", com duas opções: "Agente do Coxia" (padrão, o que existe hoje) e "Sessão do Claude Code". Quem não mexe no campo não vê mudança. O campo só aparece e só pode ser escolhido com a opção global "Entregar tarefas ao Claude Code" ligada (desligada por padrão, só desktop). Com a opção desligada, ou em workspace test: true, a etapa não alcança nenhuma sessão: a execução recusa com mensagem clara, sem cair silenciosamente no agente normal. Celular pareado e persona não podem ligar a opção nem escolher o executor. (2) Resul… <!-- answer:22 -->

## Restrições

- Tipo: pedido de funcionalidade. Relacionadas #262, #280 (dependência), #282.
- Mudança de config exige passo em STEPS (hoje até 33→34; novo v34→v35) e types.ts, defaults.ts, schema.ts.
- Toda escrita externa passa por Actions; repositório público (sem dados reais); testes só com sessões simuladas.

## Tentado e descartado

- ACP: exigiria dependência e segunda via de permissões.
- Bash nativo na sessão: não dá para impor o limite de escrita.

## Perguntas abertas

- Não verificado (para o desenvolvedor confirmar ao codar): formato aceito por readOutput para etapa de trabalho sem schema; destino da transcrição (arquivo + canal runs:claudeTranscript ou evidência); ponto exato da recusa da persona em persona/assist.ts; nome do teste de migração.

## Onde o trabalho está

- Plano concluído (2_PLAN.md), sem código; nada executado. Próxima: implementação.
- Passagem support → product-owner: Planejar: escolher ACP vs. Agent SDK (SDK já embarcado), como impor o limite de escrita ao worktree, o campo "Executor" no esquema do fluxo (qualquer etapa) e o encaixe com os canais de sessões da #280 (recusa quando desligado, persona/celular negados). <!-- handoff:35 -->
- Passagem product-owner → pessoa: Planejar: escolher ACP vs. Agent SDK (SDK já embarcado em src/main/claudeSdk.ts), como impor o limite de escrita ao worktree, o campo "Executor" em FlowStage (src/shared/runs/types.ts) e o encaixe com a #280, cujo módulo de sessões não foi achado nesta worktree (conferir se a base já a inclui). <!-- handoff:45 -->
