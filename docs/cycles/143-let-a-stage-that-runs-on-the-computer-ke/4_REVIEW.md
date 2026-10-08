# A comprovação da etapa que roda no computador: o que a segunda revisão encontrou

## O que foi revisado e como

Esta revisão conferiu, primeiro, se os quatro bloqueantes da rodada anterior foram tratados; depois releu o diff contra o `1_SPEC.md` (critérios de aceite 1 a 8), contra o `2_PLAN.md` e contra a fronteira de segurança, e rodou os gates do repositório. Tudo o que está dito abaixo como verificado foi lido em arquivo ou rodado nesta cópia.

O que foi rodado, e o resultado:

- `npx tsc --noEmit` — limpo.
- `npx vitest run` (suíte inteira) — **4363 testes passaram, 288 arquivos**, nenhuma falha.
- `npm run i18n:lint` — 4622 chaves nos dois idiomas.
- `node scripts/theme-audit.mjs` — nenhuma cor literal nova.
- `node scripts/public-audit.mjs` — 1215 arquivos, nada que pertença a uma empresa ou a uma pessoa.
- A busca pelo fecho (`lookedPaths`/`keepLooked`) mostra o tratamento da etapa anterior presente no executor, antes do fecho da sessão.

## Os bloqueantes da rodada anterior

Os quatro estão fechados:

- **A chave de texto nova não alcançável.** O teste do catálogo passou a reconhecer o sufixo `.host` como variante e a aceitar a chave base pedida em forma calculada. A suíte está verde. **Permanece um defeito próprio dessa correção, tratado nos achados.**
- **A asserção impossível sobre o esquema de QA.** Trocada por uma asserção sobre o campo de comprovação da etapa; o comentário no teste diz por quê.
- **Os dois casos de fecho no host que não guardavam.** A causa era de produto: a leitura da imagem pela sessão só aceitava o nome `/coxia/out`, que não existe numa etapa de host. A leitura passou a aceitar o caminho real da pasta declarada, e os dois casos guardam e marcam.
- **Os ids repetidos.** Cada peça nova conta o que a etapa já guardou, pelo retrato vivo da execução; a imagem marcada deixa de reusar o id da primeira.

## O que a mudança faz, e o que ela cumpre

A raiz de leitura da comprovação passou a ser um dado da sessão: a sandbox declara o `out` da pasta de etapa, a sessão de host que testa uma interface declara a pasta que ela já cria, e a sessão de host sem teste de interface continua sem pasta nenhuma. O executor decide com um ponto só e as regras de caminho, link, tipo lido dos bytes, teto e ids continuam nos mesmos dois arquivos.

Verificado por leitura:

- Uma etapa de host **sem** teste de interface continua como hoje: a sessão não declara pasta, nenhuma ferramenta de comprovação é oferecida e o texto que ela recebe não muda. É o critério 4.
- Um caminho fora da pasta de saída é recusado pelo mesmo resolvedor e com as mesmas palavras da sandbox. É o critério 2.
- A guarda do que foi visto e não guardado continua pendurada antes do fecho da sessão, no mesmo ponto de sempre. É a ordem que o critério 3 exige.
- A fronteira de segurança do que mudou foi conferida: a leitura de imagem aceita a pasta declarada pela sessão pelos dois nomes (o da sandbox e o caminho real), e um caminho absoluto que não esteja dentro dela continua recusado como de fora, antes de qualquer arquivo ser aberto; a gravação da imagem marcada sai da raiz declarada, sob o mesmo guarda. Nada passa a escrever fora do disco, e a porta de escrita no host de código não é tocada.
- As etapas com sandbox não mudaram de comportamento: a suíte de sandbox e a de comprovação passam sem mudança de expectativa. É o critério 6.
- O critério 7 é provado pela verificação de catálogos, que passa com as duas chaves novas nos dois idiomas.
- O critério 8 foi lido no arquivo: o registro de mudanças tem, sob `## [Unreleased]`, a linha do que mudou, sem número de issue nem nome de arquivo.

## O que bloqueia

Um defeito de produto, novo nesta rodada: na etapa de host, a explicação sobre onde guardar a comprovação nunca chega ao agente. O código pede uma variante de texto pelo caminho de host, mas o mecanismo que traduz os textos só conhece as variantes do host de código e as do ciclo; o sufixo de host de uma etapa não faz parte dele. O resultado é que a chave sai crua no texto que a etapa recebe, no lugar da explicação inteira, e o agente não é avisado de qual pasta guardar. O critério de aceite 5 — “o que a etapa lê sobre a pasta de saída nomeia a pasta real” — não está atendido, e a mudança perde justamente a instrução que faz o agente acertar a pasta. O teste que cobre esse texto é antigo e não mudou nesta rodada, por isso o gate não acusa.

## O que ficou fora desta revisão

- **O comportamento do modo host em execução real.** Nenhuma sessão de host real foi aberta, nada rodou no computador, nenhuma tela foi testada. Os testes que cobrem o modo host usam uma sessão falsa; o que eles provam é o que o executor faz com o que a sessão declara, não o que a sessão de host real declara.
- **A etapa anterior na base.** O fecho que a mudança estende existe no código desta cópia; se veio da etapa anterior ou já estava antes, esta revisão não distingue. Não verificado.
- **O caminho de uma etapa de host que roda de novo** sobre uma comprovação já guardada. Nenhum teste o exercita e esta revisão não o exercitou.
- **A descrição e o esquema da ferramenta de comprovação no motor aberto.** Os nomes dos argumentos só têm teste em uma das formas de motor; a semântica exata da outra forma não foi exercitada.
