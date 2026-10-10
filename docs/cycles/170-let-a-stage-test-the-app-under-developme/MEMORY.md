# Memória do ciclo

## Decisões

- Spec (1_SPEC.md) e plano (2_PLAN.md, squad plataforma) aprovados e inalterados; overlay por repositório fora desta mudança.
- A confirmação é no momento de configuração (aba Ambiente de teste em Configurações › Team), não uma pausa ask-a-person no launch: um secret não test-only não confirmado é recusa nomeada no launch; confirm/revoke via config:testenv-* registra no audit log com kind 'test-env'.
- Prefixo de ref `test.` (não `test:`); injeção no host depois do scrub; máscara de valor exato (bruto, URL-encodado, JSON-escapado, ≥4 caracteres) antes do redact por padrão em tudo que a etapa produz: conversa, audit log, run file, documentos, memória e listas de comandos.
- Revisão rodada 4 (código 91d290bc): aprovado; os treze bloqueadores das rodadas 2 e 3 verificados fechados no código, sem achado novo bloqueante.
- QA rodou o plano 5_TEST_PLAN.md: os 16 cenários executados com evidências guardadas (ev-30..47); testes novos 35 verdes, extensões 88 verdes, tsc limpo, suíte completa 4899 verdes + 2 falhas pre-existentes de voice-setup (isolado: dependente do estado de disco da sandbox), aba Ambiente de teste dirigida por CDP em /tmp/qa170-data, config com valor de variável + referência apenas (schema 21, sem valor resolvido), audit log com confirmed, ledger em DATA_ROOT. Gates: theme-audit (8 literais pre-existentes em api.ts), i18n 4854 chaves, public-audit 1290 arquivos — todos exit 0.
- Resposta: volta <!-- answer:187 -->
- Resposta: Volta e pede a correção <!-- answer:231 -->

## Restrições

- O cenário de aceite de chave real (AC 7) vive na máquina da pessoa, fora da suíte; electron-vite build na janela viva também não verificado.
- Não verificados: ACs 2, 3, 6, 8 e 10 — nenhum launch ao vivo de etapa com ambiente (host declarado acessível, opt-in privado, recusa de imagem/referência irresolvível, etapas sem ambiente como antes); export de configuração (cláusula do AC 1) não exercitado. A QA deixou 5_TEST_PLAN.md e handoff.

## Tentado e descartado

- Entrega por template-file e sufixo `test:` descartados no planejamento.
- Pausa ask-a-person no launch para confirmação: a decisão registrada é a tela de configuração.

## Perguntas abertas

## Onde o trabalho está

- Ciclo 170 implementado e aprovado na revisão: schema+migração 21, resolver (src/main/testEnv.ts), injeção sandbox/host (host.ts corrige iteração de emptyDataDirs; TEST_ENV_DATA_VARS em sandbox/index.ts), proxy com privateHosts opt-in, maskExact + sessionMask (WeakMap por sessão) no executor, Actions door (acceptNoTestEnvLeak + grep do branch no push), prompt neutro, TestEnvSection.tsx no Settings, arquivo de ledger em DATA_ROOT com 0600.
- Pendência pós-ciclo: overlay por repositório; CI (build extra) e verificação ao vivo da aba e do cenário de chave real por parte da pessoa.
- Na worktree desta execução, node_modules é um symlink para o node_modules do checkout principal (caminho absoluto; é gitignored): scripts e gates rodam com ele; não recriar com caminho literal "~".
- Passagem support → product-owner: Refinement and planning: decide the storage place of the test environment (workspace or workspace plus repository), which stage kinds receive it (QA by default?), the delivery mechanism (stage environment, a file written from a template outside the worktree, or the app's own env secret source for testing Coxia itself), how a secret's declared hosts open the stage network through the registry proxy (including the private-address case), the masking guarantees for exact values across stage text, run file, pull request and paired browser, the handling of screenshots that carry a value, whether tes… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Planejamento e contrato: definir o esquema da seção do ambiente de teste na configuração do workspace, o prefixo do cofre de segredos de teste, a extensão da lista de permissões do proxy do registry (hosts declarados + marcação privado), o ponto do launcher que injeta as variáveis no shell de sandbox e de host, o encadeamento máscara-de-valor-exato antes da redação por padrão em todos os pontos onde o texto do estágio é guardado (conversa, log de auditoria, run file, documentos de estágio, proposta de PR), a recusa de imagens e commits com valor exato, a tela de confirmação de segredo não test… <!-- handoff:11 -->
- Passagem tl-plataforma → pessoa: Implementation by squad Plataforma, in the order of 2_PLAN.md section 2: schema+migration first, then resolver, sandbox/host injection, proxy private opt-in, masking module and its attach points, prompt sentence, Actions refusals, confirmation gate, Settings editor. Each module ships with its named test file; the real-key acceptance scenario (spec criterion 7) belongs to the person's machine, not the repository's suite. <!-- handoff:23 -->
- Passagem developer → revisor-plataforma: Finish the stage from the written code: (1) run npx tsc --noEmit first and fix what it reports (the executor/testEnv/maskExact wiring was written blind); (2) wire the confirmation ledger into the launch gate — resolver drops unconfirmed non-test-only secrets, which is implemented, decide whether the ask-a-person pause of plan 2.7 gets built or the confirmation stays at configuration time (the Settings editor says so) and record the decision; (3) prompt.ts sentence + both catalogs; (4) Actions-door scan for exact forms on commit/PR/image with test/actions-testEnv.test.ts; (5) the Settings edito… <!-- handoff:78 -->
- Passagem revisor-plataforma → developer: Reviewed the committed change (704fb0fc) against the spec, the plan and the repository rules. The branch does not compile: npx tsc --noEmit reports 65 errors from garbled duplicated trailing blocks in sandbox/host.ts, sandbox/index.ts and defaults.ts, plus undefined identifiers (TEST_ENV_DATA_VARS, OpenOptions.testEnv). Beyond that, the stage masker omits URL-encoded/JSON-escaped forms, the confirmation ledger has no confirm() path, the Actions-door scan, prompt sentence and Settings editor are unwritten, none of the plan's nine test files exist, the new i18n keys are missing from both catalog… <!-- handoff:93 -->
- Passagem developer → revisor-plataforma: Próxima passagem: (1) corrigir as asserções dos quatro testes novos até verde (toBe→toStrictEqual, texto da recusa, deduplicação de formas) e a migração v20ToV21 para preservar uma seção já existente; (2) remover o 1_SPEC.md solto na raiz; (3) CHANGELOG Unreleased; (4) estender sandbox-proxy (privateHosts), sandbox-policy (testEnv no ambiente), sandbox-host (scrub + pastas vazias) e runner-sandbox (default por estágio) conforme o plano 3; (5) rodar o bloqueio completo: npx tsc --noEmit, npx vitest run, node scripts/theme-audit.mjs, npm run i18n:lint, node scripts/public-audit.mjs. <!-- handoff:121 -->
- Passagem pessoa → developer: Volta e pede a correção <!-- handoff:232 -->
- Passagem developer → revisor-plataforma: All thirteen recorded blockers are treated and all five gates pass. Non-verified and not for the repository's suite: the real-key acceptance scenario (spec criterion 7) and the Settings tab seen on a live window (no browser or Electron session was driven). Review should confirm the round-2/3 blocker list is closed against the branch, plus electron-vite build on CI. <!-- handoff:354 -->
