# O painel de conflito sai da conversa de desbloqueio — revisão

## O que foi revisado

A retirada do painel de conflito da tela de desbloqueio, contra o pedido e o comentário de quem o
abriu e contra o plano do ciclo. Foram lidos o código da tela de desbloqueio e do componente do botão,
a linha do bloqueio e os dois pontos da tela de Hoje que oferecem o botão, os dois catálogos de idioma
com as cópias usadas pelos testes, os testes vizinhos (o do botão, o do painel de Hoje, o das cópias dos
catálogos, o que compara os catálogos de uma ponta com a outra) e o roteiro de teste de um ciclo
anterior que descrevia a tela mostrando o painel. O diff foi conferido arquivo por arquivo contra o
plano. Nada foi executado como verificação nova: os portões e a suíte são os que a implementação deixou
registrados.

## O que a revisão confirma

1. **A retirada está completa e coerente.** A seção do painel saiu do arquivo da tela de desbloqueio, e
com ela os dois imports que só ela usava (o do botão e o da função que lê os conflitos do card); o
arquivo não usa mais nenhum dos dois, e a coluna direita passa a começar na seção das saídas. A tela
segue alcançável por outros caminhos (a linha do bloqueio e a pergunta aberta), como antes.
2. **A marca de lugar perdeu apenas o valor reservado a esta tela.** O tipo passou a aceitar só os dois
valores que restam, e os dois pontos da tela de Hoje — na linha do que precisa de atenção, junto ao item
do bloqueio, e entre os botões de ação da linha de atividade do card — seguem montando o botão com os
mesmos valores. Não há mais nenhuma chamada com o valor retirado no código, nos testes nem nos
fixtures.
3. **As duas frases saíram das quatro partes.** As chaves do painel não existem mais nos dois catálogos
de idioma nem nas cópias espelhadas dos testes; a busca no código não encontra nenhuma referência a
elas, e nenhum teste as cita. O único outro lugar que as nomeia é um documento histórico de um ciclo
antigo, que não foi tocado.
4. **A guarda de escrita externa não perdeu nada.** Ela vive no processo principal: quem aprova uma ação
chama a guarda antes de qualquer escrita, e é por essa porta que o envio da resolução passa. O botão de
conflito só prepara a resolução e abre a tela do conflito; nada preso ao painel saiu com ele.
5. **Nada fora do escopo se moveu.** A detecção de qual requisição está em conflito e a linha do
bloqueio que aponta para o botão da tela de Hoje continuam iguais, e nenhuma configuração precisa ser
migrada.
6. **As falhas da suíte não vêm desta mudança.** A primeira execução da suíte (que a implementação
registrou) terminou com 3650 testes aprovados e 14 reprovados, em três arquivos que esta retirada não
toca: a resolução de conflito por linha de comando (tempo limite de teste e a trava "este conflito já tem
um passo em andamento", deixada por uma execução anterior), a execução do ciclo de release (tempo limite
de hook e uma asserção de trava órfã) e a corrente de agentes (uma pergunta entre agentes). Os vizinhos
da mudança estão entre os aprovados, inclusive o que renderiza a linha de Hoje com o botão e nomeia a
requisição do bloqueio.

## O que não foi verificado

- Nenhuma tela foi aberta. A retirada do painel e a permanência do botão nos dois pontos da tela de
Hoje valem como leitura de código e pelos testes que cobrem a origem do dado do conflito e a linha de
Hoje, não como observação em execução.
- A segunda execução da suíte não tem resultado final: o registro dela para no meio, no mesmo ponto da
primeira, sem o resumo. Não é possível afirmar que a repetição ficou verde.
- Os portões de tipos, idioma, tema e exposição pública não foram rodados de novo nesta revisão; valem
como o que a implementação registrou.

## O que ficou fora

- O roteiro de teste de um ciclo anterior que dizia que a tela de desbloqueio mostra o painel continua
desatualizado nesse ponto. Ele não está no caminho desta issue e o plano diz para ajustá-lo quando
estiver; fica como pendência registrada, não como falha desta mudança.
- A diferença entre o critério de aceite que falava em levar "ao ponto onde o botão está" e o
comportamento entregue foi resolvida por quem escreveu o critério: ele passa a descrever o que o app
faz, e a linha do bloqueio continua levando à tela de desbloqueio.

## Veredito

Aprovado. A mudança faz exatamente o que o pedido e o plano fecharam, sem sobra, e as falhas
de suíte são de tempo limite e de estado deixado por uma execução anterior, em áreas que esta mudança
não toca.
