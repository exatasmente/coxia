# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade. Dependência: #269 (política de autonomia configurável); esta #268 vai antes ou junto. Squad plataforma, prioridade medium, sem marco.
- Escopo: registrar todo passo autônomo (início de etapa, comando no host, portão, push, pull request, escrita do quadro) e as decisões da pessoa sobre passos retidos, com passo, hora, agente e política em vigor (cinco escolhas + nível/origem). Mudanças de política também. A persona não apaga nem edita. A spec do product owner veio truncada: não se afirma que não há critérios extras.
- Plano seguido: campo opcional `policy` em `AuditEntry` (`auditPolicyOf`/`levelOf` em autonomy.ts); tipos `auto-step`, `decision`, `policy-change`; `saveConfig(next, by='person')` grava a mudança de política; cadeia de hash + `tampered` em `listAudit`; plugins e mentions sem `policy`; sem tela nova.
- Decidido na implementação: a aprovação grava `decision` no momento do "sim", antes da escrita; o início de etapa é gravado também quando a etapa é autônoma pelo interruptor do agente; o texto do pull request usa `{crLong}`.
- Revisão: aprovado, sem bloqueantes. QA: aprovada nos critérios de código/testes.
- Integração: devolver, só por causa da base (item 3).
- Resposta: a issue da política é a #269; esta (#268) é a auditoria.
- Resposta: A issue da política de autonomia configurável é a #269 (esta, #268, é a auditoria). A spec completa do product owner chegou truncada, então não dá para afirmar que não há critérios além dos listados; o corpo da #269 traz 9 critérios de aceite. Escopo: registrar todo passo autônomo e também os retidos que foram aprovados ou recusados, com passo, hora, agente e a política em vigor (com o nível); a persona não apaga o registro. <!-- answer:12 -->

## Restrições

- Textos novos por `t()` com os dois catálogos; CHANGELOG `Unreleased` atualizado; repositório público.
- A #269 não pode ir à produção sem esta. Registros antigos não são reescritos.
- O esquema de configuração não muda nesta tarefa (a branch fica em 28; a release 0.11.0 está em 32).
- Chaves de catálogo não podem ser montadas dinamicamente na tela: usar mapa explícito.
- PR deve ter base `release/0.11.0` (deduzida), não a main. Nunca merge/rebase/commit pelo shell.

## Tentado e descartado

- Tipos novos para cada passo já auditado: descartado em favor do campo `policy`.
- Gravar a decisão depois da escrita: duplicava o resultado e quebrava testes.

## Perguntas abertas

- Formato final do nível (agente/squad/workspace) depende da #269; hoje workspace e fluxo, isolado em `levelOf`.
- Mudanças dos interruptores de autonomia de agente e de squad não geram `policy-change`; cobrir com a #269. A #269 também mexe em auditoria.ts (tipos `screen-*`): conflito provável entre as duas.
- Confirmar a lista de passos contra o texto completo da spec, se houver.
- Limite conhecido: agente `shell: host` pode editar o arquivo; só há detecção (hash). `lastChain` lê 64 KB do fim.
- Pull requests abertos para a release: não consultados.

## Onde o trabalho está

- Integração (esta etapa): tsc, vitest (459/463 arquivos; 4 de navegador falham por falta de @playwright/mcp), theme-audit, i18n:lint, public-audit e build passaram. Apagar `out/` antes do vitest, senão public-audit.test falha com arquivos de build.
- Bloqueante: base 160 commits atrás de origin/release/0.11.0; conflito em executor.ts, Auditoria.tsx, auditoria.ts, ui-today.en/pt-BR.json.
- Não verificado: a tela do log no app; os 4 testes de navegador; os gates depois de trazer a base.
- Próxima etapa: implement traz a base pela ferramenta de conflito e roda os gates; depois PR.
- Passagem integrator → implement: trazer a base (release/0.11.0), resolver os conflitos, rodar os gates de novo, PR contra a release.
- Passagem support → product-owner: Refinar: delimitar \"passo autônomo\" (todos os pontos em que a política decide sem um sim), definir o formato política/nível junto com a #269 e planejar testes com fakes de que a persona não escreve nem apaga o log. <!-- handoff:21 -->
- Passagem product-owner → pessoa: Arquiteto/tech lead: desenhar o registro (campos política e nível em AuditEntry, tipos para decisão sobre passo retido e mudança de política) a partir de `autonomyOf`; alinhar o nome dos níveis com a #269; levantar se a persona tem hoje algum caminho de escrita/remoção do log e planejar testes com fakes (critério 3). Cobrir os seis pontos autônomos listados. <!-- handoff:32 -->
- Passagem tl-plataforma → pessoa: Desenvolvimento: seguir a ordem do 2_PLAN.md. Antes de escrever o registro de início de etapa, confirmar em service.ts/transitions.ts como distinguir início pela pessoa do início autônomo. Rodar os cinco gates ao fim. <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: Revisão: conferir o diff contra o 2_PLAN.md e as diferenças registradas no 3_IMPLEMENTATION.md: - a decisão é gravada antes da escrita; - o início de etapa é gravado também quando o agente roda sozinho pelo próprio interruptor; - mentions fica sem `policy`. Antes de dar como pronto, falta rodar de novo `npx vitest run` completo (com `@playwright/mcp` instalado, para os 4 testes de navegador) e `electron-vite build`. A tela do log não foi aberta no app. <!-- handoff:114 -->
- Passagem revisor-plataforma → qa-plataforma-2: QA: rodar a suíte completa com @playwright/mcp instalado e electron-vite build; abrir a tela do log e conferir política, nível, agente e a marca de alteração. <!-- handoff:120 -->
