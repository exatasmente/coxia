# Memória do ciclo

## Decisões

- Spec (1_SPEC.md) and plan (2_PLAN.md, squad plataforma) approved and unchanged; per-repository overlay is sequenced out of this change.
- Confirmation is at configuration time (Settings-side), not a launch-time ask-a-person pause: config:testenv-confirm handlers record the person's once-per-entry approval in the ledger and the audit log; at launch an unconfirmed non-test-only secret is a named refusal.

## Restrições

- Test environment required for a stage: StageDef.testEnv wins; left out reads as kind === 'qa' for stages created by this version's editor, false for stored templates.
- Registry widening and prompt sentence apply only to an entry-carrying stage; stages without entries behave byte-for-byte as before.

## Tentado e descartado

- Template-file delivery and a `test:` ref suffix: discarded in planning, unchanged.

## Perguntas abertas

## Onde o trabalho está

- Implementation (attempt 3): branch compiles (tsc clean). Fixed: garbled tails in host.ts/sandbox/defaults; TEST_ENV_DATA_VARS + OpenOptions.testEnv; maskerFromResolved wiring; confirmation handlers + ledger singleton in secrets.ts; Actions-door scan (assertNoTestEnvLeak, push git-grep, image-upload refusal, per-session forms registry); prompt sentence + i18n keys in both catalogs; empty-variable refusal; dirname in ledger write; audit kind 'test-env'. Four new test files written (maskExact, testEnv-resolve, testEnv-schema, actions-testEnv).
- Open: green the 4 new test files (assertion mismatches remain); v20ToV21 must preserve an existing section (test caught it); extend sandbox-proxy/policy/host/runner tests; CHANGELOG; remove stray 1_SPEC.md at repo root; Settings editor; run full gates (tsc passed; vitest/theme-audit/i18n:lint/public-audit not confirmed this attempt).
- Passagem support → product-owner: Refinement and planning: decide the storage place of the test environment (workspace or workspace plus repository), which stage kinds receive it (QA by default?), the delivery mechanism (stage environment, a file written from a template outside the worktree, or the app's own env secret source for testing Coxia itself), how a secret's declared hosts open the stage network through the registry proxy (including the private-address case), the masking guarantees for exact values across stage text, run file, pull request and paired browser, the handling of screenshots that carry a value, whether tes… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Planejamento e contrato: definir o esquema da seção do ambiente de teste na configuração do workspace, o prefixo do cofre de segredos de teste, a extensão da lista de permissões do proxy do registry (hosts declarados + marcação privado), o ponto do launcher que injeta as variáveis no shell de sandbox e de host, o encadeamento máscara-de-valor-exato antes da redação por padrão em todos os pontos onde o texto do estágio é guardado (conversa, log de auditoria, run file, documentos de estágio, proposta de PR), a recusa de imagens e commits com valor exato, a tela de confirmação de segredo não test… <!-- handoff:11 -->
- Passagem tl-plataforma → pessoa: Implementation by squad Plataforma, in the order of 2_PLAN.md section 2: schema+migration first, then resolver, sandbox/host injection, proxy private opt-in, masking module and its attach points, prompt sentence, Actions refusals, confirmation gate, Settings editor. Each module ships with its named test file; the real-key acceptance scenario (spec criterion 7) belongs to the person's machine, not the repository's suite. <!-- handoff:23 -->
- Passagem developer → revisor-plataforma: Finish the stage from the written code: (1) run npx tsc --noEmit first and fix what it reports (the executor/testEnv/maskExact wiring was written blind); (2) wire the confirmation ledger into the launch gate — resolver drops unconfirmed non-test-only secrets, which is implemented, decide whether the ask-a-person pause of plan 2.7 gets built or the confirmation stays at configuration time (the Settings editor says so) and record the decision; (3) prompt.ts sentence + both catalogs; (4) Actions-door scan for exact forms on commit/PR/image with test/actions-testEnv.test.ts; (5) the Settings edito… <!-- handoff:78 -->
- Passagem revisor-plataforma → developer: Reviewed the committed change (704fb0fc) against the spec, the plan and the repository rules. The branch does not compile: npx tsc --noEmit reports 65 errors from garbled duplicated trailing blocks in sandbox/host.ts, sandbox/index.ts and defaults.ts, plus undefined identifiers (TEST_ENV_DATA_VARS, OpenOptions.testEnv). Beyond that, the stage masker omits URL-encoded/JSON-escaped forms, the confirmation ledger has no confirm() path, the Actions-door scan, prompt sentence and Settings editor are unwritten, none of the plan's nine test files exist, the new i18n keys are missing from both catalog… <!-- handoff:93 -->
