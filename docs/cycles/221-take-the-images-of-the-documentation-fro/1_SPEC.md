# A documentação do Coxia passa a mostrar telas de verdade, e o release as refaz

A pasta das imagens guarda, hoje, só a página que promete capturas: o `README` e as
páginas listam cinco nomes de arquivo marcados como "a fazer". Esta mudança faz essas
imagens nascerem do próprio aplicativo, de um workspace fictício e por um script por
funcionalidade, e faz o release refazê-las — de modo que uma tela que muda deixe de ser
uma imagem que envelhece em silêncio.

## O que se pede

As palavras da própria issue:

> The images of the documentation are taken from the app, by an agent, from a workspace
> seeded with fictional data, following one capture script per feature. A release
> regenerates them, so the pictures never fall behind the screens. The person reviews the
> images in the pull request like any other change.

> Feeds #220 (the documentation site on GitHub Pages).

Em três partes, que se podem conferir separadamente: um **workspace fictício** criado por
um comando num folder que a pessoa escolhe; **scripts de captura**, um por
funcionalidade, que abrem o app nesse workspace e escrevem a imagem onde a documentação a
lê, com duas execuções produzindo os mesmos arquivos; e uma **passagem de release** que
refaz as imagens, cuja revisão é a revisão do pull request.

## O que muda para quem usa

- **As páginas deixam de prometer e passam a mostrar.** O `README` e as páginas de
  documentação exibem imagens tiradas do próprio aplicativo, com dados fictícios —
  nenhuma pessoa, empresa ou atividade real aparece nelas.
- **Uma tela que mudou deixou de virar uma imagem velha em silêncio.** Dentro de um
  release, as imagens são refeitas: só as telas que mudaram aparecem como mudança, e quem
  mantém o repositório vê o que mudou e diz "sim", como vê qualquer outro diff.
- **Qualquer pessoa pode refazer as imagens no próprio computador, com um comando.** Um
  workspace descartável é criado na hora, e os scripts de captura tiram as imagens dele.
  Nada é escrito por cima do workspace real de quem usa o aplicativo.
- **Uma etapa do ciclo pode pedir uma tela virtual.** Hoje só a etapa de QA (e o agente
  com o interruptor de tela) a recebe; uma etapa que trabalhe em algo que precisa de tela
  passa a poder pedi-la. Os fluxos que já existem não mudam de comportamento.
- **Uma imagem que ninguém usa e uma referência sem imagem deixam de passar.** Uma
  conferência do fluxo de integração contínua recusa os dois casos.
- **A tabela de pendências da pasta das imagens some** quando cada captura prometida
  existir; uma captura que a lista conheça e a pasta não tenha ainda continua listada como
  pendente, para a lista e a pasta nunca divergirem em silêncio.

## Regras

1. **O workspace é semeado por um comando, num folder indicado.** O comando recebe um
   folder e escreve nele um workspace completo e fictício: a configuração na versão de
   esquema do aplicativo que está rodando, um time de agentes (os cinco de sistema e um
   time de produto), algumas atividades num quadro de um host fictício, duas execuções
   (uma terminada, com documentos e comprovação; uma parada num gate humano), uma
   conversa com um passo segurado e uma gravação, três procedimentos aprendidos (um
   revisado, um desatualizado), a ata de um dia e um celular pareado. As telas descritas
   têm conteúdo suficiente para a imagem mostrar algo e nada real: todo nome, host e
   número é um exemplo neutro (`example.com`, `group/project`, `#123`).
2. **A semente nunca toca dados reais.** O comando se recusa a escrever num folder que já
   guarda um workspace, e não escreve nada fora do folder que recebeu. Quem o usa aponta a
   pasta de dados e a pasta de especificações do aplicativo para o folder semeado.
3. **Uma captura por funcionalidade, num arquivo.** Cada funcionalidade tem o seu script
   em `scripts/captures/<funcionalidade>.mjs`: abre o aplicativo **construído** sobre o
   workspace semeado, no idioma da captura (`pt-BR` e `en`), numa janela de tamanho fixo,
   num tema fixo e com as animações desligadas, caminha até a tela, espera ela assentar e
   escreve `docs/images/<funcionalidade>[-<idioma>].png`. Uma tela de celular sai do modo
   web, numa janela de 390 px de largura. Um script pode desenhar uma marca (um retângulo,
   um rótulo) sobre a imagem; a imagem sem marca também fica.
4. **A lista de funcionalidades é um arquivo.** `scripts/captures/index.json` diz, por
   funcionalidade: um id, o título nos dois idiomas, o script, quais telas, em que idiomas
   a captura sai, qual tema, e onde a imagem é usada (o `README` de cada idioma, uma
   página de `docs/`, o site). O `README`, as páginas e o site referenciam imagens **só**
   por essa lista. A primeira lista cobre, no mínimo, as cinco capturas que o `README` já
   promete — a tela do dia, uma cerimônia, a fila de ações, o assistente de configuração e
   o celular pareado —, e a captura do assistente de configuração serve a duas coisas: ela
   também mostra que uma pasta de dados vazia abre exatamente nele.
5. **Uma etapa que não é de QA pode pedir a tela.** Uma etapa do fluxo carrega um campo
   `display: true` (desligado por padrão) e recebe a mesma tela virtual que uma etapa de
   QA recebe, sob as mesmas configurações e guardas: na sandbox ou no computador, sem TCP,
   nunca a tela da pessoa. O campo é opcional e aditivo; nenhum fluxo existente passa a
   pedir tela por causa desta mudança.
6. **A regeneração entra pela rota do pull request.** O fluxo de release ganha uma etapa
   de trabalho, depois de as atividades da versão estarem na branch do release e antes de
   o corte ser pedido, com a tela ligada: a etapa roda os scripts de captura, guarda o que
   escreveu e deixa o que mudou em `docs/images/` seguir para o pull request do release,
   como qualquer outra mudança da branch. O corte continua sendo um passo único, que roda
   o script do próprio repositório, sem sandbox, e continua sempre atrás do "sim": nada
   nesta mudança o toca nem o antecipa. As imagens que a etapa refaz são capturadas das
   telas da branch do release; elas entram no release que está sendo trabalhado pela
   revisão normal do pull request, e o ciclo de release seguinte captura de novo.
7. **Uma conferência compara o que é usado com o que existe.** Uma imagem referenciada
   sem script, um script sem referência, uma entrada da lista sem imagem, ou uma imagem
   sem entrada na lista reprovam o fluxo de integração contínua, no mesmo trabalho em que
   já correm a auditoria pública, os tipos, os testes e a compilação.
8. **Nada real, em nenhuma imagem, em nenhum script.** O repositório é público: a semente,
   os scripts, as imagens, os documentos e as mensagens de commit não levam nome de
   empresa, de pessoa, de host real nem número real de atividade. A auditoria pública do
   repositório é o portão disso.
9. **As capturas não alcançam o mundo.** Elas abrem o aplicativo construído sobre dados
   fictícios, com um navegador de verdade que fala só com o próprio aplicativo; nenhum
   modelo de verdade, nenhum host de código de verdade e nenhuma rede entram em nenhuma
   execução de captura.

## O que fica fora

- **Publicar o site de documentação.** Quem publica as páginas é a #220; esta mudança
  entrega as imagens que ele usa.
- **Uma rota pela qual a comprovação de uma etapa vire imagem em `docs/images/`.** O
  caminho continua sendo: o release refaz as imagens e o pull request as leva.
- **Um comando de manutenção que refaça tudo.** Quem quiser pode rodar os scripts de
  captura à mão; não há um alvo novo que refaça o conjunto sozinho.
- **Um passo novo no corte do release (bump, changelog ou tag).** O corte fica como está;
  nenhuma imagem é regenerada depois da tag.
- **Capturar em outra plataforma que não o Linux.** A tela virtual do projeto é Linux:
  quem tenta capturar em outra plataforma recebe uma recusa que diz isso, em vez de uma
  imagem diferente.
- **A cor por imagem, com dois temas para a mesma tela.** O tema é um por captura, escolhido
  na lista; um conjunto de dois temas por imagem fica fora.
- **A semente servindo à suíte de testes.** O workspace semeado é uma ferramenta de
  documentação; substituir os dados fictícios que cada teste monta hoje fica fora.
- **Um relógio que o aplicativo aceite de fora.** O caminho de hoje — a semente escrever
  datas relativas a um dia fixo e a captura falsificar o relógio — é o que se aceita; um
  campo novo de relógio no aplicativo fica fora.
- **Uma imagem que mostre a tela virtual ao vivo ou uma passagem de tela em andamento.**
  Essas telas não entram na primeira lista.
- **Vocabulário novo de interface.** Se a tela de configuração da etapa ganhar o campo
  novo, os textos são os que o `t()` já exige.

## Aceitação

1. **A semente abre sem aviso.** Num folder vazio, o comando escreve o workspace; o
   aplicativo da versão atual o abre sem aviso de migração, com as telas descritas na
   regra 1 mostrando conteúdo. A auditoria pública passa, apontada para o folder que o
   comando escreveu.
2. **A semente não escreve duas vezes.** Rodar o comando de novo sobre o mesmo folder é
   recusado, com uma mensagem que diz isso, e nada do que estava lá é alterado.
3. **A lista de imagens sai inteira, nos dois idiomas.** Sobre o workspace semeado, num
   computador com o aplicativo construído e os navegadores, a captura escreve todas as
   imagens de `index.json` em `pt-BR` e em `en`. Uma segunda execução, com um folder de
   dados novo e semeado na hora, produz os mesmos arquivos, byte a byte.
4. **Uma etapa com a tela faz o mesmo.** O mesmo comando roda dentro de uma etapa com o
   campo novo ligado, na sandbox e no computador, e a etapa guarda cada imagem como
   comprovação e consegue olhar para ela.
5. **Uma etapa sem o campo não ganha tela.** Qualquer etapa que não seja de QA, sem o
   campo, continua sem tela nenhuma — como hoje. Com a tela ligada mas indisponível, o
   aplicativo diz o que falta e não usa a tela da pessoa.
6. **O release refaz as imagens e o pull request mostra só o que mudou.** A etapa do
   release com a tela ligada roda as capturas; uma captura que falha interrompe a etapa,
   que não segue calada; a lista de referências continua sem divergência depois de a etapa
   rodar; e o pull request do release mostra as imagens que mudaram, e só elas.
7. **Uma referência órfã reprova.** Trocar a referência de uma imagem, ou apagar uma
   entrada da lista sem apagar a imagem, reprova a conferência do fluxo de integração
   contínua; e a conferência passa quando imagem, script e referência se correspondem.
8. **A documentação mostra as imagens.** O `README` e as páginas mostram as imagens de
   `docs/images/` tiradas pelos scripts, e uma leitura das duas não encontra dado real em
   nenhuma delas.
9. **Nenhuma execução alcança o mundo.** Nenhum teste nem captura alcança modelo real,
   host de código real ou a rede.

## Perguntas em aberto

1. **O que fazer se as telas mudarem durante o ciclo de um release.** O que entra num
   release já se discute na conversa da release e no gate do plano. Quando imagens
   ficarem velhas no meio de um release, pelas telas que mudaram depois de a etapa rodar,
   quem decide reabrir a etapa e rodá-la de novo é a pessoa, não o refino: rodar de novo
   no meio do release é gasto e risco, e ficar com a imagem velha até o release seguinte é
   aceitável. O que a etapa exige é só que ela nunca siga calada.
2. **Quem fecha o ciclo de uma imagem órfã.** Uma imagem que ninguém usa, que fique entre
   a captura e a referência, é apagada pela pessoa em qualquer mudança — por exemplo na
   etapa do release, ou junto de uma mudança que a torne órfã. O refino não decide se a
   etapa do release recolhe as que sobrarem; se isso foi decidido, a mudança o faz.
