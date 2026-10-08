# Memória do ciclo

## Decisões

- Triagem da #143: **bug**, confirmada por leitura de código. Entende-se como está escrita; nada falta a quem abriu.
- **Tipo e escopo:** é o mesmo problema da #142 num outro modo de execução, o `shell: host`, que a #142 deixa de fora por decisão própria. Não é duplicata. A #143 depende da #142 mesclada (as duas mexem no mesmo ponto do executor); o fecho dela está no código desta cópia.
- **Refino — D1:** a comprovação de uma etapa de host é lida da **própria pasta de saída que a sessão cria** (a que o prompt apresenta em `COXIA_OUT` e que `ViewImage` já conhece), não de uma pasta de etapa nova.
- **Refino — D2:** "testar uma interface" numa etapa de host continua sendo **exatamente a condição de hoje** (pasta de navegadores disponível ou tela virtual pedida).
- **Plano:** a **raiz da comprovação vira um campo da sessão** (`SandboxSession.outputDir`): a sandbox declara `<pasta de etapa>/out`, a sessão de host com teste de interface declara o `out` da pasta temporária, a sessão sem teste de interface não declara nada. Um ponto só decide: no executor, `const evidenceRoot = session?.outputDir` substitui `session?.stageDir` em `input.evidence`, na montagem das ferramentas e em `keepLooked`. As regras de comprovação não foram reescritas. Uma variante de texto `.host` para a etapa de host, com `{out}`. Nenhuma migração de configuração e nenhuma linha de conversa nova.
- **Revisão desta tentativa:** veredito **changes**. O desenho está correto e os gates de tema, idiomas e auditoria pública passam, mas o gate de testes está vermelho e um dos bloqueantes é de produto, não de teste.

## Restrições

- O revisor só lê; o código não foi alterado nesta etapa.
- Toda escrita externa passa por `Actions`; esta mudança não escreve fora do disco, e a fronteira de segurança não foi tocada (nada novo é oferecido além do que o host já oferece).
- Sem campo de configuração novo: a regra do time sobre passo em `STEPS` e os três arquivos não se aplica.
- A conferência pública e as regras do repositório valem para tudo o que este ciclo escrever (sem nome real, host, número de issue ou credencial).
- **Verificado nesta tentativa:** `npx tsc --noEmit` limpo; `node scripts/theme-audit.mjs`, `npm run i18n:lint` (4622 chaves nos dois idiomas) e `node scripts/public-audit.mjs` (1214 arquivos) passam; `npx vitest run` inteiro dá **4 falhas de 4363**; a suíte de sandbox passa sem mudança de expectativa.

## Tentado e descartado

- Perguntar ao repórter: descartado na triagem; a issue traz o que viu, onde no código e a aceitação item por item.
- Tratar a #143 como duplicata da #142: descartado; a #142 exclui o host de propósito.
- Criar uma pasta de etapa para o host só para a comprovação: descartado no refino (D1).
- Ligar a pasta de saída do host sem navegadores nem tela virtual: descartado no refino (D2).
- Duplicar as ferramentas de comprovação para o host e acrescentar uma linha de conversa própria do host: descartados no plano.
- Corrigir o código nesta etapa: fora do papel do revisor; o que se faz é apontar arquivo, linha e motivo.

## Perguntas abertas

- Nenhuma bloqueante para o revisor. **Não verificado:** o comportamento do modo host em execução real (nenhuma sessão de host real, nenhuma tela, nenhum comando no computador); o caminho de uma etapa de host que roda de novo sobre comprovação já guardada; se a #142 está mesclada na ramificação (o fecho existe no código desta cópia); o conteúdo da linha do `CHANGELOG.md` sob `## [Unreleased]` (o arquivo está modificado, o texto não foi lido nesta revisão); a semântica do `parameters` de `SaveEvidence` na forma do motor aberto.

## Onde o trabalho está

- A triagem entregou o `0_TRIAGE.md`, o refino o `1_SPEC.md`, o plano o `2_PLAN.md` e a implementação o `3_IMPLEMENTATION.md`; esta revisão entregou o `4_REVIEW.md`. Tudo na pasta do ciclo.
- A implementação está commitada na branch (`feat: keep the evidence of a stage that runs on the computer`). O código mudado: `src/main/sandbox/session.ts` e `host.ts` (o campo `outputDir`), `src/main/evidence/paths.ts`, `handlers.ts`, `tool.ts` e `engineTool.ts` (a raiz vinda de fora), `src/main/runner/executor.ts` (`evidenceRoot`), `src/main/runner/prompt.ts` e os dois catálogos, `src/main/agents.ts` (o envelope de atividade preserva `outputDir`, `gui` e `readImage`), e os testes `test/evidence-path.test.ts`, `test/host-gui.test.ts`, `test/runner-evidence.test.ts`, `test/runner-evidence-run.test.ts`, `test/runner-qa-repair.test.ts` e `test/helpers/runner.ts`.
- **Passagem revisão → implementação:** corrigir os quatro bloqueantes do `4_REVIEW.md` — a variante de texto de evidência do host não é alcançável (o teste da família base recusa `runner.rules.evidence` e `runner.rules.evidence.host` como não usadas), a asserção errada sobre o esquema do cenário de QA, e os dois casos de fecho no host que não guardaram; depois rodar `npx vitest run` inteiro e relatar. Sem reabrir D1/D2.
- Pendências do fecho do ciclo: a linha do `CHANGELOG.md` sob `## [Unreleased]` precisa ser lida e conferida (o critério 8 não foi atestado por leitura).
- Passagem support → product-owner: Refinar a #143 em `1_SPEC.md`: fixar as duas decisões em aberto (a pasta de saída do host como raiz da leitura da comprovação — reaproveitar a pasta de etapa ou ligar as ferramentas à pasta criada pelo host — e o que conta como "testar uma interface" numa etapa de host; hoje a pasta só nasce com navegadores ou tela virtual ligados, e ligá-la sem eles muda o prompt de uma etapa que hoje não a tem). O material desta etapa é leitura de código, não execução: o comportamento do modo host não foi exercitado. A entrega depende da #142 já mesclada (ambas mexem no mesmo arquivo do executor); se a #142 … <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejar a #143 a partir do `1_SPEC.md`: (1) confirmar que a #142 já está mesclada na base antes de tocar `src/main/runner/executor.ts` — as duas mexem no mesmo ponto; se não estiver, o plano precisa dizer isso. (2) Levar para o plano, sem reabrir a decisão: D1 (a pasta de saída da própria sessão de host é a raiz da leitura da comprovação, sem pasta de etapa nova) e D2 (testar uma interface no host = pasta de navegadores disponível ou tela virtual pedida, a condição de hoje). (3) Onde a pasta de saída do host precisa estar disponível: em `openHostSession`/`openSandboxService.openHost` (`gui.ou… <!-- handoff:13 -->
- Passagem tl-plataforma → pessoa: Implementar a #143 seguindo o `2_PLAN.md`, na ordem dos passos 1 a 10, sem reabrir D1/D2. Antes de tocar `src/main/runner/executor.ts`, confirmar no histórico da ramificação que a #142 está mesclada (o fecho `keepLooked`/`lookedPaths` antes de `session?.close()`); se não estiver, parar e dizer isso em vez de tratar o host como caso à parte. A mudança é: `SandboxSession.outputDir` declarado pela sandbox (`out` da pasta de etapa) e pela sessão de host com teste de interface (`shots`/`gui.out`), `resolveOutputPath` recebendo a raiz, `EvidenceContext.stageDir` virando `outputDir`, e no executor `c… <!-- handoff:23 -->
- Passagem developer → revisor-plataforma: Terminar a implementação da #143: (1) consertar os 3 testes que falharam — no caso de host sem interface, tirar a asserção de que o `schema` não contém a palavra `evidence` (o esquema de cenário de QA sempre tem esse campo; asserir em `AgentCall.evidence`/`run.evidence`), e descobrir por que os dois testes de decomposição de fecho no host (“keeps an image the agent viewed…”, “keeps the file the agent saved by the tool…”) não guardaram — suspeitar do caminho que o `viewImageToolImpl`/`evidence.save` recebe no modo host e conferir se a pasta declarada pela sessão falsa chegou ao executor. (2) Ro… <!-- handoff:36 -->
