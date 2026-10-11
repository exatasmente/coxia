# Fallback para o Claude Code já logado quando o orçamento acaba

Escopo deste ciclo: **entrega 4** da issue guarda-chuva. As entregas 1+2 (sessões e interação), 3 (canal autônomo) e 5 (Remote Control) ganham ciclos próprios, nessa ordem sugerida, e ficam fora daqui.

## O que muda para quem usa

- Um provedor Anthropic salvo sem chave passa a aparecer como **"CLI do Claude Code já logado"**: na configuração, no assistente de configuração e na documentação. Hoje ele funciona, mas é tratado como se faltasse uma chave.
- Quem usa pode marcar quais papéis ou agentes aceitam cair nesse modo. Quando o provedor desses recusa por orçamento, a chamada é refeita uma vez no CLI logado, em vez de a execução ficar parada esperando.
- Quem não marcou nada vê o comportamento de hoje: a execução espera.
- Se o CLI logado atingir o próprio limite de uso, a execução espera até o horário de renovação e mostra esse horário.
- Chamadas feitas por esse modo aparecem como uso de assinatura, nunca como custo de API.
- O app continua sem oferecer login e sem ler, guardar ou repassar credenciais.
- Só no desktop; desligado por padrão.

## Regras

1. O recurso é opcional e vem desligado. Desligado, nenhuma marcação de fallback existe e um provedor Anthropic sem chave funciona exatamente como hoje.
2. Um provedor Anthropic sem chave é nomeado "CLI do Claude Code já logado" na configuração, no assistente e no aviso de validação. O aviso deixa de dizer que falta chave e passa a dizer que será usado o login do CLI da máquina. Nunca vira erro de validação.
3. A pessoa escolhe quais papéis ou agentes podem usar o fallback. Nenhum vem marcado.
4. Só quando o provedor de um papel marcado recusa por orçamento a chamada é refeita, uma única vez, no CLI logado. Qualquer outra falha (ocupado, limite de turnos, erro comum) segue como hoje.
5. Um papel não marcado, ou sem CLI logado disponível, espera como hoje.
6. O limite de uso do próprio fallback é lido do aviso estruturado de limite que o SDK emite (janelas de cinco horas e de sete dias, com horário de renovação), não do texto da mensagem. Ao atingi-lo, a execução espera até o horário de renovação e informa-o.
7. Chamadas pelo fallback são registradas e exibidas como uso de assinatura, separado do custo de API.
8. O app nunca abre os arquivos de credencial do Claude Code (credenciais, chaves de sessão, chave do daemon), nem os lê, guarda ou repassa. Testes e fixtures não usam nada de `~/.claude`.
9. Uma pasta de trabalho de teste (`test: true`) recusa o fallback.
10. A configuração do fallback não é acessível ao celular pareado e a persona não a altera.
11. A regra "login de assinatura do claude.ai nunca é oferecido" é reescrita no código-fonte do tipo e em `docs/configuration.md`: o app **não oferece** login, mas **usa** o login do Claude Code que a pessoa já fez, quando o provedor Anthropic está sem chave. A documentação diz o que o app toca (o CLI instalado, seu próprio login) e o que não toca (arquivos de credencial).

## Fora do escopo

- Telas de sessões do Claude Code, envio de mensagem, permissões, parar e iniciar sessões (entregas 1 e 2).
- Canal para agentes entregarem tarefas a sessões do Claude Code (entrega 3).
- Remote Control (entrega 5).
- Oferecer ou executar login; qualquer leitura de credenciais.
- Fallback para provedores que não sejam o Anthropic sem chave.
- Novos canais, eventos ou ferramentas da persona; escrita pelo servidor MCP de estado.
- Conformidade com os termos da Anthropic para uso de assinatura por apps de terceiros: não verificada.

## Critérios de aceite

1. Com o recurso desligado e um provedor Anthropic sem chave: a execução funciona como antes; nenhuma opção de fallback aparece.
2. Salvar um provedor Anthropic sem chave: a configuração e o assistente mostram "CLI do Claude Code já logado"; a validação mostra um aviso informativo (não erro) que não fala em chave faltando.
3. Marcar um papel para fallback e simular recusa por orçamento do provedor dele: a etapa termina no CLI logado, com uma única nova tentativa.
4. Em um papel não marcado, a mesma recusa deixa a execução esperando, como hoje.
5. Simular o aviso de limite do fallback atingido: a execução espera, mostrando o horário de renovação.
6. Uma chamada feita pelo fallback aparece como uso de assinatura e soma zero ao custo de API.
7. Uma pasta de trabalho com `test: true`: o fallback não é acionado.
8. Celular pareado: recusa nos canais da configuração do fallback.
9. A documentação de configuração descreve o modo e o que o app toca e não toca; a frase antiga de que o login nunca é oferecido não existe mais.
10. Nenhum teste lê `~/.claude`; só dublês.

## Perguntas em aberto

- Onde exatamente se marca o fallback: por papel, por agente, ou ambos? (Não bloqueia; o plano propõe, a pessoa aprova.)
- Se o CLI não estiver instalado ou não estiver logado ao acionar o fallback, a execução espera como hoje e avisa o motivo? Proposta: sim.
- O SDK emite o aviso estruturado de limite e informa a conta de assinatura como a issue afirma? Não verificado; o plano deve conferir antes de construir.
- A tabela de portas da persona citada na issue não foi achada no código; só importa para as entregas 1 a 3 e 5.
