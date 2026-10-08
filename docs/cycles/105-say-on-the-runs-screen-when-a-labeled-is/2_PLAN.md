# Unassigned labeled issues find a manual start on the runs screen

## Objetivo

Expor na tela de execuções as issues abertas do projeto que carregam o rótulo de gatilho e não
têm ninguém assumido (assignee), com um controle para iniciar a execução de uma delas à mão. A
varredura automática não muda e nada inicia sozinho a partir dessa lista.

## Abordagem

Hoje a varredura automática (`scan`) consulta as issues da própria pessoa com o rótulo de
gatilho (`listMyIssues`) e inicia runs até o limite; uma issue com o rótulo e sem assignee nunca
entra nessa consulta, então fica invisível. A mudança acrescenta uma **nova consulta** dedicada,
que lê as issues abertas do projeto com o rótulo de gatilho e filtra as que não têm assignee, e
**expõe essa lista à tela** de execuções por um canal de leitura próprio, junto de um botão de
"iniciar" que reutiliza o caminho manual de iniciar run por referência (`runs:start`).

Segue o desenho por camada, da leitura no provedor até o clique na tela:

1. **Consulta nova no fornecedor de issues do runner.** A interface `IssueSource` de
   `src/main/runner/service.ts` ganha um método `unassigned(label)` (ou nome equivalente), que
   retorna as issues abertas do projeto com o rótulo e sem nenhum assignee. A implementação usa
   `provider.listIssues({ project, scope: 'labels', labels: [label] })` — já suportada pelos
   provedores, sem mudança de host — e filtra `state === 'open'` e `assignees` vazio. O rótulo é
   o mesmo `runner.triggerLabel` da varredura.
2. **Implementação no módulo do runner.** Em `src/main/runner/module.ts`, o objeto `source`
   implementa o novo método. A consulta é de leitura, apenas lê o provedor, e não toca na
   varredura (`triggered` continua como está, intacto).
3. **Canal de leitura para a tela.** O runner serve um canal novo da família `runs:*` (por
   exemplo `runs:unassigned`) que devolve a lista em forma enxuta (número, ref, título,
   endereço). Como os demais `runs:*`, é uma leitura aberta ao navegador pareado e não sai pela
   porta de escrita — nada aqui escreve no host.
4. **Tela de execuções.** O component `RunsScreen.tsx` ganha uma seção que lista essas issues
   com um botão por item que chama `runsApi.start(ref)` (o caminho manual já existente). O botão
   fica desabilitado quando a issue já tem uma execução, e a tela trata os refusais (issue
   fechada, branch existente, duplicada) mostrando o motivo.
5. **Textos** novos vão pelos dois catálogos (`ui-cycle.en.json` e `ui-cycle.pt-BR.json`).

O ponto de apresentação (onde a seção entra, o texto do título e do botão) é decisão de produto
declarada pela spec como aberta; esta proposta coloca a seção sobre a lista de execuções, no
mesmo painel, com um título próprio.

## Decisões

- **Reutilizar `runs:start` como o gesto de iniciar**, não criar um canal de início dedicado: o
  caminho manual já refusa uma issue que já teve run (`duplicate` via `activeFor`) e reutiliza
  toda a criação de worktree, então o comportamento pedido pelo critério 7 (não duplicar
  execução sem confirmação) vem de graça, e a tela só desabilita/trata o refusal.
- **Nova consulta em vez de reaproveitar a varredura**: a varredura consulta `listMyIssues`
  (só issues da própria pessoa), então não alcança as sem assignee; a spec e a issue pedem uma
  consulta própria. Filtrar no app (por `assignees` vazio) sobre `listIssues` do rótulo é a
  forma neutra entre os provedores — todos trazem `assignees` na resposta da lista.
- **Um canal de leitura separado em vez de carregar tudo em `runs:list`**: a lista atual é de
  runs (execuções); a nova lista é de issues candidatas, então mantê-las separadas conserva a
  forma existente e o teste de política da web classifica o canal novo como leitura.

## Riscos e mitigação

1. **A nova consulta pode iniciar algo sozinho** se for acoplada à varredura. Mitigação: é
   uma leitura separada, exposta só à tela; a varredura (`scanIssues`/`triggered`) não é tocada
   e continua filtrando só issues assignadas à pessoa. Teste cobre que a varredura não inicia as
   sem assignee.
2. **Um canal novo na família `runs:*` pode escapar da classificação da política web.**
   Mitigação: o teste `test/runs-policy.test.ts` tem um caso que exige que todo canal servido
   por `module.ts` esteja classificado como aberto (ou externo); o canal novo deve entrar na
   lista de leituras do teste, e a expectativa de chamadas de `module.ts` (`listMyIssues`…)
   deve ganhar `listIssues`.
3. **Filtro de assignee divergente entre provedores.** Mitigação: o filtro usa o campo neutro
   `VcsIssue.assignees` (lista vazia = sem responsável) que todos os provedores preenchem na
   lista; cada provedor continua responsável por preencher esse campo corretamente.
4. **Issue sem assignee que já virou execução**: inicia-se de novo por acidente. Mitigação: o
   início manual já refusa duplicatas (`activeFor`), e a tela desabilita o botão quando a ref já
   aparece nas execuções da tela.
5. **Rótulo pendente de trava ou sem projeto de issues**: a consulta lê o mesmo
   `issues.project` da varredura e retorna lista vazia quando não há projeto de issues ou o
   rótulo não acha nada; a seção fica vazia e some da tela, sem erro.

## Como será testado

- **Teste de unidade da consulta nova** (na esteira de `test/runner-*.test.ts`, com o fake de
  issues em `test/helpers/runner.ts`): `unassigned(label)` retorna só issues abertas com o rótulo
  e sem assignee, e exclui issues fechadas, sem o rótulo ou com assignee.
- **Teste de política web** (`test/runs-policy.test.ts`): o canal novo de leitura é aberto ao
  navegador pareado e não é externo nem de desktop; a lista de canais servidos bate.
- **Teste da varredura intacta**: `scan()` não inicia uma issue com rótulo e sem assignee,
  mesmo estando na nova consulta (critério "nada inicia por si mesmo").
- **Teste de início manual**: iniciar por `runs:start` para uma ref da lista cria a execução e
  recusa uma segunda sem confirmação (critério 7), e o fake de issues registra a leitura.
- **Verificação de interface**: `npx tsc --noEmit`, `npx vitest run`, `npm run i18n:lint`
  (chaves novas nos dois catálogos), `node scripts/theme-audit.mjs` e
  `node scripts/public-audit.mjs`. O fluxo visual (seção na tela, botão iniciar) não foi
  executado nesta etapa e será exercitado no desenvolvimento/QA.

## Fora do escopo técnico

- A varredura automática não inclui as issues sem assignee (a spec pede explicitamente que nada
  inicie sozinho).
- Documentação e dica do campo de gatilho (ficaram na issue de origem da divisão).
- Mudança nos provedores de código (nenhuma nova capacidade de host é necessária).
