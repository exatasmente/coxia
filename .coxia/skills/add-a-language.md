---
checked-commit: 1a0858c59ed1d4c43e03feb3e709bbefd8441336
checked-date: 2026-10-06
evidence: [docs/i18n.md:46-52, src/shared/config/types.ts:7-11, src/shared/i18n/index.ts, test/i18n.test.ts]
summary: The steps to add a third interface language
stages: [development]
roles: [developer]
---

# Add a language

Portuguese (Brazil) is the source language and English the second. Adding a third is one more
catalog and a few lines of code. See `rules/i18n.md` for the `t()` and `tv()` rules.

1. Add the code to `LANGUAGES` in `src/shared/config/types.ts` (the JSON Schema is derived from
   it) and to `normalizeLanguage` and `CATALOGS` in `src/shared/i18n/index.ts`.
2. Create `<code>.json` and `wizard.<code>.json` with every key of the English catalogs, and
   update the two catalog tests (`test/i18n.test.ts` and the voice terminology test) to include
   it. The key and placeholder tests tell you what is missing.
3. Add the language to the language picker in the wizard and in Settings.
4. Run the whole suite.

A string that says "call" needs its `.novoice` variant too, keeping the same placeholders and
never saying "call" (`rules/voice.md`).
