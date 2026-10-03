import { afterEach, describe, expect, it } from 'vitest';
import { buildCycleView, hostFacts, termsFor } from '../src/shared/cycles';
import { CATALOGS, createTranslator, fillTemplate, getTerms, i18nSnapshot, resetTerms, setLanguage, setTerms } from '../src/shared/i18n';
import { defaultTerms, hostWords } from '../src/shared/i18n/terms';
import { hostConfig } from './helpers/config';

// The workspace's own words: the standard placeholders a catalog text may use, and where they come from.

afterEach(() => {
  setLanguage('pt-BR');
  resetTerms();
});

describe('host words', () => {
  it('GitLab keeps the merge request words', () => {
    expect(hostWords('gitlab', 'en')).toEqual({ vcsName: 'GitLab', cr: 'MR', crs: 'MRs', crLong: 'merge request', crLongs: 'merge requests', crMark: '!' });
  });

  it('GitHub and Bitbucket say pull request and mark a ref with #', () => {
    for (const kind of ['github', 'bitbucket'] as const) {
      const w = hostWords(kind, 'pt-BR');
      expect([w.cr, w.crs, w.crLong, w.crLongs, w.crMark]).toEqual(['PR', 'PRs', 'pull request', 'pull requests', '#']);
    }
    expect(hostWords('github', 'en').vcsName).toBe('GitHub');
    expect(hostWords('bitbucket', 'en').vcsName).toBe('Bitbucket');
  });

  it('no integration keeps the historic noun and a neutral host name, the same the catalog says', () => {
    for (const language of ['pt-BR', 'en'] as const) {
      const w = hostWords(null, language);
      expect([w.cr, w.crMark]).toEqual(['MR', '!']);
      expect(w.vcsName).toBe(CATALOGS[language]['cycle.vcs.fallback']);
      expect(defaultTerms(language).words.summaryTarget).toBe(CATALOGS[language]['cycle.summary.chat']);
    }
  });
});

describe('termsFor', () => {
  it('follows the integration that holds the issues', () => {
    expect(termsFor(hostConfig('github'), 'en')).toMatchObject({ kind: 'github', words: { vcsName: 'GitHub', cr: 'PR', cli: 'gh' } });
    expect(termsFor(hostConfig('gitlab'), 'en')).toMatchObject({ kind: 'gitlab', words: { vcsName: 'GitLab', cr: 'MR', cli: 'glab' } });
    // Bitbucket has no CLI: the agents read it through the app's tool.
    expect(termsFor(hostConfig('bitbucket'), 'en')).toMatchObject({ kind: 'bitbucket', words: { vcsName: 'Bitbucket', cr: 'PR', cli: '' } });
    const second = hostConfig('gitlab');
    second.vcs.push({ ...second.vcs[0], id: 'other', kind: 'github' });
    second.projects.issues.vcsId = 'other';
    expect(termsFor(second, 'en').kind).toBe('github');
  });

  it('an integration set to the API only has no CLI word', () => {
    const c = hostConfig('github');
    c.vcs[0].cliPreference = 'api';
    expect(termsFor(c, 'en').words.cli).toBe('');
    c.vcs[0].cliPreference = 'cli';
    c.vcs[0].cliCommand = 'my-gh';
    expect(termsFor(c, 'en').words.cli).toBe('my-gh');
  });

  it('no integration gives the defaults', () => {
    expect(termsFor(hostConfig(null, { language: 'pt-BR' }), 'pt-BR')).toEqual(defaultTerms('pt-BR'));
    expect(termsFor(hostConfig(null, { language: 'en' }), 'en')).toEqual(defaultTerms('en'));
  });

  it('takes the ceremony name, the summary target and the retro window from the cycle', () => {
    const scrum = termsFor(hostConfig('github', { template: 'scrum' }), 'en').words;
    expect(scrum.ceremony).toBe('daily scrum');
    expect(scrum.Ceremony).toBe('Daily scrum');
    expect(scrum.retroDays).toBe('14');
    const c = hostConfig('github');
    c.devCycle.ceremonyParams.preDaily.label = 'morning sync';
    c.devCycle.ceremonyParams.preDaily.summaryTarget = 'the #team channel';
    c.devCycle.ceremonyParams.retro.windowDays = 10;
    expect(termsFor(c, 'en').words).toMatchObject({ ceremony: 'morning sync', Ceremony: 'Morning sync', summaryTarget: 'the #team channel', retroDays: '10' });
    expect(termsFor(hostConfig('github'), 'en').words.summaryTarget).toBe('the team chat');
  });

  it('every standard placeholder has a value by default, in both languages', () => {
    for (const language of ['pt-BR', 'en'] as const) {
      const { words } = defaultTerms(language);
      expect(Object.keys(words).sort()).toEqual(['Ceremony', 'ceremony', 'cli', 'cr', 'crLong', 'crLongs', 'crMark', 'crs', 'retroDays', 'summaryTarget', 'vcsName']);
      expect(words.vcsName).not.toBe('');
      expect(words.cr).not.toBe('');
    }
  });
});

describe('filling the placeholders', () => {
  it('a param of the call wins over a term, and a term fills what the call leaves out', () => {
    setTerms(termsFor(hostConfig('github'), 'en'));
    expect(fillTemplate('{cr} on {vcsName}')).toBe('PR on GitHub');
    expect(fillTemplate('{cr} on {vcsName}', { vcsName: 'elsewhere' })).toBe('PR on elsewhere');
  });

  it('an unknown placeholder stays visible', () => {
    expect(fillTemplate('{nothing} here')).toBe('{nothing} here');
  });

  it('a translator fills the terms of the workspace in what it renders', () => {
    const translate = createTranslator('en', { 'pt-BR': {}, en: { 'x.sentence': 'Open the {cr} on {vcsName}, then {ceremony}.' } });
    setTerms(termsFor(hostConfig('github'), 'en'));
    expect(translate('x.sentence')).toBe('Open the PR on GitHub, then pre-daily.');
    setTerms(termsFor(hostConfig('gitlab'), 'en'));
    expect(translate('x.sentence')).toBe('Open the MR on GitLab, then pre-daily.');
  });

  it('the default terms follow the language until the workspace sets its own', () => {
    setLanguage('en');
    expect(getTerms().words.ceremony).toBe('pre-daily');
    setLanguage('pt-BR');
    expect(getTerms().words.ceremony).toBe('pré-daily');
  });

  it('setting other terms changes the snapshot useT() subscribes to, setting the same ones does not', () => {
    const before = i18nSnapshot();
    setTerms(termsFor(hostConfig('github'), 'pt-BR'));
    const after = i18nSnapshot();
    expect(after).not.toBe(before);
    setTerms(termsFor(hostConfig('github'), 'pt-BR'));
    expect(i18nSnapshot()).toBe(after);
  });
});

describe('host variants of a key', () => {
  const catalogs = { 'pt-BR': { 'a.b': 'plain', 'a.b.github': 'github one', 'a.b.novoice': 'plain no voice', c: 'only plain' }, en: {} };

  it('the variant of the host wins, the plain key is the fallback', () => {
    expect(createTranslator('pt-BR', catalogs, () => 'github')('a.b')).toBe('github one');
    expect(createTranslator('pt-BR', catalogs, () => 'gitlab')('a.b')).toBe('plain');
    expect(createTranslator('pt-BR', catalogs, () => null)('a.b')).toBe('plain');
    expect(createTranslator('pt-BR', catalogs, () => 'github')('c')).toBe('only plain');
  });
});

describe('what the view carries to the screens', () => {
  it('the cycle view has the terms and the facts of the host', () => {
    const view = buildCycleView(hostConfig('github', { language: 'pt-BR' }), { specs: false, noteTool: null });
    expect(view.terms).toEqual(termsFor(hostConfig('github', { language: 'pt-BR' }), 'pt-BR'));
    expect(view.host).toMatchObject({ kind: 'github', name: 'GitHub', manualJobs: false, issueStatus: false, reviewerReplaces: false, readSwitch: true, cli: 'gh', trackerMcp: false });
    expect(view.host.engines.turn).toBe('claude-sdk');
  });

  it('the engine of a role is the one of its provider', () => {
    const c = hostConfig('gitlab');
    c.llm.providers.push({ ...c.llm.providers[0], id: 'local', kind: 'openai-compatible', engine: 'open' });
    c.llm.roles.deep = { provider: 'local', model: 'some-model' };
    expect(hostFacts(c).engines).toMatchObject({ turn: 'claude-sdk', deep: 'open' });
  });
});
