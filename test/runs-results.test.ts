import { describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { ARTIFACT_NAME, failuresText, limitText, notesText, scenarioBlocks, scenarioNotes, findingsText, gateApprove, handBack, outputKindOf, outputSchema, parseRun, readFinding, readOutput, recordQa, recordReview, stageDone, whereOf } from '../src/shared/runs';
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
    expect(props('work')).toEqual(['summary', 'commit', 'artifacts', 'handoff', 'question', 'memory']);
    expect(props('review')).toEqual(['summary', 'commit', 'artifacts', 'handoff', 'question', 'memory', 'verdict', 'findings']);
    expect(props('qa')).toEqual(['summary', 'commit', 'artifacts', 'handoff', 'question', 'memory', 'scenarios']);
    expect((outputSchema('work') as { required: string[] }).required).toEqual(props('work'));
  });

  it('asks for the text of the tracker comment, and of the pull request description, only when a template wants it', () => {
    const props = (w: { comment?: boolean; pr?: boolean }) => Object.keys((outputSchema('work', w) as { properties: object }).properties);
    expect(props({})).toEqual(['summary', 'commit', 'artifacts', 'handoff', 'question', 'memory']);
    expect(props({ comment: true })).toEqual(['summary', 'commit', 'artifacts', 'handoff', 'question', 'memory', 'comment']);
    expect(props({ comment: true, pr: true }).slice(-2)).toEqual(['comment', 'pr']);
    expect((outputSchema('review', { comment: true }) as { required: string[] }).required).toContain('comment');
    const o = readOutput({ summary: 's', comment: { sections: [{ heading: ' What ', body: ' text ' }, { heading: 'empty', body: '  ' }, 'x'], technical: ' detail ' }, pr: { title: ' Do it\nmore ', sections: [], technical: '' } }, 'work');
    expect(o.comment).toEqual({ sections: [{ heading: 'What', body: 'text' }], technical: 'detail' });
    expect(o.pr).toEqual({ title: 'Do it', sections: [], technical: '' });
    expect(readOutput({ summary: 's', comment: { sections: [], technical: '' }, pr: 'no' }, 'work')).toMatchObject({ comment: null, pr: null });
  });

  it('is read leniently: text trimmed, "null" strings and empties are nothing, names and kinds checked', () => {
    const o = readOutput({ summary: '  Done.  ', commit: 'x', handoff: 'null', question: 'None', artifacts: [{ name: '1_SPEC.md', content: 'c' }, { name: '../evil', content: 'c' }, { name: '.hidden', content: 'c' }, { name: 'a/b.md', content: 'c' }, { name: 'ok.md' }, 'x'], extra: 1 }, 'work');
    expect(o).toMatchObject({ summary: 'Done.', handoff: '', question: '', memory: '', verdict: null, findings: [], scenarios: [] });
    // A name with its folder is taken by its file name; one that climbs out, a hidden one, one with no text and one that is not a document are left out and named.
    expect(o.artifacts).toEqual([{ name: '1_SPEC.md', content: 'c' }, { name: 'b.md', content: 'c' }]);
    expect(o.ignoredArtifacts).toEqual(['../evil', '.hidden', 'ok.md', '—']);
    expect(readOutput({ summary: 's', artifacts: [{ name: 'docs\\cycles\\1-x\\1_SPEC.md', content: 'c' }] }, 'work')).toMatchObject({ artifacts: [{ name: '1_SPEC.md' }] });
    expect(readOutput({ summary: 's', artifacts: [{ name: '1_SPEC.md', content: 'c' }] }, 'work').ignoredArtifacts).toBeUndefined();
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

  it('turns "a decision for the person" with no question into a question made of the summary, and leaves every other case alone', () => {
    setLanguage('en');
    const made = readOutput({ summary: 'Scope is unclear: both readings are plausible.', question: null, needsPerson: true }, 'work');
    expect(made.needsPerson).toBe(true);
    expect(made.question).toBe('The agent marked this as a decision for you but did not write the question. What it said:\n\nScope is unclear: both readings are plausible.');
    // a question that was written stays as it was
    expect(readOutput({ summary: 's', question: 'Which scope?', needsPerson: true }, 'work').question).toBe('Which scope?');
    // not marked, or a question for the reporter, or nothing said at all: nothing is made up
    expect(readOutput({ summary: 's', question: null, needsPerson: false }, 'work').question).toBe('');
    expect(readOutput({ summary: 's', reporterQuestion: 'Which browser?', needsPerson: true }, 'work').question).toBe('');
    expect(readOutput({ summary: '', question: null, needsPerson: true }, 'work').question).toBe('');
    setLanguage('pt-BR');
  });

  it('reads scenarios, keeping the ones that have a name', () => {
    const o = readOutput({ summary: 's', scenarios: [{ name: 'a', result: 'pass', detail: 'ok' }, { name: 'b', result: 'maybe' }, { result: 'pass' }] }, 'qa');
    expect(o.scenarios).toEqual([{ name: 'a', result: 'pass', severity: 'blocking', detail: 'ok' }, { name: 'b', result: 'not-run', severity: 'blocking', detail: '' }]);
  });

  it('reads the severity of a scenario: only non-blocking is kept, anything else blocks', () => {
    const o = readOutput({ summary: 's', scenarios: [{ name: 'a', result: 'fail', severity: 'non-blocking', detail: 'd' }, { name: 'b', result: 'fail', severity: 'whatever' }, { name: 'c', result: 'fail' }] }, 'qa');
    expect(o.scenarios.map((s) => s.severity)).toEqual(['non-blocking', 'blocking', 'blocking']);
    expect(o.scenarios.map(scenarioBlocks)).toEqual([false, true, true]);
    expect(o.scenarios.map(scenarioNotes)).toEqual([true, false, false]);
    expect(scenarioBlocks({ result: 'fail' })).toBe(true);
  });

  it('asks QA for the severity of each scenario', () => {
    const qa = outputSchema('qa') as { properties: { scenarios: { items: { properties: Record<string, { enum?: string[] }>; required: string[] } } } };
    expect(qa.properties.scenarios.items.properties.severity.enum).toEqual(['blocking', 'non-blocking']);
    expect(qa.properties.scenarios.items.required).toContain('severity');
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
    expect(failuresText('Mixed.', [{ name: 'login', result: 'fail', detail: 'a 500' }, { name: 'edge', result: 'fail', severity: 'non-blocking', detail: 'odd input' }])).toBe('Mixed.\n\nScenario that failed: login. a 500\n\nWhat QA noted that does not block the delivery:\n- edge: odd input');
    expect(notesText([{ name: 'login', result: 'fail', detail: 'a 500' }])).toBe('');
    setLanguage('pt-BR');
  });
});

describe('the question at the limit of rounds', () => {
  it('says what was asked, what was done and what is open, with a placeholder where there is nothing', () => {
    setLanguage('en');
    const text = limitText({ stage: 'QA', rounds: 2, asked: ['- login: a 500'], did: 'Fixed the 500.', open: [] });
    expect(text).toBe(['The QA stage sent the work back 2 times and still does not approve.', 'What was asked to change in the last round:\n- login: a 500', 'What the developer did:\nFixed the 500.', 'What is still open:\n(nothing recorded)', 'Your answer goes back to the developer as guidance, and the rounds start again.'].join('\n\n'));
    expect(limitText({ stage: 'Review', rounds: 1, asked: [], did: '  ', open: ['- a'] })).toContain('What was asked to change in the last round:\n(nothing recorded)\n\nWhat the developer did:\n(nothing recorded)');
    setLanguage('pt-BR');
  });

  it('is what the run asks when the transition is given it, and the findings as they came when it is not', () => {
    const d = until('qa');
    d.do((r, at) => handBack(r, d.flow, { by: 'qa', toStage: 'implement', text: 'raw failures', countRound: true, limit: 'readable account' }, at));
    while (d.run.stage !== 'qa') d.do((r, at) => stageDone(r, d.flow, done(r.stage), at));
    d.do((r, at) => handBack(r, d.flow, { by: 'qa', toStage: 'implement', text: 'raw failures again', countRound: true, limit: 'readable account again' }, at));
    expect(d.run.question).toMatchObject({ kind: 'review-limit', text: 'readable account again' });
    expect(d.messages.at(-1)).toMatchObject({ code: 'review.limit', text: 'readable account again' });
  });
});

describe('handing the work back counts as a review round only when asked to', () => {
  it('a plain hand back goes to the stage and costs nothing', () => {
    const d = until('qa');
    d.do((r, at) => handBack(r, d.flow, { by: 'qa', toStage: 'implement', text: 'fix it' }, at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', returns: {} });
  });

  it('a hand back that counts takes a round, and at the limit the run stops and asks the person', () => {
    const d = until('qa');
    d.do((r, at) => handBack(r, d.flow, { by: 'qa', toStage: 'implement', text: 'scenario b fails', countRound: true }, at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', returns: { qa: 1 } });
    while (d.run.stage !== 'qa') d.do((r, at) => stageDone(r, d.flow, done(r.stage), at));
    d.do((r, at) => handBack(r, d.flow, { by: 'qa', toStage: 'implement', text: 'still fails', countRound: true }, at));
    expect(d.run).toMatchObject({ status: 'question', stage: 'qa', returns: { qa: 2 } });
    expect(d.run.question).toMatchObject({ by: 'app', kind: 'review-limit', text: 'still fails' });
  });
});
