# Revisão: a etapa de QA comprovando o que diz que rodou, e o que ela olhou sem sumir

## O que foi conferido, e como

Esta rodada leu o diff da branch contra a issue, a spec (`1_SPEC.md`), o plano
(`2_PLAN.md`) e o documento da implementação (`3_IMPLEMENTATION.md`), e conferiu o
bloqueante da rodada anterior contra o código desta cópia. Nenhum run real, nenhum modelo
e nenhum host foram usados; nenhuma tela foi conduzida.

O que se conferiu do bloqueante anterior, por leitura do código:

- A guarda do fecho passa o caminho que o gancho da imagem recebeu pelo mesmo resolvedor da
  pasta de saída antes de ler qualquer coisa (`src/main/runner/executor.ts:624`), e o
  caminho recusado vira a linha `runner.qa.lookNotKept` com o motivo (`executor.ts:625-628`).
  O texto da recusa é o mesmo que o modelo lê na ferramenta (`outputProblemText`/
  `evidenceProblemText`, exportados em `src/main/evidence/handlers.ts:34,50`).
- O id e o registro de uma peça só entram nas listas da etapa depois de a guarda dar certo
  (`executor.ts:635-639`), e o `keptNames` evita guardar duas vezes o mesmo arquivo, tanto
  pelo caminho do fecho (`executor.ts:621,639`) quanto pela ferramenta (`executor.ts:661`).
- O `looked` só sai para uma imagem de verdade (PNG, JPEG, GIF ou WebP, lido dos bytes),
  nunca de um id de comprovação (`src/main/evidence/handlers.ts:161`).
- Os testes acrescentados nesta rodada cobrem o link e o caminho fora da pasta
  (`test/runner-qa-repair.test.ts`, o caso novo) e o cenário que continua executado no
  registro, no plano gravado e no comentário (`test/runner-publish.test.ts`, o caso novo).

Nenhum comando foi rodado por esta etapa: as portas foram exercitadas pela implementação e o
que esta revisão afirma vem da leitura do código e dos testes nesta cópia. A corrida completa
da suíte depois destas mudanças não foi lida por esta etapa.

## O veredito

**changes.** Nada do bloqueante anterior permanece em aberto. O que bloqueia agora é uma regra
do `.coxia` que a própria branch alterou, ficou falsa contra o código que ela mesma mudou e
não foi corrigida.

## Achados

### Bloqueante

1. **`.coxia/rules/runner.md` afirma que o `5_TEST_PLAN.md` é gravado como o agente o
escreveu, e a branch mudou exatamente isso sem corrigir a regra.** O arquivo foi tocado pelo
commit desta branch que atualiza a conferência de documentação, e o parágrafo "What a QA
stage says it ran" também foi escrito nesta branch; a linha do `5_TEST_PLAN.md` ficou de fora.
A regra afirma que o resultado de um cenário é reescrito no documento a partir do registro,
mas não diz em lugar nenhum que o documento deixa de ser o texto integral do agente — e o
código de agora o reescreve: `testPlanWithResults` monta as linhas de cenário a partir do
registro (`src/shared/runs/testPlan.ts:51-63`) e o executor o aplica antes da normalização do
cabeçalho (`src/main/runner/executor.ts:873`). Quem seguir a regra vai supor que as demais
seções do plano, e a seção de cenários que o agente escreveu, chegam intactas ao arquivo; as
linhas de cenário do agente não chegam. É a mesma classe do bloqueante da rodada anterior, mas
sobre um arquivo de regra em vez do código: a entrega muda um comportamento e não ajusta o
texto que o descreve, e este é o arquivo que os agentes do app leem. O que falta é uma frase,
além da atualização do `checked-commit`/`checked-date` que o app escreve no commit.

### Sugestões

2. **`docs/runner.md` documenta a QA sem a rodada de reparo e sem a imagem guardada no
gancho.** O documento para pessoas não foi tocado por esta branch (o diff dele desde o ponto
de ramificação não tem nenhuma linha); ele segue dizendo que a QA que afirma execução sem
respaldo é apenas registrada como lida, num único "QA's evidence" bullet, e a função
`backEvidence` aparece como uma conferência só. Nada no texto dele ficou falso — o que ele
descreve continua acontecendo —, mas ele omite a volta que passou a existir e a guarda da
imagem olhada, e é o documento que a pessoa lê. Não é bloqueante porque nada dele leva a um
comando errado nem a um limite errado.

3. **`.coxia/rules/model-providers.md` e `.coxia/skills/add-a-model-provider.md` citam
`src/main/engine/contract.ts`, que a branch mudou, sem atualizar o cabeçalho.** A branch
acrescentou `EngineRequest.resume` e `EngineRequest.onLooked` ao arquivo. Lido contra o
código novo, o texto das duas regras continua verdadeiro: `resume` é a mesma costura que as
cerimônias já usavam e `onLooked` não muda o contrato que elas descrevem. Só o marcador ficou
atrás do código; a atualização é do app no commit.

4. **`.coxia/rules/runner.md` cita `src/main/runner/executor.ts`, que a branch mudou, e o
`checked-commit` do arquivo aponta para um commit que não contém esta mudança.** O cabeçalho
diz `checked-commit` na revisão da conferência; o executor mudou de novo depois dela (a
guarda do fecho). Nada do texto ficou falso por causa só dessa mudança além do achado 1,
que é o que bloqueia; este é o mesmo conserto de marcador.

5. **`.coxia/rules/releasing.md` cita `CHANGELOG.md`, que a branch mudou, sem atualizar o
cabeçalho.** A branch acrescentou a entrada sob `## [Unreleased]`. Lido contra ela, o texto
da regra continua verdadeiro ("A user-visible change gets a line under `## [Unreleased]`").
O marcador ficou atrás; a atualização é do app no commit.

6. **`.coxia/roles/customer-success.md` e `.coxia/roles/support.md` citam
`src/main/runner/publish.ts`, que a branch mudou, sem atualizar o cabeçalho.** O `publish.ts`
ganhou a reescrita das linhas de cenário do comentário de QA e a seção de resultados vinda do
registro (`src/main/runner/publish.ts:64-74,618-632`). Lido contra o código novo, o que as
duas notas de papel afirmam continua verdadeiro: a nota de lançamento diz o que mudou sem a
referência interna, o comentário sai pela mesma porta. Nada ficou falso; só o marcador.

7. **A regra do `.coxia` fala da rodada de reparo mas não do que acontece quando ela falha.**
As duas regras do produto (o `7_` da spec e o verbete do `.coxia`) dizem que a etapa pede uma
volta e que o cenário que continua sem respaldo é gravado como lido; não dizem que uma volta
que falha por dentro (tempo, passos, orçamento) é engolida e a primeira resposta é a que fica
(`repairRound`, `src/main/runner/executor.ts:485-488`). É a mesma decisão em aberto que a
rodada anterior deixou como sugestão, e ela não foi tomada; escrevê-la ou mudá-la é do
desenvolvimento, não de uma correção de texto.

## O que esta revisão não fez

Não reproduziu o run real citado pela issue, não exercitou modelo, host nem sandbox, e não
conduziu nenhuma tela. Não rodou a suíte completa nem as portas: o que está dito como
verificado vem da leitura do código e dos testes nesta cópia. Não conferi linha a linha o
diff fora dos arquivos citados, e não julguei por execução o caminho de uma imagem acima do
teto nem o de um arquivo que não é imagem.
