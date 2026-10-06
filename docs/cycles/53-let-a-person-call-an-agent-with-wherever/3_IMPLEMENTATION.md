# A chamada por @ em cada lugar onde a pessoa escreve

## O que mudou nesta passada

Uma coisa, e ela é a que faltava para a regra existir no aplicativo em execução: **o módulo que responde `@agente` fora da thread de uma execução passou a ser registrado pelo aplicativo**.

O módulo (`src/main/mentions/module.ts`) já estava escrito: assina o fórum, ignora os threads `run-` e responde os demais. Ele era importado em `src/main/modules.ts` desde a passada em que foi criado, mas o import não bastava — o aplicativo sobe os módulos iterando a lista de módulos (`src/main/index.ts`), e uma linha que está na lista é a diferença entre a assinatura existir e não existir. Antes desta passada a linha não estava lá; agora está, na posição ordenada da lista (`src/main/modules.ts`, entre `glossary` e `minutes`). A partir daqui, um `@agente` num canal, no canal dos squads ou numa conversa geral chega ao agente, como dentro da thread de uma execução.

## O que a leitura desta árvore confirmou

- A lista de módulos que o aplicativo usa é `MODULES`, construída a partir do array `ALL` de `src/main/modules.ts`; `src/main/index.ts` percorre exatamente essa lista para registrar cada módulo.
- `mentionsModule` está no array `ALL`, com o import presente e usado. A lista fica ordenada (`forumModule`, `glossary`, `mentionsModule`, `minutes`, `radar`, …).
- O módulo é o único que assina o fórum para threads que não são de execução (`src/main/mentions/module.ts`), e o runner descarta toda thread que não começa com `run-` (`src/main/runner/service.ts`).
- O runner tem um teste próprio do caminho da thread de uma execução que exercita o laço do núcleo por `onMessage` (`test/runner-lifecycle.test.ts`), e `test/runner-mention-actions.test.ts` cobre a sessão da execução e a proposta de issue.

## Os arquivos desta passada

| Arquivo | O que muda |
|---|---|
| `src/main/modules.ts` | `mentionsModule` entra na lista de módulos registrados, em ordem |
| `src/main/mentions/module.ts` | O objeto de dependências do núcleo é montado uma vez no registro; a pasta do espaço de trabalho (raiz de projetos, ou a pasta de dados) é a pasta de trabalho de reserva |
| `src/main/mentions/answer.ts` | O comentário da sessão de comandos vira uma linha (o código não muda) |
| `test/mentions-module.test.ts` | **Novo.** Um teste que lê a lista de módulos e exige o módulo de menções nela; mais os nomes que uma mensagem chama e o registro que faz a assinatura |

## O que foi verificado nesta passada

Os gates do repositório foram rodados nesta árvore de trabalho:

```
npx tsc --noEmit                passou
npx vitest run                  falha só no test/release-script.test.ts (por tempo esgotado); todo o resto passa
node scripts/theme-audit.mjs    passou
npm run i18n:lint               passou
node scripts/public-audit.mjs   passou (869 arquivos)
npx electron-vite build         passou
```

Detalhe da suíte, porque importa:

- Os sete arquivos de teste das menções passam, **36 testes** (`test/mentions-module.test.ts`, `test/mentions-place.test.ts`, `test/mentions-shell.test.ts`, `test/forum-mentions.test.ts`, `test/forum-mentions-view.test.ts`, `test/ceremony-mentions.test.ts`, `test/runner-mention-actions.test.ts`).
- O novo `test/mentions-module.test.ts` (5 testes) passa e falha se a linha sair da lista: ele confere o conteúdo da própria lista, que é o texto que o registro lê.
- Na suíte inteira, `test/release-script.test.ts` falha por tempo esgotado (testes de script de release, que esta mudança não toca). Rodado sozinho, o arquivo passa (59 testes). A contagem de tempo muda entre rodadas: numa rodada falharam 9 testes desse arquivo, em outra falharam 2 — é tempo estourado num teste que a mudança não altera.

## O que ficou como estava

- A thread de uma execução: continua no runner, com a cópia do código, a etapa do fluxo e o "sim" por comando; o núcleo só entra por uma casca fina.
- O núcleo somente leitura, o corte de três nomes por mensagem, o rótulo de chamada só para post de pessoa, a linha de nome desconhecido, a recusa do comando de host fora de uma execução e as respostas dos agentes nomeados dentro das cerimônias: nada disso foi tocado por esta passada.

## O que esta passada não verificou

- O aplicativo não foi aberto e nenhum modelo real foi chamado. O que foi exercitado é o **registro** (a lista de módulos que o aplicativo percorre) e o **núcleo** (por teste); o comportamento real de um `@agente` num canal, com o aplicativo em execução, não foi visto.
- O telefone pareado não foi exercitado; por leitura, os canais `forum:*` continuam abertos a ele e a regra não muda canal algum.
- O isolamento real nunca foi aberto sobre a pasta de rascunho de vários repositórios; o teste usa um serviço de isolamento falso.
- A conversa da cerimônia não chega ao agente nomeado no call diário e no aprofundamento: os handlers recebem o cartão e o texto, não a conversa da tela. Segue como sugestão, sem alteração.
- O estado de "trabalhando" enquanto o agente responde é de outra issue e não foi construído aqui.
