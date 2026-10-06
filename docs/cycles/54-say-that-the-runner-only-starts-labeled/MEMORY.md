# Memória do ciclo

## Decisões

- Três textos corrigidos, zero comportamento, nos dois idiomas: `docs/configuration.md` (bloco `runner`, pt-BR linha 73 e inglês linha 221), as chaves `ui.runner.triggerHint` (253) e `ui.runner.enabledHint` (192) nos dois catálogos, e uma linha nova em cada tabela de `docs/vcs-providers.md` (pt-BR linha 34, inglês linha 179). Mais uma linha em `CHANGELOG.md` (`## [Unreleased]` › `### Changed`, linha 15).
- `enabledHint` entrou junto com `triggerHint`, para o bloco não sair com uma dica com as três condições e outra só com o rótulo. Nenhuma chave nova.
- Squad `experiencia`. Prioridade `priority:medium` e marco nenhum ficaram como propostos; a pessoa aprovou os dois gates.
- O aviso na tela de execuções para issue com rótulo e sem responsável segue fora, na issue 105.
- Revisão aprovada (etapa atual): os seis trechos foram relidos no estado final e estão gravados e consistentes; nenhuma correção de código feita nem pedida.

## Restrições

- O gatilho continua exigindo issue aberta, com o rótulo e atribuída à pessoa; dispensar a atribuição segue descartado. Nada em `src/main/runner` nem `src/main/vcs` foi tocado.
- Todo texto de interface vai pelos catálogos (`t()`), nos dois idiomas; a rota é a dica do campo, não uma tela nova.
- **A documentação não promete o filtro por responsável como regra geral:** o funil comum do runner (`src/main/runner/module.ts:35-40`) só acrescenta estado (`open`) e rótulo sobre a lista "minhas"; não reaplica a checagem de responsável. A linha nova de `vcs-providers.md` diz que a leitura que alimenta o gatilho é a das issues abertas atribuídas à pessoa, com o filtro de cada host — não que o app reconfere o responsável em todo caminho (não verificado).
- Regra pública: sem nome de empresa, pessoa, host ou número real de issue; placeholders neutros; `scripts/public-audit.mjs` é gate.

## Tentado e descartado

- Levar o aviso da tela de execuções junto: vive na issue 105.
- Corrigir só `triggerHint` e deixar `enabledHint` como estava: descartado, pela inconsistência dentro do mesmo bloco.
- Tratar a issue como bug: o comportamento do runner (iniciar só a issue atribuída) é o desenhado; a falha era o texto.
- Prometer em `vcs-providers.md` um filtro por responsável geral no app: ficou como descrição da leitura de cada host.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Triagem, especificação, plano, implementação e revisão escritos. **Os seis trechos de texto estão gravados e conferidos por leitura no estado final** (revisão refez a conferência): `docs/configuration.md` linhas 73 e 221 (issue aberta + rótulo + atribuída, com link para o parágrafo de `docs/runner.md` que já dizia isso, `#autonomia-escalonador-e-reinício` / `#autonomy-the-scheduler-and-restarts`); `ui-team.pt-BR.json` e `ui-team.en.json` linhas 192 e 253 (as duas dicas com aberta + rótulo + atribuída; `triggerHint` mantém o aviso de caixa, `enabledHint` mantém a frase sobre começar à mão; sem marcadores de substituição nas duas); `docs/vcs-providers.md` linhas 34 e 179 (linha "O gatilho do runner" / "The runner trigger" com o filtro de cada host); `CHANGELOG.md` linha 15. `RunnerSection.tsx` continua nomeando as duas chaves (linhas 66 e 68); JSON dos dois catálogos válido, 442 chaves cada.
- Gates que passaram nesta revisão: `npm run i18n:lint` (4054 chaves, 0 divergências), `node scripts/public-audit.mjs` (910 arquivos, limpo), `npx tsc --noEmit` (limpo), `node scripts/theme-audit.mjs` (55 pares ok), e os testes de guarda/runner em foco (`team-catalog`, `main-catalogs`, `runner-module`, `runner-units`: 34 testes).
- **`npx vitest run` completo NÃO fechou verde nesta revisão: 222 arquivos, 3664 testes, 20 falhas em 7 arquivos** (`release-git`, `conflict-resolve`, `conflict-policy`, `updates-source`, `update-script`, `runner-chain`, `runner-release`). Todas de ambiente: estouros de 5 s/10 s/30 s na montagem de repositórios git de teste e cascata de "passo em andamento" em `conflict-resolve`; o `runner-chain` foi corrida. Repetidos em isolamento, os arquivos voltaram a falhar (24 falhas em 3 arquivos), então não é concorrência da suíte. Nada dessas falhas toca documentação ou catálogo. Numa execução anterior a suíte inteira havia passado; rodar de novo numa máquina descansada para confirmar.
- **Não verificado:** a tela de Configurações › Runner (não aberta no app), o comportamento do runner (issue com rótulo e sem responsável não foi vista deixando de iniciar) e qualquer host real.
- Achados de revisão (sugestões, não bloqueiam): a repetição de `merge_requests?scope=created_by_me`/`reviewer_username` na linha nova de `vcs-providers.md`; a frase "a way the app has always worked" no `CHANGELOG.md` (afirmação histórica não verificada); o texto de `enabledHint` não nomear "o rótulo" explicitamente.
- Próximo passo: entrega (commit e pull request).
- Passagem support → product-owner: Escrever as mudanças de documentação e a dica do campo: em `docs/configuration.md` (pt-BR, linha 73, e inglês, linha 221), dizer que o app inicia sozinho só uma issue aberta, com o rótulo `triggerLabel` e atribuída à pessoa, e ligar ao parágrafo de `docs/runner.md` que já diz isso (linhas 60 e 278); trocar a dica `ui.runner.triggerHint` nos dois catálogos (`src/shared/i18n/ui-team.pt-BR.json:253` e `ui-team.en.json:253`) para incluir a atribuição, mantendo o aviso de que a caixa não importa; e acrescentar em `docs/vcs-providers.md` a linha sobre o filtro por responsável nos três hosts (GitHub … <!-- handoff:7 -->
- Passagem product-owner → pessoa: Escrever os três textos, sem tocar em comportamento: 1. `docs/configuration.md`, no bloco `runner` (pt-BR na linha 73, inglês na linha 221): a frase que hoje diz que o app inicia execuções "para as issues que levam o rótulo `triggerLabel`" deve passar a dizer que é só uma issue **aberta**, com o rótulo **e atribuída à pessoa**, ligando ao parágrafo de `docs/runner.md` (pt-BR linha 60, inglês linha 278) que já diz isso. Conferir se `ui.runner.enabledHint` (linhas 191-192 dos dois catálogos) precisa da mesma correção para os textos ficarem consistentes; a spec exige consistência entre os três lu… <!-- handoff:12 -->
- Passagem tl-experiencia → pessoa: Escrever os textos do plano em `2_PLAN.md`, sem tocar em comportamento: 1. `docs/configuration.md`, bloco `runner`: pt-BR (linha 73) e inglês (linha 221), a frase do `enabled` passa a dizer que o app inicia sozinho só uma issue **aberta**, com o rótulo `triggerLabel` (padrão `coxia`, caixa não importa) e **atribuída à pessoa**, com link para o parágrafo de `docs/runner.md` (pt-BR linha 60, inglês linha 278). 2. Catálogos `src/shared/i18n/ui-team.pt-BR.json` e `ui-team.en.json`: corrigir **duas** chaves, `ui.runner.triggerHint` (253) e `ui.runner.enabledHint` (191-192), com o mesmo conteúdo (ab… <!-- handoff:25 -->
- Passagem dev-experiencia → tl-experiencia: Revisar e entregar: conferir os seis trechos no estado final (as duas frases de `docs/configuration.md` nas linhas 73 e 221; as quatro chaves dos catálogos nas linhas 192 e 253; as duas linhas novas de `docs/vcs-providers.md`, linhas 34 e 179; a entrada do `CHANGELOG.md` na linha 15), porque duas gravações voltaram como concluídas e foram revertidas pelo ambiente, e uma delas corrompeu o `pt-BR.json`. Rodar `npx vitest run` até o fim: a suíte passou inteira antes do último ajuste de texto, mas a execução seguinte não terminou dentro do tempo de comandos desta etapa. Se possível, abrir Configur… <!-- handoff:55 -->
