# Plano de teste: segredos e pastas entregues por portas

Cada critério de aceite da especificação vira um cenário numerado abaixo. "Executado" quer dizer que um comando rodou na etapa de QA e o resultado está numa comprovação guardada; a leitura do código sozinha aparece dita no cenário. No fim de cada cenário estão os ids das comprovações (ev-N).

A suíte desta máquina roda num diretório neutro, com ligações para `src`, `test`, `node_modules` e os arquivos de configuração: a pasta da worktree carrega o identificador da issue no nome, e a regra de nome do guarda de segredos lê o caminho absoluto, o que faz dois arquivos de teste alheios a esta mudança ficarem vermelhos dentro dela. A pasta neutra fica na pasta de saída da etapa, nunca na worktree.

## Cenários

### 1. Os dois módulos sem o runtime do desktop (aceite 1)

Fazer: conferir o módulo de segredos, o módulo de caminhos e tudo o que eles importam.
Ver: nenhuma ocorrência do runtime do desktop em nenhum deles.

Executado. Os dois arquivos foram lidos e não importam o runtime: o módulo de segredos importa só `node:child_process`, `node:fs`, `node:os`, `node:path`, a configuração herdada, os textos, a raiz de dados, o núcleo da loja e o registro do ambiente de teste; o de caminhos importa só `node:path` e a raiz de dados. O teste que percorre os imports relativos, de tipo e dinâmicos a partir dos dois arquivos e falha se algum deles alcançar o runtime passou, e ele exige que o fecho percorrido inclua os módulos do núcleo e da raiz de dados, para não passar vazio. O veredito não depende da pasta onde a suíte roda.

Comprovações: ev-41.

### 2. O desktop atual lê seus segredos sem migração (aceite 2)

Fazer: abrir o app sobre uma instalação que já tem segredos gravados.
Ver: a lista aparece como antes, gravar e usar um segredo funcionam e o arquivo mantém o formato e a permissão de hoje.

Metade executada, metade sem verificação. O arquivo de uma instalação existente é aberto por um teste, com uma cópia no formato atual (versão, aviso, aceite, entradas) e sem migração: o valor volta, as leituras não reescrevem o arquivo (byte a byte igual), uma gravação mantém o formato e o modo 0600, e as entradas antigas continuam resolvendo. O desktop preenchendo as portas é exercitado com o runtime simulado: os caminhos vêm do runtime e um segredo gravado fica cifrado no disco, com modo 0600. A abertura manual sobre uma instalação real, com o cofre do sistema operacional, não foi feita; a lista de segredos numa instalação de verdade segue sem verificação.

Comprovações: ev-43.

### 3. Ida e volta com a chave-mestre (aceite 3)

Fazer: gravar um segredo numa loja criada com a porta da chave-mestre e ler de volta com a mesma chave; depois abrir a mesma loja com uma chave diferente.
Ver: o mesmo valor volta; com outra chave, a leitura é recusada.

Executado. Um teste do repositório e uma sonda de caixa preta escrita nesta etapa, apontando para o mesmo código, mostram as duas metades: a loja grava e lê o mesmo valor com a mesma chave e recusa a leitura quando o arquivo traz outra chave. O arquivo de segredos fica com o campo cifrado, sem o valor em claro, e modo 0600. A recusa é uma mensagem fixa dos catálogos que não contém os dígitos de nenhuma das duas chaves nem o valor.

Comprovações: ev-43, ev-38.

### 4. Falha fechada sem vazar a chave (aceite 4)

Fazer: remover o arquivo da chave e tentar ler um segredo; depois devolver ao arquivo uma permissão maior que 0600 e tentar de novo.
Ver: nos dois casos a operação é recusada e a mensagem mostrada não contém a chave.

Executado. Com o arquivo da chave ausente, a porta se declara indisponível, o armazenamento aparece como não seguro e a gravação de um valor é recusada; o mesmo acontece com o arquivo legível por outros, com um link, com conteúdo que não é a chave e com um caminho dentro da raiz de dados. Uma permissão mais fechada que 0600 (por exemplo 0400) é aceita, como o plano decidiu. Nenhuma mensagem traz a chave nem o conteúdo do arquivo, nem quando a chave não abre os segredos. Os testes do repositório e a sonda desta etapa cobrem os mesmos casos.

Comprovações: ev-43, ev-38.

### 5. Caminhos em cada host (aceite 5)

Fazer: rodar num host sem interface gráfica com a pasta de dados definida e conferir a pasta de dados do usuário; depois rodar no desktop.
Ver: sem interface gráfica ela fica dentro da pasta de dados raiz pela mesma regra do desktop; no desktop os caminhos continuam os de hoje.

Executado. Sem porta preenchida, a pasta do usuário fica dentro da pasta de dados raiz e as pastas de voz dentro dela, sem empacotamento e com os recursos na raiz do repositório; com uma porta de host preenchida, é a porta que responde por toda pasta, empacotada ou não, inclusive os caminhos do binário embutido e do servidor de navegador, e o retorno ao padrão funciona. Com o runtime do desktop simulado, o preenchimento das portas faz a pasta do usuário vir do runtime e mantém as pastas de voz dentro dela. A sonda desta etapa repete o lado sem host e o lado com host falso. O desktop de verdade não foi aberto.

Comprovações: ev-43, ev-38.

### 6. O desktop sem cofre utilizável continua recusando (regra 2)

Fazer: conferir o que o desktop faz quando o cofre do sistema não existe ou o sistema cai no modo inseguro.
Ver: continua recusando como sempre, com as palavras de hoje, até a pessoa aceitar o armazenamento inseguro.

Executado. Com o runtime simulado, o modo inseguro do sistema conta como sem cofre nenhum, a gravação de um valor é recusada enquanto a aceitação não existe e a mensagem é a de sempre; a leitura de um valor cifrado também é recusada com a frase do cofre. A mensagem nova do arquivo de chave só aparece quando a porta dá o seu motivo.

Comprovações: ev-43.

### 7. Portões do repositório (tipos, tema, idiomas, conteúdo público)

Fazer: rodar os portões leves numa árvore com as dependências instaladas.
Ver: todos verdes.

Executado. A verificação de tipos não aponta nada (sem saída, código 0); a auditoria de tema passa (55 pares de contraste ok nos dois temas, e as 14 cores literais são as mesmas de antes da mudança); o catálogo de idiomas tem 5483 chaves nos dois idiomas, 12 catálogos, 0 problemas; e a auditoria de conteúdo público passa em 1612 arquivos, sem nada que pertença a uma empresa ou a uma pessoa.

Comprovações: ev-36.

### 8. A suíte inteira, fora da pasta que dispara a regra de nome

Fazer: rodar a suíte completa a partir de um diretório cujo caminho não contenha as palavras que o guarda de segredos procura.
Ver: nenhuma falha ligada a segredos ou a caminhos.

Executado. Da pasta neutra: 420 arquivos, 411 verdes e 9 com falha; 6936 testes, 6911 verdes, 15 pulados e 10 vermelhos. Nenhuma das falhas toca segredos ou caminhos: são os arquivos de navegador, sandbox e tela desta máquina (um pacote do servidor de navegador que não está instalado, o servidor do navegador que não sobrevive nesta máquina, dois arquivos de sandbox de plugin e de busca, dois de tela e sandbox, um de reescrita de documento). Para separar a mudança da máquina, os mesmos dez testes foram rodados numa árvore construída a partir do commit imediatamente anterior à mudança, com as mesmas dependências: os mesmos dez falham lá, então nenhum vem da mudança.

Comprovações: ev-40, ev-42.

### 9. Os dois arquivos que a revisão apontou

Fazer: rodar os dois arquivos de teste que ficaram vermelhos dentro da pasta da worktree, primeiro nela e depois na pasta neutra.
Ver: o resultado não depende da mudança.

Executado. Dentro da pasta da worktree: 2 arquivos com falha, 4 testes vermelhos em 128. Na pasta neutra, os mesmos arquivos sem uma linha alterada: 2 arquivos verdes, 128 de 128 testes. É a pasta, não a mudança.

Comprovações: ev-37.

### 10. Sonda de caixa preta das portas

Fazer: escrever e rodar uma verificação independente dos dois comportamentos novos, fora da suíte do repositório e fora da worktree.
Ver: ida e volta com a mesma chave, recusa com chave diferente, falha fechada nos três casos de arquivo de chave reprovado, e a porta de caminhos com e sem host.

Executado. A sonda tem 3 testes, todos verdes, apontando para o código da worktree: ida e volta com a mesma chave; recusa com outra chave sem imprimir nenhuma das duas nem o valor; recusa fechada com o estado indisponível para arquivo ausente, legível por outros e dentro da raiz de dados, nenhuma delas imprimindo a chave; e a porta de caminhos obedecendo ao host e voltando ao padrão. Ela vive na pasta de saída desta etapa, nunca na worktree.

Comprovações: ev-38.

### 11. Quantos arquivos ainda alcançam o runtime do desktop

Fazer: contar, com um percurso dos imports, quantos arquivos sob `src/main` alcançam o runtime do desktop.
Ver: o número que a issue previu.

Executado com resultado diferente do previsto. O percurso dá 294 arquivos `.ts`, 12 que importam o runtime diretamente e 17 que o alcançam pelos imports. A árvore do commit imediatamente anterior à mudança, com o mesmo percurso, dá 292 arquivos, 13 diretos e 128 transitivos — os números da issue (13 diretos) conferem no ponto de partida, e a mudança leva o fecho a 17, não aos 16 que a issue previu. A spec marcou esta contagem como fora de escopo; não é um critério de aceite desta entrega e a diferença é de um arquivo, devida ao próprio adaptador do desktop (que importa o runtime de propósito).

Comprovações: ev-39.

### 12. O cofre real do sistema operacional no desktop

Fazer: abrir o programa numa máquina com o cofre do sistema disponível, sobre uma instalação que já tem segredos gravados.
Ver: a lista aparece como antes, gravar e usar um segredo funcionam e o arquivo não muda de conteúdo nem de permissão.

Não executado. Nada na etapa de QA abriu o programa; o que passa pelo cofre de verdade é exercitado só pela porta simulada nos testes. Sem comprovação.

## O que não foi verificado

- A abertura manual sobre uma instalação real com o cofre do sistema operacional (cenário 12).
- A contagem transitiva de arquivos que alcançam o runtime do desktop, que deu 17 e não o 16 previsto (cenário 11); a spec já a tinha posto fora de escopo, e os números do ponto de partida foram recontados.
- Se as nove falhas que sobram fora da pasta da worktree são todas anteriores à branch: as dez que aparecem no total foram reconferidas numa árvore do commit anterior, e falham lá também, mas a contagem por arquivo pode variar com a máquina.
- A ordem dos campos dentro do criptograma (vetor, etiqueta, corpo) não tem teste do par em si; o que a cobre é a ida e volta pela loja.

## Como rodar de novo

- Portões: `npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.
- Arquivos desta mudança: `npx vitest run test/master-key.test.ts test/desktop-ports.test.ts test/secrets-existing-file.test.ts test/paths-host.test.ts test/secrets-paths-no-electron.test.ts`.
- Suíte inteira, de uma pasta neutra com ligações para `src`, `test`, `node_modules` e os arquivos de configuração, e com a pasta temporária num sistema de arquivos que aceite soquete (a da worktree recusa): `TMPDIR=/dev/shm npx vitest run`.

## Resultado dos cenários

- 1. Os dois módulos sem o runtime do desktop (aceite 1): passou (executado na sandbox) — src/main/secrets.ts e src/main/paths.ts foram lidos e não importam o runtime do desktop (só node:child_process, node:fs, node:os, node:path, ../shared/config/legacy, ../shared/i18n, ./env, ./secrets-core, ./testEnv no de segredos; node:path e ./env no de caminhos). O teste que percorre os imports relativos, de tipo e dinâmicos dos dois arquivos e falha se algum alcançar o runtime passou (1 teste), e o próprio teste exige que o fecho inclua secrets-core.ts e env.ts.
- 2. O desktop atual lê seus segredos sem migração (aceite 2): passou (executado na sandbox) — Uma cópia no formato atual (versão, warning, insecure.accepted, entries) abre sem migração, resolve o valor, as leituras não reescrevem o arquivo (byte a byte igual), uma gravação mantém a versão, o aviso e o modo 0600 e as entradas antigas continuam resolvendo. Com o runtime do desktop simulado, os caminhos vêm do runtime e o segredo fica cifrado no disco (campo cipher, sem o valor em claro, modo 0600). A lista de segredos dentro do aplicativo real não foi vista.
- 3. Ida e volta com a chave-mestre e recusa com chave diferente (aceite 3): passou (executado na sandbox) — O teste do repositório (master-key.test.ts) e a sonda de caixa preta escrita nesta etapa mostram as duas metades: com a mesma chave o valor volta; com outra chave no arquivo a leitura é recusada, e a mensagem não contém os dígitos de nenhuma das duas chaves nem o valor.
- 4. Falha fechada sem vazar a chave (aceite 4): passou (executado na sandbox) — Arquivo da chave ausente, legível por outros, link, conteúdo que não é a chave e caminho dentro da raiz de dados: todos recusados, com o estado indisponível e sem a chave em nenhuma mensagem. Uma permissão mais fechada que 0600 (0400) é aceita. Confirmado pelos testes do repositório e pela sonda desta etapa.
- 5. Caminhos em cada host (aceite 5): passou (executado na sandbox) — Sem porta preenchida: a pasta do usuário fica dentro da pasta de dados raiz, as pastas de voz dentro dela, sem empacotamento e com os recursos na raiz do repositório. Com porta de host preenchida: é a porta que responde por toda pasta, empacotada ou não, inclusive o binário embutido e o servidor de navegador, e o retorno ao padrão funciona. Com o runtime do desktop simulado, a pasta do usuário vem do runtime. A sonda desta etapa repetiu os dois lados. O desktop de verdade não foi aberto.
- 6. O desktop sem cofre utilizável continua recusando com as palavras de hoje (regra 2): passou (executado na sandbox) — Com o runtime simulado: o modo inseguro do sistema (basic_text) conta como sem cofre, a gravação de um valor é recusada enquanto a aceitação não existe, e as mensagens são as de sempre; a leitura de um valor cifrado também é recusada com a frase do cofre. A mensagem nova do arquivo de chave só aparece quando a porta dá o seu motivo.
- 7. Portões do repositório: tipos, tema, idiomas e conteúdo público: passou (executado na sandbox) — npx tsc --noEmit sem saída, exit 0; node scripts/theme-audit.mjs verde (55 pares de contraste ok nos dois temas, 14 cores literais — a mesma lista de antes); npm run i18n:lint verde (5483 chaves nos dois idiomas, 12 catálogos, 0 problemas); node scripts/public-audit.mjs verde (1612 arquivos limpos).
- 8. A suíte inteira fora da pasta que dispara a regra de nome: passou (executado na sandbox) — Da pasta neutra com TMPDIR=/dev/shm: 420 arquivos, 411 verdes, 9 com falha; 6936 testes, 6911 verdes, 15 pulados, 10 vermelhos. Nenhuma falha toca segredos ou caminhos: são os arquivos de navegador, sandbox e tela desta máquina. Os mesmos dez testes foram rodados numa árvore do commit imediatamente anterior à mudança, com as mesmas dependências, e falham lá também — nenhum vem da mudança.
- 9. Os dois arquivos que a revisão apontou dependem da pasta, não da mudança: passou (executado na sandbox) — Os mesmos dois arquivos de teste, sem uma linha alterada: dentro da pasta da worktree, 2 arquivos com falha e 4 testes vermelhos em 128; na pasta neutra, 2 arquivos verdes e 128 de 128 testes. É o nome da pasta (que carrega o identificador da issue, começando por 'secrets'), não a mudança.
- 10. Sonda de caixa preta das portas, escrita nesta etapa: passou (executado na sandbox) — Verificação independente, na pasta de saída e fora da worktree, apontando para o código da worktree: 3 testes, todos verdes — ida e volta da chave-mestre com a mesma chave, recusa com chave diferente sem imprimir nenhuma das chaves nem o valor, recusa fechada (estado indisponível) para arquivo ausente, legível por outros e dentro da raiz de dados, e a porta de caminhos obedecendo ao host e voltando ao padrão.
- 11. Quantos arquivos ainda alcançam o runtime do desktop: falhou (executado na sandbox) — O percurso dos imports dá 294 arquivos .ts sob src/main, 12 que importam o runtime diretamente e 17 que o alcançam pelos imports — não os 16 que a issue previu. O mesmo percurso na árvore do commit imediatamente anterior à mudança dá 292 arquivos, 13 diretos e 128 transitivos, batendo com o ponto de partida da issue (a issue fala de 13 diretos); a mudança leva o fecho de 128 para 17. A diferença de um para o 16 previsto é o próprio adaptador do desktop, que importa o runtime de propósito. A spec marcou esta contagem como fora de escopo; não é critério de aceite desta entrega.
- 12. O cofre real do sistema operacional no desktop: não rodou (lido) — Não executado: nada na etapa de QA abriu o programa. O que passa pelo cofre de verdade (libsecret, Keychain, DPAPI) é exercitado só pela porta simulada nos testes; a abertura manual sobre uma instalação com segredos gravados depende da pessoa e não tem comprovação.
