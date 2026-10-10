// The session of an agent set to `shell: host`, with real processes: it runs in the folder it is given, asks before every command, gives back the exit code and the end of
// the output, cleans credentials out of the environment, stops a command at its limit, and ends what a command left in the background when the stage ends.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openHostSession } from '../src/main/sandbox/host';
import { renderExec } from '../src/main/sandbox/tool';
import { createTypedValues } from '../src/main/screen/typedValues';
import { watchdog } from '../src/main/runner/executor';

const posix = process.platform !== 'win32';
const folder = () => mkdtempSync(join(tmpdir(), 'host-session-'));
const limits = { commandMs: 5_000, stageMs: 60_000 };
const env = async () => ({ ...process.env, GITHUB_TOKEN: 'ghp_not_a_real_token', SOME_SETTING: 'kept' });

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.runIf(posix)('a host session', () => {
  it('runs a command in its folder and answers with the exit code and the output', async () => {
    const cwd = folder();
    const s = openHostSession({ cwd, limits, env });
    const ok = await s.exec('pwd && echo hello');
    const bad = await s.exec('echo broken >&2; exit 3');
    await s.close();
    expect(ok.exitCode).toBe(0);
    expect(ok.output).toContain(cwd);
    expect(ok.output).toContain('hello');
    expect(bad.exitCode).toBe(3);
    expect(bad.output).toContain('broken');
    expect(s.log.map((r) => r.n)).toEqual([1, 2]);
  });

  it('cleans what looks like a credential out of the environment and keeps the rest', async () => {
    const s = openHostSession({ cwd: folder(), limits, env });
    const r = await s.exec('echo "first=[$GITHUB_TOKEN] second=[$SOME_SETTING]"');
    await s.close();
    expect(r.output).toBe('first=[] second=[kept]');
  });

  it('runs nothing the person did not allow, and gives the agent their note', async () => {
    const cwd = folder();
    const asked: string[] = [];
    const s = openHostSession({ cwd, limits, env, approve: async (c) => (asked.push(c), c.includes('touch') ? { ok: false, note: 'not that file' } : { ok: true }) });
    const denied = await s.exec('touch made-by-agent');
    const allowed = await s.exec('echo fine');
    await s.close();
    expect(asked).toEqual(['touch made-by-agent', 'echo fine']);
    expect(denied).toMatchObject({ refused: 'denied', exitCode: null, output: 'not that file' });
    expect(existsSync(join(cwd, 'made-by-agent'))).toBe(false);
    expect(allowed.exitCode).toBe(0);
  });

  it('does not ask for an empty command, and refuses one after the session ended', async () => {
    let asked = 0;
    const s = openHostSession({ cwd: folder(), limits, env, approve: async () => (asked++, { ok: true }) });
    expect((await s.exec('   ')).refused).toBe('empty');
    await s.close();
    expect((await s.exec('echo late')).refused).toBe('closed');
    expect(asked).toBe(0);
  });

  it('stops a command at its time limit', async () => {
    const s = openHostSession({ cwd: folder(), limits: { commandMs: 300, stageMs: 60_000 }, env });
    const r = await s.exec('sleep 10');
    await s.close();
    expect(r.timedOut).toBe(true);
    expect(r.ms).toBeLessThan(5_000);
  });

  it('keeps a process started in the background for the next command, and ends it with the stage', async () => {
    const s = openHostSession({ cwd: folder(), limits, env });
    const started = await s.exec('sleep 30 > /dev/null 2>&1 & echo $!');
    const pid = Number(started.output.trim());
    expect(started.exitCode).toBe(0);
    expect(alive(pid)).toBe(true);
    expect((await s.exec('echo next')).exitCode).toBe(0);
    expect(alive(pid)).toBe(true);
    await s.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(alive(pid)).toBe(false);
  });
});

// While the person holds the screen for a hand-off (#178) the agent's commands are refused at the door and again when they come up, without the person being asked to allow
// them, and what the person typed is taken out of the output of the ones that run.
describe.runIf(posix)('a host session while the person has the screen', () => {
  it('refuses a command without asking the person to allow it, without running it, without logging it, and runs again after', async () => {
    const cwd = folder();
    const asked: string[] = [];
    const seen: string[] = [];
    let held = false;
    const s = openHostSession({ cwd, limits, env, held: () => held, onExec: (r) => seen.push(r.command), approve: async (c) => (asked.push(c), { ok: true }) });
    held = true;
    const refused = await s.exec('touch made-while-held');
    expect(refused).toMatchObject({ refused: 'handoff', exitCode: null, output: '' });
    expect(renderExec(refused)).toBe('The person has the screen; wait for the hand-off result.');
    expect(existsSync(join(cwd, 'made-while-held'))).toBe(false);
    expect(asked).toEqual([]);
    expect(seen).toEqual([]);
    expect(s.log).toEqual([]);
    held = false;
    const after = await s.exec('echo back');
    await s.close();
    expect(after).toMatchObject({ n: 1, exitCode: 0, output: 'back' });
    expect(asked).toEqual(['echo back']);
  });

  it('refuses again a command that was queued before the interval, behind a long one, and does not ask for it', async () => {
    const cwd = folder();
    const asked: string[] = [];
    let held = false;
    const s = openHostSession({ cwd, limits, env, held: () => held, approve: async (c) => (asked.push(c), { ok: true }) });
    const slow = s.exec('sleep 0.3; echo slow');
    const queued = s.exec('touch made-by-the-queued-one');
    // The slow one is running when the person takes the screen.
    await new Promise((r) => setTimeout(r, 100));
    held = true;
    const [a, b] = await Promise.all([slow, queued]);
    await s.close();
    // The one already running is not stopped; the one behind it never starts.
    expect(a).toMatchObject({ exitCode: 0, output: 'slow' });
    expect(b).toMatchObject({ refused: 'handoff' });
    expect(existsSync(join(cwd, 'made-by-the-queued-one'))).toBe(false);
    expect(asked).toEqual(['sleep 0.3; echo slow']);
  });

  it('refuses a command the person allowed after the interval began', async () => {
    const cwd = folder();
    let held = false;
    let allow: (v: { ok: boolean }) => void = () => undefined;
    const s = openHostSession({ cwd, limits, env, held: () => held, approve: () => new Promise((r) => (allow = r)) });
    const pending = s.exec('touch made-after-allow');
    await new Promise((r) => setTimeout(r, 20));
    held = true;
    allow({ ok: true });
    expect(await pending).toMatchObject({ refused: 'handoff' });
    await s.close();
    expect(existsSync(join(cwd, 'made-after-allow'))).toBe(false);
  });

  it('takes what the person typed out of the output, in the three forms, before the pattern masking', async () => {
    const typed = createTypedValues();
    const value = 'p@ss "w0rd"/x';
    typed.add([value]);
    const s = openHostSession({ cwd: folder(), limits, env, mask: typed.mask });
    const r = await s.exec(`printf '%s|%s|%s' ${JSON.stringify(value)} ${JSON.stringify(encodeURIComponent(value))} ${JSON.stringify(JSON.stringify(value).slice(1, -1))}`);
    const err = await s.exec(`echo ${JSON.stringify(value)} >&2; exit 2`);
    await s.close();
    expect(r.output).toBe('[secret]|[secret]|[secret]');
    expect(err.output).toBe('[secret]');
    expect(err.exitCode).toBe(2);
    // The log the thread and the evidence read holds the masked text too.
    expect(s.log.map((x) => x.output)).toEqual(['[secret]|[secret]|[secret]', '[secret]']);
  });

  it('does not show an output the mask could not check', async () => {
    const s = openHostSession({ cwd: folder(), limits, env, mask: () => { throw new Error('boom'); } });
    const r = await s.exec('echo something');
    await s.close();
    expect(r).toMatchObject({ output: '', outputUnavailable: true, exitCode: 0 });
  });
});

describe('the watchdog of a stage', () => {
  it('stands still while the agent waits for the person, and runs again after', async () => {
    const abort = new AbortController();
    const watch = watchdog(abort, { idleMs: 80, maxMs: 150 });
    let resume = (): void => undefined;
    const work = new Promise<string>((done) => {
      setTimeout(() => (resume = watch.pause()), 10);
      setTimeout(() => {
        resume();
        done('answered');
      }, 300);
    });
    await expect(watch.guard(work)).resolves.toBe('answered');
    expect(abort.signal.aborted).toBe(false);
  });

  it('still stops a silent agent once the wait is over', async () => {
    const abort = new AbortController();
    const watch = watchdog(abort, { idleMs: 80, maxMs: 10_000 });
    const never = new Promise<string>(() => undefined);
    setTimeout(() => watch.pause()(), 10);
    await expect(watch.guard(never)).rejects.toMatchObject({ name: 'StageError' });
    expect(abort.signal.aborted).toBe(true);
  });
});
