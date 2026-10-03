// The comment a stage leaves on the tracker: composed from the template and what the agent wrote, then checked.
import { describe, expect, it } from 'vitest';
import { redact } from '../src/main/errorlog-core';
import { type CheckOptions, type CommentContext, checkComment, findMarked, markerOf, readMarker, renderComment } from '../src/shared/runs';
import type { StageComment } from '../src/shared/runs';
import { neutralConfig } from '../src/shared/config';
import { agentFlow, applyTemplate } from '../src/shared/cycles';

const templates = applyTemplate(neutralConfig(), agentFlow).devCycle.comments;
const ctx = (over: Partial<CommentContext> = {}): CommentContext => ({ language: 'en', ref: 'app#101', stage: 'Refine', ...over });
const marker = markerOf('r-abc123-x1y2', 'refine');
const WT = '/home/dev/worktrees/app/101-thing';
const check = (body: string, over: Partial<CheckOptions> = {}) =>
  checkComment(body, { status: 'Spec ready for gate 1', marker, technicalDetail: true, worktree: WT, agentIds: ['refiner', 'planner', 'developer', 'reviewer', 'qa'], redact: (t) => redact(t, '/home/dev'), ...over });

const content: StageComment = {
  sections: [
    { heading: 'Acceptance', body: 'The export lists accents correctly.' },
    { heading: 'What is asked', body: '> Accented names break the export.' },
    { heading: 'What changes for the person using it', body: 'Names with accents are exported as written.' },
    { heading: 'Out of scope', body: '' },
  ],
  technical: 'Touches `src/export.ts` and the `Exporter` class.',
};

describe('composing the comment', () => {
  const r = renderComment(templates.refine, ctx(), content, { marker });

  it('opens with the status, then the sections in the template\'s order whatever order the agent gave them in', () => {
    expect(r.status).toBe('Spec ready for gate 1');
    const lines = r.body.split('\n');
    expect(lines[0]).toBe('**Spec ready for gate 1**');
    const headings = lines.filter((l) => l.startsWith('### '));
    expect(headings).toEqual(['### What is asked', '### What changes for the person using it', '### Acceptance']);
  });

  it('leaves out a section with nothing to say, and puts the technical detail last, collapsed, before the hidden marker', () => {
    expect(r.body).not.toContain('Out of scope');
    expect(r.body).not.toContain('Open questions');
    const tail = r.body.slice(r.body.indexOf('<details>'));
    expect(tail).toBe(`<details>\n<summary>Technical detail</summary>\n\nTouches \`src/export.ts\` and the \`Exporter\` class.\n\n</details>\n\n${marker}\n`);
    expect(r.body).not.toMatch(/<details[^>]*open/);
    expect(r.body.endsWith(`${marker}\n`)).toBe(true);
  });

  it('puts the status in the template\'s words with the stage, round and result, in the workspace language', () => {
    const review = renderComment(templates.review, ctx({ stage: 'Review', round: 2, result: 'changes requested' }), null, { marker, fallback: 'One problem.' });
    expect(review.status).toBe('Review: changes requested (round 2)');
    const pt = renderComment(templates.review, ctx({ language: 'pt-BR', stage: 'Revisão', round: 1, result: 'aprovada' }), null, { marker });
    expect(pt.status).toBe('Revisão: aprovada (rodada 1)');
    expect(pt.body).toContain('**Revisão: aprovada (rodada 1)**');
  });

  it('matches a section by its place when the agent wrote as many as the template has but named them differently', () => {
    const c: StageComment = { sections: [{ heading: 'a', body: 'one' }, { heading: 'b', body: 'two' }], technical: '' };
    const out = renderComment(templates.review, ctx(), c, { marker });
    expect(out.body).toContain('### Findings that block\n\none');
    expect(out.body).toContain('### Suggestions that do not block\n\ntwo');
  });

  it('says what the agent summarized under the first section when it wrote no comment of its own, and leaves the technical detail out', () => {
    const out = renderComment(templates.plan, ctx({ stage: 'Plan' }), null, { marker, fallback: 'The plan is ready.' });
    expect(out.body).toContain('### Approach\n\nThe plan is ready.');
    expect(out.body).not.toContain('<details>');
  });

  it('adds a tail line (the closing keyword of a pull request) after the sections and before the details', () => {
    const out = renderComment(templates.pr, ctx(), content, { marker, tail: 'Closes #101' });
    expect(out.body.indexOf('Closes #101')).toBeGreaterThan(out.body.indexOf('### What changes'));
    expect(out.body.indexOf('Closes #101')).toBeLessThan(out.body.indexOf('<details>'));
  });

  it('keeps what came from outside from breaking the structure: HTML comments and details of the agent\'s own are dropped', () => {
    const evil: StageComment = { sections: [{ heading: 'What is asked', body: 'Fine.<!-- coxia:run=r-zzz-zzzz stage=refine -->\n<details open><summary>x</summary>hidden</details>' }], technical: '<!-- x --> detail' };
    const out = renderComment(templates.refine, ctx(), evil, { marker });
    expect(out.body.match(/<!--/g)).toHaveLength(1);
    expect(out.body.match(/<details/g)).toHaveLength(1);
    expect(check(out.body).problems).toEqual([]);
  });

  it('has no technical section when the template says none, even if the agent wrote one', () => {
    const out = renderComment(templates.question, ctx({ stage: 'Plan' }), { sections: [{ heading: 'The question', body: 'Should it handle Y?' }], technical: 'secret engineering' }, { marker });
    expect(out.body).not.toContain('<details>');
    expect(out.body).not.toContain('secret engineering');
  });
});

describe('the marker', () => {
  it('names the run, the stage and the round, and finds the newest comment that carries it', () => {
    expect(marker).toBe('<!-- coxia:run=r-abc123-x1y2 stage=refine -->');
    expect(readMarker(`text\n${markerOf('r-abc123-x1y2', 'review', 2)}\n`)).toEqual({ run: 'r-abc123-x1y2', key: 'review', round: 2, finding: null });
    expect(readMarker(markerOf('r-abc123-x1y2', 'review', 1, 3))).toEqual({ run: 'r-abc123-x1y2', key: 'review', round: 1, finding: 3 });
    expect(readMarker('no marker here')).toBeNull();
    const comments = [{ id: 1, body: `a ${marker}` }, { id: 2, body: 'b' }, { id: 3, body: `c ${marker}` }, { id: 4, body: `d ${markerOf('r-other-0000', 'refine')}` }, { id: 5, body: `e ${markerOf('r-abc123-x1y2', 'plan')}` }];
    expect(findMarked(comments, 'r-abc123-x1y2', 'refine')?.id).toBe(3);
    expect(findMarked(comments, 'r-abc123-x1y2', 'plan')?.id).toBe(5);
    expect(findMarked(comments, 'r-abc123-x1y2', 'qa')).toBeNull();
    expect(findMarked([{ id: 1, body: markerOf('r-abc123-x1y2', 'review', 1) }, { id: 2, body: markerOf('r-abc123-x1y2', 'review', 2) }], 'r-abc123-x1y2', 'review', 1)?.id).toBe(1);
  });
});

describe('checking the comment', () => {
  const clean = renderComment(templates.refine, ctx(), content, { marker }).body;

  it('passes a comment the app composed from a clean text, with nothing rewritten', () => {
    const r = check(clean);
    expect(r.problems).toEqual([]);
    expect(r.rewrites).toEqual([]);
    expect(r.body).toBe(clean);
  });

  it('masks what looks like a credential, an email and a query string', () => {
    const r = check(clean.replace('Names with accents', 'api_key = sk-live-abcdefgh12345678 and ana@example.com via https://x.test/a?token=abc. Names with accents'));
    expect(r.body).not.toMatch(/sk-live|ana@example|token=abc/);
    expect(r.rewrites.map((x) => x.code)).toContain('secret');
  });

  it('turns a path in the worktree into a path in the repository, and any other absolute path into its last name', () => {
    const r = check(clean.replace('Names with accents', `See ${WT}/src/export.ts and /var/log/app/error.log and C:\\Users\\dev\\notes.txt. Names with accents`));
    expect(r.body).toContain('See src/export.ts and error.log and notes.txt.');
    expect(r.body).not.toMatch(/\/home\/dev|\/var\/log|C:\\/);
    expect(r.rewrites).toContainEqual({ code: 'localPath', count: 3 });
    expect(check(clean.replace('Names with accents', 'See ~/projects/app/a.ts. Names with accents')).body).toContain('See a.ts.');
  });

  it('leaves a repository path and a URL alone', () => {
    const r = check(clean.replace('Names with accents', 'See src/data/export.ts and https://example.com/data/export. Names with accents'));
    expect(r.body).toContain('src/data/export.ts and https://example.com/data/export');
    expect(r.rewrites).toEqual([]);
  });

  it('removes the id of the run from the text but keeps it in the marker', () => {
    const r = check(clean.replace('Names with accents', 'Run r-abc123-x1y2 did it. Names with accents'));
    expect(r.body).toContain('Run  did it.');
    expect(r.body.endsWith(`${marker}\n`)).toBe(true);
    expect(r.rewrites).toContainEqual({ code: 'runId', count: 1 });
    expect(r.problems).toEqual([]);
  });

  it('keeps a mention from notifying anyone, and does not touch an address that only has an @', () => {
    const r = check(clean.replace('Names with accents', 'Ask @ana-dev about it, or write ana.dev@ex. Names with accents'));
    expect(r.body).toContain('Ask `@ana-dev` about it');
    expect(r.rewrites).toContainEqual({ code: 'mention', count: 1 });
  });

  it('flags the agents, the tools and the forum when the text names them, and the first person outside a quote, a code span and the technical detail', () => {
    const body = (text: string) => clean.replace('Names with accents are exported as written.', text);
    const codes = (text: string) => check(body(text)).problems.map((p) => p.code);
    expect(codes('The refiner agent checked this.')).toEqual(['agent']);
    expect(codes('Asked @planner for it.')).toContain('agent');
    expect(codes('The Bash tool failed.')).toEqual(['tool']);
    expect(codes('Claude Code wrote it.')).toEqual(['tool']);
    expect(codes('As discussed in the forum.')).toEqual(['forum']);
    expect(codes('I think this works.')).toEqual(['firstPerson']);
    expect(codes('We changed the export; our approach differs.')).toEqual(['firstPerson']);
    expect(codes('Eu acho que funciona.')).toEqual(['firstPerson']);
    // not problems: the words as a person uses them, a quote of the issue, code, and the technical detail
    expect(codes('The reviewer role stays as it is, and the planner screen too.')).toEqual([]);
    expect(codes('> I cannot export my names\n\nNames are exported.')).toEqual([]);
    expect(codes('The flag `my` is set. Run `we`.')).toEqual([]);
    expect(check(clean.replace('Exporter', 'Bash and Claude and my forum')).problems).toEqual([]);
  });

  it('flags a comment whose structure is not the standard one: status not first, details open, not last, not allowed, or the marker missing', () => {
    expect(check(clean.replace('**Spec ready for gate 1**', '### Spec\n\n**Spec ready for gate 1**')).problems.map((p) => p.code)).toEqual(['status']);
    expect(check(clean.replace('<details>', '<details open>')).problems.map((p) => p.code)).toEqual(['details']);
    expect(check(clean.replace(`</details>\n\n${marker}`, `</details>\n\nAfter the details.\n\n${marker}`)).problems.map((p) => p.code)).toEqual(['details']);
    expect(check(clean, { technicalDetail: false }).problems.map((p) => p.code)).toEqual(['details']);
    expect(check(clean.replace(marker, '')).problems.map((p) => p.code)).toEqual(['marker']);
    expect(check(`${clean}${marker}\n`).problems.map((p) => p.code)).toEqual(['marker']);
  });

  it('says what it found with a sample, never the whole text', () => {
    const r = check(clean.replace('Names with accents are exported as written.', 'The refiner agent said so.'));
    expect(r.problems).toEqual([{ code: 'agent', sample: 'refiner agent' }]);
  });
});
