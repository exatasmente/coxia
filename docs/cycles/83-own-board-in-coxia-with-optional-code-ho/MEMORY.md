# Memória do ciclo

## Decisões

- Dois blocos na issue 83: o quadro próprio do Coxia (funciona sem host) e o passo desse quadro com o host quando há integração. Esta mudança entrega **só o primeiro bloco**; o segundo é entrega própria.
- Quem abriu decidiu: o **host é canônico** e o quadro do Coxia é o **espelho local** (o cartão aparece dos dois lados e não vira dois registros).
- Quem abriu decidiu também **quando o espelho lê o host**: «junto com o app» — leitura sob demanda (montar o dia, abrir o quadro, atualizar à mão), sem intervalo próprio.
- **«Abrir um cartão» é salvar sem sair da máquina**, não um segundo quadro ao lado do host. Com host, a gravação local passaria pelo espelho — mas isso é o segundo bloco; aqui não há mudança nenhuma num espaço com host.
- O que o quadro mostra **entre uma leitura e outra** é o que já existe: `generated_at` (`statusAt`/«Status conferido às {time}») e, para cartões do host, `baseline` e `changes`. A espera de fundo (`statusEveryMin`) só copia o host: nunca lê o quadro local, nunca inventa bloqueio, nunca ressuscita cartão — fica no bloco do host.
- O refino fixou o **dono do cartão sem host** só até onde a leitura confirma: direção proposta (o cartão local vive no dado do espaço de trabalho; sem host, referência própria). Não se afirma que o recorte por squad o vê por repositório (ver Restrições).
- Prioridade proposta: **`priority:low`**, igual ao rótulo de hoje da issue e à sugestão da triagem. Marco proposto: **nenhum**. Motivo: capacidade nova, nada nela conserta algo quebrado nem destrava outra entrega, o app já funciona sem integração onde não depende do host, e o que a torna grande é a segunda metade, que este recorte deixa de fora. Nenhum marco configurado foi consultado (o app não expõe o rastreador).
- Resposta: > **Aguardando resposta** > > ### A pergunta > Hoje o Coxia lê o quadro do host quando o dia é carregado e guarda uma fotografia do dia anterior para dizer o que mudou. Com o quadro próprio espelhando o host, em que momento essa leitura do host deve acontecer — junto com o resto do app (como hoje), a cada intervalo, quando o quadro for aberto, ou só quando a pessoa pedir — e o que o quadro deve dizer enquanto o espelho estiver atrasado? junto com o app <!-- answer:12 -->

## Restrições

- A fonte de cartões de hoje é **somente leitura**: comando externo (`externalTools.cardSource`) ou o provedor do host; sem host a fonte interna devolve nada (`vcsReady()`, `providerReport`) e o dia fica vazio, não é erro (`EMPTY`, `src/main/report.ts`). `loadCards` devolve `cards` + `total` + `rest` do relatório, e é isso que a tela de Hoje usa.
- **O recorte por squad não vê um cartão sem host.** `squadsOfCard`/`cardsOfSquad` (`src/shared/squadCards.ts`) reclamam um cartão por rótulos do rastreador e por `card.project === repo.projectPath`; o caminho por **id de repositório** é de `squadOfIssue` (`src/main/runner/service.ts`), que uma execução usa. Sem rótulo e sem projeto do host, o cartão local só cairia no squad `unclaimed`. O precedente sem host é o rótulo `docs/<squadId>` / `docsFlowOf` (`src/shared/config/squads.ts`). É ponto do plano, não fato.
- Toda escrita que sai da máquina passa pela porta única (`proposeVcsAction`/`proposeVcsGroup`, execução só em `src/main/vcs/runtime.ts`); `assertExternalWrite`/`externalRefusal` fecham em workspace de teste (`isTestWorkspace()` falha fechado). `test/runs-policy.test.ts` prende: na pasta do runner, `door.ts` é o único arquivo que toca a porta.
- A porta do host tem **mais de uma escrita possível** para um cartão: `setIssueLabels`, `closeIssue`, `createIssue`, `commentIssue` etc. (`src/main/vcs/types.ts`, `mentions/propose.ts`). O que fica fora é por escopo (só a primeira metade), não por uma regra nova; um cartão que nunca foi ao host não dispara o gancho pós-execução que propõe o passo com o host, então não há bloqueio lógico a declarar.
- `createIssue` resolve o alvo pelo `unit` e `createdIssueOf(responses[0])` (`src/shared/runs/links.ts`: `number`/`iid`/`id`); `updateConfig` valida o arquivo inteiro; nenhuma fonte de cartões própria existe hoje (nenhum `card_source`/`board` na árvore).
- O histórico que os vigias e a retro leem vem só do comando externo (`cardSource.historyFile`/`stateFile`; `watchers.ts`, `store.ts`); sem host nem comando externo não há esse histórico — consequência do segundo bloco.
- A leitura do host por um agente é só pelo caminho do espaço de trabalho e cai numa política vazia sem integração (`readPolicyFor`, `vcsReadPolicy`). O `closeIssue` de uma issue do host fecha a issue; um cartão do quadro não.
- A tela de Hoje fala de atraso e de origem («Atualizar de {vcsName}», «Status conferido às {time}»); os textos de bloqueio têm variante por host (`vcs.card.ciFailed.on-github`), e `cycle.vcs.fallback`/`hostWords(null, …)` já são a palavra neutra sem integração.
- Documentação que a mudança torna falsa: `docs/cycles.md` §Prioridade («o cartão leva o que o tracker diz da issue») e `rules/runner.md` / `docs/runner.md` (a execução começa por cartão lido do host). Corrigir na mesma mudança é do plano; nada foi editado aqui.

## Tentado e descartado

- **Perguntar ao dono se a entrega é um marco ou um épico.** O comentário dele já divide a issue em «quadro local» e «sincronização com o host»; não é decisão nova a impor. Virou recorte proposto no resumo e no corpo da spec.
- **Perguntar como um cartão aberto na máquina chega ao host.** É a segunda metade, fora de escopo de propósito.
- **Escrever os critérios 6 e 7 como se fossem verificados.** Não são: com host o comportamento tem de continuar igual, mas nada foi aberto nem rodado. Ficam marcados **não verificados aqui**, na spec e no comentário.
- **Exigir na spec que um cartão local nunca passe pela porta do host.** Verificado que é impossível um cartão que nunca foi ao host disparar o gancho pós-execução do passo com o host; o descarte é por escopo, não uma regra nova. Descartado como regra; ficou como «o que fica fora».

## Perguntas abertas

- Do plano: (1) onde vive o cartão do quadro e o que carrega (identidade que não colide com a referência do host, coluna, lugar, hora, histórico); (2) como os cartões do quadro entram no relatório do dia (`providerReport`/`loadCards`) e o que o dia vazio mostra antes do primeiro cartão; (3) como o host mapeia a coluna, por padrão; (4) o comando de abrir/mover/fechar/dar a um squad e a classificação no `webPolicy.ts` do navegador pareado; (5) as correções das regras que a mudança torna falsas (`docs/cycles.md` §Prioridade, `rules/runner.md` / `docs/runner.md`) — nenhuma foi editada nesta etapa.
- Do segundo bloco (fora do escopo desta mudança): a espera de fundo (`statusEveryMin`) passa a puxar a fonte interna? O rótulo de cartão bloqueado guardado dia a dia deixa de existir? O histórico de vigias/dia e retro ganha fonte sem host? Como um cartão do quadro chega ao host, se chegar?

## Onde o trabalho está

- Spec reescrita em `docs/cycles/[redacted]/1_SPEC.md`: **só a primeira metade** (o quadro sem host), com a segunda nomeada como entrega própria; critérios 1–5 para o que se entrega e 6–7 como guarda marcada não verificada; regras, fora de escopo e pontos do plano. Nada foi executado, nenhuma tela foi aberta, nenhum gate do CLAUDE.md foi rodado.
- Documento anterior: `0_TRIAGE.md` (pedido de funcionalidade) e a resposta «junto com o app».
- Passagem refino → tech-lead: o comportamento e as regras estão fechados; o plano decide o como e as correções de documentação. A passagem refino → tech-lead da tentativa 1 está superada por esta.
- Passagem support → refino: host canônico, quadro local espelhado, leitura no ritmo do app; o que ficou em aberto (entre uma leitura e outra, o quadro sem host, prioridade e marco).
- Passagem support → product-owner: Ir ao refino do produto com duas decisões já fechadas (o host é canônico e o quadro do Coxia é o espelho local; a leitura do host continua no ritmo do app, hoje sob demanda) e com o que ficou em aberto para lá: (1) o que o quadro mostra entre uma leitura e outra, dado que o intervalo de conferência de fundo (`statusEveryMin`) hoje só roda com um comando externo de cartões e, num quadro espelhado, ou passa a puxar a fonte interna ou deixa de existir o rótulo de bloqueado guardado dia a dia; (2) como o quadro funciona sem host — onde um cartão vive, como é identificado e como chega ao recorte po… <!-- handoff:14 -->
