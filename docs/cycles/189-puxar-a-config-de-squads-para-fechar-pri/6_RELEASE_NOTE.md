# Priority per squad is now reissued from the workspace's real squad config

This is not a product feature: it is a process decision, recorded as
documentation, that closes a gap in how priorities are decided.

## What changed

Priority decisions per squad are reissued using the workspace's real squad
configuration instead of an ad-hoc call made during a ceremony. Each squad's
mission, scope (repositories, labels and paths) and liaison is read from the
configuration, every piece of work is assigned only to a squad whose declared
scope actually matches it, and the tracker label follows the workspace's
priority-ordering rule.

The original decision, taken at the retro of 2026-10-08 without the squad
config in hand, assigned work by domain proximity. The reissued decision
assigns by cited config entries: the platform squad (the app runtime: runner,
sandbox, agent engines, code providers, config and the security boundary)
covers the configuration area, and the experience squad (screens, ceremonies,
voice and text catalogs) does not touch it.

## How to use it

- The reissued decision, with the squad list, the matching analysis and the
  side-by-side comparison with the original, is recorded in the cycle folder
  for future consult.
- The issue carries the priority label chosen under the workspace's rule
  (`priority:medium`); when a label is unset, the choice is proposed and
  recorded only after acceptance, never written silently.
- Carrying the decision into the next retro's minutes is a ceremony act of
  the person, outside the repository.

## What is worth knowing

- The application code did not change: no file of the product was touched,
  so nothing behaves differently in the app.
- The repository's type check, theme audit, localization lint and public
  audit pass on this state. The full test suite did not run in this
  environment (the runner could not start on the read-only dependencies
  folder); it is not verified by this delivery.
- Two small documentation defects were found during review (a typo and a
  mixed narrative) and are recorded as non-blocking; they do not affect any
  acceptance criterion.
