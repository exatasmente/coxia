// The commands the app runs for QA: real processes here (a node one-liner, no network), the environment they get, what is kept of their output.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OUTPUT_LIMIT, outcomeOf, runCommand, runCommands, tail } from '../src/main/runner/commands';
import { commandsSection } from '../src/main/runner/prompt';
import { setLanguage } from '../src/shared/i18n';

const cwd = mkdtempSync(join(tmpdir(), 'runner-commands-'));
const node = (code: string): string => `node -e "${code}"`;

afterEach(() => {
  delete process.env.TEST_PROVIDER_API_KEY;
  setLanguage('pt-BR');
});

describe('running a command for QA', () => {
  it('captures the output and the exit code, in the folder it was given', async () => {
    const ok = await runCommand(cwd, node('console.log(process.cwd()); console.error(\'warn\')'), { timeoutMs: 20_000 });
    expect(ok).toMatchObject({ exitCode: 0, timedOut: false });
    expect(ok.output).toContain(cwd.split('/').pop());
    expect(ok.output).toContain('warn');
    const bad = await runCommand(cwd, node('console.log(\'3 failing\'); process.exit(3)'), { timeoutMs: 20_000 });
    expect(bad).toMatchObject({ exitCode: 3, timedOut: false });
    expect(bad.output).toContain('3 failing');
    expect(outcomeOf(ok)).toBe('ok');
    expect(outcomeOf(bad)).toBe('failed');
  });

  it('gives the command no variable that looks like a credential, and masks what looks like one in the output', async () => {
    process.env.TEST_PROVIDER_API_KEY = 'sk-test-must-not-leak';
    const r = await runCommand(cwd, node('console.log(\'key=\' + process.env.TEST_PROVIDER_API_KEY); console.log(\'password: hunter2\')'), { timeoutMs: 20_000 });
    expect(r.output).toContain('key=undefined');
    expect(r.output).not.toContain('sk-test-must-not-leak');
    expect(r.output).not.toContain('hunter2');
  });

  it('stops a command that takes too long, and says it did not run to an exit', async () => {
    const r = await runCommand(cwd, node('setTimeout(() => {}, 20000)'), { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(outcomeOf(r)).toBe('timeout');
  });

  it('says a command that does not exist did not run, without throwing, and runs the rest', async () => {
    const [missing, ok] = await runCommands(['definitely-not-a-command-xyz --version', node('console.log(1)')], cwd, runCommand);
    expect(missing).toMatchObject({ exitCode: null, timedOut: false });
    expect(outcomeOf(missing)).toBe('not-run');
    expect(ok).toMatchObject({ exitCode: 0 });
  });

  it('does not run the commands after the signal stopped', async () => {
    const stop = new AbortController();
    stop.abort();
    expect(await runCommands([node('console.log(1)')], cwd, runCommand, stop.signal)).toEqual([]);
  });
});

describe('what is kept of an output', () => {
  it('is the end of it, cut at a line, with the cut said; short output stays whole and colours go', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const cut = tail(lines);
    expect(cut.length).toBeLessThanOrEqual(OUTPUT_LIMIT + 10);
    expect(cut.startsWith('[…]\nline ')).toBe(true);
    expect(cut.endsWith('line 1999')).toBe(true);
    expect(tail('\x1b[31mred\x1b[0m\r\nok')).toBe('red\nok');
  });
});

describe('what QA is given', () => {
  it('lists each command with how it ended and the end of its output, or says that nothing ran', () => {
    // the prompts are in the workspace's language (Portuguese here, as the config of the tests)
    const text = commandsSection([
      { command: 'npm test', exitCode: 1, timedOut: false, output: '1 failing', ms: 5 },
      { command: 'npm run typecheck', exitCode: 0, timedOut: false, output: '', ms: 5 },
      { command: 'npm run slow', exitCode: null, timedOut: true, output: '', ms: 5 },
      { command: 'nope', exitCode: null, timedOut: false, output: '', ms: 0 },
    ]);
    expect(text).toContain('$ npm test  (saiu com 1)\n1 failing');
    expect(text).toContain('$ npm run typecheck  (saiu com 0)\n(sem saída)');
    expect(text).toContain('$ npm run slow  (interrompido por passar do tempo)');
    expect(text).toContain('$ nope  (não chegou a rodar)');
    expect(text).toContain('você não roda nada');
    expect(commandsSection([])).toContain('não rodou nenhum comando');
  });
});
