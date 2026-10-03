import { describe, expect, it } from 'vitest';
import { termsFor } from '../src/shared/cycles';
import { CATALOGS, resetTerms, setLanguage, setTerms, setVoiceEnabled, t, tv } from '../src/shared/i18n';
import type { Language } from '../src/shared/config/types';
import { hostConfig } from './helpers/config';
import enMain from './fixtures/catalogs-main/en.json';
import mainEnMain from './fixtures/catalogs-main/main.en.json';
import mainPtMain from './fixtures/catalogs-main/main.pt-BR.json';
import minutesEnMain from './fixtures/catalogs-main/minutes.en.json';
import minutesPtMain from './fixtures/catalogs-main/minutes.pt-BR.json';
import ptMain from './fixtures/catalogs-main/pt-BR.json';
import callEnMain from './fixtures/catalogs-main/ui-call.en.json';
import callPtMain from './fixtures/catalogs-main/ui-call.pt-BR.json';
import docsEnMain from './fixtures/catalogs-main/ui-docs.en.json';
import docsPtMain from './fixtures/catalogs-main/ui-docs.pt-BR.json';
import gateEnMain from './fixtures/catalogs-main/ui-gate.en.json';
import gatePtMain from './fixtures/catalogs-main/ui-gate.pt-BR.json';
import settingsEnMain from './fixtures/catalogs-main/ui-settings.en.json';
import settingsPtMain from './fixtures/catalogs-main/ui-settings.pt-BR.json';
import shellEnMain from './fixtures/catalogs-main/ui-shell.en.json';
import shellPtMain from './fixtures/catalogs-main/ui-shell.pt-BR.json';
import todayEnMain from './fixtures/catalogs-main/ui-today.en.json';
import todayPtMain from './fixtures/catalogs-main/ui-today.pt-BR.json';
import wizardEnMain from './fixtures/catalogs-main/wizard.en.json';
import wizardPtMain from './fixtures/catalogs-main/wizard.pt-BR.json';

// The promise of the host and cycle terms: a GitLab workspace on the SDD template with its default parameters reads exactly what it read
// before the terms existed. The catalogs of `main` as they were then are snapshotted in fixtures/catalogs-main (merged in the order of
// CATALOGS), every key of them is rendered for such a workspace, in both languages, voice on and off, and the text must be the snapshot's,
// whatever the wording of the catalogs of the working tree. The only differences allowed are listed in INTENDED, each with its reason.

type Catalog = Record<string, string>;
const MAIN: Record<Language, Catalog> = {
  'pt-BR': { ...ptMain, ...wizardPtMain, ...minutesPtMain, ...mainPtMain, ...todayPtMain, ...callPtMain, ...settingsPtMain, ...docsPtMain, ...gatePtMain, ...shellPtMain },
  en: { ...enMain, ...wizardEnMain, ...minutesEnMain, ...mainEnMain, ...todayEnMain, ...callEnMain, ...settingsEnMain, ...docsEnMain, ...gateEnMain, ...shellEnMain },
};

// Keys of main that were renamed because the text is no longer about GitLab alone: the text of the new key, for a GitLab workspace, is the old one.
const RENAMED: Record<string, string> = {
  'ui.today.refreshGitlab': 'ui.today.refresh',
  'ui.settings.tool.glab.hint': 'ui.settings.tool.vcsCli.hint',
  'ui.settings.tool.glab.label': 'ui.settings.tool.vcsCli.label',
};

// The pt-BR text said "a MR" in some places and "o MR" in others; a placeholder cannot carry an article, so the texts are masculine everywhere
// (decision 3 of the plan). Per key: the reason, and the replacements that turn main's text into the one shown now (nothing else may change).
// A key whose text changes in both languages (the retro's improvements became a proposal in Actions) says so; a key whose text changed
// without a listed replacement only has to be listed, with its reason.
const MASCULINE = 'pt-BR gender normalisation: the text said "a MR", the noun is masculine everywhere now';
type Intended = { reason: string; language?: 'pt-BR' | 'both'; replace?: [string, string][] };
const INTENDED: Record<string, Intended> = {
  'sameDay.change.mrAdded': { reason: MASCULINE, replace: [['MR nova', 'MR novo']] },
  'main.watchers.shippedMr': { reason: MASCULINE, replace: [['mergeada', 'mergeado']] },
  'main.radar.recommendation.same-fix': { reason: MASCULINE, replace: [['nas duas MRs', 'nos dois MRs']] },
  'main.radar.stacked': { reason: MASCULINE, replace: [['Uma MR parte da branch da outra', 'Um MR parte da branch do outro']] },
  'ui.radar.identicalLines': { reason: MASCULINE, replace: [['nas duas MRs', 'nos dois MRs']] },
  'ui.radar.intro': { reason: MASCULINE, replace: [['das suas MRs abertas', 'dos seus MRs abertos']] },
  'ui.radar.job.busy': { reason: MASCULINE, replace: [['as MRs abertas', 'os MRs abertos']] },
  'ui.radar.noCollisions': { reason: MASCULINE, replace: [['as MRs abertas', 'os MRs abertos']] },
  'ui.help.ceremonies.others.text': { reason: MASCULINE, replace: [['de uma MR', 'de um MR']] },
  'ui.help.ceremonies.radar.text': { reason: MASCULINE, replace: [['das suas MRs abertas', 'dos seus MRs abertos']] },
  // The improvements of the retro stopped coming out in the IMPROVEMENTS.md format: each one is now a proposal in Actions.
  'ui.retro.intro': {
    reason: 'the retro no longer hands improvements to the clipboard: each one becomes a proposal in Actions (rule 3)',
    language: 'both',
    replace: [
      ['the improvements come out in the IMPROVEMENTS.md format for you to take through Claude Code.', 'each improvement it raises becomes a proposal in Actions to open an issue and start a task.'],
      ['as melhorias saem no formato do IMPROVEMENTS.md para você levar pelo Claude Code.', 'cada melhoria que ela levanta vira uma proposta em Ações para abrir uma issue e iniciar uma tarefa.'],
    ],
  },
  // The three retro prompts stopped asking the model for improvement proposals: the improvement is born in the retro's conversation now.
  'prompt.sdd.retro.main': { reason: 'the retro prompt no longer asks for proposed improvements (rule 1)', language: 'both', replace: [['\n{improvements}', '']] },
  'prompt.scrum.retro.main': {
    reason: 'the sprint retro prompt no longer asks for proposed improvements (rule 1, decision 9)',
    language: 'both',
    replace: [
      [
        '\n"melhorias" (improvements): in the "start, stop, continue" format: one action for the team to try next sprint (title, dimension, today\'s problem, what it would be), only the ones the evidence supports.',
        '',
      ],
      [
        '\n"melhorias": no formato "começar, parar, continuar": uma ação para o time experimentar na próxima sprint (título, dimensão, o problema hoje, o que seria), só as que a evidência sustenta.',
        '',
      ],
    ],
  },
  'prompt.kanban.retro.main': {
    reason: 'the flow retro prompt no longer asks for proposed improvements (rule 1, decision 9)',
    language: 'both',
    replace: [
      [
        '\n"melhorias" (improvements): one policy or flow change to try (title, dimension, today\'s problem, what it would be), only the ones the evidence supports.',
        '',
      ],
      [
        '\n"melhorias": uma mudança de política ou de fluxo para experimentar (título, dimensão, o problema hoje, o que seria), só as que a evidência sustenta.',
        '',
      ],
    ],
  },
  'ui.help.data.shared.text': {
    reason: 'the conflict verification commands moved from the file every workspace shared into each workspace config (#26), so the Help no longer lists them as shared',
    language: 'both',
    replace: [
      ['aparelhos pareados, glossário e comandos de verificação de conflito.', 'aparelhos pareados e glossário. Os comandos de verificação de conflito são de cada workspace (Configurações › Verificação de conflitos).'],
      ['paired devices, the glossary and the conflict verification commands.', 'paired devices, and the glossary. The conflict verification commands belong to each workspace (Settings › Conflict verification).'],
    ],
  },
};
const applyIntended = (key: string, was: string): string => (INTENDED[key].replace ?? []).reduce((text, [from, to]) => text.split(from).join(to), was);

// Keys of main that this change takes out of the catalogs for good: what they said no longer happens. Each one must be gone from CATALOGS.
const REMOVED: Record<string, string> = {
  'ui.retro.improvements.title': 'the retro has no section of proposed improvements any more (rule 1)',
  'ui.retro.improvements.hint': 'the retro no longer offers the IMPROVEMENTS.md flow to take by hand (decision 5)',
  'ui.retro.improvements.hintPlain': 'the retro no longer offers the team improvements record to take by hand (decision 5)',
  'prompt.sdd.retro.improvementsFormat': 'the retro prompt no longer describes an improvements field: the record no longer has one (rule 1)',
  // The texts the improvement entry of the retro screen used: nothing reads an improvement any more, so these have no caller left.
  'ui.retro.copied': 'the copied feedback of the retro improvement entry went away with the section (rule 1)',
  'ui.retro.copyEntry': 'the button that copied one improvement of the retro went away with the section (rule 1)',
  'ui.retro.entry.dimension': 'the dimension line of the copied improvement entry has no caller any more (rule 1)',
  'ui.retro.entry.problem': 'the problem line of the copied improvement entry has no caller any more (rule 1)',
  'ui.retro.entry.proposal': 'the proposal line of the copied improvement entry has no caller any more (rule 1)',
  'ui.retro.problem': 'the problem label of the retro improvement entry has no caller any more (rule 1)',
  'ui.retro.proposal': 'the proposal label of the retro improvement entry has no caller any more (rule 1)',
};

// What the callers of main passed as params for a GitLab workspace on SDD with its defaults (the same values the terms give now): a text
// that said `{vcs}` there and says `{vcsName}` here reads the same, so both sides are filled before they are compared.
const MAIN_PARAMS: Record<Language, Record<string, string>> = {
  'pt-BR': { vcs: 'GitLab', vcsName: 'GitLab', ceremony: 'pré-daily', Ceremony: 'Pré-daily' },
  en: { vcs: 'GitLab', vcsName: 'GitLab', ceremony: 'pre-daily', Ceremony: 'Pre-daily' },
};
const asCallersFill = (text: string, language: Language): string => text.replace(/\{(\w+)\}/g, (whole, name: string) => MAIN_PARAMS[language][name] ?? whole);

const diffs: { language: Language; voice: boolean; key: string; was: string; now: string }[] = [];

for (const language of ['pt-BR', 'en'] as const) {
  const config = hostConfig('gitlab', { language, template: 'sdd' });
  for (const voice of [true, false]) {
    setLanguage(language);
    setVoiceEnabled(voice);
    setTerms(termsFor(config, language));
    for (const key of Object.keys(MAIN[language])) {
      // the text main showed for the key: with voice off the ".novoice" wording when it had one (tv), the plain key otherwise
      if (key.endsWith('.novoice')) continue;
      const was = (!voice && MAIN[language][`${key}.novoice`]) || MAIN[language][key];
      const renamed = RENAMED[key] ?? key;
      const now = voice ? t(renamed) : tv(renamed);
      if (asCallersFill(now, language) !== asCallersFill(was, language)) diffs.push({ language, voice, key, was: asCallersFill(was, language), now: asCallersFill(now, language) });
    }
  }
}
resetTerms();
setVoiceEnabled(true);
setLanguage('pt-BR');

describe('a GitLab workspace on the SDD template reads what main read', () => {
  it('has the snapshot of every catalog the app has', () => {
    for (const language of ['pt-BR', 'en'] as const) expect(Object.keys(MAIN[language]).filter((k) => !((RENAMED[k] ?? k) in CATALOGS[language]) && !(k in REMOVED))).toEqual([]);
  });

  it('renders every key of main as main did, but for the intended differences', () => {
    const show = (d: (typeof diffs)[number]) => `${d.language}/${d.voice ? 'voice' : 'text'} ${d.key}\n  was: ${d.was}\n  now: ${d.now}`;
    expect(diffs.filter((d) => !(d.key in INTENDED) && !(d.key in REMOVED)).map(show)).toEqual([]);
  });

  it('an intended difference is exactly the listed replacement, in the language it says', () => {
    for (const d of diffs.filter((x) => x.key in INTENDED)) {
      const { language = 'pt-BR', replace } = INTENDED[d.key];
      if (language === 'pt-BR') expect(d.language, d.key).toBe('pt-BR');
      if (replace) expect(d.now, d.key).toBe(applyIntended(d.key, d.was));
    }
  });

  it('every intended difference still exists, and says why', () => {
    expect(Object.keys(INTENDED).filter((key) => !diffs.some((d) => d.key === key))).toEqual([]);
    for (const [key, { reason }] of Object.entries(INTENDED)) expect(reason.length, key).toBeGreaterThan(20);
  });

  it('every removed key is gone from both catalogs, and says why', () => {
    for (const [key, reason] of Object.entries(REMOVED)) {
      expect(Object.keys(CATALOGS['pt-BR']), key).not.toContain(key);
      expect(Object.keys(CATALOGS.en), key).not.toContain(key);
      expect(reason.length, key).toBeGreaterThan(20);
    }
  });
});
