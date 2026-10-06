# A comprovação que o agente guardou, com a marca na imagem

## Como a mudança é feita

Duas ferramentas novas entram no runtime dos agentes de uma execução. `SaveEvidence` recebe
um caminho **relativo à pasta de saída da etapa** (`/coxia/out`), lê o arquivo conferindo o
tipo **pelo conteúdo** (não pelo nome nem pela extensão), recusa o que passa do teto e
recusa qualquer caminho que não esteja dentro da pasta de saída, gravando o arquivo como
**anexo** da mensagem do agente na conversa da execução sob o id `ev-<algarismos>`. O
armazenamento do anexo e a mensagem que carrega arquivos **não existem hoje** e entram aqui
como pré-requisito interno (regra 8 da especificação): a base é o armazenamento dos bytes,
com os limites e o tipo conferido pelo conteúdo, mais o campo `attachments` da mensagem da
conversa. `AnnotateImage` recebe uma comprovação de imagem (ou uma imagem da pasta de saída)
e uma lista de marcas, e devolve uma **imagem nova** com a original preservada; o desenho
acontece no processo principal a partir de dados (retângulo, seta, elipse, rótulo, marcador
numerado e caixa de borrão), sem nenhum programa do agente rodando para desenhar. Uma
ferramenta **`ViewImage`** nova deixa o agente olhar para a imagem produzida e marcar de
novo em cima dela, fechando o ciclo capturar → marcar → olhar → marcar.

As comprovações vivem nos dados do espaço de trabalho, junto da execução
(`<workspace>/evidence/<runId>/…`), e a escolha do espaço de trabalho decide se uma cópia
também vai para a pasta do ciclo e entra no commit da etapa. O cenário de QA passa a citar
ids de comprovação ao lado dos números de comando; a saída de etapa pode citá-los; a tela da
execução e o navegador pareado listam, abrem, baixam e apagam. Quando a comprovação é citada
num comentário de etapa ou na descrição do pull request, a imagem é enviada ao host e sai
embutida, pela mesma porta das outras escritas.

## Decisões

### 1. Onde a comprovação fica e como some com a execução

- **Nos dados do app (padrão).** `<workspace>/evidence/<runId>/<evidenceId>.<ext>`, ao lado
  de `runs/` e `forum/`. O arquivo é um objeto do espaço de trabalho, indexado por execução
  e por id de comprovação; o id `ev-<algarismos>` é **estável e único na execução** (o maior
  usado + 1, guardado na própria execução), nunca reaproveitado entre tentativas.
- **Também na pasta do ciclo.** Com a escolha ligada, uma cópia vai para
  `docs/cycles/<n>-<slug>/evidence/` dentro do worktree, e o commit da etapa a leva. O
  `git add -A` do app já pega a pasta nova; o `commitAll` hoje exclui `node_modules` e
  `.venv` por nome e não toca em `evidence/`, então nada muda nesse caminho. A pasta só
  existe quando a escolha está ligada.
- **Some com a execução.** Remover a execução apaga `<workspace>/evidence/<runId>/`. A cópia
  que já entrou num commit publicado **não** é apagada por isso: tirá-la é um commit novo, e
  a tela diz isso. A comprovação em si nunca é escrita pelo agente no worktree fora da
  cópia do modo "pasta do ciclo".

### 2. A pasta de saída da etapa e o teto

- A raiz de leitura é a pasta `out` do `stageDir` que o `openSession` já cria
  (`src/main/sandbox/session.ts`). Ela **não** é `/coxia/out` no host: é
  `<stageDir>/out`, com `/coxia/out` sendo o caminho **dentro** da sandbox
  (`OUT` em `src/main/sandbox/policy.ts`). O caminho que o modelo escreve é o
  de dentro (`/coxia/out/…`); o app o resolve para `<stageDir>/out/…`, recusando
  `..`, caminho absoluto fora dela e qualquer componente que seja link
  simbólico — reusando a checagem de `src/main/engine/guard.ts` (`checkPath`) com a
  raiz na pasta de saída e a opção que recusa links. Um caminho que passe por um link
  é recusado com o motivo, não seguido.
- **Tipo pelo conteúdo.** O módulo puro novo (`src/main/evidence/type.ts`) reconhece a
  assinatura dos bytes: PNG, JPEG, GIF, WebP, PDF e `text/plain` (sem NUL e com texto
  válido). Vídeo, áudio, compactado, executável e qualquer conteúdo que não confirme o
  declarado são recusados; o motivo nomeia o formato declarado.
- **Teto de tamanho.** Uma constante de código
  (`EVIDENCE_MAX_BYTES`, por exemplo 8 MiB), não configuração; acima dela o motivo diz o
  teto. O teto do sandbox (`runner.sandbox.limits.fileMb`, 256 MiB por padrão) continua
  valendo como limite de escrita do processo; o teto da comprovação é menor e é o que a
  ferramenta aplica.
- **A leitura ocorre com a etapa viva.** A ferramenta roda enquanto a sandbox existe; o
  arquivo é lido do `stageDir` do host, sem atravessar o processo do agente. A sandbox
  fecha antes do commit, mas a cópia para a pasta do ciclo é feita **pelo app** no fim da
  etapa, a partir do arquivo já guardado em `<workspace>/evidence` — não relê `out`.

### 3. A base de anexos (regra 8) e a mensagem que carrega arquivos

- **Armazenamento.** Na primeira etapa com sandbox, os bytes são copiados de uma vez para
  `<workspace>/evidence/<runId>/<evidenceId>.<ext>`; a cópia é feita com abertura sem
  seguir link (`O_NOFOLLOW`), leitura limitada pelo teto e escrita atômica (temporário +
  `rename`). O arquivo guardado é a única fonte depois disso.
- **A mensagem carrega arquivos.** `src/shared/forum.ts` ganha `attachments?: AttachmentRef[]`
  no `ForumMessage`/`ForumDraft`, com o id, o nome, o tipo de conteúdo, o tamanho e o id da
  comprovação; `src/main/forum-core.ts` ganha o campo no `MESSAGE` do esquema (com
  `additionalProperties: false`, é lá que o formato se fixa) e grava a lista. A mensagem que
  o anexo acompanha é um `system`/`post` do app com `code` de catálogo, publicado na
  conversa da execução no instante do `SaveEvidence`.
- **A tela e o navegador leem por um canal só.** `runs:evidence` recebe `(runId, id)` e
  devolve os bytes como `ArrayBuffer`; o transporte HTTP do navegador já converte binário
  (`{ $bytes: base64 }` em `src/shared/wire.ts`), então não há caminho novo. `runs:evidenceList`
  lista as comprovações da execução com o título, a descrição, o tipo e o tamanho;
  `runs:evidenceDelete` apaga (a pessoa, nunca o agente) e `runs:evidenceKeep`/o inverso
  não existem (é o agente que guarda). Os três canais são `runs:*`, abertos ao navegador
  pareado pela política atual; a leitura de bytes é o mesmo que abrir um documento.

### 4. O id, o título e a etapa

- **Formato.** `ev-<algarismos>` (por exemplo `ev-3`), uma constante de código
  (`EVIDENCE_ID = /^ev-\d{1,6}$/`), sem significado que a pessoa precise entender. É o que
  o cenário de QA e a saída de etapa citam e o que a tela mostra.
- **Da etapa que guardou.** O registro da comprovação (id, execução, etapa, agente, título,
  descrição, nome, tipo, tamanho, se é cópia na pasta do ciclo, de que comprovação veio)
  fica na execução, em `Run.evidence`, um mapa id → registro, **adicionado** ao
  `RUN_SCHEMA`. O id de outra etapa não é aceito como desta e o motivo diz isso.
- **Título e descrição** são obrigatórios (o título) e opcionais (a descrição) na chamada,
  e é o que a pessoa lê na conversa e no que aparece listado na etapa.

### 5. Marcar a imagem e olhar o resultado

- **`AnnotateImage`.** Recebe `source` (id de comprovação ou caminho na pasta de saída) e
  `marks`: `{ kind, ... }` com `rectangle (x, y, w, h)`, `arrow (x1, y1, x2, y2)`,
  `ellipse (cx, cy, rx, ry)`, `label (x, y, text)`, `marker (x, y, n)` e `blur (x, y, w, h)`.
  Coordenadas em pixels da imagem, cor de uma lista curta e fixa, espessura com teto. Um
  valor fora da imagem, uma cor fora da lista ou uma espessura acima do teto é recusado com
  o motivo, e nada é desenhado no lugar errado.
- **O desenho é do app.** Um módulo do processo principal desenha a partir dos dados. Como
  não há biblioteca de imagem nas dependências (conferido em `package.json`), o desenho é
  feito com o **codificador PNG/JPEG próprio mínimo** (um `pngjs`-like) ou com `sharp`
  avaliado e **recusado** por trazer binário nativo; a decisão registrada no plano é a
  primeira: o desenho entra por um módulo puro (`src/main/evidence/draw.ts`) que recebe a
  imagem decodificada e as marcas e devolve pixels; o decode de PNG/JPEG/WebP é o ponto
  frágil e a implementação escolhe entre uma biblioteca pura e uma reescrita mínima. O
  teste usa imagens pequenas e cobre cada marca e cada recusa.
- **Cada versão é uma comprovação.** A imagem nova é guardada como uma comprovação **nova**
  ligada à de origem (`from: <id>`), formando uma cadeia; a original continua lá.
- **`ViewImage`.** Nova ferramenta, irmã da `Shell` no mesmo lugar
  (`src/main/sandbox/tool.ts`/`engineTool.ts` para os dois motores), que devolve a imagem
  como conteúdo de imagem ao modelo (Claude SDK `image` block; motor aberto: a imagem
  passa como `data:` URL ou como anexo na mensagem, conforme o que o motor aceita). Ela é
  oferecida a quem tem sandbox, e o par `SaveEvidence`/`AnnotateImage` idem.

### 6. O cenário de QA e a saída de etapa

- **O cenário cita ids.** `Scenario` ganha `evidence?: string[]` (ids `ev-*`); `readScenario`
  os lê e o `outputSchema` os pede quando o agente tem sandbox. A tela de revisão e QA
  (`src/renderer/src/screens/cycle/ReviewRounds.tsx`) já mostra cada cenário; passa a
  mostrar as comprovações citadas como miniaturas/links.
- **Comprovação não é execução.** `backEvidence` continua mandando: o cenário `executed`
  precisa de um comando que o sustente; citar uma comprovação não muda a marca e o app
  continua conferindo a afirmação. O que muda é só a lista de ids que a tela mostra.
- **A saída de qualquer etapa cita ids.** O campo `StageOutput`/esquema ganha
  `evidence?: string[]` para todos os tipos de etapa; um id desconhecido é dito na conversa
  e ignorado, sem falhar a etapa. O prompt (`src/main/runner/prompt.ts`) ganha a linha que
  diz como citar.

### 7. A escolha do espaço de trabalho (config schema 13)

- **Campo novo.** `runner.evidence: 'app' | 'cycle'`, padrão `'app'`. Um arquivo guardado sem
  o campo lê como `'app'` (o padrão é o seguro: nada de comprovação num commit).
- **Os quatro lugares.** `src/shared/config/types.ts` (`EVIDENCE_PLACEMENTS`,
  `RunnerEvidence`, o campo em `RunnerConfig`, `CONFIG_SCHEMA_VERSION = 13`),
  `src/shared/config/schema.ts` (o enum no bloco `runner`), `src/shared/config/defaults.ts`
  (`neutralRunner` com `evidence: 'app'`) e um passo de migração novo em
  `src/shared/config/migrations.ts` (`v12ToV13`, que escreve o padrão quando falta e não
  toca em nada mais) com o `STEPS` recebendo a chave `12`. `test/config-schema.test.ts`
  falha se os três (types, schema, defaults) divergirem — é o que a regra do squad pede.
- **A tela.** `src/renderer/src/screens/team/RunnerSection.tsx` e o `draftOfRunner` ganham um
  par de botões/uma escolha; o navegador pareado só **vê** (é o mesmo `web` que já separa o
  que só o computador muda, porque o campo decide o que entra num commit). O `configScope`
  lista `runner.evidence` entre o que só o computador muda, ou o aceita no `config:cycle-save`;
  a decisão do plano é **recusar** no navegador (mesma linha do `runner.identity`).
- **Textos.** Chaves novas em `src/shared/i18n/main.pt-BR.json` e `main.en.json` para o
  rótulo, as duas opções e a dica, e para as recusas da ferramenta e o `code` da mensagem
  da conversa.

### 8. Levar ao host de código (item 4 da issue)

- **A imagem sobe e o comentário a embute.** `VcsWriteOp` ganha uma operação de upload
  (`uploadEvidence`), que cada provedor descreve no seu formato: GitHub (upload pelo
  endpoint que devolve a URL de `user-attachments` a partir do `POST` com o token; o
  comentário sai com `![…](url)`), GitLab (`POST /projects/:id/uploads`, que devolve um
  endereço em Markdown para embutir), Bitbucket Cloud (o comentário é `content.raw`; onde a
  imagem embutida não der, o comentário diz **quantas comprovações existem e que estão no
  app**, em vez de omitir ou quebrar). O texto que cada um suporta está na especificação
  (regra 26) e o plano o repete sem inventar verificação em host real: **nenhum host real foi
  usado neste projeto**, e o teste é contra `test/helpers/fakeHost.ts`.
- **A porta de sempre.** O envio passa por `proposeVcsAction`/`runVcsAuto` como qualquer
  escrita: um agente autônomo publica sozinho e é auditado (`audited`), os outros esperam o
  "sim" em Ações com as imagens à vista, e `assertExternalWrite` recusa num espaço de
  trabalho de teste. O push e o pull request continuam esperando sempre.
- **Ordem do grupo.** O envio da imagem entra no mesmo grupo de comandos do comentário,
  **antes** da escrita do comentário; o `proposeVcsGroup` já roda em ordem e para no
  primeiro que falha. A conferência de vocabulário do comentário (`checkComment`) vale só
  para o texto; a imagem sai como veio.

### 9. O que a spec fixa e o plano precisa cobrir

- **O fora do escopo** (vídeo/gravação de tela, editar a comprovação à mão, enviar sem
  citação, virar artefato de etapa, anotar documento que não seja imagem, escolher o
  provedor, automatizar a borra, esperar a base de anexos de fora) é respeitado: nada dele
  entra no trabalho.
- **A comprovação não é artefato de etapa.** Ela não entra em `produces` nem em `reads` de
  nenhuma etapa; `checkFlow` não muda. A cópia da pasta do ciclo vive em `evidence/`, uma
  subpasta que o `ARTIFACT_NAME`/`readFolder` já não enxerga (aquele filtro é de nome plano,
  sem `/`).
- **As quatro travas** (padrão só nos dados do app; borrão; revisão antes do "sim"; origem
  restrita à pasta de saída com tipo pelo conteúdo) estão nos itens 5 e 6.

## Trabalho, em ordem

1. **Tipos e esquema.** `src/shared/runs/types.ts` (`EvidenceRecord`, `Run.evidence`,
   `Scenario.evidence`, `EVIDENCE_ID`), `src/shared/runs/schema.ts` (o mapa e os campos),
   `src/shared/runs/output.ts` (`evidence` no `StageOutput`, no `outputSchema` e no
   `readScenario`/`readOutput`) e `src/shared/forum.ts` (`AttachmentRef`, `attachments`).
   Ajustar os testes que fixam listas exatas de propriedades.
2. **A escolha de config.** `types.ts`, `schema.ts`, `defaults.ts`, `migrations.ts`
   (`v12ToV13` + `STEPS`), `validate.ts` se precisar de regra, `configScope.ts` para a
   recusa no navegador, `RunnerSection.tsx` + `draftOfRunner`, e os catálogos.
3. **A base de anexos.** `src/main/forum-core.ts` (o campo no esquema e a gravação) e o
   módulo `src/main/evidence/store.ts`: o registro no `Run.evidence`, a cópia atômica para
   `<workspace>/evidence`, a remoção com a execução e a cópia para a pasta do ciclo.
4. **O conteúdo e a pasta de saída.** `src/main/evidence/type.ts` (assinatura por conteúdo,
   teto) e `src/main/evidence/paths.ts` (resolver `/coxia/out/…` para `<stageDir>/out/…` com
   `checkPath` e sem seguir link). Puros e testáveis sem sandbox.
5. **As três ferramentas.** `src/main/evidence/tool.ts` (`SaveEvidence`, `AnnotateImage`,
   `ViewImage`: nome, descrição em inglês, esquema) e `engineTool.ts` (as versões `ToolImpl`
   para o motor aberto e o servidor MCP para o Claude Agent SDK, como a `Shell` faz),
   ligadas no `src/main/agents.ts` onde `req.exec` já liga a `Shell`.
6. **O desenho.** `src/main/evidence/draw.ts` (marcas → pixels) e a ligação com o
   `AnnotateImage`; o resultado é gravado como comprovação nova com `from`.
7. **O executor e o prompt.** `src/main/runner/executor.ts` para dar às ferramentas o
   `stageDir` da etapa e o contexto que elas precisam (execução, etapa, agente), o commit da
   cópia da pasta do ciclo depois da etapa, e `src/main/runner/prompt.ts` para a instrução
   de citar ids e de como guardar.
8. **Canais e telas.** `src/main/runner/module.ts` (`runs:evidence`, `runs:evidenceList`,
   `runs:evidenceDelete`), `src/preload`/`src/shared/apiChannels.ts` se a tabela exigir,
   `src/renderer/src/screens/cycle/` (listar e abrir a comprovação na etapa, na conversa e
   no cenário; baixar e apagar) e `src/renderer/src/screens/cycle/ReviewRounds.tsx` para o
   cenário. Tokens de tema, nunca cor literal; todo texto por `t()`.
9. **Levar ao host.** `VcsWriteOp` com o upload, `planWrite` de GitHub/GitLab/Bitbucket,
   `validate.ts`/`exec.ts` para a operação nova, `src/main/runner/publish.ts` para embutir
   as imagens citadas no corpo e para o texto de substituição onde não der, e o grupo de
   comandos na ordem certa.
10. **Documentação e changelog.** `docs/runner.md` (as ferramentas, a pasta, a escolha, o
    envio), `docs/configuration.md` (o `runner.evidence` e o esquema v13), `CHANGELOG.md`
    em `## [Unreleased]`.
11. **Testes** (abaixo).

## Testes

- **Puros.** `test/evidence-type.test.ts`: assinatura por conteúdo de PNG, JPEG, GIF, WebP,
  PDF e `text/plain`; recusa de vídeo, áudio, compactado, executável e de um arquivo que se
  diz imagem e não é; teto. `test/evidence-path.test.ts`: `/coxia/out/x.png` resolve;
  caminho fora, `..` e link simbólico recusam com o motivo. `test/evidence-draw.test.ts`:
  cada marca desenhada numa imagem pequena, e cada recusa (cor fora da lista, coordenada
  fora, espessura acima do teto).
- **A base de anexos.** `test/forum.test.ts` (ou novo): uma mensagem com anexo grava e lê o
  campo; um campo fora do formato é recusado pelo esquema.
- **A escolha de config.** `test/config-schema.test.ts`, `test/config-migrations.test.ts`:
  um v12 sem o campo vira v13 com `'app'`; um v12 com `'cycle'` mantém; tipos, schema e
  defaults não divergem.
- **As ferramentas.** `test/runner-evidence.test.ts` (novo, com o motor roteirizado): a
  ferramenta recusa caminho fora da pasta de saída, link, arquivo acima do teto e conteúdo
  que não é o declarado, cada um com o motivo à vista; guarda uma comprovação e o arquivo
  aparece como anexo da mensagem da conversa; o id sai `ev-<n>` e é estável; o id de outra
  etapa não é aceito; um cenário que cita uma comprovação sem comando continua `read`; a
  saída de etapa cita um id e ele aparece na execução.
- **A pasta do ciclo e a remoção.** `test/runner-e2e.test.ts`: com `'app'`, nenhum arquivo
  de comprovação no commit da etapa e nenhum no pull request; com `'cycle'`, os arquivos
  estão no commit da etapa; remover a execução apaga `<workspace>/evidence/<runId>/`.
- **Levar ao host.** `test/vcs-writes.test.ts` e `test/vcs-github.test.ts` (modelo), com o
  host falso: o upload é planejado por provedor e a imagem entra no corpo; num provedor que
  não embute, o comentário diz quantas comprovações existem e que estão no app. Um espaço de
  trabalho de teste recusa; um agente autônomo publica sozinho e o registro de auditoria
  ganha a linha.
- **Regressão.** `test/run-view.test.ts`, `test/runs-results.test.ts` e o teste de política
  do navegador: os canais novos de comprovação continuam abertos ao navegador pareado (é o
  mesmo `runs:*`), e o esquema da execução continua lendo um arquivo antigo.
- **Portas do repositório:** `npx tsc --noEmit`, `npx vitest run`,
  `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

## Riscos e como são cobertos

- **Não há biblioteca de imagem, e o desenho pode virar trabalho grande.** O desenho é por
  dados e coberto por um teste de imagem pequena; o decode de PNG é o ponto frágil, e a
  alternativa (uma dependência pura) é licença a conferir com
  `node scripts/third-party-notices.mjs`. Registrado como risco de tamanho, não de
  comportamento.
- **Um arquivo da pasta de saída pode ser um link ou um `..` para fora.** A resolução usa o
  mesmo guard dos agentes (`checkPath`) com a raiz na pasta de saída, a checagem é feita no
  host (não dentro da sandbox) e o teste cobre o link e o `..`.
- **O tipo pelo nome ser enganado.** O tipo é lido dos bytes, e o teste usa um `.png` que é
  texto e um `.txt` que é PNG.
- **A cópia na pasta do ciclo entrar num commit sem a pessoa querer.** O padrão é
  `'app'` e um arquivo guardado sem o campo lê como `'app'`; a escolha só o computador
  muda; o teste de ponta a ponta cobre os dois modos.
- **Uma imagem com dado privado ir para um comentário.** As quatro travas: o padrão fora do
  commit, o borrão como única forma de esconder dentro do app, a revisão antes do "sim" e a
  origem restrita à pasta de saída com tipo pelo conteúdo. Nenhum host real foi usado; o que
  não foi verificado está dito no documento.
- **O id de comprovação reaproveitado ou vindo de outra etapa.** O id é o maior da execução
  + 1, guardado na execução, e o registro conhece a etapa; o teste cobre.
- **A base de anexos crescer o escopo além do previsto.** Ela é o pré-requisito interno
  (regra 8) e está no item 3 do trabalho; sem ela a ferramenta não guarda, e o critério 13
  da spec é o que a verifica.
- **O envio por provedor quebrar num host real.** Nenhum host real é usado no projeto; onde
  não der para embutir, o texto de substituição evita que a publicação quebre ou suma com a
  informação.

## Verificação desta etapa

Nada foi executado: esta etapa é de planejamento e só leu arquivos. O que foi conferido por
leitura nesta cópia de trabalho, para o plano se apoiar em fatos: a pasta `out` da sandbox e
o `/coxia/out` de dentro (`src/main/sandbox/policy.ts`, `session.ts`); a `Shell` e a ligação
dos dois motores (`src/main/sandbox/tool.ts`, `engineTool.ts`, `src/main/agents.ts`); que a
mensagem da conversa não tem campo de anexo (`src/shared/forum.ts`, `src/main/forum-core.ts`)
e que a comprovação não é artefato de etapa (`src/main/runner/cycleFolder.ts`); que não há
biblioteca de imagem em `package.json`; o formato da comprovação por comando do cenário
(`src/shared/runs/types.ts`, `output.ts`); o `Run` e o `RUN_SCHEMA`; o `VcsCommand` e os
`planWrite` dos três provedores (sem upload hoje); a porta de Ações (`src/main/actions.ts`,
`src/main/runner/publish.ts`, `door.ts`) e a política do navegador (`src/main/webPolicy.ts`);
e o esquema de configuração v12 (`types.ts`, `schema.ts`, `defaults.ts`, `migrations.ts`) com
o `RunnerSection.tsx`. Não foi verificado: que um provedor real aceite o envio e o
embutimento de uma imagem; que o motor aberto e o Claude Agent SDK aceitem a imagem de volta
na ferramenta de olhar; e o comportamento em tela das quatro partes.

## Perguntas em aberto

- A pergunta 1 da especificação segue com a pessoa: se a publicação da imagem de um agente
  autônomo sai sozinha (como as outras escritas dele) ou espera sempre o "sim". Este plano
  desenha as duas: o envio é uma escrita comum na porta de Ações, então a autonomia já o
  decide como decide um comentário, e o `proposeVcsAction` espera o "sim" para os demais. A
  decisão é de quem mantém e não trava o trabalho.
