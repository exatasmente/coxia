import { describe, expect, it } from 'vitest';
import { promptFamilies, termsFor } from '../src/shared/cycles';
import { CATALOGS, resetTerms, setLanguage, setTerms, setVoiceEnabled, t } from '../src/shared/i18n';
import type { Language, VcsKind } from '../src/shared/config/types';
import { hostConfig } from './helpers/config';

// A workspace on GitHub or Bitbucket must not read GitLab's words, and the other way round: not in the interface, not in what the agents are
// told. Every catalog key and every prompt is rendered for those hosts, in both languages, voice on and off, and fails on the words of another
// host. The workspace's own words are filled from the terms, so a key that says "MR" or "GitLab" in a literal is the leak. The few keys that
// must name a host or a noun on purpose are in ALLOWED_*, each with its reason; the test fails when an entry no longer matches anything, so
// the list cannot rot. The same render for a cycle with its own words (a ceremony of its own name, a window of 14 days, a summary target)
// fails on the words of the SDD cycle.

// What only GitLab says: its name, its CLI, its noun for a change request and the marker of its refs ("app!7"). A lowercase "mr" is an
// identifier (`mrs`, `mr_merged`), not a word of the text.
const GITLAB_WORDS = [/gitlab/i, /\bglab\b|\bMRs?\b|\w!\d|!\{/, /merge requests?|work items?/i];
// What only GitHub says.
const GITHUB_WORDS = [/github/i, /\bgh\b|\bPRs?\b/, /pull requests?/i];

const leaks = (text: string, kind: VcsKind): boolean => (kind === 'gitlab' ? GITHUB_WORDS : GITLAB_WORDS).some((re) => re.test(text));

// Keys that name another host on purpose.
const ALLOWED_HOSTS: Record<string, string> = {
  'vcs.action.what': 'says what a write does on the code host and lists the three hosts the app supports',
  'vcs.write.guard': 'lists the three hosts the app supports in the refusal of a write from a test workspace',
  'vcs.validate.gitlabGraphql': 'the message of the GitLab executor for its own GraphQL call: GitLab only',
  'wizard.step.integrations.hint': 'the setup wizard offers the three hosts before one is chosen',
  'wizard.vcs.gitlab': 'the label of the GitLab choice in the setup wizard',
  'wizard.vcs.github': 'the label of the GitHub choice in the setup wizard',
  'wizard.vcs.hostGithub': 'the wizard text for the host field of a GitHub integration',
  'wizard.vcs.intro': 'the setup wizard describes integrations in general, before a host is chosen',
  'wizard.vcs.none': 'the setup wizard text for a workspace with no integration yet',
  'wizard.vcs.apiUrlHint': 'the wizard hint for the API address lists where each host keeps it',
  'wizard.vcs.scopes.gitlab': 'the token permissions the wizard asks for on GitLab',
  'wizard.vcs.scopes.github': 'the token permissions the wizard asks for on GitHub',
  'wizard.vcs.scopes.bitbucket': 'the token permissions the wizard asks for on Bitbucket',
  'wizard.problem.vcsHost': 'the wizard validation message for a host address, which names the hosts',
  'vcs.validate.githubGraphql': 'the message of the GitHub executor for its own GraphQL call: GitHub only',
  'vcs.probe.mrs': 'the wizard test result names both nouns (merge/pull request): it is shown before the host is known to be right',
  'vcs.probe.sampleMrs': 'the wizard test result names both nouns (merge/pull request): it is shown before the host is known to be right',
  'updates.reason.feed-unsupported': 'about the update feed provider (github or generic), not the code host of the workspace',
  'main.retro.digest.mudancas_gitlab': 'the name of a field of the retro digest the agent reads, kept so the prompts of a GitLab workspace stay byte for byte',
  'main.errorlog.hint.cliMissing': 'an error hint that names both CLIs: it does not know which integration failed',
  'main.errorlog.hint.accessRefused': 'an error hint that names both CLIs: it does not know which integration failed',
  'main.errorlog.hint.networkVpn': 'an error hint that lists the hosts: it does not know which integration failed',
  'main.quick.statusDetail': 'describes a work item status change, which the app only proposes on GitLab',
  'prompt.sdd.vcs.hint.gitlab': 'the read path of GitLab: only read while the workspace is on GitLab',
  'prompt.sdd.vcs.read.gitlab': 'the read path of GitLab: only read while the workspace is on GitLab',
  'prompt.sdd.vcs.changes.gitlab': 'the way to see a change on GitLab: only read while the workspace is on GitLab',
  'prompt.sdd.vcs.hint.github': 'the read path of GitHub: only read while the workspace is on GitHub',
  'prompt.sdd.vcs.read.github': 'the read path of GitHub: only read while the workspace is on GitHub',
  'prompt.sdd.vcs.changes.github': 'the way to see a change on GitHub: only read while the workspace is on GitHub',
  'prompt.sdd.conflict.comment.pipelinesHint': 'a glab command, passed only on GitLab with its CLI (agents.ts)',
  'cycle.githubFlow.name': 'the name of the GitHub flow template',
  'cycle.githubFlow.description': 'the description of the GitHub flow template',
  'cycle.githubFlow.meaning.blocker': 'the GitHub flow template says pull request: its own wording',
};

const LANGUAGES: Language[] = ['pt-BR', 'en'];

const found = new Map<string, string>();
const record = (key: string, where: string, text: string): void => {
  if (!found.has(key)) found.set(key, `${where}: ${text.slice(0, 120).replace(/\n/g, ' ⏎ ')}`);
};

function onHost(kind: VcsKind, language: Language, voice = true): void {
  setLanguage(language);
  setVoiceEnabled(voice);
  setTerms(termsFor(hostConfig(kind, { language }), language));
}

// Every catalog text, on each host, in each language. A key with a ".novoice" variant is its own key here, so the voice-off wordings are covered.
for (const kind of ['github', 'bitbucket', 'gitlab'] as const) {
  for (const language of LANGUAGES) {
    for (const key of Object.keys(CATALOGS[language])) {
      onHost(kind, language);
      const text = t(key);
      if (leaks(text, kind)) record(key, `${kind}/${language}`, text);
    }
  }
}
resetTerms();

describe('no leak of another host in the catalogs', () => {
  it('renders every catalog text without the words of another host', () => {
    expect([...found].filter(([key]) => !(key in ALLOWED_HOSTS)).map(([key, text]) => `${key} => ${text}`)).toEqual([]);
  });

  it('every entry of the allow-list still names another host, and says why', () => {
    expect(Object.keys(ALLOWED_HOSTS).filter((key) => !found.has(key))).toEqual([]);
    for (const [key, reason] of Object.entries(ALLOWED_HOSTS)) expect(reason.length, key).toBeGreaterThan(20);
  });
});

describe('no leak of another host in the prompts', () => {
  const ids = [...new Set(Object.values(promptFamilies('pt-BR')).flat())].filter((id) => !/\.(novoice|on-\w+)$/.test(id));
  // The read paths of a host are only rendered for that host (readPolicy.ts): the same allow-list as the catalog.
  const ALLOWED_IDS = new Set(['vcs.hint.gitlab', 'vcs.read.gitlab', 'vcs.changes.gitlab', 'vcs.hint.github', 'vcs.read.github', 'vcs.changes.github', 'conflict.comment.pipelinesHint']);

  it('every prompt of every template renders without the words of another host, voice on and off', async () => {
    const { saveConfig } = await import('../src/main/workspaceConfig');
    const { prompt } = await import('../src/main/cyclePrompts');
    const bad: string[] = [];
    let rendered = 0;
    for (const template of ['sdd', 'scrum', 'kanban', 'github-flow', 'minimal']) {
      for (const kind of ['github', 'bitbucket', 'gitlab'] as const) {
        for (const language of LANGUAGES) {
          for (const voice of [true, false]) {
            const c = hostConfig(kind, { language, template });
            c.voice.enabled = voice;
            saveConfig(c);
            for (const id of ids) {
              let text: string;
              try {
                text = prompt(id);
              } catch {
                // an id of a family this template does not have
                continue;
              }
              rendered += 1;
              if (!ALLOWED_IDS.has(id) && leaks(text, kind)) bad.push(`${template}/${kind}/${language}/${voice ? 'voice' : 'text'} ${id}: ${text.slice(0, 100).replace(/\n/g, ' ⏎ ')}`);
            }
          }
        }
      }
    }
    expect(rendered).toBeGreaterThan(ids.length * 5);
    expect(bad).toEqual([]);
    resetTerms();
  });
});

// The words of the SDD cycle in a text that is shown for any cycle.
const CYCLE_WORDS: [string, RegExp][] = [
  ['the daily ceremony', /pr[ée]-?dail(y|ies)/i],
  ['the retro window', /\b7 (days|dias)\b|semanal|weekly/i],
  ['the summary target', /team chat|chat do time/i],
];
const SKIPPED = /^(wizard\.|prompt\.|cycle\.(label|minimal|sdd|scrum|kanban|githubFlow|summary)\b)/;
const ALLOWED_CYCLE: Record<string, string> = {
  'ui.help.data.minutesFile': 'the name of the minutes file on disk, which is an identifier and keeps the ceremony id',
  'main.tempo.retroEntry': 'the label of the time export entry of the retro, which is scheduled weekly',
  'main.tempo.weeklyRetro': 'the label of the time export of the retro, which is scheduled weekly',
  'main.custo.week': 'a window of the cost screen, unrelated to the retro window',
  'ui.cost.byCeremony': 'a window of the cost screen, unrelated to the retro window',
  'ui.cost.falas.avgTitle': 'a window of the cost screen, unrelated to the retro window',
  'ui.cost.falas.none': 'a window of the cost screen, unrelated to the retro window',
  'ui.cost.falas.week': 'a window of the cost screen, unrelated to the retro window',
  'ui.cost.key.title': 'a window of the cost screen, unrelated to the retro window',
  'ui.cost.key.week': 'a window of the cost screen, unrelated to the retro window',
  'ui.cost.noCallsWeek': 'a window of the cost screen, unrelated to the retro window',
  'ui.cost.tile.week': 'a window of the cost screen, unrelated to the retro window',
  'ui.cost.ws.week': 'a window of the cost screen, unrelated to the retro window',
};

describe('no word of the SDD cycle in a cycle of its own', () => {
  const hits = new Map<string, string>();
  for (const language of LANGUAGES) {
    const c = hostConfig('github', { language, template: 'kanban' });
    c.devCycle.ceremonyParams.preDaily.label = 'morning sync';
    c.devCycle.ceremonyParams.preDaily.summaryTarget = 'the #team channel';
    c.devCycle.ceremonyParams.retro.windowDays = 14;
    setLanguage(language);
    setVoiceEnabled(true);
    setTerms(termsFor(c, language));
    for (const key of Object.keys(CATALOGS[language]).filter((k) => !SKIPPED.test(k))) {
      const text = t(key);
      const word = CYCLE_WORDS.find(([, re]) => re.test(text));
      if (word) hits.set(key, `${language}: ${word[0]}: ${text.slice(0, 100).replace(/\n/g, ' ⏎ ')}`);
    }
  }
  resetTerms();

  it('names the ceremony, the window and the target the cycle sets', () => {
    expect([...hits].filter(([key]) => !(key in ALLOWED_CYCLE)).map(([key, text]) => `${key} => ${text}`)).toEqual([]);
  });

  it('every entry of the allow-list still matches, and says why', () => {
    expect(Object.keys(ALLOWED_CYCLE).filter((key) => !hits.has(key))).toEqual([]);
    for (const [key, reason] of Object.entries(ALLOWED_CYCLE)) expect(reason.length, key).toBeGreaterThan(20);
  });
});
