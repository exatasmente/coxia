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
const MASCULINE = 'pt-BR gender normalisation: the text said "a MR", the noun is masculine everywhere now';
const INTENDED: Record<string, { reason: string; replace: [string, string][] }> = {
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
};
const applyIntended = (key: string, was: string): string => INTENDED[key].replace.reduce((text, [from, to]) => text.split(from).join(to), was);

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
    for (const language of ['pt-BR', 'en'] as const) expect(Object.keys(MAIN[language]).filter((k) => !((RENAMED[k] ?? k) in CATALOGS[language]))).toEqual([]);
  });

  it('renders every key of main as main did, but for the intended differences', () => {
    const show = (d: (typeof diffs)[number]) => `${d.language}/${d.voice ? 'voice' : 'text'} ${d.key}\n  was: ${d.was}\n  now: ${d.now}`;
    expect(diffs.filter((d) => !(d.key in INTENDED)).map(show)).toEqual([]);
  });

  it('an intended difference is exactly the listed replacement, in pt-BR only', () => {
    for (const d of diffs.filter((x) => x.key in INTENDED)) {
      expect(d.language, d.key).toBe('pt-BR');
      expect(d.now, d.key).toBe(applyIntended(d.key, d.was));
    }
  });

  it('every intended difference still exists, and says why', () => {
    expect(Object.keys(INTENDED).filter((key) => !diffs.some((d) => d.key === key))).toEqual([]);
    for (const [key, { reason }] of Object.entries(INTENDED)) expect(reason.length, key).toBeGreaterThan(20);
  });
});
