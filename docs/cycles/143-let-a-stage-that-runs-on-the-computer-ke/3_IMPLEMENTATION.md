# A etapa que roda no computador passa a guardar a comprovação

## O que mudou

Uma etapa cujo agente roda comandos no computador (`shell: host`) agora tem onde guardar
comprovação. A pasta em que a sessão de host manda salvar (a que o agente recebe em
`COXIA_OUT`, e que já era a pasta em que `ViewImage` lê as imagens) passou a ser a raiz de
leitura da comprovação da etapa, do mesmo jeito que `out` dentro da pasta de etapa é para uma
sandbox. Com isso `SaveEvidence` e `AnnotateImage` são oferecidas à etapa de host que testa
uma interface, com as mesmas regras de caminho, link, tipo lido dos bytes, teto de tamanho e
ids `ev-<n>`. Uma etapa de host sem teste de interface continua como era: nenhuma pasta,
nenhuma ferramenta de comprovação, nada novo no texto que ela recebe.

O que o agente olhou com a ferramenta de imagem e não guardou continua sendo guardado como
comprovação da etapa no fecho, antes de a pasta temporária da sessão ser removida — no host
também.

## O que esta tentativa corrigiu

A revisão anterior deixou quatro testes vermelhos e um deles apontava um problema de produto:
a etapa de host não conseguia ler uma imagem da própria pasta de saída. O caminho de leitura da
imagem pela sessão só aceitava o nome `/coxia/out`, que existe dentro de uma sandbox, e não o
caminho real da pasta de uma etapa de host — então `ViewImage` recusava ("There is no such file
in <pasta real>") e nada era marcado como olhado. Corrigido em `readOutputImage`: a pasta é
aceita pelos dois nomes (o da sandbox e o caminho real da pasta da sessão), e um caminho
absoluto que não esteja dentro dela continua recusado como de fora. Era esse o bloqueio de
verdade por trás dos dois casos de fecho no host.

Também: a asserção errada sobre o esquema de QA foi trocada por uma que olha o campo de
comprovação da etapa (o esquema de um cenário de QA sempre traz `evidence`); o teste do
catálogo de prompts passou a reconhecer a variante nova como variante (senão acusava a chave
base `runner.rules.evidence` como não usada); e os ids deixaram de ser derivados de um retrato
parado da execução — cada peça nova conta o que a etapa já guardou, senão a segunda peça (a
imagem marcada) recebia de novo `ev-1` e sobrescrevia a primeira.

## Como foi construído

Uma condição só mudou: a raiz da comprovação virou um dado da sessão.

- `src/main/sandbox/session.ts`: `SandboxSession.outputDir` (opcional), declarado por
  `openSession` (`out` da pasta de etapa) e por `openHostSession` (a pasta de `shots`, apenas
  dentro do ramo que já produz `gui`). `readOutputImage` passou a aceitar o caminho real da
  pasta da sessão, além do nome `/coxia/out`, mantendo as recusas.
- `src/main/evidence/paths.ts`: `resolveOutputPath` passou a receber a pasta de saída
  (`outRoot`) em vez da pasta de etapa; o corpo mudou em uma linha. `outputDirOf` continua
  existindo. Os dois JSDoc que o diff anterior tinha juntado numa linha voltaram a ficar
  separados.
- `src/main/evidence/handlers.ts`: `EvidenceContext.stageDir` virou `outputDir`; `save`,
  `sourceOf`, `view` e `annotate` resolvem contra ele, o destino do PNG marcado sai de
  `join(ctx.outputDir, name)`, e `run` aceita um leitor (getter) para que os ids venham do que
  a execução tem naquele instante.
- `src/main/evidence/store.ts`: `withRecordedEvidence(run, records)`, o retrato de uma execução
  com o que a etapa acabou de guardar por cima.
- `src/main/runner/executor.ts`: `const evidenceRoot = session?.outputDir` substitui
  `session?.stageDir` em `input.evidence`, na montagem das ferramentas de comprovação e em
  `keepLooked`; `runSoFar()` entrega o retrato vivo às ferramentas e à guarda; a chamada
  `if (session) keepLooked()` antes de `session?.close()` não mudou.
- `src/main/runner/prompt.ts`: a regra de comprovação da etapa nomeia a pasta real (`{out}`),
  com a variante `runner.rules.evidence.host` para a etapa de host; o texto de saída de QA usa
  `{out}`.
- `src/shared/i18n/main.en.json` e `main.pt-BR.json`: a chave base e a variante `.host` de
  regras de comprovação foram reescritas para a chave base aparecer no texto.
- `src/main/evidence/tool.ts`, `engineTool.ts` e `agents.ts`: a descrição e o `schema` citam a
  pasta real, e `withActivity` preserva `outputDir`, `gui` e `readImage`.
- `CHANGELOG.md`: uma linha sob `## [Unreleased]` (não existia na cópia anterior, apesar de o
  relato anterior dizer que sim).

## Testes

- `test/cycle-prompts.test.ts`: reconhece a variante `.host` e a chave base escolhida em forma
  calculada, sem afrouxar as demais verificações.
- `test/runner-evidence-run.test.ts`: o caso de host sem teste de interface assere o campo de
  comprovação da etapa, não a ausência da palavra no esquema de QA; o caso de host com
  interface afirma que nenhum texto que a etapa recebe sobre a pasta traz `/coxia/out`.
- `test/helpers/runner.ts`: a sessão falsa de host lê a imagem tanto pelo nome `/coxia/out`
  quanto pelo caminho real da pasta, como a sessão real; sem isso os dois casos de fecho no
  host não guardavam nada.
- Os testes de fecho no host (`test/runner-qa-repair.test.ts`), o resolvedor
  (`test/evidence-path.test.ts`), as ferramentas (`test/runner-evidence.test.ts`) e a sessão
  de host (`test/host-gui.test.ts`) passam.

## O que foi verificado, e o que não foi

Rodado nesta tentativa, nesta cópia:

- `npx tsc --noEmit` — sem saída (limpo).
- `npx vitest run` (suíte inteira) — **4363 testes passaram, 288 arquivos**, nenhuma falha.
- `npm run i18n:lint` — 4622 chaves nos dois idiomas.
- `node scripts/theme-audit.mjs` — nenhuma cor literal nova.
- `node scripts/public-audit.mjs` — 1215 arquivos, nada que pertença a uma empresa ou a uma
  pessoa.

A causa do fecho no host foi encontrada exercitando o caminho numa cópia de teste: a sessão
real recusava o caminho real da pasta antes de qualquer coisa ser marcada como olhada; depois
da correção, `readOutputImage` aceita o caminho real e o caminho pelo nome `/coxia/out`
continua funcionando.

Não verificado: o comportamento do modo host numa execução real (nenhuma sessão de host real
aberta, nada rodou no computador, nenhuma tela); uma etapa de host que roda de novo sobre
comprovação já guardada; e a semântica do `parameters` de `SaveEvidence` na forma do motor
aberto (só a forma do Claude tem teste dos nomes dos argumentos).
