# A atribuição por responsável passa a estar dita onde o gatilho é configurado e lido

## Como a mudança é feita

Três textos são corrigidos, e nada mais. Nenhuma ação do app muda: o gatilho continua
iniciando sozinho só uma issue **aberta**, com o rótulo `triggerLabel` e **atribuída à
pessoa**, exatamente como o código já faz. O que estava errado era o que a pessoa lê.

1. O bloco `runner` de `docs/configuration.md` (pt-BR e inglês) deixa de dizer que o
   app inicia execuções "para as issues que levam o rótulo" e passa a dizer que é só
   uma issue aberta, com o rótulo e atribuída à pessoa, ligando ao parágrafo de
   `docs/runner.md` que já diz isso (o mesmo link que o bloco já usa para o documento de
   execução).
2. A dica `ui.runner.triggerHint` nos dois catálogos (`ui-team.pt-BR.json` e
   `ui-team.en.json`) passa a nomear a atribuição, mantendo o aviso de que a caixa não
   importa. A mesma chave, sem chave nova, continua ligada ao campo em
   `RunnerSection.tsx`.
3. `docs/vcs-providers.md`, nos dois idiomas, ganha a informação de que a lista que
   alimenta o gatilho é a das issues atribuídas à pessoa, com o filtro de cada host.

Os três textos contam a mesma história — aberta, com o rótulo e atribuída — e nenhum
promete mais do que o comportamento observado.

## Decisões de desenho

### 1. O que exatamente muda em `docs/configuration.md`

- **pt-BR (linha 73)**, na frase do `enabled`: hoje diz que o app inicia execuções
  sozinho "para as issues que levam o rótulo `triggerLabel` (padrão `coxia`, caixa não
  importa)". Passa a dizer que é uma issue **aberta**, com o rótulo e **atribuída à
  pessoa**, com um link para o parágrafo de `docs/runner.md` que já enuncia as três
  condições juntas (`runner.md`, seção "Autonomia, escalonador e reinício"). O link
  mantém o estilo do bloco, que já aponta para `runner.md` em outras frases.
- **Inglês (linha 221)**: a mesma frase, com o mesmo link.
- Nada mais no bloco `runner` muda: os outros campos (`commands`, `sandbox`,
  `identity`...) ficam como estão. O texto continua narrando o padrão `coxia` e o
  "caixa não importa".

### 2. A consistência com a dica de contexto `ui.runner.enabledHint`

- A chave `ui.runner.enabledHint` (linhas 191-192 dos dois catálogos) hoje diz: "On, the
  app starts a run for each issue that carries the label below." / "Ligado, o app começa
  uma execução para cada issue com o rótulo abaixo." Ela **omite** a atribuição e a
  condição de issue aberta.
- A especificação exige consistência entre os lugares que a pessoa lê. Como essa dica
  fica logo acima do próprio campo do rótulo e é a primeira coisa que explica o gatilho,
  ela **entra na mudança**, junto com `triggerHint`: passa a dizer que o app começa uma
  execução para cada issue que leva o rótulo abaixo, está aberta e **está atribuída à
  pessoa**, mantendo a segunda frase ("Começar uma execução à mão não depende disto.").
- As duas chaves (`enabledHint` e `triggerHint`) são corrigidas juntas, para o bloco não
  sair com uma dica que diz três condições e outra logo acima que diz só o rótulo.
- Ambas as chaves já existem e são usadas (`RunnerSection.tsx`: `enabledHint` na linha
  66 e `triggerHint` na 68). Nenhuma chave nova, nenhum texto órfão.

### 3. O texto da dica do campo (`ui.runner.triggerHint`)

- O texto base é curto e no estilo das dicas ("Case does not matter." / "Maiúsculas e
  minúsculas não importam."). O texto novo mantém a frase de caixa e acrescenta a
  condição: a issue também precisa estar **atribuída à pessoa** (e aberta) para a
  execução começar sozinha. A redação exata fica na implementação, mas o conteúdo é
  fixo: atribuição à pessoa + caixa não importa, sem prometer que o rótulo sozinho
  basta.
- Os dois idiomas dizem a mesma coisa, no mesmo nível de detalhe.

### 4. O texto de `docs/vcs-providers.md`

- O documento tem uma tabela por host com as linhas "Issues do projeto" e "Lista
  'minhas'" (pt-BR nas linhas 32-33; inglês nas 176-177). A linha "Lista 'minhas'" já
  cobre o filtro por responsável de cada host, mas sem dizer que é ela que alimenta o
  gatilho do runner.
- A mudança acrescenta, nessa região (na linha "Lista 'minhas'" ou como uma linha
  curta logo abaixo da tabela — fica na implementação, desde que esteja dita), que a
  lista que o gatilho lê é a das issues atribuídas à pessoa, e como cada host a
  obtém: GitHub `issues?filter=assigned` (ou `assignee=<usuário>` com o projeto de
  issues), GitLab `scope=assigned_to_me`, Bitbucket `assignee.uuid` na consulta.
- **Não prometer como regra geral.** O funil comum do runner acrescenta estado e
  rótulo sobre a lista "minhas" e **não reaplica** a checagem de responsável (conferido
  no código nesta etapa). O documento diz que a leitura que alimenta o gatilho é a das
  issues atribuídas, com o filtro de cada host — não que o app reconfere o responsável
  em todos os caminhos de leitura.

### 5. O que fica de fora

- Nenhuma tela, mensagem ou aviso novo. O aviso na tela de execuções para uma issue com
  o rótulo e ninguém atribuído é outra issue (105) e não entra.
- Nenhuma mudança no runner (`src/main/runner/module.ts`), nos provedores
  (`src/main/vcs/*`) ou na configuração do esquema. Nada de comportamento.
- Nada de esconder, desabilitar ou reescrever o campo do rótulo; o rótulo padrão
  `coxia` continua.

## Arquivos

**Documentação de configuração e provedores**

- `docs/configuration.md`: a frase do `enabled` do bloco `runner` (pt-BR linha 73,
  inglês linha 221) passa a exigir issue aberta, com o rótulo e atribuída à pessoa, com
  link para `docs/runner.md`.
- `docs/vcs-providers.md`: a nota de que a lista do gatilho é a das issues atribuídas à
  pessoa e o filtro de cada host (pt-BR nas linhas 32-33, inglês nas 176-177), nos dois
  idiomas.

**Catálogos de texto (os dois idiomas)**

- `src/shared/i18n/ui-team.pt-BR.json`: `ui.runner.triggerHint` (linha 253) e
  `ui.runner.enabledHint` (linha 192).
- `src/shared/i18n/ui-team.en.json`: as mesmas duas chaves (linhas 253 e 192).
- `src/renderer/src/screens/team/RunnerSection.tsx`: nada muda — as duas chaves já são
  usadas no campo do rótulo e no bloco `enabled`, respectivamente (linhas 66 e 68). Só
  conferir.

**Fora do código**

- `CHANGELOG.md`, em `## [Unreleased]`, seção `### Changed`: uma linha visível à pessoa
  dizendo que a configuração e a dica do gatilho passam a explicar que a issue precisa
  estar aberta, com o rótulo e atribuída à pessoa. Sem referência interna.
- Nota: o produto pede um título de nota de lançamento que diga o que mudou, sem
  referência interna; o formato e o texto exatos ficam com quem escrever, seguindo o
  arquivo.

## Testes e verificação

Nenhum teste da árvore cai por causa desta mudança: o texto novo é texto, e as chaves
já existem nos dois idiomas.

- `npx vitest run`: a suíte inteira, incluindo `test/team-catalog.test.ts` (confere que
  toda chave nomeada pelas telas existe nos dois idiomas e que nenhuma chave está
  órfã — as duas chaves continuam nomeadas, nada a fazer) e os testes de provedores
  (`test/vcs-github.test.ts`, `test/vcs-gitlab.test.ts`, `test/vcs-bitbucket.test.ts`),
  que não mudam porque o código não muda.
- `npm run i18n:lint`: os dois catálogos continuam com as mesmas chaves nos dois
  idiomas.
- `npx tsc --noEmit` e `node scripts/theme-audit.mjs`: nada muda em código nem em cor;
  rodam como gate.
- `node scripts/public-audit.mjs`: gate; o texto novo é neutro (sem nome de empresa,
  pessoa, host ou número real de issue).
- Conferência por leitura, que quem escrever refaz: `docs/runner.md` (pt-BR linha 60,
  inglês linha 278) já diz o requisito; os três textos novos dizem o mesmo e nenhum diz
  que o rótulo sozinho basta.

## Riscos

| Risco | Como é coberto |
|---|---|
| A documentação prometer um filtro por responsável que o funil comum do runner não reaplica | O texto diz que a leitura que alimenta o gatilho é a das issues atribuídas, com o filtro de cada host, e não afirma que o responsável é reconferido em todo caminho. Não foi verificado se o funil reaplica a checagem; o texto não depende disso. |
| A dica do campo ficar longa demais para o espaço da tela | A dica é uma ou duas frases, no estilo das outras do bloco; o texto novo mantém a frase de caixa e acrescenta a atribuição, sem parágrafo. Conferir na tela de Configurações › Runner. |
| `enabledHint` e `triggerHint` divergirem (uma com as três condições, outra só com o rótulo) | As duas são corrigidas na mesma mudança, com o mesmo conteúdo (aberta + rótulo + atribuída); o gate de catálogo confere que as duas existem nos dois idiomas. |
| Alguma tela ou aviso novo entrar junto | O plano não toca em renderer, no runner nem nos provedores; a única linha de interface é o texto das duas chaves que já existem. |
| Algum texto citar nome de empresa, pessoa, host ou número real de issue | Os textos usam só `coxia`, `triggerLabel` e os padrões de consulta neutros (`assignee=<usuário>`); a auditoria pública roda como gate. |

## Rollback

Reverter o commit devolve os três textos de hoje: a dica volta a falar só da caixa e a
configuração documentada volta a omitir a atribuição. Nenhum comportamento seria
afetado, porque nenhum comportamento mudou.
