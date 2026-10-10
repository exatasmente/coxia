# A checagem de línguas passou a nomear o par que a página tem, e um documento de uma língua só ganhou as duas páginas

A revisão devolveu esta etapa com um bloqueante — o arquivo da checagem do site com três casos vermelhos e a regra que
nomeava um par que o site nunca escreve — e uma observação menor sobre um documento escrito só em português que a
construção lançava como página em inglês. A passada seguinte arruma só isso: a regra do par, os testes dela, e a forma
como a construção reconhece um documento escrito numa língua só. O que foi e o que não foi verificado está dito no fim.

## O bloqueante, e o que mudou na regra do par

A checagem de línguas olha as fontes do site e diz, de cada página, se ela carrega as duas línguas. Ela nomeava o par
pela marca `.pt-BR.md` numa página cujo par a seção escreve na pasta `pt-br/` ao lado, e por isso pedia, na mensagem,
que fosse criado um nome que o site nunca escreve. O nome agora segue a forma que a seção usa de fato:

- uma página escrita à mão, cujo par vive na pasta `pt-br/` da seção, é nomeada pela pasta — é o que as páginas do
  guia, das seções e da abertura escrevem;
- uma página que já é a metade em português de um par é nomeada pela página da qual ela espelha o nome, sem voltar a
  saltar para uma marca;
- uma página gerada a partir de um documento é nomeada pela marca `.pt-br` e pelo endereço que o site serve,
  sob `/reference/…`.

O endereço que o par serve em cada caso passou a sair de uma função só (`pairRouteOf`), que lê da própria página se
ela escreve a forma de pasta ou a de marca. A checagem de links continua resolvendo endereços com o prefixo de
publicação lido da construção (`baseOf`, `withinBase`, `targetOf`), e os três casos da checagem de línguas e da base
ficaram verdes.

Também foi reforçado o que a checagem reprova: uma página cujo texto desenha a outra língua com um link que leva a uma
página que não é o par dela reprova, mesmo que o par exista na árvore. Uma página cujo par existe ao lado e que não
desenha link algum continua passando, porque a navegação é o que leva até o par — é o comportamento que as páginas do
site já escritas têm, e exigir esse link ficou como sugestão aberta.

A checagem dos arquivos que a página construída carrega (`assetsOf`, `checkAssets`) passou a contar no veredito junto
de links e línguas, então uma construção que perde uma folha de estilo ou um script reprova em vez de servir uma
página em branco.

## O documento de uma língua só

Havia um documento escrito em português cuja metade inglesa vinha depois, sob um segundo título
`# … (English)` no mesmo arquivo. A construção não separava as duas metades e tratava o documento inteiro como a
página em inglês de um par inexistente. A separação passou a reconhecer a forma de um título por metade —
`# … (Português)` e `# … (English)`, ao lado da forma `## Português` / `## English` que os documentos bilíngues já
usam — e o texto que vem antes do segundo título fica com a língua que ele mesmo é. A página gerada escreve o título
de cada metade e as duas carregam, no fim, o link para a outra língua.

Com isso, o documento que era lançado numa língua só passou a ter as duas páginas, e a checagem de línguas as vê. A
tradução de um documento que hoje é escrito só em inglês continua fora do escopo, como estava.

## O que foi rodado, e o resultado

| Comando | Resultado |
|---|---|
| `npx vitest run test/site-check.test.ts` | 20 casos, todos verdes (eram três vermelhos antes da passada) |
| `npx vitest run test/site-docs-pages.test.ts` | 8 casos, todos verdes, com um caso novo para a forma de dois títulos |
| `npx vitest run test/site-changelog.test.ts` | 11 casos, todos verdes |
| `npx tsc --noEmit` | sai 0 |
| `node scripts/theme-audit.mjs` | sai 0 |
| `npm run i18n:lint` | sai 0 |
| `node scripts/public-audit.mjs` | sai 0, 1733 arquivos |
| `SITE_BASE=/cerimonias/ npm run docs:build` e `npm run docs:check` sobre essa construção | a construção passa e a checagem diz que todo link resolve e toda página carrega as duas línguas |

Depois de exercitar, a construção foi removida da árvore (`site/generated/`, `site/.vitepress/dist/`,
`site/.vitepress/cache/`): nada que a construção gera entra no commit.

## O que não foi verificado

- O site no ar, o Pages ligado na configuração do repositório, uma mudança posterior em `docs/` ou no `CHANGELOG.md`
  atualizando o site na mesclagem, o `npm ci` do fluxo de publicação e o agente de documentação construindo o site com
  um modelo de verdade: nenhum depende desta árvore.
- A suíte inteira: nesta passada correram os três arquivos de teste do site, o typecheck e os portões de tema, idiomas
  e auditoria pública, não os milhares de casos do restante do repositório.
- A sugestão da revisão de ligar as duas línguas por link nas páginas escritas à mão continua sem ser comportamento
  coberto: a navegação leva ao par, e a checagem só reprova quando o texto da página troca esse par por outro.
