# Memória do ciclo

## Decisões

- Etapa do fluxo ganha o campo "Executor": "Agente do Coxia" (padrão) ou "Sessão do Claude Code". A primeira versão aceita em qualquer etapa com agente.
- Opção global "Entregar tarefas ao Claude Code": `runner.claudeCodeTasks`, desligada por padrão, só desktop (fora de WEB_EDITABLE). O campo só aparece e só é escolhível com ela ligada. Celular pareado e persona não ligam a opção nem escolhem o executor (executorRaised em configScope + recusa na persona).
- Opção desligada ou workspace test: true: a execução recusa (códigos claude-code-off / claude-code-test) antes de abrir qualquer coisa, sem cair no agente normal.
- Resultado da sessão substitui a resposta da etapa; a transcrição fica como registro. Sessão sem resultado ou com erro: a etapa falha como qualquer agente.
- Plano (2_PLAN.md):
  - mecanismo: Agent SDK, não ACP;
  - limite de escrita: confinedHooks + checagem com realpath em canUseTool;
  - sem Bash nativo na sessão;
  - permissões pelo porto askCommand, com o relógio pausado;
  - isolated: true;
  - sem rodadas de reparo.
- FlowStage.executor só entra no snapshot quando 'claude-code' (o hash dos fluxos existentes não muda).
- Independente da #280; reconciliar o passo de migração e as opções na integração.
- Implementação: um `executor` inválido no arquivo de configuração é descartado sozinho no reparo (poolKeyAt em migrations.ts), não reinicia a lista de etapas.
- Resposta: (1) Como a etapa é configurada: um campo na própria etapa do fluxo, "Executor", com duas opções: "Agente do Coxia" (padrão, o que existe hoje) e "Sessão do Claude Code". Quem não mexe no campo não vê mudança. O campo só aparece e só pode ser escolhido com a opção global "Entregar tarefas ao Claude Code" ligada (desligada por padrão, só desktop). Com a opção desligada, ou em workspace test: true, a etapa não alcança nenhuma sessão: a execução recusa com mensagem clara, sem cair silenciosamente no agente normal. Celular pareado e persona não podem ligar a opção nem escolher o executor. (2) Resul… <!-- answer:22 -->

## Restrições

- Tipo: pedido de funcionalidade. Relacionadas #262, #280 (dependência), #282.
- Toda escrita externa passa por Actions; repositório público (sem dados reais); testes só com sessões simuladas.
- Portões do AGENTS.md: tsc, vitest, theme-audit, i18n:lint, public-audit.

## Tentado e descartado

- ACP: exigiria dependência nova e uma segunda via de permissões.
- Bash nativo na sessão: não dá para impor o limite de escrita.

## Perguntas abertas

- Não verificado: formato aceito por readOutput para etapa de trabalho sem schema; destino da transcrição (arquivo + canal runs:claudeTranscript ou evidência); ponto exato da recusa da persona em persona/assist.ts.

## Onde o trabalho está

- Implementação parcial, só o passo 1 do plano no worktree:
  - types.ts: STAGE_EXECUTORS, StageDef.executor, RunnerConfig.claudeCodeTasks, versão 35;
  - schema.ts, defaults.ts;
  - migrations.ts: v34ToV35 e descarte do executor inválido no reparo;
  - src/shared/claudeCode.ts;
  - testes em test/config-migrations.test.ts.
- Nenhum portão rodado; nada verificado. Falta um teste do descarte do executor no reparo e corrigir o comentário "schema 34" no topo de schema.ts.
- Próximo: passos 2 a 7 do plano (fluxo, fronteira, claudeCodeTask.ts, executor.ts, UI/i18n, docs/CHANGELOG) e os testes da tabela do plano.
- Passagem support → product-owner: Planejar: escolher ACP vs. Agent SDK (SDK já embarcado), como impor o limite de escrita ao worktree, o campo "Executor" no esquema do fluxo (qualquer etapa) e o encaixe com os canais de sessões da #280 (recusa quando desligado, persona/celular negados). <!-- handoff:35 -->
- Passagem product-owner → pessoa: Planejar: escolher ACP vs. Agent SDK (SDK já embarcado em src/main/claudeSdk.ts), como impor o limite de escrita ao worktree, o campo "Executor" em FlowStage (src/shared/runs/types.ts) e o encaixe com a #280, cujo módulo de sessões não foi achado nesta worktree (conferir se a base já a inclui). <!-- handoff:45 -->
- Passagem tl-plataforma → pessoa: Implementar 2_PLAN.md: (1) esquema/migração (StageDef.executor, runner.claudeCodeTasks, passo v34→v35, hash do fluxo estável); (2) fronteira em configScope/persona; (3) src/main/runner/claudeCodeTask.ts com Agent SDK; (4) guarda e ramo em executor.ts; (5) UI e i18n; (6) testes com sessão simulada. Antes de codar: confirmar o formato de readOutput, o destino da transcrição e o ponto de recusa da persona. <!-- handoff:59 -->
