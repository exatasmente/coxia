# Falar com a persona: voz no chat e modo de voz

Nota de método: o comportamento de hoje vem da leitura da triagem; não foi reconferido nem executado nesta etapa. Nada abaixo está verificado em funcionamento.

## Comportamento de hoje

- O chat da persona não tem microfone, não fala as respostas e não tem modo de voz; o campo de texto só anexa e envia.
- Gravação, fala frase a frase e interrupção existem só nas cerimônias.
- A resposta chega aos poucos na tela, mas nada a fala enquanto chega.
- A persona não sabe que um pedido veio por voz; responde com markdown como sempre.
- Com a voz desligada, os controles de microfone simplesmente não aparecem, sem aviso.
- No celular pareado, gravar depende de conexão https; a falha aparece só como "microfone indisponível".

## O que muda para quem usa

**Voz no chat**
- Ao lado do campo de texto há um microfone: apertar-e-falar e um modo mãos livres.
- A persona responde em voz alta e o texto aparece à medida que é falado.
- Falar enquanto a persona fala a interrompe, e o novo pedido é ouvido.

**Modo de voz**
- Uma tela cheia só para conversar, sem pauta nem cerimônia. Abre por um botão ao lado do campo de texto e por um atalho; no celular pareado pode ser a entrada principal.
- Mostra um visual que reage ao áudio e o estado: ouvindo, pensando, falando. Legendas ligam e desligam. Há botões para silenciar o microfone e para encerrar.
- Mãos livres por padrão: continua ouvindo, respondendo e ouvindo até a pessoa encerrar.

## Regras

1. Um pedido falado é transcrito, executado e respondido em voz alta.
2. Falar durante a fala da persona a interrompe a qualquer momento, no chat e no modo de voz, e o novo pedido é ouvido.
3. A fala começa na primeira frase completa da resposta, sem esperar a resposta inteira; a frase seguinte fica pronta enquanto a atual toca.
4. Em turno vindo de voz, a persona responde curto e sem markdown, tabelas ou blocos de código; nada disso é lido em voz alta.
5. Uma ação longa é anunciada em uma frase ("abrindo o pull request, um momento") e o resultado é resumido, não lido por inteiro.
6. O que é dito e respondido vai para a mesma conversa do chat; ao sair do modo de voz, a troca inteira aparece lá, transcrita.
7. O modo de voz continua mãos livres até a pessoa encerrar.
8. Com a voz não instalada ou desligada, os controles de voz dizem isso e apontam para as configurações de voz; nada é baixado nem o microfone é aberto.
9. A voz funciona no computador e, onde o navegador permite gravar, no celular pareado. Se o celular não puder gravar (por exemplo, sem https), a mensagem diz o motivo e o que fazer, em vez de só "microfone indisponível". Instalar ou ligar a voz continua só no computador.
10. Todo texto novo existe nos dois idiomas (inglês e português do Brasil), com variante sem a palavra "call" onde couber.
11. **Proposta, a confirmar — "sim" falado:** confirmações que autorizam algo que muda o mundo fora da máquina (abrir pull request, publicar, comentar na tracker etc.) continuam por botão na tela; por voz a persona avisa que aguarda a confirmação na tela. Um "sim" falado vale só para escolhas sem efeito externo.
12. **Proposta, a confirmar — latência:** a meta é a primeira palavra falada em até 3 segundos após o fim da fala da pessoa, com resposta curta e voz local. A etapa de teste mede e registra o valor real; passar da meta é registrado como débito, não bloqueia a entrega.
13. **Proposta, a confirmar — tela bloqueada ou foco perdido:** no computador, o modo de voz segue ouvindo com a janela sem foco, e o microfone aberto fica visível. No celular, ao bloquear a tela ou trocar de aba, o modo de voz pausa (microfone fechado, fala interrompida) e mostra "pausado" com um toque para retomar; nunca grava às escondidas.
14. O texto falado pelo motor Edge vai para a Microsoft; a tela de configurações de voz deixa isso dito de forma clara, agora que respostas da persona também são faladas.

## Fora do escopo

- Cerimônias de voz (continuam como são, apenas passam a usar o componente compartilhado sem mudar de comportamento).
- Palavra de ativação ("ei, persona") e escuta com o app fechado.
- Instalar ou ligar a voz pelo celular.
- Novos idiomas ou novas vozes além dos que a voz já oferece.
- Autorização por voz de ações com efeito externo (ver regra 11).

## Entrega sugerida em fatias

1. Áudio compartilhado extraído, sem mudar as cerimônias.
2. Voz no chat: microfone, fala por frase durante a resposta, prompt de turno de voz, aviso de voz desligada.
3. Modo de voz em tela cheia, atalho e mesma conversa.
4. Celular: mensagens de falha de gravação, pausa ao bloquear a tela, entrada principal.

## Critérios de aceite

1. Com voz instalada, apertar o microfone no chat, dizer um pedido e soltar: o pedido aparece transcrito no chat, é executado e a resposta é falada.
2. Durante a fala da persona, falar: a fala para em seguida e o novo pedido é ouvido e respondido.
3. Abrir o modo de voz pelo botão e pelo atalho: a tela cheia mostra ouvindo/pensando/falando conforme o que acontece; legendas ligam e desligam; silenciar o microfone impede que seja ouvido; encerrar volta ao chat.
4. No modo de voz, fazer duas perguntas seguidas sem tocar em nada: ambas são respondidas; depois de encerrar, as duas trocas aparecem no chat da persona.
5. Pedir algo que gera resposta longa: a voz começa antes de o texto terminar de aparecer.
6. Pedir por voz algo que normalmente gera lista, tabela ou código: a resposta falada é curta, sem símbolos de markdown lidos em voz alta.
7. Pedir por voz uma ação longa: a persona diz uma frase de aviso e depois resume o resultado.
8. Com a voz desligada ou não instalada: tocar no controle de voz mostra o aviso com caminho para as configurações; nenhum download começa e o microfone não abre.
9. Pedir por voz algo que exige confirmação com efeito externo: a confirmação aparece como botão e responder "sim" falado não a aprova.
10. No celular pareado com https: falar com a persona funciona; sem https: aparece mensagem que explica o motivo.
11. No celular, bloquear a tela no modo de voz: ao voltar, aparece "pausado" e um toque retoma.
12. A latência fim da fala → primeira palavra é medida e o valor registrado no teste.
13. As cerimônias de voz continuam funcionando como antes.
14. Textos novos aparecem corretamente em inglês e português.

## Perguntas em aberto

Nenhuma bloqueia o início. Dependem da pessoa confirmar as propostas 11, 12 e 13 (se não confirmar, valem como escritas) e, para a ordem das fatias, de a conversa da persona com texto ao vivo (#247) estar disponível.
