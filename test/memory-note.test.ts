import { describe, expect, it } from 'vitest';
import { checkProse } from '../src/main/procedures/record';
import { parseNote, problemsOf, renderNote, shaOf, shortLine, type NoteHeader } from '../src/main/memory/note';
import { AGENT_ID, CONVERSATION_ID, MEMORY_LIMITS, NOTE_FILE, NOTE_ID, STATE_FILE, memoryOn, visibleToAgents } from '../src/shared/memory';
import { THREAD_ID } from '../src/shared/forum';
import { ID } from '../src/shared/config/schema';
import { SECRET_PATH } from '../src/main/agents';

// The file of a note and the prose validator: pure, no disk. A refusal names the field and the class and never the value.

const HOME = '/home/person';
const header = (over: Partial<NoteHeader> = {}): NoteHeader => ({ id: 'm-3fa91c02', kind: 'decision', title: 'Use the queue for retries', by: 'developer', at: '2026-10-09T10:00:00.000Z', revision: 2, reviewed: true, ...over });
const prose = (value: unknown, field = 'text') => checkProse(value, field, { max: MEMORY_LIMITS.note, home: HOME });
const codes = (r: ReturnType<typeof prose>): string[] => (r.ok ? [] : r.refusals.map((x) => x.code));

describe('the contract', () => {
  it('keeps the caps the spec names, and the ids a folder name can be', () => {
    expect(MEMORY_LIMITS).toMatchObject({ note: 8000, filesPerAgent: 50, title: 80, listLines: 40, listChars: 3000, toolListLines: 40, toolListChars: 6000, excerpt: 4000, old: 90 });
    expect(CONVERSATION_ID.source).toBe(THREAD_ID.source);
    expect(AGENT_ID.source).toBe(ID);
    expect(NOTE_FILE.test('m-3fa91c02.md')).toBe(true);
    expect(NOTE_ID.test('m-3fa91c02')).toBe(true);
    for (const bad of ['m-3fa91c0.md', 'm-3FA91C02.md', 'm-3fa91c02.md.tmp-1', 'x-3fa91c02.md', '../m-3fa91c02.md', STATE_FILE]) expect(NOTE_FILE.test(bad)).toBe(false);
  });

  it('reads the switch as off when the config says nothing', () => {
    expect(memoryOn({ runner: { sharedMemory: true } })).toBe(true);
    expect(memoryOn({ runner: {} })).toBe(false);
    expect(memoryOn({ runner: { sharedMemory: false } })).toBe(false);
    expect(memoryOn(null)).toBe(false);
    expect(memoryOn(undefined)).toBe(false);
  });

  it('offers a note to the agents only when the app knows it, it passes the checks and it was reviewed', () => {
    expect(visibleToAgents({ foreign: false, unsafe: false, reviewed: true })).toBe(true);
    expect(visibleToAgents({ foreign: true, unsafe: false, reviewed: true })).toBe(false);
    expect(visibleToAgents({ foreign: false, unsafe: true, reviewed: true })).toBe(false);
    expect(visibleToAgents({ foreign: false, unsafe: false, reviewed: false })).toBe(false);
  });
});

describe('the file of a note', () => {
  it('round trips the header and the text, with line breaks, and ends in one line break', () => {
    const raw = renderNote(header({ activity: 'app#123', repo: 'api' }), 'First line.\n\nSecond paragraph, with --- inside.\n---\nand a fence-looking line.');
    expect(raw.startsWith('---\nid: m-3fa91c02\nkind: decision\ntitle: Use the queue for retries\nby: developer\n')).toBe(true);
    expect(raw.endsWith('line.\n')).toBe(true);
    const parsed = parseNote(raw, 'm-3fa91c02');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.claims).toMatchObject({ id: 'm-3fa91c02', kind: 'decision', title: 'Use the queue for retries', by: 'developer', revision: '2', reviewed: 'true', activity: 'app#123', repo: 'api' });
    expect(parsed.body).toBe('First line.\n\nSecond paragraph, with --- inside.\n---\nand a fence-looking line.');
    expect(problemsOf(parsed.claims, parsed.body)).toEqual([]);
  });

  it('omits the optional fields it was not given, and reads a CRLF file the person saved', () => {
    const raw = renderNote(header(), 'Body.');
    expect(raw).not.toContain('activity:');
    expect(raw).not.toContain('repo:');
    const parsed = parseNote(raw.replace(/\n/g, '\r\n'), 'm-3fa91c02');
    expect(parsed).toMatchObject({ status: 'ok', body: 'Body.' });
  });

  it('is not a note without a header, without an id, with the id of another file, or with an unclosed or lengthened fence', () => {
    expect(parseNote('just text\n', 'm-3fa91c02').status).toBe('not-note');
    expect(parseNote('---\nkind: note\ntitle: x\n---\nbody\n', 'm-3fa91c02').status).toBe('not-note');
    expect(parseNote(renderNote(header({ id: 'm-00000000' }), 'x'), 'm-3fa91c02').status).toBe('not-note');
    expect(parseNote('---\nid: m-3fa91c02\nkind: note\n', 'm-3fa91c02').status).toBe('not-note');
    expect(parseNote('---\nid: m-3fa91c02\nkind: note\n----\nbody\n', 'm-3fa91c02').status).toBe('not-note');
    expect(parseNote('---\nid: not-an-id\n---\nbody\n', 'not-an-id').status).toBe('not-note');
  });

  it('reads the first of a repeated header key, ignores a key it does not know and a line that is no field', () => {
    const parsed = parseNote('---\nid: m-3fa91c02\nkind: note\nkind: decision\nmood: happy\nnonsense\ntitle: T\n---\nBody\n', 'm-3fa91c02');
    expect(parsed).toMatchObject({ status: 'ok', claims: { kind: 'note', title: 'T' } });
    expect(parsed.status === 'ok' && 'mood' in parsed.claims).toBe(false);
  });

  it('keeps an empty body as an empty body, and the body of a file that ends at the fence', () => {
    expect(parseNote('---\nid: m-3fa91c02\nkind: note\ntitle: T\n---', 'm-3fa91c02')).toMatchObject({ status: 'ok', body: '' });
    expect(parseNote('---\nid: m-3fa91c02\nkind: note\ntitle: T\n---\n', 'm-3fa91c02')).toMatchObject({ status: 'ok', body: '' });
  });

  it('names what is wrong with a header or a text as codes, never values', () => {
    const claims = { id: 'm-3fa91c02', kind: 'decision', title: 'T' };
    expect(problemsOf(claims, 'ok')).toEqual([]);
    expect(problemsOf({ ...claims, kind: 'opinion' }, 'ok')).toEqual(['kind']);
    expect(problemsOf({ ...claims, kind: undefined }, 'ok')).toEqual(['kind']);
    expect(problemsOf({ ...claims, title: '' }, 'ok')).toEqual(['title']);
    expect(problemsOf({ ...claims, title: 'x'.repeat(81) }, 'ok')).toEqual(['title']);
    expect(problemsOf({ ...claims, title: 'x'.repeat(80) }, 'ok')).toEqual([]);
    expect(problemsOf(claims, '   ')).toEqual(['text']);
    expect(problemsOf(claims, 'x'.repeat(8001))).toEqual(['text']);
    // what a reader of the file would not see: zero width, bidi override, a tag character
    expect(problemsOf({ ...claims, title: 'T\u200b' }, 'ok')).toEqual(['title']);
    expect(problemsOf(claims, 'a\u202eb')).toEqual(['text']);
    expect(problemsOf(claims, 'a\u{E0041}b')).toEqual(['text']);
    expect(problemsOf(claims, 'line\n\tindented, accents \u00e9 and emoji \u{1F600}')).toEqual([]);
    expect(problemsOf(claims, 'x'.repeat(8000))).toEqual([]);
    expect(problemsOf({ ...claims, kind: 'x', title: '' }, '')).toEqual(['kind', 'title', 'text']);
  });

  it('shows an optional field only when it is one short line', () => {
    expect(shortLine('app#123')).toBe('app#123');
    expect(shortLine(undefined)).toBeUndefined();
    expect(shortLine('')).toBeUndefined();
    expect(shortLine('x'.repeat(81))).toBeUndefined();
    expect(shortLine('a\nb')).toBeUndefined();
    expect(shortLine('a\u202eb')).toBeUndefined();
  });

  it('hashes the whole file, so any change outside the app moves the hash', () => {
    const raw = renderNote(header(), 'Body.');
    expect(shaOf(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(shaOf(raw)).toBe(shaOf(raw));
    expect(shaOf(raw.replace('Body.', 'Body!'))).not.toBe(shaOf(raw));
    expect(shaOf(raw.replace('by: developer', 'by: person'))).not.toBe(shaOf(raw));
  });

  it('writes names the secret filter holds back nowhere: the file name and the state file are free of its words', () => {
    expect(SECRET_PATH.test(`/data/ws/memory/conversations/general/developer/m-3fa91c02.md`)).toBe(false);
    expect(SECRET_PATH.test(`/data/ws/memory/conversations/general/developer/${STATE_FILE}`)).toBe(false);
  });
});

describe('the prose validator', () => {
  it('accepts prose with line breaks, a tab, a path, a plain URL, a version, a date and a short hash', () => {
    const text = 'Use the queue for retries.\n\tSee src/main/queue.ts and https://example.com/docs/retries.\nVersion 1.2.3 of pkg@1.2.3 on 2026-10-09 fixed it in a1b2c3d, under ~/notes.';
    expect(prose(text)).toEqual({ ok: true, value: text });
  });

  it('reads a CRLF as a line break and trims the text', () => {
    expect(prose('  one\r\ntwo \n')).toEqual({ ok: true, value: 'one\ntwo' });
  });

  it('refuses a credential, an address, the home folder and a long run of digits, by class and without the value', () => {
    expect(codes(prose('password = hunter2'))).toEqual(['credential']);
    expect(codes(prose('run it with --password hunter2'))).toEqual(['credential']);
    expect(codes(prose('Authorization: Bearer abcdefghijklmnop'))).toEqual(['credential']);
    expect(codes(prose('write to dev@example.com'))).toEqual(['email']);
    expect(codes(prose(`it is under ${HOME}/project`))).toEqual(['home']);
    expect(codes(prose('call 555 123 4567'))).toEqual(['digits']);
    const refused = prose('password = hunter2');
    expect(JSON.stringify(refused)).not.toContain('hunter2');
    expect(!refused.ok && refused.refusals[0].field).toBe('text');
  });

  it('refuses invisible and direction-changing characters and a lone carriage return, and not a line break', () => {
    expect(codes(prose('looks fine\u202eoh no'))).toEqual(['control']);
    expect(codes(prose('zero\u200bwidth'))).toEqual(['control']);
    expect(codes(prose('lone \r return'))).toEqual(['control']);
    expect(codes(prose('tag\u{E0041}'))).toEqual(['control']);
    expect(prose('two\nlines').ok).toBe(true);
  });

  it('refuses a text that is empty, not a string or too long, and says how long it was', () => {
    expect(codes(prose(''))).toEqual(['empty']);
    expect(codes(prose('   \n '))).toEqual(['empty']);
    expect(codes(prose(42))).toEqual(['type']);
    expect(codes(prose(undefined))).toEqual(['type']);
    const long = prose('x'.repeat(8001));
    expect(codes(long)).toEqual(['too-long']);
    expect(!long.ok && long.refusals[0].text).toContain('8001 characters; the most is 8000');
    expect(prose('x'.repeat(8000)).ok).toBe(true);
  });

  it('judges a title as one line of at most 80 characters, with no character-set rule', () => {
    const title = (value: unknown) => checkProse(value, 'title', { max: MEMORY_LIMITS.title, line: true, home: HOME });
    expect(title('Use: the queue (v2) -- and "more" #7')).toEqual({ ok: true, value: 'Use: the queue (v2) -- and "more" #7' });
    expect(codes(title('two\nlines'))).toEqual(['control']);
    expect(codes(title('tab\tin it'))).toEqual(['control']);
    expect(codes(title('x'.repeat(81)))).toEqual(['too-long']);
    expect(codes(title('dev@example.com'))).toEqual(['email']);
  });

  it('does not judge the shapes that belong to a procedure step: a URL query is the net\'s to refuse, a quotation and a 20-character mixed word are not', () => {
    expect(prose('He said "this is a very long quotation that a procedure step would hold back for being page content"').ok).toBe(true);
    expect(prose('The build id twentycharacters1234 is fine').ok).toBe(true);
    // the net under the named classes still reads a query string and a 32+ character opaque string as what it would mask
    expect(codes(prose('see https://example.com/a?x=1&y=2'))).toEqual(['credential']);
    expect(codes(prose('the fix landed in 3fa91c02d4e5b6a7c8d9e0f1a2b3c4d5e6f70812'))).toEqual(['credential']);
    // A full hash is refused, and the reason tells the agent what to write instead; a query string gets the plain reason.
    const hash = prose('the fix landed in 3fa91c02d4e5b6a7c8d9e0f1a2b3c4d5e6f70812');
    expect(!hash.ok && hash.refusals[0].text).toContain('short form (7 to 12 characters)');
    expect(JSON.stringify(hash)).not.toContain('3fa91c02d4e5b6a7c8d9e0f1a2b3c4d5e6f70812');
    const query = prose('see https://example.com/a?x=1&y=2');
    expect(!query.ok && query.refusals[0].text).not.toContain('short form');
  });
});
