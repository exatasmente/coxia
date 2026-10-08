import { describe, expect, it } from 'vitest';
import {
  BOARD_LABEL_PREFIX,
  cardLabelChanges,
  issueBodyOf,
  issueLabelsOfCard,
  issueRefOfAnswer,
  moveLabels,
  ownStageLabels,
  readsAs,
  ruleLabel,
  sameIssue,
  stageLabel,
  stageOfBoardLabel,
  writtenLabel,
  type StageVocabulary,
} from '../src/shared/boardHost';
import type { SquadDef, StageDef, StageMappingRule } from '../src/shared/config/types';

// The label vocabulary of a column, both ways: what the board writes for a stage and what the read side makes of it.

const stages: StageDef[] = [
  { id: 'todo', label: 'To do', match: ['^todo$'], kind: 'backlog', rank: 1 },
  { id: 'doing', label: 'Doing', match: ['doing'], kind: 'development', rank: 2 },
  { id: 'review', label: 'Review', match: ['review'], kind: 'review', rank: 4 },
  { id: 'done', label: 'Done', match: ['^done$'], kind: 'done', rank: 8 },
];
const rule = (over: Partial<StageMappingRule>): StageMappingRule => ({ provider: 'any', source: 'label', name: '', pattern: '^in progress$', stage: 'doing', ...over });
const vocab = (...stageMapping: StageMappingRule[]): StageVocabulary => ({ stages, stageMapping });

describe('stageOfBoardLabel', () => {
  it('matches board:<id> exactly, ignoring case', () => {
    expect(stageOfBoardLabel(['bug', 'Board:Doing'], stages)?.id).toBe('doing');
    expect(stageOfBoardLabel(['board:doing-more'], stages)).toBeNull();
    expect(stageOfBoardLabel(['xboard:doing'], stages)).toBeNull();
  });
  it('takes the highest rank when several are there, and nothing for an id the stages do not have', () => {
    expect(stageOfBoardLabel(['board:doing', 'board:review', 'board:todo'], stages)?.id).toBe('review');
    expect(stageOfBoardLabel(['board:gone'], stages)).toBeNull();
    expect(stageOfBoardLabel([], stages)).toBeNull();
  });
  it('names the default label with the prefix', () => {
    expect(BOARD_LABEL_PREFIX).toBe('board:');
    expect(stageLabel('doing')).toBe('board:doing');
  });
});

describe('ruleLabel and readsAs', () => {
  it('takes the plain label of the first writable label rule for the stage and the host', () => {
    expect(ruleLabel(vocab(rule({})), 'github', 'doing')).toBe('in progress');
    expect(ruleLabel(vocab(rule({ pattern: 'wip' })), 'github', 'doing')).toBe('wip');
    expect(ruleLabel(vocab(rule({ pattern: 'in.*' }), rule({ pattern: '^wip$' })), 'github', 'doing')).toBe('wip');
  });
  it('ignores a rule of another host, of another stage and of another source', () => {
    expect(ruleLabel(vocab(rule({ provider: 'gitlab' })), 'github', 'doing')).toBeNull();
    expect(ruleLabel(vocab(rule({ stage: 'review' })), 'github', 'doing')).toBeNull();
    for (const source of ['status', 'state', 'field', 'column'] as const) expect(ruleLabel(vocab(rule({ source })), 'github', 'doing')).toBeNull();
  });
  it('refuses a label the host would not take', () => {
    expect(ruleLabel(vocab(rule({ pattern: '^a,b$' })), 'github', 'doing')).toBeNull();
    expect(ruleLabel(vocab(rule({ pattern: `^${'x'.repeat(201)}$` })), 'github', 'doing')).toBeNull();
  });
  it('reads a label as the rules first, then the board\'s own label, and never by the free-text patterns', () => {
    const v = vocab(rule({ pattern: '^urgent$', stage: 'review' }));
    expect(readsAs(v, 'github', 'urgent')?.id).toBe('review');
    expect(readsAs(v, 'github', 'board:doing')?.id).toBe('doing');
    expect(readsAs(v, 'github', 'doing')).toBeNull();
  });
});

describe('writtenLabel', () => {
  it('writes the mapping\'s plain label, anchors or not', () => {
    expect(writtenLabel(vocab(rule({})), 'github', 'doing')).toEqual({ label: 'in progress', by: 'mapping' });
    expect(writtenLabel(vocab(rule({ pattern: 'wip' })), 'gitlab', 'doing')).toEqual({ label: 'wip', by: 'mapping' });
  });
  it('writes board:<id> when there is no rule for the stage', () => {
    expect(writtenLabel(vocab(), 'github', 'review')).toEqual({ label: 'board:review', by: 'default', why: 'no-rule' });
    expect(writtenLabel(vocab(rule({ provider: 'gitlab' })), 'github', 'doing')).toEqual({ label: 'board:doing', by: 'default', why: 'no-rule' });
  });
  it.each([
    ['a regular expression', { pattern: 'in (progress|dev)' }],
    ['a field', { source: 'field', name: 'Status', pattern: '^Doing$' }],
    ['a column', { source: 'column', pattern: '^Doing$' }],
    ['a status', { source: 'status', pattern: '^Doing$' }],
    ['a state', { source: 'state', pattern: '^open$' }],
    ['a label with a comma', { pattern: '^a,b$' }],
  ] as const)('writes the default with unwritable-rule when the rule is %s', (_name, over) => {
    expect(writtenLabel(vocab(rule(over as Partial<StageMappingRule>)), 'github', 'doing')).toEqual({ label: 'board:doing', by: 'default', why: 'unwritable-rule' });
  });
  it('falls back when the mapping\'s label would read back as another stage', () => {
    // the first rule claims "in progress" for review, so the doing rule's label never reads back as doing
    const v = vocab(rule({ pattern: 'progress', stage: 'review' }), rule({}));
    expect(writtenLabel(v, 'github', 'doing')).toEqual({ label: 'board:doing', by: 'default', why: 'unwritable-rule' });
  });
  it('refuses, naming the rule, when a rule claims board:<id> for another stage', () => {
    const greedy = rule({ pattern: 'board', stage: 'review' });
    const v = vocab(greedy);
    expect(writtenLabel(v, 'github', 'doing')).toEqual({ refused: 'shadowed', rule: greedy });
    expect(writtenLabel(v, 'gitlab', 'doing')).toEqual({ refused: 'shadowed', rule: greedy });
    // the rule of another host does not stand in the way
    expect(writtenLabel(vocab({ ...greedy, provider: 'gitlab' }), 'github', 'doing')).toMatchObject({ label: 'board:doing' });
  });
  it('refuses a stage the workspace does not have', () => {
    expect(writtenLabel(vocab(), 'github', 'gone')).toEqual({ refused: 'unknownStage' });
  });
});

describe('ownStageLabels and moveLabels', () => {
  const v = vocab(rule({}), rule({ pattern: '^wip$' }), rule({ pattern: 'dev(el)?' }), rule({ provider: 'gitlab', pattern: '^other-host$' }), rule({ source: 'status', pattern: '^Doing$' }));
  it('lists the default of every stage and the plain label of each label rule of the host, not only the first per stage', () => {
    expect(ownStageLabels(v, 'github')).toEqual(['board:todo', 'board:doing', 'board:review', 'board:done', 'in progress', 'wip']);
    expect(ownStageLabels(v, 'gitlab')).toEqual(['board:todo', 'board:doing', 'board:review', 'board:done', 'in progress', 'wip', 'other-host']);
  });
  it('adds the written label and removes only the own labels the issue carries, never bug, a priority or a squad label', () => {
    const r = moveLabels(v, 'github', ['in progress', 'core', 'bug', 'priority:high'], 'review');
    expect(r.add).toEqual(['board:review']);
    expect(r.remove).toEqual(['in progress']);
  });
  it('adds nothing the issue already carries, and compares without case', () => {
    expect(moveLabels(vocab(), 'github', ['Board:Review'], 'review')).toMatchObject({ add: [], remove: [] });
    expect(moveLabels(vocab(), 'github', ['BOARD:DOING', 'bug'], 'review')).toMatchObject({ add: ['board:review'], remove: ['BOARD:DOING'] });
  });
  it('leaves one stage label: a second own label is removed as well', () => {
    expect(moveLabels(v, 'github', ['board:todo', 'wip', 'board:review', 'bug'], 'review')).toMatchObject({ add: [], remove: ['board:todo', 'wip'] });
  });
  it('removes the old own label when the mapping\'s label is the target', () => {
    const r = moveLabels(vocab(rule({})), 'github', ['board:review', 'bug'], 'doing');
    expect(r).toMatchObject({ add: ['in progress'], remove: ['board:review'], written: { by: 'mapping' } });
  });
  it('changes nothing when the move is refused', () => {
    const r = moveLabels(vocab(rule({ pattern: 'board', stage: 'review' })), 'github', ['board:review'], 'doing');
    expect(r).toMatchObject({ add: [], remove: [], written: { refused: 'shadowed' } });
  });
});

describe('cardLabelChanges', () => {
  const squads = [
    { id: 'core', name: 'Core', label: 'core', scope: { labels: [] } },
    { id: 'web', name: 'Web', label: null, scope: { labels: ['frontend'] } },
  ] as unknown as SquadDef[];
  const ctx = (issueLabels: string[]) => ({ levels: ['^priority:high$', 'priority:low'], squads, issueLabels });
  it('adds the new priority and squad labels and removes the previous ones the issue carries', () => {
    const r = cardLabelChanges({ priority: 'priority:low', squad: 'core' }, { priority: 'priority:high', squad: 'web' }, ctx(['priority:low', 'core', 'bug']));
    expect(r.add).toEqual(['priority:high', 'frontend']);
    expect(r.remove).toEqual(['priority:low', 'core']);
  });
  it('does not remove a previous label the issue does not carry, nor add one it has', () => {
    const r = cardLabelChanges({ priority: 'priority:low', squad: 'core' }, { priority: 'priority:high', squad: 'core' }, ctx(['priority:high', 'bug']));
    expect(r).toEqual({ add: [], remove: [] });
  });
  it('clears a priority or a squad by removing its label alone', () => {
    expect(cardLabelChanges({ priority: 'priority:high', squad: 'core' }, { priority: null, squad: null }, ctx(['Priority:High', 'core']))).toEqual({ add: [], remove: ['Priority:High', 'core'] });
  });
  it('touches nothing when neither changed', () => {
    expect(cardLabelChanges({ priority: 'priority:high', squad: 'core' }, { priority: 'priority:high', squad: 'core' }, ctx(['priority:high', 'core']))).toEqual({ add: [], remove: [] });
  });
});

describe('issueLabelsOfCard and issueBodyOf', () => {
  const card = { title: 'T', body: 'About it', column: 'doing', priority: 'priority:high', labels: ['core', 'Core', 'bug'], history: [] };
  it('is born with the column\'s label, the card\'s labels and the priority label, each once', () => {
    const r = issueLabelsOfCard(vocab(), 'github', card, ['^priority:high$']);
    expect(r.labels).toEqual(['board:doing', 'core', 'bug', 'priority:high']);
    expect(r.written).toEqual({ label: 'board:doing', by: 'default', why: 'no-rule' });
  });
  it('uses the mapping\'s label for the column', () => {
    expect(issueLabelsOfCard(vocab(rule({})), 'github', card, []).labels.slice(0, 2)).toEqual(['in progress', 'core']);
  });
  it('leaves the column label out when the move would be refused', () => {
    const r = issueLabelsOfCard(vocab(rule({ pattern: 'board', stage: 'review' })), 'github', card, []);
    expect(r.labels).not.toContain('board:doing');
    expect(r.written).toMatchObject({ refused: 'shadowed' });
  });
  it('keeps the body alone when there are no comments, and adds the heading and one line per comment otherwise', () => {
    expect(issueBodyOf(card, 'Notes so far')).toBe('About it');
    const h = (text: string) => ({ at: 't', kind: 'commented' as const, text });
    expect(issueBodyOf({ body: 'About it', history: [h('first'), { at: 't', kind: 'moved' as const }, h('second\nline')] }, 'Notes so far')).toBe('About it\n\nNotes so far\n- first\n- second line');
    expect(issueBodyOf({ body: '', history: [h('only')] }, 'Notes so far')).toBe('Notes so far\n- only');
  });
});

describe('issueRefOfAnswer', () => {
  it('reads the three hosts\' answers, preferring the project\'s own number to a global id', () => {
    expect(issueRefOfAnswer({ id: 987654321, number: 12, html_url: 'https://github.example.test/o/r/issues/12' })).toEqual({ iid: 12, url: 'https://github.example.test/o/r/issues/12' });
    expect(issueRefOfAnswer({ id: 555, iid: 7, web_url: 'https://gitlab.example.test/g/p/-/issues/7' })).toEqual({ iid: 7, url: 'https://gitlab.example.test/g/p/-/issues/7' });
    expect(issueRefOfAnswer({ id: 3, links: { html: { href: 'https://bitbucket.example.test/w/r/issues/3' } } })).toEqual({ iid: 3, url: 'https://bitbucket.example.test/w/r/issues/3' });
  });
  it('accepts a numeric string and says null for an answer with no number', () => {
    expect(issueRefOfAnswer({ iid: '9' }).iid).toBe(9);
    expect(issueRefOfAnswer({ message: 'ok' })).toEqual({ iid: null, url: null });
    expect(issueRefOfAnswer({ number: 0 }).iid).toBeNull();
    expect(issueRefOfAnswer(null)).toEqual({ iid: null, url: null });
    expect(issueRefOfAnswer('12')).toEqual({ iid: null, url: null });
  });
});

describe('sameIssue', () => {
  it('needs the same number, and the same project when both are paths, ignoring case', () => {
    expect(sameIssue({ project: 'Group/Project', iid: 4 }, { project: 'group/project', iid: 4 })).toBe(true);
    expect(sameIssue({ project: 'group/project', iid: 4 }, { project: 'group/other', iid: 4 })).toBe(false);
    expect(sameIssue({ project: 'group/project', iid: 4 }, { project: 'group/project', iid: 5 })).toBe(false);
  });
  it('matches by number alone when a side names the project by a numeric id', () => {
    expect(sameIssue({ project: '42', iid: 4 }, { project: 'group/project', iid: 4 })).toBe(true);
    expect(sameIssue({ project: 'group/project', iid: 4 }, { project: '42', iid: 4 })).toBe(true);
  });
});
