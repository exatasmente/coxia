# A checagem de línguas passou a ler as páginas que a construção escreve a partir dos documentos

A revisão devolveu esta etapa com um bloqueante: a checagem de línguas do site nunca olhava uma página de
referência. Elas não são escritas à mão em `site/`; a construção as escreve, uma por língua de cada documento, dentro
de `site/generated/`, e a checagem pulava justamente essa pasta. Assim, um documento bilíngue que perdesse a metade em
português construía sem erro e a checagem anunciava que toda página carregava as duas línguas — a falha que a regra 10
da especificação e o critério de aceitação 13 dizem que ela existe para pegar. Esta passada arruma só isso, o teste que
o prova e o caminho que o torna possível: o gerador passou a poder ser apontado para a raiz de um repositório, para o
teste rodar o gerador de verdade sobre uma cópia dos documentos de verdade. O que foi e o que não foi verificado está
dito no fim.

## O buraco, e o que a checagem passou a fazer

A checagem de línguas olhava as fontes do site e dizia, de cada página, se ela carregava as duas línguas. Como a
construção escreve as páginas de referência em `site/generated/`, e a travessia pulava essa pasta, as únicas páginas
conferidas eram as escritas à mão (`site/**/*.md`): a seção de referência inteira, que é a maioria das páginas do
site, não passava por conferência nenhuma de língua.

Agora a travessia não pula pasta alguma, e as fontes escritas em `generated/` não são julgadas pelo nome do arquivo —
são julgadas pelo documento de que vieram. Para cada documento, a página em inglês e a página em português dela
precisam existir entre as fontes que a construção escreveu (`generated/reference/<documento>.md` e o irmão com a
marca `.pt-br`); a página que diz `<!-- site: one-language -->` está dispensada, como já estava; e uma página que
desenha o link para a outra língua que a construção não escreveu reprova, sendo nomeada pelo endereço que o site
serve. Nada mais mudou no que a checagem aceita: as páginas escritas à mão continuam com as mesmas duas formas de par,
e a mensagem continua nomeando a forma que o site escreve.

## O caminho que faltava para o teste

O teste que prova isso precisa rodar o gerador sobre documentos de verdade e a checagem sobre o que ele escreveu. Para
isso, a função que escreve as fontes deixou de ler fixamente a raiz deste repositório: ela recebe a raiz de um
repositório (esta, quando ninguém diz outra) e a pasta onde escrever (por padrão a pasta de fontes do site sob aquela
raiz). O mesmo vale para a função que monta o conteúdo da construção. Com isso, um teste monta um repositório de
mentira com uma cópia dos documentos reais, roda o gerador ali e roda a checagem sobre as fontes que ele escreveu —
sem sujar a árvore e sem depender de a pasta `site/generated/` existir antes.

## O que foi rodado, e o resultado

| Comando | Resultado |
|---|---|
| `node --check site/scripts/check.mjs` | sintaxe ok |
| `npx vitest run test/site-check.test.ts` | 20 casos, todos verdes |
| `node site/scripts/cli.mjs build` | construção ok, escreve a página de cada documento nas duas línguas |
| `npm run docs:check` sem a metade em português de uma página de referência | saía 0 dizendo que toda página carrega as duas línguas — o defeito, reproduzido antes da correção |
| `npm run docs:check` com as duas línguas presentes | sai 0 |
| `npx vitest run test/site-reference-languages.test.ts` | 1 caso verde, 2 vermelhos: o arquivo ainda espera o formato antigo das mensagens e ficou incompleto nesta passada |

## O que não foi verificado

- O teste novo que prova a falha não está fechado: um dos casos precisa ser reescrito para o formato real das
  mensagens, e outro precisa reproduzir a forma como um documento que perde uma metade chega à checagem.
- Não correram nesta passada o typecheck, a suíte inteira, a auditoria de tema, o lint de idiomas, a auditoria
  pública nem a construção com o endereço base de publicação.
- O site no ar, a publicação ligada na configuração do repositório, uma mudança posterior em `docs/` ou no
  `CHANGELOG.md` atualizando o site na mesclagem e o agente de documentação construindo o site com um modelo de
  verdade: nada disso é verificável nesta árvore.
- A sugestão da revisão de ligar as duas línguas por link nas páginas escritas à mão continua sem ser comportamento
  coberto; a navegação leva ao par, e a checagem só reprova quando o texto da página troca esse par por outro.
