# Revisão: só o esquema chegou, a entrega não

## Veredito

Mudanças pedidas. Revisão feita lendo o diff contra a spec e o plano. Nenhum comando foi rodado: tsc, vitest, theme-audit, i18n:lint e public-audit não verificados.

## O que está certo no que existe

- `v34ToV35` grava `claudeCodeTasks: false`, não toca nas etapas, só sobe a versão se `runner` não é objeto; `STEPS`, versão 35, `types.ts`, `defaults.ts` e `schema.ts` andam juntos, como a regra do repositório pede.
- `claudeCodeTasksOf` segue o modelo de `unconfined`.
- O descarte do `executor` inválido no reparo (`poolKeyAt`) é coerente com o de `poolMode`.
- Os testes da migração são razoáveis (leitura; não executados).

## Bloqueantes

1. **Critérios 1 a 9 não atendidos.** Não existem `FlowStage.executor`, a guarda e o desvio em `executor.ts`, `claudeCodeTask.ts`, a recusa de celular e persona, a interface, o i18n, a documentação nem o CHANGELOG. Nenhum comportamento da entrega existe.
2. **O campo `executor` já é aceito e persistido, mas ignorado.** Com o esquema valendo e nada na execução, uma etapa `claude-code` com a opção ligada ou desligada roda no agente do Coxia. Isso viola a regra 4 (nunca cair no agente) e o critério 5. Além disso `configScope` ainda não recusa `executor` vindo do celular (regra 3, critério 7).
3. **Testes que faltam** para o comportamento novo: descarte do `executor` inválido no reparo (`migrations.ts` 535-537, sem teste) e todos da tabela do plano.
4. **Comentário desatualizado** no topo de `schema.ts` ("schema 34", linha 7), pedido no recado e não feito.

## Sugestões

- O teste antigo "é o último passo" virou "o encadeamento não para no 34", assertiva fraca; aceitável enquanto a #280/#282 renumeram na integração.
- `claudeCodeTasksOf` ainda não tem consumidor; sem o passo 4 é código morto.

## Repositório público

No diff, nenhum nome, host, número de issue real ou segredo encontrado (leitura; `public-audit` não rodado).

## Próximo

Completar os passos 2 a 7 do plano, os testes da tabela e rodar os cinco portões. Não pôr a UI/esquema do `executor` em uso antes da guarda do passo 5.
