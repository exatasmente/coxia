# Triagem: despertar a persona por um agendador do próprio app

## Tipo
Pedido de funcionalidade (não é bug do app: os agendamentos que morrem com a sessão são uma limitação das ferramentas de agendamento da sessão do Claude, não de código do Coxia).

## Dá para entender?
Sim, como está escrita. Conferido **só por leitura** (issue, comentário de refinamento e código); nada foi executado e o sintoma observado (job criado que não dispara, lista vazia) **não foi reproduzido**.

## Decisão da pessoa (resposta à pergunta da triagem)
- Tanto a **persona** quanto o **usuário** podem gerenciar (criar, listar, alterar, remover) os agendamentos.
- **Quando o app iniciar, ele pergunta** se o agendador deve ser executado (o agendador não liga sozinho sem essa confirmação).
- Ainda não dito: o que fazer com um disparo perdido com o app fechado. A resposta sugere que a pergunta de partida cobre isso (o usuário decide ao abrir); fica como ponto a confirmar na especificação, não bloqueia.

## O que a leitura do código mostra (hoje)
- Já existe um agendador do app, `src/main/scheduler.ts`: um relógio de 60 s que roda `Job`s registrados em memória (`registerJob`, interface `Job` em `src/main/module.ts`: nome, intervalo em minutos, só em horário de trabalho, `run()`), mais avisos de pré-daily e retro e a checagem de status. Ele **não inicia turno de persona** e **não guarda definições de agendamento em disco**: os jobs são registrados pelo código a cada partida; só `status.json` guarda marcas (último check, avisos do dia).
- Um turno de persona começa a partir de uma mensagem numa conversa: `answerMentions` em `src/main/mentions/answer.ts`; a sessão de resposta (`src/main/persona/session.ts`, `createSession`) tem um campo `door` descrito como "`window` ou `paired`; aberto a mais (um agendamento)". O código já prevê uma porta de agendamento, mas ela não existe.
- O motor aceita `resume` por id de sessão (`src/main/engine/contract.ts`; o motor aberto guarda transcrições JSONL que sobrevivem a reinício, `src/main/engine/open/session.ts`). Não verificado se o motor do Claude reaproveita sessão entre turnos.
- Resposta provisória à pergunta do refinamento ("o app pode abrir um turno de persona sem sessão viva?"): pelo que foi lido, o turno é do app, não depende de sessão preexistente. **Não verificado** de ponta a ponta.
- #274 (#262): conforme o comentário de refinamento, só traz o fallback de orçamento para a CLI; não foi lido por esta etapa e não cobre a issue. Colisão de schema 29: não verificada.

## O que falta
Nada que só quem abriu a issue possa dizer. Para a especificação (não bloqueante): formato da recorrência (intervalo, hora do dia/dias úteis), forma do gerenciamento pela persona (ferramenta da persona) e pelo usuário (tela/configuração), tratamento de disparo perdido, e em qual conversa o resultado aparece.

## Relacionadas
- #262 / PR #274: sessões e orçamento da CLI do Claude; relacionada, não cobre esta.
- #248 (ferramentas da persona, origem da `door`) e #247 (conversa da persona): onde o turno e a porta nascem.
- #268 / #269 (política de autonomia e auditoria de passos autônomos): relevantes porque disparos agendados são passos autônomos; relação não verificada em detalhe.
- Nenhuma duplicada encontrada (busca por leitura em `docs/`; a busca nas issues do host não foi feita).

## Sugestões (não decisões)
- Prioridade: sugestão `priority:medium` — melhora a autonomia da persona, mas há alternativa manual hoje; cabe ao refinamento do produto decidir.
- Squad: plataforma (agendador, motor, runner e persistência); a tela de agendamentos e a pergunta na partida tocam experiência.
- Reaproveitar o `scheduler.ts` existente em vez de criar um segundo relógio, persistir as definições em disco e acrescentar a porta de agendamento ao turno da persona.

## Não verificado
O sintoma original, o resto do diff do #274, o reaproveitamento de sessão do motor do Claude, e qualquer comportamento em execução.
