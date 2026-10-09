# Memória do ciclo

## Decisões

- Conferência dos dois pedidos de mudança fechada sem ação no host: o pedido da #142 (#146) e o da #121 (#131) já estão juntados na ramificação release/0.8.0 (08/10 e 07/10/2026), com verificação verde; não cabe rebase-e-merge nem fechar-por-entregue para nenhum.
- O corte da próxima versão não está bloqueado por estes dois pedidos (pré-condição da spec satisfeita pelo estado real do host).
- Nota de lançamento e comentário ao autor da issue entregues pela etapa de comunicação (6_RELEASE_NOTE.md na pasta do ciclo).

## Restrições

- No product-code changes for testing; scripts and artifacts stayed in /coxia/out (none in the worktree).
- Sem código, tela ou teste novo neste ciclo — nenhum dado novo para as portas do repositório.
- Decisão final por pedido de mudança é do mantenedor; agentes só registram estado e recomendação.

## Tentado e descartado

- Nenhum comentário novo escrito no host: ambos os pedidos já carregam estado final (juntado), então nem rebase nem fechamento por entregue se aplicam.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Ciclo completo até a comunicação: spec (1_SPEC.md), plano (2_PLAN.md), implementação (3_IMPLEMENTATION.md), revisão aprovada (4_REVIEW.md), QA (5_TEST_PLAN.md, dois cenários executados com comprovante da leitura do host) e nota de lançamento (6_RELEASE_NOTE.md).
- Estado dos pedidos lido na data de 2026-10-09: #146 e #131 merged em release/0.8.0, CI verde, hasConflicts=true residual contra a base atual sem nada pendente; assuntos de ambos no catálogo 0.8.0, com desdobramentos em 0.9.0-beta.1/2.
- Não verificado: conteúdo juntado confiado pela comparação árvore a árvore (confirmação usada: estado de juntado no host + registro de mudanças); portas do repositório não rodadas por não haver código novo.
- Passagem product-owner → pessoa: Implementação/verificação (etapa com acesso ao host): ler no host o estado atual dos PRs ligados às issues #142 e #121 (aberto/fechado, base, se ainda conflitam); registrar por PR a decisão de rebase-e-merge ou de fechar-por-entregue (apontando a entrada do catálogo de mudanças de 0.8.0 ou de 0.9.0-beta.2), seguindo a spec 1_SPEC.md; garantir que a decisão fica antes de qualquer próximo corte de versão. A decisão final por PR é do mantenedor. <!-- handoff:12 -->
- Passagem tl-plataforma → pessoa: Implementação/verificação (etapa com acesso ao host), seguindo o 2_PLAN.md: (1) ler no host o estado de cada um dos dois pedidos de mudança vinculados às issues #142 e #121 — aberto/fechado, base atual, se ainda conflita; (2) cruzar com as entradas do registro de mudanças (catálogo 0.8.0 para a #121, 0.9.0-beta.2 para a #142); (3) registrar por pedido uma decisão — rebase-e-merge (com recomendação ao mantenedor, que decide) ou fechar-por-entregue com comentário apontando a entrada do catálogo; (4) escrever nota do ciclo com o estado lido e a decisão de cada pedido; (5) declarar o bloqueio do c… <!-- handoff:23 -->
