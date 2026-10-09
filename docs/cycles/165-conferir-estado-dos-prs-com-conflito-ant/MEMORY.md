# Memória do ciclo

## Decisões

## Restrições

- No product-code changes for testing; scripts and artifacts stayed in /coxia/out (none in the worktree).

## Tentado e descartado

## Perguntas abertas

## Onde o trabalho está

- 5_TEST_PLAN.md in the cycle folder carries the two executed scenarios with evidence ids; all evidence is stage-recorded, nothing committed to the repo by QA.
- Passagem product-owner → pessoa: Implementação/verificação (etapa com acesso ao host): ler no host o estado atual dos PRs ligados às issues #142 e #121 (aberto/fechado, base, se ainda conflitam); registrar por PR a decisão de rebase-e-merge ou de fechar-por-entregue (apontando a entrada do catálogo de mudanças de 0.8.0 ou de 0.9.0-beta.2), seguindo a spec 1_SPEC.md; garantir que a decisão fica antes de qualquer próximo corte de versão. A decisão final por PR é do mantenedor. <!-- handoff:12 -->
- Passagem tl-plataforma → pessoa: Implementação/verificação (etapa com acesso ao host), seguindo o 2_PLAN.md: (1) ler no host o estado de cada um dos dois pedidos de mudança vinculados às issues #142 e #121 — aberto/fechado, base atual, se ainda conflita; (2) cruzar com as entradas do registro de mudanças (catálogo 0.8.0 para a #121, 0.9.0-beta.2 para a #142); (3) registrar por pedido uma decisão — rebase-e-merge (com recomendação ao mantenedor, que decide) ou fechar-por-entregue com comentário apontando a entrada do catálogo; (4) escrever nota do ciclo com o estado lido e a decisão de cada pedido; (5) declarar o bloqueio do c… <!-- handoff:23 -->
