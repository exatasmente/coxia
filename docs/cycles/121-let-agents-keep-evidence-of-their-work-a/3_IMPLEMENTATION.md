# A imagem da comprovação sobe junto com a escrita que a cita, e os consertos da revisão

## O que esta entrega faz

Um agente que trabalha numa etapa com sandbox guarda um arquivo que ele mesmo fez na pasta de saída como
**comprovação** da etapa; a comprovação é publicada na conversa da execução como anexo de uma mensagem e
listada sob a etapa, com um id `ev-<algarismos>`. Uma imagem pode ser marcada e olhada de novo. A escolha do
espaço de trabalho decide se uma cópia também vai para a pasta do ciclo e entra no commit da etapa. Quando um
comentário de etapa ou a descrição do pull request cita uma comprovação, a imagem é enviada ao host e sai
embutida no texto.

Esta tentativa fecha o **bloqueante da revisão** — o envio da imagem saía pela via automática **antes** de
qualquer "sim" — e o menor do comentário duplicado. Nada mais foi mudado: o escopo é o que a revisão apontou.

### O bloqueante: a imagem sobe com a escrita, não antes dela

Antes, a imagem citada era enviada no instante em que o comentário era montado, pela via auditada das
escritas que saem sozinhas, **antes** de a proposta do comentário ser criada. Num agente que espera, a pessoa
via a proposta e a imagem já estava no host; na descrição do pull request, a imagem subia quando o push era
proposto, enquanto o pull request ainda esperava. A trava "a pessoa vê cada imagem antes de um sim" não se
cumpria.

Agora o envio é **parte do mesmo grupo de comandos** que o "sim" libera:

- **Comentário de etapa.** O publicador planeja as comprovações citadas como os **primeiros comandos** do
  grupo do comentário (`planEvidence`); o comentário propriamente dito é o último comando. Nada é postado até
  o "sim", e o corpo guardado na proposta não carrega endereço nenhum: a proposta nunca guarda o que ainda não
  existe. Quando o "sim" chega, o grupo roda em ordem e, imediatamente **antes** de o comentário rodar, o
  endereço que cada upload respondeu é embutido sob o texto (`withEvidenceEmbeds`, em `actions.ts`). A
  posição de cada upload no grupo e o índice do comando do comentário viajam na proposta
  (`ReleaseAction.evidence`), não numa credencial.
- **Agente autônomo.** Não há "sim": os uploads sobem numa chamada auditada e o comentário, já com as imagens
  embutidas, na chamada seguinte; as duas sob a autonomia do agente, cada uma com a sua linha no registro de
  auditoria.
- **Descrição do pull request.** Como o push e o pull request sempre esperam, os ids citados são guardados no
  rascunho da descrição (`CommentRecord.evidenceIds`) e as imagens entram no **mesmo grupo** da proposta do
  pull request (`createMr`); os endereços são embutidos quando a proposta é confirmada.
- **Onde o host não aceita o arquivo.** Uma comprovação que o provedor não planeja (ou que o host responde sem
  endereço) continua contada no texto pelo número de peças que ficam no app: a publicação não quebra nem some
  com a informação.

### O menor da revisão

- **`src/main/evidence/paths.ts:58-61`** — o comentário duplicado sobre o vínculo saiu.

## O que mudou, por arquivo

- **`src/main/runner/publish.ts`** — `withEvidence` (que subia a imagem na hora de montar o comentário) vira
  `planEvidence`: ela lê os bytes, escreve cada um numa pasta descartável e **descreve** o upload como comando,
  sem rodar nada. `evidenceBody` monta o corpo final a partir dos endereços que o grupo respondeu. O
  `deliver` põe os comandos de upload antes do comentário e, no ramo autônomo, sobe os arquivos numa chamada e
  o comentário na seguinte, com as imagens embutidas. `pushStage` deixa de enviar a imagem: guarda os ids
  citados no rascunho da descrição. `pullRequest` planeja as comprovações citadas como o começo do grupo da
  proposta do pull request; `pullRequestOpened` embute os endereços quando o "sim" roda. O tratador `done`
  reconstrói o corpo com os endereços das respostas do grupo.
- **`src/main/actions.ts`** — `proposeVcsAction`/`proposeVcsGroup` aceitam e guardam `evidence` (os títulos, as
  posições no grupo e o índice do comando do corpo). `approveAction`, ao rodar um grupo, lembra o endereço que
  cada upload respondeu e o embute no corpo do comando do comentário **antes** de ele rodar
  (`withEvidenceEmbeds`); `embedUrlOfResponse` lê o endereço que cada host devolve. O cabeçalho com o token
  continua preenchido na hora de rodar (`withUploadHeaders`), nunca guardado na proposta.
- **`src/main/runner/door.ts`** — passa `meta.evidence` para a proposta.
- **`src/shared/types.ts`** — `ReleaseAction.evidence` (títulos, posições e `bodyAt`).
- **`src/shared/runs/types.ts`** — `CommentRecord.evidenceIds` e `CommentDetails.evidenceIds`, para o rascunho
  da descrição do pull request carregar os ids entre o fim da etapa e a proposta do pull request.
- **`src/shared/runs/transitions.ts`** — `details` deixa passar `evidenceIds`.
- **`src/shared/runs/schema.ts`** — `evidenceIds` no objeto do registro de comentário (o esquema recusa
  propriedade fora da lista).
- **`docs/runner.md`** (PT e EN) — uma frase diz que a imagem faz parte da **mesma escrita** que a cita e que
  um comentário que espera em Ações não põe imagem no host até a confirmação.
- **`CHANGELOG.md`** — a entrada de `## [Unreleased]` passa a dizer que a imagem sai como parte da mesma
  escrita que a cita.

## O que foi conferido nesta etapa

Tudo o que está dito como pronto foi **rodado** nesta cópia de trabalho:

- **`npx tsc --noEmit`** — sem erro.
- **`npx vitest run`** — 3704 de 3704, todos os arquivos (228).
- **`node scripts/theme-audit.mjs`** — passa.
- **`npm run i18n:lint`** — 4106 chaves nos dois idiomas, nenhuma fora de ordem.
- **`node scripts/public-audit.mjs`** — 927 arquivos, nada que pertença a uma empresa ou a uma pessoa.
- **Exercitado por teste, sem sandbox, sem modelo e sem host:**
  - `test/runner-evidence-upload.test.ts` (o terceiro caso, novo): um comentário de um agente que **espera** e
    que cita `ev-1` **não posta nada** — a proposta é a única coisa criada, o upload é o primeiro comando do
    grupo (`bodyFile` no índice 0) e a proposta carrega `{ titles: ['The screen'], positions: [0], bodyAt: 1 }`.
    É a prova de que a imagem deixou de sair antes do "sim".
  - `test/actions-group.test.ts` (o caso novo): um grupo com um upload de comprovação e um comentário, sob um
    "sim", roda o upload primeiro e o comentário depois, com o endereço que o host respondeu **embutido sob o
    texto** do comentário, e as duas escritas aparecem no registro de auditoria.
  - `test/runner-evidence-upload.test.ts` (os dois primeiros casos): um agente **autônomo** sobe a imagem e o
    comentário sai com o endereço embutido; um host que não planeja o upload faz o comentário sair sem imagem,
    dizendo quantas peças ficam no app.
- **Ajustadas as expectativas que mudaram com o desenho:** `test/runs-policy.test.ts` deixa de exigir que o
  publicador chame `uploadToken` (quem preenche o cabeçalho é quem roda a escrita), e o duble de host de
  `test/runner-evidence-upload.test.ts` responde uma vez por comando, na ordem.

## O que **não** foi verificado

- **Nenhum host real foi usado.** O envio e o embutimento são exercitados contra provedores falsos; que a
  hospedagem de arquivos do GitHub devolva o endereço esperado, que a subida do GitLab funcione com o token e
  que o Bitbucket aceite a subida não foi visto. O caminho de JSON (GitHub/Bitbucket) e o de campo de
  formulário (GitLab) foram exercitados por testes diferentes, não num host.
- **A conversa em tela, o navegador pareado e o telefone** foram lidos no código, não abertos numa janela.
- **A descrição do pull request de ponta a ponta com comprovação citada** não foi exercitada por teste: o
  caminho (planejar no grupo da proposta do pull request, embutir no "sim") foi conferido por leitura e o
  mecanismo de embutir no "sim" foi exercitado no caso do comentário.
- **A decodificação de JPEG, GIF e WebP para marcar** continua uma limitação conhecida: `AnnotateImage` só
  decodifica PNG; os outros formatos são aceitos, vistos, baixados e enviados, mas não marcados.
- **Um sandbox de verdade**: os testes usam a sandbox falsa.
