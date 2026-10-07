# 18 Take the conflict resolver out of the unblock screen

- Endereço: https://github.com/exatasmente/coxia/issues/18
- Estado: open
- Rótulos: enhancement, coxia, priority:low
- Autor: exatasmente

## Descrição

Part of #8 (ceremonies have three jobs: report, define what is blocked, readjust priorities).

## The problem

Unblock is the conversation about a blocker and its ways out. The embedded conflict resolver is a tool: the blocker should link to it instead.

## Evidence

`src/renderer/src/screens/Deep.tsx:233-238`. Full audit in `docs/cycles/8-ceremonies-have-three-jobs/feat/AUDIT.md` (#12).

## Notes

- Move it with its external-write guard (`assertExternalWrite` or per-action approval) when it has one.
- Ceremony toggles, prompt families and the prompt goldens may need a config migration; see the audit's risks.

## Comentários

### exatasmente, 2026-10-06T19:02:48Z

Mantida, pequena: tirar o painel de conflito de `Deep.tsx` e deixar o bloqueio apontar para o botão que já existe em Hoje; os textos e o lugar `deep` que ficarem órfãos saem junto. Não depende de migração (as outras mudanças da série foram juntadas em #101).
