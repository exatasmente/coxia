# Memória do ciclo

## Decisões

- Provedor: instância própria de SearXNG; a busca atende o que os agentes pedem em `SEARCH_REQUESTS.md`; plugin em JavaScript (2026-10-06).
- O plugin avisa os agentes: a declaração ganhou `agents`, uma nota que entra no contexto de toda etapa enquanto o plugin está ligado, marcada como palavra do plugin (decisão da pessoa no gate).
- Gates 1 e 2 aprovados (2026-10-06).

## Onde o trabalho está

- Plugin em `plugins/web-search/`, nota aos agentes na plataforma, testes (contexto falso e sandbox real). Depende da #96 (branch `feat-plugin-requests`), que está em correção depois da revisão.
