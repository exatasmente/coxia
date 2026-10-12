# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível sem perguntas. Squad: plataforma.
- Refinamento: 1_SPEC.md (9 regras, 8 critérios). Prioridade proposta: medium. Sem marco.
- Persona, acordar agendado e resposta pós-parada seguem a mesma regra; `open` fica como está.
- Ponto único: `answerMentions` (`src/main/mentions/answer.ts`), que cobre mensagem, wake e retomada pós-parada.
- Sessão guardada por conversa em `persona-sessions.json` (`src/main/persona/sessionKeep.ts`, acessor `personaSessions()` em `runtime.ts`), versão 1, atômico, sobrevive a reinício. Entrada: `{ session, engine, provider, upTo }`. Só persona real, fora de chain e de cerimônia, só `claude-sdk`.
- Usa a sessão só se motor e provedor batem com `engineTargetOf(def)` e `upTo` <= último seq.
- Queda dentro de `runAgent`: `SessionGoneError` só quando há `resume` e a falha vem antes de qualquer saída/ferramenta; uma nova tentativa sem sessão, com `fallback.prompt` (a conversa inteira). Modo `conversation` termina `finished`.
- `Run.provider` diz o provedor que respondeu; é o que se guarda.
- Prompt com sessão retomada: só seq > upTo (menos a atual), seção `runner.section.threadSince`. Sessão guardada só após a resposta postada.
- `extra.resume` só no modo `conversation`.
- Revisão: aprovado, sem bloqueantes. QA: 10 cenários passam.
- Integração: pronto para o PR. Sem mudança de esquema (CONFIG_SCHEMA_VERSION 34 igual à release), CHANGELOG em Unreleased › Changed.

## Restrições

- Nada de `~/.claude` em testes, fixtures, logs ou conversa; ids inventados.
- Ferramentas, porta, parada e auditoria inalteradas; nenhuma escrita nova no host.
- Motor `open` mantém o comportamento atual.
- Gates do AGENTS.md: tsc, vitest, theme-audit, i18n:lint, public-audit (+ electron-vite build no CI).
- O teste de catálogo exige `cp('chave literal')`.
- Uma pasta `out/` deixada por um build faz o `public-audit.test` falhar; apagar antes de rodar a suíte.

## Tentado e descartado

- Fallback em `answer.ts` por fora de `runAgent`: a atividade já estaria `failed`.
- Guardar na configuração: exigiria migração.
- Equivalente barato para `open`: não há.
- Passar `extra.resume` para todo `call.resume`: quebra `test/runner-agent-open.test.ts`; fica para outra issue.

## Perguntas abertas

- Não verificado: erro real do SDK/CLI para sessão removida; compactação do CLI; contagem de sessões em disco real (critério 1): conferência manual com o Claude Code logado.
- Não verificado: se as 4 falhas de navegador (`@playwright/mcp` ausente no ambiente) também ocorrem na release; lista dos outros PRs abertos para a release.
- Sugestões da revisão (não bloqueiam): o `catch` de `runClaudeSdk` trata qualquer erro pré-saída como sessão perdida; respostas simultâneas sem trava; prompt de reserva montado a cada resposta retomada.
- Achado para outra issue: a rodada de reparo da QA (`executor.ts` ~731) envia só o texto da rodada, sem a sessão anterior.

## Onde o trabalho está

- Integração concluída (7_INTEGRATION.md, ev-5): tsc, theme-audit, i18n:lint, public-audit e electron-vite build saem com 0; vitest: só 4 arquivos de navegador falham por ambiente.
- PR #284 já aberto, base release/0.11.0, CI success em 0dba745e; branch 1 commit atrás (release 0.11.0-beta.4, sem conflito, merge-tree 0).
- Próximo: nota de lançamento / merge pela pessoa. Relacionadas: #262, #275.
- Passagem support → product-owner: Refinar: localizar a chamada de resposta da persona, onde guardar o id da sessão e o desenho do fallback; confirmar com teste que hoje cada mensagem abre uma sessão. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejar: guardar o id da sessão por conversa (e se sobrevive a reinício), passar `resume` na chamada de `answerMentions` (`deps.engine(call, [])`), cair em sessão nova sem erro quando a retomada falhar, decidir o que o prompt envia com sessão retomada, cobrir wake agendado e pós-parada, e escrever o teste com SDK falso (incluindo o que mostra hoje uma sessão por mensagem). <!-- handoff:20 -->
- Passagem tl-plataforma → pessoa: Implementar conforme 2_PLAN.md, na ordem dela: teste de linha de base; SessionGoneError e runClaudeSdk/runAgent (mode 'conversation' com fallback, atividade finished); sessionKeep + runtime; call.ts e answer.ts; testes de wake e parada; CHANGELOG. Conferir no código o repasse de extra.resume em sdkOptions e o provider realmente guardado após fallback de orçamento. Rodar os gates do AGENTS.md. <!-- handoff:33 -->
- Passagem developer → revisor-plataforma: Revisar o diff contra 2_PLAN.md e 3_IMPLEMENTATION.md. Pontos de atenção: - `extra.resume` só no modo `conversation`; a rodada de QA ficou como está e vira outra issue. - `SessionGoneError` lançado só antes de qualquer saída. - A sessão é guardada após a resposta ser postada. Sem verificação ainda: - `electron-vite build`; - o comportamento do CLI real com uma sessão removida (conferência manual com o Claude Code logado). As quatro falhas de navegador da suíte vêm de `@playwright/mcp` ausente no `node_modules` do worktree. <!-- handoff:69 -->
- Passagem revisor-plataforma → qa-plataforma-2: Integração: a revisão aprovou sem bloqueantes. Antes de abrir o PR, rodar `electron-vite build` e, se possível, a conferência manual com o Claude Code logado (três mensagens, uma sessão; apagar a sessão e enviar a quarta). <!-- handoff:76 -->
- Passagem qa-plataforma-2 → integrator: Integração/PR: os gates e o build passam. Ficam pendentes a conferência manual com o Claude Code logado (três mensagens, uma sessão; apagar a sessão e enviar a quarta) e a issue separada da rodada de reparo da QA. <!-- handoff:93 -->
