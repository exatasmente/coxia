# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade, compreensível como escrito (só lido).
- A dependência é a #269 (política de autonomia configurável; 9 critérios de aceite). Esta #268 é a auditoria.
- Escopo (resposta da pessoa): registrar todo passo autônomo e também os retidos aprovados ou recusados, com passo, hora, agente e política em vigor (com o nível); a persona não apaga o registro. Mudanças de política também são registradas (issue).
- A spec completa do product owner chegou truncada: não dá para afirmar que não há critérios além dos listados.
- Squad sugerido: plataforma. Prioridade sugerida: medium (mantida).
- Resposta: A issue da política de autonomia configurável é a #269 (esta, #268, é a auditoria). A spec completa do product owner chegou truncada, então não dá para afirmar que não há critérios além dos listados; o corpo da #269 traz 9 critérios de aceite. Escopo: registrar todo passo autônomo e também os retidos que foram aprovados ou recusados, com passo, hora, agente e a política em vigor (com o nível); a persona não apaga o registro. <!-- answer:12 -->

## Restrições

- Textos novos por `t()` com os dois catálogos; CHANGELOG `Unreleased` atualizado.
- A #269 não pode ir à produção sem esta.

## Tentado e descartado

## Perguntas abertas

- Delimitação exata de "passo autônomo" (sugestão: todo ponto em que a política decide sem um sim).
- Formato do campo "nível" depende da #269.

## Onde o trabalho está

- Triagem pronta (0_TRIAGE.md). Código existente: `auditoria.jsonl`, `src/shared/auditoria.ts` (campo `by`), `src/main/actions.ts`, `src/main/runner/publish.ts`, `autonomyOf` em `src/shared/config/autonomy.ts`. Falta tipo de entrada para mudança de política e campos política/nível. Não verificado: caminhos de escrita/remoção da persona no log.
