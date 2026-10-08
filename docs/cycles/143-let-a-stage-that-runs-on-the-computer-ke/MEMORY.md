# Memória do ciclo

## Decisões

- Triagem da #143: **bug**, confirmada por leitura de código. Entende-se como está escrita.
- **Tipo e escopo:** é o mesmo problema da #142 no modo `shell: host`. Não é duplicata; a #143
  depende da #142 (o fecho `keepLooked`/`lookedPaths` existe no código desta cópia).
- **Refino — D1:** a comprovação de uma etapa de host é lida da própria pasta de saída da
  sessão (a que o prompt apresenta em `COXIA_OUT`), não de uma pasta de etapa nova.
- **Refino — D2:** "testar uma interface" no host continua sendo pasta de navegadores
  disponível ou tela virtual pedida.
- **Plano:** a raiz da comprovação vira campo da sessão (`SandboxSession.outputDir`); um ponto
  só decide no executor (`const evidenceRoot = session?.outputDir`); uma variante `.host` de
  texto com `{out}`; nada de migração de configuração nem linha de conversa nova.
- **Implementação (tentativa 2):** fechados os quatro bloqueantes da revisão. O bloqueio de
  produto era a leitura de imagem no host: `readOutputImage` só aceitava o nome `/coxia/out`
  (que só existe na sandbox), então `ViewImage` recusava o caminho real da pasta da sessão e
  nada era marcado como olhado. Passou a aceitar os dois nomes, recusando o que está fora.
  Além disso: a asserção do esquema de QA foi trocada, a variante `.host` passou a ser
  reconhecida pelo teste do catálogo, e os ids passaram a vir de um retrato vivo da execução
  (senão a segunda peça — a imagem marcada — reusava `ev-1`).
- **Nota de lançamento:** a linha sob `## [Unreleased]` **não existia** na cópia anterior; foi
  escrita nesta tentativa (critério 8).

## Restrições

- Toda escrita externa passa por `Actions`; nada aqui escreve fora do disco e a fronteira de
  segurança não foi tocada.
- Sem campo de configuração novo: os três arquivos de tipos, padrões e esquema não mudam.
- A conferência pública e as regras do repositório valem para tudo o que este ciclo escrever.
- **Verificado nesta tentativa:** `npx tsc --noEmit` limpo; `npx vitest run` inteiro verde
  (**4363 testes, 288 arquivos**); `npm run i18n:lint` (4622 chaves nos dois idiomas);
  `node scripts/theme-audit.mjs`; `node scripts/public-audit.mjs` (1215 arquivos).
- **Não verificado:** o modo host numa execução real (nenhuma sessão real, nenhuma tela);
  uma etapa de host que roda de novo sobre comprovação já guardada; a semântica do
  `parameters` de `SaveEvidence` na forma do motor aberto; que a #142 esteja mesclada na
  ramificação além do fecho presente no código.

## Tentado e descartado

- Perguntar ao repórter; tratar a #143 como duplicata da #142; criar uma pasta de etapa para o
  host; ligar a pasta de saída sem navegadores nem tela virtual; duplicar as ferramentas para
  o host e dar-lhe uma linha de conversa própria — todos descartados nas etapas anteriores.
- Consertar só os testes (asserção e variante): descartado ao exercitar o caminho — o fecho do
  host falhava por um defeito de produto na leitura da imagem, não por um teste mal escrito.
- Guardar o id da peça por outro contador nas ferramentas: descartado; o retrato vivo da
  execução reaproveita o contador que a loja já tem.

## Perguntas abertas

- Nenhuma bloqueante. Fica aberto para quem fechar o ciclo: a linha do `CHANGELOG.md` foi
  escrita nesta tentativa, mas quem fechar deve lê-la e conferir o critério 8.

## Onde o trabalho está

- A pasta do ciclo tem o `0_TRIAGE.md`, o `1_SPEC.md`, o `2_PLAN.md`, o `3_IMPLEMENTATION.md`
  (reescrito nesta tentativa) e o `4_REVIEW.md`.
- O código desta tentativa (não commitado): `src/main/evidence/store.ts` (novo
  `withRecordedEvidence`), `handlers.ts` (`run` como leitor), `paths.ts` (comentários),
  `src/main/sandbox/session.ts` (`readOutputImage` aceita o caminho real), `executor.ts`
  (`runSoFar`), `test/helpers/runner.ts` (sessão falsa de host lê os dois nomes),
  `test/cycle-prompts.test.ts`, `test/runner-evidence-run.test.ts`,
  `src/shared/i18n/main.{en,pt-BR}.json` e `CHANGELOG.md`.
- **Passagem implementação → revisor:** revisar a correção da leitura de imagem no host
  (`readOutputImage`) contra a fronteira de segurança — ela aceita o caminho real da pasta da
  sessão e continua recusando o que está fora —, reler o diff contra a spec (critérios 1 a 8)
  e rodar os gates. Não reabrir D1/D2.
- Passagem support → product-owner: Refinar a #143 em `1_SPEC.md`: fixar as duas decisões em aberto (a pasta de saída do host como raiz da leitura da comprovação — reaproveitar a pasta de etapa ou ligar as ferramentas à pasta criada pelo host — e o que conta como "testar uma interface" numa etapa de host; hoje a pasta só nasce com navegadores ou tela virtual ligados, e ligá-la sem eles muda o prompt de uma etapa que hoje não a tem). O material desta etapa é leitura de código, não execução: o comportamento do modo host não foi exercitado. A entrega depende da #142 já mesclada (ambas mexem no mesmo arquivo do executor); se a #142 … <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejar a #143 a partir do `1_SPEC.md`: (1) confirmar que a #142 já está mesclada na base antes de tocar `src/main/runner/executor.ts` — as duas mexem no mesmo ponto; se não estiver, o plano precisa dizer isso. (2) Levar para o plano, sem reabrir a decisão: D1 (a pasta de saída da própria sessão de host é a raiz da leitura da comprovação, sem pasta de etapa nova) e D2 (testar uma interface no host = pasta de navegadores disponível ou tela virtual pedida, a condição de hoje). (3) Onde a pasta de saída do host precisa estar disponível: em `openHostSession`/`openSandboxService.openHost` (`gui.ou… <!-- handoff:13 -->
- Passagem tl-plataforma → pessoa: Implementar a #143 seguindo o `2_PLAN.md`, na ordem dos passos 1 a 10, sem reabrir D1/D2. Antes de tocar `src/main/runner/executor.ts`, confirmar no histórico da ramificação que a #142 está mesclada (o fecho `keepLooked`/`lookedPaths` antes de `session?.close()`); se não estiver, parar e dizer isso em vez de tratar o host como caso à parte. A mudança é: `SandboxSession.outputDir` declarado pela sandbox (`out` da pasta de etapa) e pela sessão de host com teste de interface (`shots`/`gui.out`), `resolveOutputPath` recebendo a raiz, `EvidenceContext.stageDir` virando `outputDir`, e no executor `c… <!-- handoff:23 -->
- Passagem developer → revisor-plataforma: Terminar a implementação da #143: (1) consertar os 3 testes que falharam — no caso de host sem interface, tirar a asserção de que o `schema` não contém a palavra `evidence` (o esquema de cenário de QA sempre tem esse campo; asserir em `AgentCall.evidence`/`run.evidence`), e descobrir por que os dois testes de decomposição de fecho no host (“keeps an image the agent viewed…”, “keeps the file the agent saved by the tool…”) não guardaram — suspeitar do caminho que o `viewImageToolImpl`/`evidence.save` recebe no modo host e conferir se a pasta declarada pela sessão falsa chegou ao executor. (2) Ro… <!-- handoff:36 -->
- Passagem revisor-plataforma → developer: A revisão leu o diff inteiro contra a spec, o plano e a fronteira de segurança, e rodou os gates. O desenho está correto: a raiz da comprovação virou um campo da sessão, as ferramentas de comprovação e a guarda de fecho passaram a ler essa raiz, e a etapa de sandbox não mudou de comportamento (a suíte de sandbox passa sem mudança de expectativa). O que bloqueia são quatro testes vermelhos: um deles acusa que a nova chave `runner.rules.evidence.host` não é alcançável pelo mecanismo de variantes do catálogo de prompts — o recurso que faz a etapa de host ler o caminho real, critério de aceite 5 —… <!-- handoff:61 -->
