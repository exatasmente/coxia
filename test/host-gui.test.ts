// Testing an interface from a host session (an agent set to `shell: host`): the same two settings as the sandbox's (#68) apply. The browsers folder comes in
// PLAYWRIGHT_BROWSERS_PATH, a QA stage gets a virtual display of its own (never the person's screen), screenshots go to a folder the app made and ViewImage reads only
// from there, and what is missing is said in the thread and the prompt. A host session with neither setting on is what it was. No test starts a real display.
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { Run } from '../src/shared/runs';
import { createSandboxService } from '../src/main/sandbox';
import { HOST_DISPLAY_ARGS, startHostDisplay } from '../src/main/sandbox/display';
import { hostDisplaySocket } from '../src/main/sandbox/host';
import { viewImageToolImpl } from '../src/main/sandbox/engineTool';
import { openHostSession } from '../src/main/sandbox/host';
import { offersViewImage, viewImageDescription } from '../src/main/sandbox/tool';
import { type Boot, boot, doc, fakeSandbox, keepQaEvidence, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const posix = process.platform !== 'win32';
// A 16×16 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO4I2JDEmIY1TCqYfhqAAAeBCwQ81sZJgAAAABJRU5ErkJggg==', 'base64');

let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-host-gui-'));
  // A browsers folder the guards accept lives outside /tmp, as in the sandbox's tests.
  home = mkdtempSync(join(process.cwd(), '.gui-home-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const limits = { commandMs: 5_000, stageMs: 60_000 };
const hostEnv = async (): Promise<NodeJS.ProcessEnv> => ({ PATH: process.env.PATH, DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XAUTHORITY: '/home/x/.Xauthority' });

/** A display program that is not there: a child whose pipe carries what the test says. */
function fakeProgram(o: { say?: string; exits?: boolean } = {}) {
  const killed: NodeJS.Signals[] = [];
  const spawn = () => {
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    const pipe = new PassThrough();
    Object.assign(child, { pid: undefined, stdio: [null, null, null, pipe], kill: (sig: NodeJS.Signals) => (killed.push(sig), setImmediate(() => child.emit('exit', null, sig)), true) });
    if (o.say) setImmediate(() => pipe.write(o.say as string));
    if (o.exits) setImmediate(() => child.emit('exit', 1, null));
    return child;
  };
  return { spawn, killed };
}

describe('the display of a host stage', () => {
  it('takes the display number the server says it took', async () => {
    const p = fakeProgram({ say: '101\n' });
    const d = await startHostDisplay('/usr/bin/Xvfb', { spawn: p.spawn });
    expect(d?.name).toBe(':101');
    await d?.stop();
    expect(p.killed).toEqual(['SIGTERM']);
  });

  it('is none when the server ends on its own, says nothing in time or says something that is not a number', async () => {
    expect(await startHostDisplay('/usr/bin/Xvfb', { spawn: fakeProgram({ exits: true }).spawn })).toBeNull();
    expect(await startHostDisplay('/usr/bin/Xvfb', { spawn: fakeProgram().spawn, readyMs: 30 })).toBeNull();
    expect(await startHostDisplay('/usr/bin/Xvfb', { spawn: fakeProgram({ say: 'oops\n' }).spawn, readyMs: 30 })).toBeNull();
    expect(
      await startHostDisplay('/nope', {
        spawn: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toBeNull();
  });
});

describe.runIf(posix)('a host session asked to test an interface', () => {
  const ask = (gui: Parameters<typeof openHostSession>[0]['gui']) => openHostSession({ cwd: root, limits, env: hostEnv, gui });

  it('is what it was when nothing was asked: the person\'s own environment, no folder, no tool', async () => {
    const s = openHostSession({ cwd: root, limits, env: hostEnv });
    const r = await s.exec('echo "[$DISPLAY][$PLAYWRIGHT_BROWSERS_PATH][$COXIA_OUT]"');
    await s.close();
    expect(r.output).toBe('[:0][][]');
    expect(s.gui).toBeUndefined();
    expect(s.readImage).toBeUndefined();
    expect(offersViewImage(s)).toBe(false);
  });

  it('gives a command the browsers folder, the stage\'s own display and a folder to save in, and not the person\'s screen', async () => {
    const s = ask({ browsers: '/b/ms-playwright', display: 'on', displayName: ':101' });
    const r = await s.exec('echo "$PLAYWRIGHT_BROWSERS_PATH $DISPLAY [$WAYLAND_DISPLAY][$XAUTHORITY] $COXIA_OUT"; test -d "$COXIA_OUT" && echo folder');
    const out = s.gui?.out as string;
    await s.close();
    expect(r.output).toContain(`/b/ms-playwright :101 [][] ${out}`);
    expect(r.output).toContain('folder');
    expect(s.gui).toEqual({ browsers: '/b/ms-playwright', display: 'on', out });
    expect(offersViewImage(s)).toBe(true);
  });

  it('reports where the stage\'s display can be dialled from the app, and only when it is on', async () => {
    const on = ask({ browsers: null, display: 'on', displayName: ':101' });
    expect(on.screen).toEqual({ socket: '/tmp/.X11-unix/X101', kind: 'host' });
    // What the prompt receives does not change: no path of this computer is in `gui`.
    expect(JSON.stringify(on.gui)).not.toContain('X11');
    // No display name (the server did not say which it took) is no socket either.
    const others = [ask({ browsers: null, display: 'missing' }), ask({ browsers: null, display: 'failed' }), ask({ browsers: '/b', display: null }), ask({ browsers: null, display: 'on' }), openHostSession({ cwd: root, limits, env: hostEnv })];
    for (const s of others) expect(s.screen).toBeUndefined();
    await Promise.all([on, ...others].map((s) => s.close()));
  });

  it('takes only a plain display number for a socket', () => {
    expect(hostDisplaySocket(':0')).toBe('/tmp/.X11-unix/X0');
    expect(hostDisplaySocket(':99999')).toBe('/tmp/.X11-unix/X99999');
    for (const bad of ['', ':', ':1.0', 'host:1', ':100000', ':-1', ':1/../../x', '/tmp/x']) expect(hostDisplaySocket(bad)).toBeNull();
  });

  it('starts the host display with the arguments it always had: no file for the framebuffer, no TCP', () => {
    expect(HOST_DISPLAY_ARGS).toEqual(['-displayfd', '3', '-screen', '0', '1280x800x24', '-nolisten', 'tcp']);
  });

  it('leaves a command no display at all when the one that was asked for is not there, so a window app does not open on the person\'s screen', async () => {
    const s = ask({ browsers: null, display: 'missing' });
    const r = await s.exec('echo "[$DISPLAY][$WAYLAND_DISPLAY]"');
    await s.close();
    expect(r.output).toBe('[][]');
    expect(s.gui?.display).toBe('missing');
    // No browsers and no display: there is nothing to look at an interface with.
    expect(offersViewImage(s)).toBe(false);
  });

  it('keeps the person\'s screen when no display was asked for, and only offers the browsers', async () => {
    const s = ask({ browsers: '/b/ms-playwright', display: null });
    const r = await s.exec('echo "$DISPLAY"');
    await s.close();
    expect(r.output).toBe(':0');
    expect(offersViewImage(s)).toBe(true);
  });

  it('reads a picture from its folder by its path or its name, and nothing outside it', async () => {
    const s = ask({ browsers: '/b', display: null });
    const out = s.gui?.out as string;
    writeFileSync(join(out, 'home.png'), PNG);
    writeFileSync(join(out, 'notes.txt'), 'not a picture');
    writeFileSync(join(root, 'secret.png'), PNG);
    symlinkSync(join(root, 'secret.png'), join(out, 'link.png'));
    const read = s.readImage!;
    expect(read(`${out}/home.png`)).toMatchObject({ ok: true, path: `${out}/home.png`, mediaType: 'image/png' });
    expect(read('home.png')).toMatchObject({ ok: true });
    expect(read(join(root, 'secret.png'))).toEqual({ ok: false, why: 'outside' });
    expect(read('/coxia/out/home.png')).toEqual({ ok: false, why: 'outside' });
    expect(read(`${out}/../secret.png`)).toEqual({ ok: false, why: 'outside' });
    expect(read('link.png')).toMatchObject({ ok: false });
    expect(read('notes.txt')).toEqual({ ok: false, why: 'not-image' });
    expect(read('gone.png')).toEqual({ ok: false, why: 'missing' });
    await s.close();
    expect(existsSync(out)).toBe(false);
  });

  it('shows the model the picture and says where to save one it cannot read, with the real folder', async () => {
    const s = ask({ browsers: '/b', display: null });
    const out = s.gui?.out as string;
    writeFileSync(join(out, 'home.png'), PNG);
    const tool = viewImageToolImpl(s);
    expect(tool.description).toContain(`saved in ${out}`);
    expect(tool.description).not.toContain('/coxia/out');
    const ctx = { outputMax: 10_000 } as Parameters<typeof tool.run>[1];
    const ok = await tool.run({ source: 'home.png' }, ctx);
    expect(ok.images?.[0]).toMatchObject({ path: `${out}/home.png`, mediaType: 'image/png' });
    const no = await tool.run({ source: '/etc/hostname' }, ctx);
    expect(String(no.response)).toContain(`Only images saved in ${out} can be viewed`);
    await s.close();
  });

  it('names the sandbox\'s folder in the description when it has no folder of its own', () => {
    expect(viewImageDescription(false)).toContain('/coxia/out inside the sandbox');
    expect(viewImageDescription(false, '/x/out')).toContain('saved in /x/out, such as');
  });
});

describe.runIf(posix)('the host session of the sandbox service', () => {
  const wt = () => {
    const dir = join(root, 'wt');
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const browsers = () => {
    const dir = join(home, 'browsers');
    mkdirSync(join(dir, 'chromium-1'), { recursive: true });
    return dir;
  };
  // A display program a test controls: the service looks for a file called Xvfb on the listed folders' bin and on the login PATH.
  const program = () => {
    const bin = join(home, 'tools', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'Xvfb'), '#!/bin/sh\n', { mode: 0o755 });
    return join(home, 'tools');
  };
  const service = (started: string[], stops: string[], hostPath = '/nonexistent') =>
    createSandboxService({
      dir: join(root, 'sandbox'),
      home,
      protect: [join(root, 'data')],
      hostEnv: async () => ({ PATH: hostPath, DISPLAY: ':0' }),
      startDisplay: async (p) => (started.push(p), { name: ':77', stop: async () => void stops.push(p) }),
    });

  it('starts nothing and offers nothing for a workspace that set neither', async () => {
    const started: string[] = [];
    const s = await service(started, []).openHost({ worktree: wt(), reader: false, config: neutralSandbox(), display: true });
    const r = await s.exec('echo "[$DISPLAY][$PLAYWRIGHT_BROWSERS_PATH]"');
    await s.close();
    expect(started).toEqual([]);
    expect(s.gui).toBeUndefined();
    expect(r.output).toBe('[:0][]');
  });

  it('offers the browsers folder to every host stage and the display only to one that asks, and only with the switch on', async () => {
    const started: string[] = [];
    const config = { ...neutralSandbox(), browsersPath: browsers(), display: true, readOnlyPaths: [program()] };
    const svc = service(started, []);
    const qa = await svc.openHost({ worktree: wt(), reader: false, config, display: true });
    const other = await svc.openHost({ worktree: wt(), reader: false, config });
    const off = await svc.openHost({ worktree: wt(), reader: false, config: { ...config, display: false }, display: true });
    try {
      expect(qa.gui).toMatchObject({ browsers: browsers(), display: 'on' });
      expect(qa.screen).toEqual({ socket: '/tmp/.X11-unix/X77', kind: 'host' });
      expect(other.screen).toBeUndefined();
      expect(off.screen).toBeUndefined();
      expect((await qa.exec('echo "$DISPLAY"')).output).toBe(':77');
      expect(other.gui).toMatchObject({ browsers: browsers(), display: null });
      expect(off.gui).toMatchObject({ display: null });
      expect(started).toHaveLength(1);
    } finally {
      await Promise.all([qa.close(), other.close(), off.close()]);
    }
  });

  it('looks for the display program on the person\'s login PATH too, and stops the display with the session', async () => {
    const started: string[] = [];
    const stops: string[] = [];
    const bin = join(program(), 'bin');
    const config = { ...neutralSandbox(), display: true };
    const s = await service(started, stops, `relative/bin:${bin}`).openHost({ worktree: wt(), reader: false, config, display: true });
    expect(started).toEqual([join(bin, 'Xvfb')]);
    await s.close();
    expect(stops).toEqual([join(bin, 'Xvfb')]);
  });

  it('says the display is missing when no program is found, and runs the commands with none', async () => {
    const config = { ...neutralSandbox(), display: true, readOnlyPaths: [] };
    const svc = service([], [], '/nonexistent');
    const s = await svc.openHost({ worktree: wt(), reader: false, config, display: true });
    const r = await s.exec('echo "[$DISPLAY]"');
    await s.close();
    // A machine with a display program on the system's path would have started one; the answer depends on the machine, never on the person's screen.
    expect(['missing', 'on']).toContain(s.gui?.display);
    if (s.gui?.display === 'missing') expect(r.output).toBe('[]');
  });

  it('says the display failed when the program was found and did not come up', async () => {
    const config = { ...neutralSandbox(), display: true, readOnlyPaths: [program()] };
    const svc = createSandboxService({ dir: join(root, 'sandbox'), home, protect: [], hostEnv: async () => ({ PATH: '/nonexistent' }), startDisplay: async () => null });
    const s = await svc.openHost({ worktree: wt(), reader: false, config, display: true });
    await s.close();
    expect(s.gui?.display).toBe('failed');
  });

  it('goes on without browsers, and says so, when the folder set is gone', async () => {
    const config = { ...neutralSandbox(), browsersPath: join(home, 'gone') };
    const s = await service([], []).openHost({ worktree: wt(), reader: false, config });
    await s.close();
    expect(s.gui).toMatchObject({ browsers: null, browsersGone: join(home, 'gone') });
  });

  it('keeps a reader in a throwaway copy, with its folder and display removed when it ends', async () => {
    const stops: string[] = [];
    const dir = wt();
    writeFileSync(join(dir, 'file.txt'), 'x');
    const config = { ...neutralSandbox(), browsersPath: browsers(), display: true, readOnlyPaths: [program()] };
    const s = await service([], stops).openHost({ worktree: dir, reader: true, config, display: true });
    const r = await s.exec('pwd; echo *');
    const out = s.gui?.out as string;
    await s.close();
    expect(r.output).not.toContain(`${dir}\n`);
    expect(r.output).toContain('file.txt');
    expect(stops).toHaveLength(1);
    expect(existsSync(out)).toBe(false);
  });
});

const shellOf = (c: WorkspaceConfig, id: string, shell: 'host' | 'sandbox') => {
  c.agents.team.find((a) => a.id === id)!.shell = shell;
};

function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', async (call) => {
    const evidenceIds = await keepQaEvidence(call);
    return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '', ...(evidenceIds.length ? { evidenceIds } : {}) }] });
  });
}

async function reach(b: Boot, run: Run, id: string): Promise<Run> {
  for (let i = 0; i < 20; i++) {
    await b.settle();
    run = b.runner.get(run.id)!;
    if (run.stage === id && run.status !== 'working') return run;
    if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    else break;
  }
  return run;
}

describe('a QA stage of an agent that runs on this computer', () => {
  it('asks for a display, and with neither setting its prompt says nothing about interfaces', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'qa', 'host'); c.language = 'en'; } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    const qa = sandbox.opened.find((o) => o.host);
    expect(qa?.options.display).toBe(true);
    expect(b.engine.calls.find((c) => c.agent.id === 'qa')!.system).not.toContain('127.0.0.1');
  });

  it('is told how to test an interface on the computer, with the folder to save in, and the thread and the prompt say the display is missing', async () => {
    const sandbox = fakeSandbox({ gui: { browsers: '/b/ms-playwright', display: 'missing', out: '/tmp/host-stage/out' } });
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'qa', 'host'); c.language = 'en'; } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.system).toContain('Your commands run on the person\'s computer');
    expect(qa.system).toContain('/tmp/host-stage/out');
    expect(qa.system).toContain('PLAYWRIGHT_BROWSERS_PATH is set to /b/ms-playwright');
    expect(qa.system).toContain('virtual display the person switched on is not available');
    // Not the sandbox's words: there is no sandbox to be the boundary, and the network is the computer's.
    expect(qa.system).not.toContain('the sandbox you are in is the boundary');
    expect(qa.system).not.toContain('Save screenshots and traces in /coxia/out');
    expect(b.thread(run).some((m) => m.code === 'runner.sandbox.noDisplay')).toBe(true);
  });

  it('is told, in Portuguese too, to give the app under test an empty data folder', async () => {
    const sandbox = fakeSandbox({ gui: { browsers: '/b/ms-playwright', display: 'on', out: '/tmp/host-stage/out' } });
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'qa', 'host'); c.language = 'pt-BR'; } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.system).toContain('CERIMONIAS_DATA_DIR');
    expect(qa.system).toContain('Há uma tela virtual');
  });

  it('keeps the sandbox\'s way for an agent set to the sandbox', async () => {
    const sandbox = fakeSandbox({ gui: { browsers: '/b/ms-playwright', display: 'on' } });
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'qa', 'sandbox'); c.language = 'en'; } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.system).toContain('the sandbox you are in is the boundary');
    expect(qa.system).not.toContain('Your commands run on the person\'s computer, so take care');
  });
});
