# A imagem citada sobe junto com a escrita que a libera

## Veredito

`approved`.

Os dois bloqueantes da rodada anterior foram atendidos e conferidos, e o menor também. A imagem de uma comprovação citada deixou de sair antes de um "sim": agora ela é parte do mesmo grupo de comandos que a escrita que a cita, na ordem certa (o envio antes, o comentário depois), e o caso do agente que espera não põe nada no host até a pessoa confirmar. A descrição do pedido de mudança passou a guardar apenas os ids citados no rascunho, e as imagens entram no grupo da proposta do próprio pedido de mudança, que sempre espera.

A capacidade como um todo segue construída de ponta a ponta: um agente numa etapa com sandbox guarda um arquivo que ele mesmo fez na pasta de saída como comprovação (com o tipo lido dos bytes, teto de tamanho e recusa de caminho fora, `..` e vínculo), publica na conversa como anexo, lista na etapa, é citável por um cenário e pela saída de etapa, é marcável e olhável, e a escolha do espaço de trabalho decide se uma cópia entra no commit da etapa.

Há uma sugestão não bloqueante sobre o restabelecimento de um grupo que falha no meio (detalhada adiante). Nada disto reabre decisão aceita das rodadas anteriores.

## O que foi conferido nesta etapa

Nada foi implementado nem corrigido aqui. A revisão leu o código e a documentação da entrega, rodou as portas do repositório e **exercitou** a parte que dá para exercitar sem sandbox, sem modelo e sem host:

- **As portas do repositório, todas verdes:** o typecheck passa sem erro; a suíte inteira passa (3704 de 3704, 228 arquivos); o teste de tema passa; o teste de chaves de catálogo passa (4106 chaves nos dois idiomas); a auditoria do que pode ser público passa (927 arquivos).
- **O bloqueante do comentário.** Exercitado por teste: um comentário de um agente que **espera** e cita uma comprovação **não posta nada** — a única coisa criada é a proposta, com o envio como primeiro comando do grupo e o comentário como último; o restante do texto da proposta não carrega endereço algum (a proposta nunca guarda o que ainda não existe). O mesmo teste cobre o agente **autônomo**: a imagem sobe numa chamada auditada e o comentário, já com o endereço embutido, na chamada seguinte. Um teste de grupo, sob um "sim", roda o envio primeiro e o comentário depois, com o endereço que o host respondeu embutido sob o texto — e os endereços são preenchidos na hora de rodar, nunca guardados na proposta.
- **O bloqueante da descrição do pedido de mudança.** Conferido por leitura: a etapa que muda o código guarda os ids citados no rascunho da descrição e **não envia imagem nenhuma**; o envio é planejado como o começo do grupo da proposta do pedido de mudança, que sempre espera um "sim". O mecanismo de embutir no "sim" foi exercitado no caso do comentário; o caminho do pedido de mudança de ponta a ponta não foi exercitado por teste e está dito como não verificado.
- **Os menores da rodada anterior:** o comentário duplicado sobre o vínculo em `paths.ts` saiu; a chave de catálogo que faltava existe e a duplicata sumiu; o tamanho do arquivo na tela é montado por catálogo; o bloco da comprovação tem estilo; a linha do prompt de QA usa a presença da ferramenta; o id aparece na tela sem o sinal de número. Cada um foi lido no código desta entrega.
- **A configuração.** O campo da escolha do espaço de trabalho aparece nos três arquivos do esquema (tipos, padrões e esquema) e no passo de migração, com o padrão seguro lido quando o campo falta.

### O que não foi verificado

- **Nenhum host real foi usado.** O envio e o embutimento são exercitados contra provedores falsos. Que a hospedagem de arquivos do GitHub devolva o endereço esperado, que a subida de arquivo do GitLab funcione com o token e que o Bitbucket aceite a subida não foi visto.
- A conversa, o navegador pareado e o telefone foram lidos no código, não abertos numa janela.
- O desenho e o codec de PNG não foram julgados linha a linha; o que os testes cobrem é o que se sabe deles.
- A decodificação de JPEG, GIF e WebP para marcar não foi exercitada: só PNG é decodificado, e o código confirma.
- Um sandbox de verdade: a recusa do arquivo atrás do vínculo foi exercitada sobre o sistema de arquivos real, não dentro de uma sandbox.
- A descrição do pedido de mudança com comprovação citada não foi exercitada de ponta a ponta por teste (o mecanismo de embutir no "sim" foi exercitado no comentário).

## O achado que impede a aprovação

Não há achado bloqueante nesta rodada. Os dois bloqueantes da rodada anterior estão resolvidos e conferidos:

- **Comentário que espera.** O envio das imagens citadas é planejado junto do comentário e entra no mesmo grupo de comandos da proposta; nada é enviado até o "sim". O agente autônomo segue publicando sozinho, pelas duas chamadas auditadas. Conferido por teste (o caso do agente que espera e o caso do agente autônomo) e por leitura.
- **Descrição do pedido de mudança.** O envio é adiado para o grupo da proposta do pedido de mudança, que sempre espera; o rascunho guarda apenas os ids. Conferido por leitura.
- **Menor.** O comentário duplicado em `paths.ts` saiu. Conferido por leitura.

## Sugestão (não bloqueante)

- **Restabelecimento após uma falha no meio do grupo.** Se, num grupo de um "sim" que sobe a imagem e escreve o comentário, o envio tiver sucesso e a escrita do comentário falhar, a proposta fica marcada como falha e pode ser aprovada de novo; nesse reenvio o endereço que o envio respondeu na primeira tentativa não é recuperado (nada guarda a resposta de um comando já rodado), então o comentário sai **sem** a imagem embutida e sem dizer quantas peças existem — as peças ficam no host, mas o texto não as mostra nem as conta. É um caso estreito (exige a falha do host na escrita do comentário e uma nova confirmação), e o fluxo sem falha está correto; por isso não impede a aprovação.

## O que não foi revisado

- O diff completo do codec de PNG e o desenho de cada marca: julgados pelo teste que os cobre, não linha a linha.
- O comportamento num sandbox de verdade, num host de verdade e numa janela: fora do alcance desta etapa.
- A descrição do pedido de mudança com comprovação citada de ponta a ponta: não exercitada por teste (dito na seção acima).
