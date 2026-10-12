# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade; priority:medium; squad plataforma.
- Refino: 1_SPEC.md (16 regras, 12 critérios).
- Plano (2_PLAN.md): chave `claudeSessions.enabled` (v35), prefixo negado `claudeSessions:`, EXCLUDED `machine`, auditoria `claude-session`, `emitWindow`, fila de permissões própria, `test:true` recusa send/start antes do SDK, registro `owned` compartilhado com #282.
- Passo 0: sessões em execução e em segundo plano vêm de `~/.claude/sessions/<pid>.json` (só pid, sessionId, cwd, kind, status, updatedAt; vivo = process.kill(pid,0)). Nota m-7d7da8eb.
- Implementação: passos 1 a 7 feitos. Desvio aceito: os 12 canais ficam sempre registrados; desligado, todos menos `enabled` e `set-enabled` recusam. Todo handler recusa porta que não seja a janela. Sessões conduzidas usam `query` em entrada contínua. Redação reusa `redact` de errorlog-core. Nota m-dfa8dee2.
- Revisão rodadas 2 e 3: aprovado, sem bloqueantes.
- QA: 7 arquivos de teste do recurso (191) passaram e o build electron-vite passou (ev-2, ev-3); a tela chama follow(null) ao sair (lido, ev-4); esta branch tem esquema 35 e v34ToV35 (lido, ev-8).
- Ordem de entrada: a pessoa decidiu "280 primeiro" <!-- answer:145 -->. Esta branch mantém o esquema 35 / `v34ToV35`; a #282 renumera para v36. Segundo a integração anterior (não reconferido na QA), a #282 (d434be69) também usa 35 e a origin/release/0.11.0 está em 34.

## Restrições

- Opt-in, desligado por padrão, só desktop; nunca abrir credenciais nem chaves. `guardedRead` (src/main/claudeSessions/source.ts) é o único ponto de disco. Negado ao celular; persona em EXCLUDED; eventos só por `emitWindow`; nada de ~/.claude em testes.
- Config nova exige step em STEPS + types.ts, defaults.ts, schema.ts e docs/configuration.md.
- Catálogos `ui-*.json` com chaves ordenadas; chave de UI literal no código do renderer.
- Repositório público: fixtures sintéticas.
- Base do PR: release/0.11.0, não a main.

## Tentado e descartado

- Fonte reduzida da decisão 8: descartada, a fonte limpa existe.
- Registrar canais só quando ligado: descartado, exigiria reiniciar o app.
- Renumerar esta branch para v36: descartado pela decisão "280 primeiro".

## Perguntas abertas

- Permissão só existe para sessão conduzida pelo app; sessão em terminal pergunta no terminal (documentado).
- Sem auditoria quando envio/início falha após entregar o texto ao SDK, ou quando `interrupt` lança (sugestão, não tratada).
- Documentar que as configurações do Claude Code da pessoa se aplicam (sugestão).
- A #282 precisa renumerar seu passo para v35→v36 antes de entrar (fora deste ciclo).

## Onde o trabalho está

- Código, testes e documentação na branch; revisão aprovada (rodada 3); QA automática passou (5_TEST_PLAN.md); integração devolveu só pelo esquema, resolvido pela ordem de entrada.
- Gates rodados na tentativa 2 e pela integração (ev-5, ev-6); não repetidos desde, sem mudança de código.
- Não verificado: nada contra o Claude Code real; a tela não foi aberta num app em execução; PRs abertos não consultados; esquema da #282 e da release não reconferido na QA.
- Próximo: integração reconfere e abre o PR contra release/0.11.0; verificação manual dos critérios 2 a 6 e 8 por uma pessoa com o claude instalado e logado.
- Relacionadas: #262 (entrega 3), #274 (entregue), #282 (consome `owned.ts`, renumera para v36), #281.
- Passagem qa → integrator: testes do recurso (191) e build passaram; esquema 35 desta branch lido (ev-8); falta verificação contra o Claude Code real.
- Passagem support → product-owner: Refino: confirmar a fonte das sessões em execução/em segundo plano sem tocar nas chaves, checar a API do SDK instalado, achar onde entra o prefixo negado em webPolicy.ts e alinhar com #262 e #282. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano: resolver a fonte de sessões em execução/segundo plano sem abrir chaves e verificar a API do SDK instalado (instalar dependências); o prefixo negado entra como novo padrão em webPolicy.ts (lista de padrões na linha ~120, ex.: /^claudeSessions:/); incluir o recurso em EXCLUDED de doorTable.ts; combinar com #282 o ciclo de vida das sessões iniciadas pelo Coxia. <!-- handoff:21 -->
- Passagem tl-plataforma → pessoa: Implementação: começar pelo passo 0 do plano (instalar dependências e confirmar no SDK instalado listSessions, leitura de mensagens, resume/forkSession, canUseTool, interrupt e a fonte de sessões em execução/segundo plano sem abrir chaves); só então seguir a ordem 1 a 7. Se a fonte limpa não existir, aplicar a versão reduzida da decisão 8 e avisar o product owner. <!-- handoff:36 -->
- Passagem developer → revisor-plataforma: Implementação, nova tentativa: o passo 0 está feito (ver a nota m-7d7da8eb e 3_IMPLEMENTATION.md). A decisão 8 vale inteira, com a fonte `~/.claude/sessions/<pid>.json` e só os campos permitidos. Falta implementar os passos 1 a 7 de 2_PLAN.md, com testes, e rodar os portões (`npx tsc --noEmit`, `npx vitest run`, theme-audit, i18n:lint, public-audit). Nenhum código foi alterado ainda. <!-- handoff:56 -->
- Passagem revisor-plataforma → developer: Revisão devolvida: a branch não tem nenhuma alteração de código fora da pasta do ciclo. Os passos 1 a 7 do plano (configuração, fronteira, emissor só da janela, núcleo, auditoria, tela, documentação) e os testes não existem, então nenhum dos 12 critérios de aceite é atendido. Nenhum portão foi rodado nesta etapa. [bloqueia] docs/cycles/[redacted]/3_IMPLEMENTATION.md: A branch não contém nenhuma alteração de código: só o passo 0 (sondagem) foi feito. Os passos 1 a 7 do plano e os testes correspondentes não existem, então os critérios de aceite da especificação (tela, canais, permissões, parar, … <!-- handoff:63 -->
- Passagem developer → revisor-plataforma: Revisão: conferir o diff contra 2_PLAN.md e 1_SPEC.md. Pontos de atenção: - canais sempre registrados e recusando quando desligado (desvio do plano, explicado em 3_IMPLEMENTATION.md); - `guardedRead` como único ponto de disco, sem seguir link; - `emitWindow` só para a janela; - três camadas contra o celular e a persona; - `test:true` antes do SDK. Os 5 portões rodaram. Na rodada final, 2 testes estouraram o limite de 5 s com a máquina carregada e passaram sozinhos. A verificação contra o Claude Code real fica para a QA. <!-- handoff:94 -->
- Passagem revisor-plataforma → qa-plataforma-2: QA: verificar contra o Claude Code real os critérios 2 a 6 e 8 (listar, ao vivo, enviar, cópia, permissão, parar/encerrar), que sair da tela encerra o acompanhamento e que o build electron-vite passa. <!-- handoff:102 -->
- Passagem qa-plataforma-2 → integrator: QA concluída sem falhas nos testes automáticos e no build. A verificação contra o Claude Code real e com a tela aberta não foi feita; precisa de uma pessoa com o claude instalado e logado. <!-- handoff:120 -->
- Passagem integrator → developer: Veredito: devolver ao implement. O item 2 é bloqueante: o passo v34→v35 desta branch (CONFIG_SCHEMA_VERSION 35) colide com o da #282. Nesta rodada confirmei só o lado desta branch (ev-6). O lado da #282 e da release veio da execução anterior; o sandbox desta rodada não é um repositório git e não consegui reproduzi-lo. CHANGELOG, base, nomes de módulo e gates passaram. A base do PR (item 6) não foi verificada, porque o PR ainda não existe. Cenário que falhou: Esquema: sem colisão com a #282 após a decisão 280 primeiro. Esta branch tem CONFIG_SCHEMA_VERSION 35 e v34ToV35 (ev-6, executado). A bra… <!-- handoff:161 -->
- Passagem developer → revisor-plataforma: Integração: com a decisão "280 primeiro", esta branch mantém o esquema 35 (`v34ToV35`) e o código não mudou nesta tentativa. A release/0.11.0 está no esquema 34, e a #282 (d434be69) também usa `v34ToV35`; isso foi conferido com git grep (ev-7). A #282 precisa renumerar para v36 (`CONFIG_SCHEMA_VERSION` 36, `v35ToV36`, types.ts, histórico em migrations.ts, docs/configuration.md, test/config-migrations.test.ts) antes de entrar. O PR desta branch deve usar a base release/0.11.0. <!-- handoff:177 -->
- Passagem revisor-plataforma → qa-plataforma-2: Integração: revisão aprovada na rodada 3, sem bloqueantes. Abrir o PR com base release/0.11.0; o esquema 35 fica aqui e a #282 renumera para v36. Verificação manual contra o Claude Code real continua pendente. <!-- handoff:183 -->
