# Agendas com ação direta, regra de disparo perdido e rotinas do sistema reunidas

## O que muda para quem usa

Hoje toda agenda acorda a persona com um texto, e a persona decide o que fazer com um modelo. Passa a ser possível escolher, por agenda, uma **ação direta**, que faz a coisa pedida sem consultar um modelo: mais barata, previsível e que ainda dispara com o provedor da persona fora do ar.

Também passa a ser possível dizer, por agenda, o que acontece com um horário perdido (app fechado ou agendador desligado): **rodar uma vez ao abrir** (como é hoje) ou **pular**. E a tela de Agendas passa a mostrar, ao lado das agendas da pessoa, as rotinas do próprio app (lembrete pré-daily, dia da retro, janela de trabalho), só para ler, com um caminho para onde se ajustam. Todo disparo aparece também na árvore de atividade.

## Regras

1. Uma agenda tem uma ação, uma entre: **iniciar uma execução** de um modelo de ciclo para uma issue ou cartão; **rodar uma cerimônia** disponível no espaço de trabalho; **chamar um agente** do time com um texto, respondendo numa conversa escolhida; **acordar a persona** com um texto (o comportamento de hoje).
2. As três primeiras ações não chamam modelo para decidir o que fazer. Acordar a persona continua sendo um turno de modelo.
3. Uma ação direta passa pelas mesmas portas, pela mesma política de autonomia e pela mesma auditoria da mesma ação feita pela pessoa ou pela persona. A agenda não ganha permissão própria: o que a pessoa não poderia fazer à mão, a agenda não faz.
4. O resultado de um disparo, ou a falha, é dito na conversa da agenda. Uma falha não apaga nem pausa a agenda: ela segue para o próximo horário.
5. Uma ação direta que precisa de aprovação espera por ela, como a mesma ação feita à mão. A aprovação pendente não expira sozinha nem é aprovada pela agenda. Enquanto ela espera, o disparo aparece na conversa como aguardando aprovação, e o próximo horário da mesma agenda não abre uma segunda ação igual enquanto a primeira não terminar (mesma ideia do "um disparo por vez" de hoje).
6. Cada agenda tem uma regra de disparo perdido: **rodar uma vez ao abrir** (padrão) ou **pular**. Rodar uma vez dispara uma única vez, marcado como atrasado, por mais horários que tenham passado. Pular não dispara e segue para o próximo horário futuro.
7. Um disparo pulado deixa uma linha na conversa da agenda dizendo que foi pulado e qual horário foi perdido.
8. Agendas já existentes, sem ação nem regra, passam a valer como **acordar a persona** e **rodar uma vez ao abrir**, sem mudança de comportamento e sem a pessoa precisar editar nada.
9. A pessoa e a persona criam e mudam a ação e a regra de perda pelos mesmos caminhos que já criam e mudam agendas (tela e conversa). Um turno vindo de uma agenda continua sem poder criar nem mudar agendas.
10. As rotinas do sistema (lembrete pré-daily, dia da retro, janela de trabalho) aparecem na tela de Agendas, em área separada, só para leitura, com o horário ou a regra atual e um link para onde são configuradas. Os ajustes de hoje e o comportamento deles não mudam. Elas não viram agendas editáveis nesta entrega.
11. Todo disparo, de ação direta ou da persona, aparece na árvore de atividade com a agenda de origem, a ação e o resultado (feito, falhou, pulado, aguardando aprovação). Antes de construir, confere-se o que a árvore já mostra de um disparo; só o que falta é acrescentado.
12. Os textos novos existem nos dois idiomas do app e usam as cores do tema.

## Fora do escopo

- Expressões cron livres e fusos que não sejam o do computador.
- Gatilhos por evento (por exemplo, "quando um cartão muda de etapa").
- Disparar com o app fechado ou em outra máquina.
- Tornar editáveis as rotinas do sistema, ou migrá-las para agendas.
- Expiração automática de aprovação pendente.
- Dar à agenda permissões que a pessoa não tenha.

## Critérios de aceite

1. Criar uma agenda que inicia uma execução, outra que roda uma cerimônia e outra que chama um agente, cada uma para daqui a poucos minutos. No horário, cada uma faz sua ação sem nenhum turno da persona, deixa uma linha na auditoria e uma linha na conversa da agenda.
2. Com a política de autonomia exigindo aprovação para a ação, o disparo fica aguardando; aprovar na tela faz a ação acontecer; recusar a encerra com a falha dita na conversa. Em ambos os casos o resultado é o mesmo de fazer a ação à mão.
3. Com o provedor da persona indisponível, uma agenda de ação direta ainda dispara.
4. Uma ação que falha (por exemplo, cerimônia que deixou de existir) diz a falha na conversa e a agenda continua ativa para o próximo horário.
5. Agenda com "pular": fechar o app, deixar passar o horário, abrir: nada dispara, a conversa mostra a linha de pulado, o próximo horário futuro aparece na tela.
6. Agenda com "rodar uma vez": mesmo cenário dispara uma única vez, marcado como atrasado, mesmo se vários horários passaram.
7. Uma agenda criada antes desta entrega, ao abrir o app, aparece como "acordar a persona" e "rodar uma vez" e se comporta como antes.
8. A tela de Agendas lista as rotinas do sistema (pré-daily, retro, janela de trabalho) em área só leitura, sem botões de editar, pausar ou apagar, cada uma com um link que leva à configuração correspondente. Mudar a configuração lá muda o que a lista mostra.
9. Cada disparo dos critérios 1 a 6 aparece na árvore de atividade, incluindo os da persona.
10. Pela conversa, a persona cria uma agenda de ação direta e uma com "pular"; a tela mostra o mesmo. Um turno disparado por agenda não consegue criar agenda.
11. Os testes usam relógio falso e falsos para o modelo e as portas; as verificações padrão do projeto passam.

## Perguntas em aberto (nenhuma bloqueia; cada uma tem o padrão acima)

- Rotinas do sistema editáveis como agendas: a spec adota somente leitura agora; mudar isso é decisão de produto para uma entrega futura.
- Aprovação pendente sem ninguém na tela: a spec adota espera sem prazo, como à mão; se a pessoa quiser prazo de expiração, é uma decisão nova.
- Identidade na auditoria de uma ação direta: a spec exige que a linha diga que veio de uma agenda (porta `schedule`) e preserve a mesma política de autonomia; o formato exato é de projeto.
