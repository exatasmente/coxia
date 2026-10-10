import type { Catalog } from './index';
import callEn from './ui-call.en.json';
import callPtBR from './ui-call.pt-BR.json';
import cycleEn from './ui-cycle.en.json';
import cyclePtBR from './ui-cycle.pt-BR.json';
import docsEn from './ui-docs.en.json';
import docsPtBR from './ui-docs.pt-BR.json';
import gateEn from './ui-gate.en.json';
import gatePtBR from './ui-gate.pt-BR.json';
import memoryEn from './ui-memory.en.json';
import memoryPtBR from './ui-memory.pt-BR.json';
import proceduresEn from './ui-procedures.en.json';
import proceduresPtBR from './ui-procedures.pt-BR.json';
import settingsEn from './ui-settings.en.json';
import settingsPtBR from './ui-settings.pt-BR.json';
import shellEn from './ui-shell.en.json';
import shellPtBR from './ui-shell.pt-BR.json';
import teamEn from './ui-team.en.json';
import teamPtBR from './ui-team.pt-BR.json';
import todayEn from './ui-today.en.json';
import todayPtBR from './ui-today.pt-BR.json';

// The renderer's screens: one catalog pair per area (ui-<area>.<lang>.json), keys namespaced `ui.<screen>.*`.
// They live apart from en.json / pt-BR.json so the areas can be edited in parallel without merge collisions.
export const UI_PT_BR: Catalog = { ...todayPtBR, ...callPtBR, ...settingsPtBR, ...docsPtBR, ...gatePtBR, ...shellPtBR, ...teamPtBR, ...cyclePtBR, ...proceduresPtBR, ...memoryPtBR };
export const UI_EN: Catalog = { ...todayEn, ...callEn, ...settingsEn, ...docsEn, ...gateEn, ...shellEn, ...teamEn, ...cycleEn, ...proceduresEn, ...memoryEn };
