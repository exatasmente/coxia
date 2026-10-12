# Revisão da rodada 2: a guarda chegou, a sessão ainda não

## Veredito

Mudanças pedidas. Revisão feita lendo o diff contra a spec, o plano e a rodada anterior. Nenhum comando foi rodado: tsc, vitest, theme-audit, i18n:lint e public-audit não verificados.

## Bloqueantes da rodada 1

- Comentário "schema 34" em `schema.ts`: tratado (agora diz 35).
- Teste do descarte de `executor` inválido no reparo: tratado (leitura do teste em `test/config-migrations.test.ts`; não executado).
- `executor` aceito mas ignorado, com risco de a etapa rodar no agente do Coxia: tratado em leitura. `guardExecutor` roda antes de worktree e sandbox, e o ponto do motor lança `claude-code-off` para a etapa Claude Code, então ela nunca chega a `d.engine`. `configScope` recusa por nome o `executor` vindo do celular.
- Entrega incompleta: **não tratado** (abaixo).

## Bloqueantes

1. **Critérios 1 a 4 não atendidos.** `claudeCodeTask.ts` não existe. Com a opção ligada e fora de workspace de teste, a etapa Claude Code falha com `claude-code-off`, mensagem que manda ligar uma opção que já está ligada. Sem resultado de volta, transcrição, pedido de permissão pendente nem recusa de escrita fora da worktree.
2. **Critério 7 pela metade.** O celular é recusado; a persona no desktop, que alcança `config:save`, ainda não é recusada para `runner.claudeCodeTasks` nem `executor`.
3. **Faltam interface, i18n da interface, documentação e CHANGELOG**, e testes para os critérios 1 a 4 e 8 da tabela do plano. `d.claudeCode` não é ligado na produção (workspace de teste não é consultado) e `claudeCodeTasksOf` só é usado na guarda.

## Sugestões

- Enquanto a sessão não existe, a mensagem `claude-code-off` é enganosa com a opção ligada; trocar o throw provisório resolve.
- O teste "o encadeamento não para no 34" é assertiva fraca; aceitável até a integração renumerar.
- `flow-check` ainda não rejeita `executor` em etapa sem agente (o campo é ignorado nelas).

## Repositório público

No diff, nenhum nome, host, número de issue real ou segredo (leitura; `public-audit` não rodado).

## Próximo

Rodar `npx tsc --noEmit` e os dois testes tocados; escrever `claudeCodeTask.ts`, ligar `d.claudeCode`, recusa da persona, interface, i18n, documentação, CHANGELOG e testes; rodar os cinco portões.
