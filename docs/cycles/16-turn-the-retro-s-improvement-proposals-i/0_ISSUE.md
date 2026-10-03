# 16 Turn the retro's improvement proposals into an agent task

- Endereço: https://github.com/exatasmente/coxia/issues/16
- Estado: open
- Rótulos: enhancement
- Autor: exatasmente

## Descrição

Part of #8 (ceremonies have three jobs: report, define what is blocked, readjust priorities).

## The problem

The retro keeps the period digest, what worked, rework and what got stuck. Its process-improvement proposals (`melhorias`) are not one of the three jobs and today have no persistence: they become an agent task with its own output.

## Evidence

`src/main/retro.ts:257-307`, `src/renderer/src/screens/RetroScreen.tsx:15-24`. Full audit in `docs/cycles/8-ceremonies-have-three-jobs/feat/AUDIT.md` (#12).

## Notes

- Move it with its external-write guard (`assertExternalWrite` or per-action approval) when it has one.
- Ceremony toggles, prompt families and the prompt goldens may need a config migration; see the audit's risks.

## Comentários

(sem comentários)
