# Memória do ciclo

## Decisões

- Issue 141: pedido de funcionalidade. A memória das atividades deixou de ser por execução e passou a ser compartilhada, transversal a execuções, persistente entre reinícios e visível a um agente chamado fora daquela execução.
- Squad: plataforma. Comportamento em `1_SPEC.md` (15 regras, 5 critérios), desenho em `2_PLAN.md` (aprovado no Gate 2).
- **Implementado (passos 1 e 2 do plano):** módulo `src/main/runner/activities.ts` — o app projeta uma **frente por atividade** do estado que já guarda (`Run`), no arquivo `<workspace>/memory/activities.json` (`ATAS`), fora de todo worktree. Chave: `Run.issue.ref`, então duas execuções da mesma atividade são uma frente só.
- Escritor único: `RunForum.activities` (`runs-forum.ts`), chamado por `beginRun` e `moveRun`; upsert não lança para dentro do movimento (loga e engole) e o leitor reprojeta do store. Mescla por chave + escrita atômica.
- Criação interrompida (regra 8): `create()` chama `activities.ensure(...)` antes do worktree; frente `bare` nunca removida.
- Agente recebe **recorte renderizado**, nunca o índice: nomeado → frente inteira; agente nomeado → a frente dele + miniaturas; nada nomeado → uma linha por atividade em andamento; toda etapa → a frente própria inteira + resumo das outras. Seção entre `<data>` com aviso de material, em `runner/prompt.ts`, `mentions/call.ts` e `runner.section.sharedMoved`. Nada entra em `allowedTools`/`extraDirs`/`roots`.
- Antigo: nada apagado; frente mais velha que `STALE_AFTER_MS` (30 dias) sai como provavelmente encerrada; resposta limitada por `SELECT_MAX` (2000) por chamada.
- Visível e corrigível sem modelo: canais `runs:activities`/`runs:activitySave` e uma seção na tela de execuções; correção mascarada, com teto, `source: 'person'`, preservada até a atividade andar de novo.
- `MEMORY.md` por execução não mudou; `STEPS` de migração não mudou; `AGENTS.md` não mudou. Docs: `docs/runner.md` (pt+en) e `CHANGELOG.md` (`## [Unreleased]`).
- **Revisão (esta passada):** entrega **reprovada** por dois bloqueantes — (1) `service.ts:1275`: o aviso ao agente que trabalha é injetado no texto antes de o `inbox.post` decidir, então uma mensagem que chega com a etapa fechando volta na linha de encerramento com a frase do registro colada; (2) o diff move a frase `update the cycle memory` para um argumento de `commitMessage`, e `npm run i18n:lint` passa de 0 para 1 string não traduzida, reprovando o gate. O resto confere: comportamento, testes, segurança e regras do repositório.

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros (`example.com`, `group/project`, `#123`).
- Todo texto de interface passa por `t()` nos dois catálogos; nada de cor literal no renderer.
- Nenhum teste toca modelo, host de código ou rede reais; fakes em `test/helpers/`.
- Código, testes, identificadores e commits em inglês; comentários dizem por quê.
- Efeito externo só por `Actions`; esta mudança não cria caminho novo para o host.

## Tentado e descartado

- Arquivo único «das atividades, lido inteiro pela etapa»: contra o teto de contexto; descartado a favor do recorte por chamada.
- Índice no store de runs ou na pasta do ciclo: store é por execução; a pasta do ciclo está no worktree e iria ao pull request. Descartados.
- Ler a pasta do ciclo de outras execuções: proibido pelo confinamento de leitura. Descartado.
- Ferramenta de leitura do registro para o modelo: deixaria o modelo encher o próprio contexto sem o limite do app. Descartada; a seção é texto.
- `folded()`/`frontUpsertOf()` do plano não existem: o upsert no store fez o mesmo com um ponto único de escrita.

## Perguntas abertas

- Escopo da primeira entrega: as frentes + miniaturas + tela foram entregues juntas. Se a resposta for «primeiro as frentes e a consulta», o que sai é o passo 2 fora de execução e o critério 1 não é cumprido.
- Crescimento: a resposta é limitada, o arquivo não; resumir o arquivo antigo é entrega própria.
- Onde a pessoa edita: a correção ficou na tela das execuções.
- Nota de lançamento: `CHANGELOG.md` escrito sob `## [Unreleased]`; o texto é confirmado antes de publicar.

## Onde o trabalho está

- Passos 1 e 2 do plano implementados; a revisão os reprovou por dois bloqueantes (aviso injetado antes da decisão do `post`; a frase movida que reprova o `i18n:lint`). Nada foi commitado por esta etapa; o app faz o commit.
- **Gates rodados nesta passada:** `npx tsc --noEmit` passa; `npx vitest run` 4374/4374 (291 arquivos); `node scripts/theme-audit.mjs` passa; `node scripts/public-audit.mjs` passa (1218 arquivos); `npm run i18n:lint` **reprova** (1 string não traduzida em `src/main/runner/service.ts:1161`).
- **Não verificado:** a tela aberta no app, o reinício de verdade, a conversa do QA do relato reproduzida à mão e o módulo de menções fora de execução rodando com um fórum real. As miniaturas por agente não têm teste dedicado do corte.
- Próximo passo: tratar os dois bloqueantes, rodar de novo os gates, e então a aceitação (interface e reinício no app em execução).
- Passagem support → product-owner: Escrever a especificação do comportamento: qual estado é compartilhado entre atividades, quem o lê e quando, como ele é atualizado ao longo de uma execução, onde ele persiste entre reinícios, e como isso aparece no prompt de um agente chamado fora de uma etapa. Cobrir os quatro critérios de aceite da issue como cenários verificáveis. <!-- handoff:8 -->
- Passagem product-owner → pessoa: Escrever o plano técnico a partir de 1_SPEC.md: onde a memória compartilhada mora, como nasce e é mantida com uma frente por atividade, como o aplicativo a atualiza ao longo do ciclo sem que dois avanços se apaguem, e como ela entra no texto de um agente chamado em qualquer lugar. <!-- handoff:15 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md, começando pelo passo 1, com `test/activityIndex.test.ts`. Cada passo termina verde nos gates do CONTRIBUTING.md. Não mexer no `MEMORY.md` por execução nem no `STEPS` de migração. <!-- handoff:27 -->
- Passagem revisor-plataforma → developer: tratar os dois bloqueantes desta revisão (o aviso em `service.ts:1275` e a frase que reprova o `i18n:lint`), com teste que exercite a mensagem chegando quando a etapa fecha, e rodar os gates de novo.
- Passagem developer → revisor-plataforma: Passo 2 do plano (o registro chegar a uma chamada) já está feito nesta passada, junto do passo 1: a seção entra no prompt da etapa e de toda menção, e o aviso ao agente que trabalha existe. Falta do plano: (a) cobrir com teste dedicado as miniaturas por agente ("o que fulano está fazendo") e o caminho do módulo de menções fora de uma execução rodando com um fórum real; (b) a interface no app em execução (a seção da tela de execuções e a folha de edição) e o reinício de verdade, que só se conferem abrindo o app; (c) a nota de lançamento já está escrita em `## [Unreleased]` e o texto é confirmad… <!-- handoff:77 -->
