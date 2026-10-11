# Revisão do registro de passos autônomos

Veredito: **aprovado**. Nenhum achado bloqueante.

## O que foi conferido (leitura do diff, dos documentos e de trechos do código)

- Critério 1 (passo com hora, agente, política e nível): comando no host (`executor.ts` `hostApproval`, uma linha por comando, comando mascarado), portão aprovado pelo app e início de etapa (`service.ts`), push, pull request e quadro (campo `policy` passado por `publish.ts`, `door.ts`, `actions.ts`, `boardHost.ts`). Lido; testes correspondentes presentes no diff.
- Critério 2 (decisões): `approveAction` grava `decision` aprovada antes da escrita, `skipAction` grava recusada só se o passo ainda esperava; comando no host e portão decididos pela pessoa também gravam. A ordem antes-da-escrita foi aceita: a escrita grava a própria linha, ligada pelo `actionId`.
- Critério 3: só existe o canal `auditoria:list` (somente leitura); a persona não tem caminho de escrita/remoção; a cadeia de hash (`chain`) e a marca `tampered` detectam linha editada, removida ou forjada; `recordWrite` não aceita `chain` nem `tampered` do chamador. Limite aceito e declarado: agente `shell: host` roda como a pessoa e pode editar o arquivo; só há detecção.
- Critério 4: `saveConfig` grava uma linha `policy-change` por escolha alterada (workspace e fluxo), sem gravar na primeira carga. Critério 5: `level` workspace/flow isolado em `levelOf`, testado.
- Critérios 6 e 7: os dois catálogos têm as mesmas chaves novas, texto do pull request usa `{crLong}`, CHANGELOG `Unreleased` atualizado. Nenhum dado real, host ou número de issue real no diff visto.
- As três diferenças do plano (decisão antes da escrita, início de etapa por interruptor do agente, mentions sem `policy`) são coerentes com a regra 6 e com a decisão 3 do plano.

## Sugestões (não bloqueiam)

1. `service.ts` `setSquadAutonomous`/`setAutonomous`: mudar o interruptor de autonomia de um squad ou de um agente passa por `updateConfig`, mas `policyChanges` só compara `runner.autonomy` e `devCycle.autonomy`; essas mudanças não deixam linha. A regra 4 diz "qualquer nível"; vale cobrir quando a #269 definir os níveis agente/squad.
2. `service.ts` `setSquadAutonomous`/`setAutonomous` não informam `by`; se a persona puder chamá-los, a linha sairia como `person`. Passar a origem quando houver o caminho da persona.
3. `lastChain` lê 64 KB do fim a cada gravação; aceitável, mas se uma linha passar disso a cadeia recomeça em vazio e a linha seguinte pode ser marcada. Os campos são cortados, então é improvável.

## Não verificado

- Não rodei `tsc`, vitest, `electron-vite build` nem as auditorias nesta etapa; os resultados citados vêm de 3_IMPLEMENTATION.md. A suíte completa não foi rodada de novo após as duas últimas correções, os 4 testes de navegador dependem de `@playwright/mcp` e o `electron-vite build` não foi rodado.
- A tela do log não foi aberta no app.
- O diff chegou cortado depois de `conflict-resolve.test.ts`; os demais testes ajustados (`release-actions`, `runner-release`, `vcs-writes`, `runner-host-shell`, `runner-publish`) foram lidos só pela descrição.
- A lista de passos autônomos não foi conferida contra o texto completo do product owner (truncado).
