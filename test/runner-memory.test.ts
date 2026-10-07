import { beforeEach, describe, expect, it } from 'vitest';
import type { ForumMessage } from '../src/shared/forum';
import { setLanguage, t } from '../src/shared/i18n';
import { MEMORY_MAX, MEMORY_SECTIONS, applyFacts, factsOfThread, memoryOver, memorySkeleton, normalizeMemory } from '../src/main/runner/memory';

const message = (over: Partial<ForumMessage>): ForumMessage => ({
  v: 1,
  type: 'message',
  seq: 1,
  thread: 'run-1',
  at: '2026-10-03T10:00:00.000Z',
  kind: 'post',
  author: { type: 'person' },
  text: '',
  code: null,
  params: {},
  mentions: [],
  refs: [],
  attachments: [],
  stage: null,
  to: null,
  replyTo: null,
  public: false,
  waitsForAnswer: false,
  published: null,
  ...over,
});

const sectionTitle = (id: (typeof MEMORY_SECTIONS)[number]): string => t(`main.runner.memory.section.${id}`);

describe('the cycle memory, as text', () => {
  beforeEach(() => setLanguage('en'));

  it('is born as a skeleton with its title and every section, in the fixed order', () => {
    const lines = memorySkeleton().split('\n').filter((l) => l.startsWith('#'));
    expect(lines).toEqual(['# Cycle memory', ...MEMORY_SECTIONS.map((id) => `## ${sectionTitle(id)}`)]);
    expect(memorySkeleton().endsWith('\n')).toBe(true);
  });

  it('speaks the workspace language: the same skeleton in Portuguese', () => {
    setLanguage('pt-BR');
    expect(memorySkeleton()).toContain(`## ${sectionTitle('decisions')}`);
    expect(sectionTitle('decisions')).toBe('Decisões');
  });

  it('knows when it has passed its cap of 10,000 characters', () => {
    expect(MEMORY_MAX).toBe(10_000);
    expect(memoryOver('x'.repeat(MEMORY_MAX))).toBe(false);
    expect(memoryOver('x'.repeat(MEMORY_MAX + 1))).toBe(true);
  });

  it('is brought back to the shape of the file: the title and the sections in order, blank lines collapsed', () => {
    const out = normalizeMemory([`## ${sectionTitle('questions')}`, '', 'Open: which host?', '', '', '## something else', '', 'dropped', '', `## ${sectionTitle('decisions')}`, '', 'Use the folder.'].join('\n'));
    const heads = out.split('\n').filter((l) => l.startsWith('##'));
    expect(heads).toEqual(MEMORY_SECTIONS.map((id) => `## ${sectionTitle(id)}`));
    expect(out).toContain('Open: which host?');
    expect(out).toContain('Use the folder.');
    expect(out).not.toContain('dropped');
    expect(out).not.toMatch(/\n{3,}/);
  });

  it('reads a memory written before a language change: the headings of the other language still land in their section', () => {
    const out = normalizeMemory(`## Restrições\n\nNo network.\n`);
    expect(out).toContain(`## ${sectionTitle('constraints')}`);
    expect(out).toContain('No network.');
  });
});

describe('what the conversation leaves in the memory', () => {
  beforeEach(() => setLanguage('en'));

  it('takes each answer the person gave and each handoff, with a marker from the message', () => {
    const facts = factsOfThread([
      message({ seq: 3, kind: 'answer', text: 'Go with the second reading.' }),
      message({ seq: 5, kind: 'handoff', author: { type: 'agent', id: 'dev' }, to: 'reviewer', text: 'The plan is ready.' }),
      message({ seq: 6, kind: 'post', text: 'not a fact' }),
      message({ seq: 7, kind: 'answer', author: { type: 'agent', id: 'qa' }, text: 'ignored: not the person' }),
    ]);
    expect(facts.map((f) => [f.marker, f.section])).toEqual([
      ['answer:3', 'decisions'],
      ['handoff:5', 'where'],
    ]);
    expect(facts[0].line).toContain('Go with the second reading.');
    expect(facts[1].line).toContain('The plan is ready.');
  });

  it('writes each fact once: applying the same facts twice changes nothing', () => {
    const facts = factsOfThread([message({ seq: 3, kind: 'answer', text: 'Go with the second reading.' })]);
    const once = applyFacts(memorySkeleton(), facts);
    expect(once).toContain('<!-- answer:3 -->');
    expect(once).toBe(applyFacts(once, facts));
  });

  it('gives the marker back to a line the model kept without it, instead of writing it twice', () => {
    const facts = factsOfThread([message({ seq: 3, kind: 'answer', text: 'Go with the second reading.' })]);
    const written = applyFacts(memorySkeleton(), facts);
    const withoutMarker = written.replace(/ <!-- answer:3 -->/, '');
    const again = applyFacts(withoutMarker, facts);
    expect(again).toBe(written);
    expect(again.match(/Go with the second reading\./g)).toHaveLength(1);
  });

  it('keeps a long answer on one line, cut with an ellipsis', () => {
    const facts = factsOfThread([message({ seq: 9, kind: 'answer', text: `a${'b'.repeat(2_000)}` })]);
    expect(facts[0].line.includes('\n')).toBe(false);
    expect(facts[0].line.endsWith('…')).toBe(true);
    expect(facts[0].line.length).toBeLessThan(700);
  });
});
