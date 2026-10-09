# Memória do ciclo

## Decisões

- Triagem da #165: **tarefa de integração pós-release** (não bug, não feature): antes do próximo corte, conferir os PRs da #142 (conflitou com release/0.8.0) e da #121 (conflitou com a main) e decidir se o merge espera rebase. Sem pergunta ao repórter.
- O conteúdo das duas entregas já consta do changebook (catálogos `## [0.8.0]` e `## [0.9.0-beta.2]`, ambos de 2026-10-08); conflito citado só na issue.
- `1_SPEC.md` (refinamento) e `2_PLAN.md` (plano técnico) escritos. O plano: ação no host, sem mudança de código — ler estado por PR, cruzar com o changebook, registrar uma decisão por PR (rebase-e-merge recomendado ao mantenedor, ou fechar-por-entregue apontando a entrada do catálogo), nota no ciclo com a trilha, corte bloqueado até as decisões.
- Prioridade: `priority:medium`; marco: corte seguinte de versão (0.9.0). Squad: plataforma.

## Restrições

- O estado real dos dois PRs no host **não foi verificado** em nenhuma etapa até aqui; só a conferência no host (implementação/verificação) o confirma.
- A decisão de aceitação final por PR é do mantenedor; a etapa registra estado e recomendação, não decisão em nome dele.
- Conteúdo faltante na main descoberto na conferência vira pedido novo, não entra por aqui.

## Tentado e descartado

- Perguntar ao repórter: descartado, nada só dele falta.
- Tratar como bug ou duplicata: descartado.
- Automatizar a conferência no ciclo de release: fora do escopo; pedido próprio se fizer sentido.
- Escrever teste ou código no plano: sem sentido para uma ação de fluxo; os critérios de aceite são conferidos contra o estado real do host.

## Perguntas abertas

- Estado atual dos dois PRs no host (aberto/fechado, base, conflito): responde a etapa de implementação/verificação.
- Se algum PR ainda valer algo, rebasear ou fechar por entregue: decisão do mantenedor com os dados da conferência.

## Onde o trabalho está

- Triagem, refinamento e plano concluídos (`0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`); nenhum código mudado. Próxima etapa: implementação/verificação com acesso ao host (roubo as passagens 1–5 do plano), antes do próximo corte de versão. A decisão final por PR é do mantenedor.
- Passagem product-owner → pessoa: Implementação/verificação (etapa com acesso ao host): ler no host o estado atual dos PRs ligados às issues #142 e #121 (aberto/fechado, base, se ainda conflitam); registrar por PR a decisão de rebase-e-merge ou de fechar-por-entregue (apontando a entrada do catálogo de mudanças de 0.8.0 ou de 0.9.0-beta.2), seguindo a spec 1_SPEC.md; garantir que a decisão fica antes de qualquer próximo corte de versão. A decisão final por PR é do mantenedor. <!-- handoff:12 -->
