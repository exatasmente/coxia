# A comprovação que o agente guardou chega ao host, e os consertos da revisão

## O que esta entrega faz

Um agente que trabalha numa etapa com sandbox guarda um arquivo que ele mesmo fez na pasta de saída como
**comprovação** da etapa; a comprovação é publicada na conversa da execução como anexo de uma mensagem e
listada sob a etapa, com um id `ev-<algarismos>`. Uma imagem pode ser marcada e olhada de novo. A escolha do
espaço de trabalho decide se uma cópia também vai para a pasta do ciclo e entra no commit da etapa.

Esta etapa fecha o que faltava do plano e o que a revisão apontou:

- **Levar a comprovação ao host de código** (passo 9): a imagem que um comentário de etapa ou a descrição do
  pull request cita é enviada ao host e sai embutida no texto, pela mesma porta das outras escritas.
- **A raiz de leitura não deixa passar um arquivo atrás de um vínculo de dependência** (o bloqueante da
  revisão): além de recusar o caminho que passa por um link escrito, o app confere o caminho real do arquivo
  contra o caminho real da pasta de saída: um arquivo que termina fora dela é recusado como um que passa por
  um link.
- **Documentação e changelog** (passo 10): `docs/runner.md`, `docs/configuration.md` e o `## [Unreleased]`.
- Os menores da revisão: a chave duplicada no catálogo português, textos de interface por `t()`, as classes
  de CSS da comprovação e a instrução de QA que citava comprovação por ter sandbox em vez de por ter as
  ferramentas.

## O que mudou, por arquivo

### Levar a comprovação ao host (passo 9)

- **`src/shared/types.ts`** — `VcsCommand` ganha `headers?` (cabeçalhos próprios de um upload, preenchidos na
  hora de rodar e nunca guardados numa proposta) e `bodyFile?` (o corpo é o próprio arquivo, não um campo de
  texto).
- **`src/main/vcs/types.ts`** — `VcsWriteOp` ganha `uploadAttachment` (o arquivo, o nome e o tipo de
  conteúdo); a interface do provedor ganha `uploadToken()` (a credencial que um upload leva nos seus próprios
  cabeçalhos; `null` quando o host fala pela CLI).
- **`src/main/vcs/github.ts`** — planeja o upload para a hospedagem de arquivos do host
  (`uploads.github.com/?repository_id=…&name=…&content_type=…`), com o tipo de conteúdo no cabeçalho; o
  validador aceita essa forma e recusa cabeçalhos ou `bodyFile` em qualquer outra escrita.
- **`src/main/vcs/gitlab.ts`** — planeja `POST projects/<path>/uploads` com o arquivo no corpo.
- **`src/main/vcs/bitbucket.ts`** — planeja `POST repositories/<path>/downloads` com o nome num cabeçalho.
- **`src/main/vcs/exec.ts`** — cada executor manda `bodyFile` como corpo cru (lido do disco na hora de rodar),
  com os cabeçalhos do comando; no GitHub e no Bitbucket a chamada vai para o endereço absoluto do host de
  arquivos.
- **`src/main/vcs/http.ts`** — `RequestOptions` ganha `body?: BodyInit`; `absolute` passa a fazer um POST
  quando há corpo. Nada de upload é repetido (não é leitura).
- **`src/main/vcs/runtime.ts`** — passa a fonte do token ao provedor do GitHub.
- **`src/main/actions.ts`** — `withUploadHeaders` preenche os cabeçalhos do upload na hora de rodar (o token
  da integração) e recusa um upload que o transporte não possa carregar; vale no caminho autônomo e no "sim".
- **`src/main/runner/publish.ts`** — `withEvidence` lê os bytes das comprovações citadas (dados pelo
  executor), escreve cada uma numa pasta descartável, manda pelo provedor e pela porta, e embute o endereço
  que o host responde sob o texto; onde o host não aceita o arquivo, o comentário diz quantas comprovações
  existem e que elas estão no app. Uma comprovação só sai quando alguém a cita; a conferência de vocabulário
  vale para o texto.
- **`src/main/runner/module.ts`** — liga `evidenceUploads`, que lê os bytes do armazenamento do espaço de
  trabalho.
- **`src/shared/evidence.ts`** — `EvidenceUpload`, `isUploadable`, `uploadNameOf` e `withEvidenceImages` (a
  linha que conta as que ficaram no app).
- **`src/main/evidence/store.ts`** — `uploadsOf`, que monta o que vai subir.
- **`src/main/vcs/validate.ts`** — o registro de auditoria não leva os cabeçalhos nem o arquivo de um upload.

### A raiz de leitura (bloqueante da revisão)

- **`src/main/evidence/paths.ts`** — depois de resolver o caminho, confere se o caminho **real** do arquivo
  continua sob o caminho **real** da pasta de saída; um arquivo que termina fora (atrás do vínculo de uma
  dependência, por exemplo) é recusado com o motivo do link. `test/evidence-path.test.ts` cobre o caso com um
  vínculo de pasta dentro da pasta de saída.

### Os menores da revisão

- **`src/shared/i18n/ui-team.pt-BR.json`** — some a entrada duplicada de `ui.runner.evidenceHint` (a chave
  `ui.runner.evidenceApp` já existia).
- **`src/renderer/src/screens/cycle/Evidence.tsx`** — o tamanho do arquivo monta "KB"/"MB" por `t()`
  (`ui.cycle.evidenceBlock.kb`/`.mb`), nos dois idiomas.
- **`src/renderer/src/screens/cycle/cycle.css`** — as classes `cy-evidence-*` ganham estilo (antes caíam no
  estilo do navegador e a miniatura não tinha tamanho).
- **`src/main/runner/prompt.ts`** — a linha de QA que convida a citar comprovação passa a valer pela
  ferramenta (`i.evidence`), não pela sandbox (`i.sandbox`), ficando de acordo com o esquema.

### Documentação e changelog (passo 10)

- **`docs/runner.md`** (PT e EN) — a comprovação: as três ferramentas, o que é aceito e recusado, onde fica, a
  escolha do espaço de trabalho e o envio ao host.
- **`docs/configuration.md`** (PT e EN) — `runner.evidence` e o histórico do esquema v13.
- **`CHANGELOG.md`** — a entrada em `## [Unreleased]` › `### Added`.

## O que foi conferido nesta etapa

Tudo o que está dito como pronto foi **rodado** nesta cópia de trabalho:

- **`npx tsc --noEmit`** — sem erro.
- **`npx vitest run`** — 3702 de 3702, todos os arquivos (228).
- **`node scripts/theme-audit.mjs`** — passa (nenhuma cor literal nova; o bloco de comprovação usa tokens).
- **`npm run i18n:lint`** — 4106 chaves nos dois idiomas, nenhuma fora de ordem.
- **`node scripts/public-audit.mjs`** — 927 arquivos, nada que pertença a uma empresa ou a uma pessoa.
- **Exercitado por teste, sem sandbox, sem modelo e sem host:**
  - `test/runner-evidence-upload.test.ts` (novo): um comentário que cita `ev-1` faz o upload subir antes do
    comentário e o endereço que o host responde sai embutido sob o texto (`![The screen](…)`); quando o host
    não planeja o upload, o comentário sai sem a imagem e dizendo "1 piece(s) of evidence stay in the app".
  - `test/vcs-github.test.ts`, `test/vcs-gitlab.test.ts`, `test/vcs-bitbucket.test.ts`: o upload é planejado
    por provedor e cada comando passa pelo próprio validador.
  - `test/evidence-path.test.ts`: um arquivo comum atrás de um vínculo de pasta dentro da pasta de saída é
    recusado com o motivo do link (o caso que a revisão apontou).

## O que **não** foi verificado

- **Nenhum host real foi usado.** O envio e o embutimento são exercitados contra provedores falsos (o
  repositório não exercita GitHub, GitLab nem Bitbucket de verdade). O que cada host aceita e devolve é o que
  a documentação diz; que a hospedagem de arquivos do GitHub devolva o endereço esperado, que o `POST
  /projects/:id/uploads` do GitLab funcione com o token e que o Bitbucket aceite a subida em `downloads` não
  foi visto.
- **A conversa em tela, o navegador pareado e o acesso pelo telefone** foram lidos no código, não abertos numa
  janela.
- **A decodificação de JPEG, GIF e WebP para marcar** continua uma limitação conhecida: `AnnotateImage` só
  decodifica PNG; os outros formatos são aceitos, vistos, baixados e enviados, mas não marcados.
- **Um sandbox de verdade**: os testes usam a sandbox falsa; a recusa do arquivo atrás de um vínculo foi
  exercitada sobre o sistema de arquivos real de um teste, não dentro de uma sandbox.
