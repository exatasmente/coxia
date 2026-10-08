# Memória do ciclo

## Decisões

- Issue 141: pedido de funcionalidade. A memória das atividades deixou de ser por execução e passou a ser compartilhada, transversal a execuções, persistente entre reinícios e visível a um agente chamado fora daquela execução.
- Squad: plataforma. Comportamento em `1_SPEC.md` (15 regras, 5 critérios), desenho em `2_PLAN.md` (aprovado no Gate 2).
- **Implementado (passos 1 e 2 do plano):** módulo `src/main/runner/activities.ts` — o app projeta uma **frente por atividade** do estado que já guarda (`Run`), no arquivo `<workspace>/memory/activities.json` (`ATAS`), fora de todo worktree. Chave: `Run.issue.ref`, então duas execuções da mesma atividade são uma frente só.
- Escritor único: `RunForum.activities` (`runs-forum.ts`), chamado por `beginRun` e `moveRun`; upsert não lança para dentro do movimento (loga e engole) e o leitor reprojeta do store. Mescla por chave + escrita atômica.
- Criação interrompida (regra 8): `create()` chama `activities.ensure(...)` antes do worktree; frente `bare` nunca removida.
- Agente recebe **recorte renderizado**, nunca o índice: nomeado → frente inteira; agente nomeado → a frente dele + miniaturas; nada nomeado → uma linha por atividade em andamento; toda etapa → a frente própria inteira + resumo das outras. Seção entre `&lt;data>` com aviso de material, em `runner/prompt.ts`, `mentions/call.ts` e `runner.section.sharedMoved`. Nada entra em `allowedTools`/`extraDirs`/`roots`.
- Antigo: nada apagado; frente mais velha que `STALE_AFTER_MS` (30 dias) sai como provavelmente encerrada; resposta limitada por `SELECT_MAX` (2000) por chamada.
- Visível e corrigível sem modelo: canais `runs:activities`/`runs:activitySave` e uma seção na tela de execuções; correção mascarada, com teto, `source: 'person'`, preservada até a atividade andar de novo.
- `MEMORY.md` por execução não mudou; `STEPS` de migração não mudou; `AGENTS.md` não mudou. Docs: `docs/runner.md` (pt+en) e `CHANGELOG.md` (`## [Unreleased]`).
- **Revisão (passada anterior):** reprovada por dois bloqueantes — o aviso ao agente que trabalha injetado no texto antes de o `inbox.post` decidir, e a frase `update the cycle memory` movida para um argumento, reprovando o `i18n:lint`.
- **Revisão (esta passada): veredito aprovado.** Os dois bloqueantes conferidos por leitura e por comando: `service.ts:1275` põe a mensagem primeiro e o aviso num segundo `inbox.post` só quando `queued`; `service.ts:1161` traz a marca `i18n-ignore-next-line` e o `i18n:lint` volta a 0. Nada bloqueia a entrega.

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros (`example.com`, `group/project`, `#123`).
- Todo texto de interface passa por `t()` nos dois catálogos; nada de cor literal no renderer.
- Nenhum teste toca modelo, host de código ou rede reais; fakes em `test/helpers/`.
- Código, testes, identificadores e commits em inglês; comentários dizem por quê.
- Efeito externo só por `Actions`; esta mudança não cria caminho novo para o host.
- O harness de teste (`test/helpers/runner.ts`) não assina o fórum: para exercitar `onMessage` é preciso `b.forum.subscribe((m) => b.runner.onMessage(m))`, como o módulo do Electron faz.

## Tentado e descartado

- Arquivo único «das atividades, lido inteiro pela etapa»: contra o teto de contexto; descartado a favor do recorte por chamada.
- Índice no store de runs ou na pasta do ciclo: store é por execução; a pasta do ciclo está no worktree e iria ao pull request. Descartados.
- Ler a pasta do ciclo de outras execuções: proibido pelo confinamento de leitura. Descartado.
- Ferramenta de leitura do registro para o modelo: deixaria o modelo encher o próprio contexto sem o limite do app. Descartada; a seção é texto.
- `folded()`/`frontUpsertOf()` do plano não existem: o upsert no store fez o mesmo com um ponto único de escrita.
- Teste do `onClose` do sandbox para pegar a janela de fechamento: tarde demais, a caixa já foi fechada; foi preciso forçar `inboxOf(run.id).closing()` dentro do próprio agente.

## Perguntas abertas

- Escopo da primeira entrega: as frentes + miniaturas + tela foram entregues juntas. Se a resposta for «primeiro as frentes e a consulta», o que sai é o passo 2 fora de execução e o critério 1 não é cumprido.
- Crescimento: a resposta é limitada, o arquivo não; resumir o arquivo antigo é entrega própria.
- Onde a pessoa edita: a correção ficou na tela das execuções.
- Nota de lançamento: `CHANGELOG.md` escrito sob `## [Unreleased]`; o texto é confirmado antes de publicar.

## Onde o trabalho está

- Passos 1 e 2 do plano implementados e **aprovados** nesta revisão; o app faz o commit.
- **Gates rodados nesta passada (revisão):** `npx tsc --noEmit` passa; `npm run i18n:lint` passa (4647 chaves, 0 string) e a checagem por arquivo em `service.ts` dá 0; `node scripts/theme-audit.mjs` passa; `node scripts/public-audit.mjs` passa (1219 arquivos); `npx vitest run` deu 4374/4375, com a única falha em `test/voice-setup.test.ts` por o disco estar cheio (403 MB livres, abaixo da margem que o próprio app pede) — o arquivo falha igual rodado sozinho e a suíte tinha dado 4375/4375 minutos antes; os arquivos da mudança e vizinhos passam (48 casos).
- **Sugestões abertas (não bloqueiam):** (a) a mensagem da pessoa que já traz a frase do aviso recebe uma segunda cópia dela quando é entregue — a guarda que comparava as duas saiu com a nova ordem das chamadas (`service.ts:1276-1277`; a frase do próprio teste em `test/sharedMemoryRun.test.ts:121-122` serve de reprodutor); (b) a frente corrigida pela pessoa perde «onde o trabalho parou» e «o último recado»; (c) as miniaturas por agente seguem sem teste dedicado do corte.
- **Não verificado:** a tela aberta no app, o reinício de verdade, a conversa do QA do relato reproduzida à mão e o módulo de menções fora de execução rodando com um fórum real.
- Próximo passo: a aceitação (interface e reinício no app em execução).
- Passagem support → product-owner: Escrever a especificação do comportamento: qual estado é compartilhado entre atividades, quem o lê e quando, como ele é atualizado ao longo de uma execução, onde ele persiste entre reinícios, e como isso aparece no prompt de um agente chamado fora de uma etapa. Cobrir os quatro critérios de aceite da issue como cenários verificáveis. <!-- handoff:8 -->
- Passagem product-owner → pessoa: Escrever o plano técnico a partir de 1_SPEC.md: onde a memória compartilhada mora, como nasce e é mantida com uma frente por atividade, como o aplicativo a atualiza ao longo do ciclo sem que dois avanços se apaguem, e como ela entra no texto de um agente chamado em qualquer lugar. <!-- handoff:15 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md, começando pelo passo 1, com `test/activityIndex.test.ts`. Cada passo termina verde nos gates do CONTRIBUTING.md. Não mexer no `MEMORY.md` por execução nem no `STEPS` de migração. <!-- handoff:27 -->
- Passagem revisor-plataforma → developer: tratar os dois bloqueantes desta revisão (o aviso em `service.ts:1275` e a frase que reprova o `i18n:lint`), com teste que exercite a mensagem chegando quando a etapa fecha, e rodar os gates de novo. <!-- handoff:171 -->
- Passagem developer → revisor-plataforma: Passo 2 do plano (o registro chegar a uma chamada) já está feito nesta passada, junto do passo 1: a seção entra no prompt da etapa e de toda menção, e o aviso ao agente que trabalha existe. Falta do plano: (a) cobrir com teste dedicado as miniaturas por agente ("o que fulano está fazendo") e o caminho do módulo de menções fora de uma execução rodando com um fórum real; (b) a interface no app em execução (a seção da tela de execuções e a folha de edição) e o reinício de verdade, que só se conferem abrindo o app; (c) a nota de lançamento já está escrita em `## [Unreleased]` e o texto é confirmad… <!-- handoff:77 -->
- Passagem developer → revisor-plataforma: Revisar a nova passada contra a spec e o plano, com atenção aos dois pontos desta correção: (a) o aviso ao agente que trabalha agora é um segundo `inbox.post` só quando a mensagem entrou, e uma mensagem recusada volta só com as palavras da pessoa (`test/sharedMemoryRun.test.ts`, caso novo); (b) a linha de `service.ts:1161` voltou a passar no `i18n:lint` com a marca que as duas linhas irmãs já traziam. Rodar os gates e confirmar que a suíte inteira segue verde. O que a revisão anterior deixou como sugestão (miniaturas por agente sem caso dedicado do corte, o módulo de menções fora de uma execução com um fórum real, a tela e o reinício no app em execução) não foi trabalho desta passada e segue em aberto para a aceitação. <!-- handoff:285 -->
- Passagem revisor-plataforma → aceitação: entrega aprovada na revisão; o que resta é a interface no app em execução (a seção das atividades e a folha de edição), o reinício de verdade e o caminho do módulo de menções fora de uma execução com um fórum real. As três sugestões abertas (a segunda cópia do aviso numa mensagem que já o traz, a frente corrigida sem «onde parou», as miniaturas sem teste do corte) não bloqueiam a aceitação. <!-- handoff:286 -->
