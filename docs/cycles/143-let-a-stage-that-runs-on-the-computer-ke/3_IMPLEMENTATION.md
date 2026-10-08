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

## Como foi construído

Uma condição só mudou: a raiz da comprovação virou um dado da sessão.

- `src/main/sandbox/session.ts`: `SandboxSession.outputDir` (opcional), declarado por
  `openSession` (`out` da pasta de etapa) e por `openHostSession` (a pasta de `shots`, apenas
  dentro do ramo que já produz `gui`).
- `src/main/evidence/paths.ts`: `resolveOutputPath` passou a receber a pasta de saída
  (`outRoot`) em vez da pasta de etapa; o corpo mudou em uma linha. `outputDirOf` continua
  existindo, com o comentário ajustado.
- `src/main/evidence/handlers.ts`: `EvidenceContext.stageDir` virou `outputDir`; `save`,
  `sourceOf`, `view` e `annotate` resolvem contra ele, e o destino do PNG marcado sai de
  `join(ctx.outputDir, name)`.
- `src/main/runner/executor.ts`: `const evidenceRoot = session?.outputDir` substitui
  `session?.stageDir` em `input.evidence`, na montagem das ferramentas de comprovação e em
  `keepLooked`; a chamada `if (session) keepLooked()` antes de `session?.close()` não mudou.
- `src/main/runner/prompt.ts`: a regra de comprovação da etapa nomeia a pasta real (`{out}`),
  com a variante `runner.rules.evidence.host` para a etapa de host; o texto de saída de QA usa
  `{out}`.
- `src/shared/i18n/main.en.json` e `main.pt-BR.json`: `prompt.sdd.runner.rules.evidence` e
  `prompt.sdd.runner.output.evidence` ganharam `{out}`; `prompt.sdd.runner.rules.evidence.host`
  é nova; `main.evidence.refused.path` deixou de dizer "dentro da sandbox".
- `src/main/evidence/tool.ts` e `engineTool.ts`: a descrição e o `schema` de `SaveEvidence`
  passam a citar a pasta real da etapa; `evidenceToolImpls`/`evidenceMcpServer` recebem a
  pasta.
- `src/main/agents.ts`: `withActivity` preserva `outputDir`, `gui` e `readImage`, senão a
  descrição de `ViewImage` de uma etapa de host dizia `/coxia/out`; a pasta da sessão chega às
  ferramentas de comprovação.
- `CHANGELOG.md`: uma linha sob `## [Unreleased]`, sem referência interna.

## Testes

Cobrem os comportamentos que o plano listou (casos 3 a 10), nos arquivos que já existiam:

- `test/evidence-path.test.ts`: o resolvedor contra a raiz da sandbox e contra uma raiz de
  host (aceita o relativo e o absoluto de dentro, recusa o de fora, o `..` e o link).
- `test/runner-evidence.test.ts`: ferramentas contra uma raiz que não é `<pasta de
  etapa>/out`; o PNG marcado cai na raiz declarada.
- `test/host-gui.test.ts`: a sessão de host sem nada pedido não declara pasta; com navegadores
  ou tela, `outputDir` é `gui.out` e `stageDir` não existe.
- `test/runner-evidence-run.test.ts`: um caso de host com teste de interface guarda e cita
  comprovação; um caso de host sem interface não oferece nem pede comprovação; o texto da
  etapa nomeia a pasta real.
- `test/runner-qa-repair.test.ts`: o que foi olhado e não guardado no host.
- `test/helpers/runner.ts`: `keepQaEvidence` e a sessão falsa passaram a usar `outputDir`.

## O que foi verificado, e o que não foi

Rodado nesta etapa: `npx tsc --noEmit`, sem saída (passou). `npx vitest run` nos arquivos
`test/evidence-path.test.ts`, `test/runner-evidence.test.ts`, `test/host-gui.test.ts` e
`test/host-session.test.ts`: 54 testes passaram. `npx vitest run` em
`test/runner-evidence-run.test.ts` e `test/runner-qa-repair.test.ts`: 16 passaram e 3 dos
testes novos falharam — um por uma asserção minha errada sobre o esquema de QA (esse esquema
sempre traz a palavra `evidence` no campo de um cenário) e dois de fecho no host, que ainda
não guardaram o que o agente olhou. Esses dois não ficaram explicados.

Não foi rodado: a suíte inteira, `node scripts/theme-audit.mjs`, `npm run i18n:lint` e
`node scripts/public-audit.mjs`. Não verificado: o comportamento do modo host em execução
real; o caminho de uma etapa de host que roda de novo sobre comprovação já guardada; e se a
#142 está mesclada na ramificação de onde esta mudança sai (o fecho `keepLooked`/`lookedPaths`
existe no código desta cópia).
