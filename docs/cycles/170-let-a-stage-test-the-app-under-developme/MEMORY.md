# Memória do ciclo

## Decisões

- Spec (1_SPEC.md) and plan (2_PLAN.md, squad plataforma) approved and unchanged; per-repository overlay is sequenced out of this change.
- Review (4_REVIEW.md) returned changes-requested on commit 704fb0fc. Design verified by reading to match the spec: v20→v21 migration + testEnvironment/testEnv config surface, resolver with named refusals, delivery last in sandboxEnv and over scrubbedEnv on the host, empty data/specs folders for a host stage testing Coxia, strict private-host opt-in in the proxy, registry widening only for entry-carrying stages.

## Restrições

## Tentado e descartado

- Template-file delivery and a `test:` ref suffix: discarded in planning, unchanged.

## Perguntas abertas

## Onde o trabalho está
- Passagem support → product-owner: Refinement and planning: decide the storage place of the test environment (workspace or workspace plus repository), which stage kinds receive it (QA by default?), the delivery mechanism (stage environment, a file written from a template outside the worktree, or the app's own env secret source for testing Coxia itself), how a secret's declared hosts open the stage network through the registry proxy (including the private-address case), the masking guarantees for exact values across stage text, run file, pull request and paired browser, the handling of screenshots that carry a value, whether tes… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Planejamento e contrato: definir o esquema da seção do ambiente de teste na configuração do workspace, o prefixo do cofre de segredos de teste, a extensão da lista de permissões do proxy do registry (hosts declarados + marcação privado), o ponto do launcher que injeta as variáveis no shell de sandbox e de host, o encadeamento máscara-de-valor-exato antes da redação por padrão em todos os pontos onde o texto do estágio é guardado (conversa, log de auditoria, run file, documentos de estágio, proposta de PR), a recusa de imagens e commits com valor exato, a tela de confirmação de segredo não test… <!-- handoff:11 -->
- Passagem tl-plataforma → pessoa: Implementation by squad Plataforma, in the order of 2_PLAN.md section 2: schema+migration first, then resolver, sandbox/host injection, proxy private opt-in, masking module and its attach points, prompt sentence, Actions refusals, confirmation gate, Settings editor. Each module ships with its named test file; the real-key acceptance scenario (spec criterion 7) belongs to the person's machine, not the repository's suite. <!-- handoff:23 -->
- Passagem developer → revisor-plataforma: Finish the stage from the written code: (1) run npx tsc --noEmit first and fix what it reports (the executor/testEnv/maskExact wiring was written blind); (2) wire the confirmation ledger into the launch gate — resolver drops unconfirmed non-test-only secrets, which is implemented, decide whether the ask-a-person pause of plan 2.7 gets built or the confirmation stays at configuration time (the Settings editor says so) and record the decision; (3) prompt.ts sentence + both catalogs; (4) Actions-door scan for exact forms on commit/PR/image with test/actions-testEnv.test.ts; (5) the Settings edito… <!-- handoff:78 -->
