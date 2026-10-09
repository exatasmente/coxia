# Memória do ciclo

## Decisões

- Triagem da 189 fechada: **pedido de processo (condução do ciclo)**, não bug de código — reemitir a prioridade por squad usando a config de squads do workspace; prioridade por squad é decisão conduzida pelo ciclo, não funcionalidade do app (`src/shared/config/types.ts`/`squads.ts`, sem prioridade em `src`).
- Execução concluída (3_IMPLEMENTATION.md): a regra priority-ordering.md (`.claude/rules/` do checkout do app), os minutos da retro de 2026-10-08 e a config real de squads foram **lidos diretamente** nesta etapa — os resumos anteriores foram descartados. Config real: **plataforma** (labels area:plataforma; paths src/main/runner, src/main/sandbox, src/main/engine, src/main/vcs, src/main/actions.ts, src/main/webPolicy.ts, src/shared/config, src/shared/runs; unclaimed false; liaison tl-plataforma) e **experiencia** (labels area:experiencia; paths src/renderer, src/shared/i18n, sidecar; unclaimed false; liaison tl-experiencia); priority.labels = ^priority:high$, ^priority:medium$, ^priority:low$ (todas graváveis, label simples).
- Alocação reemitida: reemissão da prioridade → **plataforma**, pela entrada citada da config (path `src/shared/config`, label `area:plataforma`); nenhuma adesão à experiencia; fallback unclaimed não necessário (ambos os squads trazem unclaimed: false).
- Rótulo do tracker: **proposta `priority:medium`** esperando aceite — a issue não tem label hoje, então a ordenação da regra sozinha não casa nada (prioridade do cartão seria null); medium é a hipótese do refino válida como label simples da config (2ª entrada). Alternativa da regra literal (não escrever nada) registrada em 3_IMPLEMENTATION.md.
- Comparativo com a decisão original de 2026-10-08 registrado na tabela de 3_IMPLEMENTATION.md (base, alocação, fallback, rótulo, designação).

## Restrições

- Nada de empresa, host real, número de issue real alheia ou segredo em qualquer texto do repositório (auditoria pública).
- Rótulo do tracker sai só de label simples; nunca de expressão de casamento.
- Gravação no tracker: sempre proposta auditada esperando aceite da pessoa.

## Tentado e descartado

- Resumos anteriores da regra, da ata e da config: descartados em favor da leitura direta feita nesta etapa (via shell, pois Read/Glob são limitados à pasta de trabalho).

## Perguntas abertas

- Aceite ou recusa da proposta de rótulo `priority:medium` na issue (única pendência; do lado da pessoa).

## Onde o trabalho está

- `3_IMPLEMENTATION.md` escrito na pasta do ciclo (dentro da worktree), com lista de squads, análise de adesão, designação, proposta de rótulo e comparativo. Nenhum arquivo de `src` alterado; nenhum gate rodado (sem código a conferir).
- Próximo: aceite da proposta de rótulo pela pessoa (proposta auditada), e levar a decisão reemitida à ata da próxima retro.
