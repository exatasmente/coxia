# 82 Artifacts for prototyping and requirements, with a user manual

- Endereço: https://github.com/exatasmente/coxia/issues/82
- Estado: open
- Rótulos: coxia, priority:low
- Autor: exatasmente

## Descrição

## Scope (updated 2026-10-06)

The plugin platform (#84) already lets a plugin add document types to a run's cycle folder. What remains: (1) a built-in plugin declares the requirements, prototype and user-manual documents; (2) the cycle's phase and gate read them; (3) the user manual comes out of the flow in a predictable place. High-fidelity prototyping stays out.

---

## What should happen

The cycle's artifacts grow to cover a prototyping and requirements-engineering flow, including a user manual. New artifact types are added through the plugin platform, so the set can vary without changing the core.

Today the artifacts live versioned in `docs/cycles/<n>-<slug>/` (`rules/cycle-artifacts.md`) and the app reads their phase and gate through `specLayout`. The new types have to fit that reading model, or the app will not see the card's phase.

## Out of scope

A high-fidelity prototype plugin itself: that is one plugin built on the platform, not part of this item.

## Acceptance

- A new artifact type for prototyping or requirements is added without touching the core.
- The app still reads the phase and the gate of a card whose folder carries the new types.
- The user manual is produced as an artifact of the flow and stays where the person expects to find it.

## Notes

Functional specification only; the artifact layout is for refinement and planning. Depends on the plugin platform item.

## Comentários

### exatasmente, 2026-10-06T19:02:53Z

Escopo ajustado: a base (tipos de documento declarados por plugin) saiu com #84. Falta declarar os documentos de requisitos, protótipo e manual num plugin embutido e conferir que a fase e o gate os leem.
