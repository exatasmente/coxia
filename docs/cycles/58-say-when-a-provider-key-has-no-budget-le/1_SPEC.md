# Uma execução que bate no orçamento esgotado da chave espera e diz por quê, em vez de "terminou com sucesso"

## O que se pede

Quando o provedor recusa uma chamada porque o orçamento da chave acabou, a pessoa passa a ver
o motivo. Hoje a execução termina com uma mensagem genérica que não aponta a causa. O pedido,
nas palavras da issue:

> **Keep the provider's error.** When a call ends with no structured output, the failure carries the error text the SDK or the server returned, masked the same way other outside text is. Never only the subtype.
>
> **Say "the key has no budget left" in plain words.** A quota or limit refusal (HTTP 402, a 403 whose body says limit or credit, a 429 that does not clear) is a reason of its own. The message names the provider and says the budget of its key ran out.
>
> **Do not spend retries on it.** A run that hits it waits, with that reason, instead of failing. The app does not start new stages or mentions on that provider until a call goes through again. The scheduler's sweep tries one call to find out, not one per run.
>
> **The same on the open engine,** for the same HTTP answers.

E a nota da issue:

> The SDK adds "Failed to authenticate" to the front of the gateway's message, so matching only on "authenticate" would send the person to fix a key that is fine.

## O que muda para quem usa

- Quando uma chamada termina sem resposta estruturada, a falha que aparece passa a trazer o
  texto que o provedor devolveu, e não só um subtipo. A pessoa lê o erro real da recusa.
- Quando o provedor recusa por orçamento da chave (HTTP 402; um 403 cujo corpo fala de limite
  ou crédito; um 429 que não passa), a mensagem diz, em palavras simples, que o orçamento da
  chave daquele provedor acabou, e **nomeia o provedor**. O texto de fora continua mascarado
  como o resto do texto que vem de fora.
- A execução que bate nisso **não falha**: ela fica esperando, com esse motivo à mostra, em
  vez de gastar tentativa. O retry deixa de ser oferecido para uma recusa de orçamento.
- Enquanto aquele provedor não voltar a responder, o app não começa novas etapas nem chamadas
  de `@agente` nele. A espera não fica presa a uma execução: quando o provedor volta, todas
  as execuções que esperavam por ele seguem.
- O escalonador descobre que o provedor voltou com **uma** chamada de sondagem, não uma por
  execução. Uma vez que a sondagem passa, as execuções que esperavam são retomadas.
- O mesmo vale no motor aberto, para as mesmas respostas HTTP.

## Regras

1. **Guardar o erro do provedor.** Quando uma chamada termina sem saída estruturada, a falha
   carrega o texto de erro que o SDK ou o servidor devolveu, e nunca apenas o subtipo. O texto
   passa pelo mesmo mascaramento do resto do texto de fora antes de aparecer.
2. **Recusa de orçamento é um motivo próprio.** As respostas que contam como recusa de orçamento
   são: HTTP 402; um 403 cujo corpo fala de limite ou crédito; um 429 que não passa (não
   resolve com nova tentativa). O reconhecimento olha o corpo da resposta, não só o status, para
   o caso do 403 — e não casa só pela palavra "authenticate", porque o SDK prefixa o texto com
   "Failed to authenticate".
3. **A mensagem nomeia o provedor.** O texto diz que o orçamento da chave daquele provedor
   acabou e diz qual provedor. Nos dois motores.
4. **A execução espera, não falha.** Uma execução que bate na recusa de orçamento entra em um
   estado de espera com esse motivo, em vez de virar falha. O retry não é oferecido para esse
   caso. Ela sai da espera quando uma chamada ao provedor volta a passar.
5. **Nada novo é começado naquele provedor.** Enquanto o provedor estiver sem orçamento, o app
   não inicia novas etapas nem chamadas de menção (`@agente`) nele.
6. **A sondagem é uma só.** O escalonador (a passada de 5 minutos) faz uma chamada de sondagem
   para saber se o provedor voltou; a resposta dessa sondagem libera todas as execuções que
   esperavam, e não uma chamada por execução.
7. **Mascaramento preservado.** Todo texto de erro que vem de fora (SDK ou servidor) passa pelo
   mesmo mascaramento já aplicado ao texto de fora. Nenhuma credencial, token ou contato aparece.
8. **Os dois motores.** O comportamento vale para o motor Claude SDK e para o motor aberto, para
   as mesmas respostas HTTP.

## Fora do escopo

- Corrigir a chave, aumentar o orçamento ou trocar de provedor: a mudança só reporta e segura;
  quem resolve o orçamento é a pessoa, no provedor.
- Descobrir sozinho o valor exato do orçamento ou quanto falta: a mensagem usa o que a recusa
  traz, não inventa números.
- Um teto de espera curto e automático para sempre: a espera dura até uma chamada passar; não
  há prazo que faça a execução voltar a tentar sozinha depois de um tempo fixo.
- Outras classes de erro (401, 404, contexto, ferramentas): continuam como estão.
- Tela nova: o comportamento aparece na conversa da execução e nas mensagens de erro que já
  existem; não há tela nova para isso.
- Redistribuir o SDK: nada de empacotar o Claude Agent SDK.

## Critérios de aceite

1. Uma chamada que termina sem saída estruturada faz a falha trazer o texto que o provedor
   devolveu, e não apenas o subtipo — conferível no texto do erro da execução.
2. Uma recusa de orçamento por HTTP 402, por um 403 cujo corpo fala de limite ou crédito, e por
   um 429 que não passa é reconhecida como recusa de orçamento, nos dois motores.
3. A mensagem de recusa de orçamento nomeia o provedor e diz, em palavras simples, que o
   orçamento da chave acabou.
4. O texto de erro que veio de fora aparece mascarado, como o resto do texto de fora.
5. Uma execução que bate na recusa de orçamento fica esperando com esse motivo, e não falha; o
   retry não é oferecido para ela.
6. Enquanto o provedor estiver sem orçamento, novas etapas e menções não começam nele.
7. Quando uma chamada de sondagem única passa, as execuções que esperavam por aquele provedor
   são retomadas, sem uma chamada por execução.
8. O texto relatado na issue (`403 Key limit exceeded (monthly limit)`, com o prefixo "Failed to
   authenticate") é reconhecido como recusa de orçamento, e não manda a pessoa consertar uma
   chave que está boa.

## Verificação

| Critério | Como conferir | Situação |
|---|---|---|
| 1 | Teste automatizado do motor Claude SDK: resultado sem saída estruturada cujo texto de assistente traz o erro do provedor; o erro da falha contém o texto. | Não verificado nesta etapa |
| 2 | Teste automatizado do mapeamento de erro do motor aberto: 402, 403 com corpo de limite/crédito e 429 que não passa caem na recusa de orçamento. | Não verificado nesta etapa |
| 3 | Teste do catálogo nos dois idiomas: a mensagem de recusa de orçamento contém o nome do provedor. | Não verificado nesta etapa |
| 4 | Teste de mascaramento: um texto de erro com um formato de segredo sai mascarado. | Não verificado nesta etapa |
| 5 | Teste do runner: a falha por recusa de orçamento deixa a execução esperando com o motivo, e não `failed`. | Não verificado nesta etapa |
| 6 | Teste do runner: com o provedor sem orçamento, uma etapa nova e uma menção não começam. | Não verificado nesta etapa |
| 7 | Teste do escalonador: uma sondagem que passa libera as execuções que esperavam. | Não verificado nesta etapa |
| 8 | Teste com o texto exato da issue: reconhecido como recusa de orçamento. | Não verificado nesta etapa |

Os caminhos de código e o estado atual de cada comportamento foram conferidos por leitura
durante a triagem; nenhum foi exercitado em execução.

## Prioridade e marco

**Prioridade proposta:** uma prioridade alta (o nível mais alto dos que o workspace escreve no
host de código), a decidir pela pessoa entre os níveis configurados.

Motivo: é um bug que trava o ciclo inteiro de quem usa. A recusa de orçamento não atinge só a
execução que a encontrou: todas as execuções e cerimônias na mesma chave passam a falhar com o
mesmo texto genérico, sem apontar a causa. A pessoa fica sem saber que precisa mexer no
orçamento da chave, e cada tentativa nova gasta tempo e uma tentativa.

**Marco:** não se propõe marco. É uma correção no runtime (motores, provedores e escalonador do
runner), sem relação com um marco de produto; a pessoa decide se quer encaixá-la em algum.

## Perguntas em aberto

1. Qual nível de prioridade o host de código deve receber, entre os configurados, para este bug.
2. Se esta correção entra em algum marco, e qual.
