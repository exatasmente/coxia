# Memória do ciclo

## Decisões

- A triagem fechou o tipo: pedido de funcionalidade (enhancement). Não há defeito a reproduzir.
- Confirmado do lado que a issue supõe existir: as escritas na porta das Ações estão todas lá (`commentIssue`, `setIssueLabels`, `setIssueStatus`, `closeIssue`), com a validação da forma do comando e a auditoria (um registro por escrita). O que falta não é a escrita, é o canal que deixa uma resposta de agente propô-la e o lugar onde ela espera.

## Restrições

- Achados de leitura desta triagem, com o arquivo:linha: `proposesIssue` devolve `false` fora de uma execução (`src/main/mentions/answer.ts:77-81`); o publicador só existe no runner (`src/main/runner/service.ts:1052`; `src/main/mentions/module.ts:38-44`); a única operação proposta hoje é `createIssue` (`src/main/runner/publish.ts:990`, `:959`; `src/main/retroIssues.ts:87`); as threads são execução, squad, canal dos squads e geral (`src/main/mentions/place.ts:29-46`; `src/shared/forum.ts:80-81`); a conversa é a thread do lugar, as últimas 40 mensagens (`src/main/mentions/call.ts:90`); a resposta é interna (`src/main/mentions/answer.ts:152`); teto de 3 menções por mensagem (`src/shared/forum.ts:157-158`).
- O que "mudar o estado de uma issue" significa diverge por host: Bitbucket usa o estado da issue; GitHub aceita `open`/`closed` e nega estado próprio; GitLab usa ids numéricos de estado da instância por mutação em GraphQL, precisando do id global do item de trabalho (`src/main/vcs/types.ts:198`, `bitbucket.ts:465-467`, `github.ts:538-540`, `gitlab.ts:516-528`, `src/shared/vcsCaps.ts`). Sem rótulos de issue no Bitbucket (`bitbucket.ts:463-464`).
- Comportamento observado só por leitura; nada executado e nada visto funcionando no aplicativo. Não verificado: a política do telefone (`src/main/webPolicy.ts`) e os alvos de notificação (`src/shared/push.ts`) para propostas e escritas ligadas a uma issue.

## Tentado e descartado

- Nada tentado nesta etapa; a triagem é leitura e não decide solução nem prioridade.

## Perguntas abertas

- Nenhuma de quem abriu a issue. As decisões adiadas pela própria issue (o que uma conversa direta lê, se guarda memória entre conversas, como aparece no telefone, se fechar é `setIssueStatus` em todos os provedores) são de refino.

## Onde o trabalho está

- `docs/cycles/[redacted]/` com `0_ISSUE.md` e a triagem `0_TRIAGE.md` escritos. Nenhuma pergunta pendente; segue para o refino.
