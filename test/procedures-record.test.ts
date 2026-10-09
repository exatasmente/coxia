import { describe, expect, it } from 'vitest';
import { STAGE_KINDS } from '../src/shared/config/types';
import { LIMITS, PROCEDURE_VERSION, contentSize, isOld, normalTitle, sameKey, type ProcedureRecord } from '../src/shared/procedures';
import { checkContent, describeRefusals, parseRecord, type CheckContext } from '../src/main/procedures/record';

const ctx: CheckContext = { repos: ['api', 'web'], home: '/home/someone' };

const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'repo',
  key: 'api',
  title: 'Run the end-to-end tests',
  steps: [{ text: 'Start the stack', run: 'npm run stack:up' }, { text: 'Run the suite', run: 'npm run test:e2e' }],
  pitfalls: ['The stack needs the port 5432 free'],
  waits: ['After the stack starts, wait for the ready line; about 20 s'],
  ...over,
});

const codes = (input: unknown, c: CheckContext = ctx): string[] => {
  const r = checkContent(input, c);
  return r.ok ? [] : r.refusals.map((x) => `${x.field}:${x.code}`);
};

const stored = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: PROCEDURE_VERSION,
  id: 'p-3fa91c02',
  revision: 1,
  kind: 'repo',
  key: 'api',
  title: 'Run the end-to-end tests',
  steps: [{ text: 'Start the stack' }],
  pitfalls: [],
  waits: [],
  state: 'unverified',
  lastVerified: null,
  lastFailed: null,
  stats: { uses: 0, failures: 0, failuresSinceSave: 0, lastUsed: null, baseline: null, recent: [] },
  origin: { by: 'writer', createdBy: 'writer', surface: 'stage', at: '2026-10-09T10:00:00.000Z' },
  stepsFrom: 'agent',
  reviewed: false,
  previous: null,
  ...over,
});

describe('checkContent: the shape', () => {
  it('accepts a record and returns its content', () => {
    const r = checkContent(good(), ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ kind: 'repo', key: 'api', title: 'Run the end-to-end tests' });
  });

  it('does not accept anything but an object, or a kind outside the five', () => {
    expect(codes(null)).toEqual(['record:type']);
    expect(codes([])).toEqual(['record:type']);
    expect(codes(good({ kind: 'note' }))).toContain('kind:type');
  });

  it('defaults an absent pitfalls or waits to none, and needs at least one step', () => {
    const r = checkContent({ ...good(), pitfalls: undefined, waits: undefined }, ctx);
    expect(r.ok && r.value.pitfalls).toEqual([]);
    expect(codes(good({ steps: [] }))).toEqual(['steps:empty']);
    expect(codes(good({ steps: 'run it' }))).toEqual(['steps:type']);
  });

  it('reports every refusal in one pass', () => {
    const got = codes(good({ title: 'x\ny', steps: [{ text: '' }], pitfalls: [3] }));
    expect(got).toEqual(expect.arrayContaining(['title:control', 'title:charset', 'steps[0].text:empty', 'pitfalls[0]:type']));
  });

  it('refuses a field a step does not have, and keeps the edited mark', () => {
    expect(codes(good({ steps: [{ text: 'a', note: 'b' }] }))).toEqual(['steps[0].note:unknown-field']);
    const r = checkContent(good({ steps: [{ text: 'a', edited: true }] }), ctx);
    expect(r.ok && r.value.steps).toEqual([{ text: 'a', edited: true }]);
  });

  it('trims a field and does not change the text otherwise', () => {
    const r = checkContent(good({ title: '  Run the tests  ' }), ctx);
    expect(r.ok && r.value.title).toBe('Run the tests');
  });
});

describe('checkContent: the caps', () => {
  const long = (n: number): string => 'a'.repeat(n);

  it('refuses a field over its cap and accepts it at the cap', () => {
    expect(codes(good({ title: long(LIMITS.title + 1) }))).toEqual(['title:too-long']);
    expect(codes(good({ title: long(LIMITS.title) }))).toEqual([]);
    expect(codes(good({ steps: [{ text: long(LIMITS.stepText + 1) }] }))).toEqual(['steps[0].text:too-long']);
    expect(codes(good({ steps: [{ text: long(LIMITS.stepText), run: long(LIMITS.stepRun + 1) }] }))).toEqual(['steps[0].run:too-long']);
    expect(codes(good({ pitfalls: [long(LIMITS.pitfall + 1)] }))).toEqual(['pitfalls[0]:too-long']);
    expect(codes(good({ waits: [long(LIMITS.wait + 1)] }))).toEqual(['waits[0]:too-long']);
  });

  it('refuses too many items', () => {
    const steps = Array.from({ length: LIMITS.steps + 1 }, (_, i) => ({ text: `Step ${i}` }));
    expect(codes(good({ steps }))).toEqual(['steps:too-many']);
    expect(codes(good({ pitfalls: Array.from({ length: LIMITS.pitfalls + 1 }, () => 'x') }))).toEqual(['pitfalls:too-many']);
    expect(codes(good({ waits: Array.from({ length: LIMITS.waits + 1 }, () => 'x') }))).toEqual(['waits:too-many']);
  });

  it('refuses a record over 4,000 characters in all, counting the content and nothing else', () => {
    // Each field is under its cap; together they are over the 4,000 characters.
    const steps = Array.from({ length: LIMITS.steps }, (_, i) => ({ text: `${'word '.repeat(46)}${i}` }));
    const r = checkContent(good({ steps }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals).toEqual([expect.objectContaining({ field: 'record', code: 'size' })]);
    const ok = checkContent(good(), ctx);
    expect(ok.ok && contentSize(ok.value)).toBeLessThan(LIMITS.content);
  });
});

describe('checkContent: the title', () => {
  it.each([
    ['letters, digits and the listed marks', "Update a row (budget), step 2 - it's easy / fast.", true],
    ['accented letters', 'Atualizar a planilha do orçamento', true],
    ['angle brackets', 'Open <b>the</b> sheet', false],
    ['a backtick', 'Run `npm test`', false],
    ['a line break', 'Run\nthe tests', false],
    ['a curly apostrophe', 'It\u2019s a title', false],
    ['a colon', 'Step: run', false],
  ])('%s', (_name, title, accepted) => {
    expect(checkContent(good({ title }), ctx).ok).toBe(accepted);
  });
});

describe('checkContent: the key of each kind', () => {
  it('gui: a host as written, or the name of an application; never a scheme, path, port or query', () => {
    expect(codes(good({ kind: 'gui', key: 'docs.example.com' }))).toEqual([]);
    expect(codes(good({ kind: 'gui', key: 'Docs.Example.com' }))).toEqual([]);
    expect(codes(good({ kind: 'gui', key: 'Calculator' }))).toEqual([]);
    expect(codes(good({ kind: 'gui', key: 'https://docs.example.com' }))).toContain('key:key-form');
    expect(codes(good({ kind: 'gui', key: 'docs.example.com/sheets' }))).toContain('key:key-form');
    expect(codes(good({ kind: 'gui', key: 'docs.example.com:8080' }))).toContain('key:key-form');
    expect(codes(good({ kind: 'gui', key: 'docs.example.com?x' }))).not.toEqual([]);
  });

  it('gui: a host with a long name that mixes letters and digits is still a host', () => {
    expect(codes(good({ kind: 'gui', key: 'my-project-2024-staging.example.com' }))).toEqual([]);
  });

  it('repo: only a repository of the workspace', () => {
    expect(codes(good({ kind: 'repo', key: 'web' }))).toEqual([]);
    expect(codes(good({ kind: 'repo', key: 'mobile' }))).toEqual(['key:key-repo']);
    expect(codes(good({ kind: 'repo', key: 'api' }), { repos: [], home: ctx.home })).toEqual(['key:key-repo']);
  });

  it('cycle: a stage kind of the flow, with a repository of the workspace optionally', () => {
    for (const stage of STAGE_KINDS) expect(codes(good({ kind: 'cycle', key: stage }))).toEqual([]);
    expect(codes(good({ kind: 'cycle', key: 'development@api' }))).toEqual([]);
    expect(codes(good({ kind: 'cycle', key: 'shipping' }))).toEqual(['key:key-stage']);
    expect(codes(good({ kind: 'cycle', key: 'development@mobile' }))).toEqual(['key:key-repo']);
    expect(codes(good({ kind: 'cycle', key: 'development@api@web' }))).toEqual(['key:key-stage']);
  });

  it('tool and request: a lowercase slug', () => {
    for (const kind of ['tool', 'request']) {
      expect(codes(good({ kind, key: 'release-notes' }))).toEqual([]);
      expect(codes(good({ kind, key: 'git' }))).toEqual([]);
      expect(codes(good({ kind, key: 'Release Notes' }))).toEqual(['key:key-form']);
      expect(codes(good({ kind, key: '-lead' }))).toEqual(['key:key-form']);
    }
  });

  it('tool and request: an agent-chosen slug may not be a token', () => {
    expect(codes(good({ kind: 'request', key: 'a1b2c3d4e5f6a7b8c9d0e1f2' }))).toContain('key:token');
  });

  it('a key over 80 characters is refused', () => {
    expect(codes(good({ kind: 'tool', key: 'a'.repeat(81) }))).toEqual(['key:too-long']);
  });
});

// Each class of text a record may not hold, with a text that passes and one that is refused. A false positive refuses and teaches, by design.
describe('checkContent: what a record never holds', () => {
  const field = (text: string): Record<string, unknown> => good({ steps: [{ text }] });
  const gui = (text: string): Record<string, unknown> => good({ kind: 'gui', key: 'docs.example.com', steps: [{ text }] });

  const table: [string, string, string, string][] = [
    ['email', 'Sign in as the shared account', 'Sign in as someone@example.com', 'email'],
    ['digit run', 'Open the page 12345', 'Account 123456 is the one', 'digits'],
    ['digit run, spaced', 'Run it 3 times', 'Call 555 123 4567', 'digits'],
    ['digit run, sixteen', 'Wait for 20 s', 'Card 4111111111111111 was used', 'digits'],
    ['digit run, a date-like number', 'Wait for 20 s', 'Done on 2026-13-45-99', 'digits'],
    ['opaque token', 'Open docs.example.com/budget/sheets', 'Use abc123def456ghi789jk', 'token'],
    ['url query', 'Open docs.example.com/budget/sheets', 'Open https://docs.example.com/a?id=x', 'url-query'],
    ['url fragment', 'Open docs.example.com/budget/sheets', 'Open docs.example.com/a#top', 'url-query'],
    ['credential', 'Set the token field to <value>', 'Run with Authorization: Bearer abcdefghijkl', 'credential'],
    ['key prefix', 'Paste the key as <value>', 'Use sk-ant-abcdefghijklmnop', 'credential'],
    ['home folder', 'Open ~/project in the editor', 'Open /home/someone/project in the editor', 'home'],
  ];

  it.each(table)('%s: the example that passes and the one that is refused', (_name, pass, refuse, code) => {
    expect(codes(field(pass)), pass).toEqual([]);
    const got = codes(field(refuse));
    expect(got, refuse).toContain(`steps[0].text:${code}`);
  });

  it('accepts a pinned version and an ISO date or instant, which are ordinary in a command and a pitfall', () => {
    expect(codes(good({ steps: [{ text: 'Install it', run: 'npm i pkg@1.2.3' }] }))).toEqual([]);
    expect(codes(good({ steps: [{ text: 'Install it', run: 'npm i @scope/pkg@1.2.3' }] }))).toEqual([]);
    expect(codes(good({ steps: [{ text: 'Install it', run: 'npm i @angular-devkit/build-angular@17.0.0-rc.1' }] }))).toEqual([]);
    expect(codes(good({ pitfalls: ['pkg@10.20.30 fails; use pkg@v2.1.0'] }))).toEqual([]);
    expect(codes(good({ pitfalls: ['The dump of 2026-10-09 is stale'] }))).toEqual([]);
    expect(codes(good({ waits: ['The report of 2026-10-09T12:30:45.000Z lags'] }))).toEqual([]);
  });

  it('still refuses an address and a number next to a version or a date', () => {
    expect(codes(good({ pitfalls: ['Ask person@example.com'] }))).toContain('pitfalls[0]:email');
    expect(codes(good({ pitfalls: ['Mail pkg@1.2.3 and person@example.com'] }))).toContain('pitfalls[0]:email');
    expect(codes(good({ pitfalls: ['Account 4111111111111111 on 2026-10-09'] }))).toContain('pitfalls[0]:digits');
    expect(codes(good({ pitfalls: ['Use 20261009123456 for 2026-10-09'] }))).toContain('pitfalls[0]:digits');
  });

  it('applies to the command of a step, a pitfall and a wait as well', () => {
    expect(codes(good({ steps: [{ text: 'Run', run: 'curl https://example.com/a?key=1' }] }))).toContain('steps[0].run:url-query');
    expect(codes(good({ pitfalls: ['Mail someone@example.com'] }))).toContain('pitfalls[0]:email');
    expect(codes(good({ waits: ['Wait 1234567 ms'] }))).toContain('waits[0]:digits');
    expect(codes(good({ title: 'Account 123456' }))).toContain('title:digits');
  });

  it('refuses a credential in a command and does not mask it', () => {
    const r = checkContent(good({ steps: [{ text: 'Run', run: 'deploy --password=hunter2hunter2' }] }), ctx);
    expect(r.ok).toBe(false);
  });

  it('a gui step or note that quotes more than 40 characters is refused; a short label is not', () => {
    const label = 'a'.repeat(41);
    expect(codes(gui('Click the button "Save"'))).toEqual([]);
    expect(codes(gui(`Read the message "${label}"`))).toContain('steps[0].text:quote');
    expect(codes(gui(`Read the message \u201c${label}\u201d`))).toContain('steps[0].text:quote');
    expect(codes(gui(`Read the message '${label}'`))).toContain('steps[0].text:quote');
    expect(codes({ ...gui('Click Save'), pitfalls: [`Do not trust "${label}"`] })).toContain('pitfalls[0]:quote');
    expect(codes({ ...gui('Click Save'), steps: [{ text: 'Click', run: `button "${label}"` }] })).toContain('steps[0].run:quote');
  });

  it('quotation marks are page content only for gui; an apostrophe does not pair up', () => {
    const label = 'a'.repeat(41);
    expect(codes(field(`The test prints "${label}"`))).toEqual([]);
    expect(codes(gui("The user's name field and the other user's page are both on the list of the account"))).toEqual([]);
  });

  it('a refusal names the field and the reason and never echoes the value', () => {
    const secret = 'Account 987654 and someone@example.com';
    const r = checkContent(field(secret), ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = describeRefusals(r.refusals);
    expect(text).toContain('steps[0].text');
    expect(text).not.toContain('987654');
    expect(text).not.toContain('someone@example.com');
  });
});

describe('parseRecord', () => {
  it('reads a record of this version', () => {
    const r = parseRecord(stored());
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.record.id).toBe('p-3fa91c02');
  });

  it('a record a newer app wrote is neither read nor taken for invalid', () => {
    expect(parseRecord(stored({ v: PROCEDURE_VERSION + 1, anything: 1 }))).toEqual({ status: 'newer', v: PROCEDURE_VERSION + 1 });
    expect(parseRecord({ v: 99 })).toEqual({ status: 'newer', v: 99 });
  });

  it.each([
    ['not an object', null],
    ['no version', { ...stored(), v: undefined }],
    ['a bad id', stored({ id: 'p-xyz' })],
    ['a revision of zero', stored({ revision: 0 })],
    ['an unknown kind', stored({ kind: 'note' })],
    ['steps that are strings', stored({ steps: ['a'] })],
    ['a state of its own', stored({ state: 'great' })],
    ['stats missing', stored({ stats: null })],
    ['a bad instant', stored({ lastVerified: 'yesterday' })],
    ['a surface that does not exist', stored({ origin: { by: 'w', createdBy: 'w', surface: 'moon', at: '2026-10-09T10:00:00.000Z' } })],
  ])('refuses %s as invalid', (_name, raw) => {
    expect(parseRecord(raw).status).toBe('invalid');
  });
});

describe('helpers', () => {
  it('compares keys and titles without regard to case and spaces', () => {
    expect(sameKey('Docs.Example.com', 'docs.example.com')).toBe(true);
    expect(sameKey('a', 'b')).toBe(false);
    expect(normalTitle('  Run  the Tests ')).toBe('run the tests');
  });

  it('lists a record as old after 90 days without a verification, or without one since it was written', () => {
    const now = Date.parse('2026-10-09T00:00:00Z');
    const rec = (lastVerified: string | null, at: string) => ({ lastVerified, origin: { at } }) as Pick<ProcedureRecord, 'lastVerified' | 'origin'>;
    expect(isOld(rec('2026-08-01T00:00:00Z', '2026-01-01T00:00:00Z'), now)).toBe(false);
    expect(isOld(rec('2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z'), now)).toBe(true);
    expect(isOld(rec(null, '2026-06-01T00:00:00Z') as never, now)).toBe(true);
    expect(isOld(rec(null, '2026-10-01T00:00:00Z') as never, now)).toBe(false);
  });
});
