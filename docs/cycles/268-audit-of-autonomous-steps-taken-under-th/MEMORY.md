# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade. Dependência: #269 (política de autonomia configurável); esta #268 vai antes/junto. Squad plataforma, prioridade medium, sem marco.
- Escopo: registrar todo passo autônomo (início de etapa, comando no host, portão, push, pull request, escrita do quadro) e decisões da pessoa sobre passos retidos, com passo, hora, agente e política em vigor (cinco escolhas + nível/origem); mudanças de política também; a persona não apaga nem edita. Spec do product owner veio truncada: não se afirma que não há critérios extras.
- Plano (2_PLAN.md pronto): campo opcional `policy` em `AuditEntry` (via `auditPolicyOf`/`levelOf` em autonomy.ts); kinds novos `auto-step`, `decision`, `policy-change`; `saveConfig` é o ponto único para registrar mudança de política; `audited`/`AutoWrite` carregam a política; decisões em `approveAction`/`skipAction`/`gateBy`/`askCommand`; cadeia de hash + `tampered` em `listAudit`; plugins sem `policy`; sem tela nova.
- Resposta: A issue da política de autonomia configurável é a #269 (esta, #268, é a auditoria). A spec completa do product owner chegou truncada, então não dá para afirmar que não há critérios além dos listados; o corpo da #269 traz 9 critérios de aceite. Escopo: registrar todo passo autônomo e também os retidos que foram aprovados ou recusados, com passo, hora, agente e a política em vigor (com o nível); a persona não apaga o registro. <!-- answer:12 -->

## Restrições

- Textos novos por `t()` com os dois catálogos; CHANGELOG `Unreleased` atualizado; repositório público (sem dados reais).
- A #269 não pode ir à produção sem esta. Registros antigos não são reescritos.
- Esquema de configuração não muda nesta tarefa (só leitura).

## Tentado e descartado

- Kinds novos para cada passo já auditado: descartado em favor do campo `policy`.

## Perguntas abertas

- Formato final do nível (agente/squad/workspace) depende da #269; hoje workspace e fluxo, isolado em `levelOf`.
- Confirmar a lista de passos contra o texto completo, se houver.
- Ponto exato do registro de início autônomo de etapa (service.ts `tell` vs `startStage`): confirmar no código ao implementar.
- Limite conhecido: um agente `shell: host` roda como a pessoa e pode editar o arquivo no disco; só há detecção (hash), não prevenção.

## Onde o trabalho está

- Plano feito; próxima etapa: desenvolvimento seguindo 2_PLAN.md. Nada executado nem testado ainda; gates não rodados.
- Passagem support → product-owner: Refinar: delimitar \"passo autônomo\" (todos os pontos em que a política decide sem um sim), definir o formato política/nível junto com a #269 e planejar testes com fakes de que a persona não escreve nem apaga o log. <!-- handoff:21 -->
- Passagem product-owner → pessoa: Arquiteto/tech lead: desenhar o registro (campos política e nível em AuditEntry, tipos para decisão sobre passo retido e mudança de política) a partir de `autonomyOf`; alinhar o nome dos níveis com a #269; levantar se a persona tem hoje algum caminho de escrita/remoção do log e planejar testes com fakes (critério 3). Cobrir os seis pontos autônomos listados. <!-- handoff:32 -->
