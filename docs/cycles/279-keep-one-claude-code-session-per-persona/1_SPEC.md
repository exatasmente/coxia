# Uma conversa com a persona, uma sessão do Claude Code

## O que muda para quem usa

Hoje, ao conversar com a persona por um provedor `anthropic` sem chave (o Claude Code já logado na máquina), cada mensagem abre uma sessão nova do Claude Code. Uma conversa de dez mensagens deixa dez sessões na máquina, e a persona reconstrói o contexto a partir da conversa a cada resposta.

Depois da mudança, uma conversa com a persona usa uma única sessão: a resposta seguinte continua a sessão da resposta anterior, enquanto essa sessão ainda servir. Quando não servir, a conversa segue como hoje, com uma sessão nova, sem erro e sem pergunta a quem conversa.

## Regras

1. Uma conversa com a persona mantém uma sessão do motor do Claude Code. Cada mensagem seguinte continua a sessão da resposta anterior, em vez de abrir outra.
2. Conversas diferentes não compartilham sessão: cada conversa tem a sua.
3. Quando a sessão não puder ser continuada (expirou, foi removida, outro processo a mantém, o provedor mudou), a resposta abre uma sessão nova, a conversa continua e nada é mostrado a quem conversa nem escrito na conversa como erro. A sessão nova passa a ser a da conversa daí em diante.
4. O acordar agendado da persona (agendamentos) segue a mesma regra: continua a sessão da conversa em que acorda, ou abre uma nova quando não for possível.
5. A resposta que a persona dá depois de uma parada (e a retomada de mensagens seguradas pela parada) segue a mesma regra.
6. O motor `open` mantém o comportamento de hoje, a não ser que o plano ache um equivalente barato.
7. Fica igual: as ferramentas da persona, a porta, a parada e o registro de auditoria. Retomar a sessão não pode abrir tarefa, permissão ou ato novo.
8. O que a persona sabe da conversa não pode ficar pior: uma resposta numa sessão nova ainda recebe o contexto da conversa, como hoje.
9. Nada de `~/.claude` (ids de sessão, transcrições) entra em testes ou fixtures.

## Fora do escopo

- A tela de sessões e as demais entregas da #262.
- Sessões de cerimônias e de etapas, que já retomam sessão por conta própria.
- Outras conversas que não são a da persona (agentes chamados, canais), salvo se o plano mostrar que o mesmo caminho as cobre sem custo.
- Limpar ou apagar sessões antigas já existentes na máquina.
- Qualquer limite novo de tamanho de contexto (ver perguntas em aberto).

## Critérios de aceite

1. Com o provedor `anthropic` sem chave, enviar três mensagens seguidas à persona na mesma conversa resulta em uma sessão do Claude Code, não três. Confere-se contando as sessões criadas na máquina para essa conversa.
2. Remover essa sessão e enviar a mensagem seguinte: a persona responde normalmente, uma sessão nova é aberta e a conversa não mostra erro.
3. Trocar o provedor da persona no meio da conversa e enviar uma mensagem: a resposta chega, sem erro, em sessão nova.
4. Um agendamento que acorda a persona numa conversa com sessão válida continua essa sessão; sem sessão válida, abre uma nova e a conversa não mostra erro.
5. Parar a persona, retomar e deixar a resposta seguida acontecer: ela segue a regra 1 e 3.
6. Com o motor `open`, o comportamento é o de hoje (verificável por testes existentes sem alteração).
7. Testes com um SDK falso cobrem: continuar a sessão, cair para sessão nova quando a continuação falha, e o acordar agendado. Nenhum teste ou fixture contém dado de `~/.claude`.
8. Ferramentas, porta, parada e auditoria da persona seguem passando nos testes que já existem.

## Perguntas em aberto

Nenhuma bloqueia o refinamento; ficam para o plano:

- Onde guardar o id da sessão por conversa e se ele sobrevive ao reinício do app. Sugestão do produto: sobreviver, para uma conversa antiga continuar a mesma sessão.
- Como reconhecer "não dá para continuar" e cair em sessão nova sem mostrar erro.
- Limite de contexto: uma sessão que dura muito cresce. A issue não pede limite; o plano diz se é preciso um.
