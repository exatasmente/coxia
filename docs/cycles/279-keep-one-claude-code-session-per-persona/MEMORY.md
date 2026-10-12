# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível sem perguntas. Squad: plataforma.
- Refinamento: 1_SPEC.md (9 regras, 8 critérios). Prioridade proposta: medium. Sem marco.
- Persona, acordar agendado e resposta pós-parada seguem a mesma regra; `open` fica como está.
- Ponto único: `answerMentions` (`src/main/mentions/answer.ts`), que cobre mensagem, wake e retomada pós-parada.
- Sessão guardada por conversa em `persona-sessions.json` (`src/main/persona/sessionKeep.ts`, acessor `personaSessions()` em `runtime.ts`), versão 1, atômico, sobrevive a reinício. Entrada: `{ session, engine, provider, upTo }`. Só persona real, fora de chain e de cerimônia, só `claude-sdk`.
- Usa a sessão só se motor e provedor batem com `engineTargetOf(def)` e `upTo` <= último seq.
- Queda dentro de `runAgent`: `SessionGoneError` só quando há `resume` e a falha vem antes de qualquer saída/ferramenta (resultado de erro ou exceção do query); uma nova tentativa sem sessão, com `fallback.prompt` (a conversa inteira). Modo `conversation` termina `finished`.
- `Run.provider` diz o provedor que respondeu; é o que se guarda.
- Prompt com sessão retomada: só seq > upTo (menos a atual), seção `runner.section.threadSince`. Sessão guardada só após a resposta postada.
- `extra.resume` só no modo `conversation` (ver Tentado e descartado).

## Restrições

- Nada de `~/.claude` em testes, fixtures, logs ou conversa; ids inventados.
- Ferramentas, porta, parada e auditoria inalteradas; nenhuma escrita nova no host.
- Motor `open` mantém o comportamento atual.
- Gates do AGENTS.md: tsc, vitest, theme-audit, i18n:lint, public-audit (+ electron-vite build no CI).
- O teste de catálogo exige `cp('chave literal')`: uma chave escolhida por ternário dentro de `cp(...)` conta como não usada.

## Tentado e descartado

- Fallback em `answer.ts` por fora de `runAgent`: a atividade já estaria `failed`.
- Guardar na configuração: exigiria migração.
- Equivalente barato para `open`: não há.
- Passar `extra.resume` para todo `call.resume`: corrigiria a rodada de reparo da QA (hoje `call.resume` nunca chega ao motor, porque `sdkOptions` só lê `extra`), mas quebra `test/runner-agent-open.test.ts`, que fixa o comportamento atual. Fica para outra issue.

## Perguntas abertas

- Não verificado: o erro real do SDK/CLI para sessão removida; compactação do CLI em sessões longas; contagem de sessões em disco real (critério 1), só por conferência manual com o CLI logado.
- Achado para outra issue: a rodada de reparo da QA (`executor.ts` ~731) envia só o texto da rodada, sem a sessão anterior.

## Onde o trabalho está

- Implementação feita (3_IMPLEMENTATION.md). Testes novos: persona-session-keep, persona-session-resume, engine-session-gone; acréscimo em schedules-fire.
- Gates rodados nesta etapa: tsc, theme-audit, i18n:lint e public-audit passam. Vitest: 8911 testes passam (ev-1); falham 3 testes de navegador por `@playwright/mcp` ausente no `node_modules` do worktree, e 2 por tempo sob carga, que passam isolados. `electron-vite build` não rodado.
- Próximo: revisão. Relacionadas: #262, #275.
- Passagem support → product-owner: Refinar: localizar a chamada de resposta da persona, onde guardar o id da sessão e o desenho do fallback; confirmar com teste que hoje cada mensagem abre uma sessão. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejar: guardar o id da sessão por conversa (e se sobrevive a reinício), passar `resume` na chamada de `answerMentions` (`deps.engine(call, [])`), cair em sessão nova sem erro quando a retomada falhar, decidir o que o prompt envia com sessão retomada, cobrir wake agendado e pós-parada, e escrever o teste com SDK falso (incluindo o que mostra hoje uma sessão por mensagem). <!-- handoff:20 -->
- Passagem tl-plataforma → pessoa: Implementar conforme 2_PLAN.md, na ordem dela: teste de linha de base; SessionGoneError e runClaudeSdk/runAgent (mode 'conversation' com fallback, atividade finished); sessionKeep + runtime; call.ts e answer.ts; testes de wake e parada; CHANGELOG. Conferir no código o repasse de extra.resume em sdkOptions e o provider realmente guardado após fallback de orçamento. Rodar os gates do AGENTS.md. <!-- handoff:33 -->
