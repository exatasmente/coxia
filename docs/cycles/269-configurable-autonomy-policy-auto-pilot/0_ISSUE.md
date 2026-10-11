# 269 Configurable autonomy policy (auto-pilot) at agent, squad and workspace levels

- Endereço: https://github.com/exatasmente/coxia/issues/269
- Estado: open
- Rótulos: coxia, priority:medium
- Autor: exatasmente

## Descrição

## What changes for the user
Today every irreversible step taken by the persona asks for the person's approval. With this policy, the person defines which step types the persona runs on its own and which keep asking. Anyone who configures nothing sees no change.

## Rules
1. The policy states, for each existing step type, whether it is *held* (asks for approval) or *autonomous* (runs without asking).
2. The policy is configurable at 3 levels: agent, squad and workspace.
3. Precedence: the agent level wins if configured; otherwise the squad level; otherwise the workspace level.
4. The default policy keeps everything held, so today's behavior does not change.
5. Payment, sending to humans, secrets and card data are always held. If the policy tries to release them, the release is ignored and the user sees a warning.
6. The prompt text `runner.rules.screen*` is generated from the policy in effect, so the prompt never says one thing while the app does another.
7. Changing the policy takes effect from the next stage and is recorded.
8. `screen_handoff` keeps existing and works as today.
9. The settings screen shows the mode (held or autonomous) of each step type and which level it comes from.
10. All new user-facing text goes through `t()` with both catalogs updated, and the `Unreleased` section of CHANGELOG.md is updated.

## Acceptance criteria
- With nothing configured, "Submit payment" still asks for approval.
- A step released in the policy runs without asking and produces an audit record.
- A release of payment, human sending, secrets or card data is ignored with a warning.
- Precedence agent > squad > workspace is covered by tests with fakes.
- The settings screen shows mode and source level per step type.
- A policy change applies on the next stage and is recorded.
- Prompt text matches the policy in effect.
- `screen_handoff` behavior is unchanged.
- New strings exist in both catalogs; CHANGELOG updated.

## Out of scope
New step types; any release of payment, human sending, secrets or card data.

## Dependency
This issue must not ship to production without the audit issue (autonomy audit of autonomous steps).

Note: references to current code (screenPrompt.ts, i18n catalogs) come from earlier discussion and were not re-verified.

## Comentários

(sem comentários)
