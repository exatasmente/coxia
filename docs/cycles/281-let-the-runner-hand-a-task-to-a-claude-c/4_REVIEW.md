# Revisão da rodada 3: a sessão existe, falta o resto da entrega

## Veredito

Mudanças pedidas. Revisão feita só pela leitura do diff contra a spec, o plano e as rodadas anteriores. Nenhum comando foi rodado: `tsc`, `vitest`, `theme-audit`, `i18n:lint` e `public-audit` não verificados.

## Bloqueantes da rodada 2

- Módulo da sessão inexistente: tratado em leitura. `claudeCodeTask.ts` abre a sessão pelo Agent SDK (`query` injetável), com `settingSources: []`, sem `Bash`, com os hooks de confinamento da etapa, `canUseTool` que repete `checkPath` nas ferramentas de escrita e pergunta à pessoa com o relógio pausado nas demais. O resultado substitui a resposta; falhas lançam erro como um agente. Execução real não verificada.
- Persona no desktop: tratado em leitura (`claudeCodeRaised` chamado em `config:save` quando `byPersona()`). Não verificado que a persona chega por esse canal; a chamada pelo handler não tem teste.
- `d.claudeCode` sem ligação na produção: tratado em leitura (`module.ts`, `service.ts`).
- Interface, i18n da interface, documentação e testes de ponta a ponta: **não tratados** (abaixo).

## Bloqueantes

1. **Interface e documentação ainda faltam (pedido anterior não atendido).** Não há campo Executor no editor do fluxo, botão da opção em `RunnerSection`, nem link da transcrição. O critério 2 (transcrição disponível como detalhe) só vale como arquivo e mensagem da conversa; o critério 5 (campo oculto com a opção desligada) não tem como ser observado, pois o campo só existe no arquivo de configuração. O CHANGELOG já admite isso. Falta também a página em `docs/` (opção, campo, sem shell nativo).
2. **Falta teste do `executeStage` com `claude-code`.** Nenhum teste passa uma etapa Claude Code pelo executor: critérios 1 (resposta substituída e entregue à etapa seguinte), 5 e 6 (`query` nunca chamado, `d.engine` nunca chamado), 8 (etapa `failed`) e 9 (padrão intacto, repair rounds ainda rodando para o agente do Coxia) só têm teste do pedaço isolado (`guardExecutor`, `runClaudeCodeTask`). O ramo novo em `runStage` (`own`, gravação da transcrição, mensagem do fórum) está sem teste.
3. **Recusa da persona sem teste pelo handler.** Só a função `claudeCodeRaised` é testada; a chamada em `config:save` sob `byPersona()` (comportamento novo de fronteira de segurança) não é.

## Sugestões

- A transcrição é gravada só depois de `port.run` voltar; quando a sessão falha ela se perde, ao contrário do plano (gravar no `finally`).
- As linhas `main.forum.code.runner.qa.repair` em `main.en.json` e `main.pt-BR.json` perderam o espaço depois dos dois-pontos, e `withExecutor =(` em `test/claude-code-executor-guard.test.ts` tem formatação fora do padrão: ruído de diff.
- `PendingCommand.tool` não foi feito: a ferramenta vai no texto da pergunta; aceitável.
- `flow-check` ainda não rejeita `executor` em etapa sem agente (o campo é ignorado nelas).
- O teste "o encadeamento não para no 34" segue fraco; aceitável até a integração renumerar com a outra entrega de sessões.

## Repositório público

No diff, nenhum nome, host, número de issue real ou segredo (leitura; `public-audit` não rodado). Os testes usam pastas temporárias e sessão simulada, sem `~/.claude`.

## Próximo

Rodar `npx tsc --noEmit` e os três testes tocados; fazer interface, i18n da interface, documentação e `flow-check`; escrever o teste do `executeStage` e o da recusa da persona pelo handler; rodar os cinco portões.
