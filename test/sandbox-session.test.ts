import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import { type SessionOptions, openSession } from '../src/main/sandbox/session';

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
