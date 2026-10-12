# Memória do ciclo

## Decisões

- Ordem de entrada e esquema: a pessoa respondeu "280 primeiro", depois "2882 vai primeiro" (lido como #282), depois "Espera e ajusta a versão do schema" e, à pergunta de caminho, "Esperar". Leitura adotada: esperar a #282 entrar na base e só então renumerar esta branch de 35 para 36 (`v35ToV36`). Não renumerar antes: a cadeia ficaria sem o passo 35.
- Os canais ficam sempre registrados e recusam quando o recurso está desligado (desvio do plano, em 3_IMPLEMENTATION.md).
- Fonte de sessões em execução: `~/.claude/sessions/<pid>.json` via `guardedRead`, só campos permitidos (nota m-7d7da8eb).
- Resposta: 280 primeiro <!-- answer:145 -->
- Resposta: 2882 vai primeiro <!-- answer:225 -->
- Resposta: Espera e ajusta a versão do schema <!-- answer:242 -->
- Resposta: Esperar <!-- answer:278 -->

## Restrições

- Nunca abrir `.credentials.json`, `*.key`, `control.key`; `guardedRead` é o único ponto de disco.
- Eventos só pela janela (`emitWindow`); canais negados ao celular (`/^claudeSessions:/`) e em `EXCLUDED` da persona.
- `test:true` recusa enviar e iniciar. Nada de `~/.claude` em testes.
- PR com base `release/0.11.0` (esquema 34 hoje). #282 e esta branch usam `v34ToV35`.

## Tentado e descartado

- Renumerar para 36 agora (ou `v34ToV36`): descartado, deixa v34 sem caminho até a #282 entrar.

## Perguntas abertas

- Nenhuma pendente para a pessoa.

## Onde o trabalho está

- Passos 1 a 7 do plano implementados; revisão aprovada (rodada 3); QA com fakes passou (191 testes do recurso, build ok); gates rodados na tentativa 2 e npm test/typecheck pelo app na integração.
- Falta: quando a #282 estiver na base, renumerar para 36 (types.ts, migrations.ts, docs/configuration.md, test/config-migrations.test.ts, CHANGELOG) e rodar os cinco portões.
- Não verificado: Claude Code real (critérios 2 a 6 e 8), tela em app aberto, esquema da #282 nesta tentativa.
- Lacuna conhecida: sem linha de auditoria quando send/start falha após entregar o texto ao SDK ou quando `interrupt` lança.
- Passagem developer → revisor-plataforma: "Esperar" (opção a); código inalterado, esquema 35 até a #282 entrar.
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
- Passagem qa-plataforma-2 → integrator: QA: testes do recurso (191) e build passaram; esquema 35 desta branch lido. Falta verificação manual dos critérios 2 a 6 e 8 contra o Claude Code real, e a #282 renumerar para v36. <!-- handoff:194 -->
- Passagem pessoa → qa-plataforma-2: Espera e ajusta a versão do schema <!-- handoff:243 -->
- Passagem qa-plataforma-2 → integrator: QA: o esquema desta branch ainda é 35 (`v34ToV35`). Conforme a resposta da pessoa, esperar a #282 e renumerar para 36 (`CONFIG_SCHEMA_VERSION`, `v35ToV36`, types.ts, histórico em migrations.ts, docs/configuration.md, test/config-migrations.test.ts, CHANGELOG), depois rodar os gates de novo. Verificação contra o Claude Code real segue pendente. <!-- handoff:254 -->
- Passagem integrator → developer: Veredito: devolver ao implement. Pela resposta "2882 vai primeiro", que leio como a #282 (suposição minha), esta branch precisa renumerar o esquema de 35 para 36. Nesta tentativa só reli o esquema da branch com um grep: CONFIG_SCHEMA_VERSION = 35 e STEPS termina em v34ToV35. O ajuste pedido não foi aplicado, porque esta etapa só lê. Não verifiquei CHANGELOG, base, gates, nomes de módulo, base do PR nem o esquema da #282 e da release. Cenário que falhou: Esquema: renumeração para 36 após a #282. A branch continua no 35 e o ajuste não foi aplicado. A necessidade vem da ordem dita pela pessoa, li… <!-- handoff:269 -->
