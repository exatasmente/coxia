# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade. Dependência: #269 (política de autonomia configurável); esta #268 vai antes ou junto. Squad plataforma, prioridade medium, sem marco.
- Escopo: registrar todo passo autônomo (início de etapa, comando no host, portão, push, pull request, escrita do quadro) e as decisões da pessoa sobre passos retidos, com passo, hora, agente e política em vigor (cinco escolhas + nível/origem). Mudanças de política também. A persona não apaga nem edita. A spec do product owner veio truncada: não se afirma que não há critérios extras.
- Plano seguido: campo opcional `policy` em `AuditEntry` (`auditPolicyOf`/`levelOf` em autonomy.ts); tipos `auto-step`, `decision`, `policy-change`; `saveConfig(next, by='person')` grava a mudança de política; cadeia de hash + `tampered` em `listAudit`; plugins e mentions sem `policy`; sem tela nova (a tela atual do log mostra os campos novos).
- Decidido na implementação:
  - a aprovação grava `decision` no momento do "sim" (depois das guardas, antes da escrita, `ok: true`); a escrita grava a própria linha;
  - o início de etapa é gravado também quando a etapa é autônoma pelo interruptor do próprio agente (a política mostra `cycle: false`);
  - o texto da escolha de pull request usa `{crLong}` (o teste host-terms-leak barra "pull request" literal).
- Resposta: A issue da política de autonomia configurável é a #269 (esta, #268, é a auditoria). A spec completa do product owner chegou truncada, então não dá para afirmar que não há critérios além dos listados; o corpo da #269 traz 9 critérios de aceite. Escopo: registrar todo passo autônomo e também os retidos que foram aprovados ou recusados, com passo, hora, agente e a política em vigor (com o nível); a persona não apaga o registro. <!-- answer:12 -->

## Restrições

- Textos novos por `t()` com os dois catálogos; CHANGELOG `Unreleased` atualizado; repositório público (sem dados reais).
- A #269 não pode ir à produção sem esta. Registros antigos não são reescritos.
- O esquema de configuração não muda nesta tarefa (só leitura).
- Chaves de catálogo não podem ser montadas dinamicamente na tela (o ui-i18n.test acusa chave sem uso): usar um mapa explícito.

## Tentado e descartado

- Tipos novos para cada passo já auditado: descartado em favor do campo `policy`.
- Gravar a decisão de aprovação depois da escrita, com o resultado dela: duplicava o resultado e quebrava os testes que leem a escrita como a linha mais nova.

## Perguntas abertas

- O formato final do nível (agente/squad/workspace) depende da #269; hoje é workspace e fluxo, isolado em `levelOf`.
- Confirmar a lista de passos contra o texto completo da spec, se houver.
- Limite conhecido: um agente `shell: host` roda como a pessoa e pode editar o arquivo no disco; só há detecção (hash), não prevenção.

## Onde o trabalho está

- Implementação feita (3_IMPLEMENTATION.md). O código está no worktree, sem commit do app ainda.
- Verificado nesta etapa:
  - `tsc`, theme-audit, i18n:lint e public-audit passaram;
  - vitest completo: 457/463 arquivos (ev-1); os 4 de navegador falham por falta de `@playwright/mcp` no worktree (ambiente); as 3 falhas restantes foram corrigidas e os dois arquivos rodados de novo passaram (31/31).
- Não verificado:
  - a suíte completa não foi rodada de novo depois das correções;
  - `electron-vite build`;
  - a tela do log aberta no app.
- Helper de teste `test/helpers/audit.ts` (`writesOf`/`autonomyLines`): os testes antigos de escrita leem só as escritas.
- Próxima etapa: revisão.
- Passagem support → product-owner: Refinar: delimitar \"passo autônomo\" (todos os pontos em que a política decide sem um sim), definir o formato política/nível junto com a #269 e planejar testes com fakes de que a persona não escreve nem apaga o log. <!-- handoff:21 -->
- Passagem product-owner → pessoa: Arquiteto/tech lead: desenhar o registro (campos política e nível em AuditEntry, tipos para decisão sobre passo retido e mudança de política) a partir de `autonomyOf`; alinhar o nome dos níveis com a #269; levantar se a persona tem hoje algum caminho de escrita/remoção do log e planejar testes com fakes (critério 3). Cobrir os seis pontos autônomos listados. <!-- handoff:32 -->
- Passagem tl-plataforma → pessoa: Desenvolvimento: seguir a ordem do 2_PLAN.md. Antes de escrever o registro de início de etapa, confirmar em service.ts/transitions.ts como distinguir início pela pessoa do início autônomo. Rodar os cinco gates ao fim. <!-- handoff:49 -->
