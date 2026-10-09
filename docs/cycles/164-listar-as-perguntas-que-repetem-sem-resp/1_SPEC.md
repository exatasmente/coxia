# Ver as perguntas que repetem sem resposta de um dia para o outro

## O que muda para quem usa

Hoje, os minutos de um dia mostram as perguntas que ficaram sem resposta naquela cerimônia — na tela e no documento do dia. Mas cada dia olha só para si: ninguém diz que a mesma pergunta já ficou sem resposta ontem, anteontem, há três dias. A pessoa descobre a repetição de memória, e o total cresce sem que ela veja o padrão.

Com esta mudança, os minutos do dia ganham uma seção nova, "Perguntas repetidas sem resposta", que cruza as perguntas sem resposta dos dias anteriores (dentro da janela dos últimos 7 dias com minutos) e lista as que já voltaram: de cada uma, a pergunta, o estágio a que se refere, em quais dias apareceu e quantas vezes. O texto das ocorrências não precisa ser idêntico — a repetição que interessa é a decisão recorrente, não a frase.

Assim, na hora de fechar o dia — e na retrospectiva — a pessoa vê com dados concretos quais assuntos o time vem deixando para trás, em vez de reler os minutos de cada dia.

## Regras

1. A repetição é contada entre dias diferentes: uma pergunta que ficou sem resposta em duas cerimônias do mesmo dia não conta como repetida (a diferença dentro do mesmo dia já é mostrada hoje).
2. Uma pergunta é repetida quando a mesma pergunta-forma — mesmo estágio e mesmo assunto, voltando a pedir decisão em outra execução, em outro dia — reaparece. Texto idêntico não é exigido.
3. A comparação usa as perguntas sem resposta que o app já guarda por dia nos minutos (a lista que hoje alimenta "Perguntas sem resposta" no documento do dia).
4. A lista fica nos minutos do dia (na tela e no documento gerado), como seção própria, depois das perguntas sem resposta do dia.
5. O dia que nunca teve pergunta repetida não mostra a seção (nem vazia).
6. Cada item da lista traz: o texto da pergunta mais recente, o estágio, as datas em que apareceu na janela e a contagem de dias.
7. A pergunta que se repetiu e foi respondida no dia corrente deixa de ser contada como sem resposta no dia corrente; ela ainda aparece no histórico do dia em que ficou sem resposta.
8. Os minutos antigos já escritos não são reescritos: a seção aparece nos dias fechados a partir da mudança (o documento do dia é regenerado quando o seu conteúdo muda).

## O que "endereçar as recorrentes" significa aqui

Esta change endereça as recorrentes tornando-as visíveis: a lista nomeia o padrão, com datas e contagem, exatamente o que faltava para decidir o que fazer (ajustar o roteiro, fechar a dependência, mudar a pergunta). A decisão de *agir* sobre um padrão específico fica com a pessoa — o app não muda roteiro nem cerimônia por conta própria, e isto fica fora do escopo (abaixo).

Quando uma pergunta é repetida, o app também o diz à cerimônia do dia: a rodada de perguntas do dia recebe a indicação de que a pergunta já ficou sem resposta em dias anteriores, para que o agente não trate como assunto novo.

## Fora do escopo

- Sugerir ou executar a ação de correção (ex.: reescrever o roteiro das cerimônias, mudar o prompt de triagem): o app só lista; a decisão é da pessoa.
- Comparações com texto idêntico como critério exclusivo, ou detecção por semântica de modelo: o pareamento é pelo estágio e pelo assunto da pergunta, sem chamada a modelo.
- Histórico ilimitado: a janela de comparação é fixa (últimos 7 dias com minutos) e não é configurável nesta change.
- Mudar como as perguntas sem resposta são coletadas ou guardadas hoje.

## Critérios de aceite

Cada critério diz o que fazer e o que se vê.

1. Fechar dois dias de cerimônia em que a mesma pergunta-forma (mesmo estágio, mesmo assunto, textos parecidos mas não idênticos) ficou sem resposta nos dois. Abrir os minutos do segundo dia: existe a seção de perguntas repetidas, e ela lista essa pergunta com as duas datas e a contagem "2 dias".
2. Fechar dois dias em que cada pergunta sem resposta de um dia não tem correspondente no outro. Abrir os minutos do segundo dia: a seção de perguntas repetidas não aparece.
3. Fechar o mesmo dia duas vezes com a mesma pergunta sem resposta nas duas cerimônias, sem dia anterior com ela. Abrir os minutos do dia: a pergunta aparece só nas perguntas sem resposta do dia; nada é contado como repetida.
4. Ter uma pergunta sem resposta em um dia anterior e respondida na ceremônia de hoje, no mesmo assunto e estágio. Abrir os minutos de hoje: a pergunta não entra na lista de repetidas sem resposta do dia de hoje (respondida não é sem resposta).
5. Consultar os minutos de um dia fechado antes da mudança: o documento do dia não mostra a seção nova (nada é reescrito para trás).
6. As strings novas da seção saem nos dois catálogos (inglês e português), e a seção aparece na tela dos minutos do dia e no documento gerado, com o mesmo conteúdo.

## Perguntas em aberto

(nenhuma que bloqueie: o onde listar — nos minutos do dia, tela e documento — e o alcance do "endereçar" — visibilidade e aviso à cerimônia — foram decididos nesta especificação; a janela de 7 dias é proposta, e quem revisa pode pedir outra.)
