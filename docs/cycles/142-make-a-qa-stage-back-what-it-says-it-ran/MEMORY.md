# Memória do ciclo

## Decisões

- Triagem da #142: **bug**, confirmada por leitura de código. Sem pergunta ao repórter.
- Refinamento: a spec está em `1_SPEC.md`. As três decisões de projeto: (1) **uma rodada de reparo** por etapa de QA com sandbox, para cenários afirmados como executados e sem respaldo, com as saídas guardar-a-comprovação-e-apontar-o-comando, apontar-o-comando, assumir-lido ou assumir-não-rodado, e o rebaixamento só depois, com linha na conversa; (2) **o registro manda no que se publica** — os cenários gravados depois da rodada alimentam de uma só vez o registro da execução, o `5_TEST_PLAN.md` e o comentário; (3) **a imagem olhada e não guardada é guardada automaticamente no fecho**, e o que não puder ser guardado é dito como visto-não-guardado, com o motivo.
- **Um cenário rebaixado não reprova a etapa nem vira pendência**; a severidade do cenário continua sendo o único gatilho de devolução. Etapa de QA sem sandbox fica como hoje.
- Prioridade proposta: a mais alta dos níveis configurados (a issue veio com `priority:high`). Nenhum marco proposto.
- **Plano (`2_PLAN.md`) implementado nos cinco passos**: (1) gancho `looked`/`onLooked` em `lookAtImage`; (2) rodada de reparo dentro do `try` de `runStage`, com o fecho da sessão adiado para depois da rodada e da guarda, e as duas chamadas ao motor sob o mesmo `guard`; (3) fonte única: um vetor de cenários conferido uma vez alimenta `recordQa`, o `5_TEST_PLAN.md` (reescrito por `testPlanWithResults`) e o comentário; (4) guarda automática no fecho pelo `putEvidence`, com as linhas de visto-não-guardado e de contagem; (5) correção da regra `.coxia/rules/runner.md` e linha no `CHANGELOG.md`.

## Restrições

- Achados por **leitura de código** e por testes com ajudantes falsos; nada foi exercitado com modelo, host ou sandbox reais, nenhuma tela foi conduzida e nenhum run foi reproduzido. A execução real citada pela issue não foi refeita nem conferida.
- A guarda automática não lê caminho fora da pasta de saída da etapa; o tipo continua sendo lido do conteúdo e o teto de tamanho continua valendo.
- O que já foi publicado no host não é apagado nem mudado. Nada de fora do escopo da spec.
- A conferência pública: sem nome real, host, número de issue ou credencial em código, teste, mensagem de commit ou nome de ramo.

## Tentado e descartado

- Perguntar ao repórter: descartado na triagem.
- Duplicata da #121 ou da #120: descartado; a #121 entregou a ferramenta e o `ViewImage`.
- Fazer o rebaixamento reprovar a etapa: descartado.
- Só listar "visto, não guardado" em vez de guardar: descartado, com o motivo na spec.
- Reconhecer a imagem olhada pelo conteúdo: descartado no plano; guardaria imagem que ninguém olhou e não separa repetida de nova.
- Abrir pergunta à pessoa: descartado; as escolhas de projeto são do produto e a spec as faz com justificativa.
- **Os dois pontos de limpeza de passagem do plano** (erro de digitação num comentário e teto divergente num comentário de módulo): deixados como estavam; o plano não os trata como comportamento errado e nenhum altera esta mudança.

## Perguntas abertas

- Nenhuma bloqueante. **Não verificado:** comportamento num run real; o caminho de recusa por tipo e por tamanho de imagem num teste próprio; a regra `.coxia` corrigida por leitura sem teste que a confira.
- **Uma corrida flaky da suíte:** uma corrida completa terminou com 6 testes falhando em 1 arquivo não identificado; as corridas seguintes (duas completas e três vezes os arquivos do runner) passaram todas e não se reproduziu. Registrada como não explicada em `3_IMPLEMENTATION.md`.

## Onde o trabalho está

- Toda a implementação, os testes e o changelog estão no worktree, com `3_IMPLEMENTATION.md` na pasta do ciclo. Verde rodado nesta cópia: `npx tsc --noEmit` (limpo), `npx vitest run` (283 arquivos, 4390 testes), `node scripts/theme-audit.mjs`, `npm run i18n:lint` (4598 chaves nos dois idiomas, 0 problema) e `node scripts/public-audit.mjs` (limpo).
- **Não verificado que a etapa feche antes desta correção:** o commit desta etapa inclui a correção de formatação em `src/main/agents.ts` feita nesta tentativa.
- Passagem implementação → revisão: usar `2_PLAN.md` e `3_IMPLEMENTATION.md`; o revisor confere os quatro pontos do handoff (a rodada dentro do `try`, o gancho da imagem nos dois caminhos, a função pura do plano de teste e a guarda no fecho) e roda as portas de `CONTRIBUTING.md` de novo.
- Passagem support → product-owner: Refinamento do produto: transformar a correção em spec funcional a partir de 0_TRIAGE.md. O que a spec precisa fixar: (1) a rodada de reparo de um cenário `executed` sem comando e sem id de comprovação — quando ela acontece, o que se pede ao agente e o que ele pode responder (guardar a comprovação, citar comandos, ou virar `read`/`not-run`), e que o rebaixamento automático só ocorra depois dela, com linha na conversa; (2) o que o `5_TEST_PLAN.md` e o comentário de QA passam a dizer quando divergem do registro — qual é a fonte da verdade (os cenários gravados depois de `backEvidence`) e como um… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Plano técnico (tech-lead) a partir de 1_SPEC.md. O que a spec fixa e o plano precisa resolver: (a) ONDE cabe a rodada de reparo — uma segunda chamada ao mesmo agente, dentro da etapa, entre a resposta e o fecho da sandbox, com o mesmo conjunto de ferramentas e sem virar etapa nova; hoje a sandbox é fechada quando a etapa termina (src/main/runner/executor.ts:434-439 e 727-735), e o reparo de formato que existe morre dentro do loop do motor aberto (src/main/engine/open/loop.ts:460-462,543-549). Ler o ciclo de vida da chamada nos dois motores e o que os dois tetos de tempo da etapa contam. (b) O … <!-- handoff:34 -->
- Passagem tl-plataforma → pessoa: Implementar em cinco passos, cada um com o seu teste (detalhe em `2_PLAN.md`, seções "Decisões de desenho", "Ordem de implementação" e "Como será testado"): (1) o gancho em `lookAtImage` (`src/main/sandbox/tool.ts:115-125`) que registra o caminho da imagem olhada, e um callback `onLooked` no executor; (2) a rodada de reparo dentro do `try` de `runStage` — a leitura da resposta e o `backEvidence` de hoje (linhas 737-752) passam para dentro do `try`, o fecho da sessão é adiado para depois do reparo e da guarda, as duas chamadas ao motor correm dentro do mesmo `guard` do `watchdog`, e o reparo ac… <!-- handoff:43 -->
