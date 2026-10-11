# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (só lido).
- Dependência: #269 (política de autonomia configurável; 9 critérios). Esta #268 é a auditoria e deve ir antes/junto.
- Escopo (pessoa): registrar todo passo autônomo e os retidos aprovados/recusados, com passo, hora, agente e política em vigor (com nível); a persona não apaga o registro; mudanças de política também.
- Spec do product owner veio truncada: não se afirma que não há critérios extras.
- Refino (1_SPEC.md pronto): "passo autônomo" = início de etapa, comando no host, portão, push, pull request e escrita do quadro, sempre que a política decide sem um sim. Política gravada = bloco efetivo (cinco escolhas) + origem (workspace/fluxo; níveis agente/squad/workspace da #269 quando existirem). Registros próprios para decisão sobre passo retido e para mudança de política.
- Squad: plataforma. Prioridade: medium (mantida). Sem marco.
- Resposta: A issue da política de autonomia configurável é a #269 (esta, #268, é a auditoria). A spec completa do product owner chegou truncada, então não dá para afirmar que não há critérios além dos listados; o corpo da #269 traz 9 critérios de aceite. Escopo: registrar todo passo autônomo e também os retidos que foram aprovados ou recusados, com passo, hora, agente e a política em vigor (com o nível); a persona não apaga o registro. <!-- answer:12 -->

## Restrições

- Textos novos por `t()` com os dois catálogos; CHANGELOG `Unreleased` atualizado.
- A #269 não pode ir à produção sem esta.
- Registros antigos não são reescritos. Sem tela nova de consulta (proposta; ver abertas).

## Tentado e descartado

- Nada.

## Perguntas abertas

- Formato final do campo "nível": depende da #269 (por ora workspace e fluxo).
- Confirmar a lista de passos contra o texto completo, se houver.
- Visão do log: só campos novos na visão existente (proposta).

## Onde o trabalho está

- Refinamento feito; próxima etapa: desenho técnico. Código relevante: `auditoria.jsonl`, `src/shared/auditoria.ts` (AuditEntry tem `by`, sem política/nível nem tipo para mudança de política), `src/main/actions.ts`, `src/main/runner/publish.ts`, `autonomyOf`/`EffectiveAutonomy` em `src/shared/config/autonomy.ts`. Não verificado: caminhos de escrita/remoção da persona no log (critério 3 exige testes com fakes).
- Passagem support → product-owner: Refinar: delimitar \"passo autônomo\" (todos os pontos em que a política decide sem um sim), definir o formato política/nível junto com a #269 e planejar testes com fakes de que a persona não escreve nem apaga o log. <!-- handoff:21 -->
