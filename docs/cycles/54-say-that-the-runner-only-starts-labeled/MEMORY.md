# Memória do ciclo

## Decisões

- Três textos corrigidos, zero comportamento, nos dois idiomas: `docs/configuration.md` (bloco `runner`, pt-BR linha 73 e inglês linha 221), as chaves `ui.runner.triggerHint` (253) e `ui.runner.enabledHint` (192) nos dois catálogos, e uma linha nova em cada tabela de `docs/vcs-providers.md` (pt-BR linha 34, inglês linha 179). Mais uma linha em `CHANGELOG.md` (`## [Unreleased]` › `### Changed`, linha 15).
- `enabledHint` entra junto com `triggerHint`, para o bloco não sair com uma dica com as três condições e outra só com o rótulo. Nenhuma chave nova.
- Squad `experiencia`. Prioridade `priority:medium` e marco nenhum ficaram como propostos; a pessoa aprovou os dois gates.
- O aviso na tela de execuções para issue com rótulo e sem responsável segue fora, na issue 105.

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

- Nenhuma: falta só a revisão e a entrega.

## Onde o trabalho está

- Triagem, especificação, plano e implementação escritos. **Os seis trechos de texto estão gravados e conferidos por leitura no estado final:** `docs/configuration.md` linhas 73 e 221 (issue aberta + rótulo + atribuída, com link para o parágrafo de `docs/runner.md` que já dizia isso, `#autonomia-escalonador-e-reinício` / `#autonomy-the-scheduler-and-restarts`); `ui-team.pt-BR.json` e `ui-team.en.json` linhas 192 e 253 (as duas dicas com aberta + rótulo + atribuída; `triggerHint` mantém o aviso de caixa, `enabledHint` mantém a frase sobre começar à mão); `docs/vcs-providers.md` linhas 34 e 179 (linha "O gatilho do runner" / "The runner trigger" com o filtro de cada host); `CHANGELOG.md` linha 15.
- Gates rodados: `npm run i18n:lint` (4054 chaves, 0 divergências), `node scripts/public-audit.mjs` (909 arquivos, limpo), `npx tsc --noEmit` (limpo) e `node scripts/theme-audit.mjs` (55 pares ok) passaram — os quatro foram rodados **depois** do último ajuste de texto. `npx vitest run` passou inteira (222 arquivos, 3664 testes) antes desse último ajuste; a segunda execução não terminou dentro do tempo de comandos da etapa. Nada do comportamento do runner, da tela ou de host real foi exercitado.
- **Cuidado herdado:** duas gravações de arquivo voltaram como concluídas e o conteúdo foi revertido pelo ambiente (uma delas corrompeu `ui-team.pt-BR.json`, já reparado). Quem revisar deve reler os seis trechos antes do commit.
- Próximo passo: revisão e entrega; conferir na tela de Configurações › Runner se as duas dicas ficam consistentes e não longas demais, e rodar `npx vitest run` até o fim.
- Passagem support → product-owner: Escrever as mudanças de documentação e a dica do campo: em `docs/configuration.md` (pt-BR, linha 73, e inglês, linha 221), dizer que o app inicia sozinho só uma issue aberta, com o rótulo `triggerLabel` e atribuída à pessoa, e ligar ao parágrafo de `docs/runner.md` que já diz isso (linhas 60 e 278); trocar a dica `ui.runner.triggerHint` nos dois catálogos (`src/shared/i18n/ui-team.pt-BR.json:253` e `ui-team.en.json:253`) para incluir a atribuição, mantendo o aviso de que a caixa não importa; e acrescentar em `docs/vcs-providers.md` a linha sobre o filtro por responsável nos três hosts (GitHub … <!-- handoff:7 -->
- Passagem product-owner → pessoa: Escrever os três textos, sem tocar em comportamento: 1. `docs/configuration.md`, no bloco `runner` (pt-BR na linha 73, inglês na linha 221): a frase que hoje diz que o app inicia execuções "para as issues que levam o rótulo `triggerLabel`" deve passar a dizer que é só uma issue **aberta**, com o rótulo **e atribuída à pessoa**, ligando ao parágrafo de `docs/runner.md` (pt-BR linha 60, inglês linha 278) que já diz isso. Conferir se `ui.runner.enabledHint` (linhas 191-192 dos dois catálogos) precisa da mesma correção para os textos ficarem consistentes; a spec exige consistência entre os três lu… <!-- handoff:12 -->
- Passagem tl-experiencia → pessoa: Escrever os textos do plano em `2_PLAN.md`, sem tocar em comportamento: 1. `docs/configuration.md`, bloco `runner`: pt-BR (linha 73) e inglês (linha 221), a frase do `enabled` passa a dizer que o app inicia sozinho só uma issue **aberta**, com o rótulo `triggerLabel` (padrão `coxia`, caixa não importa) e **atribuída à pessoa**, com link para o parágrafo de `docs/runner.md` (pt-BR linha 60, inglês linha 278). 2. Catálogos `src/shared/i18n/ui-team.pt-BR.json` e `ui-team.en.json`: corrigir **duas** chaves, `ui.runner.triggerHint` (253) e `ui.runner.enabledHint` (191-192), com o mesmo conteúdo (ab… <!-- handoff:25 -->
