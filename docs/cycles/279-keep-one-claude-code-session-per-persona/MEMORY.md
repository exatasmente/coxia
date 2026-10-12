# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível sem perguntas. Squad: plataforma.
- Refinamento: 1_SPEC.md (9 regras, 8 critérios). Prioridade proposta: medium. Sem marco.
- Persona, acordar agendado e resposta pós-parada seguem a mesma regra; `open` fica como está.
- Plano (2_PLAN.md): ponto único é `answerMentions` (`src/main/mentions/answer.ts`), que `chain` em `mentions/module.ts` chama para mensagem, wake e retomada pós-parada; nada muda em `fire.ts`, `stop.ts`, `module.ts`.
- Sessão guardada por conversa em arquivo próprio `persona-sessions.json` (molde do `persona-latch.json`), versionado, atômico, sobrevive a reinício; sem mexer em config/STEPS. Entrada: `{ session, engine, provider, upTo }`. Só persona real (não a cópia de teste) e só motor `claude-sdk`.
- Usa a sessão só se provedor e motor guardados batem com os atuais e `upTo` <= último seq.
- Queda para sessão nova DENTRO de `runAgent` via `SessionGoneError` (lançado por `runClaudeSdk` só se `resume` e falha antes de qualquer saída/ferramenta; uma retomada única; nunca depois de ato). `AgentCall.resume` ganha `mode: 'round'|'conversation'` e `fallback.prompt`; modo conversa termina `finished` (hoje `call.resume` deixa `started`, agents.ts ~1727).
- Prompt com sessão retomada: só mensagens com seq > upTo (menos a atual); prompt de reserva leva a conversa completa (slice -40). Guardar só após a resposta postada.
- Sem limite novo de contexto.

## Restrições

- Nada de `~/.claude` (ids de sessão, transcrições) em testes, fixtures, logs ou conversa; ids inventados (`s-a`).
- Ferramentas, porta, parada e auditoria da persona não mudam; nenhuma escrita nova no host.
- Motor `open` mantém o comportamento atual; testes existentes sem alteração.
- Gates do AGENTS.md: tsc, vitest, theme-audit, i18n:lint, public-audit (+ electron-vite build no CI).

## Tentado e descartado

- Fallback em `answer.ts` por fora de `runAgent`: descartado, a atividade já estaria `failed`.
- Guardar na configuração do workspace: descartado, exigiria migração e os três de types/defaults/schema.
- Equivalente barato para `open`: descartado, já tem transcrição própria.

## Perguntas abertas

- Para a implementação conferir (não verificado): repasse de `extra.resume` em `sdkOptions`; formato real do erro do SDK para sessão ausente; provider guardado após fallback de orçamento para o CLI; compactação automática do CLI em sessões longas.
- Critério 1 em disco real (contar sessões na máquina) só por conferência manual.

## Onde o trabalho está

- Plano escrito (2_PLAN.md), nada executado nesta etapa. Próximo: implementação na ordem do plano. Relacionadas: #262, #275.
- Testes novos previstos: persona-session-keep, persona-session-resume (com linha de base), engine-session-gone; acréscimos em persona-schedules e persona-stop/mentions-stop.
- Passagem support → product-owner: Refinar: localizar a chamada de resposta da persona, onde guardar o id da sessão e o desenho do fallback; confirmar com teste que hoje cada mensagem abre uma sessão. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejar: guardar o id da sessão por conversa (e se sobrevive a reinício), passar `resume` na chamada de `answerMentions` (`deps.engine(call, [])`), cair em sessão nova sem erro quando a retomada falhar, decidir o que o prompt envia com sessão retomada, cobrir wake agendado e pós-parada, e escrever o teste com SDK falso (incluindo o que mostra hoje uma sessão por mensagem). <!-- handoff:20 -->
