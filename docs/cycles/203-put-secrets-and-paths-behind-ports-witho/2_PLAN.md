# Como o código recebe segredos e pastas por portas

Plano técnico da mudança descrita em 1_SPEC.md. Este documento foi escrito só com leitura do código existente: os números de linha abaixo foram conferidos na data deste documento e deslizam com o tempo, como a própria issue avisa. Nada foi executado para escrevê-lo (nenhum teste, nenhum build).

## Decisões (com o motivo de cada uma)

1. **As portas são preenchidas por um registro lido no momento do uso, e os valores de caminho viram funções.** Motivo: os módulos são importados antes do corpo do módulo principal executar, então qualquer constante calculada na carga capturaria o valor errado numa instalação empacotada (o valor por omissão é o de "fora do desktop": desenvolvimento). Ler a porta em cada chamada já é o padrão das pastas de voz, criado justamente porque o desktop pode mover a pasta de dados depois da carga. Descartado: exportar as constantes como ligações vivas — congelariam no instante do registro e ficariam velhas se a pasta de dados mudar depois.
2. **Um único arquivo novo importa o runtime do desktop.** Ele preenche as duas portas com o que o desktop usa hoje (o cofre do sistema operacional e a pasta de dados do usuário) e é chamado como o primeiro comando do corpo do módulo principal. Motivo: a aceitação exige que `secrets.ts` e `paths.ts` não alcancem o runtime nem pelos imports; com um adaptador único a fronteira fica visível e o resto do código não muda.
3. **Sem porta preenchida, a porta de criptografia fica em recusa fechada** (indisponível em vez de inseguro por omissão). Motivo: desviar para "armazenamento inseguro" seria o contrário do pedido; na janela do desktop o adaptador preenche antes do primeiro uso e num teste quem testa preenche.
4. **Chave-mestre: AES-256-GCM, 32 bytes gravados no arquivo como 64 dígitos hexadecimais mais quebra de linha.** Motivo: é a chave AES de 256 bits no formato mais simples de validar (lixo que não seja hexadecimal é recusado) e o modo GCM autentica, então uma chave diferente falha na abertura em vez de devolver conteúdo errado.
5. **O arquivo da chave é validado em toda operação e a chave não fica guardada entre chamadas.** Recusado: arquivo ausente, que não seja arquivo comum, que seja link, com bits de grupo ou outros acessíveis (aceita-se mais fechado que 0600, por exemplo 0400), com conteúdo que não seja a chave, ou dentro da pasta de dados. Motivo: o critério de aceite pede recusa depois que o arquivo some ou é aberto para outros — sem cache, a recusa acontece na própria operação; "fora da pasta de dados" é comportamento escrito na regra 2 da spec.
6. **O motivo da recusa do arquivo da chave vem de um campo opcional da porta, com uma chave nova de texto nos dois catálogos de idioma.** Motivo: as mensagens de hoje falam do cofre do sistema, que não existe em quem hospeda sem interface; com o campo opcional o desktop continua com as mensagens exatas de hoje (a asserção atual sobre a frase do cofre segue valendo).
7. **Nada muda na configuração, portanto não há migração** (nenhuma etapa de migração, nenhuma alteração de tipo, padrão ou esquema): o caminho do arquivo da chave é argumento da fábrica da porta — quem hospeda nomeia, como a issue pede.
8. **Sem entrada no registro de versões**: nada visível muda na janela do desktop. Se a codificação encontrar algo visível, ali sim entra como mudança não lançada.
9. **Os três pontos que a spec deixou em aberto ficam decididos aqui:** formato e tamanho (32 bytes em hexadecimais, AES-256-GCM, decisão 4); nome do arquivo (não existe nome fixo no programa — quem hospeda entrega o caminho à fábrica); quem cria o arquivo quando não existe (ninguém, nesta mudança: ausente é recusa fechada, que é o que o critério de aceite pede — criar é dever de quem hospeda, no trabalho que vem depois).

## As mudanças, em ordem

Cada passo fica com o TypeScript e os testes do que ele contém verdes antes do próximo.

**Passo 1 — segredos atrás da porta** (`src/main/secrets.ts`)
- Remover o import do `safeStorage` (linha 5) e o objeto `keychain` (13-32), que passa inteiro para o adaptador do desktop (passo 3).
- Acrescentar o registro: uma porta atual (valor nulo por omissão), `setCryptoPort(port | null)` (nulo volta ao padrão) e um encaminhador fixo — `available`, `encrypt`, `decrypt` e `backend` delegam à porta atual — que é o que `secrets()` entrega em `crypto` (37-48). Assim a porta pode ser preenchida depois da primeira chamada de `secrets()` sem recriar a loja.
- Padrão sem porta: `available()` falso, `backend()` nulo, `encrypt`/`decrypt` lançam o erro de indisponível com a mensagem atual de sem cofre.
- Não mudam: `testEnvLedger()` e `seedLegacySecrets()`.

**Passo 2 — chave-mestre** (`src/main/masterKey.ts`, novo)
- `masterKeyPort(keyFile: string)`: valida o arquivo (decisão 5) e cifra com AES-256-GCM; o criptograma é `iv(12) || tag(16) || texto`, em base64 dentro do campo `cipher` que já existe.
- `available()` devolve falso quando o arquivo não passa na validação; `encrypt` e `decrypt` revalidam antes de agir e lançam o erro de indisponível com a chave nova de texto; nenhuma mensagem recebe a chave nem o conteúdo do arquivo.
- `backend()` devolve nulo: não é cofre de plataforma e não há tela de quem hospeda para exibir o nome.
- A validação inclui a recusa de caminho dentro da raiz de dados, para a chave não viajar junto com os dados que a raiz carrega.

**Passo 3 — adaptador do desktop** (`src/main/electronPorts.ts`, novo)
- `installElectronPorts()`: preenche a porta de criptografia com o objeto `keychain` de hoje, corpo idêntico (mesma recusa quando o cofre do sistema não existe ou quando o sistema cai no backend inseguro, mesmo `backend()`), usando o `safeStorage` do runtime; e preenche a porta de caminhos com funções — empacotado, pasta de recursos e pasta de dados do usuário — lidas na chamada.
- `src/main/index.ts`: importar o adaptador e chamá-lo como o primeiro comando do corpo, antes de `installProcessHandlers()` (linha 39), com um comentário curto explicando por quê (os módulos carregam antes do corpo).

**Passo 4 — recusa com motivo** (`src/main/secrets-core.ts` e catálogos)
- `CryptoPort` ganha `unavailableReason?(): string`.
- Os dois lançamentos de indisponível passam a `deps.crypto.unavailableReason?.()` seguido da mensagem atual: a leitura de valor cifrado (linha 120) e a recusa de gravar sem cofre (linha 176).
- Texto novo nos dois catálogos, chave `main.secrets.keyFile`: o arquivo da chave está ausente ou legível por outros usuários.

**Passo 5 — caminhos atrás da porta** (`src/main/paths.ts`)
- Remover o import da `app` (linha 2) e importar a raiz de dados de `./env` (já é fecho do módulo de segredos; conferido sem `electron` e sem ciclo).
- Porta com três funções: empacotado, pasta de recursos, pasta de dados do usuário. Padrão sem host: não empacotado, pasta de recursos vazia e pasta de dados do usuário dentro da raiz de dados — a mesma regra que o desktop aplica quando essa pasta é definida (regra 3 da spec).
- As constantes viram funções, troca mecânica de nomes: `PACKAGED` → `isPackaged()`, `RESOURCES` → `resourcesDir()`, `SIDECAR_DIR` → `sidecarDir()`, `CLAUDE_BIN` → `claudeBin()`, `PLAYWRIGHT_MCP_CLI` → `playwrightMcpCli()`. A base (hoje `BASE`, linha 8) vira função: empacotado usa a pasta de recursos da porta, o resto usa a raiz do repositório como hoje. As pastas de voz continuam funções e passam a ler a pasta de dados do usuário da porta.

**Passo 6 — pontos de chamada** (renomeações)
- `src/main/index.ts` — busca de recursos (import na linha 19; usos em aviso, janela e bandeja).
- `src/main/autostart.ts` — comando de abertura com a sessão de login.
- `src/main/update.ts` — estados de empacotado (linhas 76, 91, 119).
- `src/main/updates.ts` — fonte de atualização, modo e status (linhas 97, 108, 123; a linha 99 lê a pasta de recursos diretamente e não passa pelo módulo de caminhos, fica como está).
- `src/main/screen/encoderWindow.ts` — carga do HTML do codificador.
- `src/main/browser/launch.ts` — caminho do servidor do navegador como padrão (linha 181).
- `src/main/voice.ts` — o `const SCRIPT` (linha 17) vira função chamada no início do processo filho (linha 128), porque é leitura no nível do módulo; os quatro usos internos da pasta do sidecar também viram chamadas.
- `src/main/claudeSdk.ts` — `defaults.bundled` (linha 31) vira propriedade calculada no objeto para ler o binário embutido só na chamada, sem mudar a interface dos auxiliares (o teste que passa o booleano não muda); o uso na linha 93 vira chamada.

**Passo 7 — testes existentes ajustados**
- `test/voice-gating.test.ts` — a simulação do módulo de caminhos passa a exportar as funções novas.
- `test/browser-quit.test.ts` — usos do caminho do servidor (linhas 6 e 36) viram chamada.
- `test/build-profiles.test.ts` — a asserção de texto (linha 39) passa a procurar o trecho `app.asar.unpacked/node_modules/@playwright/mcp/cli.js` no arquivo de caminhos, e o comentário acima dela é atualizado (a garantia é a mesma, o código mudou de forma).

**Passo 8 — portões** (rodar na codificação; esta etapa não executou nada):
`npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` e a compilação de empacotamento que a integração contínua roda.

**Passo 9 — verificação manual** (não automatizável): abrir o programa sobre uma pasta de dados que já tenha segredos gravados, em máquina com cofre do sistema disponível: a lista aparece como antes, gravar e usar um segredo funcionam, e o arquivo de segredos não muda de conteúdo nem de permissão.

## Testes novos (um por comportamento)

| Comportamento da spec | Arquivo de teste | O que ele prova |
|---|---|---|
| Regra 1 / aceite 1 — os dois módulos e tudo o que importam sem o runtime | `test/secrets-paths-no-electron.test.ts` | Um percorredor de imports lê os dois arquivos, segue os imports relativos, de tipo e dinâmicos, e falha apontando o arquivo que trouxe o runtime |
| Regra 8 / aceite 2 — o arquivo de hoje é lido sem migração | `test/secrets-existing-file.test.ts` | Uma cópia no formato atual (versão, cifra, aviso, aceite) aberta com uma porta falsa resolve o valor; as leituras não reescrevem o arquivo (conteúdo byte a byte igual) e uma gravação mantém formato e permissão |
| Preenchimento do registro (mesmo arquivo) | idem | Porta preenchida depois da primeira chamada da loja é honrada; porta nula fica fechada: estado de armazenamento inseguro, gravar valor cifrado é recusado e ler cifra lança indisponível sem devolver valor algum |
| Regra 6 / aceite 3 — ida e volta com a chave-mestre e recusa com chave diferente | `test/master-key.test.ts` | Mesma chave grava e lê o mesmo valor; chave diferente é recusada e a mensagem não contém os hexadecimais de nenhuma das duas |
| Regra 7 / aceite 4 — arquivo ausente ou legível por outros | idem | Ausente, permissão ampla, link, conteúdo inválido e caminho dentro da raiz de dados: todos recusados, com o estado indisponível e sem chave em mensagem; permissão mais fechada que 0600 é aceita |
| Regras 2-3 / aceite 5, lado sem interface | `test/paths-host.test.ts` | Sem porta preenchida: a pasta do usuário fica dentro da raiz de dados e as pastas de voz dentro dela, não empacotado, recursos na raiz do repositório; com porta falsa, é a porta que responde |
| Regras 2-3 / aceite 5, lado desktop + regra 2 | `test/desktop-ports.test.ts` | Com o runtime simulado no teste: `installElectronPorts()` faz os caminhos virem do desktop, a porta de cofre grava e lê pelo cofre simulado, o backend inseguro continua recusado e segue havendo recusa sem cofre com aceitação de armazenamento inseguro pendente |

Cobertura existente que permanece e não é reescrita: formato e permissão do arquivo (regra 4), só `resolve()` devolve o valor (regra 5), fontes de comando e de ambiente, arquivo danoso.

## Riscos e como se evitam

1. **Valores de desktop lidos antes das portas serem preenchidas** (instalação empacotada caindo em valores de desenvolvimento). Evita-se: o preenchimento é o primeiro comando do corpo do módulo principal; toda leitura vira função; as duas leituras apressadas no nível do módulo encontradas nesta leitura (o script da voz e a verificação do SDK embutido) viram preguiçosas; o teste de fecho acusa um retorno ao código antigo; a abertura manual do passo 9 cobre o resto.
2. **Segredos existentes ficarem ilegíveis.** Evita-se: a lógica do cofre muda de lugar sem alteração de corpo, o formato não é tocado, a cópia antiga do teste novo falha se qualquer linha mexer nisso, e a suíte inteira é a segunda rede.
3. **Vazamento da chave em mensagem.** Evita-se: as mensagens novas são texto fixo do catálogo, sem interpolação alguma; os testes afirmam que a chave não aparece em nenhuma recusa; a auditoria de conteúdo público roda no fim.
4. **Arquivo da chave em condição fraca passar.** Evita-se: validação em cada operação, sem cache, para os casos ausente, permissão ampla, link, conteúdo inválido e caminho dentro da raiz de dados.
5. **Testes existentes quebrando com a troca de nomes.** Evita-se: os três arquivos que apontam os nomes antigos estão listados no passo 7 e a suíte inteira roda como verificação.
6. **Estado do registro vazando entre testes.** Evita-se: a função de registro aceita nulo para voltar ao padrão e cada arquivo de teste tem registro próprio.
7. **Limite aceito:** com a aceitação de armazenamento inseguro já ligada no arquivo e a chave-mestre indisponível, a gravação cai em texto puro — é a regra atual do desktop, preservada pela regra 4; quem hospeda sem interface não tem tela para ligar essa aceitação. Não muda nesta mudança.

## O que o plano não cobre (dito)

- **A contagem transitiva de 131 para 16 arquivos que alcançam o desktop não é refeita aqui.** Não foi verificada em nenhuma etapa e a spec a marcou fora de escopo.
- **O executor sem interface, em si** (quem preenche as portas no produto): vem nas outras partes da cadeia; nesta mudança existem a porta e o adaptador.
- **O cofre real do sistema operacional não roda em teste automatizado**: o teste simula a porta; o que passa pelo cofre de verdade é a abertura manual do passo 9, não executada nesta etapa.
- **Nenhum portão foi executado nesta etapa** (nenhum comando foi concedido a ela): tipos, testes, auditorias e compilação rodam na codificação.

## Ordem para a codificação

Passos 1-4 (segredos e porta de criptografia) → passos 5-6 (caminhos e chamadas) → passo 7 (testes existentes) → testes novos da tabela → passo 8 (portões) → passo 9 (manual). Um passo só entra quando o que ele contém compila e os testes dele passam.
