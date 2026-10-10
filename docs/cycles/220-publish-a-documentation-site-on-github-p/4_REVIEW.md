# O site não pode ser aprovado enquanto a checagem não resolver os links do endereço publicado

## Veredito

**Mudanças pedidas.** Um bloqueante: a checagem de links do próprio site não resolve um único link quando o site é construído com o endereço de publicação que o fluxo define — o único ambiente em que o site é de fato publicado. O critério de aceitação "o site constrói, os links resolvem e as duas línguas têm todas as páginas" vale hoje só para a prévia local, e nenhum teste cobre isso. O resto da mudança é bom: o desenho está de acordo com a especificação e o plano, nenhuma falha de segurança foi encontrada, e o que segue são sugestões.

## Como esta revisão foi feita

Leitura do diff inteiro contra a especificação e o plano, do código do site, dos testes e dos fluxos de integração contínua. Três coisas foram conferidas por execução, nesta tentativa:

- a auditoria do repositório público sobre a árvore inteira, com os arquivos do site dentro da varredura: termina com `0`, 1733 arquivos, nenhum acerto;
- os seis arquivos de teste que cobrem os módulos do site, o README e a cerca do agente: 71 testes, todos passam;
- a construção do site nos dois endereços de origem, e a checagem do site sobre cada construção — é o que sustenta o achado bloqueante abaixo.

O que não foi verificado: a publicação no host e o site no ar; o Pages ligado na configuração do repositório; uma mudança posterior em `docs/` ou no `CHANGELOG.md` atualizando o site na mesclagem; e um agente de documentação construindo o site com um modelo de verdade.

## O bloqueante

### A checagem do site não resolve os links do endereço publicado

O fluxo `.github/workflows/pages.yml` constrói o site com `SITE_BASE: /${{ github.event.repository.name }}/` (linha 48), e é essa a construção que é publicada. A checagem que confere os links nunca recebe esse prefixo e nunca o descarta do endereço de um link.

A verificação, nesta máquina, na árvore de trabalho:

| O que se rodou | O que aconteceu |
|---|---|
| Construir o site com o endereço de publicação e rodar a checagem | A construção passa; a checagem termina com `1` e 2242 linhas de link quebrado, a primeira delas `use-cases/team.html` apontando para `/cerimonias/use-cases/issue-to-pr` |
| O mesmo, sem o endereço de publicação | As duas passam; a checagem diz que todo link resolve e toda página carrega as duas línguas |
| Procurar o arquivo que a checagem diz estar faltando | `site/.vitepress/dist/use-cases/issue-to-pr.html` existe; o que não existe é o caminho com o prefixo do endereço dentro da pasta construída |

A causa está em `site/scripts/check.mjs:40`: um endereço absoluto do site é juntado à pasta construída sem que o prefixo do endereço de publicação seja retirado, então o prefixo reaparece dentro da pasta. Como o prefixo vale para todo link interno da página, todo link interno é dado como quebrado.

Por que isso bloqueia: o critério de aceitação 2 e a regra 10 da especificação pedem que a checagem pegue o site que é publicado, e a checagem nunca foi exercitada na construção que é publicada — ela não distingue um link que resolve de um que não resolve quando o site saiu daqui. Do jeito que está, o desencontro só apareceria na mão, na primeira publicação, e voltaria a cada troca do endereço de origem.

O que se espera da correção: que a checagem leia, da própria construção, o endereço de origem com que ela foi feita (ou receba o mesmo valor do fluxo), e que haja um caso de teste que construa o site — ou a pasta construída — com um prefixo de endereço e confira que os links resolvem e que um link realmente quebrado continua reprovando. Assim também desaparece a suposição de que o endereço de publicação é o nome do repositório: qualquer troca desse valor seria pega por comparação, não por acaso.

## Critérios de aceitação

| Critério | Onde se confere |
|---|---|
| A mudança traz o site, o fluxo de publicação e a checagem; os portões passam | Os arquivos estão na árvore; a auditoria pública foi rodada aqui e passa com os arquivos do site dentro da varredura. Os demais portões são os que a execução relatou, não repetidos nesta tentativa |
| O site constrói, os links resolvem e as duas línguas têm todas as páginas | **Não atendido para o site publicado.** A checagem existe e roda na etapa `check` do fluxo de verificação, e passa sobre a construção local; sobre a construção com o endereço de publicação, reprova todo link interno |
| Abertura, guia, referência, casos de uso, blog e histórico existem nas duas línguas | Atendido: cada página escrita à mão tem o par na outra língua, e a checagem de línguas confere, com a páginas de uma língua só do repositório marcadas como tal |
| Cada documento da documentação de referência é alcançável do site | Atendido: a lista da referência é a travessia da pasta, e cada documento ganha endereço pelo próprio caminho |
| A página do histórico segue o arquivo | Atendido: a página é montada na construção a partir do histórico; nenhuma segunda cópia é versionada |
| O blog abre com o texto da versão estável | Atendido: a versão estável mais recente é a que tem seção no histórico, e as betas não viram texto |
| O site não usa imagem real nenhuma | Atendido: as páginas que pedem imagem mostram texto e espaço reservado, dizendo que a captura está pendente |
| A publicação está declarada e o aplicativo não mexeu em configuração de repositório | Atendido: o fluxo de publicação está no repositório e nenhum arquivo da mudança escreve configuração no host |
| A linha de status dos dois README diz a versão atual e leva ao site | Atendido: os dois citam a versão do arquivo de versão e trazem o endereço publicado |
| O site responde no endereço dentro da execução do fluxo | Não verificado: depende do host, depois da mesclagem |
| O site publicado é conferido de dentro do aplicativo | Não verificado: depende do site no ar e da lista de hosts do agente |
| Uma mudança posterior atualiza o site na mesclagem | Não verificado: o caminho está construído, mas não foi exercitado |
| A checagem do site pega as duas falhas que ela existe para pegar | Parcialmente atendido: os testes provocam as duas falhas e elas reprovam, mas a checagem de links reprova também o que está certo quando o site carrega o endereço de publicação |
| O agente de documentação trabalha a pasta do site pelo ciclo normal | O agente tem sandbox e permissão de escrita, o fluxo com gate continua o mesmo, e a cerca de escrita está coberta por teste. Nenhum modelo real percorreu o fluxo |

## Sugestões

### A linha de status nomeia uma versão fixa, e o teste aceita qualquer endereço

A linha de status dos dois README diz a versão do arquivo de versão (`0.9.0-beta.15`) e leva ao site. A regra 12 pede que ela leve ao site, e ela leva; o plano pedia o endereço fora de qualquer arquivo, e ele está em dois. A contradição foi resolvida a favor da regra, e o resultado traz duas consequências pequenas: o número da versão, atualizado a cada release, está escrito nos dois README além do arquivo de versão; e o teste que confere o endereço casa qualquer domínio, então ele passaria com o endereço de outro projeto. Um teste que compare o endereço entre os dois arquivos, ou com o endereço que o próprio repositório declara, pegaria a troca acidental de um deles.

### A linguagem de endereços repetida em três lugares

O endereço de uma página de referência é montado de três formas: por uma função própria no módulo puro, por uma transformação de texto na configuração do site, e de novo quando as páginas geradas são escritas. Um documento novo continua ganhando endereço sem lista paralela, que é o que importa, mas a regra que decide o endereço não vive num lugar só, e os testes cobrem a função pura, não as outras duas cópias.

### Falta o caso de borda de uma página do site em uma língua só

A checagem de línguas é coberta por teste com um arquivo temporário. O que não tem caso é a pasta real do site com uma página que exista só em inglês: um caso assim passaria hoje pela checagem porque a página em português do guia, dos casos de uso e do blog vive numa pasta `pt-br/` ao lado, e o par é procurado nessa pasta. Vale um caso que exercite essa forma de par, que é a que o site de fato usa.

## O que foi conferido por leitura, e o que não foi

Conferido:

- O desenho que mais pesa nesta mudança — a cerca do agente de documentação — não mudou. A permissão de escrita continua a de antes, só a capacidade de rodar comandos na sandbox foi acrescentada, e um caso de teste novo cobre as recusas de um agente que escreve fora da execução de documentação: a pasta do site e o restante da árvore de trabalho são alcançáveis, e a pasta do git, uma pasta de gancho, um arquivo de segredo e um caminho que sai por link continuam recusados.
- Nenhuma porta nova de escrita no host foi criada, e nada no aplicativo passou a escrever configuração de repositório ou de publicação. O fluxo de publicação é declarado e não escreve configuração nenhuma.
- Nenhum segredo, nome de empresa, de pessoa ou endereço privado entrou no diff; a auditoria rodou sobre a árvore inteira, com os arquivos do site dentro da varredura, e não acusou nada.
- As dependências do gerador são todas de desenvolvimento e presas por versão exata, e a tabela de licenças do pacote público não ganhou linha: o que o aplicativo carrega não mudou.
- As páginas que pedem imagem usam espaço reservado, com a legenda dizendo que a captura está pendente, e nenhuma captura real entrou.

Não conferido nesta revisão: a publicação no host, o site no ar, uma mudança posterior atualizando o site na mesclagem e um agente de documentação construindo o site com um modelo de verdade. Nada disso é verificável sem o host, e a execução já os relatou como não verificados.
