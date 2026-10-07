# O que a etapa de QA diz que rodou agora tem respaldo, e o que ela olhou não some

## O que esta etapa fez

O plano (`2_PLAN.md`) foi seguido nos cinco passos, com um teste para cada comportamento. O
trabalho já estava adiantado nesta cópia quando esta tentativa retomou; esta tentativa leu o
que havia, rodou as portas e fechou o que faltava — uma linha quebrada no `src/main/agents.ts`,
que voltou ao formato de duas linhas do original.

O que ficou de pé, por passo do plano:

1. **O registro da imagem olhada.** O caminho da imagem que o agente abre com `ViewImage` é
   anotado no único ponto comum às duas engines. A `lookAtImage` devolve `looked` (o arquivo
   real da pasta de saída, quando a imagem veio de lá; nenhum quando veio de um id de
   comprovação, que já está guardado), e os dois caminhos de ferramenta — o MCP do SDK e o
   `viewImageToolImpl` do motor aberto — chamam o `onLooked` do executor. O executor junta os
   caminhos num conjunto por tentativa e os guarda no fecho.
2. **A rodada de reparo.** Dentro do `try` de `runStage`, antes do `finally` que fecha a
   sandbox: a leitura da resposta, a conferência dos cenários e a rodada passam a rodar com a
   sessão ainda aberta. Se a conferência deixa um cenário sem respaldo (`unbacked`), o app
   escreve a linha `runner.qa.repair` e pede **uma** volta ao mesmo agente, na mesma sessão e
   no mesmo motor, com as mesmas ferramentas e a mesma sandbox, reusando o mesmo `AgentCall`
   (com `resume`). As duas chamadas ao motor correm dentro do mesmo trabalho vigiado pelo
   `watchdog`, então o teto de relógio da etapa conta a etapa uma vez. Uma segunda leva de sem
   respaldo não gera nova pergunta: cada cenário que continua sem respaldo vira `read` com
   `unbacked` e ganha a linha `runner.qa.unbacked` uma vez.
3. **A fonte única do que se publica.** Os cenários são conferidos uma vez e esse mesmo vetor
   alimenta o registro da QA, o `5_TEST_PLAN.md` gravado e o comentário. O documento passa por
   uma função pura, `testPlanWithResults`, que reescreve as linhas de cenário a partir do
   registro (resultado e como foi checado), mantém as outras seções como o agente as escreveu
   e roda antes do `tidyArtifact`; o comentário de QA tira as linhas de cenário que o próprio
   agente escreveu (`stripScenarioLines`) e acrescenta a seção de resultados vinda do registro,
   de modo que um cenário rebaixado nunca aparece como executado.
4. **A guarda automática no fecho.** Depois da resposta final e antes de a sandbox ser
   removida, o app percorre as imagens olhadas e guarda cada uma como comprovação da etapa pelo
   mesmo caminho de guarda de hoje (`putEvidence`, com o resolvedor de caminho e o teto), com
   um título que diz que foi guardada pelo app. O que não puder ser guardado vira a linha
   `runner.qa.lookNotKept` com o motivo; havendo o que guardar, sai uma linha `runner.qa.lookKept`
   com a contagem. Uma imagem já guardada não é guardada de novo.
5. **As correções de passagem e o changelog.** A regra `.coxia/rules/runner.md` que dizia que o
   app não confere a afirmação de um agente foi corrigida (a conferência estreita do respaldo
   de um cenário de QA já existia e agora é explícita), e a mudança entrou no `CHANGELOG.md`
   sob `## [Unreleased]`.

## O que foi verificado, e com que comando

Nesta cópia de trabalho, com o Node do `.nvmrc`:

- `npx tsc --noEmit` — sem saída, sem erro (depois da correção de formato desta tentativa).
- `npx vitest run` — 283 arquivos, 4390 testes, todos passando. Inclui os testes do assunto:
  `test/runner-qa-repair.test.ts` (8 testes novos), `test/runner-publish.test.ts`,
  `test/runner-agent-open.test.ts`, `test/runs-scenario.test.ts`, `test/runner-evidence.test.ts`
  e `test/i18n.test.ts`.
- `node scripts/theme-audit.mjs` — passa (só os 8 literais de `api.ts`, que já existiam).
- `npm run i18n:lint` — 4598 chaves nos dois idiomas, 0 problema.
- `node scripts/public-audit.mjs` — 1213 arquivos, nada que pertença a uma empresa ou a uma
  pessoa.

O que os testes cobrem, e que foi rodado: a rodada de reparo pede uma volta só e o comando que
o agente então aponta sustenta o cenário (nada é rebaixado); um cenário que volta sem respaldo
é gravado como `read` com `unbacked` e a conversa diz isso uma vez; uma etapa sem sandbox fica
como antes (nenhuma volta e tudo lido); o `5_TEST_PLAN.md` não chama de executado um cenário que
o registro tem como lido e marca um `not-run` como não rodado; uma imagem olhada e não guardada
termina como comprovação da etapa, com o título próprio, e o que sumiu antes do fecho vira
"visto, não guardado" com o motivo; uma segunda chamada ao motor continua a sessão da primeira
no motor que a abriu; e o comentário de QA com um cenário rebaixado nunca diz executado.

## O que não foi verificado

- Nada foi exercitado com modelo, host ou sandbox reais, nem nenhuma tela foi conduzida: a
  verificação é de leitura de código e de testes com os ajudantes de teste (motor e sandbox
  falsos, sem rede). O comportamento num run real não foi observado por esta etapa.
- O caso de uma imagem aberta **acima do teto** e de um arquivo que **não é imagem** termina
  como "visto, não guardado" nos testes pelo caminho do arquivo que sumiu; os dois caminhos
  de recusa por tipo e por tamanho vêm do mesmo `putEvidence` de hoje, mas não foram
  exercitados por um teste próprio nesta etapa.
- A regra `.coxia/rules/runner.md` foi corrigida por leitura; não há teste que a confira.
- Uma corrida completa da suíte, entre várias, terminou com 6 testes falhando em 1 arquivo; as
  corridas seguintes (duas completas e três vezes os arquivos do runner) passaram todas, e o
  arquivo da falha não foi identificado antes de a saída ser perdida. A falha não se reproduziu
  e não foi atribuída a esta mudança nem descartada; fica registrada como não explicada.

## O que ficou fora

- Os dois pontos de limpeza que o plano citava de passagem — um erro de digitação num
  comentário e um teto divergente num comentário de módulo — ficaram como estavam: o plano os
  enquadra como "ponto a limpar quando esta issue passar por ali", não como afirmação de que o
  comportamento está errado, e nenhum dos dois altera o comportamento desta mudança.
