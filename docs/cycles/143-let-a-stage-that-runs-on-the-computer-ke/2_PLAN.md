# O plano da etapa que roda no computador guardar a comprovação

## Ponto de partida e dependência

O que este plano muda é uma condição só: hoje a comprovação de uma etapa existe quando
`session?.stageDir && d.keepEvidence`, e a sessão de host não tem `stageDir`. A etapa de host
que testa uma interface passa a valer igual à de sandbox porque **a raiz de leitura da
comprovação vira um dado da sessão**, com dois valores possíveis:

- uma sessão de sandbox declara `<pasta de etapa>/out` (o que ela já faz, de outra forma);
- uma sessão de host com teste de interface declara o `out` da pasta de saída que ela mesma
  cria (o `gui.out` de hoje, que o prompt apresenta em `COXIA_OUT` e que a leitura de imagem
  já conhece — D1);
- uma sessão de host **sem** teste de interface continua sem pasta nenhuma: a pasta nasce
  com os navegadores ou com a tela virtual, nada mais (D2).

Com isso, todo o resto do executor (montar as ferramentas, oferecer o campo `evidence` no
esquema, acrescentar a regra ao prompt, guardar o que foi visto e não guardado antes de a
sessão fechar) deixa de perguntar por `stageDir` e passa a perguntar por "a sessão declara uma
pasta de comprovação". Nenhuma regra de comprovação é reescrita: caminho, link, tipo pelos
bytes, teto e ids continuam sendo lidos dos mesmos dois arquivos (`paths.ts`, `store.ts`).

**Dependência da #142:** esta mudança se apoia no fecho que a #142 acrescentou — a guarda do
que foi visto e não guardado rodando antes de `session?.close()`. Lido nesta cópia: o import
`backEvidence`, a função `keepLooked`, a lista `lookedPaths`, o gancho `onLooked` entregue ao
motor e a chamada `if (session) keepLooked()` antes do `close()` no `finally`. A `#142` está,
portanto, na base desta cópia. **Não verificado:** que ela esteja mesclada na ramificação de
onde a implementação vai sair — quem implementar confirma com uma busca pelo sufixo do fecho
(`lookedPaths`/`keepLooked` em `src/main/runner/executor.ts`); sem ele, o plano para e diz
isso, em vez de tratar o host como caso à parte.

## Mudanças, por arquivo e função

A ordem abaixo é a de execução; os testes de cada passo são os da seção seguinte.

### 1. `src/main/sandbox/session.ts` — `SandboxSession`

Acrescentar um campo opcional, ao lado de `stageDir` / `gui` / `readImage`:

```ts
/** A folder kept for this stage where the evidence tools and `ViewImage` read from; absent: this session has none. */
readonly outputDir?: string;
```

Não mexer em `stageDir`: ele continua sendo o que a sandbox declara e o que a sessão de host
não tem. O campo é declarativo (a pasta já existe, quem a cria é a sessão); nenhum código novo
cria pasta.

### 2. `src/main/sandbox/host.ts` — `openHostSession`

Na sessão devolvida, declarar `outputDir: shots` junto de `gui` e `readImage`, apenas quando
`gui` existe (ou seja: `o.gui` foi passado):

```ts
...(gui && shots ? { gui, outputDir: shots, readImage: (path: string) => readOutputImage(shots, path, shots) } : {}),
```

Nada mais muda nesta função: a pasta já é criada (`mkdtempSync` + `mkdirSync(shots)`) e já é
apagada inteira no `close()` — é justamente por isso que a guarda de fecho precisa rodar antes.

### 3. `src/main/sandbox/session.ts` — `openSession`

Na sessão da sandbox, declarar `outputDir: out` (o `out` que a função já calcula e já usa em
`readImage`). Nenhuma criação nova de pasta.

### 4. `src/main/evidence/paths.ts` — `resolveOutputPath`

Trocar o primeiro parâmetro de `stageDir: string` por `outRoot: string` e passar a usar a raiz
diretamente, em vez de `outputDirOf(stageDir)`:

```ts
export function resolveOutputPath(outRoot: string, input: unknown): ResolvedOutput
```

O corpo muda em uma linha (`const root = outRoot;`). Os dois usos (`handlers.ts`, em `save`,
`sourceOf` e `annotate`) e os testes que chamam a função passam o mesmo valor que passam hoje,
mas como pasta de saída (`outputDirOf(stageDir)` ou `session.outputDir`).

`outputDirOf` continua existindo porque a sandbox precisa dela (uma função, um uso): é a única
forma de a sessão de sandbox declarar a raiz a partir da pasta de etapa. O comentário do topo
do módulo precisa dizer que a pasta de saída agora é a que a sessão declarar — `/coxia/out` na
sandbox, o `out` da pasta temporária no host.

### 5. `src/main/evidence/handlers.ts` — `EvidenceContext` e os três verbos

- `EvidenceContext.stageDir` vira `outputDir`.
- `save` e `sourceOf` chamam `resolveOutputPath(ctx.outputDir, ...)`.
- `annotate` monta o destino do PNG marcado a partir da raiz, sem depender do nome `stageDir`:
  `const target = join(ctx.outputDir, name)` (hoje é `` `${ctx.stageDir}/out/${name}` ``), e a
  checagem de que o nome é novo continua igual (o resolvedor recusa com `missing` um nome que
  ainda não existe — o caminho pelo `resolveOutputPath` fica como está).
- O comentário do topo deixa de dizer "a pasta que a etapa fez, `out` dentro dela".

Nenhuma regra muda: mesma ordem de recusas, mesmas palavras de recusa (`outputProblemText`,
`evidenceProblemText`), mesmo `putEvidence`.

### 6. `src/main/evidence/engineTool.ts`

Só se o nome do campo for lido lá — conferido nesta cópia: não é (o adaptador só repassa
`EvidenceTools`). Sem mudança.

### 7. `src/main/runner/executor.ts` — o ponto único

Uma constante local logo depois de a sessão ser aberta em `runStage`:

```ts
// A sandbox and a host session that tests an interface both declare where the stage's evidence lives; a host session without one keeps what it has today.
const evidenceRoot = session?.outputDir;
```

Substituições, todas dentro de `runStage` (nomes de linha conferidos nesta cópia):

| Hoje | Passa a ser |
|---|---|
| `input.evidence = !!(session?.stageDir && d.keepEvidence)` (linha 609) | `!!(evidenceRoot && d.keepEvidence)` |
| `evidenceToolsOf({ stageDir: session.stageDir, … })` (linhas 677–699) + a condição | condição `evidenceRoot && d.keepEvidence`, contexto com `outputDir: evidenceRoot` |
| `keepLooked`: `const dir = session?.stageDir` (linha 646) | `const dir = evidenceRoot` |
| `lookedNames`/resolução dentro de `keepLooked` | `resolveOutputPath(dir, path)` sem mudança |

`input.evidence` (o texto de regras que a etapa recebe) passa a ser verdadeiro também na etapa
de host que testa uma interface — e só nela, porque `evidenceRoot` só existe nessa sessão.
O campo `evidence` do esquema muda pelo mesmo booleano (`outputSchema(kind, { …, keepsEvidence: !!evidence })`, linha 707): nada a mudar ali.

A chamada `if (session) keepLooked()` (linha 863) continua igual: `keepLooked` já se protege
por não ter raiz nem guardião.

**Uma correção de coerência, no mesmo passo:** as três chaves do catálogo que ensinam a pasta
de saída dizem `/coxia/out` fixo —
`prompt.sdd.runner.rules.evidence` (a regra de comprovação da etapa),
`prompt.sdd.runner.output.evidence` (o texto de saída de QA) e as chaves de recusa que citam o
caminho. Na etapa de host que testa uma interface elas passariam a citar um caminho que não
existe. O plano troca essa menção fixa por um parâmetro com o valor da raiz, do mesmo jeito que
`runner.rules.gui.host` já recebe `{out}` hoje:

- `prompt.rules.evidence` → `runner.rules.evidence` (já é o id usado em `prompt.ts`), com
  `{out}` e a nova variante `prompt.sdd.runner.rules.evidence.host` (a etapa de host é avisada
  em `COXIA_OUT`, e o texto manda usar esse caminho);
- `runner.output.evidence` com `{out}`;
- a descrição da ferramenta de comprovação (`evidence/tool.ts`), se ela citar `/coxia/out` —
  **a conferir na implementação** (esta leitura não abriu esse arquivo).

Nada disso muda o que a etapa com sandbox lê: `{out}` recebe `/coxia/out` por padrão.

### 8. `src/main/runner/prompt.ts`

- `StageInput.evidence` continua um booleano; a linha que o usa passa a receber a raiz para a
  variante de host (a mesma que `guiRules` já recebe em `i.sandbox.gui.out`):

```ts
i.evidence ? cp(i.sandbox?.host && i.sandbox.gui?.out ? 'runner.rules.evidence.host' : 'runner.rules.evidence', { out: i.sandbox?.gui?.out ?? OUT }) : '',
```

- Em `stagePrompt`, a parte de QA da saída usa `cp('runner.output.evidence', { out })` quando
  `i.sandbox?.gui?.out` existe.
- `prompt.ts` importa `OUT` de `../sandbox/policy` (o mesmo `/coxia/out` que
  `sandbox/tool.ts` já usa para a descrição de `ViewImage`).

### 9. `src/shared/i18n/main.en.json` e `main.pt-BR.json`

Chaves novas/alteradas, nos dois catálogos, com `{out}`:

- `prompt.sdd.runner.rules.evidence` → passa a receber `{out}` (sandbox: `/coxia/out`);
- `prompt.sdd.runner.rules.evidence.host` → nova, para a etapa de host (fala de `COXIA_OUT`
  e do caminho real, sem "dentro da sandbox");
- `prompt.sdd.runner.output.evidence` → passa a receber `{out}`;
- o texto da tela que fala de evidência não muda (a tela lê o registro da execução, não o
  caminho).

`npm run i18n:lint` é o que prova que as duas línguas dizem o mesmo.

### 10. `CHANGELOG.md` (material da implementação ou do fecho, não deste plano)

Uma linha sob `## [Unreleased]`, sem número de issue nem nome de arquivo: o que muda para
quem usa é que uma etapa cujo agente roda no computador passa a conseguir guardar comprovação,
e o que ela produziu para testar uma interface não some mais com a pasta temporária.

## Ordem, e o que não muda

1. `session.ts` + `host.ts` + `openSession` (a sessão declara a raiz);
2. `paths.ts` → `handlers.ts` (a raiz vem de fora);
3. `executor.ts` (a condição única da comprovação);
4. `prompt.ts` + catálogos;
5. `CHANGELOG.md`, no fim.

Fora do plano, como a especificação fixou: nenhuma pasta de etapa nova para o host, nenhum
critério novo de "testa uma interface", nenhuma mudança de layout, nome ou contador de ids,
nenhuma mudança na etapa de sandbox, e nada de escrever no host de código fora de `Actions`
(nada aqui escreve fora do disco).

## Testes, um por comportamento

Todos com fakes: nenhum teste abre sandbox real, tela real, modelo ou rede. Os arquivos já
existem e já têm o cenário e as asserções vizinhas; o que segue é o que cada um ganha.

**`test/host-gui.test.ts`** (a sessão de host, sem executor):

1. no caso "sem nada foi pedido", acrescentar `expect(s.outputDir).toBeUndefined()`; no caso
   com navegadores e tela, acrescentar `expect(s.outputDir).toBe(s.gui?.out)` e
   `expect(s.stageDir).toBeUndefined()` (critérios 1 e 4);
2. no caso que já prova que a pasta sumiu depois do `close()` (o da leitura de imagem),
   guardar a pasta antes do fecho e afirmar que ela não existe depois — é o que prova que a
   guarda do fecho precisa rodar antes.

**`test/evidence-path.test.ts`** (o resolvedor, critério 2):

3. o arquivo passa a chamar `resolveOutputPath(join(stageDir, 'out'), …)`; o teste novo roda
   os mesmos casos sobre uma raiz que é a pasta do host (um `mkdtempSync` com `out` dentro):
   aceita o relativo e o absoluto dentro dela, recusa o absoluto de fora, o `..` e o link,
   com os mesmos `problem`. O teste que usa `join(stageDir, 'out', 'shot.png')` precisa
   continuar passando com a raiz nova.

**`test/runner-evidence.test.ts`** (as ferramentas, altura do `evidenceToolsOf`):

4. acrescentar um caso em que `world()` recebe uma raiz que não é `<pasta de etapa>/out` (um
   `stageDir` falso, para provar que o nome do campo não importa mais): guardar um arquivo de
   lá responde `ev-1` e o tipo sai dos bytes; um caminho `../x` e um link de fora são recusados
   com as palavras de sempre (critérios 1 e 2);
5. `annotate` com `source` de um ev do mesmo mundo escreve o PNG marcado **na raiz declarada**:
   afirmar que o arquivo existe sob a raiz e que o `from` do registro é o id original
   (protege a mudança do passo 5).

**`test/runner-evidence-run.test.ts`** (o executor ponta a ponta; já tem a infraestrutura
inteira — `boot`, `fakeSandbox`, `keepAndCite`, o fluxo até `ready`):

6. um caso igual aos de hoje, com o QA em `shell: 'host'` e o `fakeSandbox` recebendo
   `gui: { browsers: '/b/ms-playwright', display: 'on', out: <pasta real do teste> }`: o id
   guardado aparece em `run.evidence`, um cenário de QA o cita e ele chega ao host de código
   como hoje (critério 1, e é aqui que o host passa a valer o que a sandbox já vale);
7. o mesmo caso com `shell: 'host'` e **sem** `gui` no fake: `AgentCall.evidence` é
   `undefined`, o esquema pedido não tem o campo `evidence` e `run.evidence` fica vazio
   (critério 4, o "continua como hoje");
8. um caso de host em que o agente guarda a comprovação pela ferramenta e o `call.exec` é a
   sessão de host: o `system` recebe a regra de comprovação com o caminho da pasta real do
   host, e não com `/coxia/out` (critério 5).

**`test/runner-qa-repair.test.ts`** (o que foi visto e não guardado, critério 3):

9. um caso em que o QA de host abre uma imagem da pasta de saída com `viewImageToolImpl` e
   não a guarda: ao fim, ela está em `run.evidence` com `title` do "guardado pelo app", e a
   conversa tem a linha `runner.qa.lookKept` — a mesma asserção do caso de sandbox que já
   existe;
10. o sinal de que a guarda rodou **antes** do fecho: o `fakeSandbox` já chama `onClose` no
    fecho da sessão; o teste lê, dentro de `onClose`, se o id já está em `run.evidence` (ou
    usa o mesmo recurso do teste de sandbox que guarda o HEAD no fecho, em
    `test/runner-sandbox.test.ts`), e o arquivo da pasta some depois.

**`test/runner-sandbox.test.ts`** + a suíte de comprovação da sandbox (critério 6 da
especificação): nada a escrever; a exigência é que os testes que já existem passem **sem
mudança de expectativa** — o único ajuste permitido é o da raiz do resolvedor (caso 3). Uma
expectativa que precise mudar é sinal de que a etapa de sandbox mudou.

**`npm run i18n:lint`** prova o critério 7 (as duas línguas com as mesmas chaves).
**A olho** prova o critério 8 (`CHANGELOG.md`).

Mudança mínima no helper, para os casos 6–10: `test/helpers/runner.ts` — `keepQaEvidence` e o
`stageDir` dos testes de host passam a ler `call.exec?.outputDir` como pasta de saída (com o
`stageDir` continuando valendo para a sandbox). O `fakeSandbox` já cria uma pasta real com
`out` dentro e já aceita `gui.out`; o que o teste do executor precisa é que a pasta declarada
em `gui.out` seja uma pasta **real** do teste, com o arquivo gravado nela, para a guarda do
fecho poder lê-lo.

## Riscos, e como cada um é contido

- **A etapa com sandbox mudar sem querer.** É o risco maior, porque a condição única do
  executor é a mesma para os dois modos. Contido por: um único ponto de decisão
  (`evidenceRoot`), nenhuma regra reescrita em `paths.ts`/`store.ts`, e a suíte de comprovação
  da sandbox passando sem mexer nas expectativas (o único ajuste permitido é o da raiz do
  resolvedor, no teste 3).
- **Um host session declarar pasta quando não testa interface.** Se `gui` for passado sem
  navegadores e sem tela, a pasta nasce e a etapa ganha ferramenta e texto novos. Contido por:
  `openHostSession` só declara `outputDir` dentro do ramo que já produz `gui`, e o
  `createSandboxService.openHost` só passa `gui` quando `wantsGui` (navegadores, pasta
  sumida, ou tela pedida com a chave ligada) — lido nesta cópia nas linhas 276–314. O teste 7
  é o que trava isso.
- **A guarda do fecho correr depois de a pasta sumir.** Um `close()` adiantado deixaria a
  imagem sem origem. Contido por: a chamada continua no `finally` do `runStage`, antes do
  `close()` da sessão, e o teste 10 olha o estado no instante do fecho.
- **O caminho errado no texto que a etapa recebe.** A etapa de host passaria a ler
  `/coxia/out`, que não existe ali. Contido por: a variante `.host` da chave de regras, o
  `{out}` na chave de saída de QA, e o teste 8 (que lê o `system` da chamada).
- **A imagem marcada cair fora da pasta.** O `annotate` hoje monta o destino concatenando
  `/out`. Contido por: o destino passar a sair da raiz declarada, com o teste 5.
- **Um arquivo de fora do host entrar como comprovação.** As recusas vêm do mesmo resolvedor;
  o risco é a raiz estar errada (apontando para o `tmp` inteiro, por exemplo). Contido por: a
  raiz ser a pasta de saída da sessão (o `out` dentro da pasta temporária, nunca a pasta
  temporária inteira), e os testes 3 e 4.
- **A suíte de host ficar lenta ou presa.** Nenhum teste novo abre sessão real: o de executor
  usa o fake; os de sessão real já existem e já rodam.

## Decisões tomadas neste plano (e o motivo)

1. **A raiz é um campo da sessão (`outputDir`), não uma pasta de etapa para o host.** É D1,
   levada ao código sem uma segunda condição: um lugar só decide se a etapa tem comprovação,
   e a sandbox declara a sua raiz do mesmo jeito.
2. **`resolveOutputPath` recebe a raiz, não a pasta de etapa.** Com o parâmetro antigo, a
   função era incapaz de expressar a pasta do host sem inventar `<pasta de etapa>/out` para
   uma etapa que não tem pasta de etapa. A mudança é de forma, não de regra.
3. **Não duplicar as ferramentas de comprovação para o host.** As regras são as mesmas nos
   dois modos (a especificação pede isso); duas cópias seriam duas coisas a manter iguais.
4. **O texto novo da regra de comprovação entra como variante `.host`, com `{out}`.** É o
   mesmo recurso que `runner.rules.gui.host` já usa; a alternativa (uma frase única, neutra
   quanto ao caminho) perderia a instrução de onde guardar, que é o que faz o agente acertar.
5. **`lookedPaths` continua um conjunto de caminhos, sem mudança.** A guarda já resolve o que
   recebe pelo mesmo resolvedor; corrigir a semântica do conjunto é do escopo da #142 e não
   muda nada para o host.
6. **Nenhuma migração de configuração.** Não há campo de configuração novo: as duas chaves do
   teste de interface e a escolha de onde a comprovação fica continuam como estão (a regra do
   time de que mudança de configuração precisa de passo em `STEPS` e nos três arquivos não se
   aplica aqui).
7. **A mensagem inicial do host não muda.** Nenhuma linha de conversa nova é acrescentada por
   esta mudança: a etapa de host que guarda comprovação já publica cada peça pelo caminho
   comum (`runner.qa.lookKept`, `runner.qa.lookNotKept`, `d.keepEvidence`), e é ali que a
   pessoa vê o que foi guardado. Uma linha própria do host daria duas formas de dizer a mesma
   coisa.

## Critérios de aceite que o plano cobre

1 (ferramentas e id na execução): passos 1–7 e testes 4, 6, 8.
2 (recusa fora da pasta): passo 4 e testes 3, 4.
3 (visto e não guardado antes do fecho): passo 7 e testes 9, 10.
4 (host sem teste de interface como hoje): passos 1–3 e testes 1, 7.
5 (o texto nomeia a pasta real): passos 8, 9 e teste 8.
6 (a sandbox não muda): passos 3, 4 e a suíte existente sem mudança de expectativa.
7 (duas línguas): passo 9 e `npm run i18n:lint`.
8 (nota de lançamento): passo 10, no `CHANGELOG.md` sob `## [Unreleased]`.

Nenhum critério fica fora. Nada aqui pausa numa pergunta: as duas decisões que estavam
abertas foram fixadas na especificação e este plano não reabre nenhuma delas.

## O que este plano não verificou

- O modo host não foi exercitado em nenhuma etapa: nada foi executado, nenhuma tela, nenhum
  comando, nenhum teste rodado. Tudo o que este plano diz do código de hoje foi lido em
  arquivo nesta cópia.
- Que a #142 esteja mesclada na ramificação da implementação: o fecho está nesta cópia, o
  histórico não foi consultado (não há acesso ao git nesta etapa).
- O texto exato da descrição da ferramenta de comprovação (`src/main/evidence/tool.ts`): não
  foi aberto; se ele citar `/coxia/out` fixo, entra no passo 8/9 como uma chave a mais.
- O comportamento de uma etapa de host que roda de novo sobre comprovação já guardada: a
  sessão nova declara uma pasta nova e temporária, e o que se espera é o mesmo de uma sandbox
  que roda de novo (mesmas ferramentas, ids por execução, mesma guarda de fecho) — não
  exercitado.
