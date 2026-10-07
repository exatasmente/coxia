# Memória do ciclo

## Decisões

- Dois blocos na issue 83: o quadro próprio do Coxia (funciona sem host) e o passo desse quadro com o host quando há integração. Esta mudança entrega **só o primeiro bloco**; o segundo é entrega própria.
- Quem abriu decidiu: o **host é canônico** e o quadro do Coxia é o **espelho local**; e o espelho lê o host **junto com o app** (sob demanda), sem intervalo próprio.
- **«Abrir um cartão» é salvar sem sair da máquina**, não um segundo quadro ao lado do host. Aqui não há mudança nenhuma num espaço com host.
- O refino fixou que o quadro **só existe onde não há integração utilizável** (`vcsReady()` falso): com host, nada muda (regra 6 da spec).
- O plano fechou o **como**:
  - O cartão vive em `board.json` na pasta de dados do espaço de trabalho (ao lado de `acoes.json`/`status.json`, escrita atômica). Id curto próprio de 8 caracteres (nunca numérico, logo nunca colide com a referência do host); referência mostrada `<id do repo>#<id>`; coluna = id de uma etapa de `devCycle.stages` (rótulo pelo `text()`/`cycleText`); `repo` = id de `projects.repos`; `squad`; `priority` = um dos níveis de `devCycle.priority.labels` (nunca o padrão); hora de criação/atualização; histórico de linhas (criado, movido, prioridade, squad, fechado, comentado, editado).
  - **Sem configuração nova e sem migração**: o arquivo é o depósito e os padrões são constantes de código; não se toca em `types.ts`, `defaults.ts`, `schema.ts`, `STEPS` nem `CONFIG_SCHEMA_VERSION`.
  - **Os cartões entram no dia por `loadCards`** (`src/main/cards.ts`): relatório de hoje + cartões do quadro, filtro de ref duplicada, e `sortCards`/`total`/`rest` inalterados (o total cresce ao abrir um cartão). `project` do cartão é o **id do repositório**, não o `projectPath` — sem host ele é nulo, e o id é o que `claims` já casa.
  - **Squad do cartão sem host**: pelo rótulo (precedente `docs/<squadId>`), porque `claims` testa rótulos antes do projeto; «dar a um squad» grava o rótulo próprio do squad. Squad sem rótulo não é oferecido como destino, com o motivo na tela.
  - **Dia vazio**: continua vazio (não é erro) e a tela acrescenta **uma linha de convite abaixo** da lista, nas duas línguas.
  - **Comandos**: módulo novo `src/main/board.ts` registrado em `modules.ts`, canais `board:list/create/update/comment/close/reopen`, abertos ao navegador pareado (fora de `DESKTOP_ONLY` e de `EXTERNAL_EFFECT`), com prova no estilo de `test/runs-policy.test.ts`.
  - **Guarda de escrita**: toda escrita do quadro passa por `assertExternalWrite` (como `gate:record`), e nenhuma execução começa por um cartão do quadro. Risco aberto, com alternativa escrita: `isTestWorkspace()` falha fechado num registro ilegível, então a guarda também recusa num espaço real cujo registro foi reconstruído; a alternativa mais frouxa (só abrir/fechar recusados, critério 5 reescrito) está no plano para o review decidir.
  - **Mapeamento da coluna pelo host** (para o segundo bloco): por padrão rótulo `board:<id da etapa>`, um por vez (entra um, sai o anterior); regra de `stageMapping` por `field`/`column` vence; o espaço pode escrever as suas regras.
- Prioridade proposta: **`priority:low`**; marco proposto: **nenhum**. Motivo: capacidade nova, nada nela conserta algo quebrado nem destrava outra entrega.
- Resposta: > **Aguardando resposta** > > ### A pergunta > Hoje o Coxia lê o quadro do host quando o dia é carregado e guarda uma fotografia do dia anterior para dizer o que mudou. Com o quadro próprio espelhando o host, em que momento essa leitura do host deve acontecer — junto com o resto do app (como hoje), a cada intervalo, quando o quadro for aberto, ou só quando a pessoa pedir — e o que o quadro deve dizer enquanto o espelho estiver atrasado? junto com o app <!-- answer:12 -->

## Restrições

- A fonte de cartões de hoje é **somente leitura**; sem host a fonte interna devolve nada (`providerReport` devolve `null` sem `vcsReady()`) e o dia fica vazio, não é erro (`EMPTY`, `src/main/report.ts`). `loadCards` devolve `cards` + `total` + `rest`.
- **O recorte por squad casa o cartão por rótulo antes do projeto**, e o caminho por projeto usa `card.project === repo.projectPath`; com host o `project` que o dia serve é o `projectPath`. Sem host o caminho por projeto não serve: o plano usa o **id do repositório** no `project` e o rótulo do squad como vínculo (precedente `docs/<squadId>`/`docsFlowOf`).
- Toda escrita que sai da máquina passa pela porta única (`proposeVcsAction`/`proposeVcsGroup`, execução só em `src/main/vcs/runtime.ts`); `assertExternalWrite`/`externalRefusal` fecham em workspace de teste (`isTestWorkspace()` falha fechado no registro ilegível). `test/runs-policy.test.ts` prende que, na pasta do runner, `door.ts` é o único arquivo que toca a porta; o plano prega o mesmo tipo de prova para o arquivo novo do quadro.
- `createIssue` resolve o alvo pelo `unit`; `updateConfig` valida o arquivo inteiro; nenhuma fonte de cartões própria existe no app.
- O histórico que os vigias e a retro leem vem só do comando externo (`cardSource.historyFile`/`stateFile`); sem host nem comando externo não há esse histórico — consequência do segundo bloco.
- A tela de Hoje fala de atraso e de origem («Atualizar de {vcsName}», «Status conferido às {time}»); `cycle.vcs.fallback`/`hostWords(null, …)` são a palavra neutra sem integração. `main.ata.noNotes` já diz que sem o comando de notas a nota fica só na ata.
- Documentação que a mudança torna falsa, a corrigir na mesma mudança: `docs/cycles.md` §Prioridade (os dois idiomas, «o cartão leva o que o tracker diz da issue»), `docs/runner.md` e `.coxia/rules/runner.md` (a execução começa por uma issue lida do host), e uma linha no `CHANGELOG.md`. Não se toca em `docs/vcs-providers.md`, `docs/configuration.md` nem em `.coxia/rules/configuration.md`.
- O projeto é público: o teste do audit checa conteúdo e caminho, então nomes de arquivo, fixtures e textos não podem carregar empresa, pessoa, host real, número real nem segredo. Fixtures novas usam `example.test`.

## Tentado e descartado

- **Perguntar ao dono se a entrega é um marco ou um épico.** O comentário dele já divide a issue em «quadro local» e «sincronização com o host»; virou recorte proposto, não pergunta.
- **Escrever os critérios 6 e 7 como verificados.** Não são: nada foi aberto nem rodado. Ficam marcados **não verificados** na spec e no plano.
- **Exigir na spec que um cartão local nunca passe pela porta do host.** É impossível um cartão que nunca foi ao host disparar o gancho pós-execução; descartado como regra, ficou como «o que fica fora».
- **O histórico do quadro num arquivo append-only separado** (`historico-cartoes.jsonl`): daria aos vigias o que eles leem do comando externo. Descartado nesta entrega porque nada aqui lê esse histórico; o plano registra que o segundo bloco pode acrescentá-lo sem mudar o cartão.
- **Recusar no quadro tudo o que o app hoje recusa em espaço de teste (a leitura literal da spec).** O plano escolheu a guarda que o app já usa (`assertExternalWrite` em toda escrita), e registra a alternativa mais frouxa com o efeito em cada lado, para o review decidir.

## Perguntas abertas

- Do review/implementação: manter a guarda de escrita de teste em todas as seis escritas do quadro (leitura literal da spec 5) ou só em abrir e fechar, reescrevendo o critério 5? O plano registra a decisão tomada e a alternativa, com o risco de `isTestWorkspace()` falhar fechado num espaço real de registro reconstruído.
- Do segundo bloco (fora do escopo desta mudança): o passo com o host (como um cartão do quadro chega ao host, o que a leitura de fundo `statusEveryMin` faz, o rótulo de bloqueado guardado dia a dia, o histórico dos vigias/dia e retro sem host, a nota do dia gravada no cartão, e o quadro com host mostrado dos dois lados).

## Onde o trabalho está

- Plano escrito em `docs/cycles/[redacted]/2_PLAN.md`: onde o cartão vive e o que carrega, como entra no dia, os canais e a tela, o mapeamento de coluna pelo host para o segundo bloco, as correções de documento e os testes. Nada foi executado e nenhuma tela foi aberta nesta etapa; as afirmações de comportamento são leitura de código, e o que só se vê com o app rodando está marcado como não verificado (critérios 6 e 7 inclusive).
- Documentos anteriores: `0_ISSUE.md`, `0_TRIAGE.md` e `1_SPEC.md` (só a primeira metade, critérios 1–5 entregues e 6–7 como guarda).
- Passagem support → refino e refino → tech-lead: superadas por esta; o comportamento está fechado e o plano decide o como.
- Passagem plan → implement: o plano inteiro, com as correções de documentação na mesma mudança e os testes a escrever.
- Esquema de config: a mudança **não** mexe no esquema (sem migração, sem `types.ts`/`defaults.ts`/`schema.ts`).
- Passagem support → product-owner: Ir ao refino do produto com duas decisões já fechadas (o host é canônico e o quadro do Coxia é o espelho local; a leitura do host continua no ritmo do app, hoje sob demanda) e com o que ficou em aberto para lá: (1) o que o quadro mostra entre uma leitura e outra, dado que o intervalo de conferência de fundo (`statusEveryMin`) hoje só roda com um comando externo de cartões e, num quadro espelhado, ou passa a puxar a fonte interna ou deixa de existir o rótulo de bloqueado guardado dia a dia; (2) como o quadro funciona sem host — onde um cartão vive, como é identificado e como chega ao recorte po… <!-- handoff:14 -->
- Passagem product-owner → pessoa: O plano (tech-lead) decide **como**, sem reabrir o comportamento: onde vive um cartão aberto no quadro e o que ele carrega (identidade que não colide com a referência do host, coluna, lugar a que pertence, hora para ordenar e um histórico que se leia), como o quadro acha e serve esses cartões ao lado do relatório do dia (os cartões do dia vêm do relatório; um cartão do quadro precisa entrar nele sem que o host exista), o comando pelo qual um cartão é aberto/movido/fechado/dado a um squad e a classificação dele na política do navegador pareado, como o host mapeia a coluna (primeiro ponto a fech… <!-- handoff:21 -->
