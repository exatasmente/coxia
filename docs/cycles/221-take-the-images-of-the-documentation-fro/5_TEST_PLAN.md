# Plano de testes: imagens da documentação a partir do workspace semeado

## Cenários

1. **Tipos e conferência de referências.** `npx tsc --noEmit` e `node scripts/docs-images-check.mjs`. Esperado: saída 0. Resultado: passou, executado (ev-91).
2. **Auditoria pública (aceitação 8 e 9, regra 8).** `node scripts/public-audit.mjs`. Esperado: nada que pertença a empresa ou pessoa. Resultado: passou, 1669 arquivos (ev-91). A auditoria não lê pixels.
3. **Testes de semente, lista, conferência, tela por etapa, templates e schema.** Seis arquivos, 205 testes. Esperado: todos passam. Resultado: passou (ev-91). Cobre a recusa de escrever duas vezes (aceitação 2), a conferência de órfãs (aceitação 7), a etapa sem o campo sem tela (aceitação 5) e o schema com `display`.
4. **Imagem inglesa da cerimônia.** Aberta. Esperado: turno semeado, sem falha, sem fornecedor. Resultado: passou (ev-92). Observação não bloqueante: o título "Abertura do dia" e "AGENDA" aparecem em português na imagem em inglês (dado semeado e rótulo).
5. **Imagem inglesa do assistente.** Aberta. Esperado: sem nome de fornecedor. Resultado: passou (ev-93). Observação não bloqueante: a lista de passos salta do 2 para o 4 (passo 3 removido pela heurística da captura).
6. **Lista de imagens presente.** Dez arquivos em `docs/images/` (cinco em cada idioma), lidos por listagem. Resultado: passou, só lido.

## Não verificado

- Aceitação 4: etapa com `display: true` rodar a captura (sandbox e host) e guardar as imagens como comprovação.
- Aceitação 6: o release refazer as imagens e o pull request mostrar só as mudadas.
- Byte a byte em outro computador; esta etapa não repetiu o byte a byte (relatado pela implementação, ev-84).
- Semente abrir no app sem aviso de migração: não reexecutada aqui.
- Imagens `today`, `actions` e `phone` em inglês e as imagens em pt-BR não foram abertas por esta etapa.
- Suíte completa do vitest e theme-audit/i18n:lint não reexecutados (a implementação relatou 2 falhas por falta de `@playwright/mcp`).

## Resultado dos cenários

- 1. Tipos e conferência de referências: passou (executado na sandbox) — tsc --noEmit e docs-images-check saem 0.
- 2. Auditoria pública: passou (executado na sandbox) — 1669 arquivos, nada de empresa ou pessoa; não lê pixels.
- 3. Testes de semente, lista, conferência, tela por etapa, templates e schema: passou (executado na sandbox) — 6 arquivos, 205 testes passam.
- 4. Imagem inglesa da cerimônia: passou (executado na sandbox) — Turno semeado, sem falha nem fornecedor; título e agenda em português.
- 5. Imagem inglesa do assistente: passou (executado na sandbox) — Sem nome de fornecedor; passo 3 ausente na lista.
- 6. Aceitações 4 e 6 (etapa com tela e release): não rodou (lido) — Exigem sandbox com tela e um release; não exercitadas, sem comprovação.
