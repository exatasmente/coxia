# Triagem: uma sessão do Claude Code por conversa com a persona

## Tipo

Pedido de funcionalidade (melhoria). Não é bug, pergunta nem duplicada. É a parte "conversa própria da persona" que a #262 deixou de fora ao separar as entregas 1 e 2.

## Dá para entender?

Sim, como está escrita. O problema, o comportamento esperado, os limites e os três critérios de aceite são claros e verificáveis. Conferido **só por leitura** da issue e do código; nada foi executado nem reproduzido (não verificado: que hoje sejam abertas três sessões para três mensagens).

## O que o código mostra (leitura, não executado)

- A chamada ao SDK do Claude Code aceita `resume` por chamada (`src/main/engine/contract.ts`, em torno das linhas 255-302), e `src/main/agents.ts` já a usa: cerimônias (`deepAsk`, `deepOptions`, respostas `reply` guardam e reaproveitam `sessionId`) e a retomada de uma chamada que acabou os turnos (linha ~1187).
- Ou seja, o mecanismo existe; falta aplicá-lo à conversa da persona (`src/main/persona/*`, resposta em `src/main/mentions/answer.ts`) e guardar o id da sessão por conversa.
- O disparo agendado (#275) passa por `src/main/schedules/fire.ts` → `wake(...)` → persona; a parada fica em `src/main/persona/stop.ts`. Não confirmei se esses caminhos chegam à mesma chamada de resposta (não verificado).
- Não achei, em `src/main`, tratamento de "sessão inválida → abrir nova" para a persona; para as cerimônias não verifiquei.

## Pontos que o plano precisa decidir (não são perguntas para quem abriu)

- Onde guardar o id da sessão (por conversa/thread, e se sobrevive a reinício do app).
- Como detectar "não dá para retomar" (expirada, removida, em uso por outro processo, provedor trocado) e cair em sessão nova sem erro visível na conversa.
- Limite de contexto: uma sessão longa cresce; a issue não fala de limite.
- Motor `open`: já tem transcrição própria com `resume` (`src/main/engine/open/session.ts`); a issue diz manter como está, salvo equivalente barato.
- Testes com SDK falso cobrindo retomar, cair para nova e o acordar agendado; nada de `~/.claude` em testes.

## O que falta de quem abriu

Nada que bloqueie. Nenhuma pergunta.

## Relacionadas

- #262 (origem; entregas 1 e 2 cobrem a tela de sessões; fecha-se ao lado desta).
- #275 (agendamentos que acordam a persona; o acordar deve seguir a mesma regra).

Nenhuma duplicata encontrada (busca limitada à memória do workspace e a documentos de ciclos; o tracker não foi consultado diretamente).

## Sugestões (não decisões)

- Squad: plataforma (motores, runner, fronteira de segurança); a persona está em `src/main/persona`, mas a mudança é de runtime.
- Prioridade sugerida: priority:medium. Reduz acúmulo de sessões e custo de reconstruir contexto, mas não quebra nada hoje.
