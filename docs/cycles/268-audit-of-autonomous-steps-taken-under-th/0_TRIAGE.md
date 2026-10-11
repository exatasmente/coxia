# Triagem: registro de auditoria dos passos autônomos

## Tipo
Pedido de funcionalidade (não é bug, pergunta nem duplicada).

## Dá para entender?
Sim, lido (nada foi executado). A issue diz o que registrar (passo, hora, agente, política e o nível de onde veio), que passos retidos e depois aprovados/recusados também entram, que a persona não apaga nem edita registros e que mudanças de política são registradas. Os critérios de aceitação são verificáveis.

## Escopo confirmado pela pessoa
- Registrar todo passo autônomo, e também os retidos que foram aprovados ou recusados, com passo, hora, agente e a política em vigor (com o nível).
- A persona não apaga o registro.
- A dependência é a #269 (política de autonomia configurável, 9 critérios de aceite no corpo dela). Esta (#268) é a auditoria e deve ir à produção junto ou antes.
- A especificação completa do product owner chegou truncada também para a pessoa: não dá para afirmar que não há critérios além dos listados. Os critérios da issue valem como estão; o que a #269 trouxer deve ser conferido contra eles na refinação.

## O que o código já tem (lido)
- Já existe um log de auditoria (`auditoria.jsonl`) com entradas tipadas (`src/shared/auditoria.ts`) e campo `by` para o agente cuja autonomia deixou o passo sair; escritas ao host, push e pull request autônomos passam por ele (`src/main/actions.ts`, `src/main/runner/publish.ts`).
- A política efetiva e sua origem (`from`: workspace ou fluxo, `flow`) vêm de `autonomyOf` em `src/shared/config/autonomy.ts`; é o dado que o registro precisa gravar como "política e nível".
- Não encontrei tipo de entrada para mudança de política de autonomia nem campo de política/nível nas entradas (lido por busca; não exaustivo).
- Não verificado: se a persona hoje tem algum caminho de escrita/remoção no log (o critério 3 exige prova por testes com fakes).

## O que falta / ambiguidades
1. "Passo autônomo" ainda não está delimitado em código: a pessoa disse "todo passo autônomo"; sugestão de leitura: todos os pontos em que a política decide sem um "sim" (comandos no host, portões, push, pull request, escrita do quadro e início de etapa). A confirmar na refinação.
2. Os níveis de política (agente, squad, workspace) vêm da #269; o formato do campo "nível" depende dela.

## Relacionadas
- #269 Política de autonomia configurável: dependência (não pode ir à produção sem esta).
- Nenhuma duplicada encontrada.

## Prioridade (sugestão)
priority:medium, como já está: bloqueia a liberação da #269, mas não afeta quem usa hoje.

## Squad sugerido
plataforma: o trabalho está no log de auditoria, nas ações e no runner (fronteira de segurança); a parte de texto (`t()` e catálogos) é pequena.
