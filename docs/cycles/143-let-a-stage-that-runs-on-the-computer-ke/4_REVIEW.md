# A comprovação da etapa que roda no computador: o que a revisão encontrou

## O que foi revisado e como

A revisão comparou o que a branch mudou com o que a especificação pediu e o que o plano
descreveu, leu os arquivos de produção e de teste que a mudança toca, e rodou os gates do
repositório. Tudo o que está dito abaixo como verificado foi lido ou rodado nesta cópia.

O que foi rodado, e o resultado:

- `npx tsc --noEmit` — limpo.
- `npx vitest run` (suíte inteira) — **4 testes falharam de 4363**. Os gates de CI, portanto,
estão vermelhos e o critério de aceite 3 e o 4 não ficam provados.
- `node scripts/theme-audit.mjs`, `npm run i18n:lint` (4622 chaves nos dois idiomas),
`node scripts/public-audit.mjs` (1214 arquivos, nada que pertença a uma empresa ou a uma
pessoa) — passam.

## O que a mudança faz, e o que ela cumpre

A raiz de leitura da comprovação passou a ser um dado da sessão. A sessão de sandbox declara
o `out` da pasta de etapa, a sessão de host que testa uma interface declara a pasta que ela
já cria, e a sessão de host sem teste de interface continua sem pasta nenhuma. O executor
passou a decidir com um ponto só, e as regras de caminho, link, tipo lido dos bytes, teto e
ids não foram reescritas — continuam nos mesmos dois arquivos.

Verificado por leitura:

- Uma etapa de host **sem** teste de interface continua como hoje: a sessão não declara
pasta, a condição do executor não muda, nenhuma ferramenta de comprovação é oferecida e o
texto que a etapa recebe não muda. É o critério 4, e a leitura confirma o desenho (o teste
que devia travá-lo está vermelho, ver os achados).
- Um caminho fora da pasta de saída é recusado com o mesmo resolvedor e as mesmas palavras
que a sandbox usa — o resolvedor é literalmente a mesma função, agora com a raiz vinda de
fora. É o critério 2.
- As regras do repositório que esta mudança pode quebrar foram conferidas: nada escreve
fora do disco, logo a fronteira de `Actions` não é tocada; não há campo de configuração
novo, logo não falta passo em `STEPS` nem nos três arquivos de tipos, padrões e esquema; os
textos novos entraram nos dois catálogos; não há cor literal nova no renderizador; a
conferência pública passa.
- As etapas com sandbox não mudaram de comportamento: a suíte de sandbox e a suíte de
comprovação passam sem nenhuma mudança de expectativa (o único ajuste de teste da sandbox
foi o da raiz do resolvedor, que o plano previu). É o critério 6.
- A guarda do que foi visto e não guardado continua pendurada no `finally`, antes do fecho da
sessão. É a ordem que o critério 3 exige.

## O que bloqueia

Quatro testes falham na suíte.

O mais importante não é um teste mal escrito: a chave de texto nova que ensina à etapa de
host onde guardar a comprovação não é alcançável pelo mecanismo que entrega as variantes de
texto por país. O teste que percorre o catálogo de prompts recusa as duas chaves novas como
“não usadas”: a chave base, porque o código só a pede em forma calculada, e a variante de
host, porque o mecanismo lê uma variante pela chave base dela e não reconhece o sufixo
`.host`. A consequência prática é que a etapa de host não é avisada do caminho real — o
critério de aceite 5 não está atendido.

Os outros três são testes da própria mudança que não passam: a asserção sobre o esquema de
resposta do cenário de QA (o esquema de cenário sempre traz o campo `evidence`, então a
asserção está errada) e dois casos do fecho no modo host que não guardaram o que o agente
olhou. Enquanto a suíte estiver vermelha, o gate de CI do repositório falha.

## O que ficou fora desta revisão

- **O comportamento do modo host em execução real.** Nenhuma sessão de host real foi aberta,
nada rodou no computador, nenhuma tela foi testada. Os testes que cobrem o modo host usam
uma sessão falsa; o que eles provam é o que o executor faz com o que a sessão declara, não o
que a sessão de host real declara.
- **A #142 na base.** O fecho que a mudança estende existe no código desta cópia. Se ele veio
da #142 ou já estava antes, esta revisão não conseguiu distinguir; não foi verificado.
- **A linha do `CHANGELOG.md`.** O arquivo aparece como modificado na branch, mas o conteúdo
da entrada sob `## [Unreleased]` não foi lido nesta revisão, então o critério de aceite 8 não
fica atestado por leitura — fica pendente de quem fechar o ciclo.
- **O caminho de uma etapa de host que roda de novo** sobre uma comprovação já guardada.
Nenhum teste o exercita e esta revisão não o exercitou.
- **A descrição e o esquema de `SaveEvidence` no motor aberto.** A pasta chegou às duas formas
da ferramenta e a mudança está certa de contrato, mas o único teste dos nomes dos
argumentos roda sobre a forma do Claude; a semântica exata do `parameters` na forma do motor
aberto não foi exercitada.
