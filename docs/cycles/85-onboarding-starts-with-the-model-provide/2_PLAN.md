# Make language and name open the setup, put the model choice right after it and say on that step that no agent runs without a provider

## Approach

The install order stays a data question answered in one place. The first entry of the wizard's step list is the language step today and stays it; the entry that follows becomes the model step, and that is the whole reordering — the screens are built from that list, so moving the entry moves the screen, the rail and the counter together, with no screen rewritten. The footer decides its buttons from the position and from the step's identity, not from the screen's name: the way of leaving a fresh install unanswered is already bound to the opening position and follows the language step to wherever it sits, and the way of skipping an answer is bound to the list of steps that may be skipped and follows the model step. Where the model step sits decides the second sentence of the one-line statement on the model screen, which is a new text in both catalogs, read next to the notice about a claude.ai subscription; skipping the step stays possible and stays blocked from "Continue" with no provider, exactly as today. The assistant's own opening subtitle is corrected to describe the new first step and to stop pointing at finishing the setup in Settings, since a fresh install no longer leaves that way. Nothing else in the app is touched: no new screen, no new button, no change to the engines, the providers, the connection test or the blocking rule.

## Files and functions

| File | Change |
|---|---|
| `src/shared/wizard.ts:10` | `WIZARD_STEPS` becomes `['language', 'models', 'sdk', ...]`. The array is the single source of the order: `visibleSteps` (`:52-54`) derives the screens and the counter from it, `emptyProgress` (`:56-58`) opens on `WIZARD_STEPS[0]`, and `parseProgress` (`:61-68`) validates a stored step against it. |
| `src/shared/wizard.ts:14` | `SKIPPABLE_STEPS` already lists `models` and does not list `language`; it is left as it is. With the new order it is derivable as "everything after the opening step except the review", which is written in the doc comment above it and asserted in the test (see below). |
| `src/renderer/src/wizard/SetupWizard.tsx:37-47` | `BODY` is keyed by step id, not by position: no change. |
| `src/renderer/src/wizard/SetupWizard.tsx:136-166` | `index` comes from `steps.indexOf(step)`; the counter reads `index + 1` and the total is `steps.length`. Both follow the new order with no change; the header text stays `wizard.progress`. |
| `src/renderer/src/wizard/SetupWizard.tsx:229,287-288` | `skippable = SKIPPABLE_STEPS.includes(current)` and `firstRun && index === 0` are position- and identity-based: no change. Confirmed by reading that the two buttons move with the step, not with its name. |
| `src/renderer/src/wizard/SetupWizard.tsx:50-57` | `stepProblem` keeps `wizard.problem.noProvider` for the model step. No change: the sentence added on the screen explains the block, it does not replace it. |
| `src/renderer/src/wizard/steps/ModelsStep.tsx:221-224` | Add one `Notice` beside the existing `wizard.models.noSubscription` notice, through `t()`, with the new key. Icons and tones come from `Notice` (`wizard/ui.tsx`), which already uses theme tokens. |
| `src/shared/i18n/wizard.en.json:5` | `wizard.subtitle.first` no longer says that every step except the first and the last may be skipped and picked up later; it names language and name as the first step and says that the steps after it, up to the review, may be skipped. |
| `src/shared/i18n/wizard.pt-BR.json:5` | Same value, same key, same placeholders (`wizard.subtitle.first` carries none today). |
| `src/shared/i18n/wizard.en.json:74` area | New key `wizard.models.noModelNoAgent`, one sentence, placed next to `wizard.models.noSubscription` so the two notices read together. |
| `src/shared/i18n/wizard.pt-BR.json:74` area | Same key, same placeholders (none). |
| `test/wizard-shared.test.ts:7-25` | Assert the order of `WIZARD_STEPS` by name, and assert `SKIPPABLE_STEPS` against the array instead of against a hand-written list, so a later shuffle cannot silently make the opening step skippable or the model step unskippable. |
| `test/wizard-i18n.test.ts` | No change needed (verified by reading): the file walks `src/renderer/src/wizard` for `wizard.*` literals, expands `wizard.step.${...}` from `WIZARD_STEPS` (`:36`) and checks both catalogs define the same keys with the same placeholders (`:71-84`). The new key is picked up from `ModelsStep.tsx` automatically, and both catalogs must carry it or the test fails. |
| `CHANGELOG.md:7-11` | One line under `## [Unreleased]` → `### Changed`, in the voice of the file, saying what the person sees; no internal reference. |

Not touched, deliberately: `src/main/config-resolve.ts` (the failure of an agent call with no provider), `src/main/wizard.ts` and `wizard-core.ts`, `src/shared/config/*`, the provider editor inside the model step, `DocsStep` and its `docs.skillsDirs` list, `src/shared/cycles/*` and the runner.

## Order of work

1. Reorder `WIZARD_STEPS` and fix the doc comment above `SKIPPABLE_STEPS`; run `npx vitest run test/wizard-shared.test.ts`.
2. Add the sentence to both wizard catalogs and render it on the model screen; run `npx vitest run test/wizard-i18n.test.ts`.
3. Rewrite `wizard.subtitle.first` in both catalogs.
4. Add the line to `CHANGELOG.md`.
5. Run the whole gate: `nvm use`, `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

A commit per logical change (`reorder the wizard so the model choice follows language and name`, `add the wizard sentence about running without a model provider`), lowercase, imperative, no issue number: the app adds it.

## Where the sentence goes

`wizard.models.noModelNoAgent` is rendered in `ModelsStep.tsx` in the same block as `wizard.models.noSubscription` (`:223`), which is the first thing the step shows. It is therefore on screen both before and after the step is skipped, since leaving the step is what moves the screen away; the specification asks that it be shown whenever a fresh install is being set up, and the step is the only place it belongs (`1_SPEC.md`, rule 7). Exact wording is written at implementation, in both languages, one line, no imperative.

## Risks

| Risk | How it is covered |
|---|---|
| A step id that is moved but whose screen or key does not follow. | `BODY` is keyed by id and `t('wizard.step.' + current)` resolves both labels; `test/wizard-i18n.test.ts` expands `wizard.step.${...}` from `WIZARD_STEPS` and fails on a missing label in either catalog. |
| A progress document saved under the old order (someone mid-setup when the app updates). | `parseProgress` validates each id against `WIZARD_STEPS` and keeps the stored step; a stored step is not reset by the reorder, so a setup resumes where it stopped, on the same labelled screen. Exercised in `test/wizard-shared.test.ts`; to be confirmed in the app on a data folder of one's own. |
| The model step becoming unskippable, or the language step becoming skippable, by a silent edit of `SKIPPABLE_STEPS`. | `SKIPPABLE_STEPS` is asserted against `WIZARD_STEPS` in the test (opening step not skippable, review not skippable, every step between them skippable), and the model step is asserted to be in it. |
| The one-sentence statement reading as an instruction or as a paragraph. | It is written as a statement of consequence, next to the notice of the subscription; the reviewer checks one line and no imperative; `test/wizard-i18n.test.ts` checks both catalogs define the key with no empty value. |
| "Set up later" moving to the model step, which would let a fresh install be closed on the screen that exists to prevent it. | The button is bound to `firstRun && index === 0`; the test that asserts the order makes the opening step's identity explicit, and the reviewer checks the two footer conditions by reading `SetupWizard.tsx:287-288` against the new `WIZARD_STEPS`. |
| The remaining steps asking something before the model (a code host, a project, documentation). | The order after the model step is untouched; the acceptance checks in `1_SPEC.md` 2 and 7 walk the assistant from the first screen and name each step. |

## How it will be verified

Automated, on this machine, and reported as actually run:

- `npx vitest run test/wizard-shared.test.ts` — the new order and the skippable set.
- `npx vitest run test/wizard-i18n.test.ts` — the new key exists in both catalogs, with the same placeholders, no empty value, and every `wizard.step.*` the screens build still has a label.
- `npx tsc --noEmit`, `npx vitest run` (whole suite), `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

Manual, in the app, on a data folder of one's own pointed by `CERIMONIAS_DATA_DIR` and never on a real workspace:

1. A fresh install opens on "Language and name", rail and counter saying 1 of 9, with "Set up later" and no "Skip this step".
2. "Continue" lands on "Models", counter 2 of 9, with the one sentence about no agent running without a provider, visible next to the subscription notice.
3. "Skip this step" on "Models" moves to the Claude Agent SDK step, marks it skipped in the rail, and does not close the assistant; "Continue" from "Models" with no provider still shows "Add at least one model provider".
4. "Set up later" from the opening step still closes the assistant, and no other step offers it.
5. A setup stopped between steps reopens on the same step after restarting the app.

Not verified by this stage, and to be said as such: no screen was seen working and nothing was executed. The counts of steps and the button conditions were established by reading the code and the catalogs named in `1_SPEC.md`.

## Not verified in this plan

Everything above about the acting of the screens is a reading of `src/shared/wizard.ts`, `src/renderer/src/wizard/SetupWizard.tsx`, `steps/ModelsStep.tsx`, `steps/LanguageStep.tsx`, the two `wizard.*.json` catalogs, `test/wizard-i18n.test.ts`, `test/wizard-shared.test.ts` and `src/main/wizard-core.ts`. Nothing was run and no screen was seen working. The wizard gate in CI is the one named by `CONTRIBUTING.md`; whether the untouched steps keep behaving as today is stated from reading, not from exercise.
