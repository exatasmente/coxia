# Memória do ciclo

## Decisões

- Plano fechado em `2_PLAN.md`: três textos corrigidos, zero comportamento. `docs/configuration.md` (bloco `runner`, pt-BR linha 73 e inglês linha 221), a dica `ui.runner.triggerHint` nos dois catálogos e uma nota em `docs/vcs-providers.md` sobre o filtro por responsável nos três hosts. Nada de tela, mensagem ou aviso novo.
- **Decisão de plano nova:** `ui.runner.enabledHint` (linhas 191-192 dos dois catálogos) **entra** na mudança, junto com `triggerHint`. Ela fica logo acima do campo do rótulo e hoje diz só "o app começa uma execução para cada issue com o rótulo abaixo"; sem corrigi-la, o bloco sairia com uma dica com as três condições e outra só com o rótulo. As duas chaves dizem a mesma coisa (aberta + rótulo + atribuída), sem chave nova.
- Squad `experiencia` (é o que a pessoa lê). Fronteira de `plataforma`: só se o filtro por responsável precisar mudar, o que ficou fora.
- Prioridade `priority:medium` como a issue já está; marco nenhum. Ambos propostos, para a pessoa aceitar.
- O aviso na tela de execuções para issue com rótulo e sem responsável segue fora, na issue 105.

## Restrições

- O gatilho continua exigindo issue aberta, com o rótulo e atribuída à pessoa; dispensar a atribuição segue descartado. Nada em `src/main/runner` nem `src/main/vcs` é tocado.
- Todo texto de interface vai pelos catálogos (`t()`), nos dois idiomas; a rota é a dica do campo, não uma tela nova.
- **A documentação não pode prometer o filtro como regra geral:** o funil comum do runner (`src/main/runner/module.ts:39`) só acrescenta estado (`open`) e rótulo sobre a lista "minhas"; não reaplica a checagem de responsável. O texto de `docs/vcs-providers.md` diz que a leitura que alimenta o gatilho é a das issues atribuídas, com o filtro de cada host — não que o app reconfere o responsável em todo caminho (isso não foi verificado).
- Regra pública: sem nome de empresa, pessoa, host ou número real de issue; placeholders neutros; `scripts/public-audit.mjs` é gate.
- Nenhuma asserção sem verificação: nesta etapa nada foi executado (nada de `npx vitest`, `tsc`, auditoria pública ou host real); tudo foi lido.

## Tentado e descartado

- Levar o aviso da tela de execuções junto: vive na issue 105.
- Corrigir só `triggerHint` e deixar `enabledHint` como estava: descartado no plano, pela inconsistência que criaria no mesmo bloco.
- Tratar a issue como bug: o comportamento do runner (iniciar só a issue atribuída) é o desenhado; a falha é o texto do gatilho.
- Prometer em `vcs-providers.md` um filtro por responsável geral no app: o funil não o reaplica; ficou como descrição da leitura de cada host.

## Perguntas abertas

- Nenhuma: falta só o que as etapas seguintes fazem (escrever os textos e rodar os gates), não uma resposta de quem abriu a issue.

## Onde o trabalho está

- Triagem (`0_TRIAGE.md`), especificação (`1_SPEC.md`) e plano (`2_PLAN.md`) escritos. Confirmado por leitura nesta etapa: `docs/configuration.md` omite a atribuição nos dois idiomas (linhas 73 e 221); `docs/runner.md` já diz o requisito (pt-BR linha 60, inglês linha 278); `ui.runner.triggerHint` (253) e `ui.runner.enabledHint` (191-192) só falam do rótulo/caixa nos dois catálogos; as duas chaves são usadas em `RunnerSection.tsx` (66 e 68); os três hosts filtram por responsável (GitHub `assignee=...` ou `filter=assigned`, `github.ts:285-292`; GitLab `scope=assigned_to_me`, `gitlab.ts:282-284`; Bitbucket `assignee.uuid`, `bitbucket.ts:247-253`); o funil do runner só filtra estado e rótulo (`module.ts:35-40`); `test/team-catalog.test.ts` confere as chaves nomeadas e a ausência de chaves órfãs. Nada foi implementado nem testado; os gates ficam para quem escrever.
- Próximo passo: escrever os quatro textos (`configuration.md` nos dois idiomas; `triggerHint` e `enabledHint` nos dois catálogos; a nota em `vcs-providers.md` nos dois idiomas), mantendo a consistência entre eles e com `runner.md`, mais a linha do `CHANGELOG.md`, e rodar os gates do repositório (`npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`).
- Passagem product-owner → pessoa: o plano nomeia os arquivos e o conteúdo de cada texto; quem escrever confere na tela de Configurações › Runner se as duas dicas ficam consistentes e não longas demais.
- Passagem support → product-owner: Escrever as mudanças de documentação e a dica do campo: em `docs/configuration.md` (pt-BR, linha 73, e inglês, linha 221), dizer que o app inicia sozinho só uma issue aberta, com o rótulo `triggerLabel` e atribuída à pessoa, e ligar ao parágrafo de `docs/runner.md` que já diz isso (linhas 60 e 278); trocar a dica `ui.runner.triggerHint` nos dois catálogos (`src/shared/i18n/ui-team.pt-BR.json:253` e `ui-team.en.json:253`) para incluir a atribuição, mantendo o aviso de que a caixa não importa; e acrescentar em `docs/vcs-providers.md` a linha sobre o filtro por responsável nos três hosts (GitHub … <!-- handoff:7 -->
- Passagem product-owner → pessoa: Escrever os três textos, sem tocar em comportamento: 1. `docs/configuration.md`, no bloco `runner` (pt-BR na linha 73, inglês na linha 221): a frase que hoje diz que o app inicia execuções "para as issues que levam o rótulo `triggerLabel`" deve passar a dizer que é só uma issue **aberta**, com o rótulo **e atribuída à pessoa**, ligando ao parágrafo de `docs/runner.md` (pt-BR linha 60, inglês linha 278) que já diz isso. Conferir se `ui.runner.enabledHint` (linhas 191-192 dos dois catálogos) precisa da mesma correção para os textos ficarem consistentes; a spec exige consistência entre os três lu… <!-- handoff:12 -->
