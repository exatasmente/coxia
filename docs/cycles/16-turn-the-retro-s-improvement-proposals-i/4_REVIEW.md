# Revisão do que a retro passa a levantar

## Como esta revisão foi feita

Somente leitura. Foram lidos o diff da branch, a especificação funcional, o plano técnico, o
registro de implementação, os catálogos de texto (`src/shared/i18n/*.json`), o instantâneo
congelado (`test/fixtures/catalogs-main/*`) e a guarda que o compara com a árvore de trabalho,
os quatro textos de ouro dos prompts, o código novo (`src/main/retroIssues.ts`), o código tocado
(`src/main/retro.ts`, `src/main/runner/module.ts`), o caminho de aprovação de ações
(`src/main/actions.ts`) e a tela da retro.

Nenhum teste, gate ou build foi executado nesta etapa: não há `node_modules` na worktree e a
etapa é somente leitura. Por isso cada afirmação abaixo está separada entre o que foi conferido
por leitura e o que ficou sem verificação. Uma intenção do registro de implementação não conta
como verificado.

## O que passa a acontecer

- A retro não guarda nem mostra mais melhorias. O tipo do registro não tem mais o campo; a
  preparação não pede melhorias ao modelo e não as escreve; a seção correspondente sumiu da tela
  e do catálogo. Um registro antigo, escrito por uma versão anterior, continua legível: o campo
  sobra no arquivo e ninguém o lê. (Conferido por leitura: `src/main/retro.ts:127-175`,
  `src/main/retro.ts:178-189`, `src/renderer/src/screens/RetroScreen.tsx`, tipo em
  `src/shared/types.ts`.)
- Cada melhoria levantada na conversa da retro vira uma proposta na tela de Ações, na ordem em que
  veio, com o texto do corpo montado a partir da dimensão, do problema de hoje, do que seria e da
  origem (data e identificador da retro). Nada é escrito no host nesse momento. (Conferido por
  leitura: `src/main/retroIssues.ts:61-98`.)
- A proposta só é anunciada na conversa quando de fato entrou; uma proposta com a mesma chave que
  já espera, roda ou foi feita não é repetida. (Conferido por leitura: `src/main/retroIssues.ts:83-96`,
  deduplicação em `src/main/actions.ts:164-194`.)
- O "sim" à proposta cria a issue no host e a tarefa na issue começa sozinha, sem um segundo "sim".
  Um ouvinte registrado pelo módulo do runner lê o número devolvido pelo host e chama o início da
  tarefa. (Conferido por leitura: `src/main/runner/module.ts:53-62` e `:86`; a resposta do host vira
  `{ iid }` por `createdIssueOf`, `src/shared/runs/links.ts:5-13`.)
- Quando a área de trabalho não consegue virar a melhoria em issue — sem projeto de issues, sem
  integração que segure as issues, ou título recusado pelo host — a melhoria fica só na conversa,
  com o motivo dito. (Conferido por leitura: `src/main/retroIssues.ts:34-54` e `:76-79`.)
- Numa área de trabalho de testes, o "sim" é recusado antes de qualquer escrita e a proposta
  continua esperando. (Conferido por leitura: `src/main/actions.ts:456-513`, guarda em
  `assertExternalWrite`.)
- Na tela de Ações, uma proposta de retro não mostra a linha de subtítulo (título de issue e
  estágio vazios). (Conferido por leitura: `src/renderer/src/screens/Actions.tsx:88`.)

## Especificação e plano

| Ponto da especificação / do plano | Estado conferido |
|---|---|
| A retro não produz nem guarda melhorias | O campo sai do tipo, da preparação e da tela (`src/main/retro.ts`, `RetroScreen.tsx`) |
| Cada melhoria da conversa vira proposta | Uma proposta por melhoria, na ordem (`src/main/retroIssues.ts:66-97`) |
| A aprovação cria a issue e inicia a tarefa | Criação pelo caminho auditado; início pelo ouvinte do módulo (`module.ts:86`) |
| Melhoria impossível de virar issue fica na conversa | Três motivos cobertos (`retroIssues.ts:34-54`) |
| Registro antigo continua legível | Campo extra é ignorado na leitura |
| O prompt da retro deixa de pedir melhorias | `prompt.sdd.retro.main`, `prompt.scrum.retro.main` e `prompt.kanban.retro.main` sem a frase (conferido contra o instantâneo) |
| O prompt `retro.ask` não muda | Sem alteração (`src/main/retro.ts:180-184`); texto de ouro do `retro-ask` inalterado |
| A guarda dos catálogos registra as exceções | Quatro entradas em `INTENDED` e quatro em `REMOVED`, com motivo |

Uma divergência entre o plano e o código foi resolvida em favor do código e está correta: o plano
listava `ui.retro.introPlain` entre as diferenças intencionais, mas essa chave não existe no
instantâneo congelado. Listá-la faria o teste "toda diferença intencional ainda existe" falhar, já
que nenhuma diferença seria produzida. A implementação a omitiu — conferido por leitura em
`test/fixtures/catalogs-main/ui-docs.en.json` e `pt-BR.json` (só a chave `ui.retro.intro` está lá).

## Regras do próprio repositório

- Texto voltado ao usuário sempre por `t()`: as dez chaves novas `main.retro.issue.*` existem nos
  dois catálogos (`src/shared/i18n/main.en.json` e `main.pt-BR.json`, linhas 52-61), e nenhum texto
  novo é literal. A tela usa os tokens de tema, sem cor literal. (Conferido por leitura.)
- Nenhum teste alcança modelo, host ou rede reais: o teste novo troca o modelo por um dublê e o
  host por um forge falso. (Conferido por leitura: `test/retro-issues.test.ts:14-31`,
  `test/helpers/fakeForge.ts`.)
- Sem atribuição de IA e sem trailer `Co-Authored-By` nos textos novos escritos nesta etapa: não
  aplicável — esta etapa não escreve código nem commits.
- Auditoria pública: as cadeias novas usam marcadores neutros (`group/project`, `acme/app`,
  `git.example.test`); não vi nome de empresa, host ou pessoa real nos arquivos novos. O script de
  auditoria **não foi executado** nesta etapa.

## Testes

O teste novo `test/retro-issues.test.ts` cobre, por leitura, os quatro caminhos que a especificação
pede: nenhuma escrita antes do "sim"; a criação no host no "sim", com trilha de auditoria e início
da tarefa; a recusa numa área de trabalho de testes, com a proposta ainda esperando; e os três
motivos de melhoria que fica na conversa. Também cobre o registro antigo e a ausência de melhorias
no arquivo escrito.

A guarda dos catálogos congelados confere, por leitura de string contra string: as frases `from`
listadas em `INTENDED` batem exatamente com o instantâneo (`test/fixtures/catalogs-main/{en,pt-BR}.json`
linhas 433, 511, 512 e 135) e, aplicadas, produzem exatamente o texto da árvore de trabalho
(`src/shared/i18n/{en,pt-BR}.json` linhas 438, 516, 517 e `ui-docs.*.json:140`). As quatro chaves de
`REMOVED` estão ausentes dos catálogos da árvore.

Os quatro textos de ouro trazem o prompt da retro sem a linha de melhorias e terminando em
`…evidence (issue, date).` seguido do resumo da semana, tanto em inglês quanto no perfil herdado e
nas duas variantes de voz (`test/golden/en-prompts.json:376`, `en-prompts-novoice.json:376`,
`legacy-prompts.json:466`, `legacy-prompts-novoice.json:466`). O texto de ouro do `retro-ask` não
muda. **Os textos de ouro não foram regerados nem o teste de paridade foi rodado** nesta etapa.

## Segurança

- A escrita externa continua atrás da guarda de área de trabalho de testes, e a recusa não gasta a
  proposta. (Conferido por leitura.)
- O motivo que vai para a conversa passa por redação e é cortado antes de ser dito
  (`src/main/retroIssues.ts:19`), o que evita levar segredo ou mensagem crua do host para o texto.
- O corpo da issue é montado a partir dos campos do modelo e de textos do catálogo; não há
  interpolação em shell.

## Achados

Todos são sugestão; nenhum bloqueia.

1. Colisão de chave em melhorias de título longo. Duas melhorias cujo título, depois de virar
   "slug" e ser cortado em 40 caracteres, dá o mesmo valor produzem a mesma chave; a segunda não
   ganha proposta **nem** nota na conversa (a nota só é dita quando a proposta entrou).
   `src/main/retroIssues.ts:81` e `:96`. Sugestão: acrescentar o índice quando o "slug" colidir,
   para que nenhuma melhoria se perca em silêncio.
2. `docs/examples/legacy-profile.example.json:350` guarda um override `retro.improvementsFormat`
   que não casa com chave de prompt nenhuma depois desta mudança. É inerte, mas o exemplo passa a
   documentar um prompt que não existe. Sugestão: remover o bloco.
3. `test/squad-ceremonies.test.ts:28` ainda devolve `melhorias: []` no dublê do modelo, campo que
   não faz parte do que a retro pergunta agora. Inofensivo, mas confunde quem lê. Sugestão: tirar o
   campo do dublê.
4. `src/renderer/src/screens/RetroScreen.tsx:91`: a primeira metade do comentário ("The
   IMPROVEMENTS.md convention and the gate quizzes belong to the SDD cycle") fala de um fluxo de
   melhorias que não existe mais. Sugestão: reescrever a frase para o que sobrou (os quizzes de
   gate).

Nota (não é achado): as chaves `ui.retro.entry.*`, `ui.retro.copied`, `ui.retro.copyEntry`,
`ui.retro.problem` e `ui.retro.proposal` continuam nos catálogos sem uso — é o que a decisão 5 do
plano escolheu de propósito, para não somar exceções. O lint de i18n não reprova chave sem uso.

## O que não foi verificado

- `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`,
  `node scripts/public-audit.mjs` e `electron-vite build`: nenhum foi executado. A worktree não tem
  `node_modules` e esta etapa não roda comandos.
- O teste de paridade dos textos de ouro, com os quatro arquivos como estão (editados à mão): a
  leitura mostra que a única diferença de prompt é a linha de melhorias que sai, mas **não** é
  possível afirmar que passa sem rodar.
- A execução ponta a ponta de `test/retro-issues.test.ts`, em especial o caso da criação no host e
  o da recusa em área de trabalho de testes: lidos, não rodados.
- O conteúdo dos trailers das mensagens de commit do ciclo: não conferido por comando.

## Decisão

Aprovado. Nada do que foi conferido bloqueia: o comportamento bate com a especificação e o plano, as
chaves de texto existem nos dois catálogos, a guarda dos catálogos congelados está consistente por
leitura e o caminho de aprovação mantém a guarda de escrita externa. Os quatro achados são de
higiene e podem sair depois. O que resta é de execução, não de revisão: os gates e o teste de
paridade precisam ser rodados antes do merge — se os textos de ouro divergirem, regerá-los com
`UPDATE_GOLDEN=1` e conferir o diff.
