# 83 Own board in Coxia with optional code-host integration

- Endereço: https://github.com/exatasmente/coxia/issues/83
- Estado: open
- Rótulos: coxia, priority:low
- Autor: exatasmente

## Descrição

## What should happen

The code-host integration (GitLab, GitHub, Bitbucket) becomes optional: a workspace runs with no host at all. Coxia gains its own board, which works on its own and, when a host is connected, stays in step with it.

Today the code hosts exist behind a neutral interface (`src/main/vcs/`, `docs/vcs-providers.md`) but there is no board in Coxia: the cards come from the host. No code in the tree starts such a board; this is new capability.

## What the person must decide

- Which side is the source of truth: the Coxia board with the host mirrored, or the host with the board caching it. This is a scope decision and changes the rest of the item.

## Acceptance

- A workspace with no VCS configured creates, moves and lists cards on the Coxia board.
- With a host connected, the same card appears on both sides and does not become two competing records.

## Notes

Functional specification only; the sync model is for refinement and planning.

## Comentários

### exatasmente, 2026-10-06T19:02:58Z

Mantida, sem entrar no ciclo ainda: falta decidir qual lado é a fonte da verdade (o quadro do Coxia ou o host). Depois vira épico em duas partes: quadro local e sincronização com o host.
