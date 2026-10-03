# Implementação: as melhorias da retro viram tarefa do fluxo de agentes

Os três passos do plano (§3) foram aplicados nesta árvore de trabalho. Nada foi commitado
e nenhum gate rodou até o fim: ver §5.

## 1. O que foi implementado, por passo do plano

### Passo 1 — a tela e o registro perdem a seção de melhorias

- `src/shared/types.ts`: `improvements` saiu de `Retro` e a interface `Improvement` foi apagada.
- `src/renderer/src/screens/RetroScreen.tsx`: apagados `improvementEntry`, o estado de copiado, a
  função que copiava, a seção inteira e o import de `errorText`, que só ela usava. O resto da tela
  (relato, números, funcionou, travou, retrabalho, conversa) ficou igual.
- `src/shared/i18n/ui-docs.{en,pt-BR}.json`: `ui.retro.intro` reescrito, a chave nova
  `ui.retro.introPlain` acrescentada e `ui.retro.improvements.{title,hint,hintPlain}` apagados.
- `test/gitlab-catalogs-unchanged.test.ts`: `INTENDED` ganhou `language?: 'pt-BR' | 'both'`
  (padrão `pt-BR`) e `replace` opcional; entrou o mapa `REMOVED` (chave → motivo), com um teste de
  que cada chave listada sumiu dos dois catálogos; o filtro dos diffs e a asserção de que nada
  sumiu do instantâneo passam a pular as chaves removidas.
- Regra 2 sem código novo: `read()` continua fazendo `JSON.parse(...) as Retro`, sem validar
  schema, então uma ata gravada com `improvements` abre e o campo extra é ignorado — é o que o
  caso 1 do teste novo confere.
- `test/retro-issues.test.ts` (novo): casos 1 e 2 de §5 do plano.

### Passo 2 — a melhoria nasce na conversa da retro

- `src/main/retro.ts`: `prepareRetro` perdeu o parâmetro `improvements` do prompt, a propriedade
  `melhorias` do schema e a linha `improvements` da gravação; `askRetro` pede `melhorias` no schema
  (opcional, absorvido com `?? []`) e chama `proposeRetroIssues` antes de `write`. `read`/`write`
  passaram a ser exportados como `readRetro`/`writeRetro`, porque a proposta e a nota releem a ata
  por id e o teste precisa semear a ata.
- `src/main/retroIssues.ts` (novo): por melhoria, na ordem em que vieram, decide o motivo de não
  dar (sem host → sem escrita de issue → sem projeto de issues → título recusado pelo host) e,
  quando dá, monta o corpo com `main.retro.issue.{dimension,problem,proposal,origin}` e propõe uma
  ação `vcs` com `unit {purpose:'retro-issue', retro, key}`, chave `retro-issue:<id>:<slug do
  título>` (cortado em 40), `issue: 0` e subtítulo vazio; também exporta `noteRetroIssue` (relê a
  ata por id e empilha a nota) e `failureText` (redação de segredo + corte em 300). Nada é escrito
  no host aqui: cada proposta espera o "sim".
- `src/shared/i18n/{en,pt-BR}.json`: `{improvements}` saiu de `prompt.sdd.retro.main`, a chave
  `prompt.sdd.retro.improvementsFormat` e a frase de "melhorias" dos prompts de retro de Scrum e
  Kanban foram apagadas, e entraram as nove chaves `main.retro.issue.*` nos dois idiomas.
  `prompt.sdd.retro.ask` não mudou.
- `src/renderer/src/screens/Actions.tsx`: o subtítulo do cartão só é renderizado quando há
  `issueTitle` ou `stage`, para o cartão da retro não mostrar " · " solto.
- `test/golden/{en,legacy}-prompts{,-novoice}.json`: editados à mão (ver §5, item 5).
- `test/retro-issues.test.ts`: casos 3 (proposta, Regra 3 e 6), 4 (deduplicação) e 8 (Regra 7).

### Passo 3 — a issue criada começa a tarefa

- `src/main/runner/module.ts`: `retroIssueDone(action, responses, start)` sai cedo quando
  `action.unit?.purpose !== 'retro-issue'`, lê a issue criada com `createdIssueOf(responses[0])`;
  sem número deixa a nota `main.retro.issue.noIssue`; com número chama
  `start(`${rc().issues.refPrefix}${made.iid}`)` e, se a execução não começar, deixa
  `main.retro.issue.noRun` com o motivo. Registrado como segundo `onRunnerActionDone`, ao lado do
  que entrega as respostas ao runner.
- `test/retro-issues.test.ts`: casos 5 (issue criada, auditada e execução iniciada), 6 (espaço de
  teste recusa a confirmação) e 7 (pular não cria nada).

## 2. Arquivos tocados

Modificados: `src/main/retro.ts`, `src/main/runner/module.ts`, `src/renderer/src/screens/Actions.tsx`,
`src/renderer/src/screens/RetroScreen.tsx`, `src/shared/types.ts`,
`src/shared/i18n/{en,pt-BR,main.en,main.pt-BR,ui-docs.en,ui-docs.pt-BR}.json`,
`test/gitlab-catalogs-unchanged.test.ts`, os quatro `test/golden/*.json`.
Novos: `src/main/retroIssues.ts`, `test/retro-issues.test.ts`.

## 3. O que foi verificado nesta etapa

Só leitura e só os dois comandos permitidos.

Lido (arquivo por arquivo, para sustentar cada asserção do teste novo):

- `test/retro-issues.test.ts` inteiro e as costuras de que ele depende: `test/helpers/runner.ts`
  (o `boot` reescreve a config inteira, com `projects.issues.project` `group/project` e um repo
  `app`), `test/helpers/fakeForge.ts` (POST `repos/group/project/issues` → issue 200, `writes`
  vazio antes do "sim"), `test/helpers/config.ts`.
- `test/gitlab-catalogs-unchanged.test.ts` inteiro, e a aritmética da guarda conferida à mão contra
  `test/fixtures/catalogs-main/*`: as quatro entradas de `INTENDED` (a frase de `ui.retro.intro` nos
  dois idiomas; `\n{improvements}` em `prompt.sdd.retro.main`; a frase de melhorias dos prompts de
  retro de Scrum e Kanban, nos dois idiomas) casam caractere a caractere com o texto do instantâneo,
  e as quatro chaves de `REMOVED` estão ausentes de `src/shared/i18n`.
- `src/main/retro.ts`, `src/main/retroIssues.ts`, `src/main/runner/module.ts` — o código aplicado.
- Os quatro `test/golden/{en,legacy}-prompts{,-novoice}.json`: o prompt `retro` não tem mais menção
  a melhoria nem `{improvements}`, as chaves de schema do `retro` são
  `[fala,numeros,funcionou,travou,retrabalho]` e o `retro-ask` ganhou `melhorias` na lista de chaves
  com o texto do prompt igual.
- As fontes renderizadas: `prompt.(sdd|scrum|kanban).retro.main` e as chaves `main.retro.issue.*`
  nos dois catálogos, `ui-docs.{en,pt-BR}.json`, e a ausência de `Improvement`,
  `ui.retro.improvements`, `improvementsFormat` e `improvementEntry` em `src/`.
- `test/squad-ceremonies.test.ts` ainda responde `melhorias: []`, que o `?? []` absorve.

Executado:

- `npm run typecheck` → código 127, `sh: 1: tsc: not found`.
- `npm test` → código 127, `sh: 1: vitest: not found`.

A causa é a árvore de trabalho não ter `node_modules` e `npm install` não estar entre os comandos
permitidos desta etapa.

## 4. O que não foi verificado

Todo o resto. Em particular, não rodados: `npx tsc --noEmit`, `npx vitest run`,
`node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`,
`electron-vite build` e a regeneração dos goldens com `UPDATE_GOLDEN=1`. O aplicativo não foi
aberto, nenhum modelo real foi chamado e nenhum host real foi tocado. Nada aqui prova que o código
compila, que o teste novo passa, que a guarda congelada passa com as novas entradas ou que a tela
renderiza como descrito: são asserções sobre leitura, não sobre execução. Ficam fora do alcance
desta etapa, e precisam de quem as rode: se o modelo preenche `melhorias` sem instrução no prompt;
se o cartão da retro renderiza como descrito; se a execução começa de fato logo depois da criação
da issue num host real; e se o diff dos goldens editados à mão corresponde ao que a regeneração
produziria.

## 5. Desvios do plano

1. `readRetro`/`writeRetro` exportados de `src/main/retro.ts`: o plano (§4.2/§4.3) manda reler a ata
   por id, mas não dizia como; as funções internas viraram `export const readRetro = read` e
   `export const writeRetro = write`, sem mudar o corpo.
2. `retroIssueDone` extraído e exportado, com o início da execução injetado por parâmetro, em vez
   do ouvinte inline de §4.3. O ouvinte inline só existe dentro de `runsModule`, que nenhum teste
   monta (o `boot` dos testes cria o runner por outro caminho); sem a extração o caso 5 não teria
   como ser exercitado. O comportamento é o do plano, e a única diferença é a assinatura.
3. `failureText` (redação de segredo + corte em 300, como `publish.ts` faz) em vez do `message(err)`
   que o plano escrevia: a nota vai para a conversa da retro.
4. `ui.retro.introPlain` **não** entrou em `INTENDED`, ao contrário de §4.5. É chave nova: não
   existe em `test/fixtures/catalogs-main/`, a guarda só percorre chaves do instantâneo e o teste
   "every intended difference still exists" reprova uma entrada de `INTENDED` sem diff. A lista de
   `INTENDED` ficou, então, com quatro entradas.
5. Os quatro `test/golden/*.json` foram editados à mão (o prompt `retro` perde a menção a melhorias
   e o `retro-ask` ganha `melhorias` nas chaves de schema, com o texto do prompt igual), porque
   `UPDATE_GOLDEN=1` não está entre os comandos desta etapa. A regeneração precisa ser conferida no
   passo de revisão.
6. Os três commits do plano não puderam ser feitos: esta etapa não commita. O assunto informado
   cobre os três passos.
7. `docs/examples/legacy-profile.example.json` ainda carrega
   `promptOverrides.retro.improvementsFormat`, um override que agora não casa com chave nenhuma. O
   plano não manda limpá-lo e nenhum teste o lê; ficou como estava.

## 6. Gates

Nenhum rodou (§3). O estado honesto deste passo é: código e teste escritos, árvore não compilada e
não testada.
