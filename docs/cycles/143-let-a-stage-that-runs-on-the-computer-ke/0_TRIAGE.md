# A etapa que roda no computador precisa guardar o que produziu, em vez de perder tudo com a pasta temporária

Tipo: bug.

## O que a issue pede

Uma etapa cujo agente roda comandos no computador (`shell: host`) não consegue guardar comprovação alguma, e o que ela produziu para testar uma interface é apagado quando a etapa termina. A issue pede três coisas:

1. Uma sessão de host que testa uma interface passa a expor a pasta de saída (`$COXIA_OUT`) como a pasta de onde a comprovação é lida, e a etapa recebe `SaveEvidence` e `AnnotateImage` com as mesmas regras de uma sandbox: só arquivos dentro daquela pasta, sem `..`, sem link, tipo lido dos bytes, o mesmo teto de tamanho e ids `ev-<n>`.
2. O que a #142 decidir para as imagens que o agente olhou e não guardou (guardadas no fecho, ou listadas na conversa) também vale para a sessão de host, e roda antes de a pasta dela ser removida.
3. O texto que a etapa recebe diz o mesmo nos dois modos: uma etapa de host que testa uma interface é avisada de `SaveEvidence` e dos ids de comprovação exatamente como uma etapa com sandbox.

A aceitação pede um teste para cada ponto: a comprovação guardada a partir da pasta de saída do host aparece na execução e pode ser citada por um cenário; um caminho fora da pasta do host é recusado como na sandbox; o tratamento da #142 roda antes de a pasta do host ser removida; e uma etapa de host sem teste de interface (sem pasta de saída) continua como hoje.

## Dá para entender

Dá para entender como está escrita: o que acontece hoje, o que deveria acontecer e a aceitação estão separados, e os pontos do código onde o problema mora estão nomeados. Só foi lida, junto com o código que ela cita; nada foi reproduzido nem exercitado, porque esta etapa é de leitura.

## O que foi conferido no código (leitura, não execução)

- As ferramentas de comprovação só são oferecidas quando a sessão da etapa tem uma pasta de etapa: a condição é `session?.stageDir && d.keepEvidence` no executor, e é a mesma que monta as ferramentas e a que as desliga no esquema e no prompt. Confere.
- A sessão de host não devolve `stageDir`. A sua pasta de saída é uma pasta temporária criada por ela (`coxia-host-*`), diferente da pasta de etapa que uma sandbox cria. Confere.
- O fecho da sessão de host remove a pasta temporária inteira (`rmSync(outDir)`), depois de encerrar os processos da etapa. Confere: toda captura que ficou só ali some. Confere também o "No evidence in this stage" da descrição, que é o texto da tela quando a etapa não guardou nada.
- O texto que a etapa recebe fala da pasta de saída como `/coxia/out` fixo, e a descrição da ferramenta de comprovação diz que o caminho deve ser dado como o agente o vê "dentro da sua sandbox". Confere com a descrição de que o prompt nunca mencionou `SaveEvidence` para o host.
- O tratamento da #142 existe na versão atual da cópia: o que o agente abriu com a ferramenta de imagem e não guardou é guardado como comprovação no fecho, com uma linha na conversa para o que não pôde ser guardado, e isso roda logo antes de `session?.close()`. Ler a imagem da pasta de saída do host passa pelo caminho da sessão (o agente não é enviado às ferramentas de comprovação quando a sessão tem pasta de saída), então hoje o gancho que marca "olhado" não é alimentado no modo host: o fecho não tem nada a guardar. Confere com o que a issue diz.
- O caminho de recusa de um arquivo fora da pasta de saída já existe e já fala as duas formas de caminho (`/coxia/out/...` e o caminho real), mas a pasta raiz é sempre `<pasta de etapa>/out`, que o host não tem. Por isso o item 1 pede que a pasta de saída do host seja exposta como raiz da leitura. Confere.
- Os testes que existem hoje cobrem a recusa de caminho na pasta de etapa (um arquivo de teste do assunto), a leitura de imagem da pasta do host pela sessão e a sessão de host com processos reais. O que a aceitação pede e não existe: guardar comprovação a partir da pasta do host, a recusa de um caminho fora dela pelas ferramentas de comprovação, e a guarda do fecho no host. Confere com a aceitação, que pede testes que ainda não existem.

## O que falta

Nada falta a quem abriu. A issue descreve o que viu numa execução real, aponta onde no código o problema mora, e define a aceitação item por item, incluindo qual é o comportamento de hoje para uma etapa de host sem teste de interface.

O que fica em aberto é decisão de desenho, não informação do repórter:

- Como disponibilizar a pasta de saída do host para as ferramentas de comprovação — reaproveitar a pasta da etapa que a sandbox já usa, ou ligar as ferramentas à pasta que o host cria. As duas cabem, e a primeira reúne as duas no mesmo caminho que a #142 já toca. A resolução é do refino ou do plano, não desta etapa.
- O que faz uma etapa de host "testar uma interface" quando a pessoa não ligou navegadores nem tela virtual: hoje a pasta de saída do host só nasce nesse caso, e se uma pasta de saída sem navegador nem tela já é "testar uma interface" muda o prompt de uma etapa que hoje não a tem. A issue fixa o resultado ("uma etapa de host sem teste de interface, sem pasta de saída, continua como hoje"), não o critério.

## Issues parecidas ou relacionadas

- #142 — a mesma perda para uma etapa com sandbox, e a origem do tratamento que o item 2 manda estender ao host. A #143 declara que a #142 a deixa de fora, e pede para a #143 começar depois da #142: não é duplicata, é o mesmo problema em outro modo de execução, com um pedaço que a #142 entrega de propósito só no sandbox.
- #121 — é onde nasceram as ferramentas de comprovação, a leitura da pasta de saída pela ferramenta de imagem e as regras de caminho, de tipo e de tamanho que a aceitação desta issue manda valer iguais no host. Relação de dependência do que já existe, não de duplicata.
- #120 — a base de anexos de uma mensagem, pré-requisito declarado da #121; relação indireta, pela mesma vizinhança de comprovação.
- Nenhuma outra pasta de ciclo desta cópia trata do mesmo pedido. A busca foi feita no código citado e nas pastas de ciclo registradas; não foi feita busca além disso.

## Sugestão de prioridade

Sugiro a prioridade mais alta dos níveis configurados, que é o que a issue já traz: é comportamento errado em uso real, e o que ele atinge é uma etapa que termina sem nenhuma comprovação quando o agente foi configurado para rodar no computador. O custo é contido e a entrega se apoia no que a #142 já acrescenta. A prioridade final é do refinamento do produto.

## O que esta triagem não fez

Não reproduziu nem exercitou nada; não propôs solução nem decidiu prioridade. Tudo o que está dito como existente foi lido em arquivo nesta cópia de trabalho; o que não foi lido está marcado como não verificado. A execução real citada pela issue não foi refeita nem conferida, e o comportamento de uma etapa de host que roda de novo sobre uma comprovação já guardada também não foi lido: fica como não verificado.

A nota de lançamento é material de quem mexe no código: a entrada da versão que a issue pede para o usuário entra no arquivo de mudanças do repositório na etapa que implementa, ou no fecho do ciclo, e por isso não é um documento desta etapa.
