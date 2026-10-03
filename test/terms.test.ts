import { afterEach, describe, expect, it } from 'vitest';
import { buildCycleView, cycleText, hostFacts, renderPrompt, termsFor } from '../src/shared/cycles';
import { CATALOGS, createTranslator, fillTemplate, getTerms, i18nSnapshot, resetTerms, setLanguage, setTerms, t } from '../src/shared/i18n';
import { defaultTerms, hostWords } from '../src/shared/i18n/terms';
import { cycleVariants } from '../src/shared/cycles/terms';
import { hostConfig } from './helpers/config';

// The workspace's own words: the standard placeholders a catalog text may use, and where they come from.

afterEach(() => {
  setLanguage('pt-BR');
  resetTerms();
});

describe('host words', () => {
  it('GitLab keeps the merge request words', () => {
    expect(hostWords('gitlab', 'en')).toEqual({ vcsName: 'GitLab', cr: 'MR', crs: 'MRs', crLong: 'merge request', crLongs: 'merge requests', CrLongs: 'Merge requests', crMark: '!', anCr: 'an MR', ci: 'pipeline' });
  });

  it('GitHub and Bitbucket say pull request and mark a ref with #', () => {
    for (const kind of ['github', 'bitbucket'] as const) {
      const w = hostWords(kind, 'pt-BR');
      expect([w.cr, w.crs, w.crLong, w.crLongs, w.CrLongs, w.crMark]).toEqual(['PR', 'PRs', 'pull request', 'pull requests', 'Pull requests', '#']);
    }
    expect(hostWords('github', 'en').vcsName).toBe('GitHub');
    expect(hostWords('bitbucket', 'en').vcsName).toBe('Bitbucket');
  });

  it('the indefinite article of the noun follows its sound in English and is left out in Portuguese', () => {
    expect([hostWords('gitlab', 'en').anCr, hostWords('github', 'en').anCr, hostWords(null, 'en').anCr]).toEqual(['an MR', 'a PR', 'an MR']);
    expect([hostWords('gitlab', 'pt-BR').anCr, hostWords('github', 'pt-BR').anCr]).toEqual(['MR', 'PR']);
  });

  it('the automated checks are "checks" on GitHub and "pipeline" elsewhere', () => {
    expect(hostWords('github', 'en').ci).toBe('checks');
    for (const kind of ['gitlab', 'bitbucket', null] as const) expect(hostWords(kind, 'en').ci).toBe('pipeline');
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
      expect(Object.keys(words).sort()).toEqual(['Ceremony', 'CrLongs', 'anCr', 'ceremony', 'ci', 'cli', 'cr', 'crLong', 'crLongs', 'crMark', 'crs', 'retroDays', 'summaryTarget', 'trackerMcp', 'vcsName']);
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
  const catalogs = { 'pt-BR': { 'a.b': 'plain', 'a.b.on-github': 'github one', 'a.b.github': 'a key that is its own thing', 'a.b.novoice': 'plain no voice', c: 'only plain' }, en: {} };

  it('the variant of the host wins, the plain key is the fallback', () => {
    expect(createTranslator('pt-BR', catalogs, () => 'github')('a.b')).toBe('github one');
    expect(createTranslator('pt-BR', catalogs, () => 'gitlab')('a.b')).toBe('plain');
    expect(createTranslator('pt-BR', catalogs, () => null)('a.b')).toBe('plain');
    expect(createTranslator('pt-BR', catalogs, () => 'github')('c')).toBe('only plain');
    // A key that merely ends in a host's name is its own key, not a variant.
    expect(createTranslator('pt-BR', catalogs, () => 'github')('a.b.github')).toBe('a key that is its own thing');
  });
});

describe('cycle variants of a key', () => {
  it('the SDD template with its default parameters has none, whatever the host', () => {
    for (const kind of ['gitlab', 'github', 'bitbucket', null] as const) expect(cycleVariants(hostConfig(kind))).toEqual([]);
  });

  it('each difference of the cycle selects its own variant', () => {
    const c = hostConfig('gitlab');
    expect(cycleVariants(hostConfig('gitlab', { template: 'kanban' }))).toContain('off-sdd');
    c.devCycle.ceremonyParams.preDaily.label = 'morning sync';
    expect(cycleVariants(c)).toEqual(['own-ceremony']);
    c.devCycle.ceremonyParams.preDaily.summaryTarget = 'the #team channel';
    c.devCycle.ceremonyParams.retro.windowDays = 14;
    expect(cycleVariants(c)).toEqual(['own-ceremony', 'own-target', 'own-retro']);
    expect(termsFor(c, 'en').flags).toEqual(['own-ceremony', 'own-target', 'own-retro']);
  });

  it('the variant wins over the plain key, the host variant over the cycle one, the plain key is the fallback', () => {
    const catalogs = { 'pt-BR': { a: 'plain', 'a.on-github': 'github', 'a.off-sdd': 'off sdd', 'a.own-retro': 'own retro', b: 'only plain', 'c.novoice': 'text', 'c.novoice.off-sdd': 'text off sdd' }, en: {} };
    const tr = (kind: string | null, flags: string[]) => createTranslator('pt-BR', catalogs, () => kind, () => flags);
    expect(tr('gitlab', [])('a')).toBe('plain');
    expect(tr('gitlab', ['off-sdd'])('a')).toBe('off sdd');
    expect(tr('gitlab', ['off-sdd', 'own-retro'])('a')).toBe('off sdd');
    expect(tr('gitlab', ['own-retro'])('a')).toBe('own retro');
    expect(tr('github', ['off-sdd'])('a')).toBe('github');
    expect(tr('gitlab', ['off-sdd'])('b')).toBe('only plain');
    expect(tr(null, ['own-target'])('a')).toBe('plain');
  });

  it('a GitLab workspace on the SDD template reads the words main read; a kanban one reads the neutral ones', () => {
    setLanguage('en');
    setTerms(termsFor(hostConfig('gitlab'), 'en'));
    expect(t('ui.retro.heading')).toBe('Weekly retro');
    expect(t('ui.ata.teams.title')).toBe('For the team daily');
    const c = hostConfig('gitlab', { template: 'kanban' });
    c.devCycle.ceremonyParams.retro.windowDays = 14;
    c.devCycle.ceremonyParams.preDaily.summaryTarget = 'the #team channel';
    setTerms(termsFor(c, 'en'));
    expect(t('ui.retro.heading')).toBe('Retro');
    expect(t('ui.ata.teams.title')).toBe('For the #team channel');
    expect(t('ui.today.retroWeekly')).toBe('Last 14 days');
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

describe('the catalogs on each host', () => {
  const on = (kind: 'gitlab' | 'github' | 'bitbucket', language: 'en' | 'pt-BR' = 'en') => {
    setLanguage(language);
    setTerms(termsFor(hostConfig(kind, { language }), language));
  };

  it('a card says CI the way the host does', () => {
    on('github');
    expect(t('vcs.card.ciFailed')).toBe('Checks failed');
    on('gitlab');
    expect(t('vcs.card.ciFailed')).toBe('CI failed');
    on('bitbucket');
    expect(t('vcs.card.ciFailed')).toBe('CI failed');
    on('github', 'pt-BR');
    expect(t('vcs.card.ciRunning')).toBe('Checks em andamento');
  });

  it('a text of the cycle takes the host noun, its article and its CI word', () => {
    on('gitlab');
    expect(cycleText('cycle.sdd.meaning.blocker', 'en')).toContain('an MR with a conflict, a red pipeline');
    on('github');
    expect(cycleText('cycle.sdd.meaning.blocker', 'en')).toContain('a PR with a conflict, red checks');
    on('bitbucket');
    expect(cycleText('cycle.sdd.meaning.blocker', 'en')).toContain('a PR with a conflict, a red pipeline');
  });

  it('a prompt picks the variant of the host too', () => {
    const cycle = hostConfig('github').devCycle;
    on('github');
    expect(renderPrompt(cycle, 'effects.kind.mr_pipeline', 'en')).toContain('checks of the PR');
    expect(renderPrompt(cycle, 'reply.main', 'en')).toContain('(push, PR, status, comment, checks, reviewer, new issue)');
    on('gitlab');
    expect(renderPrompt(cycle, 'effects.kind.mr_pipeline', 'en')).toContain('a pipeline of the MR ran');
    expect(renderPrompt(cycle, 'reply.main', 'en')).toContain('(push, MR, status, comment, pipeline, reviewer, new issue)');
  });

  it('the effects evidence marks a ref the way the host does', () => {
    on('github');
    expect(t('main.efeitos.stillDraft')).toBe('#{iid} is still a draft');
    on('gitlab');
    expect(t('main.efeitos.stillDraft')).toBe('!{iid} is still a draft');
  });
});
