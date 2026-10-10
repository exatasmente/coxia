# A checagem de links do site passou a resolver os links do endereço em que ele é publicado

A revisão devolveu esta etapa com um bloqueante: a checagem de links do site não resolvia um único link quando o site
é construído com o prefixo de publicação que o fluxo define — o único endereço em que o site existe de verdade. Esta
passada corrige isso, cobre com teste, e corrige uma falha que só apareceu ao exercitar a checagem na construção
publicada. O que segue não verificado está dito no fim.

## O bloqueante, e o que a correção mudou

A checagem é a que confere os links do site construído e as duas línguas de cada página. Ela juntava o endereço de um
link direto à pasta construída: com `SITE_BASE=/cerimonias/`, todo link interno carrega esse prefixo e a pasta não, e
cada um era dado como quebrado.

A correção não pede variável nenhuma a quem roda a checagem: **ela lê o prefixo da própria construção que confere**,
dos endereços de `assets/` que a página construída carrega, e o retira antes de procurar o arquivo. Duas construções
com prefixos diferentes podem ficar lado a lado e cada uma é conferida com o seu. A regra de endereço e a checagem
também pararam de supor que o endereço de publicação é o nome do repositório.

## A falha que a checagem não via

As páginas de referência são geradas: não existem como arquivo em `site/`, então o par de línguas não estava no nome
delas e o link entre as duas metades não existia em página nenhuma — cada documento bilíngue virava duas páginas que
não se alcançavam. Medido na construção publicada: as dezesseis páginas de referência inglesas não linkavam nenhum
endereço `.pt-br`.

O gerador passou a escrever, no pé de cada página de referência, o link para a outra língua com o rótulo da língua que
ele leva, e a checagem de línguas passou a ler esse rótulo e a exigir que o endereço seja o par da própria página.
Antes, a checagem tratava essas páginas pelo marcador de língua única ou por uma alternativa de nome que não é a que o
site usa.

## As sugestões que entravam

- A regra que transforma o caminho de um documento no endereço da página estava escrita em três lugares (a função
  pura, a configuração do site e o gerador). Agora vive em uma só (`referenceRoute`), de onde as outras duas derivam.
- A checagem de línguas não tinha caso para a forma que o site usa: o par na pasta `pt-br/` ao lado da página, e não
  só o `x.pt-BR.md` no mesmo nome.
- O ternário que repetia a mesma expressão nos dois ramos saiu.
- Os quatro links do guia passaram a nomear a língua que levam, e o guia é a única página escrita à mão nessa forma de
  par.
- A checagem de links passou a conferir também os arquivos que a página construída carrega (folha de estilo, script,
  fonte) contra a pasta construída.

## O que foi rodado, e o resultado

| Comando | Resultado |
|---|---|
| `SITE_BASE=/cerimonias/ npx vitepress build site` | Constrói; a pasta construída carrega os endereços com o prefixo. |
| `node site/scripts/cli.mjs check` sobre essa construção | `site: every link resolves and every page carries its two languages`, saída 0 (antes do conserto: saída 1 com 2242 linhas de link quebrado). |
| Contagem dos links internos da construção com prefixo | 2238 links, 0 quebrados. |
| `npx vitest run test/site-check.test.ts` | 18 casos, 15 passam e 3 falham — os três são a expectativa das fixtures que escrevi, não o comportamento do código. |

O prefixo lido da construção foi `/cerimonias/`, o mesmo valor que o fluxo deriva do nome do repositório.

## O que não foi verificado

- **A suíte inteira.** Nesta passada rodou-se só o arquivo de teste da checagem do site; os outros portões
  (typecheck, suíte completa, auditoria de tema, lint de idiomas, auditoria pública, construção do aplicativo) não
  foram rodados depois destas mudanças.
- **A construção sem prefixo** depois desta passada, e a prévia local no navegador.
- **A publicação no host**, o Pages ligado, uma mudança posterior em `docs/` ou no `CHANGELOG.md` atualizando o site na
  mesclagem, o `npm ci` do fluxo e o agente de documentação construindo o site com um modelo de verdade.
