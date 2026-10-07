# O que o agente guardou como comprovação e a marca na imagem

## O que esta entrega faz

Um agente que trabalha numa etapa com sandbox passa a ter três ferramentas novas. `SaveEvidence` lê
um arquivo que a própria etapa fez na pasta de saída dela, confere o tipo **pelo conteúdo** (nunca pelo
nome nem pela extensão), recusa o que passa do teto e recusa qualquer caminho que não esteja dentro da
pasta de saída, e guarda o arquivo como **anexo** de uma mensagem do agente na conversa da execução,
com um id `ev-<algarismos>`. `AnnotateImage` recebe uma comprovação de imagem (ou uma imagem da pasta de
saída) e uma lista de marcas e produz uma **imagem nova**, ligada à de origem, com a original guardada;
`ViewImage` deixa o agente olhar para a imagem produzida.

A comprovação fica nos dados do espaço de trabalho, junto da execução, e a escolha do espaço de trabalho
decide se uma cópia também vai para a pasta do ciclo e entra no commit da etapa. O cenário de QA passa a
poder citar ids de comprovação ao lado dos números de comando, a saída de etapa pode citá-los, e a tela
da execução lista, abre, baixa e apaga.

## O que mudou, por arquivo

- **Formas compartilhadas.** `src/shared/evidence.ts` (novo): o tipo de cada comprovação lido do
  conteúdo, a media type, a extensão com que é guardada, o teto (`EVIDENCE_MAX_BYTES`, 8 MiB), o id
  `ev-<algarismos>` (`EVIDENCE_ID`), o registro (`EvidenceRecord`) e o `EvidenceView`; as listas de
  marcas e de cores, a espessura com teto e a validação de uma marca contra o tamanho da imagem
  (`checkMark`/`checkMarks`). `src/shared/forum.ts` ganha `AttachmentRef` e o campo `attachments` em
  `ForumDraft`/`ForumMessage`; `src/main/forum-core.ts` limpa e grava a lista no esquema da mensagem.
- **A execução guarda os ids.** `src/shared/runs/types.ts` (novo `Run.evidence`, `Scenario.evidenceIds`,
  o tipo `RunEvidence`), `src/shared/runs/schema.ts` (o mapa `evidence` com `additionalProperties` do
  registro, o padrão de id, o teto de itens) e `src/shared/runs/output.ts` (`evidence` no `StageOutput`
  e no `outputSchema`, `readEvidenceIds`, `evidenceIds` no cenário). `src/shared/runs/transitions.ts`
  ganha `recordEvidence` e `deleteEvidence`.
- **A escolha do espaço de trabalho (config v13).** `src/shared/config/types.ts`
  (`EVIDENCE_PLACEMENTS`, `RunnerEvidence`, `runner.evidence?: RunnerEvidence`, `CONFIG_SCHEMA_VERSION =
  13`), `src/shared/config/schema.ts` (o enum), `src/shared/config/defaults.ts` (`evidence: 'app'`) e
  `src/shared/config/migrations.ts` (o passo `v12ToV13`, com a chave `12` em `STEPS`). Um arquivo
  guardado sem o campo lê como `'app'`. `src/main/configScope.ts` recusa o campo para o navegador
  pareado, como `runner.identity`; `src/renderer/src/screens/team/RunnerSection.tsx` e
  `runnerEdit.ts` mostram a escolha só no computador.
- **A base de anexos e o armazenamento.** `src/main/evidence/store.ts` (novo): o próximo id da execução,
  a cópia atômica para `<workspace data>/evidence/<runId>/<id>.<ext>` lida sem seguir link
  (`O_NOFOLLOW`), a leitura dos bytes, a remoção de uma comprovação, a remoção de tudo o que uma execução
  guardou e a cópia para a pasta do ciclo pelo mesmo guard dos documentos da etapa.
- **O conteúdo e a pasta de saída.** `src/main/evidence/type.ts` (novo): assinatura por conteúdo de PNG,
  JPEG, GIF, WebP, PDF e `text/plain`, e a recusa nomeada de vídeo, áudio, compactado, executável e de
  qualquer conteúdo que não confirme o declarado. `src/main/evidence/paths.ts` (novo): resolve o caminho
  que o modelo escreve (`/coxia/out/…`) para o `<stageDir>/out/…` do host, recusando caminho de fora,
  `..` e qualquer componente que seja link.
- **As três ferramentas.** `src/main/evidence/tool.ts` (nome, descrição em inglês, esquema),
  `src/main/evidence/handlers.ts` (o que cada uma faz e cada recusa em texto para o modelo) e
  `src/main/evidence/engineTool.ts` (as `ToolImpl` do motor aberto e o servidor MCP do Claude Agent
  SDK). `src/main/agents.ts`, `src/main/engine/contract.ts`, `src/main/engine/open/loop.ts`,
  `src/main/engine/open/tools/types.ts` e `src/main/sandbox/session.ts` levam as ferramentas e a
  imagem de volta ao modelo.
- **O desenho.** `src/main/evidence/png.ts` (novo): um codificador/decodificador PNG mínimo (8 bits,
  não entrelaçado, cinza, cinza+alfa, RGB e RGBA) sem dependência nova. `src/main/evidence/draw.ts`
  (novo): retângulo, seta, elipse, rótulo, marcador numerado e caixa de borrão desenhados sobre os
  pixels, com a original preservada.
- **O executor e o prompt.** `src/main/runner/executor.ts` oferece as ferramentas quando a etapa tem
  sandbox e o executor sabe onde a comprovação é guardada, registra cada comprovação na execução e na
  conversa, descarta um id que a etapa não guardou (dizendo na conversa) e, no modo "também na pasta do
  ciclo", copia cada comprovação para a pasta do ciclo antes do commit. `src/main/runner/prompt.ts`
  acrescenta a linha que diz como guardar e como citar.
- **Canais e telas.** `src/main/runner/module.ts` (`runs:evidenceList`, `runs:evidence`,
  `runs:evidenceDelete`), `src/renderer/src/screens/cycle/runsApi.ts` e
  `src/renderer/src/screens/cycle/Evidence.tsx` (novo: lista da etapa, anexo da conversa, citação do
  cenário, abrir, baixar, apagar), ligados em `RunScreen.tsx`, `Thread.tsx` e `ReviewRounds.tsx`.
- **Textos.** Chaves novas nos catálogos `ui-team` e `ui-cycle`, nos dois idiomas, usando `{crLong}`
  onde o texto fala do pedido de mudança; as recusas da ferramenta e os textos da conversa vão nos
  catálogos `main`.

## O que foi conferido nesta etapa

- **A suíte toda roda.** `npx vitest run` foi executado. Na primeira passada, sete testes falhavam; a
  causa e a correção de cada um estão abaixo. Depois das correções, os arquivos de teste desta mudança
  e os que ela toca passaram todos (`test/runner-evidence-run.test.ts`,
  `test/runner-evidence.test.ts`, `test/evidence-type.test.ts`, `test/evidence-path.test.ts`,
  `test/evidence-draw.test.ts`, `test/ui-i18n.test.ts`, `test/host-terms-leak.test.ts`,
  `test/runner-host-terms.test.ts`, `test/team-runner-edit.test.ts`). A última execução completa ficou
  em andamento quando o tempo desta etapa acabou; o resultado dela **não foi lido até o fim** e por isso
  não é afirmado aqui.
- **O typecheck passa:** `npx tsc --noEmit` foi executado sem erro depois das correções de tipo dos
  arquivos novos.
- **O que a leitura confirmou:** a pasta de saída é `<stageDir>/out` no host e `/coxia/out` dentro da
  sandbox (o módulo `paths.ts` não confunde as duas); o commit da etapa leva a cópia da pasta do ciclo
  porque o `commitAll` já pega a pasta nova; `checkFlow` não muda (a comprovação não entra em
  `produces`/`reads`).

### As falhas encontradas e o que foi feito

1. **`test/runner-evidence-run.test.ts` (3 testes).** A configuração do teste não punha o agente de QA
   em `shell: sandbox`, então a etapa não tinha sandbox nenhum e as ferramentas de comprovação nem
   eram oferecidas — o registro ficava vazio. Corrigido no próprio teste: a configuração passa
   `qa.shell = 'sandbox'`, como a equipe enviada recomenda. Os três passam.
2. **`test/ui-i18n.test.ts`.** As chaves novas não estavam na ordem alfabética que o teste exige, e a
   chave `ui.runner.evidence*` estava no lugar errado do catálogo. Os blocos foram reordenados nos
   quatro catálogos de tela.
3. **`test/host-terms-leak.test.ts` e `test/runner-host-terms.test.ts`.** Três textos novos escreviam
   "pull request" ao pé da letra, palavra de um host que o repositório não pode fixar num catálogo.
   Passaram a usar o marcador `{crLong}`, que o app preenche com o pedido de mudança do host em uso.
4. **`test/team-runner-edit.test.ts`.** O objeto de um runner configurado não incluía o campo novo
   `evidence`, e o vaivém do rascunho não batia. O teste passou a incluí-lo.

## O que esta entrega **não** fez

O plano previa dez passos de trabalho; o que está no worktree cobre os passos 1 a 8. **Faltam, e não
estão implementados:**

- **Passo 9 — levar a comprovação ao host de código.** A operação de upload não foi acrescentada ao
  `VcsWriteOp` nem aos `planWrite` de GitHub, GitLab e Bitbucket, e `src/main/runner/publish.ts` não
  embute comprovação nenhuma no corpo do comentário nem na descrição do `crLong`. Isto é o bloco 4 da
  issue e as regras 22 a 27 da especificação (o critério de aceite 3 e o 11). Nada disto foi
  verificado funcionando; não foi exercitado.
- **Passo 10 — documentação e changelog.** `docs/runner.md`, `docs/configuration.md` e o
  `## [Unreleased]` do `CHANGELOG.md` não mencionam a comprovação nem a escolha nova. Conferido por
  leitura: nenhuma menção existe nesses arquivos.

O resto do plano (as decodificações de imagem que não sejam PNG, por exemplo) é uma limitação
conhecida: `AnnotateImage` só decodifica PNG hoje; JPEG, GIF e WebP são aceitos como comprovação e
podem ser vistos e baixados, mas não marcados. Isso está dito como limitação, não como comportamento
pronto.

## Como foi conferido

Esta etapa rodou o typecheck e a suíte de testes e leu o código. O que está dito como existente foi
lido em arquivo desta cópia ou visto passar num teste; o que não foi exercitado está marcado como não
verificado, em especial todo o envio ao host de código, que não existe no código.
