# Plano de testes da memória do ciclo

## Como o comportamento foi exercitado

Duas coisas foram feitas: ler o código novo contra o que a especificação pede, e rodar. Rodaram, na cópia de trabalho do ciclo, a suíte do projeto inteira, as portas de tipos, tema, catálogo de idiomas e auditoria pública, e três testes de sonda escritos para conferir por execução o mascaramento do texto da conversa e o casamento dos marcadores. Nada foi verificado com um modelo de verdade, no aplicativo aberto, nem reiniciando o aplicativo no meio de uma execução.

Observação de ambiente: a pasta de módulos desta cópia é somente leitura e o executor de testes grava um arquivo temporário dentro dela, o que faz a suíte falhar antes de começar quando chamada como está. A suíte rodou com um arquivo de configuração equivalente, fora da cópia de trabalho, apontando para a mesma raiz, os mesmos arquivos de preparação e o mesmo substituto do módulo do Electron que o projeto usa. As demais portas rodaram como estão no repositório.

## O que foi exercitado, e o que se viu

### A memória nasce com a execução e a etapa que conclui a reescreve e a commita

O conjunto de ponta a ponta do fluxo monta a execução inteira com o motor falso. A memória aparece na pasta do ciclo já na primeira etapa; o commit daquela etapa leva o arquivo, listado como um documento da etapa; o registro da etapa aparece junto dos demais documentos. Uma execução cuja pasta não tinha o arquivo ganha o esqueleto de novo na etapa seguinte, sem perder o que já estava registrado, o ramo passa a rastrear o arquivo como os outros documentos e a pasta de trabalho fica limpa ao fim. Tudo passou.

### A memória chega primeiro, por inteiro, e o teto é avisado

O teste coloca no arquivo uma marca própria e o enche além do teto de 10.000 caracteres, e confere no texto que a etapa recebe: a marca está lá, ela aparece antes do registro da issue, e a linha de aviso do teto aparece com o valor do teto. A unidade correspondente confirma a ordem dos arquivos na leitura da pasta (a memória, depois o registro da issue, depois os demais em ordem de nome) e que um arquivo muito acima do teto é lido inteiro e sem marca de corte. Passou.

### A devolução da revisão entra na memória

No teste de ponta a ponta de devolução, a revisão reprova com um achado e o desenvolvedor roda de novo; o texto do achado aparece na memória da execução, no fim. Passou.

### A resposta da pessoa e a passagem para a próxima etapa sobrevivem à janela das 40 mensagens

O mesmo teste acrescenta uma resposta da pessoa e uma passagem, seguidas de 45 mensagens de enchimento, e confere que a mensagem original já está fora da janela que a etapa recebe (a distância até o fim passa de 40), que o texto de enchimento não aparece no prompt, e que a resposta e a passagem aparecem no prompt e na memória. Passou.

### A correção da pessoa é a versão lida depois, registrada como dela

O teste edita a memória pela porta da tela, confere que o texto devolvido é o que foi gravado, que nenhuma etapa rodou naquele momento, que o histórico registra a edição com autoria da pessoa e que o commit do app leva a mensagem própria da memória; depois segue a execução e confere que o prompt da etapa seguinte traz o texto editado e que ele continua na memória. Passou.

### O orçamento da pasta favorece a etapa, e a memória nunca é cortada

A unidade da leitura da pasta monta cinco documentos de 50.000 caracteres. Sem declaração, o mais antigo é o primeiro a ser cortado (fica de fora), e o seguinte sai cortado em 30.000 com a marca de corte; declarando dois documentos do meio como entradas da etapa, todos os cinco aparecem, e os dois declarados ficam inteiros. A memória acima do teto continua inteira e sem marca. Passou.

### O texto que vem da conversa entra mascarado

Uma sonda escrita para isto monta uma resposta da pessoa com uma chave no formato de token e uma passagem com um cabeçalho de autorização, e confere o texto dos fatos que a aplicação acrescenta à memória: a chave vira `[key]` e o cabeçalho vira `[redacted]`, sem o valor original. Passou. A auditoria pública do repositório também passa, com 859 arquivos conferidos.

### As portas do repositório

Tipos sem emissão, auditoria de tema, catálogo de idiomas (4.012 chaves nos dois idiomas, nenhuma faltando) e auditoria pública saem com sucesso. A suíte inteira sai com 12 falhas em dois arquivos que não têm relação com esta mudança:

- a verificação da voz falha em dois testes por falta de espaço em disco no ambiente, e falha do mesmo jeito na versão do código sem esta mudança;
- os testes do script de lançamento estouram o limite de 5 segundos por teste quando a suíte roda em paralelo e passam quando rodam sozinhos (59 de 59), também sem relação com a memória.

A montagem do aplicativo para distribuição não foi rodada.

## O defeito confirmado por execução

O marcador de um fato da conversa é procurado como trecho de texto no arquivo, e `answer:3` casa dentro de `answer:30`. Uma sonda escrita para isto aplica à memória um fato da mensagem 3 quando o marcador da mensagem 30 já está no arquivo: o fato da mensagem 3 é considerado presente e não volta, e a linha da resposta some. O caso exige que o modelo, ao reescrever o arquivo, tenha deixado cair a linha inteira de uma mensagem menor enquanto manteve o marcador de uma maior — provável num ciclo longo, já que a etapa é instruída a encurtar a memória. O efeito é a perda silenciosa de uma resposta da pessoa até a execução terminar, que é justamente o que a memória existe para evitar. Não é o caminho normal (o teste de ponta a ponta, com a resposta sobrevivendo à janela das 40 mensagens, passa), e por isso não devolve o trabalho; fica para uma passada própria, com a correção sugerida de casar o marcador inteiro (`<!-- answer:3 -->`) em vez do trecho.

## O que não foi verificado

- Um ciclo com um modelo de verdade e um laço de devolução: nenhum modelo real foi usado.
- A equivalência entre o motor aberto e o Claude Agent SDK: leu-se que o campo novo viaja no mesmo esquema de resposta, e não se exercitou nenhum dos dois motores de verdade.
- A retomada de uma execução depois de reiniciar o aplicativo: só se leu que a memória é um arquivo em disco, lido como qualquer documento; não se reiniciou nada.
- A tela da execução: o modo de edição da memória foi lido no código, não aberto nem usado.
- A recusa da edição enquanto uma etapa trabalha e a exigência de pasta de trabalho e de identidade: só leitura do caminho de serviço.
- O caso de uma etapa devolver a memória vazia: só leitura — o executor só grava quando o campo vem preenchido, e a leitura tolerante do campo trata vazio como nada; nenhum teste exercita o arquivo permanecendo como estava.
- A montagem do aplicativo para distribuição.
- A auditoria pública sobre a memória escrita numa execução real: ela foi conferida sobre os arquivos do repositório, não sobre o arquivo de uma execução.

## Detalhe de execução

A lista de comandos desta etapa tem os números:

- `#13` — a unidade da memória sozinha: 9 testes, todos passam.
- `#16` — a suíte inteira: 213 arquivos, 3.542 testes, 12 falhas em `test/voice-setup.test.ts` e `test/release-script.test.ts`.
- `#18` — confirmação, na saída da suíte, de que os arquivos ligados à mudança passam: `runner-memory` (9), `runner-e2e` (5), `runner-units` (25), `runner-golden` (6), `runner-squads` (14), `runs-results` (18), `runs-policy` (10), `ui-i18n` (15).
- `#23` — auditoria de tema e lint de idiomas: saída 0; `#24` — auditoria pública: saída 0; `#25` — `tsc --noEmit`: saída 0.
- `#29` — a sonda do marcador por prefixo: falha, como descrito acima.
- `#37` — os dois arquivos que falharam, rodados sobre a versão do código sem esta mudança: `voice-setup` falha os mesmos 2 testes, `release-script` passa os 59.
- `#38` — `release-script` sozinho na versão com a mudança: 59 testes, todos passam.
- `#43` — a sonda do mascaramento: passa.
