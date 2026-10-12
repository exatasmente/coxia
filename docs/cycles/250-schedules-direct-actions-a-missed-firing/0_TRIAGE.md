# Triagem: ações diretas, regra de disparo perdido e agendas do sistema

## Tipo

Pedido de funcionalidade (extensão das agendas da #275). Não é bug, pergunta nem duplicada.

## Dá para entender?

Sim, como está escrita. Conferido **só por leitura** (issue e código); nada foi executado nem reproduzido.

O que a issue pede, em quatro partes:

1. **Ações diretas**: uma agenda inicia uma execução de ciclo, roda uma cerimônia, chama um agente do time ou acorda a persona, sem um turno de modelo para decidir. Passa pelas mesmas portas, política de autonomia e auditoria da pessoa ou da persona; o resultado ou a falha vai na conversa da agenda.
2. **Disparo perdido**: cada agenda escolhe entre rodar uma vez ao abrir o app (padrão, comportamento de hoje) ou pular para o próximo horário; o pulo é registrado na conversa.
3. **Agendas do sistema**: lembrete pré-daily, dia da retro e janela de trabalho aparecem na tela de Agendas, só leitura, com link para onde se configuram. Se viram editáveis fica para o refinamento.
4. **Atividade**: todo disparo aparece na árvore de atividade, não só na auditoria.

Critérios de aceite objetivos e testáveis (relógio falso, falsos para modelo e portas).

## Comportamento de hoje (lido)

- A agenda guarda persona, prompt, recorrência, só dias úteis, conversa, pausa; não há campo de ação nem de regra de perda (`src/shared/schedules.ts`).
- Todo disparo posta uma linha do app na conversa e acorda a persona pela porta `schedule` (`src/main/schedules/fire.ts`). Não há caminho sem turno de modelo.
- Disparo perdido: ao ligar o agendador, o que passou roda uma vez, marcado como atrasado (`isLate`, 2 min, em `core.ts` e `service.ts`). Não existe a opção de pular.
- Os avisos do sistema (pré-daily, retro) vivem em `src/main/scheduler.ts`, separados das agendas do usuário, com estado próprio; a tela de Agendas não os mostra.
- Atividade: a busca por referências a agenda em `src/shared/activity.ts` e `activityTreeModel.ts` não achou nada específico de agendas. Parece que o disparo só aparece como o turno da persona (porta `schedule`); **não verificado** o que a árvore mostra hoje, como a própria issue manda checar primeiro.
- `module.ts` já impede que um turno vindo da porta `schedule` crie agendas (`fromSchedule`).

## O que falta

Nada que só quem abriu possa dizer. Pontos para o refinamento, não para quem abriu:

- Aprovação pendente em ação direta sem ninguém na tela: espera indefinida ou expira? (critério diz que espera, como feito à mão.)
- Qual a porta/identidade registrada na auditoria para ação direta (hoje `schedule`).
- Agendas existentes sem regra de perda: assumir "rodar uma vez" (migração).
- Agendas do sistema editáveis ou não: a issue deixa para o refinamento.

## Relacionadas

- #245: issue-mãe ("Part of").
- #275: base já entregue (agendas, recorrências, disparo atrasado, porta `schedule`); esta a estende.
- Nenhuma duplicada encontrada nos documentos de ciclo e na memória listados (busca limitada; não verificado nas issues abertas do host).

## Prioridade e squad (sugestões)

- Prioridade sugerida: **priority:medium**: amplia uma função já entregue, sem bloquear nada; o ganho é previsibilidade e custo menor.
- Squad sugerido: **plataforma**: o núcleo é executar ações pelas portas, autonomia e auditoria no main (runner, ações). A tela de Agendas e os textos tocam a experiencia, que deve revisar.
