# Memória do ciclo

## Decisões

- Triagem da #165: **tarefa de integração pós-release** (não bug, não feature): antes do próximo corte, conferir os PRs da #142 (conflitou com release/0.8.0) e da #121 (conflitou com a main) e decidir se o merge espera rebase. Sem pergunta ao repórter; a issue se entende como está.
- Por leitura do changebook e das memórias das #142 e #121: o conteúdo das duas entregas já consta na linha principal (catálogo `## [0.8.0]` e `## [0.9.0-beta.2]`, ambas de 2026-10-08); conflito citado só na issue. Confere com "skipados e refletidos depois por novas ações".
- Refinamento concluído: `1_SPEC.md` escrito — tarefa de conferência no host antes de qualquer próximo corte de versão: por PR (os das #142 e #121), registrar estado (aberto/fechado, base, conflito atual) e decidir entre rebase-e-merge ou fechar-por-entregue (apontando de onde o conteúdo já veio). Critérios de aceite: estado registrado por PR, uma decisão por PR, corte só depois das decisões, nada duplicado na main.
- Prioridade proposta e mantida do refino anterior: `priority:medium` (conferência de higiene; decisão final do refinamento do produto). Marco proposto: corte seguinte de versão (0.9.0).
- Squad: plataforma (o assunto é fluxo de VCS/release, não tela).

## Restrições

- Esta etapa só leu; o estado real dos PRs no host **não foi verificado** e não é verificável sem acesso de rede ao host. A implementação/verificação com acesso ao host executa a conferência da spec.
- A decisão de aceitação final por PR (rebasear ou fechar como entregues por outro caminho) é do mantenedor, com os dados da conferência em mão.

## Tentado e descartado

- Perguntar ao repórter: descartado, nada só dele falta.
- Tratar como bug ou duplicata: descartado.
- Automatizar a conferência no ciclo de release: fora do escopo desta ação; se fizer sentido, vira pedido próprio.

## Perguntas abertas

- Estado atual dos dois PRs no host: abertos ou fechados, base de cada um, se ainda conflitam. Responde-se na conferência da implementação (acesso ao host).
- A decisão por PR: rebase e merge, ou fechar e considerar o conteúdo já na main pelo caminho que o changebook registra. Decide o mantenedor com os dados da conferência.

## Onde o trabalho está

- Triagem e refinamento concluídos (`0_TRIAGE.md`, `1_SPEC.md`); nenhum código mudado. Próxima etapa: implementação/verificação com acesso ao host — conferir os PRs e registrar as decisões por PR, antes do próximo corte de versão.
