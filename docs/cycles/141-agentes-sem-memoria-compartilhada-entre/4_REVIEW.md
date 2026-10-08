# A memória compartilhada das atividades: revisão da entrega

O que segue é a revisão dos passos 1 e 2 do plano executados: o registro das atividades, o escritor, o recorte que chega a uma chamada, os canais e a tela. Nada do que é afirmado aqui foi dado como cumprido sem que um comando desta etapa o mostrasse; o que não foi exercitado está dito como não verificado.

## O que a entrega faz

O aplicativo passa a manter, em `<workspace>/memory/activities.json` (a pasta do espaço de trabalho, fora de todo worktree), uma frente por atividade, projetada do estado que o mesmo aplicativo já guarda em cada execução. Uma segunda execução da mesma atividade atualiza a mesma frente, porque a chave é a referência que a execução escreve. Quem escreve é o aplicativo, num ponto só: todo movimento de execução passa por `beginRun`/`moveRun`, e a falha de escrita é registrada e engolida, com o leitor reprojetando a frente do store. Um agente recebe um recorte renderizado — a frente inteira do que a mensagem nomeou, ou a lista curta do que está em andamento — em seção própria, entre `<data>`, e nada do registro entra em ferramentas, em `allowedTools` ou em raízes de confinamento. A tela de execuções lista as atividades e abre uma folha de edição sem chamada de modelo.

## O que foi conferido, e como

- Leitura do diff inteiro (21 arquivos fora da pasta do ciclo) contra a especificação e o plano.
- Leitura de `src/main/runner/activities.ts`, `runs-forum.ts`, `service.ts`, `executor.ts`, `prompt.ts`, `mentions/{call,answer,module,place}.ts`, `runner/module.ts`, `RunsScreen.tsx`, `runsApi.ts`, os catálogos e `docs/runner.md`.
- `npx tsc --noEmit`: passa. `npx vitest run`: 4374 de 4374, 291 arquivos. `node scripts/theme-audit.mjs`: passa. `node scripts/public-audit.mjs`: passa, 1218 arquivos. `npx vitest run` dos arquivos de teste novos e dos vizinhos: 47 de 47.
- `npm run i18n:lint` (`node scripts/i18n-lint.mjs --keys --scope renderer --max 0`): **falha**, uma string não traduzida a mais em `src/main/runner/service.ts:1161`.
- A seção renderiza de verdade, nos dois idiomas: verificado por sonda, os textos saem em inglês numa chamada em inglês e em português numa em português.
- O `i18n:lint` conta a linha movida: confirmei por sonda que restaurar a frase ao valor que a chamada recebia antes do diff zera a contagem, e que devolvê-la como argumento a reprova.

## Bloqueantes

### 1. Mensagem da pessoa perdida quando chega junto com a resposta (`service.ts:1275`)

O aviso ao agente que trabalha é injetado no texto antes de o `inbox.post` decidir se a mensagem entra. Quando a etapa já está fechando, o `post` devolve `false` e o texto que volta na linha de encerramento — o que o relato da issue descreve como a pessoa perguntando ao QA e não obtendo resposta — sai com a frase do registro colada. O comportamento é anterior ao diff para a perda em si, mas a entrega acrescenta texto ao que a pessoa escreveu numa linha que já é de erro, e a spec põe a mensagem entre agentes fora do escopo desta entrega. O caminho está coberto só em parte por teste: nenhum exercita a mensagem chegando nesse instante.

### 2. O limite do repositório público (a frase movida para um argumento)

O diff move a frase `update the cycle memory` de uma variável para um argumento direto de `commitMessage`. Com isso ela deixa de estar numa posição que o `i18n:lint` reconhecia e passa a contar como string não traduzida: o comando passa de zero a uma, e o gate do `CONTRIBUTING.md` reprova. O critério é objetivo e a correção é pequena (devolver a frase a uma posição que o script já reconhece, ou declará-la com a marca que o próprio repositório usa para texto de propósito). A entrada correspondente está na linha do código; o registro do repositório público não muda por causa dela.

## Sugestões

- A miniaturas por agente ("o que fulano está fazendo") entram no arquivo e no prompt, mas não têm caso de teste próprio do corte, como o próprio autor registra. É o item mais fraco da entrega; não é bloqueante porque o corte por agente existe e é exercitado indiretamente.
- O teste do módulo de menções fora de uma execução usa a montagem da chamada, não o módulo inteiro rodando com um fórum real. O caminho está ligado por leitura; fica como sugestão de cobertura, não como bloqueante, porque o critério 1 da spec é atendido pelo mesmo trecho de recorte que os testes cobrem.
- A tela e o reinício de verdade não foram exercitados por mim: os testes mostram que o registro é arquivo lido do disco e não estado de processo, mas abrir o aplicativo duas vezes com a mesma pasta de dados não foi feito. Está dito como não verificado.

## O que não foi revisado

- O aplicativo em execução: a tela de execuções com a seção das atividades e a folha de edição foram escritas e o typecheck as aceita, mas nenhuma tela foi aberta e nenhum clique foi dado nesta revisão. A conferência de interface é da aceitação.
- O reinício de verdade, o caminho inteiro do módulo de menções com um fórum real e a conversa do QA do relato reproduzida à mão: não exercitados nesta revisão.
- Vários espaços de trabalho na mesma máquina e vários computadores: fora do escopo declarado.
