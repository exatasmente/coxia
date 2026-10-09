# Segredos e pastas entregues por quem hospeda o app

## O que muda para quem usa

Hoje a guarda dos segredos e a decisão de onde as coisas ficam só funcionam dentro da janela do desktop: esses dois pontos pedem ao runtime do desktop o cofre do sistema operacional e os caminhos. Depois da mudança, os dois recebem esses valores de quem hospeda o app, por portas.

- Quem usa a janela do desktop não vê diferença: os segredos de hoje continuam no mesmo arquivo, com a mesma permissão, lidos sem migração, e os locais continuam onde estavam.
- Quem hospeda o app sem interface gráfica passa a poder rodar essa parte do programa: a criptografia usa uma chave guardada num arquivo que o host nomeia, fora da pasta de dados e legível apenas pelo dono, e os caminhos viram pastas simples dentro da pasta de dados.
- Falha fechada: se o arquivo da chave não existir ou puder ser lido por outros usuários, o programa recusa abrir os segredos guardados e mostra uma mensagem que nunca contém a chave.

## Regras

1. O módulo de segredos e o módulo de caminhos não dependem do runtime do desktop — nem diretamente, nem por aquilo que importam.
2. Quem hospeda preenche a porta de criptografia. No desktop ela continua sendo o cofre do sistema operacional de hoje, inclusive com a recusa quando o cofre do sistema não existe e a aceitação de armazenamento inseguro que já existe. Sem interface gráfica, é uma chave lida de um arquivo com permissão 0600, fora da pasta de dados.
3. Quem hospeda preenche a porta de caminhos. No desktop os valores são os de hoje (a pasta de dados do usuário e as pastas de recursos). Sem interface gráfica, a pasta de dados do usuário fica dentro da pasta de dados raiz, pela mesma regra que o desktop já aplica quando essa pasta é definida.
4. O arquivo de segredos mantém o formato de hoje e a permissão 0600; apenas as operações de hoje (gravar, remover, aceitar armazenamento inseguro) o reescrevem.
5. O valor de um segredo só é devolvido no momento em que o programa o entrega para uso; nada mais o expõe — como hoje.
6. Um segredo gravado com a porta da chave-mestre é lido de volta com a mesma chave; com uma chave diferente, a leitura é recusada.
7. Quando o arquivo da chave está ausente ou é legível por outros usuários, a leitura é recusada (falha fechada) e a mensagem nunca contém a chave.
8. No desktop que já existe, o arquivo de segredos de hoje é lido sem migração.

## O que fica fora

- O executor sem interface gráfica, em si: esta mudança só abre as portas que ele vai preencher; quem consome delas vem em outro trabalho.
- O restante do código que ainda fala com o runtime do desktop: parte dele continua alcançando o desktop depois desta mudança, de propósito.
- Nenhuma interface nova, nenhum aviso novo na tela, nenhuma mudança no lugar onde os segredos ficam e nenhuma mudança de formato ou permissão do arquivo deles.
- Nenhuma migração de segredos existentes.
- O formato e o tamanho da chave-mestre, o nome do arquivo da chave e quem o cria quando ele não existe.
- Recalcular o efeito sobre o restante do código (de 131 para 16 arquivos que alcançam o runtime do desktop): não foi calculado nesta etapa.

## Critérios de aceite

1. Os dois módulos sem o runtime do desktop. Fazer: conferir o módulo de segredos, o módulo de caminhos e tudo o que eles importam. Ver: nenhuma ocorrência do runtime do desktop em nenhum deles.
2. O desktop atual lê seus segredos sem migração. Fazer: abrir o app sobre uma instalação que já tem segredos gravados. Ver: a lista aparece como antes, gravar e usar um segredo funcionam e o arquivo mantém o formato e a permissão de hoje.
3. Ida e volta com a chave-mestre. Fazer: gravar um segredo numa loja criada com a porta da chave-mestre e ler de volta com a mesma chave. Ver: o mesmo valor volta. Depois, abrir a mesma loja com uma chave diferente. Ver: a leitura é recusada.
4. Falha fechada sem vazar a chave. Fazer: (a) remover o arquivo da chave e tentar ler um segredo; (b) devolver ao arquivo uma permissão maior que 0600 e tentar de novo. Ver: nos dois casos a operação é recusada e a mensagem mostrada não contém a chave.
5. Caminhos em cada host. Fazer: rodar num host sem interface gráfica com a pasta de dados definida e conferir a pasta de dados do usuário; depois rodar no desktop. Ver: sem interface gráfica ela fica dentro da pasta de dados raiz pela mesma regra do desktop; no desktop os caminhos continuam os de hoje.

Observação sobre verificação: a contagem transitiva "131 → 16" não foi recalculada nesta etapa.

## Perguntas em aberto

Nenhuma pergunta bloqueia esta especificação e nenhuma resposta de quem abriu a issue é necessária.

Ficam para decidir antes de codificar, como decisão técnica: o formato e o tamanho da chave-mestre; o nome do arquivo da chave e quem o cria quando ele não existe.
