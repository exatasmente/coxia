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
- **Revisão (passada anterior):** entrega reprovada por dois bloqueantes — (1) o aviso ao agente que trabalha injetado no texto antes de o `inbox.post` decidir; (2) a frase `update the cycle memory` movida para um argumento, reprovando o `i18n:lint`.
- **Esta passada (developer):** os dois bloqueantes tratados. (1) `service.ts:1275`: a mensagem entra primeiro (`inbox.post(text, …)`); o aviso vira um segundo `inbox.post` do `runner.section.sharedMoved`, só quando `queued` é true — uma mensagem recusada volta na linha de encerramento só com as palavras da pessoa. (2) `service.ts:1161`: a linha do commit ganhou `// i18n-ignore-next-line` (a mesma marca das duas linhas irmãs); `npm run i18n:lint` volta a 0. Teste novo em `test/sharedMemoryRun.test.ts` prende o conserto (passa com ele, falha contra o código anterior).

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

- Passos 1 e 2 do plano implementados; os dois bloqueantes da revisão tratados nesta passada, com teste que prende o conserto. Nada foi commitado por esta etapa; o app faz o commit.
- **Gates rodados nesta passada:** `npx tsc --noEmit` passa; `npx vitest run` 4375/4375 (291 arquivos); `npm run i18n:lint` passa (4647 chaves, 0 string); `node scripts/theme-audit.mjs` passa; `node scripts/public-audit.mjs` passa (1219 arquivos). O caso novo também rodou contra o código anterior: falha.
- **Não verificado:** a tela aberta no app, o reinício de verdade, a conversa do QA do relato reproduzida à mão e o módulo de menções fora de execução rodando com um fórum real. As miniaturas por agente não têm teste dedicado do corte.
- Próximo passo: a aceitação (interface e reinício no app em execução).
- Passagem support → product-owner: Escrever a especificação do comportamento: qual estado é compartilhado entre atividades, quem o lê e quando, como ele é atualizado ao longo de uma execução, onde ele persiste entre reinícios, e como isso aparece no prompt de um agente chamado fora de uma etapa. Cobrir os quatro critérios de aceite da issue como cenários verificáveis. <!-- handoff:8 -->
- Passagem product-owner → pessoa: Escrever o plano técnico a partir de 1_SPEC.md: onde a memória compartilhada mora, como nasce e é mantida com uma frente por atividade, como o aplicativo a atualiza ao longo do ciclo sem que dois avanços se apaguem, e como ela entra no texto de um agente chamado em qualquer lugar. <!-- handoff:15 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md, começando pelo passo 1, com `test/activityIndex.test.ts`. Cada passo termina verde nos gates do CONTRIBUTING.md. Não mexer no `MEMORY.md` por execução nem no `STEPS` de migração. <!-- handoff:27 -->
- Passagem revisor-plataforma → developer: tratar os dois bloqueantes desta revisão (o aviso em `service.ts:1275` e a frase que reprova o `i18n:lint`), com teste que exercite a mensagem chegando quando a etapa fecha, e rodar os gates de novo. <!-- handoff:171 -->
- Passagem developer → revisor-plataforma: Passo 2 do plano (o registro chegar a uma chamada) já está feito nesta passada, junto do passo 1: a seção entra no prompt da etapa e de toda menção, e o aviso ao agente que trabalha existe. Falta do plano: (a) cobrir com teste dedicado as miniaturas por agente ("o que fulano está fazendo") e o caminho do módulo de menções fora de uma execução rodando com um fórum real; (b) a interface no app em execução (a seção da tela de execuções e a folha de edição) e o reinício de verdade, que só se conferem abrindo o app; (c) a nota de lançamento já está escrita em `## [Unreleased]` e o texto é confirmad… <!-- handoff:77 -->
