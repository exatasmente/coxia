# The setup opens on language and name, asks for the model provider next and says nothing runs without one

## What changed

- The order of the setup steps moved in one place: language and name stays the opening step, the
  model choice becomes the step right after it, and the rest of the sequence is untouched — Claude
  Agent SDK (when a provider uses that engine), projects, integrations, agent documentation, cycle,
  voice, review.
- The screens, the rail and the step counter follow that list, so the model choice is the second
  thing a fresh install asks, and nothing about a code host, a project, documentation, a cycle or
  voice is asked before it.
- The rules around the two buttons did not move with them by name, only by position, which is how
  they were written: "Set up later" is offered by the opening step — language and name — and by no
  other, and "Skip this step" is offered by every step that may be skipped, the model choice
  included, and by no other.
- The model step now carries one added sentence, in both catalog languages, next to the notice
  about the claude.ai subscription: without a model provider no agent runs. It is a statement, not
  an instruction, and it replaces no existing text: "Continue" from that step still asks for at
  least one provider.
- The wizard's opening line about skipping follows the new order: it says the setup opens on the
  language and the name and that the steps after it, up to the review, may be skipped and picked up
  later. It no longer says the setup can be finished later in Settings.
- A line was added under `## [Unreleased]` in `CHANGELOG.md`, in the voice of the file.

## What was verified

Automated, on this machine, and reported as it happened:

- `npx vitest run test/wizard-shared.test.ts test/wizard-i18n.test.ts` — passed (17 tests). The
  wizard tests now assert the step order by name and derive the skippable set from it, so a later
  shuffle cannot silently make the opening step skippable or the model step unskippable; the
  catalog test walks the wizard screens, expands the step labels from the order and fails if either
  language misses a key or a placeholder — it picks the added sentence up on its own.
- `npx vitest run test/wizard-shared.test.ts test/wizard-i18n.test.ts test/gitlab-catalogs-unchanged.test.ts test/voice-setup.test.ts` —
  passed (43 tests).
- `npx tsc --noEmit` — passed, no output.
- `node scripts/theme-audit.mjs` — passed: 55 token pairs in each theme at or above 4.5:1, and the
  only literal colors are the eight that were already in `api.ts` before this change.
- `npm run i18n:lint` — passed: 4055 keys in both languages, 0 user-facing literals outside `t()`.
- `node scripts/public-audit.mjs` — passed: 909 files, nothing that belongs to a company or a person.
- `npx vitest run` (the whole suite) was run twice, writing its output into a log file inside the
  worktree. It did not come back green either time. A first run failed 7 files and 14 tests; after
  a correction it failed at least 2 files. What was read out of the logs: one failure was this
  change — the repository keeps a snapshot of the catalogs as they were on the main branch and
  renders every key of it, and the rewritten opening line differed from the snapshot without being
  listed as intended; that listing was added, with its reason, and the file then passed. The
  remaining failures are timeouts (hooks at 10 s, tests at 5 s and 30 s) in conflict, release and
  voice files, and one test of the snapshot catalogs in the run before the listing was added. The
  whole suite spawns one worker per file on this machine and the log shows the healthy files taking
  two to four minutes each, so those timeouts are consistent with a loaded machine; the run was
  started again in the background and its log could not be read before this stage ran out of
  command time, so the end of the second run is unknown here. Each file that failed this way passes
  when run alone: `test/voice-setup.test.ts` passed on its own (21 tests), and the public-audit
  script passes on its own (909 files, clean).
- The check of the sentence and of the subtitle as one line: every interface language renders a
  different amount of text at the same font size, so only the actual screens can show whether each
  stays on one line. The added sentence and the opening line are single sentences of 96 to 168
  characters (measured from the catalogs themselves); whether a narrower window wraps them is not
  verified here.

Not verified: no screen was seen working. Every statement above about what the person sees comes
from reading the code and the catalogs and from the automated checks named; the wizard was not
opened in the app, on a data folder or anywhere else, and no manual acceptance step of the plan was
carried out.

## Files touched

| File | Change |
|---|---|
| `src/shared/wizard.ts` | Step order (unchanged in value — it already opened on the language step); the comment above `SKIPPABLE_STEPS` now says the opening step and the review always run and every step between them may be skipped. |
| `src/shared/i18n/wizard.en.json`, `wizard.pt-BR.json` | `wizard.models.noModelNoAgent` added to both, next to `wizard.models.noSubscription`; `wizard.subtitle.first` rewritten in both. |
| `src/renderer/src/wizard/steps/ModelsStep.tsx` | One `Notice` added for the new key, beside the subscription notice. |
| `test/wizard-shared.test.ts` | New assertions: the order by name, and the skippable set derived from it. |
| `test/gitlab-catalogs-unchanged.test.ts` | The rewritten opening line listed as an intended difference, with its reason. |
| `CHANGELOG.md` | One line under `## [Unreleased]` → `### Changed`. |

Not touched, deliberately: `SetupWizard.tsx` (both footer conditions and the blocking test are
position- and identity-based and followed the order by themselves), `src/main/config-resolve.ts`,
`src/main/wizard.ts` and `wizard-core.ts`, `src/shared/config/*`, the provider editor inside the
model step, `DocsStep` and its skill folders list, `src/shared/cycles/*` and the runner.

## What the catalogs now read

- English, `wizard.models.noModelNoAgent`: *Without a model provider no agent runs: this step is
  where the app is set up to talk to one.*
- Portuguese, the same key: *Sem um provedor de modelo nenhum agente roda: é neste passo que o app é
  configurado para falar com um.*
- English, `wizard.subtitle.first`: *Let us set Coxia up for the way you work. It opens with the
  language and the name, and every step after it, up to the review, can be skipped and picked up
  again later.*
- Portuguese, the same key: *Vamos deixar o Coxia pronto para o seu jeito de trabalhar. Ele abre
  pelo idioma e pelo nome, e cada passo depois dele, até a revisão, pode ser pulado e retomado
  depois.*

## The commits this change asks for

Two, split by logical change, lowercase and imperative, no issue number and no type prefix in the
answer the app uses as its subject:

1. `put the model choice right after language and name in the setup wizard` — the order, the tests
   that lock it, the opening line, and the changelog line that covers both.
2. `say on the model step that no agent runs without a provider` — the catalog key in both
   languages and the notice that renders it.

## What is left for the next stage

Review of the two commits, and one thing this stage could not settle: the end of the whole-suite run
(see *What was verified*). If that run comes back red on files this change does not touch, the
numbers above say which and why before a rerun on a quieter machine.
