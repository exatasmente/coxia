# A correção do bloqueante da rodada anterior chegou, mas a passada não está fechada

## Veredito

**Mudanças pedidas.** Um bloqueante: a correção que a rodada anterior pediu deixou três casos do arquivo de teste da checagem do site vermelhos, e um deles aponta uma regra da checagem de línguas que agora contradiz a forma que o próprio site usa (o par na pasta `pt-br/` ao lado da página). Também há um defeito pequeno, de pé desde a primeira implementação: um documento escrito só em português vira a página da língua errada, e a checagem de línguas o aceita. O bloqueante da rodada anterior — a checagem de links não resolver os links do endereço publicado — está corrigido e foi conferido aqui: na construção publicada, a construção passa e a checagem sai 0. Os portões que esta etapa rodou: tipos, auditoria de tema, lint de idiomas e auditoria pública passam; a suíte não (3 de 7674 casos falham, num arquivo).

## Como esta revisão foi feita

Rodada 2. A rodada 1 pediu como bloqueio que a checagem de links resolvesse os links de uma construção com o endereço de publicação, e listou sugestões. A revisão desta rodada conferiu primeiro se aquilo foi atendido, e depois o que a correção introduziu de novo — é onde estão o achado bloqueante e dois outros.

Lido: o diff inteiro da rodada (a checagem de links, a geração das páginas de referência, a regra de endereço, o fluxo de publicação, a checagem do site no fluxo de verificação, os testes do site). Executado, nesta máquina, na árvore de trabalho:

| O que se rodou | O que aconteceu |
|---|---|
| `npx tsc --noEmit` | sai 0 |
| `npx vitest run` | 3 falham, 7668 passam, 3 pulados (de 7674); um arquivo vermelho: o da checagem do site |
| `node scripts/theme-audit.mjs` | sai 0 |
| `npm run i18n:lint` | 5739 chaves nas duas línguas, sai 0 |
| `node scripts/public-audit.mjs` | 1733 arquivos, nada, sai 0 |
| `SITE_BASE=/cerimonias/ npx vitepress build site` e a checagem sobre essa construção | a construção passa e a checagem diz que todo link resolve e toda página carrega as duas línguas, saída 0 |
| a checagem de links e a de assets sobre a construção publicada | 0 links quebrados; 483 arquivos carregados por página, 85 distintos, nenhum faltando — as fontes que VitePress escreve separadas entram na contagem |
| a geração dos documentos de referência a partir de uma cópia da árvore no primeiro commit do site | 4 dos 5 links de host da página do histórico apontam para um caminho que não existe no repositório |

O que não foi verificado: a publicação no host e o site no ar; o Pages ligado na configuração do repositório; uma mudança posterior em `docs/` ou no `CHANGELOG.md` atualizando o site na mesclagem; e o agente de documentação construindo o site com um modelo de verdade.

## O bloqueante

### A correção deixou vermelho o arquivo de teste da própria checagem, e uma regra nova contradiz a forma que o site usa

O recado da rodada anterior pedia três coisas: a fixture `underBase` com um endereço `/assets/` para a checagem ler o prefixo, o caso de uma língua só com a expectativa decidida, e o `runner.pt-br.md` com o link de volta de título `English`. Rodei o arquivo: **3 dos 18 casos falham**. O caso do endereço base passou (é o que mais importa: a checagem agora lê o prefixo da própria construção, e na construção publicada ela sai 0). O que segue vermelho:

1. **O caso de uma língua só produz duas entradas.** A pasta de teste tem `use-cases/team.md` sem par e `use-cases/pt-br/index.md` sem o par dela. A checagem acusa as duas — e acusa a segunda pedindo `use-cases/pt-br/index.pt-BR.md`, um nome que a forma que o site usa nunca cria. A expectativa do caso não decidiu qual das duas entradas é a falha.
2. **O caso do link entre as duas línguas.** A página `runner.pt-br.md` da pasta de teste não carrega o link de volta, então a checagem a acusa de não ter par. O recado já dizia que ela precisava do link com título `English`; não foi feito.
3. **O caso do link quebrado de uma construção com prefixo** mede o estado intermediário de uma construção pela metade, e não a regra que a checagem deve seguir (ver a primeira sugestão abaixo).

O que faz disso um bloqueante é o (1) e o (2): o teste da checagem do site não está verde, e a rodada anterior pediu isso explicitamente. O vermelho não é cosmético — o candidato `use-cases/pt-br/index.pt-BR.md` é o sintoma de uma regra que empurra uma página de português para fora do par que ela de fato tem. Uma pasta de teste que misture páginas com par e sem par é a que o repositório vai ter; enquanto a checagem pedir ali um nome que o site não escreve, ela não está dizendo o que quer dizer, e o que ela acusa é um nome errado.

## Sugestões

### A checagem de links mede o estado do gerador em vez da regra que deve seguir

O caso testa que um link para uma página que não existe reprova **numa construção com prefixo**, mas a construção que ele monta é a de uma pasta em que só uma parte das páginas foi escrita. O que a checagem deve seguir é a regra: tirar o prefixo do endereço e procurar o arquivo que o servidor serviria; que a construção esteja completa é assunto de quem a escreve. Hoje o caso prende a expectativa ao que o gerador escreve dentro da pasta construída, e é por isso que ele fica vermelho quando o gerador muda. Um caso que monte a construção inteira, ou que confira a regra pela função que a aplica, pegaria a falha de verdade — um link para uma página que não existe — sem depender de quantas páginas a pasta tem.

### O que a checagem ignora dos links de uma página construída

A checagem lê os endereços de `href` e os links em Markdown, e não lê os de `src`. Não é um defeito hoje (nenhuma página carrega imagem), mas é a razão de existir da função que confere os arquivos carregados pela página, que o gerador também não chama. Enquanto isso não for decidido, a checagem do site confere a página e não o que ela carrega, e uma imagem com endereço errado passaria.

### O botão de idioma da abertura e das páginas de seção não existe

A regra 3 pede que a página em inglês e a em português sejam alcançáveis uma da outra, e a checagem de línguas aceita o par pela pasta `pt-br/` ao lado — mas isso confere que o par existe, não que se chega a ele. Nas páginas de referência o gerador escreve um link para o outro idioma; nas escritas à mão (a abertura, o guia, os casos de uso, o blog) não há link nenhum entre as duas versões, e a barra de navegação não troca de endereço entre as línguas. Quem chega à abertura em inglês chega ao português pela URL, ou não chega. É o mesmo ponto que a rodada 1 levantou como "duas convenções" e deixou como sugestão; aqui ele fica dito pelo efeito: a página em português existe e não é alcançável.

### Quatro links do site publicado apontam para um caminho que não existe no repositório

Este defeito é do primeiro commit do site e **não é da rodada**: fica registrado, não bloqueia. A página do histórico, no site publicado, carrega `https://github.com/exatasmente/coxia/blob/main/docs/RELEASING.md` (correto) e quatro endereços com `docs` duas vezes — `blob/main/docs/docs/memory.md`, `blob/main/docs/docs/runner.md`, `blob/main/docs/docs/runner.md#a-release`, `blob/main/docs/docs/cycles.md#...#...`. A pasta `docs/docs` não existe: os quatro levam a uma página de erro. O primeiro leva o leitor à página do próprio documento de memória compartilhada que a entrada do histórico diz ser nova; o mesmo endereço errado aparece na página do blog daquela versão. Não é pego pela checagem de links porque é um endereço de outro site.

## Critérios de aceitação

| Critério | Onde se confere |
|---|---|
| A mudança traz o site, o fluxo de publicação e a checagem; os portões passam | O site, o fluxo e a checagem estão na árvore. Auditoria pública, tipos, tema e idiomas passam aqui; a suíte não (3 casos vermelhos no arquivo da checagem) |
| O site constrói, os links resolvem e as duas línguas têm todas as páginas | **Atendido na construção publicada**: com o endereço de publicação a construção passa e a checagem sai 0, sem nenhum link quebrado. As duas línguas de cada página também passam |
| Abertura, guia, referência, casos de uso, blog e histórico existem nas duas línguas | Atendido para existir; a abertura, o guia, os casos de uso e o blog têm o par na outra língua, e a checagem os vê pela pasta. Que a pessoa chegue ao par por um link da página, não (ver sugestão) |
| Cada documento da documentação de referência é alcançável do site | Atendido: a lista da referência é a travessia da pasta, e cada documento ganha endereço pelo próprio caminho |
| A página do histórico segue o arquivo | Atendido: a página é montada na construção a partir do histórico, e nenhuma segunda cópia é versionada |
| O blog abre com o texto da versão estável | Atendido: a versão estável mais recente é a que tem seção no histórico, e as betas não viram texto |
| O site não usa imagem real nenhuma | Atendido: as páginas que pedem imagem mostram texto e espaço reservado |
| A publicação está declarada e o aplicativo não mexeu em configuração de repositório | Atendido: o fluxo de publicação está no repositório e nenhum arquivo da mudança escreve configuração no host |
| A linha de status dos dois README diz a versão atual e leva ao site | Atendido: os dois citam a versão do arquivo de versão e trazem o endereço publicado |
| O site responde no endereço dentro da execução do fluxo | Não verificado: depende do host, depois da mesclagem |
| O site publicado é conferido de dentro do aplicativo | Não verificado: depende do site no ar e da lista de hosts do agente |
| Uma mudança posterior atualiza o site na mesclagem | Não verificado: o caminho está construído, mas não foi exercitado |
| A checagem do site pega as duas falhas que ela existe para pegar | Parcialmente atendido: a checagem de links agora passa na construção publicada e reprova um link para uma página que não existe; a checagem de línguas reprova uma página sem par, e é o próprio caso dela que está vermelho |
| O agente de documentação trabalha a pasta do site pelo ciclo normal | O agente tem sandbox e permissão de escrita, e um caso novo cobre as recusas de cerca de um agente que escreve; nenhum modelo real percorreu o fluxo |

## O que foi conferido por leitura, e o que não foi

Conferido:

- A cerca de escrita do agente de documentação não mudou: a permissão continua a de antes, só a capacidade de rodar comandos na sandbox foi acrescentada, e o caso novo cobre as recusas de um agente que escreve fora da execução de documentação (o git, uma pasta de gancho, um arquivo de segredo e um caminho que sai por link continuam recusados).
- Nenhuma porta nova de escrita no host foi criada, e nada no aplicativo passou a escrever configuração de repositório ou de publicação.
- Nenhum segredo, nome de empresa, de pessoa ou endereço privado entrou no diff: a auditoria rodou sobre a árvore inteira, com os arquivos do site dentro da varredura, e não acusou nada. O endereço publicado do próprio projeto aparece na linha de status dos dois README, e é a decisão que a spec tomou (a linha leva ao site); não é um endereço de outra pessoa nem um segredo.
- As dependências do gerador são de desenvolvimento e presas por versão exata, e o que o aplicativo carrega não mudou.
- As páginas que pedem imagem usam espaço reservado, e nenhuma captura real entrou.

Não conferido nesta revisão: a publicação no host, o site no ar, uma mudança posterior atualizando o site na mesclagem e um agente de documentação construindo o site com um modelo de verdade. Nada disso é verificável sem o host, e a execução já os relata como não verificados.
