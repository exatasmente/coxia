# 85 Onboarding starts with the model provider and ships Coxia's own skills

- Endereço: https://github.com/exatasmente/coxia/issues/85
- Estado: open
- Rótulos: coxia, priority:high
- Autor: exatasmente

## Descrição

## What should happen

A fresh install configures the LLM integration first, before any other integration, so the onboarding happens with Coxia's built-in agents rather than through a form of code-host settings.

Today the wizard has nine steps (`src/shared/wizard.ts:10`) and the models step is skippable. Change it so the first thing the person does is choose how the app talks to a model, and so the wizard says in one sentence that without a model no agent runs.

Alongside it, Coxia ships its own skills (default/reference, or clearly marked preview) to make the setup easier: the person picks a skill from a catalog instead of assembling a folder by hand. Today `docs.skillsDirs` only points an agent at a directory (`src/shared/wizard.ts:303,311`); there is no catalog of Coxia skills.

## Out of scope

Which engine (Claude SDK or the open loop) and which providers — those already exist and do not change. Community/third-party skills: those belong to the plugin work.

## Acceptance

- A fresh install opens on the model-provider choice before any other integration.
- Skipping the model provider is possible but the wizard states that agents will not run.
- There is a catalog of Coxia skills; each is marked ready or preview; applying one needs no manual folder work.

## Notes

Functional specification only; the solution design belongs to refinement and planning.

## Comentários

(sem comentários)
