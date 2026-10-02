import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_PROMPT, SESSION_ID, resumeCommand as resume, shellQuote, terminalScript as script } from '../src/shared/claude-command';

// The wrapper and the folder the author's install used; the commands take them from the workspace config.
const CLI = { command: 'claude-alt', cwd: '~/projects' };
const resumeCommand = (id: string, prompt?: string) => resume(id, prompt, CLI);
const terminalScript = (withPrompt: boolean) => script(withPrompt, CLI);

const ID = '0a1b2c3d-4e5f-6789-abcd-ef0123456789';
const dir = mkdtempSync(join(tmpdir(), 'cerimonias-cmd-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Runs the script in a real bash with the side effects stubbed out, and prints one argv entry per line (NUL separated).
function argvOf(script: string, args: string[] = []): string[] {
  const stubs = [
    `cd() { :; }`,
    `claude-alt() { printf '%s\\0' "$@"; }`,
    `rm() { :; }`,
    `exec() { :; }`,
    `bash() { :; }`,
  ].join('\n');
  const out = execFileSync('bash', ['-c', `${stubs}\n${script}`, 'cerimonias', ...args], { encoding: 'utf8', cwd: dir });
  return out.split('\0').slice(0, -1);
}

const PAYLOADS = [
  `'; touch ${dir}/pwned1 #`,
  `$(touch ${dir}/pwned2)`,
  `\`touch ${dir}/pwned3\``,
  `a' && touch ${dir}/pwned4 && echo '`,
  `"; touch ${dir}/pwned5; "`,
  `linha 1\nlinha 2; touch ${dir}/pwned6`,
  `it's a trap`,
  `\\'; touch ${dir}/pwned7; echo \\'`,
];

describe('session id', () => {
  it('accepts a uuid', () => {
    expect(SESSION_ID.test(ID)).toBe(true);
  });

  it.each([
    '',
    'abc',
    `${ID}; rm -rf ~`,
    `${ID}\n`,
    `${ID} --dangerously-skip-permissions`,
    `$(id)`,
    ID.toUpperCase(),
    ID.slice(1),
    `${ID}0`,
  ])('refuses %j', (value) => {
    expect(SESSION_ID.test(value)).toBe(false);
  });
});

describe('resumeCommand (what the user pastes in a terminal)', () => {
  it('resumes without a prompt', () => {
    expect(resumeCommand(ID)).toBe(`cd ~/projects && claude-alt --resume ${ID}`);
    expect(resumeCommand(ID, '   ')).toBe(`cd ~/projects && claude-alt --resume ${ID}`);
  });

  it('passes the prompt after --, as one quoted argument', () => {
    expect(resumeCommand(ID, 'oi')).toBe(`cd ~/projects && claude-alt --resume ${ID} -- 'oi'`);
  });

  it.each(PAYLOADS)('delivers %j as a single argument, without running anything', (payload) => {
    const argv = argvOf(resumeCommand(ID, payload));
    expect(argv).toEqual(['--resume', ID, '--', payload.trim()]);
  });

  it('did not run any injected command', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(() => execFileSync('test', ['!', '-e', join(dir, `pwned${n}`)])).not.toThrow();
    }
  });
});

describe('shellQuote', () => {
  it('wraps in single quotes and escapes the single quote', () => {
    expect(shellQuote('abc')).toBe(`'abc'`);
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });

  it('round-trips through bash', () => {
    for (const p of PAYLOADS) {
      const out = execFileSync('bash', ['-c', `printf '%s' ${shellQuote(p)}`], { encoding: 'utf8', cwd: dir });
      expect(out).toBe(p);
    }
  });
});

describe('terminalScript (what the app runs with bash -lc)', () => {
  it('is a fixed script: the id and the prompt file are positional arguments', () => {
    const withPrompt = terminalScript(true);
    const without = terminalScript(false);
    expect(withPrompt).toContain('"$1"');
    expect(withPrompt).toContain('"$(cat "$2")"');
    expect(without).toContain('"$1"');
    expect(without).not.toContain('$2');
    expect(terminalScript(true)).toBe(withPrompt);
  });

  it.each(PAYLOADS)('reads the prompt %j from the file and passes it as one argument', (payload) => {
    const file = join(dir, 'prompt.txt');
    writeFileSync(file, payload);
    expect(argvOf(terminalScript(true), [ID, file])).toEqual(['--resume', ID, '--', payload]);
  });

  it('does not run anything that comes in the session id slot as part of the script text', () => {
    const argv = argvOf(terminalScript(false), [`${ID}; touch ${dir}/pwned8`]);
    expect(argv).toEqual(['--resume', `${ID}; touch ${dir}/pwned8`]);
    expect(() => execFileSync('test', ['!', '-e', join(dir, 'pwned8')])).not.toThrow();
  });

  it('cleans up the prompt directory only, after the call', () => {
    expect(terminalScript(true)).toMatch(/rm -rf "\$\(dirname "\$2"\)"/);
  });
});

describe('prompt limit', () => {
  it('stays well below one argv entry on Linux (128 KB)', () => {
    expect(MAX_PROMPT).toBeLessThan(128 * 1024);
    expect(MAX_PROMPT).toBeGreaterThan(0);
  });
});

describe('the CLI comes from the config', () => {
  it('defaults to plain claude in the home folder', () => {
    expect(resume(ID)).toBe(`cd ~ && claude --resume ${ID}`);
  });

  it('quotes a command or folder that is not a plain word, since they come from a file', () => {
    expect(resume(ID, undefined, { command: 'my cli', cwd: "/work/it's here" })).toBe(`cd '/work/it'\\''s here' && 'my cli' --resume ${ID}`);
    expect(script(false, { command: 'x; rm -rf ~', cwd: '/tmp' })).toBe(`cd /tmp && 'x; rm -rf ~' --resume "$1"; exec bash`);
  });
});
