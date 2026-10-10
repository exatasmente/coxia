# O que a implementação mudou, e por que a suíte parecia vermelha

Registro da codificação da mudança, seguido do que a segunda passagem por esta etapa encontrou: os dois bloqueantes que a revisão apontou não vêm da mudança. Abaixo está o passo a passo, o resultado de cada comando e, em separado, o que ficou por verificar.

## O que foi codificado

**Passo 1 — segredos atrás da porta** (`src/main/secrets.ts`)
- Saiu o import do cofre do sistema e o objeto `keychain`, que foi para o adaptador do desktop.
- Entrou o registro: `setCryptoPort(port | null)` (nulo volta ao padrão) e um encaminhador fixo (`available`, `encrypt`, `decrypt`, `backend`, `unavailableReason`) que delega à porta atual e é o que `secrets()` entrega como criptografia. A porta pode chegar depois da primeira chamada da loja.
- Padrão sem porta: `available()` falso, `backend()` nulo e `encrypt`/`decrypt` lançam o erro de indisponível com a mensagem atual de sem cofre.
- `testEnvLedger()` e `seedLegacySecrets()` ficaram como estavam.

**Passo 2 — chave-mestre** (`src/main/masterKey.ts`, novo)
- `masterKeyPort(keyFile)`: valida o arquivo a cada operação, sem guardar a chave entre elas — recusa arquivo ausente, que não seja arquivo comum, que seja link, com bits de grupo ou outros acessíveis (aceita mais fechado que 0600), com conteúdo que não seja 64 dígitos hexadecimais mais quebra de linha, ou dentro da raiz de dados.
- Cifra em AES-256-GCM; o criptograma é `iv(12) || tag(16) || texto`, em base64 dentro do campo `cipher` que já existe.
- `available()` é falso quando o arquivo não passa na validação; `encrypt` e `decrypt` revalidam antes de agir e lançam o erro de indisponível com a chave nova de texto; `backend()` devolve nulo. Nenhuma mensagem recebe a chave nem o conteúdo do arquivo, nem quando a chave não abre os dados (a checagem GCM falha e a leitura é recusada).
- Nesta passagem saiu a constante `KEY_BYTES`, que não era lida em lugar nenhum: o tamanho da chave vem dos 64 dígitos hexadecimais e do próprio `aes-256-gcm`, e o comentário deixado no lugar diz isso.

**Passo 3 — adaptador do desktop** (`src/main/electronPorts.ts`, novo; `src/main/index.ts`)
- `keychain` com o corpo exato de antes (mesma recusa quando o cofre do sistema não existe, mesma recusa do backend inseguro, mesmo `backend()`).
- `installElectronPorts()` preenche a porta de criptografia e a porta de caminhos com funções lidas na chamada: empacotado, pasta de recursos, pasta de dados do usuário.
- No módulo principal, chamado como o primeiro comando do corpo, antes de `installProcessHandlers()`, com comentário dizendo por quê (os módulos carregam antes do corpo).

**Passo 4 — recusa com motivo** (`src/main/secrets-core.ts` e catálogos)
- `CryptoPort` ganhou `unavailableReason?(): string`.
- Os dois lançamentos que falam do cofre passaram a usar o motivo da porta quando a porta tem um, e a mensagem atual quando não tem: a leitura de valor cifrado e a recusa de gravar sem cofre. Assim o desktop mantém as mensagens de sempre (a asserção atual sobre a frase do cofre continua valendo) e o host sem interface fala do seu arquivo de chave.
- Chave nova `main.secrets.keyFile` nos dois catálogos. ***Desvio do plano:*** o plano descreve o texto como "o arquivo da chave está ausente ou legível por outros usuários"; o texto implementado cobre também a recusa quando a chave não abre os segredos, que é a mesma recusa fechada e precisa de uma frase só.

**Passo 5 — caminhos atrás da porta** (`src/main/paths.ts`)
- Saiu o import da janela do desktop; a raiz de dados veio de `./env`.
- Porta `PathsPort` com três funções (`isPackaged`, `resources`, `userData`), definida por `setPathsPort(port | null)`.
- Padrão sem host: não empacotado, e a pasta de dados do usuário dentro da raiz de dados — a mesma regra que o desktop aplica quando a pasta de dados é definida.
- As constantes viram funções: `PACKAGED` → `isPackaged()`, `RESOURCES` → `resourcesDir()`, `SIDECAR_DIR` → `sidecarDir()`, `CLAUDE_BIN` → `claudeBin()`, `PLAYWRIGHT_MCP_CLI` → `playwrightMcpCli()`; acrescentou-se `userDataDir()` e as pastas de voz passaram a ler a pasta de dados do usuário da porta. A base virou função: empacotado usa a pasta de recursos da porta, o resto a raiz do repositório.

**Passo 6 — pontos de chamada**
- `src/main/autostart.ts`, `src/main/update.ts`, `src/main/updates.ts`, `src/main/screen/encoderWindow.ts`, `src/main/browser/launch.ts`: troca mecânica dos nomes antigos pelas funções.
- `src/main/voice.ts`: o `const SCRIPT` virou função chamada no início do processo filho; os usos da pasta do sidecar viram chamadas.
- `src/main/claudeSdk.ts`: `defaults.bundled` virou propriedade calculada no objeto (lê o binário embutido só na chamada, sem mudar a interface dos auxiliares) e o uso de `claudeBin()` na linha que devolvia o executável virou chamada.

## Testes

Novos, um por comportamento da especificação:

| Comportamento | Arquivo | O que prova |
|---|---|---|
| Os dois módulos e tudo o que importam sem o runtime | `test/secrets-paths-no-electron.test.ts` | Um percorredor de imports segue os imports relativos, de tipo e dinâmicos a partir dos dois módulos e aponta o arquivo que trouxe o runtime; a própria busca mostra que o fecho foi percorrido de verdade |
| Arquivo de hoje lido sem migração e registro de portas | `test/secrets-existing-file.test.ts` | Uma cópia no formato atual resolve o valor, as leituras não reescrevem o arquivo e uma gravação mantém formato e permissão; porta preenchida depois do primeiro uso é honrada e porta nulificada fecha tudo |
| Ida e volta com a chave-mestre e recusa com chave diferente | `test/master-key.test.ts` | Mesma chave grava e lê o mesmo valor; chave diferente é recusada e a mensagem não traz os hexadecimais de nenhuma das duas |
| Falha fechada sem vazar a chave | `test/master-key.test.ts` | Ausente, permissão ampla, link, conteúdo inválido e caminho dentro da raiz de dados: recusados, com o estado indisponível e sem chave em mensagem; permissão mais fechada que 0600 é aceita |
| Caminhos sem interface | `test/paths-host.test.ts` | Sem porta: usuário dentro da raiz de dados, pastas de voz dentro dela, não empacotado, recursos na raiz do repositório; com porta falsa: é a porta que responde, e voltar ao padrão funciona |
| Caminhos e cofre do desktop com o runtime simulado | `test/desktop-ports.test.ts` | O adaptador faz os caminhos virem do desktop, a porta de cofre grava e lê pelo cofre simulado, o backend inseguro continua contando como sem cofre e a recusa sem cofre com a aceitação pendente mantém as palavras de hoje |

Ajustados: `test/voice-gating.test.ts` (a simulação do módulo de caminhos exporta as funções novas), `test/browser-quit.test.ts` (o caminho do servidor virou chamada; nesta passagem saiu uma linha solta `;` que ficara no fim do arquivo) e `test/build-profiles.test.ts` (a asserção de texto procura a pasta descompactada no arquivo de caminhos, com o comentário acima atualizado).

## Os dois bloqueantes da revisão não vêm da mudança

A revisão reprovou a entrega por dois conjuntos de testes vermelhos, os dois fora do assunto da issue. Esta passagem isolou a causa: **é o nome da pasta da worktree**.

- O nome da pasta da worktree é o slug da issue, e esse slug começa com a palavra `secrets`. A regra de nome do guarda de segredos (`NAME_RULE`, em `src/main/agents.ts`) casa com um caminho que contenha `secret`, `credential` ou `token` em qualquer ponto e não termine numa extensão de código. O caminho absoluto da pasta da worktree inteiro casa: um segmento dele carrega `secrets-and` a partir do oitavo caractere.
- Consequência: dentro desta pasta, o filtro de resultados de busca descarta linhas cujo caminho relativo resolve para dentro dela. É por isso que `test/secret-results.test.ts` perde a linha `src/a-1-b.php:2:ok` e os três testes de `test/conflict-resolve.test.ts` perdem o hunk de `old.txt`.
- **A prova de que não é a branch**: as mesmas funções de regra do commit de partida, reescritas linha por linha a partir de `98f1bb95` e sem nenhuma mudança desta branch, reproduzem o mesmo descarte quando o diretório de trabalho é esta worktree e preservam a linha quando o diretório é uma pasta neutra.
- **A prova mais direta**: os dois arquivos de teste, sem uma linha alterada, rodam verdes a partir de uma pasta neutra com o mesmo `node_modules` e o mesmo código — 2 arquivos, 128 de 128 testes.
- A suíte inteira, mesma árvore e mesma branch, comparada nos dois diretórios: da worktree, 412 arquivos verdes e 8 vermelhos, com os dois arquivos apontados pela revisão entre eles; de uma pasta neutra, 413 verdes e 7 vermelhos, **sem** os dois arquivos na lista e sem nenhuma falha nova (aparece uma instabilidade de serialização em `test/mcp-state-build.test.ts`). As falhas que sobram são as que esta máquina já explicava: o servidor de navegador embutido, as pastas de navegador e a tela virtual.
- Os três testes do fluxo de conflito falham pelo mesmo caminho: a linha que marca um arquivo delicado (`src/main/actions.ts:853`) consulta essa regra de nome, e `old.txt` deixa de ser enviado ao modelo por causa do caminho da pasta da worktree, não por causa das portas.

Nada disso entra nesta mudança: o comportamento do guarda é o de antes, e quem o exercita numa pasta com `secret` no nome vê o mesmo. A revisão foi feita dentro dessa pasta e tomou o efeito por uma regressão da branch.

### Achado fora do escopo, que fica em aberto

O guarda de segredos julga o **caminho absoluto** do arquivo, e nos testes o caminho absoluto inclui a pasta onde a suíte roda. Um caminho de entrada também é resolvido contra o diretório de trabalho: um comando de git com um caminho relativo, e a leitura de valor cifrado, decidem por `resolve(cwd, p)`. Só que `secretPath` também recebe caminhos que **já vêm absolutos de outro lugar**: os nomes que o buscador devolve, e o caminho de um arquivo em conflito. Aí não há diretório de trabalho envolvido, e o valor da pasta onde o app foi aberto não deveria pesar na decisão.

Como consequência, abrir o app a partir de uma pasta cujo nome tenha `secret` nela faz todo caminho relativo a essa pasta contar como segredo — é exatamente o que aconteceu nesta suíte. Vale olhar em trabalho próprio; não é deste assunto e não muda a entrega.

## O que foi verificado

Cada comando abaixo rodou; o que imprimiu está nas comprovações desta etapa.

- `npx tsc --noEmit` — limpo (saída vazia, código de saída 0), antes e depois das duas edições desta passagem.
- `npx vitest run test/master-key.test.ts test/desktop-ports.test.ts test/secrets-existing-file.test.ts test/paths-host.test.ts test/secrets-paths-no-electron.test.ts` — 5 arquivos, 20 testes, todos verdes.
- `npx vitest run test/secret-results.test.ts test/conflict-resolve.test.ts`, da pasta da worktree — 4 falhas (as que a revisão apontou).
- Os mesmos dois arquivos, sem alteração, a partir de uma pasta neutra — 2 arquivos, 128 testes, todos verdes.
- `npx vitest run` (suíte inteira), da pasta da worktree — 420 arquivos, 412 verdes, 8 com falha; 6936 testes, 6911 verdes.
- `npx vitest run` (suíte inteira), da pasta neutra — 420 arquivos, 413 verdes, 7 com falha; 6934 testes, 6913 verdes; nenhuma falha nova.
- A regra do commit de partida reconstruída e exercitada nos dois diretórios — descarta a linha na worktree, preserva na pasta neutra.
- `node scripts/theme-audit.mjs` — verde (código de saída 0).
- `npm run i18n:lint` — verde (5483 chaves nos dois idiomas, 12 catálogos, 0 problemas).
- `node scripts/public-audit.mjs` — verde (1611 arquivos, nada que pertença a uma empresa ou a uma pessoa).

## O que não foi verificado

- O passo 9 do plano (abertura manual sobre uma instalação que já tem segredos, em máquina com o cofre do sistema disponível): não foi executado.
- A contagem transitiva de 131 para 16 arquivos que alcançam o desktop: não foi recalculada em nenhuma etapa.
- O cofre real do sistema operacional: os testes simulam a porta; o que passa pelo cofre de verdade é a abertura manual acima.
- Se as sete falhas que sobram na pasta neutra são anteriores a esta mudança: são quatro arquivos de navegador, de sandbox e de tela virtual desta máquina, que falham igual no ponto de partida da branch, mais uma instabilidade de serialização; não todas foram comparadas com o ponto de partida.
- A ordem dos campos do criptograma (`iv`, `tag`, corpo) não tem teste próprio do par cifrar/decifrar; o que a cobre é a ida e volta pela loja, nos testes da chave-mestre.
- A recusa por caminho dentro da raiz de dados tem teste do lado em que recusa; o lado em que um arquivo que só compartilha o prefixo textual da raiz é aceito não tem teste (conferido por leitura: a comparação usa a raiz mais o separador).

## Nota de lançamento

Nada foi escrito no registro de versões nesta mudança: nada visível muda na janela do desktop, como o plano já decidia. A limpeza do `KEY_BYTES` e a linha solta que saiu de um arquivo de teste também não mudam comportamento nenhum. Se a verificação seguinte encontrar algo visível, ali sim entra como mudança não lançada.
