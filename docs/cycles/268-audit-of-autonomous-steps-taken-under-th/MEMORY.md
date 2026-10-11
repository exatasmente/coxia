# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade. Dependência: #269 (política de autonomia configurável); esta #268 vai antes ou junto. Squad plataforma, prioridade medium, sem marco.
- Escopo: registrar todo passo autônomo (início de etapa, comando no host, portão, push, pull request, escrita do quadro) e as decisões sobre passos retidos, com passo, hora, agente e política em vigor (cinco escolhas + nível/origem). Mudanças de política também. A persona não apaga nem edita. A spec do product owner veio truncada: não se afirma que não há critérios extras.
- Plano seguido: campo opcional `policy` em `AuditEntry` (`auditPolicyOf`/`levelOf` em autonomy.ts); tipos `auto-step`, `decision`, `policy-change`; `saveConfig(next, by='person')` grava a mudança de política; cadeia de hash + `tampered` em `listAudit`; plugins e mentions sem `policy`; sem tela nova.
- Decidido na implementação: a aprovação grava `decision` no "sim", antes da escrita; o início de etapa é gravado também quando a etapa é autônoma pelo interruptor do agente; o texto do pull request usa `{crLong}`.
- Revisão rodadas 1 e 2: aprovado, sem bloqueantes. Integração devolveu só por causa da base; a pessoa autorizou trazê-la pelo shell (merge --no-commit --no-ff de origin/release/0.11.0, commit feito pelo app).
- Depois da mescla: a decisão sobre passo retido diz quem decidiu (`persona` com ato da persona aberto, `who.by` no portão). Filtro "Quem": `by: person` = pessoa, `by: persona` = persona.
- A issue da política é a #269; esta (#268) é a auditoria.
- Resposta: A issue da política de autonomia configurável é a #269 (esta, #268, é a auditoria). A spec completa do product owner chegou truncada, então não dá para afirmar que não há critérios além dos listados; o corpo da #269 traz 9 critérios de aceite. Escopo: registrar todo passo autônomo e também os retidos que foram aprovados ou recusados, com passo, hora, agente e a política em vigor (com o nível); a persona não apaga o registro. <!-- answer:12 -->
- Resposta: Eu autorizo você fazer pelo shell <!-- answer:172 -->

## Restrições

- Textos novos por `t()` com os dois catálogos; CHANGELOG `Unreleased` atualizado; repositório público.
- A #269 não pode ir à produção sem esta. Registros antigos não são reescritos.
- O esquema de configuração não muda nesta tarefa.
- Chaves de catálogo não podem ser montadas dinamicamente na tela: usar mapa explícito.
- PR com base `release/0.11.0` (deduzida), não a main. Rebase e push pelo shell continuam fora.
- `test/persona-worded.test.ts` falha para arquivo novo de `src/main` ou `src/shared` com `by: 'person'` fixo: use `who.by`/`PERSON_WHO.by`.
- Apagar `out/` antes do vitest, senão public-audit.test falha.

## Tentado e descartado

- Tipos novos para cada passo já auditado: descartado em favor do campo `policy`.
- Gravar a decisão depois da escrita: duplicava o resultado e quebrava testes.

## Perguntas abertas

- Formato final do nível (agente/squad/workspace) depende da #269; hoje workspace e fluxo, isolado em `levelOf`.
- Interruptores de autonomia de agente e de squad não geram `policy-change`; cobrir com a #269 (que também mexe em auditoria.ts/Auditoria.tsx).
- `askCommand` (service.ts:526) ainda grava `by: 'person'` fixo.
- Confirmar a lista de passos contra o texto completo da spec, se houver.
- Limite conhecido: agente `shell: host` pode editar o arquivo; só há detecção (hash). `lastChain` lê 64 KB do fim.
- Pull requests abertos para a release: não consultados.

## Onde o trabalho está

- QA rodada 2 (ev-8, ev-9): branch 0 commits atrás de origin/release/0.11.0; tsc, theme, i18n (6174 chaves), public-audit com saída 0; 8 arquivos de auditoria, 149 testes passaram; suíte completa 530/534 arquivos, falham só os 4 de navegador (sem `@playwright/mcp`).
- Não verificado: tela do log no app; build desta rodada (passou na implementação); os 4 testes de navegador.
- Próxima etapa: abrir o PR contra `release/0.11.0`.
- Passagem support → product-owner: Refinar: delimitar \"passo autônomo\" (todos os pontos em que a política decide sem um sim), definir o formato política/nível junto com a #269 e planejar testes com fakes de que a persona não escreve nem apaga o log. <!-- handoff:21 -->
- Passagem product-owner → pessoa: Arquiteto/tech lead: desenhar o registro (campos política e nível em AuditEntry, tipos para decisão sobre passo retido e mudança de política) a partir de `autonomyOf`; alinhar o nome dos níveis com a #269; levantar se a persona tem hoje algum caminho de escrita/remoção do log e planejar testes com fakes (critério 3). Cobrir os seis pontos autônomos listados. <!-- handoff:32 -->
- Passagem tl-plataforma → pessoa: Desenvolvimento: seguir a ordem do 2_PLAN.md. Antes de escrever o registro de início de etapa, confirmar em service.ts/transitions.ts como distinguir início pela pessoa do início autônomo. Rodar os cinco gates ao fim. <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: Revisão: conferir o diff contra o 2_PLAN.md e as diferenças registradas no 3_IMPLEMENTATION.md: - a decisão é gravada antes da escrita; - o início de etapa é gravado também quando o agente roda sozinho pelo próprio interruptor; - mentions fica sem `policy`. Antes de dar como pronto, falta rodar de novo `npx vitest run` completo (com `@playwright/mcp` instalado, para os 4 testes de navegador) e `electron-vite build`. A tela do log não foi aberta no app. <!-- handoff:114 -->
- Passagem revisor-plataforma → qa-plataforma-2: QA: rodar a suíte completa com @playwright/mcp instalado e electron-vite build; abrir a tela do log e conferir política, nível, agente e a marca de alteração. <!-- handoff:120 -->
- Passagem integrator → developer: Veredito: devolver. A base está 160 commits atrás de origin/release/0.11.0, com conflito em 5 arquivos. Os gates passam, e a suíte falha só nos 4 arquivos de navegador (falta @playwright/mcp). Os conflitos em auditoria.ts e Auditoria.tsx se somam aos da #269, que também mexe nesses arquivos. Cenário que falhou: Base em dia com a release aberta. 160 commits atrás de origin/release/0.11.0; merge-tree dá conflito em executor.ts, Auditoria.tsx, auditoria.ts e nos dois ui-today. <!-- handoff:164 -->
- Passagem developer → revisor-plataforma: Revisão/integração: a base `release/0.11.0` foi mesclada com `--no-commit`; o commit da etapa fecha o merge. Conferir que, depois desse commit, a branch fica 0 commits atrás de `origin/release/0.11.0`. Revisar: a resolução de `recordWrite` (a cadeia é calculada sobre a linha já carimbada pelo ato da persona) e a correção das decisões feitas pela persona (`actions.ts` `recordDecision`, `service.ts` `gateBy`, `auditModel.ts` `whoOf`). Os gates passaram depois da mescla (ev-7), menos os 4 testes de navegador, que dependem de `@playwright/mcp`. Falta abrir a tela do log no app. Depois disso, abrir… <!-- handoff:200 -->
- Passagem revisor-plataforma → qa-plataforma-2: QA/Integração: depois do commit de merge do app, conferir que a branch está 0 commits atrás de origin/release/0.11.0, rodar os gates e abrir o PR contra release/0.11.0. A tela do log segue sem ter sido aberta no app. <!-- handoff:206 -->
