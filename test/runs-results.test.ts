import { describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { ARTIFACT_NAME, failuresText, findingsText, gateApprove, handBack, outputKindOf, outputSchema, parseRun, readFinding, readOutput, recordQa, recordReview, stageDone, whereOf } from '../src/shared/runs';
import { drive } from './helpers/runs';

const done = (name: string) => ({ summary: `${name} done`, handoff: '', artifacts: [`${name}.md`] });
const finding = { path: 'src/a.ts', line: 3, endLine: 5, side: 'new' as const, severity: 'blocking' as const, body: 'Wrong.', suggestion: 'fixed();' };

// A run whose agents are all autonomous, driven to the stage `to`.
function until(to: string) {
  const d = drive();
  const go = (): void => {
    if (d.run.stage === to) return;
    if (d.run.status === 'gate') d.do((r, at) => gateApprove(r, d.flow, at));
    else d.do((r, at) => stageDone(r, d.flow, done(r.stage), at));
    go();
  };
  go();
  return d;
}

describe('what the agents found is kept in the run', () => {
  it('records each review pass with its findings as given, numbered from 1, and says so in the history', () => {
    const d = drive();
    const t1 = recordReview(d.run, { stage: 'review', by: 'reviewer', verdict: 'changes', summary: 'One problem.', findings: [finding], head: 'abc123' }, '2026-10-03T10:05:00.000Z');
    const t2 = recordReview(t1.run, { stage: 'review', by: 'reviewer', verdict: 'approved', summary: 'Good.', findings: [], head: 'def456' }, '2026-10-03T10:06:00.000Z');
    expect(t2.run.reviews.map((r) => [r.round, r.verdict, r.head, r.at])).toEqual([[1, 'changes', 'abc123', '2026-10-03T10:05:00.000Z'], [2, 'approved', 'def456', '2026-10-03T10:06:00.000Z']]);
    expect(t2.run.reviews[0].findings).toEqual([finding]);
    expect(t2.run.history.slice(-2).map((h) => [h.type, h.by, h.detail])).toEqual([['review', 'reviewer', '1: changes'], ['review', 'reviewer', '2: approved']]);
    expect(d.run.reviews).toEqual([]);
    expect(t2.messages).toEqual([]);
  });

  it('records a QA pass with its scenarios', () => {
    const d = drive();
    const t = recordQa(d.run, { stage: 'qa', by: 'qa', summary: 'One failed.', scenarios: [{ name: 'a', result: 'pass', detail: '' }, { name: 'b', result: 'fail', detail: 'broke' }], head: null }, '2026-10-03T10:07:00.000Z');
    expect(t.run.qa).toHaveLength(1);
    expect(t.run.history.at(-1)).toMatchObject({ type: 'qa', detail: 'fail' });
  });

  it('survive the file: a run written with them reads back, and one written before them reads as having none', () => {
    const d = drive();
    const t = recordReview(d.run, { stage: 'review', by: 'reviewer', verdict: 'changes', summary: 's', findings: [finding], head: null }, '2026-10-03T10:05:00.000Z');
    const back = parseRun(JSON.parse(JSON.stringify(t.run)));
    expect(back.ok && back.run.reviews[0].findings[0]).toEqual(finding);
    const old = JSON.parse(JSON.stringify(d.run)) as Record<string, unknown>;
    delete old.reviews;
    delete old.qa;
    delete old.base;
    const read = parseRun(old);
    expect(read.ok && [read.run.reviews, read.run.qa, read.run.base]).toEqual([[], [], null]);
  });

  it('refuse a finding that is not the shape of one', () => {
    const d = drive();
    const bad = recordReview(d.run, { stage: 'review', by: 'reviewer', verdict: 'changes', summary: 's', findings: [{ ...finding, severity: 'huge' as never }], head: null }, '2026-10-03T10:05:00.000Z');
    expect(parseRun(JSON.parse(JSON.stringify(bad.run))).ok).toBe(false);
  });
});
describe('the answer of a stage', () => {
  it('has a shape per kind of stage: a review finds, QA verifies, anything else produces documents', () => {
    expect(outputKindOf('review')).toBe('review');
    expect(outputKindOf('qa')).toBe('qa');
    for (const k of ['backlog', 'development', 'blocked', 'done'] as const) expect(outputKindOf(k)).toBe('work');
    const props = (k: 'work' | 'review' | 'qa') => Object.keys((outputSchema(k) as { properties: object }).properties);
    expect(props('work')).toEqual(['summary', 'commit', 'artifacts', 'handoff', 'question']);
    expect(props('review')).toEqual(['summary', 'commit', 'artifacts', 'handoff', 'question', 'verdict', 'findings']);
    expect(props('qa')).toEqual(['summary', 'commit', 'artifacts', 'handoff', 'question', 'scenarios']);
    expect((outputSchema('work') as { required: string[] }).required).toEqual(props('work'));
  });

  it('is read leniently: text trimmed, "null" strings and empties are nothing, names and kinds checked', () => {
    const o = readOutput({ summary: '  Done.  ', commit: 'x', handoff: 'null', question: 'None', artifacts: [{ name: '1_SPEC.md', content: 'c' }, { name: '../evil', content: 'c' }, { name: '.hidden', content: 'c' }, { name: 'a/b.md', content: 'c' }, { name: 'ok.md' }, 'x'], extra: 1 }, 'work');
    expect(o).toMatchObject({ summary: 'Done.', handoff: '', question: '', verdict: null, findings: [], scenarios: [] });
    expect(o.artifacts).toEqual([{ name: '1_SPEC.md', content: 'c' }]);
    expect(ARTIFACT_NAME.test('3_IMPLEMENTATION.md')).toBe(true);
    expect(readOutput('not an object', 'work')).toMatchObject({ summary: '', artifacts: [] });
  });

  it('reads findings: the place, the range, the side and the severity; a suggestion only where there is a line', () => {
    expect(readFinding({ path: './src/a.ts', line: 3, endLine: 5, severity: 'suggestion', body: ' Why. ', suggestion: ' fixed(); ' })).toEqual({ path: 'src/a.ts', line: 3, endLine: 5, side: 'new', severity: 'suggestion', body: 'Why.', suggestion: 'fixed();' });
    expect(readFinding({ path: 'src/a.ts', line: 3, endLine: 2, body: 'x' })).toMatchObject({ endLine: null, severity: 'blocking' });
    expect(readFinding({ path: 'src/a.ts', line: null, endLine: 9, body: 'about the file', suggestion: 'nope' })).toMatchObject({ line: null, endLine: null, suggestion: null });
    expect(readFinding({ path: 'src/a.ts', line: 1, side: 'old', body: 'removed line' })?.side).toBe('old');
    expect(readFinding({ path: '../x', body: 'x' })).toBeNull();
    expect(readFinding({ path: 'a.ts', body: '' })).toBeNull();
    expect(readFinding({ body: 'no path' })).toBeNull();
  });

  it('is not approved when a blocking finding is listed, whatever the verdict says', () => {
    const f = (severity: string) => ({ path: 'a.ts', line: 1, endLine: null, side: 'new', severity, body: 'x', suggestion: null });
    expect(readOutput({ summary: 's', verdict: 'approved', findings: [f('blocking')] }, 'review').verdict).toBe('changes');
    expect(readOutput({ summary: 's', verdict: 'approved', findings: [f('suggestion')] }, 'review').verdict).toBe('approved');
    expect(readOutput({ summary: 's', verdict: 'changes', findings: [] }, 'review').verdict).toBe('changes');
    expect(readOutput({ summary: 's', verdict: 'approved' }, 'work').verdict).toBeNull();
  });

  it('reads scenarios, keeping the ones that have a name', () => {
    const o = readOutput({ summary: 's', scenarios: [{ name: 'a', result: 'pass', detail: 'ok' }, { name: 'b', result: 'maybe' }, { result: 'pass' }] }, 'qa');
    expect(o.scenarios).toEqual([{ name: 'a', result: 'pass', detail: 'ok' }, { name: 'b', result: 'not-run', detail: '' }]);
  });
});

describe('the findings as text', () => {
  it('say where each one is, blocking ones first, with the replacement when there is one', () => {
    setLanguage('en');
    const suggestion = { ...finding, severity: 'suggestion' as const, line: 9, endLine: null, suggestion: null, body: 'Nicer name.' };
    const text = findingsText('Two things.', [suggestion, finding]);
    expect(text).toBe(['Two things.', '[blocks] src/a.ts:3-5: Wrong.\nSuggested replacement for exactly those lines:\nfixed();', '[suggestion] src/a.ts:9: Nicer name.'].join('\n\n'));
    expect(whereOf({ path: 'a.ts', line: null, endLine: null })).toBe('a.ts');
    expect(failuresText('One broke.', [{ name: 'login', result: 'fail', detail: 'a 500' }, { name: 'logout', result: 'pass', detail: '' }])).toBe('One broke.\n\nScenario that failed: login. a 500');
    setLanguage('pt-BR');
  });
});

describe('handing the work back counts as a review round only when asked to', () => {
  it('a plain hand back goes to the stage and costs nothing', () => {
    const d = until('qa');
    d.do((r, at) => handBack(r, d.flow, { by: 'qa', toStage: 'implement', text: 'fix it' }, at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', review: { rounds: 0 } });
  });

  it('a hand back that counts takes a round, and at the limit the run stops and asks the person', () => {
    const d = until('qa');
    d.do((r, at) => handBack(r, d.flow, { by: 'qa', toStage: 'implement', text: 'scenario b fails', countRound: true }, at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', review: { rounds: 1 } });
    while (d.run.stage !== 'qa') d.do((r, at) => stageDone(r, d.flow, done(r.stage), at));
    d.do((r, at) => handBack(r, d.flow, { by: 'qa', toStage: 'implement', text: 'still fails', countRound: true }, at));
    expect(d.run).toMatchObject({ status: 'question', stage: 'qa', review: { rounds: 2 } });
    expect(d.run.question).toMatchObject({ by: 'app', kind: 'review-limit', text: 'still fails' });
  });
});
