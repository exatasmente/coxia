# 84 Plugin platform: extension points for hooks, events and actions

- Endereço: https://github.com/exatasmente/coxia/issues/84
- Estado: open
- Rótulos: coxia, priority:high
- Autor: exatasmente

## Descrição

## What should happen

Everything new in Coxia should extend the platform through plugins — hooks, events and actions — rather than being added to the core. Prototypes, Clockify, Jira and the other integrations are the examples; none of them should require changing the core.

Today there is no plugin concept in the code: `grep -i plugin` under `cerimonias/src` returns nothing, and `src/shared/config/types.ts` has no field for plugins or extension points. This is a platform to build, not a switch to flip.

This is the foundation the other items depend on: without it, new artifact types and new integrations become ad-hoc code.

## What the person must decide

- The minimum scope of the first plugin: one new artifact plus one external integration (for example Clockify) would exercise event → artifact → external effect without opening three fronts at once.
- The boundary of a plugin: what it can see, what it can trigger and where it runs. A public app that runs plugin code against people's data needs this boundary defined before any plugin ships.

## Acceptance

- A new plugin installs and extends the app without modifying the core.
- A plugin does not reach secrets or another workspace's data without an explicit permission.
- A new artifact type is addable without touching the core (the test case for the platform).

## Notes

Functional specification only; the extension contract is for refinement and planning.

## Comentários

(sem comentários)
