# Revisão: a etapa de QA comprovando o que diz que rodou, e o que ela olhou sem sumir

## O que foi conferido, e como

Esta revisão leu o diff da branch, a issue, a spec (`1_SPEC.md`), o plano (`2_PLAN.md`) e
o documento da implementação (`3_IMPLEMENTATION.md`), e rodou as portas nesta cópia de trabalho.
Nenhum run real, nenhum modelo e nenhum host foram usados.

Rodado nesta cópia, com o Node do `.nvmrc`:

- `npx tsc --noEmit` — sem erro.
- `npx vitest run` — 283 arquivos, 4390 testes, todos passando. As portas de i18n que os
testes imprimem (uma string não traduzida e um escopo desconhecido) já existiam antes desta
mudança e não vieram dela.
- `npm run i18n:lint` — 4598 chaves nos dois idiomas, 0 problema.
- `node scripts/public-audit.mjs` — 1214 arquivos, nada que pertença a uma empresa ou a uma pessoa.
- Os testes do assunto, rodados isoladamente: `test/runner-qa-repair.test.ts` (8),
  `test/runner-publish.test.ts`, `test/runner-agent-open.test.ts`.

## O veredito

**changes.** Um achado bloqueante, sobre o caminho que guarda e publica uma imagem que o app
não conferiu; as demais são sugestões.

## O que a entrega cumpre

- A rodada de reparo vive dentro do `try` de `runStage`, antes do `finally` que fecha a sandbox
  (`src/main/runner/executor.ts:793-830`), com no máximo uma volta por tentativa; a leitura da
  resposta e a conferência dos cenários passaram para dentro do `try`, e o fecho da sessão
  continua acontecendo também no caminho de falha. As duas chamadas ao motor correm sob o mesmo
  `guard` do `watchdog` (`executor.ts:794` e `repairRound`, `executor.ts:483`), então o teto de
  relógio da etapa continua contando a etapa uma vez.
- A guarda automática roda depois da resposta final e antes do fecho (`executor.ts:817`), pelo
  mesmo caminho de guarda de hoje.
- O plano de teste é reescrito a partir do registro por `testPlanWithResults`
  (`src/shared/runs/testPlan.ts:51`) antes da normalização do cabeçalho (`executor.ts:857,863`),
  e o comentário de QA tira as linhas de cenário que o agente escreveu e acrescenta a seção de
  resultados vinda do registro (`src/main/runner/publish.ts:618-632`).
- O gancho da imagem está no ponto por onde as duas engines mostram imagem
  (`src/main/sandbox/tool.ts` via `src/main/sandbox/engineTool.ts:32,59`), e a rodada de reparo
  continua a sessão da primeira resposta no motor que a abriu (`src/main/agents.ts:1186,1223`).
- A regra `.coxia/rules/runner.md` foi corrigida e o `CHANGELOG.md` ganhou a linha sob
  `## [Unreleased]`.

## Achados

### Bloqueante

1. **A imagem olhada é guardada e publicada a partir de um caminho que o app não conferiu, e
   esse mesmo conteúdo vai para o comentário do host.** O gancho entrega a artefato o caminho
   devolvido por `lookAtImage` (`src/main/sandbox/tool.ts:127`), e a guarda chama
   `putEvidence` direto com esse caminho (`src/main/runner/executor.ts:618`). Diferente do
   caminho que guarda uma comprovação a pedido do agente, que passa por `resolveOutputPath`
   (`src/main/evidence/handlers.ts:70`), a guarda não confere que o caminho está na pasta de
   saída da etapa, não recusa link e não compara o caminho real com o da pasta. O caminho que
   chega ali tanto pode ser o que a sessão leu (o arquivo real) quanto o texto que o agente
   escreveu (a sessão de host devolve a fonte como caminho, e o `ImageRead` do caso de
   comprovação aponta para a evidência). O `putEvidence` lê o arquivo por `statSync` +
   `readFileSync`, que seguem link, e devolve um registro comum da execução — que é publicado
   na conversa e enviado ao código host quando alguém o cita (`publish.ts`, `uploadsOf`). A
   promessa de que nada fora da pasta de saída é lido (`2_PLAN.md`, seção 3, e o comentário do
   próprio arquivo) não se sustenta nesse caminho. Correção sugerida: conferir o caminho com o
   mesmo resolvedor de hoje (`resolveOutputPath(session.stageDir, path)`) e guardar só quando
   ele estiver dentro da pasta, sem link e ainda dentro depois do `realpath` — o que a guarda
   precisa é de um caminho confiável, não de uma leitura nova.

### Sugestões

2. **O caminho recusado é guardado como se fosse bom.** Quando `putEvidence` recusa, a guarda
   marca como guardado e conta os ids (`executor.ts:617-625`) antes de saber o resultado; a
   linha `runner.qa.lookKept` só é escrita quando alguma coisa foi guardada, mas `keptIds` e
   `keptRecords` já receberam a recusa. Ordem trocada depois do `if`, e o mesmo vale para a
   imagem que o agente guardou por conta própria, que entra no conjunto de caminhos olhados e
   depois é reconferida no fecho.

3. **A recusa por tipo e por tamanho não tem teste próprio.** O `3_IMPLEMENTATION.md` diz que
   os dois caminhos vêm do mesmo `putEvidence` de hoje mas não foram exercitados; o critério de
   aceitação pede que uma imagem acima do teto e um arquivo que não é imagem terminem como
   "visto, não guardado", e nenhum teste cobre isso.

4. **Nenhum teste cobre um cenário que continue executado depois da rodada.** O teste do plano
   de teste só olha um cenário rebaixado e um `not-run`; o critério 2 da aceitação (o agente
   guarda a comprovação e aponta o comando, e o plano e o comentário dizem o mesmo) fica sem
   cobertura.

5. **Nenhum teste cobre o motor que devolve resposta sem id de sessão.** O `answered` cai em
   `{ sessionId: null }` (`executor.ts:792,797`) e a rodada roda como chamada nova
   (`repairRound`, `executor.ts:480`): o agente perde o que leu e a rodada pode não trazer a
   comprovação.

6. **O contrato da rodada não diz o que acontece quando ela falha.** Em `repairRound`
   (`executor.ts:481-487`) qualquer erro é engolido e a resposta original fica; o caso do
   motor aberto é diferente (o teto de turnos sobe como falha da etapa), e a decisão não está
   escrita no plano nem na spec.

7. **Duas notas de rodapé de limpeza ficaram como estavam.** O erro de digitação no comentário
   do shell de host (`src/main/sandbox/host.ts:47`, "an artefato") e o teto divergente do
   comentário do módulo de comprovação (`src/main/evidence/store.ts:54-57`, que fala de um teto
   que não está em uso ali) — o plano os citava e não os tratava como comportamento errado.

8. **`.coxia/rules/releasing.md` e `.coxia/rules/model-providers.md` continuam marcadas contra
   código que esta branch mudou** (o `CHANGELOG.md` e `src/main/engine/contract.ts`); a
   conferida de cada arquivo precisa ser refeita, mesmo que nada no texto tenha ficado falso.

## O que esta revisão não fez

Não reproduziu o run real citado pela issue nem exercitou modelo, host ou sandbox; a verificação
é de leitura de código e de testes com os ajudantes falsos. Não julgou o caminho de uma
imagem acima do teto por execução, e nenhuma linha do diff fora dos arquivos citados foi
conferida linha a linha.
