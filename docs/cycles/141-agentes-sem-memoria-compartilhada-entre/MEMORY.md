# Memória do ciclo

## Decisões

- Issue 141: pedido de funcionalidade. A memória das atividades deixou de ser por execução e passou a ser compartilhada, transversal a execuções, persistente entre reinícios e visível a um agente chamado fora daquela execução.
- Squad: plataforma. Comportamento em `1_SPEC.md` (15 regras, 5 critérios), desenho em `2_PLAN.md` (aprovado no Gate 2).
- **Implementado (passos 1 e 2 do plano):** módulo `src/main/runner/activities.ts` — o app projeta uma **frente por atividade** do estado que já guarda (`Run`), no arquivo `<workspace>/memory/activities.json` (pasta do espaço de trabalho, `env.ts`/`ATAS`), fora de todo worktree. Chave: `Run.issue.ref` (`release:X.Y.Z`, `docs:<repo>`), então duas execuções da mesma atividade são uma frente só.
- Escritor único: `RunForum.activities` (`runs-forum.ts`), chamado por `beginRun` e `moveRun` — todo movimento de execução passa por aí, então os pontos da regra 3 ficam cobertos num ponto só. Upsert não lança para dentro do movimento (loga e engole); o leitor reprojeta do store. Um escritor + mescla por chave + escrita atômica.
- Criação interrompida (regra 8): `create()` chama `activities.ensure(...)` antes do worktree; frente `bare` = "conhecida, nunca iniciada", nunca removida.
- Agente recebe **recorte renderizado**, nunca o índice: nomeado (ref/número) → frente inteira; agente nomeado → a frente dele + miniaturas; nada nomeado → uma linha por atividade em andamento; toda etapa → a frente própria inteira + resumo das outras. Seção própria entre `<data>` com aviso de material (não instrução), em `runner/prompt.ts` (etapas), `mentions/call.ts` (todas as menções) e um aviso `runner.section.sharedMoved` ao agente que trabalha e recebe mensagem. Nada entra em `allowedTools`/`extraDirs`/`roots`: a única saída é texto no prompt.
- Antigo: nada apagado; frente mais velha que `STALE_AFTER_MS` (30 dias) sai como provavelmente encerrada; resposta limitada por `SELECT_MAX` (2000) por chamada, o que não couber é nomeado numa linha.
- Visível e corrigível sem modelo: canais `runs:activities`/`runs:activitySave` e uma seção na tela de execuções. Correção mascarada, com teto, `source: 'person'`, preservada até a atividade andar de novo; sem recusa `memory-busy`.
- `MEMORY.md` por execução **não mudou**; `STEPS` de migração **não mudou** (nenhum campo de config); `AGENTS.md` não mudou. Docs: `docs/runner.md` (seção do registro, pt+en) e `CHANGELOG.md` (`## [Unreleased]`).

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros (`example.com`, `group/project`, `#123`).
- Todo texto de interface passa por `t()` nos dois catálogos; nada de cor literal no renderer.
- Nenhum teste toca modelo, host de código ou rede reais; fakes em `test/helpers/`.
- Código, testes, identificadores e commits em inglês; comentários dizem por quê.
- Efeito externo só por `Actions`; esta mudança não cria caminho novo para o host.

## Tentado e descartado

- Arquivo único "das atividades, lido inteiro pela etapa": a etapa receberia o estado de todas as atividades, contra o teto de contexto; descartado a favor do recorte por chamada.
- Índice no store de runs ou na pasta do ciclo: store é por execução; a pasta do ciclo está no worktree e iria ao pull request. Descartados.
- Ler a pasta do ciclo de outras execuções: proibido pelo confinamento de leitura. Descartado; a frente é montada do arquivo de run.
- Ferramenta de leitura do registro para o modelo: deixaria o modelo encher o próprio contexto sem o limite do app. Descartada; a seção é texto.
- `folded()`/`frontUpsertOf()` do plano não existem: o upsert no store fez o mesmo com um ponto único de escrita.

## Perguntas abertas

- Escopo da primeira entrega: as frentes + miniaturas + tela foram entregues juntas. Se a resposta for "primeiro as frentes e a consulta", o que sai é o passo 2 fora de execução e o critério 1 não é cumprido.
- Crescimento: a resposta é limitada, o arquivo não; resumir o arquivo antigo é entrega própria.
- Onde a pessoa edita: a correção ficou na tela das execuções.
- Nota de lançamento: `CHANGELOG.md` escrito sob `## [Unreleased]`; o texto é confirmado antes de publicar.

## Onde o trabalho está

- Passos 1 e 2 do plano **implementados e verificados**: `src/main/runner/activities.ts`, o escritor em `runs-forum.ts`, a seção em `runner/prompt.ts` e `mentions/call.ts` (ligada em `runner/service.ts` e `mentions/module.ts`), os canais `runs:activities`/`runs:activitySave`, a seção em `RunsScreen.tsx`, os catálogos e `docs/runner.md`. Testes novos: `test/activityIndex.test.ts`, `test/sharedMemoryCall.test.ts`, `test/sharedMemoryRun.test.ts`.
- **Gates rodados e verdes:** `npx tsc --noEmit`; `npx vitest run` 4374/4374 (291 arquivos); `node scripts/theme-audit.mjs`, `npm run i18n:lint` (4647 chaves), `node scripts/public-audit.mjs` (1218 arquivos). (Arquivos de teste de sandbox/conflito falham de forma intermitente sob paralelismo; passam em isolamento, anterior a esta mudança.)
- **Não verificado:** a tela aberta no app, o reinício de verdade, a conversa do QA do relato reproduzida à mão e o módulo de menções fora de execução rodando com um fórum real. As miniaturas por agente entram no arquivo e no prompt, mas não têm teste dedicado do corte.
- Próximo passo natural: a interface e o reinício no app em execução (aceitação), e a nota de lançamento publicada. Nada foi commitado por esta etapa; o app faz o commit.
- Passagem support → product-owner: Escrever a especificação do comportamento: qual estado é compartilhado entre atividades, quem o lê e quando, como ele é atualizado ao longo de uma execução, onde ele persiste entre reinícios, e como isso aparece no prompt de um agente chamado fora de uma etapa. Cobrir os quatro critérios de aceite da issue como cenários verificáveis, incluindo o caso do agente de QA que respondeu não haver teste em andamento. Não decidir armazenamento nem formato agora além do que o comportamento exige. <!-- handoff:8 -->
- Passagem product-owner → pessoa: Escrever o plano técnico a partir de 1_SPEC.md: onde a memória compartilhada mora (fora do worktree, no que é do aplicativo naquele computador) e como é migrada do que existe hoje; como nasce e é mantida com uma frente por atividade; como o aplicativo a atualiza nos pontos da regra 3 (início da execução, entrada e saída de etapa, resposta da pessoa, recado para a próxima etapa, pergunta, cancelamento) sem que dois avanços simultâneos se apaguem; como ela entra no texto de um agente chamado em qualquer lugar (conversa de execução, canal de squad, conversa geral, conversa direta), com consulta p… <!-- handoff:15 -->
- Passagem tl-plataforma → pessoa: Implementar o 2_PLAN.md, começando pelo passo 1 (módulo `src/main/runner/activities.ts`, o store em `<workspace>/memory/activities.json`, o leitor que reprojeta do store de runs e o upsert a partir de `move()`/`moveRun` em `src/main/runner/service.ts`), com `test/activityIndex.test.ts`. Cada passo tem de terminar verde nos gates do CONTRIBUTING.md. Se a pessoa responder às perguntas abertas antes disso, a 1 (escopo) muda o passo 2 e a 3 (onde a pessoa edita) muda a tela do passo 3; a 4 (nota de lançamento) muda só o passo 4. Não mexer no `MEMORY.md` por execução nem no `STEPS` de migração de c… <!-- handoff:27 -->
