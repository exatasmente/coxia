# Triagem

## Tipo

Pedido de funcionalidade (o rótulo da issue é `enhancement`). Não é bug, nem pergunta, nem duplicada: pede que duas partes do código parem de importar o runtime do desktop e passem a receber o que só esse runtime dá, por portas que o host preenche — o desktop mantém o cofre do sistema operacional e os caminhos de hoje, um host sem interface gráfica entrega uma chave em arquivo e pastas simples.

## Dá para entender

Sim — conferido por leitura. Nada foi executado nesta etapa (nenhum teste, nenhum build).

- As linhas citadas apontam para o código que descrevem: o módulo de segredos importa o cofre do sistema na linha 5 e `secrets()` (linhas 37-40) fixa a porta de criptografia sem jeito de injetar outra; o módulo de caminhos importa `app` na linha 2 e usa `app.getPath('userData')` nas linhas 24-26. O bloco `keychain` hoje vai da linha 13 à 32 — a issue cita 13-28, deriva de linha, como ela própria avisa ao dizer para re-conferir antes de planejar.
- Contagens conferidas por busca no código, batendo com a issue: 13 arquivos de `src/main` importam `electron` diretamente (nenhum `require` escondido); 7 arquivos importam `secrets.ts`; 8 importam `paths.ts`; 292 arquivos `.ts` sob `src/main`.
- O ponto de injeção já existe: `createSecretsStore` recebe `crypto` (`SecretsDeps`) e cinco arquivos de teste já criam a loja com uma porta de criptografia falsa (lidos, não executados).
- Não verificado: a contagem transitiva "131 → 16" não foi recalculada; nada foi executado nesta etapa.
- Busca por "headless" no código só encontra usos ligados ao navegador: hoje não existe um host sem interface que consuma essas portas — elas são o primeiro passo de uma cadeia cujo consumidor vem das outras issues.

## O que falta

Nada essencial de quem abriu: o comportamento pedido, o formato atual do arquivo de segredos, a permissão 0600, o comportamento quando a chave está ausente ou legível por qualquer usuário e os critérios de aceite estão escritos.

Ficam em aberto como decisão de projeto (para as etapas seguintes, não para quem abriu): o formato e o tamanho da chave-mestre, o nome do arquivo da chave e quem o cria quando ele não existe.

## Duplicadas e relacionadas

Busca na lista de issues do repositório pelos termos "headless" e "secrets", na data desta triagem.

- Duplicadas: nenhuma. Nenhuma outra issue propõe mover segredos e caminhos para portas.
- #208 — a ordem do trabalho sem Electron; esta é o primeiro passo ali (a redução de 131 para 16 arquivos) e pode correr em paralelo com a #205.
- #204 — continua de onde esta para:

  > After secrets and paths (#203), 16 files under `src/main` still reach `electron`.

  Sequência, não duplicata.
- #205 — mesma ordem, paralela: a pasta de dados definida na largada.
- #206 — depois na mesma cadeia: precisa de #204 e #205.

## Sugestão de prioridade

`priority:high`, como sugestão: é a entrada da ordem do #208, #204 e #206 ficam esperando por ela, e o escopo é pequeno com o aceite já escrito. `priority:medium` se o trabalho do 1.0 não estiver no topo agora. A decisão é do refinamento do produto; os campos `priority` e `milestone` ficam por preencher aqui.
