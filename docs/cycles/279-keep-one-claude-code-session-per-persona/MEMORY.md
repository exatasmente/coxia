# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível sem perguntas. Squad: plataforma.
- Refinamento: 1_SPEC.md escrita (9 regras, 8 critérios). Prioridade proposta: medium (reduz acúmulo de sessões e custo de reconstruir contexto; nada quebra hoje). Sem marco proposto.
- Persona, acordar agendado e resposta pós-parada seguem a mesma regra; `open` fica como está.

## Restrições

- Nada de `~/.claude` (ids de sessão, transcrições) em testes ou fixtures.
- Ferramentas, porta, parada e auditoria da persona não mudam.
- Motor `open` mantém o comportamento atual, salvo equivalente barato.

## Tentado e descartado

- Nada.

## Perguntas abertas

- Ao plano: onde guardar o id da sessão por conversa (sobreviver a reinício?), como detectar sessão não retomável e cair em nova sem erro, limite de contexto.

## Onde o trabalho está

- Refinamento pronto (1_SPEC.md). Achados por leitura (nada executado): a persona responde por `answerMentions` em `src/main/mentions/answer.ts`; a chamada ao motor é `deps.engine(call, [])` (~linha 468) e `call` não recebe `resume`. O campo `resume?: { session, engine }` já existe no contrato da chamada (`agents.ts` ~1518) e vira `extra.resume` no pedido (~1658); `withBudgetFallback`/`withPool` aceitam `resumeEngine`. O id da sessão volta em `r.sessionId`. O prompt da persona hoje leva a conversa inteira (`thread: deps.forum.read(...)`, ~350): com retomada, decidir o que enviar. Acordar agendado: `src/main/schedules/fire.ts` → `wake`. Parada: `src/main/persona/stop.ts` (`resume` ali é retomada das mensagens seguradas, não sessão). Relacionadas: #262, #275.
- Não verificado: que hoje cada mensagem abre uma sessão (nenhum teste rodado); se wake e pós-parada chegam à mesma chamada de `answerMentions`.
- Passagem support → product-owner: Refinar: localizar a chamada de resposta da persona, onde guardar o id da sessão e o desenho do fallback; confirmar com teste que hoje cada mensagem abre uma sessão. <!-- handoff:11 -->
