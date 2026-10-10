import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import { type SessionOptions, openSession } from '../src/main/sandbox/session';
import { OUTPUT_LIMIT } from '../src/main/runner/commands';
import { renderExec } from '../src/main/sandbox/tool';
import { createTypedValues } from '../src/main/screen/typedValues';

// The session against a fake program that speaks the supervisor's protocol: no sandbox is made. It answers the way the supervisor does: reads the line, runs a script of
// its own for the command, writes the output file and says "done".

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-session-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Fake {
  child: ChildProcess;
  lines: string[];
  killed: boolean;
  argvFd: string;
}

function fakeSpawn(behave: (command: string, n: number, out: (text: string) => void) => number | 'hang', o: { ready?: string; stderr?: string; dir?: string } = {}) {
  const made: Fake[] = [];
  const spawn: NonNullable<Parameters<typeof openSession>[1]>['spawn'] = (_file, _args, _opts) => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const fd3 = new PassThrough();
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    Object.assign(child, { stdin, stdout, stderr, stdio: [stdin, stdout, stderr, fd3], pid: undefined });
    const fake: Fake = { child, lines: [], killed: false, argvFd: '' };
    fd3.on('data', (c: Buffer) => (fake.argvFd += c.toString()));
    (child as { kill: (s?: string) => boolean }).kill = () => {
      fake.killed = true;
      stdout.end();
      queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
      return true;
    };
    if (o.stderr) stderr.write(o.stderr);
    setImmediate(() => {
      if (o.ready !== '') stdout.write(`${o.ready ?? 'ready'}\n`);
      else child.emit('exit', 1, null);
    });
    let buf = '';
    stdin.on('data', (c: Buffer) => {
      buf += c.toString();
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        fake.lines.push(line);
        const [id, token] = line.split(' ');
        if (id === 'quit') continue;
        const n = Number(id);
        const command = readFileSync(join(o.dir ?? dir, 'ctl', `cmd.${id}`), 'utf8').trim();
        const code = behave(command, n, (text) => writeFileSync(join(o.dir ?? dir, 'out', `out.${id}`), text));
        if (code !== 'hang') stdout.write(`done ${id} ${token} ${code}\n`);
      }
    });
    made.push(fake);
    return child as ChildProcess;
  };
  return { spawn, made };
}

const options = (over: Partial<SessionOptions> = {}): SessionOptions => ({ stageDir: dir, args: ['--unshare-user'], limits: neutralSandbox().limits, proxy: false, ...over });

describe('a session', () => {
  it('runs commands one after the other, numbers them, and reports each', async () => {
    const f = fakeSpawn((c, _n, out) => {
      out(`ran: ${c}\n`);
      return c === 'false' ? 1 : 0;
    });
    const seen: string[] = [];
    const s = await openSession(options({ onExec: (r, mode) => seen.push(`${r.n}:${mode}:${r.exitCode}`) }), { spawn: f.spawn });
    const [a, b] = await Promise.all([s.exec('echo one'), s.exec('false')]);
    expect(a).toMatchObject({ n: 1, exitCode: 0, output: 'ran: echo one', timedOut: false });
    expect(b).toMatchObject({ n: 2, exitCode: 1 });
    expect(seen).toEqual(['1:run:0', '2:run:1']);
    expect(s.log.map((r) => r.command)).toEqual(['echo one', 'false']);
    await s.close();
  });

  it('sends the options by the pipe, never on the command line', async () => {
    const f = fakeSpawn(() => 0);
    const s = await openSession(options({ args: ['--ro-bind', '/data/secret-place', '/x'] }), { spawn: f.spawn });
    expect(f.made[0].argvFd).toBe('--ro-bind\0/data/secret-place\0/x\0');
    await s.close();
  });

  it('refuses an empty command, one that is too long and one after the stage budget is spent, without running them', async () => {
    const f = fakeSpawn(() => 0);
    const limits = { ...neutralSandbox().limits, stageMs: 60_000 };
    const s = await openSession(options({ limits }), { spawn: f.spawn });
    expect(await s.exec('   ')).toMatchObject({ refused: 'empty', exitCode: null });
    expect(await s.exec('x'.repeat(9000))).toMatchObject({ refused: 'size' });
    expect(f.made[0].lines).toEqual([]);
    await s.close();
  });

  it('refuses a command when the stage budget is spent, and never lets one run past what is left of it', async () => {
    const f = fakeSpawn(() => 0);
    const none = await openSession(options({ limits: { ...neutralSandbox().limits, stageMs: 0 } }), { spawn: f.spawn });
    expect(await none.exec('echo')).toMatchObject({ refused: 'budget' });
    await none.close();
    const g = fakeSpawn(() => 0, { dir: join(dir, 'b') });
    const some = await openSession(options({ stageDir: join(dir, 'b'), limits: { ...neutralSandbox().limits, stageMs: 2_500, commandMs: 60_000 } }), { spawn: g.spawn });
    await some.exec('echo');
    // The command's own limit is what is left of the stage, rounded up to whole seconds.
    expect(g.made[0].lines[0]).toMatch(/^1 \w+ 3$/);
    await some.close();
  });

  it('says a command timed out when the program reports 124', async () => {
    const f = fakeSpawn(() => 124);
    const s = await openSession(options(), { spawn: f.spawn });
    expect(await s.exec('sleep 99')).toMatchObject({ timedOut: true, exitCode: 124 });
    await s.close();
  });

  it('masks what looks like a credential in the output and keeps only its end', async () => {
    const f = fakeSpawn((_c, _n, out) => {
      out(`${'x'.repeat(20_000)}\ntoken ghp_${'a'.repeat(30)}\nend\n`);
      return 0;
    });
    const s = await openSession(options(), { spawn: f.spawn });
    const r = await s.exec('print');
    expect(r.output).not.toContain('ghp_aaaa');
    expect(r.output.endsWith('end')).toBe(true);
    expect(r.output.length).toBeLessThan(7000);
    await s.close();
  });

  // While the person holds the screen for a hand-off (#178) a command is refused at the door and again when it comes up, and what the person typed is taken out of the output.
  it('refuses a command while the person has the screen, without sending it in, logging it or telling the thread, and runs again after', async () => {
    const f = fakeSpawn((_c, _n, out) => (out('ran\n'), 0));
    const seen: string[] = [];
    let held = false;
    const s = await openSession(options({ held: () => held, onExec: (r) => seen.push(r.command) }), { spawn: f.spawn });
    held = true;
    const refused = await s.exec('echo hi');
    expect(refused).toMatchObject({ refused: 'handoff', exitCode: null, output: '' });
    expect(renderExec(refused)).toBe('The person has the screen; wait for the hand-off result.');
    expect(f.made[0].lines).toEqual([]);
    expect(seen).toEqual([]);
    expect(s.log).toEqual([]);
    held = false;
    expect(await s.exec('echo back')).toMatchObject({ n: 1, exitCode: 0, output: 'ran' });
    expect(f.made[0].lines).toHaveLength(1);
    await s.close();
  });

  it('refuses again a command queued before the interval, behind one that is still running, and does not stop the running one', async () => {
    let finish: () => void = () => undefined;
    const f = fakeSpawn((c, _n, out) => {
      out(`ran ${c}\n`);
      return c === 'slow' ? 'hang' : 0;
    });
    let held = false;
    const s = await openSession(options({ held: () => held }), { spawn: f.spawn });
    const slow = s.exec('slow');
    const queued = s.exec('after');
    await new Promise((r) => setImmediate(r));
    held = true;
    // The program finishes the slow one.
    finish = () => (f.made[0].child.stdout as unknown as PassThrough).write(`done 1 ${f.made[0].lines[0].split(' ')[1]} 0\n`);
    finish();
    const [a, b] = await Promise.all([slow, queued]);
    expect(a).toMatchObject({ exitCode: 0, output: 'ran slow' });
    expect(b).toMatchObject({ refused: 'handoff' });
    expect(f.made[0].lines).toHaveLength(1);
    expect(s.log.map((r) => r.command)).toEqual(['slow']);
    await s.close();
  });

  it('takes what the person typed out of the output, in the three forms, and out of a value a long output would have cut in two', async () => {
    const typed = createTypedValues();
    const value = 'p@ss "w0rd"/x';
    typed.add([value]);
    const f = fakeSpawn((_c, _n, out) => {
      out(`marker-start ${value}|${encodeURIComponent(value)}|${JSON.stringify(value).slice(1, -1)}\n${'x'.repeat(20_000)}\nend\n`);
      return 0;
    });
    const s = await openSession(options({ mask: typed.mask }), { spawn: f.spawn });
    const r = await s.exec('print');
    expect(r.output).not.toContain('w0rd');
    expect(r.output.endsWith('end')).toBe(true);
    const short = fakeSpawn((_c, _n, out) => (out(`a ${value}|${encodeURIComponent(value)}|${JSON.stringify(value).slice(1, -1)}\n`), 0), { dir: join(dir, 'b') });
    const t = await openSession(options({ stageDir: join(dir, 'b'), mask: typed.mask }), { spawn: short.spawn });
    expect((await t.exec('print')).output).toBe('a [secret]|[secret]|[secret]');
    await s.close();
    await t.close();
  });

  it('finds a typed value that the cut of a long output would have split in two', async () => {
    const typed = createTypedValues();
    const value = 'marker-value-4821';
    typed.add([value]);
    // The kept end starts in the middle of the value: masking only the kept end would leave its second half in clear.
    const f = fakeSpawn((_c, _n, out) => (out(`${'y'.repeat(100)}${value}${'z'.repeat(OUTPUT_LIMIT - 8)}`), 0));
    const s = await openSession(options({ mask: typed.mask }), { spawn: f.spawn });
    const r = await s.exec('print');
    expect(r.output).not.toMatch(/value|4821|marker/);
    expect(r.output.endsWith('z')).toBe(true);
    await s.close();
  });

  it('finds a typed value that a terminal escape or a carriage return would hide from the exact match', async () => {
    const typed = createTypedValues();
    typed.add(['marker-value-4821']);
    const f = fakeSpawn((_c, _n, out) => (out('a marker-\x1b[0mvalue-4821 b marker\r-value-4821 c \x1b[31mmarker-value-4821\x1b[0m d\n'), 0));
    const s = await openSession(options({ mask: typed.mask }), { spawn: f.spawn });
    const r = await s.exec('print');
    expect(r.output).toBe('a [secret] b [secret] c [secret] d');
    await s.close();
  });

  it('does not show an output the mask could not check', async () => {
    const f = fakeSpawn((_c, _n, out) => (out('something\n'), 0));
    const s = await openSession(options({ mask: () => { throw new Error('boom'); } }), { spawn: f.spawn });
    expect(await s.exec('print')).toMatchObject({ output: '', outputUnavailable: true, exitCode: 0 });
    await s.close();
  });

  it('ends the program, removes the stage folder, and refuses what comes after', async () => {
    const f = fakeSpawn(() => 0);
    const s = await openSession(options(), { spawn: f.spawn });
    await s.close();
    await s.close();
    expect(f.made[0].killed).toBe(true);
    expect(f.made[0].lines).toContain('quit 0 0');
    expect(existsSync(dir)).toBe(false);
    expect(await s.exec('echo late')).toMatchObject({ refused: 'closed' });
  });

  it('runs what it was told to undo when it closes', async () => {
    const f = fakeSpawn(() => 0);
    let undone = 0;
    const s = await openSession(options({ cleanup: [() => void undone++] }), { spawn: f.spawn });
    await s.close();
    expect(undone).toBe(1);
  });

  it('reports where the display can be dialled from outside only when it came up, and makes its folder before the sandbox starts', async () => {
    const f = fakeSpawn(() => 0);
    const on = await openSession(options({ gui: { browsers: null, display: 'start' } }), { spawn: f.spawn });
    expect(on.gui?.display).toBe('on');
    expect(on.screen).toEqual({ socket: join(dir, 'x11', 'X99'), kind: 'sandbox' });
    expect(statSync(join(dir, 'x11')).isDirectory()).toBe(true);
    expect(statSync(join(dir, 'x11')).mode & 0o077).toBe(0);
    await on.close();
  });

  it('has no screen when the display did not come up, was not found or was not asked for', async () => {
    const down = join(dir, 'down');
    const failed = await openSession(options({ stageDir: down, gui: { browsers: null, display: 'start' } }), { spawn: fakeSpawn(() => 0, { ready: 'ready-nodisplay', dir: down }).spawn });
    expect(failed.gui?.display).toBe('failed');
    expect(failed.screen).toBeUndefined();
    await failed.close();
    const missing = join(dir, 'missing');
    const m = await openSession(options({ stageDir: missing, gui: { browsers: '/b', display: 'missing' } }), { spawn: fakeSpawn(() => 0, { dir: missing }).spawn });
    expect(m.screen).toBeUndefined();
    expect(existsSync(join(missing, 'x11'))).toBe(false);
    await m.close();
    const plain = join(dir, 'plain');
    const p = await openSession(options({ stageDir: plain }), { spawn: fakeSpawn(() => 0, { dir: plain }).spawn });
    expect(p.screen).toBeUndefined();
    expect(p.gui).toBeUndefined();
    expect(existsSync(join(plain, 'x11'))).toBe(false);
    await p.close();
  });

  it('fails, clean, when the program says it cannot start, and says why', async () => {
    const f = fakeSpawn(() => 0, { ready: '', stderr: 'bwrap: setting up uid map: Permission denied\n' });
    await expect(openSession(options({ readyMs: 500 }), { spawn: f.spawn })).rejects.toThrow(/setting up uid map/);
    expect(existsSync(dir)).toBe(false);
  });

  it('fails when the registry mode finds no node inside', async () => {
    const f = fakeSpawn(() => 0, { ready: 'no-node' });
    await expect(openSession(options({ proxy: true }), { spawn: f.spawn })).rejects.toThrow(/node/);
    expect(existsSync(dir)).toBe(false);
  });

  it('writes the forwarder only in registry mode', async () => {
    const f = fakeSpawn(() => 0);
    const s = await openSession(options({ proxy: true }), { spawn: f.spawn });
    expect(existsSync(join(dir, 'ctl', 'forward.js'))).toBe(true);
    await s.close();
  });
});
