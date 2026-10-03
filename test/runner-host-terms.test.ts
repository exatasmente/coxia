import { afterEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { Language, VcsKind } from '../src/shared/config/types';
import { applyTemplate, builtInTemplate, termsFor } from '../src/shared/cycles';
import { cycleText } from '../src/shared/cycles/text';
import { CATALOGS, resetTerms, setLanguage, setTerms, t } from '../src/shared/i18n';
import { commentText, placeFindings } from '../src/main/runner/review';
import { hostConfig } from './helpers/config';

// The runner, the team and the cycle screens name the code host and its change request the way the workspace's host does: GitHub says "pull request",
// GitLab says "merge request", never a literal of the other. test/host-terms-leak.test.ts renders every catalog text for the three hosts and fails
// on the words of another one; this file pins what the runner's own families say, so a key moved out of the placeholders is named here.

afterEach(() => {
  setLanguage('pt-BR');
  resetTerms();
});

const LANGUAGES: Language[] = ['pt-BR', 'en'];
const KINDS: VcsKind[] = ['gitlab', 'github', 'bitbucket'];

// The families of keys the runner, the team, the flow and the forum of the cycle added.
const FAMILIES = [
  /^main\.runner\./,
  /^prompt\.sdd\.runner\./,
  /^main\.forum\.code\.(runner|run|wait)\./,
  /^ui\.(cycle|team|flow|forum|proposal|comments|squad)\./,
  /^cycle\.agentFlow\./,
  /^cycle\.team\./,
];
// Case matters for the abbreviations: `pr` is the id of a comment record, not the noun.
const HOST_WORDS = [/gitlab|github|bitbucket|merge requests?|pull requests?/i, /\bglab\b|\bgh\b|\bMRs?\b|\bPRs?\b/];
const names = (re: RegExp[], text: string): boolean => re.some((r) => r.test(text));
const OTHER: Record<string, RegExp[]> = {
  gitlab: [/pull requests?|github/i, /\bPRs?\b/],
  github: [/merge requests?|gitlab/i, /\bMRs?\b/],
  bitbucket: [/merge requests?|gitlab/i, /\bMRs?\b/],
};

// The noun is the same in both languages.
const noun = (kind: VcsKind): string => (kind === 'gitlab' ? 'merge request' : 'pull request');

function on(kind: VcsKind, language: Language): void {
  setLanguage(language);
  setTerms(termsFor(hostConfig(kind, { language }), language));
}

describe('the texts of the runner say the change request through the workspace words', () => {
  it('no text of the runner, the team and the cycle screens names a host or its change request in a literal', () => {
    for (const language of LANGUAGES) {
      const keys = Object.keys(CATALOGS[language]).filter((k) => FAMILIES.some((re) => re.test(k)));
      expect(keys.length, language).toBeGreaterThan(150);
      const literal = keys.filter((k) => names(HOST_WORDS, CATALOGS[language][k]));
      expect(literal, language).toEqual([]);
    }
  });

  it('the keys that carry the noun render it for each host, in both languages', () => {
    const keys = [
      'ui.proposal.purpose.pr',
      'ui.proposal.what.pr',
      'ui.cycle.comment.onPr',
      'ui.cycle.wait.prMerged',
      'ui.forum.target.mr',
      'ui.flow.wait.pr-merged',
      'main.runner.target.mr',
      'main.forum.code.runner.pr.created',
      'main.forum.code.wait.done.pr-merged',
      'cycle.agentFlow.team.customerSuccess.job',
      'cycle.agentFlow.comment.pr.title',
    ];
    for (const kind of KINDS) {
      for (const language of LANGUAGES) {
        on(kind, language);
        for (const key of keys) {
          const text = t(key, { title: 'x', url: 'u', stage: 's' });
          expect(text.toLowerCase(), `${kind}/${language} ${key}`).toContain(noun(kind));
          expect(names(OTHER[kind], text), `${kind}/${language} ${key}`).toBe(false);
        }
      }
    }
  });

  it('the capitalized noun of a title is capitalized', () => {
    on('gitlab', 'en');
    expect(t('ui.cycle.facts.pr')).toBe('Merge request');
    on('github', 'en');
    expect(t('ui.cycle.facts.pr')).toBe('Pull request');
    expect(t('ui.cycle.comment.kind.review')).toBe('Pull request review');
  });

  it('the agents are told the noun of the host, in the prompts of the runner', async () => {
    const { saveConfig } = await import('../src/main/workspaceConfig');
    const { prompt } = await import('../src/main/cyclePrompts');
    const ids = ['runner.system', 'runner.mention.system', 'runner.chain.system', 'runner.comment.pr'];
    for (const kind of KINDS) {
      for (const language of LANGUAGES) {
        const c = hostConfig(kind, { language });
        saveConfig(c);
        for (const id of ids) {
          const text = prompt(id, { agent: 'A', job: 'J', ref: 'app#1', title: 'T', stage: 'S', sections: '', technical: '', asker: 'B', question: 'Q' });
          expect(text.toLowerCase(), `${kind}/${language} ${id}`).toContain(noun(kind));
          expect(names(OTHER[kind], text), `${kind}/${language} ${id}`).toBe(false);
        }
      }
    }
  });

  it('the stage comment template of the agent cycle titles the pull request for the host', () => {
    const comments = applyTemplate(neutralConfig(), builtInTemplate('agent-flow')!).devCycle.comments;
    for (const language of LANGUAGES) {
      on('github', language);
      expect(cycleText(comments.pr.title, language)).toBe('Pull request');
      on('gitlab', language);
      expect(cycleText(comments.pr.title, language)).toBe('Merge request');
    }
  });

  it('a review is written for the host it goes to, whichever integration the workspace words come from', () => {
    const moved = placeFindings([{ path: 'src/a.ts', line: 40, endLine: null, side: 'new', severity: 'suggestion', body: 'Unused.', suggestion: null }], [{ path: 'src/a.ts', diff: '@@ -1,2 +1,2 @@\n a\n-b\n+c\n' }])[0];
    on('github', 'en');
    expect(commentText('gitlab', moved, 'en')).toContain('lines the merge request changes');
    expect(commentText('github', moved, 'en')).toContain('lines the pull request changes');
    on('gitlab', 'pt-BR');
    expect(commentText('github', moved, 'pt-BR')).toContain('o pull request altera');
    expect(commentText('gitlab', moved, 'pt-BR')).toContain('o merge request altera');
  });
});
