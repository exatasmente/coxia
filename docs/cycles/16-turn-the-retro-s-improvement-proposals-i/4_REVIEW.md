# Segunda revisão das propostas de melhoria da retro

## Como esta revisão foi feita

Somente leitura. Foram lidos o diff da branch, a especificação funcional, o plano técnico, o registro de implementação, os dois catálogos de texto, o instantâneo congelado dos catálogos (`test/fixtures/catalogs-main/*`) e a guarda que o compara com a árvore de trabalho, os quatro textos de ouro dos prompts, o código novo (`src/main/retroIssues.ts`), o código tocado (`src/main/retro.ts`, `src/main/runner/module.ts`), o caminho de aprovação de ações (`src/main/actions.ts`), a tela (`src/renderer/src/screens/RetroScreen.tsx`, `src/renderer/src/screens/Actions.tsx`) e o teste novo (`test/retro-issues.test.ts`).

Nenhum programa foi executado nesta etapa: o terminal desta cerimônia só aceita leitura. Por isso cada afirmação abaixo está separada entre o que foi conferido por leitura e o que ficou sem verificação. Uma intenção do registro de implementação não conta como verificado.

## O que a rodada anterior apontou e o que foi feito

Os quatro apontamentos eram sugestão; nenhum bloqueava. Os quatro foram tratados, conferidos por leitura:

| Apontamento da rodada anterior | Estado conferido |
|---|---|
| Colisão de chave em melhorias de título longo | Resolvido: um conjunto de chaves já usadas na mesma leva desempata com o índice (`src/main/retroIssues.ts:82-85`); a segunda melhoria deixa de ser engolida. Há teste próprio (`test/retro-issues.test.ts:184-199`) |
| Override morto no perfil de exemplo | Removido o bloco `promptOverrides.retro.improvementsFormat` de `docs/examples/legacy-profile.example.json` (o diff mostra o bloco apagado) |
| Campo supérfluo no dublê do modelo | Removido: o dublê de `test/squad-ceremonies.test.ts:28` devolve só `fala`, `numeros`, `funcionou`, `travou`, `retrabalho` |
| Comentário defasado na tela da retro | Reescrito (`src/renderer/src/screens/RetroScreen.tsx:91`): restou "The gate quizzes belong to the SDD cycle; any other cycle gets the neutral wording." |

Do lado do QA, os dois buracos apontados ganharam caso próprio: a integração que existe mas não escreve issue (`test/retro-issues.test.ts:306-317`) e a colisão de títulos (`:184-199`).

Uma divergência nova foi encontrada ao rodar os gates: sete chaves `ui.retro.*` que a decisão 5 do plano mandava deixar sem uso são, ao contrário do que o plano supunha, acusadas pelo próprio teste de lint (`test/ui-i18n.test.ts:81`, "leave no ui.* key unused"). Elas saíram dos dois catálogos de `ui-docs` e entraram em `REMOVED` com motivo (`test/gitlab-catalogs-unchanged.test.ts:105-118`). Conferido por leitura: nenhuma dessas chaves é usada em `src` (busca pelas chaves em toda a árvore). A correção está certa — manter as chaves deixaria a suíte vermelha —, e a exceção fica listada e motivada, como as demais.

## O que passa a acontecer (conferido por leitura)

- A retro não guarda nem mostra mais melhorias. O tipo do registro não tem o campo (`src/shared/types.ts`), a preparação não pede melhorias ao modelo e não as escreve (`src/main/retro.ts:127-175`) e a seção sumiu da tela e dos dois catálogos. Um registro antigo, escrito por uma versão anterior, continua legível: o campo sobra no arquivo e ninguém o lê (`read()` faz `JSON.parse` sem validação, `src/main/retro.ts:34-41`).
- Cada melhoria levantada na conversa da retro vira uma proposta na tela de Ações, na ordem em que veio, com o corpo montado a partir da dimensão, do problema de hoje, do que seria e da origem (data e identificador da retro). Nada é escrito no host nesse momento (`src/main/retroIssues.ts:61-101`).
- A proposta só é anunciada na conversa quando de fato entrou; uma proposta com a mesma chave que já espera, roda ou foi feita não é repetida (`src/main/retroIssues.ts:99-100`, deduplicação em `src/main/actions.ts:164-194`).
- Duas melhorias cujo título, depois de normalizado e cortado nos primeiros 40 caracteres, dá o mesmo valor agora geram duas propostas e duas falas, com chaves distintas (`src/main/retroIssues.ts:82-85`).
- O "sim" à proposta cria a issue no host e a tarefa na issue começa sozinha, sem um segundo "sim". Um ouvinte registrado pelo módulo do runner lê o número devolvido pelo host e chama o início da tarefa (`src/main/runner/module.ts:53-62` e `:86`; a resposta do host vira `{ iid }` por `createdIssueOf`, `src/shared/runs/links.ts:5-13`).
- Quando a área de trabalho não consegue virar a melhoria em issue — sem integração, sem escrita de issue, sem projeto de issues, ou título recusado pelo host — a melhoria fica só na conversa, com o motivo dito (`src/main/retroIssues.ts:33-54` e `:78-80`).
- Numa área de trabalho de testes, o "sim" é recusado antes de qualquer escrita e a proposta continua esperando (`src/main/actions.ts:456-513`, guarda em `assertExternalWrite`).
- Na tela de Ações, uma proposta de retro não mostra a linha de subtítulo (título de issue e estágio vazios): `src/renderer/src/screens/Actions.tsx:88` só renderiza o subtítulo quando há `issueTitle` ou `stage`.

## Especificação e plano

| Ponto da especificação / do plano | Estado conferido |
|---|---|
| A retro não produz nem guarda melhorias | O campo sai do tipo, da preparação e da tela (`src/main/retro.ts`, `RetroScreen.tsx`) |
| Cada melhoria da conversa vira proposta | Uma proposta por melhoria, na ordem; título colidente também gera a sua (`src/main/retroIssues.ts:67-101`) |
| A aprovação cria a issue e inicia a tarefa | Criação pelo caminho auditado; início pelo ouvinte do módulo (`module.ts:86`) |
| Melhoria impossível de virar issue fica na conversa | Quatro motivos cobertos (`retroIssues.ts:33-54`) |
| Registro antigo continua legível | Campo extra é ignorado na leitura |
| O prompt da retro deixa de pedir melhorias | `prompt.sdd.retro.main`, `prompt.scrum.retro.main` e `prompt.kanban.retro.main` sem a frase (conferido contra o instantâneo congelado) |
| O prompt `retro.ask` não muda de texto | Texto inalterado (`src/main/retro.ts:182`); ganha só `melhorias` nas chaves de schema |
| A guarda dos catálogos registra as exceções | Quatro entradas em `INTENDED` (com `language: 'both'` e substituição) e onze em `REMOVED`, cada uma com motivo |

## Regras do próprio repositório

- Texto voltado ao usuário sempre por `t()`: as dez chaves novas `main.retro.issue.*` existem nos dois catálogos (`src/shared/i18n/main.en.json` e `main.pt-BR.json`, linhas 52-61), e nenhum texto novo é literal. A tela usa os tokens de tema, sem cor literal. Conferido por leitura.
- Nenhum teste alcança modelo, host ou rede reais: o teste novo troca o modelo por um dublê e o host por um forge falso (`test/retro-issues.test.ts:14-31`, `test/helpers/fakeForge.ts`). Conferido por leitura.
- Sem atribuição de IA e sem trailer `Co-Authored-By` nos textos novos escritos nesta etapa: não aplicável — esta etapa não escreve código nem commits.
- Auditoria pública: as cadeias novas usam marcadores neutros (`group/project`, `app`, `git.example.test`); não apareceu nome de empresa, host ou pessoa real nos arquivos novos. O script de auditoria **não foi executado** nesta etapa.

## Testes

O teste novo `test/retro-issues.test.ts` cobre, por leitura, os caminhos que a especificação pede: nenhuma escrita antes do "sim" e nenhuma melhoria guardada (`:132-166`); a chave já pendente não é proposta de novo (`:168-182`); título colidente gera duas propostas (`:184-199`); o "sim" cria a issue no host, com trilha de auditoria, e a tarefa começa sozinha (`:219-239`); a recusa numa área de trabalho de testes, com a proposta ainda esperando (`:241-260`); o "não agora" não cria nada (`:262-278`); e os quatro motivos de melhoria que fica na conversa (`:281-345`). Também cobre o registro antigo e a ausência de melhorias no arquivo escrito (`:103-129`).

A guarda dos catálogos congelados confere, por leitura de string contra string: as frases `from` listadas em `INTENDED` batem com o instantâneo (`test/fixtures/catalogs-main/{en,pt-BR}.json:433,511,512` e `ui-docs.*.json:135`) e, aplicadas, produzem o texto da árvore de trabalho; as onze chaves de `REMOVED` estão ausentes dos dois catálogos da árvore e cada uma traz motivo (teste em `test/gitlab-catalogs-unchanged.test.ts:173-179`).

Os quatro textos de ouro trazem o prompt da retro sem a linha de melhorias e com o campo fora das chaves de schema, e o prompt da pergunta da retro (`retro-ask`) com o texto igual e só `melhorias` acrescentado às chaves de schema (`test/golden/en-prompts.json:376,413`, `en-prompts-novoice.json:376,413`, `legacy-prompts.json:466,513`, `legacy-prompts-novoice.json:466,513`). **Os textos de ouro não foram regenerados nem o teste de paridade foi rodado** nesta etapa; a paridade que os prenderia ao código depende de execução.

## Segurança

- A escrita externa continua atrás da guarda de área de trabalho de testes, e a recusa não gasta a proposta. Conferido por leitura.
- O motivo que vai para a conversa passa por redação e é cortado antes de ser dito (`src/main/retroIssues.ts:19`), o que evita levar segredo ou mensagem crua do host para o texto.
- O corpo da issue é montado a partir dos campos do modelo e de textos do catálogo; não há interpolação em shell.

## Achados

Nenhum achado nesta rodada. Os quatro apontamentos anteriores foram tratados como descrito acima, e a mudança desta rodada não introduziu defeito que a leitura alcançasse. Em particular, o desempate da chave está correto para o caso de duas ou mais melhorias que normalizam para o mesmo "slug": a primeira fica com a chave de sempre e as seguintes ganham o índice; a deduplicação entre rodadas, quando há uma só melhoria com aquele título, não muda.

## O que não foi verificado

- `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` e `electron-vite build`: nenhum foi executado. Esta etapa não executa programas — o terminal da cerimônia só aceita leitura.
- O teste de paridade dos textos de ouro, com os quatro arquivos como estão (editados à mão): a leitura mostra que a única diferença de prompt é a linha de melhorias que sai e o campo que entra nas chaves de schema, mas **não** é possível afirmar que passa sem rodar.
- A execução ponta a ponta de `test/retro-issues.test.ts`, em especial o caso da criação no host com início automático da tarefa e o da recusa em área de trabalho de testes: lidos, não rodados.
- Se o modelo preenche `melhorias` sem que o prompt da retro as peça: depende de execução real com um modelo, não observado.
- Se o cartão da proposta renderiza como descrito e se a execução começa de fato logo depois de a issue existir num rastreador real: a leitura e o teste com host falso são um substituto, não o comportamento real.

## Decisão

Aprovado. Nada do que foi conferido bloqueia: o comportamento bate com a especificação e o plano, os quatro apontamentos anteriores e os dois buracos do QA estão tratados, as chaves de texto existem nos dois catálogos, a guarda dos catálogos congelados está consistente por leitura e o caminho de aprovação mantém a guarda de escrita externa. O que resta é de execução, não de revisão: os gates e o teste de paridade dos textos de ouro precisam ser rodados antes do merge — se os textos de ouro divergirem, regerá-los com `UPDATE_GOLDEN=1` e conferir o diff.
