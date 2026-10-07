# 54 Say that the runner only starts labeled issues that are assigned to the person

- Endereço: https://github.com/exatasmente/coxia/issues/54
- Estado: open
- Rótulos: documentation, enhancement, coxia, priority:medium
- Autor: exatasmente

## Descrição

## Scope (updated 2026-10-06)

Documentation and hint only: say, where the trigger label is configured and documented, that the runner starts an issue that carries the label **and** is assigned to the person, and how each code host filters by assignee. The list of labeled issues with nobody assigned, on the runs screen, is #105.

---

## The problem

The runner starts a run by itself only for an open issue that carries `runner.triggerLabel` **and is assigned to the person**. On GitHub the lookup is `listMyIssues`, which asks for `assignee=<current user>` (`src/main/runner/module.ts`, `triggered`; `src/main/vcs/github.ts`). Only `docs/runner.md` says so. The other places a person reads leave out the assignment:

- `docs/configuration.md`, the `runner` block, in both languages, says the app starts runs "for the issues that carry the `triggerLabel` label".
- The runner settings screen (`src/renderer/src/screens/team/RunnerSection.tsx`) labels the field "Label that asks for a run", and the hint only says "Case does not matter."

So a person puts the label on an issue nobody is assigned to, and nothing happens. No message says why. The issue only starts once someone assigns it.

## What you would like to happen

- **The docs say it:** `docs/configuration.md` (pt-BR and English) says the issue must be open, carry the label and be assigned to the person, and links to the paragraph in `docs/runner.md`.
- **The settings screen says it:** the hint of the trigger label says the issue must also be assigned to the person, in both catalogs.
- **The app says when an issue is left out:** on the runs screen, an open issue that carries the trigger label and is assigned to nobody shows as "has the label, assigned to no one: it will not start", with a way to start it by hand. Labeled issues assigned to someone else are left alone.

## Alternatives you considered

- **Drop the assignment requirement and start any open issue with the label.** On a shared repository, anyone who can label an issue would start runs on the person's machine and spend their model budget. The assignment is the person's way of saying "mine". If this changes, it should be a setting that defaults to assigned only.

## Notes

- GitLab and Bitbucket go through the same `listMyIssues`. Check that each one filters by assignee the same way, and say so in `docs/vcs-providers.md` if one differs.

## Comentários

### exatasmente, 2026-10-06T19:02:24Z

Escopo reduzido à documentação e à dica do campo do gatilho (`docs/configuration.md` nos dois idiomas, `ui.runner.triggerHint` nos dois catálogos, uma linha em `docs/vcs-providers.md` sobre o filtro por responsável nos três hosts). O aviso na tela de execuções foi para #105.
