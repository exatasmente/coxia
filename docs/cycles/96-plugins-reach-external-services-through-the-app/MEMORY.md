# Memória do ciclo

## Decisões

- O aplicativo faz a chamada pelo plugin; o plugin nunca vê o valor da chave (decisão da pessoa, 2026-10-06).
- O primeiro uso é a busca numa instância própria de SearXNG, em geral local: destino montado a partir de uma configuração que a pessoa preenche.
- Plugin em JavaScript (decisão no gate): módulo `.mjs` rodado pelo executável do app em modo Node na sandbox; `request` por repetição de rodadas. Shell continua sem `settings`/`requests`.
- Gates 1 e 2 aprovados (2026-10-06).

## Onde o trabalho está

- `1_SPEC.md` e `2_PLAN.md` aprovados; implementação na branch `feat-plugin-requests` (`3_IMPLEMENTATION.md`). Próxima etapa: revisão separada.
