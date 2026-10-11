# A checagem de línguas passou a julgar a página de referência pelo documento que a declara

A revisão devolveu esta etapa com dois bloqueantes. O primeiro era o da rodada 3, ainda aberto: a checagem de línguas
nunca pegava uma página de referência que perdesse uma língua. A causa só apareceu nesta passada, ao instrumentar a
construção de verdade: quando um documento bilíngue perde a metade em português, a construção o escreve como uma página
de **uma língua só**, com a marca `<!-- site: one-language -->` — exatamente a forma de um documento que nunca teve uma
segunda língua. Não há como o gerado distinguir os dois; a checagem, portanto, tem de decidir pelo que o repositório
declara, não pelo arquivo que a construção escreveu. O segundo bloqueante eram os tipos vermelhos e dois casos do teste
novo. Os dois estão fechados.

## O buraco, e o que a checagem passou a fazer

O índice de `docs/` declara, documento por documento, as línguas em que ele é escrito (a coluna de línguas da tabela:
`pt-BR, en` ou `en`). Essa declaração é a única coisa que sobrevive a uma metade perdida: o documento que perdeu o texto
em português continua listado como bilíngue, enquanto a página que a construção escreveu para ele é de uma língua só.

Agora a checagem julga cada documento de referência contra essa declaração:

- para um documento declarado bilíngue, a página inglesa que a construção escreveu precisa existir, **não** pode
  carregar a marca de uma língua só, precisa desenhar o link para o par, e o arquivo `.pt-br` precisa existir;
- a falha é nomeada pelo endereço que o site serve (`/reference/memory` sem `/reference/memory.pt-br`), como antes;
- um documento declarado em uma língua só (`docs/i18n.md`, `docs/voice.md`) não precisa de par e não reprova;
- um documento que o índice não menciona é julgado pelo que o próprio arquivo carrega, como antes.

## Um segundo defeito, achado no caminho

`otherLanguageLink` reconhecia só a forma HTML do link de outra língua (`<a href="…" title="Português">`). As páginas
geradas de `docs/` escrevem o link em Markdown — `[Português](/reference/runner.pt-br "Português")` —, então o link de
par de uma página gerada era invisível para a checagem. Com a regra nova, isso reprovava páginas saudáveis; e, sem ela,
uma página cujo link de par levasse a outro lugar passaria. A função passou a ler as duas formas.

## O que foi rodado, e o resultado

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | sai 0 (o erro TS7006 do teste novo sumiu) |
| `npx vitest run` (suíte inteira) | 7676 passam, 3 pulados, 0 falham (457 arquivos passam, 1 pulado) |
| `npx vitest run test/site-reference-languages.test.ts` | 3 casos, todos verdes |
| `npx vitest run` dos cinco arquivos de site/readme | 41 casos, todos verdes |
| `node scripts/theme-audit.mjs` | sai 0 |
| `npm run i18n:lint` | sai 0 |
| `node scripts/public-audit.mjs` | 1734 arquivos, nada, sai 0 |
| `SITE_BASE=/cerimonias/ npm run docs:build` e `npm run docs:check` | construção e checagem saem 0 sobre a árvore sem defeito |

A falha do critério 13 foi provocada **na árvore real**: removida a metade `## Português` de `docs/memory.md` e
construído o site com `SITE_BASE=/cerimonias/`, a checagem passa a nomear `/reference/memory` e a metade ausente, com
saída 1 — antes ela saía 0 dizendo que toda página carregava as duas línguas. O documento foi restaurado, a construção
refeita e a checagem voltou a sair 0. Sobre uma cópia descartável, a mesma prova: a árvore saudável não gera achado
nenhum, e a que perde a metade gera exatamente um.

## O que não foi verificado

- O site no ar, a publicação ligada na configuração do repositório, uma mudança posterior em `docs/` ou no
  `CHANGELOG.md` atualizando o site na mesclagem, e o agente de documentação construindo o site com um modelo de
  verdade: nada disso é verificável nesta árvore.
- As sugestões não bloqueantes da revisão (o endereço dos README aceitar qualquer host, a checagem de links não olhar
  `src`, as páginas escritas à mão não ligarem as línguas por link) continuam fora do escopo desta passada.
