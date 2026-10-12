# Plano de testes: Remote Control só de leitura nas etapas de um agente

## Portões do repositório (executados nesta etapa)

| # | Comando | Resultado |
|---|---|---|
| P1 | `npx tsc --noEmit` | saída 0 |
| P2 | `npx vitest run` | 546 arquivos passaram, 1 pulado; 8944 testes passaram, 4 pulados; saída 0 |
| P3 | `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` | todos saída 0 (6286 chaves nos dois idiomas) |
| P4 | `npx electron-vite build` | build concluído, saída 0 |

Comprovação: ev-10.

## Cenários por critério de aceite

1. **Critério 1, a sessão aparece em claude.ai/code com a opção ligada e não aparece desligada.** Não executado com conta real. O teste de runner (`test/runner-remote-control.test.ts`) passou no conjunto completo e mostra, com fakes, que a etapa entrega o espelho ao motor e que, desligado, nada é carregado. Contra a conta real: não verificado.
2. **Critério 2, instalação nova com tudo desligado.** Passou: testes de migração v34→v35 e de padrão `off` rodaram no conjunto completo (ev-10). A leitura dos testes em si não foi refeita aqui.
3. **Critério 3, espelho só de leitura recusa entrada.** Não executado contra a página real. Os testes da ponte (`test/remote-control-bridge.test.ts`) passaram e cobrem, com fakes, a ponte só de saída e a entrada descartada. A página real não foi observada. O desvio aceito é que a recusa vira uma mensagem fixa de somente leitura.
4. **Critério 4, workspace `test: true` recusa.** Passou nos testes de política e de interface (conjunto completo, ev-10).
5. **Critério 5, celular pareado não vê nem aciona.** Passou nos testes de política, de `configScope` e de `webPolicy` (conjunto completo, ev-10).
6. **Critério 6, persona recusada.** Passou nos testes de política (conjunto completo, ev-10).
7. **Critério 7, uma linha de auditoria por sessão.** Passou nos testes da ponte e do runner, com fakes (ev-10).
8. **Critério 8, aviso antes da confirmação nos dois idiomas.** Passou: o teste de interface e o `i18n:lint` passaram. O aviso no editor do agente não foi visto no app em execução. As telas de execução e de sessão não existem.
9. **Critério 9, tela de sessões.** Não executado: fora de escopo (depende da issue de sessões).
10. **Critério 10, precedência entre agente e execução.** Parcial: só a função `resolveRemoteControl` é testada. A escolha por execução não existe na interface. Não executado ponta a ponta.

## Não verificado

- Contas reais e o app Claude no celular (critérios 1 e 3).
- A interface no app em execução na tela virtual: só o teste de componente cobre.
- A renovação da credencial do worker em etapas longas.
- A ponte aberta em motor que não é o do Claude (sugestão da revisão, não corrigida).

## Observação

A saída do vitest mostrou mensagens de i18n lint ("unknown scope nowhere", uma chave duplicada) vindas de testes do próprio lint, com a suíte verde. Não há falha.

## Resultado dos cenários

- Portões: tsc, vitest completo, theme-audit, i18n:lint, public-audit: passou (executado na sandbox) — tsc saiu 0; vitest: 546 arquivos passaram, 8944 testes passaram, 4 pulados; theme-audit, i18n:lint (0 problemas) e public-audit saíram 0.
- electron-vite build: passou (executado na sandbox) — Build concluído, saída 0.
- Critérios 2, 4, 5, 6, 7 e 8 (padrão desligado, recusas, auditoria, aviso): passou (executado na sandbox) — Cobertos pelos testes de migração, política, configScope, ponte, runner e interface, que passaram no conjunto completo com fakes. Os testes não foram relidos um a um. O aviso do editor não foi visto no app em execução.
- Critérios 1 e 3 com a conta real em claude.ai/code: não rodou (lido) — Exigem conta real e a página do claude.ai; esta etapa não usou nenhuma. Só os testes com fake rodaram. Não verificado.
- Critérios 9 e 10 (tela de sessões, escolha por execução): não rodou (lido) — O 9 está fora de escopo (depende da issue de sessões). O 10 só tem a função de resolução, sem escolha na interface.
