# O que o agente guardou do trabalho, com marcas na imagem

## Veredito

`changes`.

O núcleo pedido na issue está construído e se sustenta na maior parte: um agente que trabalha numa etapa com sandbox ganha três ferramentas — guardar um arquivo da pasta de saída como comprovação, marcar uma imagem e olhar para o resultado —, a comprovação é publicada na conversa da execução como anexo de uma mensagem, aparece listada na etapa, pode ser citada por um cenário, é gravada num id estável no espaço de trabalho, e a escolha do espaço de trabalho decide se uma cópia entra no commit da etapa. As recusas que a spec exige foram exercitadas e acontecem com o motivo certo.

O que impede a aprovação é o resto da issue: **nada leva a comprovação ao host de código** e **nada foi escrito na documentação nem no changelog**. Sem o primeiro, os critérios de aceite 3 e 11 e as regras 22 a 27 da spec não têm código nenhum; sem o segundo, o `4_REVIEW.md` que a etapa da revisão produz seria o primeiro documento a falar da capacidade. São dois blocos ausentes, não defeitos de detalhe.

Além disso, sete achados de menor porte estão anotados nas linhas do código, dos quais o mais relevante é que a pasta de saída não é uma redoma: os vínculos das dependências ficam dentro dela no host, então um caminho que não tem `..` e que termina num arquivo comum pode ainda assim atravessar um link.

## O que foi conferido nesta etapa

Nada foi implementado nem corrigido aqui. Esta revisão leu o código e a documentação da entrega e **exercitou** as partes que dão para exercitar sem sandbox, sem modelo e sem host:

- **As ferramentas de comprovação, pelos manipuladores que os motores chamam.** Uma pasta de saída de verdade e um armazenamento de verdade: guardar um arquivo próprio funciona e responde com `ev-1`; outro arquivo guardado na sequência responde `ev-2` e os dois ficam no disco; um caminho fora da pasta é recusado; `..` é recusado; um arquivo que se diz imagem e é texto é guardado como texto; um arquivo acima do teto é recusado dizendo o teto; um caminho que passa por um link é recusado sem seguir o link; uma pasta de leitura do computador (o `/etc` de um sistema com `/usr` e `/etc` montados) é recusada.
- **Os caminhos e as marcas, pelo módulo puro.** Uma chave inexistente dentro da pasta de saída é recusada; `/coxia/out/algo.png` é a mesma coisa que o caminho real; a lista de marcas recusa cor fora da lista fixa.
- **A cópia para o commit da etapa e o id.** A cópia do arquivo guardado vai para `docs/cycles/<n>-<slug>/evidence/<id>.<ext>` no worktree; o id da execução é o maior usado mais um.
- **As portas do repositório.** O typecheck passa sem erro; o teste de tema passa; o teste de chaves de catálogo passa; o teste do que pode ser público passa; a suíte inteira passa com isolamento (3695 de 3696; a única falha é um teste de tempo de `update.sh` que não toca esta mudança — isolado, ele passa três vezes seguidas).
- **A leitura do código da entrega.** As ferramentas são oferecidas só a uma etapa com sandbox, e a presença dos manipuladores é o que decide se o modelo é convidado a guardar; a comprovação não entra em `produces` nem em `reads`; o commit da etapa pega a pasta nova; o navegador pareado lê os bytes pelo mesmo canal de `runs:*` e não muda a escolha do espaço de trabalho, como `runner.identity`.

### O que não foi verificado

- **O envio ao host de código: não existe.** Não há operação de upload, e nada embute imagem em comentário nem na descrição do pedido de mudança.
- Nenhum provedor real foi usado (nem por esta entrega nem pelo projeto): o que cada host aceita continua sendo o que a documentação diz.
- O desenho e o codec de PNG não foram julgados linha a linha; o que os testes cobrem é o que se sabe deles.
- O comportamento em tela (lista da etapa, miniatura, abrir, baixar, apagar, anexo na conversa, citação no cenário) foi lido no código, não aberto numa janela.
- A decodificação de JPEG, GIF e WebP para marcar não foi exercitada; a entrega diz que só PNG é decodificado, e o código confirma.

## O que falta da issue

**O bloco 4 não foi implementado.** A operação de upload não foi acrescentada ao conjunto de escritas do provedor nem aos planejadores dos três hosts, e o publicador não embute imagem nenhuma: nem no corpo do comentário de uma etapa, nem na descrição do pedido de mudança. É o item 4 da issue, as regras 22 a 27 da spec e os critérios de aceite 3 e 11. O que existe hoje é a porta de Ações para comentários comuns; a imagem não passa por ela porque não há imagem a passar.

**A documentação e o changelog não mencionam nada disto.** Nem a página do runner, nem a da configuração (o campo novo e o esquema 13), nem a seção de mudanças não lançadas. Quem lê a documentação do produto não descobre a capacidade.

## Um ponto sobre a mudança como um todo

A pasta de saída não é, por si só, um lugar seguro de onde só sai o que a etapa fez. No host, os vínculos das dependências do clone ficam **dentro** dessa pasta, e o sandbox monta a pasta de saída como ela é. A recusa de link cobre o caminho que o modelo escreve — conferido: um link escrito direto é recusado —, mas não cobre o arquivo que fica atrás de um vínculo de dependência: `node_modules/algo/x.txt` não tem `..`, não passa por link no texto e termina num arquivo comum, então é aceito. Não é um caminho de escalada alta para quem já trabalha na sandbox, mas é a porta que a spec quer fechada com "nunca um caminho que passe por um link", e a revisão da pasta de saída deveria cobrir o vínculo, e não só o caminho escrito.

## O que não foi revisado

- O diff completo do codec de PNG (leitura e escrita) e o desenho de cada marca: julgados pelo teste que os cobre, não linha a linha.
- O comportamento num sandbox de verdade, num host de verdade e numa janela: fora do alcance desta etapa.
