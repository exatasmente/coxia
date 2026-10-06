# Memória do ciclo

## Decisões

- O escopo aceito é documentação e dica de campo: `docs/configuration.md` (dois idiomas), a chave `ui.runner.triggerHint` nos dois catálogos e uma linha em `docs/vcs-providers.md` sobre o filtro por responsável nos três hosts. O aviso na tela de execuções para issue com rótulo e sem responsável ficou na issue 105 (comentário da issue em 2026-10-06).
- Squad proposto: `experiencia` (é o que a pessoa lê: catálogos, telas e documentos). Fronteira do `plataforma`: só se o filtro por responsável precisar mudar é que o trabalho é dele. Sugestão de prioridade: `priority:medium`, como já está rotulada; a decisão é do refino.
- A documentação deve ser mais estreita que o comportamento observado: o GitHub (via `issues?filter=assigned`), o GitLab (`scope=assigned_to_me`) e o Bitbucket (`assignee.uuid=...`) filtram por responsável nas leituras, mas o funil comum do runner (`src/main/runner/module.ts:35-40`) só acrescenta estado e rótulo, sem reaplicar a checagem de responsável. Não prometer filtro geral sem confirmar isso.

## Restrições

- Nada de comportamento novo: esta issue só ajusta o texto. O gatilho continua exigindo issue aberta, com o rótulo e atribuída à pessoa; a alternativa de dispensar a atribuição foi descartada na própria issue.
- Todo texto novo vai pelos catálogos (`t()`), nos dois idiomas (`src/shared/i18n/ui-team.pt-BR.json` e `ui-team.en.json`); a rota é a dica do campo, não uma tela nova.
- A regra pública: sem nome de empresa, pessoa, host ou número real de issue fora do que o repositório já usa; placeholders neutros. A auditoria pública é gate.
- Nenhuma asserção sem verificação: o que só foi lido vai como lido; nada foi executado nesta etapa (nada de `npx vitest`, `tsc` ou host real).

## Tentado e descartado

- Levar o aviso da tela de execuções junto: já estava fora do escopo no comentário de 2026-10-06 e vive na issue 105.
- Tratar a issue como bug: o comportamento do runner (iniciar só a issue atribuída) é o desenhado; com isso, a única falha é o texto do gatilho.
- Usar as outras issues abertas (53, 52, 29, 16, 58) como duplicatas: nenhuma trata do gatilho, da atribuição ou do filtro por responsável.

## Perguntas abertas

- Nenhuma: falta só o que as etapas seguintes fazem (escrever a documentação e a dica), não uma resposta de quem abriu a issue.

## Onde o trabalho está

- Triagem concluída, `0_TRIAGE.md` escrito. Próximo passo: as mudanças de texto nos dois idiomas de `docs/configuration.md` e de `docs/vcs-providers.md`, mais a dica do campo nos dois catálogos. Nada foi implementado nem testado nesta etapa; a conferência dos gates do repositório fica para quem escrever.
