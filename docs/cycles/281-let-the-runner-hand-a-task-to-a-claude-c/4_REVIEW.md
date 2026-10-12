# Revisão da rodada 5: falhas da QA tratadas, a confirmar rodando

## Veredito

Aprovado, só pela leitura. Nenhum comando foi rodado nesta etapa: `tsc`, `vitest`, `theme-audit`, `i18n:lint` e `public-audit` são **não verificados**. A QA anterior mediu 12 falhas de teste; que foram resolvidas só se confirma rodando a suíte.

## Bloqueantes anteriores

- **Esquema da execução sem `executor`: tratado.** `src/shared/runs/schema.ts:214` aceita `executor` (enum `claude-code`), em linha com `FlowStage.executor` (`types.ts:520`) e com a resolução em `flow.ts:45`. Era a causa dos cinco testes de ponta a ponta e dos critérios 1, 2, 5, 6 e 8.
- **Teste da persona com suposição errada: tratado.** `test/config-claude-code-persona.test.ts` parte de uma etapa de trabalho própria (`withStage`) antes de escolher o executor.
- **Testes, catálogos e docs que não acompanharam o campo:** `runner-config` e `team-runner-edit` esperam `claudeCodeTasks`, `docs/configuration.md` cita a versão 35 e as chaves de `ui-team` foram ordenadas, segundo o diff e a passagem da implementação. `runs-policy` foi ajustado segundo a passagem (não relido). Tudo lido, nada executado.

## Critérios de aceite

1 a 10 atendidos em código e teste simulado, por leitura. Não observado: o respeito real do Claude Code a um `deny` e o comportamento real de `canUseTool` e `structured_output` do SDK.

## Sugestões (não bloqueiam)

- A etapa `build` do teste da persona precisa passar na validação de `saveConfig` (campos `match`, `rank`); só rodando se confirma.
- Sem teste de componente do `StagePanel` para o campo oculto com a opção desligada.
- Link da transcrição na linha do tempo, `PendingCommand.tool` e `flow-check` para executor sem agente ficaram de fora por decisão já aceita.
- Na integração, renumerar o passo de migração v34→v35 com a #280.

## Repositório público

Na leitura, sem nome, host, número de issue real ou segredo; testes com sessão simulada, sem `~/.claude`. `public-audit` não rodado nesta etapa.

## Próximo

Quem tem shell roda `npx tsc --noEmit`, a suíte completa e os quatro portões restantes; primeiro `runner-claude-code-stage`, `config-claude-code-persona`, `runner-config`, `team-runner-edit`, `docs-schema-version`, `ui-i18n` e `runs-policy`.
