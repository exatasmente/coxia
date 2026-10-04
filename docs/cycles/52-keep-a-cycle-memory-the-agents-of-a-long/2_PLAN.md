# O registro que acompanha o ciclo

## O que a mudança faz

Cada execução passa a ter um documento curto, sempre presente e sempre lido por inteiro, que reúne o que uma etapa decidiu e o que a próxima precisa saber sem reler documentos longos: decisões, restrições, o que foi tentado e descartado, perguntas abertas e onde o trabalho está. O arquivo nasce com a execução, é lido antes de todos os outros no texto de cada etapa, nunca é cortado pelo orçamento da pasta, é reescrito por cada etapa que conclui e pode ser corrigido pela pessoa na tela da execução.

O comportamento é o mesmo nos dois motores (o motor aberto e o Claude Agent SDK) e numa execução retomada depois de reiniciar o aplicativo, porque o registro é um arquivo do ramo como os outros documentos, não um estado em memória.

## Decisões

1. **Nome e lugar.** O registro é `MEMORY.md`, na pasta do ciclo, versionado no ramo. É nome fixo, decidido pelo aplicativo, e não entra em `produces` de nenhuma etapa (não é artefato de etapa): segue o caminho do `0_ISSUE.md`, que já é um documento fixo, lido por todas as etapas e imune ao orçamento. Como não é declarado em `produces` nem em `reads`, a verificação do fluxo (`flowCheck`) não muda: continua proibindo dois produtores do mesmo arquivo e não exige que alguém o produza.

2. **Formato.** O arquivo abre com um título próprio e traz, sempre nesta ordem, as seções `## Decisões` (cada item diz o quê, quem e por quê), `## Restrições`, `## Tentado e descartado`, `## Perguntas abertas` e `## Onde o trabalho está`. O esqueleto inicial é escrito pelo aplicativo (textos de catálogo, no idioma do workspace), não pelo modelo.

3. **Teto.** O teto do registro é 10.000 caracteres, uma constante de código; não vira campo de configuração, então não há passo de migração de configuração. Acima do teto o arquivo continua sendo lido por inteiro e a etapa é avisada; o próprio retorno da etapa é o que traz o registro de volta ao tamanho.

4. **Campo de retorno.** O registro é devolvido no campo `memory`, uma string com o arquivo inteiro e já reescrito, junto do `summary` e dos `artifacts` da etapa. O campo entra na base do esquema de resposta de todos os tipos de etapa (trabalho, revisão e QA), é obrigatório como os demais — é o que garante que toda etapa que conclui atualize o registro — e é lido de forma tolerante, como os outros campos. Quando um campo lido é vazio, o aplicativo mantém o registro como está em vez de apagá-lo.

5. **Quem escreve.** O aplicativo é o único que escreve o arquivo. Depois de uma etapa concluir (sem pergunta nem pergunta ao relator), o registro devolvido é normalizado, passa pelas mesmas regras dos outros documentos (marcas `<data>`, mascaramento do que parece credencial) e é gravado antes do commit da etapa, de modo que o commit da etapa leve o registro junto dos documentos. Um agente nunca edita o arquivo por conta própria. Uma etapa que pausa com pergunta não escreve: nada do que a etapa decidiu se perde, porque decisões e respostas entram no registro pelo caminho do item 7.

6. **Primeiro e inteiro.** A leitura da pasta devolve o `MEMORY.md` antes do `0_ISSUE.md` e dos demais; o registro é incluído na lista de arquivos que a etapa recebe mesmo quando a etapa declara `reads`, e é lido sem corte, sem gastar o orçamento da pasta. O texto de cada etapa já monta as seções na ordem em que os arquivos chegam, então o registro fica naturalmente antes de todos.

7. **A conversa alimenta o registro.** A aplicação não confia só na etapa para carregar o que veio da conversa. Cada resposta da pessoa (ou de quem abriu a issue) e cada passagem deixada para a próxima etapa são acrescentadas ao arquivo pela própria aplicação, com um marcador estável (o número da mensagem) que torna o acréscimo idempotente; ao normalizar o registro de retorno de uma etapa, a aplicação reaplica esses marcadores que o modelo tenha deixado cair. Assim a resposta e a passagem continuam no registro depois de chegarem 40 mensagens novas, mesmo num fluxo em que a próxima etapa não seja de agente. O acréscimo feito entre etapas é gravado e commitado pela aplicação, com a identidade do workspace; o commit da etapa seguinte já leva o registro atualizado.

8. **Rejeição registrada.** Uma devolução da revisão ou da QA entra pelo mesmo campo `memory`: a etapa reescreve o registro incluindo o que foi rejeitado e por quê, e o commit daquela etapa (o da revisão ou o do QA) leva o registro. Nada muda no caminho de devolução (`reviewReturn`, `handBack`), que continua sendo o que move a execução.

9. **A pessoa vê e corrige.** O registro aparece na tela da execução como os outros documentos, pela leitura que já existe. Para corrigir, uma pessoa edita o registro na própria tela e o aplicativo grava e commita a versão dela com a identidade do workspace; a autoria fica registrada no histórico da execução e na conversa como da pessoa, não no autor do commit. A edição é recusada enquanto uma etapa estiver trabalhando, para não disputar o worktree com o agente. A versão editada pela pessoa é a que a próxima etapa lê, e o texto do sistema instrui a etapa a preservar o que a pessoa escreveu.

10. **Orçamento da pasta a favor da etapa.** A memória nunca é cortada. Entre os demais documentos, os que a etapa declara em `reads` são lidos por inteiro, e os mais antigos são cortados primeiro (a ordem de nome coincide com a ordem das etapas, então o corte começa pelo mais antigo), cada um com a marca de que foi cortado. O orçamento por arquivo (30.000) e o total (120.000) continuam valendo para os documentos não declarados.

11. **Os dois motores e o reinício.** O campo novo viaja no esquema de resposta que o executor já entrega ao motor; os dois motores o recebem sem caminho próprio. Numa execução retomada depois de reiniciar, o `MEMORY.md` está no disco do worktree e é lido como qualquer documento; uma execução antiga, sem o arquivo, ganha o esqueleto na próxima etapa, antes de o texto ser montado.

## Como o texto de cada etapa muda

O bloco do registro é a primeira seção do texto, entre marcas `<data>` como todo material de fora, com o nome do arquivo no cabeçalho da seção. Quando o registro passa de 10.000 caracteres, uma linha depois dele diz que ele passou do teto e qual é o teto, para a etapa saber que o retorno dela precisa encurtá-lo. A instrução de saída de cada etapa ganha uma linha dizendo que o campo `memory` deve trazer o arquivo inteiro reescrito, com as mesmas seções, curto, carregando o que a pessoa escreveu e o que foi decidido na conversa.

## Trabalho, em ordem

1. **O arquivo fixo e a leitura da pasta** (`src/main/runner/cycleFolder.ts`). Constante `MEMORY_FILE = 'MEMORY.md'` ao lado de `ISSUE_FILE`; esqueleto de catálogo e `writeMemory` (mesmo guard de caminho do `writeArtifact`, sem `tidyArtifact`); leitura que devolve `MEMORY.md` primeiro, depois `0_ISSUE.md`, depois os demais em ordem de nome, com a memória sem corte. O orçamento passa a receber o conjunto de documentos que a etapa declara ler (`keep`), lidos por inteiro; os não declarados são lidos do mais novo para o mais antigo até o orçamento acabar, e cada um que não couber inteiro recebe a marca de corte. O filtro por `stage.reads` sai do executor (hoje em `executor.ts:379`) e entra nessa leitura, junto com `0_ISSUE.md` e `MEMORY.md`, que são sempre lidos.

2. **A memória como módulo** (`src/main/runner/memory.ts`, novo). Esqueleto, teto (`MEMORY_MAX = 10_000`), detecção de registro acima do teto, normalização do texto devolvido (garantir título e seções, cortar excesso de linhas em branco) e as operações idempotentes de acrescentar resposta e passagem com marcador. Puro e testável sem worktree.

3. **O campo de retorno** (`src/shared/runs/output.ts`). `memory: string` em `StageOutput`; `memory: str` na base de `outputSchema` (todos os tipos); leitura em `readOutput` com limite próprio; comentário na interface dizendo o que o campo é. Os testes que fixam a lista exata de propriedades do esquema (`test/runs-results.test.ts`) passam a esperar o campo.

4. **O texto das etapas** (`src/main/runner/prompt.ts`). `StageInput` ganha o registro e o aviso de teto; a seção do arquivo já vem na ordem certa pela lista de arquivos; uma seção `runner.section.memoryOver` quando passa do teto; instrução de saída do campo `memory`; regra no texto do sistema sobre o que o registro é e que a pessoa pode corrigi-lo. Chaves novas nos dois catálogos (`src/shared/i18n/main.en.json` e `main.pt-BR.json`), incluindo os títulos das seções do esqueleto.

5. **O executor** (`src/main/runner/executor.ts`). Antes de ler a pasta, garantir que o `MEMORY.md` exista (criação do esqueleto para uma execução antiga). Ler a pasta com as declarações da etapa. Depois de ler a resposta, quando a etapa conclui e o campo veio preenchido: normalizar, reaplicar os marcadores da conversa, escrever o arquivo e incluir `MEMORY.md` em `written`, para o commit da etapa levá-lo e para a tela e a conversa o listarem.

6. **A conversa e o arquivo da execução** (`src/main/runner/service.ts`, `src/shared/runs/`). Ao gravar uma resposta da pessoa e uma passagem, acrescentar o fato ao `MEMORY.md` e commitar com a identidade do workspace. Um tipo novo em `HISTORY_TYPES` (`types.ts`) e no enum correspondente do `RUN_SCHEMA` (`schema.ts`) registra a edição da pessoa; nada mais do esquema da execução muda, porque o conteúdo do registro vive no arquivo, não no JSON da execução.

7. **A tela da execução** (`src/main/runner/module.ts`, `src/preload`/`src/shared/apiChannels.ts` se o canal exigir entrada na tabela, `src/renderer/src/screens/cycle/runsApi.ts`, `ArtifactView.tsx`). Um canal de escrita do registro, recusado enquanto a execução estiver trabalhando; o texto da pessoa passa pelo mascaramento e pelo guard de caminho; o canal devolve o texto gravado. O visualizador de documento ganha modo de edição só para o `MEMORY.md`, com salvar e cancelar, tokens de tema e chaves de catálogo nos dois idiomas.

8. **Documentação e changelog** (`docs/cycles.md`, `docs/runner.md`, `CHANGELOG.md`). Descrever o arquivo fixo, o teto, a ordem no texto e o orçamento a favor da etapa; a nota de lançamento sob `## [Unreleased]`, dizendo o que mudou para quem usa o aplicativo.

9. **Testes** (abaixo).

## Testes

- **Unidade da memória** (`test/runner-memory.test.ts`, novo): esqueleto com as seções na ordem; detecção de teto; resposta e passagem acrescentadas com marcador e sem duplicar quando aplicadas duas vezes.
- **Leitura da pasta** (`test/runner-units.test.ts`): `MEMORY.md` antes do `0_ISSUE.md` e dos demais; memória acima do teto lida inteira e sem marca de corte; com o total estourado, os documentos declarados em `reads` ficam inteiros e os mais antigos são cortados primeiro, cada corte marcado. O teste de orçamento que hoje espera o corte pela ordem de nome passa a esperar o corte pelos mais antigos.
- **Texto da etapa** (no caminho do executor, como os testes atuais de prompt): o registro é a primeira seção; o aviso de teto aparece quando o registro passa de 10.000; a instrução de retorno do campo aparece.
- **Esquema e leitura da resposta** (`test/runs-results.test.ts`): o campo `memory` está na lista de propriedades de cada tipo e é lido; um valor vazio não apaga o registro.
- **Execução de ponta a ponta** (`test/runner-e2e.test.ts` e o teste de devolução): concluir uma etapa grava o registro e o commit da etapa o leva; uma devolução de revisão ou QA registra o rejeitado; uma execução sem `MEMORY.md` ganha o esqueleto na próxima etapa; uma resposta da pessoa e uma passagem continuam no registro depois de a conversa passar da janela das 40 mensagens; a edição da pessoa é a versão lida pela etapa seguinte e fica no histórico como da pessoa.
- **Portas do repositório**: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

## Riscos e como são cobertos

- **O modelo devolve um registro truncado ou sem o que a pessoa escreveu.** As seções são fixas e a instrução diz o que carregar; a aplicação reaplica os marcadores da conversa; o que a pessoa escreveu é preservado pela instrução e o teste de ponta a ponta cobre uma edição seguida de etapa.
- **Registro acima do teto virar texto grande demais em toda etapa.** O teto é avisado na etapa, que devolve o registro encurtado; o teto de 10.000 limita o caso normal; o excesso é visível no aviso.
- **Ler por inteiro o que a etapa declara pode crescer o texto.** Os declarados são as entradas da própria etapa, em número limitado; os não declarados continuam presos ao teto por arquivo e ao total. Fica registrado como risco conhecido, com o corte dos mais antigos como contrapeso.
- **A edição da pessoa ser sobrescrita pela etapa seguinte.** A etapa é instruída a preservar o que a pessoa escreveu; a edição fica no histórico; a recusa de edição durante uma etapa em trabalho evita disputa de escrita.
- **Autoria.** O commit da edição usa a identidade do workspace (como todos os commits da execução); a autoria da pessoa é registrada no histórico e na conversa.
- **Regras de documento.** O conteúdo vem de fora e passa pelo mascaramento e pela auditoria pública, como os outros documentos; o registro não é publicado no rastreador.
- **Execuções antigas.** Ganham o esqueleto na próxima etapa; o teste cobre o caso.

## Verificação desta etapa

Nada foi executado. O plano vem da leitura da issue, da especificação e da triagem já na pasta, e do código citado: `src/main/runner/prompt.ts`, `src/main/runner/cycleFolder.ts`, `src/main/runner/executor.ts`, `src/main/runner/service.ts`, `src/shared/runs/output.ts`, `src/shared/runs/flow.ts`, `src/shared/runs/flowCheck.ts`, `src/shared/runs/types.ts` e `docs/cycles.md`. Não foi verificado no aplicativo em execução, nem com um modelo de verdade, nenhum dos comportamentos descritos.
