# 5 Suggest new agents from what the cycle learns

- Endereço: https://github.com/exatasmente/coxia/issues/5
- Estado: open
- Rótulos: enhancement
- Autor: exatasmente

## Descrição

## The problem

Nothing in the app notices that a stage keeps being done by hand, that the same kind of
question keeps coming back, or that a step is being repeated that could be its own agent.
The team shape is whatever the maintainer configured once, and it does not learn.

## What we want

The system proposes a new agent from what it learns from the cycle history: a name, a
role, the stage it would cover, and a draft prompt. The proposal goes through
**accept, edit or reject**, and the decision is recorded — a rejected suggestion must not
come back unchanged.

## Notes

- Whatever the suggestion is derived from (ceremony transcripts, stage durations, repeated
  manual steps) must be visible in the proposal: no suggestion without the evidence that
  produced it.
- Never applied silently. An accepted suggestion creates an ordinary agent the user can
  edit afterwards.
- Depends on agents existing as entities.

## Comentários

(sem comentários)
