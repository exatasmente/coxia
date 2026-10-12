# 268 Audit of autonomous steps taken under the autonomy policy

- Endereço: https://github.com/exatasmente/coxia/issues/268
- Estado: open
- Rótulos: coxia, priority:medium
- Autor: exatasmente

## Descrição

## What changes for the user
Every step the persona takes without asking is recorded, so the person can see what was done on their behalf, when, and under which policy.

## Rules
1. Each autonomous step creates a record with the step, the time, the agent, and the policy in effect (including the level it came from).
2. Held steps that the person approved or refused are also recorded.
3. The persona cannot delete or edit the audit records.
4. Policy changes are recorded.
5. All new user-facing text goes through `t()` with both catalogs updated, and the `Unreleased` section of CHANGELOG.md is updated.

## Acceptance criteria
- An autonomous step produces a record with step, time, agent, policy and level.
- An approved or refused held step produces a record.
- The persona has no way to delete or alter records (covered by tests with fakes).
- A policy change produces a record.
- New strings exist in both catalogs; CHANGELOG updated.

## Dependency
The configurable autonomy policy issue must not ship to production without this one.

Note: the original spec was truncated when this was drafted; review the criteria against the product-owner's full text before approving.

## Comentários

(sem comentários)
