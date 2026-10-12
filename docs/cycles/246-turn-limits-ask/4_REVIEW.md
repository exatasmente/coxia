# Review of the turn limits that ask

Reviewed in a session separate from the one that wrote the code, against the approved spec and plan and the repository's rules. Base: `main` at the `0.9.0` stable.

## Verdict

Merge. There is no blocker and no major finding.

## Gates at review time

All of these are green:
- `npx tsc --noEmit`;
- `npx vitest run`: 7,881 passed; the one failure was a known near-limit timeout that passes alone;
- `node scripts/theme-audit.mjs`;
- `npm run i18n:lint`: 5,783 keys in both languages;
- `node scripts/public-audit.mjs`.

Ten mutations were tried on a copy of the tree, and the tests caught nine of them. The tenth, a conversation answer's clock pause, is finding 3.

## What was checked

- **Every limit asks.** The stage asks on both engines, including the Claude resume of the same session with a fresh limit. So does a sub-agent of every kind and the plain one, with the limit read from the setting when it starts, inside a stage, a stage's called agent, a mention in a run's thread and a conversation answer. None of them fails.
- **"Continue"** grants exactly one more round and asks again.
- **"Finish now"** returns a marked partial result, or ends the stage with the retryable failure.
- **Waiting** has no timer, and the clocks pause for the whole wait.
- **Parallel sub-agents** each ask on their own.
- **A second answer** is refused, and cancel or stop ends cleanly.
- **Nothing is persisted.**
- **The channels** are open to the phone on purpose, and anything else under their prefix is denied.
- **The audit** records the window or the phone.
- **The migration** writes only the five numbers.

## Findings

Fixed before merge (see `3_IMPLEMENTATION.md`):

1. A sub-agent's node kept saying "waiting for you" while its closing call ran after "finish now".
2. A sub-agent reaching its limit in a repair, evidence or missing-document round still failed. It now asks, too; only the stage's own limit stays quiet in those rounds.
3. The pause of a conversation answer's own clock had no test.
4. A paired browser on an older bundle could reset the five numbers to their defaults. Missing keys are now taken from the stored configuration.
5. A combined abort signal could leave listeners behind when given two distinct signals.
6. Smaller points:
   - one word for "turn" across the Portuguese texts;
   - a catalog key that was only a placeholder;
   - an untranslated time placeholder;
   - a class with no style.

Left as is:
- Commit 4 files the question before commit 5 adds the card that answers it. The branch merges as a whole.
- Ceremonies, the question chain and squad requests still stop at their limits, as the spec's rule 21 says.

## Not verified

- **The screen:** the cards, the stack and the tree were not seen, on the computer or the phone.
- **Real models:** no real model has reached a limit. Whether the closing call gives a useful summary is unknown.
- **The Claude path:** the app's own message stream after a Claude resume, and the pool's fallback after it, did not run for real. The resume itself was checked against the real SDK.
