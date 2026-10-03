// The commands the app runs for QA: real processes here (a node one-liner, no network), the environment they get, what is kept of their output.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLoginPath, loginEnv } from '../src/main/loginPath';
import { OUTPUT_LIMIT, createCommandRunner, notRunReport, outcomeOf, runCommand, runCommands, tail } from '../src/main/runner/commands';
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
    expect(text).toContain('agora há pouco, neste worktree');
    expect(text).toContain('observados nesta etapa');
    expect(commandsSection([])).toContain('não rodou nenhum comando');
  });
});

// A command is found where the person's own shell would find it: the PATH of their login shell goes in front of the app's. Real processes, a fake login shell.
describe('the commands of a run in an app that was not started from a terminal', () => {
  const tools = mkdtempSync(join(tmpdir(), 'runner-login-bin-'));
  const script = (name: string, body: string, mode = 0o755): void => {
    mkdirSync(tools, { recursive: true });
    writeFileSync(join(tools, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(tools, name), mode);
  };
  script('fakenpm', 'echo "fakenpm ran with $@"');
  script('needs-vitest', 'echo "sh: 1: vitest: not found" >&2; exit 127');
  script('not-executable', 'echo no', 0o644);
  // node is not in /usr/bin on every machine (CI installs it elsewhere): the app's PATH keeps the folder of the node running the tests.
  const appEnv = { PATH: `/usr/bin:/bin:${dirname(process.execPath)}` } as NodeJS.ProcessEnv;
  const withLogin = (path: string | null) => createCommandRunner(() => loginEnv(appEnv, createLoginPath({ env: { SHELL: '/bin/fakeshell' }, run: async () => (path === null ? Promise.reject(new Error('no shell')) : `motd\n__coxia_path_start__${path}__coxia_path_end__`) })));

  it('finds a tool that only the login shell\'s PATH has, and does not find it without that PATH', async () => {
    const found = await withLogin(`${tools}:/usr/bin`)(cwd, 'fakenpm test', { timeoutMs: 20_000 });
    expect(found).toMatchObject({ exitCode: 0, timedOut: false });
    expect(found.notRun).toBeUndefined();
    expect(found.output).toContain('fakenpm ran with test');
    const lost = await withLogin(null)(cwd, 'fakenpm test', { timeoutMs: 20_000 });
    expect(lost).toMatchObject({ exitCode: null, notRun: 'enoent' });
    expect(outcomeOf(lost)).toBe('not-run');
  });

  it('says a command that could not run is not a failure of the code: not found, not executable, and the shell\'s 127 with what it said', async () => {
    const run = withLogin(`${tools}:/usr/bin`);
    const [missing, denied, inner, failed] = await runCommands(['definitely-not-a-command-xyz', 'not-executable', 'needs-vitest', node('process.exit(2)')], cwd, run);
    expect(missing).toMatchObject({ exitCode: null, notRun: 'enoent' });
    expect(denied).toMatchObject({ exitCode: null, notRun: 'eacces' });
    expect(inner).toMatchObject({ exitCode: 127, notRun: 'exit' });
    expect(inner.output).toContain('vitest: not found');
    expect([missing, denied, inner].map(outcomeOf)).toEqual(['not-run', 'not-run', 'not-run']);
    // a command that ran and failed is a failure, and has no such mark
    expect(failed).toMatchObject({ exitCode: 2 });
    expect(failed.notRun).toBeUndefined();
    expect(outcomeOf(failed)).toBe('failed');
    const report = notRunReport([missing, denied, inner, failed]);
    expect(report?.count).toBe(3);
    expect(report?.list).toContain('definitely-not-a-command-xyz: definitely-not-a-command-xyz não foi encontrado pelo app');
    expect(report?.list).toContain('not-executable: not-executable não pode ser executado');
    expect(report?.list).toContain('needs-vitest: ele disse: sh: 1: vitest: not found');
    expect(report?.list).not.toContain('process.exit');
    expect(notRunReport([failed])).toBeNull();
  });

  it('still takes the credentials out of what the command is given, whatever the login shell added', async () => {
    process.env.TEST_PROVIDER_API_KEY = 'sk-test-must-not-leak';
    const seen = await createCommandRunner(() => loginEnv({ ...process.env, PATH: process.env.PATH }, createLoginPath({ env: { SHELL: '/bin/fakeshell' }, run: async () => `__coxia_path_start__${tools}:/usr/bin__coxia_path_end__` })))(cwd, node('console.log(String(process.env.TEST_PROVIDER_API_KEY), process.env.PATH.split(\':\')[0])'), { timeoutMs: 20_000 });
    expect(seen.output).toBe(`undefined ${tools}`);
  });
});
