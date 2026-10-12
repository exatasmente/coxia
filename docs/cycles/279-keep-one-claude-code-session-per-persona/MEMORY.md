# Memória do ciclo

## Decisões

## Restrições

## Tentado e descartado

## Perguntas abertas

## Onde o trabalho está
- Passagem support → product-owner: Refinar: localizar a chamada de resposta da persona, onde guardar o id da sessão e o desenho do fallback; confirmar com teste que hoje cada mensagem abre uma sessão. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejar: guardar o id da sessão por conversa (e se sobrevive a reinício), passar `resume` na chamada de `answerMentions` (`deps.engine(call, [])`), cair em sessão nova sem erro quando a retomada falhar, decidir o que o prompt envia com sessão retomada, cobrir wake agendado e pós-parada, e escrever o teste com SDK falso (incluindo o que mostra hoje uma sessão por mensagem). <!-- handoff:20 -->
- Passagem tl-plataforma → pessoa: Implementar conforme 2_PLAN.md, na ordem dela: teste de linha de base; SessionGoneError e runClaudeSdk/runAgent (mode 'conversation' com fallback, atividade finished); sessionKeep + runtime; call.ts e answer.ts; testes de wake e parada; CHANGELOG. Conferir no código o repasse de extra.resume em sdkOptions e o provider realmente guardado após fallback de orçamento. Rodar os gates do AGENTS.md. <!-- handoff:33 -->
- Passagem developer → revisor-plataforma: Revisar o diff contra 2_PLAN.md e 3_IMPLEMENTATION.md. Pontos de atenção: - `extra.resume` só no modo `conversation`; a rodada de QA ficou como está e vira outra issue. - `SessionGoneError` lançado só antes de qualquer saída. - A sessão é guardada após a resposta ser postada. Sem verificação ainda: - `electron-vite build`; - o comportamento do CLI real com uma sessão removida (conferência manual com o Claude Code logado). As quatro falhas de navegador da suíte vêm de `@playwright/mcp` ausente no `node_modules` do worktree. <!-- handoff:69 -->
- Passagem revisor-plataforma → qa-plataforma-2: Integração: a revisão aprovou sem bloqueantes. Antes de abrir o PR, rodar `electron-vite build` e, se possível, a conferência manual com o Claude Code logado (três mensagens, uma sessão; apagar a sessão e enviar a quarta). <!-- handoff:76 -->
- Passagem qa-plataforma-2 → integrator: Integração/PR: os gates e o build passam. Ficam pendentes a conferência manual com o Claude Code logado (três mensagens, uma sessão; apagar a sessão e enviar a quarta) e a issue separada da rodada de reparo da QA. <!-- handoff:93 -->
- Passagem integrator → pessoa: Integração: pronto para o PR #284 (base release/0.11.0, 1 commit atrás, sem conflito). Gates passam; só 4 testes de navegador falham por @playwright/mcp ausente no ambiente. Pendentes: conferência manual com o Claude Code real e a issue da rodada de reparo da QA. <!-- handoff:119 -->
