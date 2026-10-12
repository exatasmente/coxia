# Revisão da rodada 4: bloqueantes tratados, entrega completa em leitura

## Veredito

Aprovado. A revisão foi feita só pela leitura do diff, do teste de ponta a ponta do executor, do teste do handler da persona, do `configModule.ts` e dos catálogos i18n. Nenhum comando foi rodado: `tsc`, `vitest`, `theme-audit`, `i18n:lint` e `public-audit` são **não verificados**, e a aprovação não os substitui.

## Bloqueantes da rodada 3

- **Teste do executeStage com `claude-code`: tratado.** `test/runner-claude-code-stage.test.ts` passa o fluxo inteiro do runner com uma porta de sessão simulada. Cobre o resultado da sessão como resposta e o agente do Coxia sem rodar (1), a transcrição em arquivo e mensagem fora da resposta (2), a falha da etapa com transcrição mantida (8), a recusa com a opção desligada e em workspace de teste sem chamar a porta nem o agente (5, 6) e o padrão intacto com executor ausente ou `agent` (9).
- **Recusa da persona pelo handler: tratado.** `test/config-claude-code-persona.test.ts` exerce `config:save` pela porta da persona (negada ao ligar a opção e ao escolher o executor, configuração guardada intacta), pela janela (permitido) e a persona baixando os dois (permitido). A porta `config:cycle-save` já recusa por `refusedPaths` (inclui `executorRaised` e o que está fora de `WEB_EDITABLE`).
- **Interface, i18n da interface, docs e CHANGELOG: tratado.** Campo Executor em `StagePanel` (só com a opção ligada, ou quando a etapa já está em Claude Code; desabilitado no navegador pareado), botão em `RunnerSection`, chaves nos dois catálogos (`ui-team` e `main`), seção em `docs/runner.md` em pt-BR e en, entrada em `Unreleased`.

## Critérios de aceite (por leitura)

1, 2, 3, 4, 5, 6, 7, 8, 9 e 10 atendidos em código e teste simulado. O respeito real do Claude Code a um `deny` e o comportamento real de `canUseTool` e `structured_output` do SDK não foram observados.

## Sugestões (não bloqueiam)

- O link da transcrição no detalhe da etapa e o canal `runs:claudeTranscript` ficaram de fora por decisão já aceita; o critério 2 vale pelo arquivo e pela linha na thread.
- Não há teste de componente do `StagePanel` para o campo oculto com a opção desligada (critério 5 na interface).
- `PendingCommand.tool` não foi feito; a ferramenta vai no texto da pergunta.
- `flow-check` não rejeita `executor` em etapa sem agente; o campo é ignorado e a interface o limpa ao trocar o tipo.
- O teste do encadeamento da migração segue fraco; a integração com a #280 renumera o passo v34→v35.

## Repositório público

Na leitura, nenhum nome, host, número de issue real ou segredo no diff; os testes usam sessão simulada e pastas temporárias, sem `~/.claude`. `public-audit` não rodado.

## Próximo

Quem tem shell roda `npx tsc --noEmit`, os testes tocados (`runner-claude-code-stage`, `config-claude-code-persona`, `claude-code-task`, `claude-code-executor-guard`, `config-migrations`, `runnerEdit`) e os cinco portões. As suposições do teste de etapa (id `implement`, `dataDir` igual a `b.dir`, rejeição de `invokePersona`) só se confirmam rodando.
