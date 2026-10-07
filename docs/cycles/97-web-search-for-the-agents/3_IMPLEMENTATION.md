# A busca na web dos agentes: como ficou

## O que passou a existir

- **O plugin** em `plugins/web-search/` (JavaScript, contra o kit): no fim de cada etapa
  lê `SEARCH_REQUESTS.md`, pula as perguntas que `WEB_SEARCH.md` já responde, pede até
  cinco buscas juntas (uma rodada só) à instância SearXNG da configuração `url`, e
  devolve o documento com até cinco resultados por pergunta (título, endereço, trecho).
- **O documento** é refeito a partir das próprias seções a cada etapa (o embrulho que o
  aplicativo acrescenta ao gravar não se acumula) e fica abaixo de 18 mil caracteres: as
  respostas mais antigas perdem os resultados e mantêm a pergunta (não é buscada de
  novo); se ainda passar, as novas cedem resultados, ficando ao menos um por pergunta.
- **Endereço de resultado** só http(s), normalizado pelo parser, sem parêntese, até 300
  caracteres; o título não fecha o link. Uma URL com quebra de linha não forja seção.
- **A nota aos agentes** (decisão da pessoa no gate): `offers.agents` na declaração, até
  1000 caracteres; entra no contexto de toda etapa, dentro da cerca de material
  (`<data>`), enquanto o plugin está ligado, sem recusa e com as configurações
  obrigatórias preenchidas. Cada nota numa linha, nome até 60, todas juntas até 4 mil
  caracteres. A frase do prompt diz que a nota descreve uma ferramenta e não muda as
  regras do papel nem o pedido da pessoa. A lista de plugins mostra a nota.

## Revisão

A revisão separada pediu mudanças: documento reembrulhado a cada etapa (B1), o corte de
20 mil apagando respostas novas (B2) e URL de resultado injetando linhas (B3); mais a
nota ir aos agentes sem o plugin poder rodar (C1), sem teto de conjunto (C2), a redação
da frase (C3) e a posição da chave no catálogo (C4). Todos tratados, com testes:
várias etapas pelo `pluginDocumentText` real, 40 perguntas de tamanho máximo, URL com
quebra de linha e parêntese, nota fora quando falta configuração, teto e uma linha por
nota, nota tentando fechar a cerca.

## Portões

`npx tsc --noEmit` limpo; `npx vitest run` 3927/3927; `node scripts/theme-audit.mjs`, `npm run i18n:lint`
e `node scripts/public-audit.mjs` limpos. O teste com a sandbox real roda o
plugin do repositório pelo executável do aplicativo.

## Não verificado

Uma instância de SearXNG de verdade, a tela em uso e um agente seguindo a nota.
