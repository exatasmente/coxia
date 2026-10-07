# Plano de testes: arquivos nas conversas, e os agentes abrindo o que a pessoa enviou

## O que este plano cobre

O comportamento que a issue pede, conferido no aplicativo e no que ele grava: a pessoa
anexa arquivos numa mensagem de qualquer conversa do fórum, os arquivos aparecem antes de
enviar com nome e tamanho e podem ser tirados dali, o aplicativo recusa o que passa dos
limites ou não é de um tipo aceito (o tipo pelo conteúdo, nunca pelo nome), a mensagem
enviada mostra a miniatura da imagem e o cartão dos demais, o agente chamado naquela
conversa abre os arquivos somente leitura e nunca recebe um caminho no computador, um
agente de outra conversa não os alcança, e apagar a mensagem apaga os arquivos do disco.

Cada cenário abaixo diz o que foi feito, o que se viu e como foi conferido: `executado`
quando um comando mostra o resultado, `lido` quando o comportamento só foi conferido por
leitura do código e dos testes, e `não rodado` quando não houve verificação nenhuma.

## Fatos que a conferência usa

- O tipo pelo conteúdo: assinatura de imagem (PNG, JPEG, GIF, WebP), `%PDF-`, ZIP/Office
  recusado, JSON quando o texto começa por `{`/`[` e analisa, CSV quando há duas linhas com
  o mesmo número de campos separados por vírgula, e fora disso texto. Um NUL nos primeiros
  bytes recusa o arquivo como binário.
- Onde o arquivo mora: nos dados do espaço de trabalho, por conversa, com um id curto
  gerado pelo aplicativo e a extensão do tipo revelado pelo conteúdo; o nome que a pessoa
  deu vai na mensagem e nunca vira caminho.
- Limites de uma instalação nova: imagem até 5 MB, os demais tipos até 1 MB, 10 MB no total
  de uma mensagem e no máximo 10 arquivos; os valores são do espaço de trabalho, com
  validação no esquema e na configuração.
- Alcance: cada mensagem guarda uma âncora da conversa, e os canais de arquivo só respondem
  quando a mensagem existe e a âncora é a da conversa pedida.
- Leitura estrita: só imagem e texto vão ao modelo; PDF, JSON e CSV ficam abríveis e
  baixáveis na conversa, e a ferramenta do agente diz o motivo.

## Cenários

### 1. Anexar na conversa, do computador

O que se procura: numa conversa do fórum (a de uma execução, uma geral, um canal, a
conversa direta com um agente) a caixa de escrita aceita arquivos por botão, por
arrastar-e-soltar, por colar de imagem e pelo seletor do sistema; cada arquivo aparece antes
do envio com nome e tamanho e pode ser removido; a mensagem só sai quando a pessoa envia.

Como se confere: abrir o aplicativo numa conversa, anexar uma imagem e um registro de erro
e enviar. E, sem o aplicativo aberto, as funções de formatação e as chaves de tela, mais a
asserção sobre o texto-fonte da tela do compositor.

Resultado neste ciclo: **não rodado** com o aplicativo aberto. A leitura da tela mostra a
caixa de anexo, o arrastar-e-soltar, o colar e a lista de preparação com nome, tamanho e
remover (o teste que lê a fonte da tela passa).

### 2. Recusa antes de enviar, com o motivo

O que se procura: um arquivo acima do limite do espaço de trabalho, ou de um tipo fora da
lista, é recusado antes do envio e o motivo é dito em palavras; nada dele é guardado, e os
outros arquivos da mesma mensagem e a mensagem em si seguem.

Como se confere: enviar um arquivo acima do limite e um de tipo recusado por uma conversa, e
conferir que a pasta da conversa não ganhou arquivo nenhum; no aplicativo, ver a mensagem de
recusa na caixa.

Resultado neste ciclo: **executado** pelo caminho do armazenamento e dos canais. Um texto
acima do limite por arquivo foi recusado com o motivo ("passa do limite de … MB para esse
tipo de arquivo"), um ZIP foi recusado como formato desconhecido, e a contagem de arquivos
da conversa não mudou depois de cada recusa. O motivo na tela e a mensagem em si seguirem
não foi rodado.

### 3. O tipo é decidido pelo conteúdo

O que se procura: um nome com a extensão trocada não engana a checagem, nos dois sentidos
(um PNG chamado `.txt` é imagem; um texto chamado `.png` é texto), e o arquivo guardado leva
a extensão do tipo revelado pelo conteúdo, nunca a do nome.

Como se confere: pelo reconhecedor de tipo e pelo armazenamento, com bytes reais.

Resultado neste ciclo: **executado**, com o resultado esperado nas três frentes: imagem por
assinatura (PNG, JPEG, GIF, WebP), PDF por `%PDF-`, JSON e CSV pela forma do texto, e ZIP ou
binário recusados; um PNG chamado `.txt` foi guardado como imagem e recebeu a extensão do
tipo; um nome com `../` foi guardado pelo id, e não pelo nome.

### 4. O que a mensagem enviada mostra e abre

O que se procura: a imagem aparece como miniatura e abre em tamanho cheio; qualquer outro
arquivo aparece como cartão com nome, tipo e tamanho, e abre ou é salvo; o cartão não mostra
o conteúdo nem um caminho no computador.

Como se confere: pelas funções de exibição e pelas chaves dos catálogos (o aplicativo não
pode ser montado num teste), e no aplicativo aberto pela miniatura e pelo cartão.

Resultado neste ciclo: **não rodado** no aplicativo. Por leitura, a miniatura, o cartão com
tipo e tamanho, abrir e salvar existem na tela, e as chaves dos dois idiomas existem.

### 5. Guardar e apagar o arquivo

O que se procura: o arquivo fica nos dados do espaço de trabalho, por conversa, nunca num
repositório nem na cópia de trabalho da execução; remover um arquivo antes de enviar apaga o
arquivo do disco; apagar a mensagem apaga do disco os arquivos que ela carregava e os das
mensagens vizinhas ficam; uma limpeza que encontre um arquivo já apagado não falha.

Como se confere: pelos canais do fórum, conferindo o disco antes e depois; pela varredura de
retenção, conferindo quais arquivos ela manteria.

Resultado neste ciclo: **executado** pelos canais do fórum e pela varredura. Apagar uma
mensagem do meio de uma conversa removeu os arquivos dela e manteve os das mensagens
vizinhas; apagar de novo devolveu "nada a fazer"; a mensagem de outra conversa não foi
apagada por essa conversa; a varredura manteve o arquivo que uma mensagem viva nomeia e
marcou o órfão como removível, e um registro apontando para um arquivo já apagado não
falhou.

### 6. O que a mensagem registrada pelo aplicativo carrega

O que se procura: a mensagem que uma execução registra quando a pessoa responde à pergunta
dela carrega os arquivos enviados, mostra a miniatura e o cartão, abre os arquivos, e
apagá-la apaga os arquivos do disco; um espaço de trabalho pode tirar os anexos dos agentes
sem tirá-los do que a pessoa vê.

Como se confere: com uma execução conduzida até a pergunta, subindo dois arquivos reais na
conversa dela, respondendo e conferindo os canais de arquivo sobre a mensagem de resposta e
o disco depois de apagá-la.

Resultado neste ciclo: **executado**, com resultado positivo: os bytes dos dois arquivos
foram servidos pela mensagem de resposta, com o tipo lido do conteúdo; apagar essa mensagem
removeu os dois arquivos do disco; a mesma mensagem nunca foi aberta por outra conversa; com
a opção de anexos para agentes desligada, o agente chamado não recebeu os arquivos e a tela
continua mostrando-os na mensagem.

### 7. O agente chamado abre os arquivos

O que se procura: um agente chamado por `@` naquela mensagem fica sabendo quais arquivos ela
carrega (nome, tipo e tamanho) e abre-os com uma ferramenta somente leitura; uma imagem
chega ao modelo como imagem nos dois motores e um texto como texto, cortado no teto; um PDF,
um JSON ou um CSV recebem o motivo de não irem ao modelo; nenhum caminho no computador chega
ao modelo.

Como se confere: pela ferramenta nos dois formatos, pelo aviso que entra no pedido do
agente, e pelo motor aberto com um servidor de mentira que registra as mensagens enviadas.

Resultado neste ciclo: **executado**. A ferramenta leu o texto com as linhas numeradas e a
imagem como imagem, recusou o PDF com o motivo, não resolveu um arquivo de outra conversa
nem um ref que parece caminho, e o texto que o modelo recebe não traz separador de caminho.
No motor aberto, a rodada mandou o resultado de ferramenta como texto e a imagem como
pedaço de imagem numa mensagem de usuário, e a transcrição guarda o pedido sem duplicar os
bytes. O aceite como um todo (o modelo descrevendo a imagem e citando o registro) não foi
observado: nenhum provedor real foi chamado.

### 8. Um agente de outra conversa não abre os arquivos

Como se confere: pelos canais de arquivo e pela ferramenta, pedindo o arquivo de uma
mensagem por outra conversa.

Resultado neste ciclo: **executado**: os canais de leitura e de exclusão devolveram vazio
para a outra conversa, um ref de outro id não foi servido pela mensagem, e a ferramenta do
agente de outra conversa recusou o ref.

### 9. O que sai do computador está dito, e os agentes podem ser desligados

O que se procura: a caixa de anexo avisa uma vez que o que um agente lê sai para o provedor
de modelo; com os anexos para agentes desligados, a pessoa continua anexando e vendo, e o
agente chamado não os recebe.

Como se confere: pelas chaves nos dois idiomas e pelo caminho que leva os arquivos ao
agente; no aplicativo aberto, pelo aviso na caixa.

Resultado neste ciclo: **executado** nas chaves e no caminho do agente: o aviso existe nos
dois idiomas ("O que um agente lê aqui é enviado ao provedor de modelo: sai deste
computador." / "What an agent reads here is sent to the model provider: it leaves this
computer."), e a chamada do agente deixou de receber os arquivos com a opção desligada. O
aviso na tela não foi visto rodando.

### 10. O navegador pareado

O que se procura: o navegador pareado mostra e baixa os arquivos pelo mesmo caminho do resto
do fórum, sem ser janela-exclusiva e sem ser efeito externo; um arquivo perto do limite
cabe no corpo de uma chamada, e as quatro chamadas de escrita entram na fila do telefone.

Como se confere: pela política web dos canais, pela fila de reenvio e pelo teto do corpo.

Resultado neste ciclo: **não rodado** com um aparelho real. O teste da política web cobre os
cinco canais de arquivo como abertos, não janela-exclusiva e não efeito externo, e as quatro
escritas estão na fila; o envio de um arquivo grande pelo telefone não foi exercitado.

### 11. Apagar a mensagem na tela

O que se procura: cada mensagem tem o botão de apagar, com confirmação que diz quantos
arquivos vão junto; confirmada, a mensagem e os arquivos somem da tela.

Como se confere: no aplicativo aberto.

Resultado neste ciclo: **não rodado**. O botão de apagar aparece em toda mensagem (a tela
foi lida, e a confirmação diz quantos arquivos serão apagados); o caminho de exclusão em si
foi exercitado pelos canais, não pela tela.

### 12. O espaço de trabalho governa os limites

O que se procura: os limites por arquivo, por mensagem e por número de arquivos são do
espaço de trabalho, com padrões numa instalação nova; um valor incoerente é recusado na
validação; o editor do navegador pareado pode gravar esse bloco.

Como se confere: pela validação da configuração, pelo caminho editável do navegador pareado
e por uma gravação de limites próprios chegando ao armazenamento.

Resultado neste ciclo: **executado**. Uma configuração com o total da mensagem menor que o
limite de um arquivo é recusada e a incoerência vira aviso; a gravação do bloco pelo
navegador pareado não é recusada pela política de escopo nem pelo canal; e um armazenamento
com limites próprios recusou um texto de 200 bytes sob um limite de 100, enquanto o mesmo
texto passou sob os padrões. O editor na tela não foi visto rodando.

### 13. Nada de anexo vai ao host de código

Como se confere: pelo caminho do anexo, que não passa por nenhuma publicação no rastreador,
e pelo texto da tela, que não oferece isso.

Resultado neste ciclo: **não rodado**: nenhum host real foi alcançado nesta etapa. Por
leitura, o bloco de anexos não participa de nenhuma publicação nem de proposta, e o cartão
não mostra o conteúdo do arquivo.

## Gates do projeto usados nesta etapa

Todos rodados nesta etapa, com o resultado que saiu:

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | limpo, código de saída 0 |
| `npm run i18n:lint` | limpo, 4127 chaves nos dois idiomas, 11 catálogos |
| `node scripts/theme-audit.mjs` | limpo, 55 pares de contraste acima de 4.5:1, sem cor literal nova |
| `node scripts/public-audit.mjs` | limpo, 927 arquivos |
| `npx electron-vite build` | construído, código de saída 0 |
| `npx vitest run` | a suíte inteira verde numa execução (233 arquivos, 3734 testes); nas outras, testes de arquivos alheios ao recurso estourando o limite de 5 s por teste sob a carga de 233 processos, todos verdes isolados |
| testes do recurso | 70 testes em 11 arquivos, todos verdes: tipo (13), armazenamento (13), canais do fórum (7), exclusão (4), ferramenta (7), menção (4), motor aberto (4), retenção (5), resposta da execução (3 e 1), tela (9) |

## O que não foi verificado

- A tela rodando: a miniatura, o cartão, o arrastar-e-soltar, o colar, o seletor do
  telefone, o aviso e o botão de apagar com a confirmação.
- Um aparelho pareado real enviando um arquivo perto do limite pelo corpo de 15 MB, e um
  envio grande que não coubesse sendo recusado antes do envio.
- Um provedor compatível real aceitando um pedaço de imagem no histórico do motor aberto, e
  um agente descrevendo a imagem e citando o registro de erro de ponta a ponta.
- A publicação no rastreador: nenhum host real foi alcançado.
- A gravação do bloco de anexos pelo editor do navegador pareado e a migração de uma
  configuração antiga: o caminho foi conferido pelo escopo e pelo esquema, não de ponta a
  ponta.
- Com os anexos desligados no espaço de trabalho (`enabled`), se o compositor deixa de
  aceitar arquivos: o campo é lido nos limites e na validação, e a caixa de escrita foi lida
  sem esse guarda.
