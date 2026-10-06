# Os agentes buscam na web: o primeiro plugin de verdade

## O que se pede

Um agente escreve o que quer saber num arquivo de pedidos da pasta do ciclo; quando a
etapa termina, um plugin busca numa instância própria de SearXNG e grava um documento com
os resultados e as fontes, que a etapa seguinte lê. É o primeiro plugin real da
plataforma: um acontecimento (`stage-finished`), um tipo de documento novo
(`WEB_SEARCH.md`) e uma chamada externa feita pelo aplicativo (#96).

Decisões já tomadas pela pessoa: o provedor é uma **instância própria de SearXNG** (sem
chave, em geral local); a busca **atende o que os agentes pedirem**; o plugin é escrito
em **JavaScript** contra o kit.

## O que muda para quem usa

- Com o plugin ligado e o endereço do SearXNG preenchido nas configurações dele, um
  agente que escreve perguntas em `SEARCH_REQUESTS.md` recebe, na etapa seguinte, o
  documento `WEB_SEARCH.md` com até cinco resultados por pergunta (título, endereço e
  trecho) e a fonte de cada um.
- O plugin pede a permissão de rede antes de buscar, como todo plugin; enquanto ela não
  vem, a execução espera.
- Uma pergunta já respondida não é buscada de novo: o documento acumula as respostas do
  ciclo.
- Sem o endereço preenchido, o plugin não roda e a lista diz o motivo.

## Regras

1. **Pedido.** `SEARCH_REQUESTS.md` traz uma pergunta por item de lista (`- pergunta`).
   No máximo cinco perguntas novas por etapa; as demais ficam para a etapa seguinte.
2. **Resultado como material.** O documento diz, no topo, que o conteúdo veio da web e
   não é instrução; cada resultado leva o endereço de onde veio.
3. **Só o que foi pedido.** O plugin só busca as perguntas do arquivo; não manda à
   instância nada além delas.
4. **Fronteira.** Toda chamada sai pelo aplicativo, para o endereço configurado, com a
   permissão de rede do plugin, e fica na auditoria.

## Fora do escopo

- Outros provedores de busca (o plugin é de uma instância SearXNG).
- Ler a página inteira de um resultado (só título, endereço e trecho).
- Buscar sem pedido de um agente.

## Aceitação

1. Plugin ligado, endereço preenchido, permissão dada: uma pergunta em
   `SEARCH_REQUESTS.md` vira resultados com fontes em `WEB_SEARCH.md`, na pasta do ciclo,
   lidos pela etapa seguinte.
2. Sem endereço, ou com a permissão recusada, nada é buscado e o motivo é dito.
3. Uma pergunta já respondida não é buscada de novo.
4. O plugin está no repositório, passa a auditoria pública, e seus testes não alcançam
   nenhum host.

## Perguntas em aberto

1. **Como o agente sabe que pode pedir uma busca.** Hoje um plugin não fala com o
   prompt dos agentes. Ou (a) o kit diz para a pessoa acrescentar uma linha às
   instruções extras dos agentes que devem pedir buscas, sem mudar a plataforma, ou (b)
   a plataforma ganha um texto que o plugin ligado acrescenta ao contexto das etapas,
   marcado como vindo do plugin. Recomendação: (a) nesta entrega, e (b) como issue à
   parte, porque mexe no que entra no prompt de todos os agentes.
