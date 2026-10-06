# Memória do ciclo

## Decisões

- O aplicativo faz a chamada pelo plugin; o plugin nunca vê o valor da chave (decisão da pessoa, 2026-10-06).
- O primeiro uso é a busca numa instância própria de SearXNG, em geral local: destino montado a partir de uma configuração que a pessoa preenche.
- Plugin continua script de shell; para ler JSON sem `jq`, o aplicativo entrega também a resposta reduzida aos campos declarados (`pick`).

## Onde o trabalho está

- `1_SPEC.md` e `2_PLAN.md` escritos; aguardando os gates 1 e 2.
