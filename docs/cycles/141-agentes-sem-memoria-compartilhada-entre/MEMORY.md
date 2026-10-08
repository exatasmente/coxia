# Memória do ciclo

## Decisões

- Issue 141: pedido de funcionalidade. A memória das atividades deixou de ser por execução e passou a ser compartilhada, transversal a execuções, persistente entre reinícios e visível a um agente chamado fora daquela execução.
- Squad: plataforma. Comportamento em `1_SPEC.md` (15 regras, 5 critérios); desenho em `2_PLAN.md` (aprovado no Gate 2); os passos 1 e 2 implementados e aprovados na revisão.
- **Implementado (passos 1 e 2 do plano):** `src/main/runner/activities.ts` projeta **uma frente por atividade** do estado que o app já guarda (`Run`), em `<workspace>/memory/activities.json`, fora de todo worktree. Chave: `Run.issue.ref`; duas execuções da mesma atividade são uma frente só. Escritor único: `RunForum.activities`, chamado por `beginRun`/`moveRun`; upsert não lança para dentro do movimento; o leitor reprojeta do store.
- Agente recebe **recorte renderizado**, nunca o índice: nomeado → frente inteira; agente nomeado → a frente dele + miniaturas; nada nomeado → uma linha por atividade em andamento; toda etapa → a frente própria inteira + resumo das outras. Seção entre marcas de material em `runner/prompt.ts`, `mentions/call.ts` e `runner.section.sharedMoved`. Nada entra em `allowedTools`/`extraDirs`/`roots`.
- Visível e corrigível sem modelo: canais `runs:activities`/`runs:activitySave` e uma seção na tela de execuções; correção mascarada, com teto, `source: 'person'`, registrada até a atividade andar de novo.
- `MEMORY.md` por execução não mudou; `STEPS` de migração não mudou; `AGENTS.md` não mudou. Docs: `docs/runner.md` (pt+en) e `CHANGELOG.md` (`## [Unreleased]`).
- **Revisão: aprovado.** Os dois bloqueantes (aviso ao agente só quando a mensagem entra; `i18n-ignore-next-line` na linha que reprovava o `i18n:lint`) foram tratados e conferidos.
- **QA:** plano de testes em `5_TEST_PLAN.md`, 8 cenários. Os 5 critérios da especificação exercitados; a tela conferida no app em execução; o reinício conferido de verdade (processo encerrado e reaberto sobre a mesma pasta).

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros (`example.com`, `group/project`, `#123`).
- Todo texto de interface passa por `t()` nos dois catálogos; nada de cor literal no renderer.
- Nenhum teste toca modelo, host de código ou rede reais; fakes em `test/helpers/`.
- Código, testes, identificadores e commits em inglês; comentários dizem por quê.
- Efeito externo só por `Actions`; esta mudança não cria caminho novo para o host.
- Neste checkout `node_modules` é somente leitura: a suíte e as sondas só rodam com um arquivo de configuração próprio (cache fora do repositório). Isso é do ambiente, não do produto.
- O harness de teste não assina o fórum: para exercitar `onMessage` é preciso wire `b.forum.subscribe((m) => b.runner.onMessage(m))`, como o módulo do Electron faz. `drive(flow, input)` recebe o fluxo primeiro: pasar a entrada no primeiro argumento dá « ciclo sem etapas».

## Tentado e descartado

- Arquivo único «das atividades» lido inteiro pela etapa: viola o teto de contexto; descartado a favor do recorte por chamada.
- Índice no store de runs ou na pasta do ciclo: store é por execução; a pasta do ciclo está no worktree e iria ao pull request. Descartados.
- Ler a pasta do ciclo de outras execuções: proibido pelo confinamento de leitura. Descartado.
- Ferramenta de leitura do registro para o modelo: deixaria o modelo encher o próprio contexto sem o limite do app. Descartada; a seção é texto.
- `folded()`/`frontUpsertOf()` do plano não existem: o upsert no store fez o mesmo com um ponto único de escrita.
- Teste do `onClose` do sandbox para pegar a janela de fechamento: tarde demais, a caixa já foi fechada; foi preciso forçar `inboxOf(run.id).closing()` dentro do próprio agente.
- Sondas da QA vivem em `/coxia/out` e rodam pelo helper do repositório; nenhuma fica na worktree (e elas não sobrevivem à pasta de saída: cada retomada as reconstrói).

## Perguntas abertas

- Crescimento: a resposta é limitada, o arquivo não; resumir o arquivo antigo é entrega própria.
- Nota de lançamento: `CHANGELOG.md` escrito sob `## [Unreleased]`; o texto é confirmado antes de publicar.
- **Sugestões da revisão, reproduzidas por comando na 6ª tentativa (não bloqueiam):** (a) a mensagem da pessoa que já traz a frase do aviso recebe uma segunda cópia — a caixa entrega as palavras da pessoa com a frase uma vez e, logo depois, a mesma frase sozinha; (b) a frente corrigida, quando a atividade anda de novo, perde «onde parou», «o último recado» e **também o texto da pessoa inteiro** (`stoppedAt`/`lastHandoff`/`decisions`/`correction` todos vazios na reprojeção — mais forte do que a revisão registrou); (c) o corte das miniaturas por agente foi exercitado por sonda dedicada: nomear «planner» traz só a frente do planejador; o casamento é por `agent` e `lastAgent`, e a miniatura sai como linha ao lado das frentes.

## Onde o trabalho está

- Passos 1 e 2 do plano implementados, revisão aprovada e QA concluída; os cinco critérios de aceite sem falha conhecida. O app faz o commit.
- **Retomada da QA (6ª tentativa, conferida):** os três cenários de observação, que ficavam como lido, foram reproduzidos por comando (sondas em `/coxia/out`; resíduos `vitest.min.mjs`, `vitest.qa.config.ts` e `out/` apagados da raiz do worktree). O cenário 2 re-rodado com a sonda de reinício (segunda bota lê a mesma etapa, instante e id de execução, arquivo intacto). Suíte da mudança 23/23 (3 arquivos: `sharedMemoryRun` 5, `sharedMemoryCall` 4, `activityIndex` 14; o caso de `sharedMemoryFiles` vive dentro do primeiro) e `tsc`, `public-audit` (1222), `i18n:lint` re-rodados, verdes. `5_TEST_PLAN.md` atualizado com os ids vivos (ev-3 a ev-6).
- **Não verificado:** um app aberto com modelo real respondendo; dois agentes em paralelo num fórum real; o módulo de menções fora de fórum real; a tela e o reinício do Electron no app em execução nesta retomada (ev-1, tentativa anterior); a suíte inteira verde (a falha de `voice-setup` é do disco).
- Próximo passo: decidir as três sugestões da revisão — resolver (a) o aviso duplicado, (b) a frente corrigida que perde os campos e o texto da pessoa ao andar de novo, e (c) virar a sonda do corte das miniaturas em teste do repositório — ou aceitá-las como estão.
- Passagem support → product-owner: Escrever a especificação do comportamento: qual estado é compartilhado entre atividades, quem o lê e quando, como ele é atualizado ao longo de uma execução, onde ele persiste entre reinícios, e como isso aparece no prompt de um agente chamado fora de uma etapa. <!-- handoff:8 -->
- Passagem product-owner → pessoa: Escrever o plano técnico a partir de 1_SPEC.md: onde a memória compartilhada mora, como nasce e é mantida com uma frente por atividade, como o aplicativo a atualiza ao longo do ciclo sem que dois avanços se apaguem, e como ela entra no texto de um agente chamado em qualquer lugar. <!-- handoff:15 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md, começando pelo passo 1, com `test/activityIndex.test.ts`. Cada passo termina verde nos gates do CONTRIBUTING.md. Não mexer no `MEMORY.md` por execução nem no `STEPS` de migração. <!-- handoff:27 -->
- Passagem revisor-plataforma → developer: tratar os dois bloqueantes desta revisão (o aviso em `service.ts:1275` e a frase que reprova o `i18n:lint`), com teste que exercite a mensagem chegando quando a etapa fecha, e rodar os gates de novo. <!-- handoff:171 -->
- Passagem developer → revisor-plataforma: Passo 2 do plano já feito nesta passada junto do passo 1: a seção entra no prompt da etapa e de toda menção, e o aviso ao agente que trabalha existe. <!-- handoff:77 -->
- Passagem revisor-plataforma → developer: Revisar a nova passada contra a spec e o plano, com atenção aos dois pontos desta correção. <!-- handoff:285 -->
- Passagem revisor-plataforma → aceitação: entrega aprovada na revisão; o que resta é a interface no app em execução, o reinício de verdade e o caminho do módulo de menções fora de uma execução com um fórum real. <!-- handoff:286 -->
- Passagem revisor-plataforma → qa-plataforma-2: entrega aprovada; os dois bloqueantes tratados; as sugestões seguem sem bloquear. <!-- handoff:351 -->
