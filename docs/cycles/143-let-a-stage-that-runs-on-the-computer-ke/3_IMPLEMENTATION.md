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

A revisão anterior bloqueou a mudança dizendo que, na etapa de host, o texto das regras de
comprovação sairia com a **chave crua** (`rules.evidence.host`) no lugar da explicação, porque
o mecanismo de textos só conheceria as variantes do host de código (`.on-github` e irmãs) e as
do ciclo (`.off-sdd` e irmãs), e não um sufixo de host de etapa.

Isso **não se reproduz** no código desta cópia. O caminho foi exercitado de ponta a ponta:

- `renderPrompt(cycle, 'runner.rules.evidence.host', 'en', { out: '/tmp/x' })` devolve a
  redação inteira da chave, com `{out}` preenchido — não a chave.
- O mecanismo (`promptTemplate` em `src/shared/cycles/prompts.ts`) procura primeiro a chave
  exata `prompt.sdd.runner.rules.evidence.host`, que existe nos dois catálogos; as variantes
  (`.novoice`, `.on-*`, `.off-*`) são tentadas antes da chave exata, não no lugar dela. Uma id
  que é ela própria a chave resolve pela primeira tentativa, seja qual for o sufixo.
- Com uma etapa de QA de host de verdade (sessão falsa com `gui.out` apontando para uma pasta
  real), o `system` que a etapa recebe traz a frase completa, nomeando a pasta real, e **não**
  contém `runner.rules.evidence`.

O que faltava de fato era a **prova**: a assertiva que separa os dois modos e que reprova se o
texto voltar a sair como chave. Foi acrescentada ao caso que já confere o texto do host
(`test/runner-evidence-run.test.ts`): além de conter `SaveEvidence` e o caminho real e de não
conter `/coxia/out`, o `system` da etapa não pode conter `runner.rules.evidence`. Assim o
critério de aceite 5 fica coberto por um teste que distingue os dois modos, e não por uma
assertiva antiga que passaria dos dois jeitos.

## Como foi construído

Uma condição só mudou: a raiz da comprovação virou um dado da sessão.

- `src/main/sandbox/session.ts`: `SandboxSession.outputDir` (opcional), declarado por
  `openSession` (`out` da pasta de etapa) e por `openHostSession` (a pasta de `shots`, apenas
  dentro do ramo que já produz `gui`). `readOutputImage` aceita o caminho real da pasta da
  sessão, além do nome `/coxia/out`, mantendo as recusas.
- `src/main/evidence/paths.ts`: `resolveOutputPath` passou a receber a pasta de saída
  (`outRoot`) em vez da pasta de etapa. `outputDirOf` continua existindo.
- `src/main/evidence/handlers.ts`: `EvidenceContext.stageDir` virou `outputDir`; `save`,
  `sourceOf`, `view` e `annotate` resolvem contra ele, e o destino do PNG marcado sai de
  `join(ctx.outputDir, name)`.
- `src/main/evidence/store.ts`: `withRecordedEvidence(run, records)`, o retrato de uma execução
  com o que a etapa acabou de guardar por cima.
- `src/main/runner/executor.ts`: `const evidenceRoot = session?.outputDir` substitui
  `session?.stageDir` em `input.evidence`, na montagem das ferramentas e em `keepLooked`; a
  chamada `if (session) keepLooked()` antes de `session?.close()` não mudou.
- `src/main/runner/prompt.ts`: a regra de comprovação nomeia a pasta real (`{out}`), com a
  variante `runner.rules.evidence.host` para a etapa de host; o texto de saída de QA usa `{out}`.
- `src/shared/i18n/main.en.json` e `main.pt-BR.json`: a chave base e a variante `.host` de
  regras de comprovação, nos dois idiomas.
- `src/main/evidence/tool.ts`, `engineTool.ts` e `agents.ts`: a descrição e o `schema` citam a
  pasta real, e `withActivity` preserva `outputDir`, `gui` e `readImage`.
- `CHANGELOG.md`: uma linha sob `## [Unreleased]`, sem número de issue nem nome de arquivo.

## Testes

- `test/runner-evidence-run.test.ts`: o caso de host com interface assere que o texto da etapa
  nomeia a pasta real, não traz `/coxia/out` e **não** traz a chave `runner.rules.evidence`
  (a prova que a revisão pedia para o critério 5); o caso de host sem teste de interface assere
  o campo de comprovação da etapa, não a ausência da palavra no esquema de QA.
- `test/cycle-prompts.test.ts`: reconhece a variante `.host` e a chave base escolhida em forma
  calculada.
- `test/helpers/runner.ts`: a sessão falsa de host lê a imagem tanto pelo nome `/coxia/out`
  quanto pelo caminho real da pasta, como a sessão real.
- Os testes de fecho no host (`test/runner-qa-repair.test.ts`), o resolvedor
  (`test/evidence-path.test.ts`), as ferramentas (`test/runner-evidence.test.ts`) e a sessão de
  host (`test/host-gui.test.ts`) passam.

## O que foi verificado, e o que não foi

Rodado nesta tentativa, nesta cópia:

- `npx tsc --noEmit` — sem saída (limpo).
- `npx vitest run` (suíte inteira) — **4363 testes passaram, 288 arquivos**, nenhuma falha.
- `npm run i18n:lint` — 4622 chaves nos dois idiomas, 0 texto não traduzido.
- `node scripts/theme-audit.mjs` — nenhuma cor literal nova.
- `node scripts/public-audit.mjs` — 1215 arquivos, nada que pertença a uma empresa ou a uma
  pessoa.
- A redação da regra de comprovação da etapa de host foi renderizada e lida no `system` de uma
  chamada de QA de host real (sessão falsa com pasta real): sai inteira, nomeia a pasta real e
  não traz chave crua.

Não verificado: o comportamento do modo host numa execução real (nenhuma sessão de host real
aberta, nada rodou no computador, nenhuma tela); uma etapa de host que roda de novo sobre
comprovação já guardada; e a semântica do `parameters` de `SaveEvidence` na forma do motor
aberto (só a forma do Claude tem teste dos nomes dos argumentos).
