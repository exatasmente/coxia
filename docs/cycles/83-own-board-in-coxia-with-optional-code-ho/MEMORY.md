# Memória do ciclo

## Decisões

- A issue 83 pede dois blocos: um quadro próprio no Coxia (que funciona sem host) e o passo desse quadro com o host quando há integração. Desenho, não defeito.
- Quem abriu decidiu, na conversa da issue, que o **host é canônico** e o quadro do Coxia é o **espelho local** (o cartão aparece dos dois lados e não vira dois registros).
- Quem abriu decidiu também **quando o espelho lê o host**: «junto com o app» — a leitura continua no ritmo do app, que hoje é sob demanda (carregar a cerimônia do dia, aberto o quadro, ou atualizar à mão), não um intervalo próprio.
- Resposta: > **Aguardando resposta** > > ### A pergunta > Hoje o Coxia lê o quadro do host quando o dia é carregado e guarda uma fotografia do dia anterior para dizer o que mudou. Com o quadro próprio espelhando o host, em que momento essa leitura do host deve acontecer — junto com o resto do app (como hoje), a cada intervalo, quando o quadro for aberto, ou só quando a pessoa pedir — e o que o quadro deve dizer enquanto o espelho estiver atrasado? junto com o app <!-- answer:12 -->

## Restrições

- A fonte de cartões de hoje é **somente leitura**: comando externo (`externalTools.cardSource`) ou o provedor do host; sem host a fonte interna devolve nada (`vcsReady()`, `providerReport`).
- Toda escrita que sai da máquina passa pela porta única de proposta e confirmação (`proposeVcsAction`; execução só em `src/main/vcs/runtime.ts`). Não existe hoje escrita de cartão da fonte interna.
- O runner só começa execução por issue do host (`triggered`, e `scanIssues` exige `vcsReady()` em `src/main/runner/service.ts`); abrir issue para outro squad ou a partir de uma retro passa por `createIssue` do provedor (`src/main/mentions/propose.ts`, `src/main/retroIssues.ts`).
- O recorte por squad supõe host: rótulos do rastreador e projeto no host (`src/shared/squadCards.ts`); o `docs/<squadId>` das execuções de documentação é o precedente de rótulo sem host.
- O histórico de mudanças que os vigias e a retro leem vem só do comando externo (`cardSource.historyFile`/`stateFile`; `src/main/watchers.ts`, `src/main/store.ts`); a comparação de um dia para o outro é feita pela própria fonte (`baseline`, `src/main/vcs/cards.ts`).
- A leitura do host pelo agente de execução é só pelo caminho do espaço de trabalho (nunca CLI nem MCP) e cai numa política vazia sem integração (`readPolicyFor`, `vcsReadPolicy`).
- A tela de Hoje fala de atraso e de origem («Atualizar de {vcsName}», «Status conferido às {time}»), e os textos de bloqueio do cartão têm variante por host.
- A resposta «junto com o app» tem consequência: o intervalo de conferência de fundo (`statusEveryMin`, 30 min por padrão) hoje só roda com comando externo de cartões e é quem revela bloqueio novo e etapa movida; com leitura sob demanda, é o refino que diz se ele passa a puxar a fonte interna e se o rótulo de bloqueado continua a ser guardado.

## Tentado e descartado

- Nada foi descartado. A pergunta a quem abriu foi respondida e a triagem não precisou perguntar de novo.

## Perguntas abertas

- Nenhuma de quem abriu. Ficam para o refino: o que o quadro mostra entre uma leitura e outra (e o que o intervalo de fundo continua a fazer), e como o quadro funciona sem host (onde um cartão vive, como é identificado e como chega ao recorte por squad).

## Onde o trabalho está

- Triagem fechada em `docs/cycles/[redacted]/0_TRIAGE.md`: pedido de funcionalidade, entendível como está escrita (conferido por leitura de código: fonte de cartões, porta de escrita, pré-requisitos do runner, histórico de vigias e retro, textos da tela de Hoje), sem duplicata, sugestão de prioridade `priority:low`.
- Nada foi executado e nenhuma tela foi aberta nesta etapa.
