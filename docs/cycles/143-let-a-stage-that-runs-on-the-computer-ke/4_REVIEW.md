# A comprovação da etapa que roda no computador: o que a terceira revisão encontrou

## O que foi revisado e como

Esta revisão conferiu, primeiro, o bloqueante da rodada anterior; depois releu o diff contra os critérios de aceite 1 a 8, contra o plano e contra a fronteira de segurança, e rodou os gates do repositório. Tudo o que está dito abaixo como verificado foi lido em arquivo ou rodado nesta cópia; o que não foi verificado está dito como tal.

O que foi rodado, e o resultado:

- `npx tsc --noEmit` — limpo.
- `npx vitest run` (suíte inteira) — **4363 testes passaram, 288 arquivos**, nenhuma falha.
- `npm run i18n:lint` — 4622 chaves nos dois idiomas.
- `node scripts/theme-audit.mjs` — nenhuma cor literal nova.
- `node scripts/public-audit.mjs` — 1215 arquivos, nada que pertença a uma empresa ou a uma pessoa.

## O bloqueante da rodada anterior

O bloqueante era: na etapa de host, o texto da regra de comprovação sairia com a chave crua (`runner.rules.evidence.host`) no lugar da explicação, porque o mecanismo de textos não conheceria um sufixo de host de etapa. **Ele não se reproduz no código desta cópia**, e a conferência foi feita exercitando o caminho, não só lendo-o:

- O mecanismo procura primeiro a chave exata que o código pede. O id que a etapa de host recebe é `runner.rules.evidence.host`; a chave exata correspondente é `prompt.sdd.runner.rules.evidence.host`, que existe nos dois catálogos. Um exercício isolado do caminho de tradução devolveu a redação inteira dessa chave, com o `{out}` preenchido, e não a chave.
- As variantes (`.novoice`, as do host de código `.on-*` e as do ciclo `.off-*`) são tentadas como candidatas adicionais, não no lugar da chave exata. Repetido o exercício com o host de código em vigor, a lista de candidatos do id é `['prompt.sdd.runner.rules.evidence.host.on-github', 'prompt.sdd.runner.rules.evidence.host']`: o segundo candidato é a própria chave e resolve.
- O caminho que o código usa é o que lança quando não encontra texto, não o que devolve a chave: o texto da etapa é montado por uma função que lança ao não achar a chave. Uma variante inalcançável daria erro, não chave crua no prompt.
- O teste que cobre o texto da etapa de host passa, e a assertiva nova confere que o texto recebido não traz o id da chave.

Fica como **sugestão** — não bloqueia — que a assertiva nova sozinha não distingue a redação da variante de host da redação base quando as duas resolvem (ver os achados): a prova que ela dá é de que não há chave crua, que era o ponto do bloqueante.

## O que a mudança faz, e o que ela cumpre

A raiz de leitura da comprovação é um dado da sessão: a sandbox declara o `out` da pasta de etapa, a sessão de host que testa uma interface declara a pasta que ela já cria, e a sessão de host sem teste de interface continua sem pasta nenhuma. O executor decide com um ponto só, e as regras de caminho, link, tipo lido dos bytes, teto e ids continuam nos mesmos dois arquivos.

Verificado por leitura, critério a critério:

- **Critério 1** (a etapa de host que testa uma interface guarda comprovação): a sessão de host declara a pasta de saída, e o executor monta as ferramentas de comprovação para toda sessão que declara uma pasta quando a configuração manda guardar. O caso de teste correspondente guarda um arquivo dessa pasta e vê o id na execução citado por um cenário; passa na suíte.
- **Critério 2** (recusa de um caminho fora da pasta): o mesmo resolvedor de caminho vale para os dois modos, com as mesmas palavras de recusa; os testes cobrem o caminho absoluto de fora, o `..` e o link, contra uma raiz que é a pasta do host; passam.
- **Critério 3** (o que foi visto e não guardado não se perde): a guarda roda pendurada no fim do trabalho da etapa, no mesmo ponto de sempre, antes do fecho da sessão — a chamada à guarda vem antes do fecho no `finally`. O teste correspondente lê o estado da execução no instante do fecho e vê o id já guardado; passa.
- **Critério 4** (etapa de host sem teste de interface continua como hoje): sem pasta declarada, as ferramentas não são oferecidas, o campo de comprovação não entra no que o agente é chamado a responder e nada é guardado; o texto da etapa não menciona comprovação. Os testes cobrem a sessão sem pasta e o fluxo sem interface; passam.
- **Critério 5** (o texto nomeia a pasta real): o texto da regra de comprovação usa um parâmetro com a pasta real nos dois modos; a variante de host existe nos dois catálogos e resolve, como conferido acima. O teste correspondente lê o texto de sistema de uma etapa de host com pasta real; passa.
- **Critério 6** (a sandbox não muda): o resolvedor passou a receber a raiz em vez da pasta de etapa, sem mudar regra alguma, e os testes da sandbox e da comprovação passam sem mudança de expectativa (o único ajuste foi o da raiz nos testes do resolvedor).
- **Critério 7** (as duas línguas): a verificação de catálogos passa com as chaves novas nos dois idiomas.
- **Critério 8** (a mudança contada a quem usa): lido no arquivo, o registro de mudanças tem, sob `## [Unreleased]`, a linha do que mudou, sem número de issue nem nome de arquivo ou função.

**Fronteira de segurança**, conferida por leitura linha a linha: a leitura de imagem aceita a pasta declarada pela sessão pelos dois nomes (o nome que a sandbox usa por dentro e o caminho real da pasta) e recusa, antes de abrir qualquer arquivo, o que não está dentro dela; a gravação da imagem marcada sai da raiz declarada, sob o mesmo guarda; o resolvedor continua recusando o caminho de fora, o `..` e o link. Nada passou a escrever fora do disco, e nenhum caminho novo escreve no host de código fora da porta de sempre.

## O que bloqueia

Nada. Nenhum critério de aceite ficou sem atendimento, nenhum defeito novo apareceu no diff desta rodada, e os gates ficam verdes.

## As sugestões

Duas, nenhuma bloqueante: a redação do achado sobre a assertiva nova, e a observação sobre a cobertura do texto que a etapa de host lê. Ambas estão nos comentários das linhas.

## O que ficou fora desta revisão

- **O comportamento do modo host em execução real.** Nenhuma sessão de host real foi aberta, nada rodou no computador, nenhuma tela foi testada. Os testes que cobrem o modo host usam uma sessão falsa; o que eles provam é o que o executor faz com o que a sessão declara, não o que a sessão de host real declara.
- **A dependência declarada na base.** O fecho que a mudança estende existe no código desta cópia; a revisão não distingue se ele veio da etapa anterior ou já estava antes, nem confirma o estado da ramificação da qual a entrega saiu.
- **O caminho de uma etapa de host que roda de novo** sobre uma comprovação já guardada. Nenhum teste o exercita e esta revisão não o exercitou.
- **A descrição e o esquema da ferramenta de comprovação na forma do motor aberto.** Os nomes dos argumentos só têm teste em uma das formas de motor; a semântica exata da outra forma não foi exercitada.
