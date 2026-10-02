import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SECRETS_FILE, type CryptoPort, SecretError, createSecretsStore } from '../src/main/secrets-core';

// safeStorage stand-in: "encrypts" by reversing and tagging, so a test can tell ciphertext from plain text.
const keychain = (available = true): CryptoPort => ({
  available: () => available,
  encrypt: (text) => Buffer.from(`enc:${[...text].reverse().join('')}`),
  decrypt: (data) => {
    const raw = data.toString();
    if (!raw.startsWith('enc:')) throw new Error('not ciphertext');
    return [...raw.slice(4)].reverse().join('');
  },
  backend: () => (available ? 'gnome_libsecret' : 'basic_text'),
});

let root: string;
let env: NodeJS.ProcessEnv;
let ran: { command: string; args: string[] }[];
let commandOutput: string | Error;
let executables: Set<string>;

function store(crypto: CryptoPort = keychain()) {
  return createSecretsStore({
    root,
    crypto,
    env,
    home: '/home/ana',
    now: () => new Date('2026-10-02T12:00:00Z'),
    run: (command, args) => {
      ran.push({ command, args });
      if (commandOutput instanceof Error) throw commandOutput;
      return commandOutput;
    },
    exists: (p) => executables.has(p),
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cerimonias-secrets-'));
  env = {};
  ran = [];
  commandOutput = 'cmd-secret-value\n';
  executables = new Set(['/home/ana/.local/bin/openrouter-key']);
});

const VALUE = 'sk-this-is-a-test-value';

describe('stored secrets (OS keychain)', () => {
  it('writes only ciphertext to disk, with mode 0600, and reads the value back', () => {
    const s = store();
    s.set({ ref: 'llm.anthropic', source: 'stored', value: VALUE });
    const raw = readFileSync(join(root, SECRETS_FILE), 'utf8');
    expect(raw).not.toContain(VALUE);
    expect(raw).toContain('"cipher"');
    expect((statSync(join(root, SECRETS_FILE)).mode & 0o777).toString(8)).toBe('600');
    expect(s.resolve('llm.anthropic')).toBe(VALUE);
    expect(store().resolve('llm.anthropic')).toBe(VALUE);
  });

  it('never returns a value from list() and reports availability', () => {
    const s = store();
    s.set({ ref: 'llm.anthropic', source: 'stored', value: VALUE });
    const [info] = s.list();
    expect(info).toMatchObject({ ref: 'llm.anthropic', source: 'stored', detail: '', available: true });
    expect(JSON.stringify(s.list())).not.toContain(VALUE);
  });

  it('cannot decrypt when the keychain went away, and says so without the value', () => {
    store().set({ ref: 'llm.anthropic', source: 'stored', value: VALUE });
    const later = store(keychain(false));
    expect(() => later.resolve('llm.anthropic')).toThrow(/keychain is not available/);
    expect(later.check('llm.anthropic')).toEqual({ ok: false, reason: expect.stringContaining('keychain') });
    expect(later.list()[0].available).toBe(false);
  });

  it('replaces and removes', () => {
    const s = store();
    s.set({ ref: 'a', source: 'stored', value: 'one' });
    s.set({ ref: 'a', source: 'stored', value: 'two' });
    expect(s.resolve('a')).toBe('two');
    s.remove('a');
    expect(() => s.resolve('a')).toThrow(SecretError);
    expect(s.has('a')).toBe(false);
  });
});

describe('without a keychain', () => {
  it('refuses to store a value in plain text until the user explicitly accepts the insecure file', () => {
    const s = store(keychain(false));
    expect(s.storage()).toMatchObject({ secure: false, insecureAccepted: false, canStore: false });
    expect(() => s.set({ ref: 'a', source: 'stored', value: VALUE })).toThrow(expect.objectContaining({ code: 'insecure-refused' }));
    expect(existsSync(join(root, SECRETS_FILE))).toBe(false);
  });

  it('after the explicit acceptance it writes a clearly labelled 0600 file', () => {
    const s = store(keychain(false));
    s.acceptInsecureStorage();
    expect(s.storage()).toMatchObject({ insecureAccepted: true, canStore: true });
    s.set({ ref: 'a', source: 'stored', value: VALUE });
    const file = JSON.parse(readFileSync(join(root, SECRETS_FILE), 'utf8'));
    expect(file.warning).toMatch(/plain/);
    expect(file.insecure).toEqual({ accepted: true, acceptedAt: '2026-10-02T12:00:00.000Z' });
    expect(file.entries.a.plain).toBe(VALUE);
    expect((statSync(join(root, SECRETS_FILE)).mode & 0o777).toString(8)).toBe('600');
    expect(store(keychain(false)).resolve('a')).toBe(VALUE);
  });

  it('command and environment sources need no keychain at all', () => {
    const s = store(keychain(false));
    env.MY_KEY = 'from-env';
    s.set({ ref: 'e', source: 'env', name: 'MY_KEY' });
    s.set({ ref: 'c', source: 'command', command: '~/.local/bin/openrouter-key' });
    expect(s.resolve('e')).toBe('from-env');
    expect(s.resolve('c')).toBe('cmd-secret-value');
  });
});

describe('command source (the author\'s openrouter-key script keeps working)', () => {
  it('runs the expanded executable without a shell, trims the output and keeps it for the life of the process', () => {
    const s = store();
    s.set({ ref: 'llm.openrouter', source: 'command', command: '~/.local/bin/openrouter-key', args: ['--print'] });
    expect(s.resolve('llm.openrouter')).toBe('cmd-secret-value');
    expect(s.resolve('llm.openrouter')).toBe('cmd-secret-value');
    expect(ran).toEqual([{ command: '/home/ana/.local/bin/openrouter-key', args: ['--print'] }]);
    s.forget('llm.openrouter');
    s.resolve('llm.openrouter');
    expect(ran).toHaveLength(2);
  });

  it('shows the command, never its output', () => {
    const s = store();
    s.set({ ref: 'llm.openrouter', source: 'command', command: '~/.local/bin/openrouter-key' });
    s.resolve('llm.openrouter');
    expect(s.list()[0]).toMatchObject({ source: 'command', detail: '~/.local/bin/openrouter-key', available: true });
    expect(readFileSync(join(root, SECRETS_FILE), 'utf8')).not.toContain('cmd-secret-value');
  });

  it('turns a failing or empty command into a clear error without leaking anything', () => {
    const s = store();
    s.set({ ref: 'c', source: 'command', command: '~/.local/bin/openrouter-key' });
    commandOutput = Object.assign(new Error('Command failed: token=abc123'), { status: 2 });
    expect(() => s.resolve('c')).toThrow(/failed \(2\)/);
    expect(() => s.resolve('c')).not.toThrow(/abc123/);
    commandOutput = '  \n';
    expect(() => s.resolve('c')).toThrow(/empty/);
  });

  it('refuses a command with control characters', () => {
    expect(() => store().set({ ref: 'c', source: 'command', command: 'x\nrm -rf ~' })).toThrow(/control/);
  });
});

describe('environment source', () => {
  it('reads the variable on demand and reports when it is not set', () => {
    const s = store();
    s.set({ ref: 'e', source: 'env', name: 'MY_KEY' });
    expect(s.check('e')).toEqual({ ok: false, reason: expect.stringContaining('MY_KEY is not set') });
    env.MY_KEY = ' later-value ';
    expect(s.resolve('e')).toBe('later-value');
  });

  it('validates the variable name and the reference', () => {
    const s = store();
    expect(() => s.set({ ref: 'e', source: 'env', name: 'not a name' })).toThrow(/invalid environment/);
    expect(() => s.set({ ref: 'Bad Ref', source: 'stored', value: 'x' })).toThrow(/invalid secret reference/);
    expect(() => s.resolve('../etc')).toThrow(/invalid secret reference/);
  });
});

describe('a damaged secrets file', () => {
  it('is reported, never silently replaced', () => {
    writeFileSync(join(root, SECRETS_FILE), '{not json');
    expect(() => store().list()).toThrow(/unreadable/);
  });
});
