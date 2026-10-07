# O que o agente guardou do trabalho, com marcas na imagem

## Veredito

`changes`.

A capacidade pedida está construída de ponta a ponta e se sustenta quase inteira: um agente numa etapa com sandbox guarda um arquivo que ele mesmo fez na pasta de saída como comprovação da etapa, marca a imagem (retângulo, seta, elipse, rótulo, marcador numerado e caixa de borrão) e olha para o resultado; a comprovação é publicada na conversa da execução como anexo, listada na etapa, citável por um cenário e pela saída de etapa, e a escolha do espaço de trabalho decide se uma cópia entra no commit da etapa. A comprovação citada num comentário ou na descrição do pedido de mudança é enviada ao host e embutida no texto, por provedor, com o texto de substituição onde o host não aceita o arquivo. A documentação e o changelog descrevem a capacidade.

O que impede a aprovação é uma trava de segurança **nova**, do diff desta rodada: a imagem citada sobe ao host pela via automática **antes** de qualquer "sim", mesmo quando o comentário que a cita está esperando em Ações (um agente não autônomo) e mesmo na descrição do pedido de mudança, que sempre espera. A promessa de que a pessoa vê cada imagem antes de um "sim" não se cumpre: a imagem já está no host quando a proposta aparece. Exercitado: com um agente não autônomo, o comentário é proposto e a imagem já subiu.

Os bloqueantes da rodada anterior foram atendidos e conferidos; o menor do vínculo de dependência está fechado. Nada disto reabre decisão aceita.

## O que foi conferido nesta etapa

Nada foi implementado nem corrigido aqui. A revisão leu o código e a documentação da entrega, rodou as portas do repositório e **exercitou** a parte que dá para exercitar sem sandbox, sem modelo e sem host:

- **As portas do repositório, todas verdes:** o typecheck passa sem erro; a suíte inteira passa (3702 de 3702, 228 arquivos); o teste de tema passa; o teste de chaves de catálogo passa (4106 chaves nos dois idiomas); a auditoria do que pode ser público passa (927 arquivos).
- **O envio ao host, pelos testes que o exercitam e por um exercício próprio.** O upload de uma comprovação citada por um comentário sobe antes do comentário e o endereço que o host responde sai embutido sob o texto; um host que não planeja o upload faz o comentário sair sem a imagem e dizer quantas comprovações ficam no app. Exercitado com um agente **não autônomo**: o comentário entra em Ações (espera o "sim") e a imagem sobe na mesma hora, pela via automática — é o achado bloqueante.
- **A raiz de leitura.** Um arquivo comum atrás de um vínculo de pasta (o caso `node_modules`) dentro da pasta de saída é recusado com o motivo do vínculo; um caminho escrito direto com link, um `..`, um caminho fora da pasta e um arquivo que não é arquivo continuam recusados.
- **Os menores da rodada anterior:** a chave duplicada do catálogo português sumiu e a chave que faltava existe; o tamanho do arquivo na tela é montado por catálogo; o bloco da comprovação tem estilo; a linha do prompt da QA usa a presença da ferramenta; o id aparece na tela sem o sinal de número.
- **A configuração.** O campo da escolha do espaço de trabalho aparece nos três arquivos do esquema (tipos, padrões e esquema) e no passo de migração, com o padrão seguro lido quando o campo falta.

### O que não foi verificado

- **Nenhum host real foi usado.** O envio e o embutimento são exercitados contra provedores falsos. Que a hospedagem de arquivos do GitHub devolva o endereço esperado, que a subida de arquivo do GitLab funcione com o token e que o Bitbucket aceite a subida não foi visto.
- A conversa, o navegador pareado e o telefone foram lidos no código, não abertos numa janela.
- O desenho e o codec de PNG não foram julgados linha a linha; o que os testes cobrem é o que se sabe deles.
- A decodificação de JPEG, GIF e WebP para marcar não foi exercitada: só PNG é decodificado, e o código confirma.
- Um sandbox de verdade: a recusa do arquivo atrás do vínculo foi exercitada sobre o sistema de arquivos real, não dentro de uma sandbox.

## O achado bloqueante

A imagem de uma comprovação citada sobe ao host **fora** da porta que espera o "sim", quando a escrita que a cita está esperando. O envio acontece pela mesma via automática das escritas que um agente autônomo publica sozinho, e ela roda no momento em que o comentário ou a descrição do pedido de mudança é montado — antes de a proposta ser criada. Com isso: num agente não autônomo, a pessoa vê a proposta do comentário e, ao mesmo tempo, a imagem já está no host; na descrição do pedido de mudança, a imagem sobe quando o push é proposto, enquanto o pedido de mudança ainda espera. A trava "a pessoa vê cada imagem antes de um sim" (a nota final da issue) e a regra 23 da spec ("a de qualquer outro agente espera um sim em Ações, **com as imagens à vista antes de confirmar**") não se cumprem. Num espaço de trabalho de teste a escrita é recusada, porque a via automática passa pela mesma guarda de escrita externa; o problema é só a ordem diante do "sim", não a recusa.

O caso é novo no diff desta rodada: o envio da imagem ao host é o que esta rodada acrescentou, e nem o teste do comentário nem o da descrição do pedido de mudança exercitam um agente não autônomo (os dois usam um agente autônomo), então nada no repositório pega isto hoje.

## O que não foi revisado

- O diff completo do codec de PNG e o desenho de cada marca: julgados pelo teste que os cobre, não linha a linha.
- O comportamento num sandbox de verdade, num host de verdade e numa janela: fora do alcance desta etapa.
