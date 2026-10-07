# O plano de testes da comprovação guardada e da imagem marcada

## Como o comportamento foi exercitado

Duas coisas foram feitas: ler o código novo e os testes contra o que a especificação pede, e
rodar. Rodaram, na cópia de trabalho, a suíte do projeto inteiro e as portas de tipos, tema,
catálogo de idiomas e auditoria pública. Além disso, uma sonda foi escrita e rodada para
exercitar por execução um caso estreito que a revisão registrou como observação (o reinício de
um grupo que sobe a imagem e falha na escrita do comentário). Nada foi verificado com um modelo
de verdade, num host de verdade, num navegador pareado aberto nem desenhando sobre JPEG, GIF ou
WebP.

## O que foi exercitado, e o que se viu

### Um arquivo da pasta de saída é guardado como comprovação, e o que não é dela é recusado

O conjunto de ferramentas, dirigido por uma pasta de saída temporária sem modelo e sem sandbox,
guarda um PNG feito pela etapa com o id `ev-1`, lê o tipo dos bytes (um arquivo que se chama
`.png` e é texto é guardado como texto), e recusa com o motivo um caminho fora da pasta, um
caminho com `..`, um arquivo atrás de um vínculo, um arquivo acima do teto e um arquivo de vídeo.
Nada é guardado no conjunto de recusas. A resolução do caminho tem uma rotina própria que aceita o
caminho como a sandbox o nomeia (`/coxia/out/…`) e como relativo, e recusa com o motivo `..`,
caminho absoluto fora da pasta, vínculo (inclusive o de uma dependência dentro da pasta) e arquivo
que não existe. O reconhecimento de tipo por conteúdo cobre PNG, JPEG, GIF, WebP, PDF e texto, e
recusa vídeo, áudio, compactado, executável, conteúdo que não confirma e arquivo acima do teto.
Tudo passou.

### Uma imagem é marcada, cada versão é uma comprovação e a marca inválida é recusada

Cada marca lida: retângulo, seta, elipse, marcador numerado, rótulo e borrão, numa imagem
pequena, conferindo-se o pixel que a marca deveria mudar e que a original não muda. Uma marca com
cor fora da lista, espessura acima do teto, coordenada ou tamanho fora da imagem ou raio inválido
é recusada com o motivo, e nada é desenhado. A imagem marcada vira uma comprovação nova ligada à
de origem. O codificador de PNG grava uma imagem e a lê de volta com os mesmos pixels, e recusa o
que não é PNG. Marcar o que não é imagem, ou um id de outra etapa, é recusado com o motivo. Tudo
passou.

### A comprovação entra na execução: anexo na conversa, listada na etapa, citável no cenário

O conjunto de ponta a ponta do fluxo monta a execução inteira com o motor roteirizado e a sandbox
falsa. O agente de QA guarda uma imagem da pasta de saída e cita `ev-1` num cenário: a execução
registra a comprovação com o id, o título, a etapa e o tipo; a conversa carrega o arquivo como
anexo de uma mensagem; o cenário guarda os ids citados; e citar uma comprovação nunca marca o
cenário como `executed`. Com a escolha padrão, nenhuma pasta de comprovação entra na pasta do
ciclo; com "também na pasta do ciclo", a cópia aparece e entra no commit da etapa (conferido no
ramo). A remoção da comprovação pela pessoa apaga o registro e o arquivo. Tudo passou.

### O envio ao host segue a porta de sempre, na ordem certa

Com um provedor falso e uma porta que registra, um agente autônomo que cita `ev-1` sobe o arquivo
numa chamada e o comentário, já com a imagem embutida pelo endereço que o host respondeu, na
chamada seguinte — as duas registradas. Um agente que espera não posta nada: a única coisa criada
é a proposta, com o envio como primeiro comando do grupo e o comentário como último, e a proposta
guarda só as posições e o índice do corpo, nunca um endereço nem um segredo. Um host que não
planeja o arquivo faz o comentário sair sem a imagem, dizendo quantas peças ficam no app. Um
grupo sob um "sim" roda o envio primeiro e o comentário depois, com o endereço embutido sob o
texto, e as duas escritas aparecem no registro de auditoria. Um espaço de trabalho de teste recusa
a execução, sem enviar nada. O upload é planejado por provedor nos três (GitHub, GitLab e
Bitbucket) e cada comando passa pela conferência do que o host pode receber. Tudo passou.

### As portas do repositório

Todas passam: tipos sem emissão, a suíte inteira (3.704 de 3.704 testes, 228 arquivos), a auditoria
de tema, o catálogo de idiomas (4.106 chaves nos dois idiomas, nenhuma fora de ordem) e a auditoria
pública (927 arquivos, nada que pertença a uma empresa ou a uma pessoa).

## O caso estreito confirmado por execução

Uma sonda foi escrita e rodada para conferir o que a revisão observou: num grupo de um "sim" que
sobe a imagem e escreve o comentário, se o envio tiver sucesso e a escrita do comentário falhar, a
proposta fica como falha; ao ser aprovada de novo, o grupo recomeça do ponto em que parou, mas a
memória dos endereços que os envios responderam é nova a cada aprovação. Na segunda aprovação o
comentário saiu sem a imagem embutida e sem dizer quantas peças existem — as peças ficam no host,
mas o texto não as mostra nem as conta. É um caso estreito (exige a falha do host na escrita do
comentário e uma nova confirmação), e o caminho sem falha está correto; por isso não devolve o
trabalho, mas o campo `scenarios` desta etapa o registra como observação não bloqueante.

## O que não foi verificado

- Um modelo, um host de verdade ou um navegador pareado aberto: nada disso foi usado; o envio e o
  embutimento são exercitados contra provedores falsos.
- A tela da execução e o navegador pareado (abrir, baixar, apagar): lidos no código, não
exercitados numa janela.
- A descrição do pedido de mudança com comprovação citada de ponta a ponta por teste: o mecanismo
de embutir no "sim" foi exercitado no comentário, e a descrição foi conferida por leitura.
- Marcar JPEG, GIF e WebP: a ferramenta só decodifica PNG; os outros são aceitos, vistos, baixados
e enviados, mas não marcados.
- A recusa do vínculo dentro de uma sandbox de verdade: exercitada sobre o sistema de arquivos
real, não dentro de uma sandbox.
- Um provedor real aceitando o envio e devolvendo o endereço de embutimento.

## Detalhe de execução

- `#6` — typescript sem emissão: saída 0.
- `#7` — a suíte inteira do projeto: 228 arquivos, 3.704 testes, todos passam.
- `#8` — auditoria de tema: saída 0.
- `#9` — catálogo de idiomas: 4.106 chaves nos dois idiomas, saída 0.
- `#10` — auditoria pública: 927 arquivos, saída 0.
- `#12` e `#13` — a sonda do caso estreito do reinício do grupo: a primeira aprovação sobe a
imagem e falha o comentário; a segunda conclui, mas o comentário reenviado sai sem a imagem e
sem a contagem das peças.
