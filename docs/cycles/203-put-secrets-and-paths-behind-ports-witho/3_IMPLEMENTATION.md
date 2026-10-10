# Segredos e pastas passam a vir das portas que quem hospeda preenche

Registro do que foi codificado nesta etapa, seguindo o plano técnico passo a passo. Nada visível muda na janela do desktop: por isso o registro de versões não ganhou entrada.

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

**Passo 3 — adaptador do desktop** (`src/main/electronPorts.ts`, novo; `src/main/index.ts`)
- `keychain` com o corpo exato de antes (mesma recusa quando o cofre do sistema não existe, mesma recusa do backend inseguro, mesmo `backend()`).
- `installElectronPorts()` preenche a porta de criptografia e a porta de caminhos com funções lidas na chamada: empacotado, pasta de recursos, pasta de dados do usuário.
- No módulo principal, chamado como o primeiro comando do corpo, antes de `installProcessHandlers()`, com comentário dizendo por quê (os módulos carregam antes do corpo).

**Passo 4 — recusa com motivo** (`src/main/secrets-core.ts` e catálogos)
- `CryptoPort` ganhou `unavailableReason?(): string`.
- Os dois lançamentos que falam do cofre passaram a usar o motivo da porta quando a porta tem um, e a mensagem atual quando não tem: a leitura de valor cifrado e a recusa de gravar sem cofre. Assim o desktop mantém as mensagens de sempre (a asserção atual sobre a frase do cofre continua valendo) e o host sem interface fala do seu arquivo de chave.
- Chave nova `main.secrets.keyFile` nos dois catálogos. ***Desvio do plano:*** o plano descreve o texto como "o arquivo da chave está ausente ou legível por outros usuários"; o texto implementado cobre também a recusa quando a chave não abre os segredos, que é a mesma recusa fechada e precisa de uma frase só. Fica dito aqui para quem revisar.

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

Ajustados: `test/voice-gating.test.ts` (a simulação do módulo de caminhos exporta as funções novas), `test/browser-quit.test.ts` (o caminho do servidor virou chamada) e `test/build-profiles.test.ts` (a asserção de texto procura a pasta descompactada no arquivo de caminhos, com o comentário acima atualizado).

## O que foi verificado

Cada comando abaixo rodou nesta etapa; o que imprimiu está na comprovação da etapa.

- `npx tsc --noEmit` — limpo (saída vazia, código de saída 0).
- `npx vitest run` nos oito arquivos novos e tocados — 53 testes verdes.
- Repetição dos cinco arquivos novos mais o teste de conteúdo público do repositório — 38 testes verdes.
- `npx vitest run` (suíte inteira) — 420 arquivos, 411 verdes, 9 com falha; 6936 testes, 6910 verdes, 11 falharam, 15 pulados. As falhas, uma a uma: quatro arquivos precisam de navegador real, de sandbox e do pacote do servidor de navegador embutido, que não está instalado nas dependências ligadas a esta worktree (loja compartilhada, só com o núcleo do navegador) — o caminho calculado do servidor não mudou; quatro arquivos caem fora dos módulos alterados e não puderam ser comparados com o estado de antes, sem histórico local — origem **não verificada**; a nona era a auditoria de conteúdo do repositório sobre uma palavra que a memória do ciclo citava como exceção, e fecha depois de reescrever a memória.
- `node scripts/theme-audit.mjs` — verde (código de saída 0).
- `npm run i18n:lint` — verde (5483 chaves nos dois idiomas, 12 catálogos, 0 problemas).
- `node scripts/public-audit.mjs` — verde (1609 arquivos, nada que pertença a uma empresa ou a uma pessoa); antes de reescrever a memória do ciclo, a única ocorrência era a palavra citada nela.
- `npx electron-vite build` — compilação sem erro (a mesma que a integração contínua roda).

## O que não foi verificado

- O passo 9 do plano (abertura manual sobre uma instalação que já tem segredos, em máquina com o cofre do sistema disponível): não foi executado.
- A contagem transitiva de 131 para 16 arquivos que alcançam o desktop: não foi recalculada em nenhuma etapa.
- Se as oito falhas restantes da suíte são anteriores a esta mudança: sem histórico local para comparar.
- O cofre real do sistema operacional: os testes simulam a porta; o que passa pelo cofre de verdade é a abertura manual acima.

## Nota de lançamento

Nada foi escrito no registro de versões nesta mudança: nada visível muda na janela do desktop, como o plano já decidia. Se a verificação seguinte encontrar algo visível, ali sim entra como mudança não lançada.
