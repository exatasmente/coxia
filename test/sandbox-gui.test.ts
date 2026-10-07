// Testing an interface from inside the sandbox (#68): the browsers folder the person names is bound read-only with PLAYWRIGHT_BROWSERS_PATH, a QA stage may get a
// virtual display started by the supervisor inside the sandbox, the agent looks at a screenshot only through ViewImage, which reads the stage's output folder alone,
// and what is missing is said in Settings, in the thread and in the prompt. Nothing changes for a workspace that sets neither. No test needs a real browser.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { validateConfig } from '../src/shared/config/validate';
import { neutralConfig } from '../src/shared/config';
import type { Run } from '../src/shared/runs';
import { createSandboxService, displayProgram } from '../src/main/sandbox';
import { viewImageToolImpl } from '../src/main/sandbox/engineTool';
import { DISPLAY, SUPERVISOR_SH, bwrapArgs, sandboxEnv, type SandboxSpec } from '../src/main/sandbox/policy';
import { readOutputImage } from '../src/main/sandbox/session';
import { offersViewImage } from '../src/main/sandbox/tool';
import { probeSandbox } from '../src/main/sandbox/probe';
import { redact } from '../src/main/errorlog-core';
import { type Boot, boot, doc, fakeSandbox, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

// A 16×16 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO4I2JDEmIY1TCqYfhqAAAeBCwQ81sZJgAAAABJRU5ErkJggg==', 'base64');

let root: string;
// The guards of a read-only folder refuse anything under /tmp (a place of the system): a folder the person would name lives elsewhere, here in the repository's own
// tree, removed after each test.
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-gui-'));
  home = mkdtempSync(join(process.cwd(), '.gui-home-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const spec = (over: Partial<SandboxSpec> = {}): SandboxSpec => ({ worktree: '/w', tree: null, stageDir: '/s', system: { roDirs: ['/usr'], links: [] }, roBinds: [], pathDirs: [], network: 'off', limits: neutralSandbox().limits, tmpMb: 512, ...over });

describe('the environment and the supervisor', () => {
  it('leave a sandbox with neither setting as it was: no browser variable, no display', () => {
    const env = sandboxEnv(spec());
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBeUndefined();
    expect(env.DISPLAY).toBeUndefined();
    expect(env.COXIA_XVFB).toBeUndefined();
  });

  it('point Playwright at the browsers folder and give the supervisor the display program to start', () => {
    const env = sandboxEnv(spec({ gui: { browsers: '/b/ms-playwright', xvfb: '/usr/bin/Xvfb' } }));
    expect(env).toMatchObject({ PLAYWRIGHT_BROWSERS_PATH: '/b/ms-playwright', COXIA_XVFB: '/usr/bin/Xvfb', DISPLAY });
    const args = bwrapArgs(spec({ gui: { browsers: '/b/ms-playwright', xvfb: null } }));
    expect(args.join(' ')).toContain('--setenv PLAYWRIGHT_BROWSERS_PATH /b/ms-playwright');
    expect(args).not.toContain('DISPLAY');
  });

  it('start the display inside, under the per-process limits and with no TCP listener, and go on without it when it does not come up', () => {
    expect(SUPERVISOR_SH).toContain('"$COXIA_XVFB" :99 -screen 0 1280x800x24 -nolisten tcp');
    expect(SUPERVISOR_SH).toMatch(/prlimit --data="\$COXIA_DATA" --nproc="\$COXIA_PROCS" --fsize="\$COXIA_FSIZE" --core=0 -- "\$COXIA_XVFB"/);
    expect(SUPERVISOR_SH).toContain('unset DISPLAY; echo ready-nodisplay');
  });
});

describe('the display program', () => {
  it('is looked for on the sandbox\'s own PATH: a listed folder first, then the system', () => {
    const seen = new Set(['/opt/x/bin/Xvfb', '/usr/bin/Xvfb']);
    expect(displayProgram(['/opt/x/bin', '/opt/x'], (p) => seen.has(p))).toBe('/opt/x/bin/Xvfb');
    expect(displayProgram([], (p) => seen.has(p))).toBe('/usr/bin/Xvfb');
    expect(displayProgram([], () => false)).toBeNull();
  });
});

describe('an image the stage saved', () => {
  const out = () => {
    const d = join(root, 'out');
    mkdirSync(d, { recursive: true });
    return d;
  };

  it('is read from the output folder, by its path inside or its name', () => {
    const d = out();
    writeFileSync(join(d, 'home.png'), PNG);
    for (const path of ['/coxia/out/home.png', 'home.png']) expect(readOutputImage(d, path)).toMatchObject({ ok: true, path: '/coxia/out/home.png', mediaType: 'image/png' });
  });

  it('is refused anywhere else, through a link, as a pipe or a folder, when too big, or when it is not a picture', () => {
    const d = out();
    writeFileSync(join(root, 'secret.png'), PNG);
    symlinkSync(join(root, 'secret.png'), join(d, 'link.png'));
    execFileSync('mkfifo', [join(d, 'pipe.png')]);
    mkdirSync(join(d, 'dir.png'));
    writeFileSync(join(d, 'text.png'), 'not a picture');
    execFileSync('truncate', ['-s', String(5 * 1024 * 1024), join(d, 'big.png')]);
    expect(readOutputImage(d, '/etc/passwd')).toEqual({ ok: false, why: 'outside' });
    expect(readOutputImage(d, '/coxia/out/../secret.png')).toEqual({ ok: false, why: 'outside' });
    expect(readOutputImage(d, 'link.png')).toEqual({ ok: false, why: 'missing' });
    expect(readOutputImage(d, 'pipe.png')).toEqual({ ok: false, why: 'not-file' });
    expect(readOutputImage(d, 'dir.png')).toEqual({ ok: false, why: 'not-file' });
    expect(readOutputImage(d, 'big.png')).toEqual({ ok: false, why: 'too-big' });
    expect(readOutputImage(d, 'text.png')).toEqual({ ok: false, why: 'not-image' });
  });
});

describe('the ViewImage tool', () => {
  const session = (gui: { browsers: string | null; display: 'on' | 'missing' | 'failed' | null } | undefined) => ({
    exec: async () => ({ n: 1, command: '', exitCode: 0, timedOut: false, output: '', ms: 0 }),
    log: [],
    close: async () => undefined,
    ...(gui ? { gui } : {}),
    readImage: (path: string) => (path === 'home.png' ? { ok: true as const, path: '/coxia/out/home.png', mediaType: 'image/png', data: PNG.toString('base64') } : { ok: false as const, why: 'outside' as const }),
  });

  it('is offered only to a sandbox with browsers or a display', () => {
    expect(offersViewImage(session(undefined))).toBe(false);
    expect(offersViewImage(session({ browsers: null, display: 'missing' }))).toBe(false);
    expect(offersViewImage(session({ browsers: '/b', display: null }))).toBe(true);
    expect(offersViewImage(session({ browsers: null, display: 'on' }))).toBe(true);
  });

  it('gives the open engine the picture to show the model, and says where to save one it cannot read', async () => {
    const tool = viewImageToolImpl(session({ browsers: '/b', display: null }));
    const ctx = { cwd: root, roots: [root], isSecret: () => false, secretGlobs: [], outputMax: 1000, env: {}, bashPrefixes: [], ripgrep: 'off' as const, seesImages: () => true };
    const shown = await tool.run({ source: 'home.png' }, ctx);
    expect(shown.images?.[0]).toMatchObject({ path: '/coxia/out/home.png', mediaType: 'image/png' });
    const refused = await tool.run({ source: '/etc/passwd' }, ctx);
    expect(refused.images).toBeUndefined();
    expect(refused.render(refused.response)).toContain('/coxia/out');
  });

  it('still takes the `path` of its first contract when `source` is absent', async () => {
    const tool = viewImageToolImpl(session({ browsers: '/b', display: null }));
    const ctx = { cwd: root, roots: [root], isSecret: () => false, secretGlobs: [], outputMax: 1000, env: {}, bashPrefixes: [], ripgrep: 'off' as const, seesImages: () => true };
    const shown = await tool.run({ path: 'home.png' }, ctx);
    expect(shown.images?.[0]).toMatchObject({ path: '/coxia/out/home.png', mediaType: 'image/png' });
  });

  it('tells a model that takes no images that the file is one, and sends nothing', async () => {
    const tool = viewImageToolImpl(session({ browsers: '/b', display: null }));
    const ctx = { cwd: root, roots: [root], isSecret: () => false, secretGlobs: [], outputMax: 1000, env: {}, bashPrefixes: [], ripgrep: 'off' as const, seesImages: () => false };
    const told = await tool.run({ source: 'home.png' }, ctx);
    expect(told.images).toBeUndefined();
    expect(String(told.response)).toContain('is an image');
  });

  it('asks for `source` and does not mention evidence to a stage that keeps none', () => {
    const tool = viewImageToolImpl(session({ browsers: '/b', display: null }));
    expect(tool.parameters).toMatchObject({ required: ['source'] });
    expect(tool.description).not.toMatch(/evidence|ev-/i);
    expect(JSON.stringify(tool.parameters)).not.toMatch(/evidence|ev-/i);
  });
});

describe('the settings', () => {
  it('are absent in a neutral config: no browsers folder, no display', () => {
    expect(neutralConfig().runner.sandbox).toMatchObject({ browsersPath: null, display: false });
  });

  it('refuse a browsers folder the read-only folders would refuse', () => {
    const c = neutralConfig();
    c.runner.sandbox.browsersPath = '~/.ssh';
    expect(validateConfig(c).errors.map((e) => e.path)).toContain('runner.sandbox.browsersPath');
    c.runner.sandbox.browsersPath = '~/.cache/ms-playwright';
    expect(validateConfig(c).errors.map((e) => e.path)).not.toContain('runner.sandbox.browsersPath');
  });
});

describe('the status of a sandbox for testing an interface', () => {
  it('says whether the browsers folder is ready, missing, refused or empty, and whether a display can be made, from the saved settings', () => {
    const browsers = join(home, '.cache', 'ms-playwright');
    mkdirSync(browsers, { recursive: true });
    const service = createSandboxService({ dir: join(root, 'sandbox'), home, protect: [join(root, 'data')] });
    const config = (over: Partial<ReturnType<typeof neutralSandbox>>) => ({ ...neutralSandbox(), ...over });
    expect(service.guiStatus(config({}))).toEqual({ browsers: 'unset', display: 'off' });
    expect(service.guiStatus(config({ browsersPath: '~/.cache/ms-playwright' })).browsers).toBe('empty');
    mkdirSync(join(browsers, 'chromium-1234'));
    expect(service.guiStatus(config({ browsersPath: '~/.cache/ms-playwright' })).browsers).toBe('ready');
    expect(service.guiStatus(config({ browsersPath: '~/gone' })).browsers).toBe('missing');
    expect(service.guiStatus(config({ browsersPath: '~/' + '.ssh' })).browsers).toMatch(/missing|refused/);
    expect(['ready', 'missing']).toContain(service.guiStatus(config({ display: true })).display);
  });
});

const shellOf = (c: WorkspaceConfig, id: string, shell: 'none' | 'allowlist' | 'sandbox') => {
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
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }] }));
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

describe('a QA stage', () => {
  it('asks for a display, and with neither setting its prompt says nothing about interfaces', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'qa', 'sandbox'); c.language = 'en'; } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(sandbox.opened.map((o) => o.options.display)).toEqual([true]);
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.system).not.toContain('127.0.0.1');
  });

  it('is told how to test an interface, and the thread and the prompt say the display is missing, and the stage goes on', async () => {
    const sandbox = fakeSandbox({ gui: { browsers: '/b/ms-playwright', display: 'missing' } });
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'qa', 'sandbox'); c.language = 'en'; } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.system).toContain('127.0.0.1');
    expect(qa.system).toContain('PLAYWRIGHT_BROWSERS_PATH is set to /b/ms-playwright');
    expect(qa.system).toContain('virtual display the person switched on is not available');
    expect(b.thread(run).some((m) => m.code === 'runner.sandbox.noDisplay')).toBe(true);
  });
});

const status = await probeSandbox();
const maybe = status.available ? describe : describe.skip;

maybe('a real sandbox with a browsers folder', () => {
  it('sees the folder read-only at its own path, with the variable pointing at it', async () => {
    const browsers = join(home, 'browsers');
    mkdirSync(join(browsers, 'chromium-1'), { recursive: true });
    const wt = join(root, 'wt');
    mkdirSync(wt);
    const service = createSandboxService({ dir: join(root, 'sandbox'), home, protect: [join(root, 'data')] });
    const s = await service.open({ worktree: wt, reader: false, config: { ...neutralSandbox(), browsersPath: browsers } });
    try {
      const r = await s.exec(`echo "$PLAYWRIGHT_BROWSERS_PATH"; ls "$PLAYWRIGHT_BROWSERS_PATH"; touch "$PLAYWRIGHT_BROWSERS_PATH/x" 2>/dev/null; echo "write=$?"; echo "display=$DISPLAY"`);
      // The output is masked like any command's: the home folder shows as ~. The suite reads HOME as "~", so the expectation is the same masking applied to this folder with
      // the same home the sandbox has, which is what comes back.
      expect(r.output).toContain(redact(browsers, homedir()));
      expect(r.output).toContain('chromium-1');
      expect(r.output).toMatch(/write=[1-9]/);
      expect(r.output).toMatch(/display=\s*$/);
      expect(s.gui).toEqual({ browsers, display: null });
    } finally {
      await s.close();
    }
  });
});

const xvfb = displayProgram([]);
const maybeDisplay = status.available && xvfb ? describe : describe.skip;

maybeDisplay('a real sandbox with a virtual display', () => {
  it('starts the display inside for a stage that asks, its socket in the sandbox\'s own /tmp, and none for one that does not', async () => {
    const wt = join(root, 'wt-display');
    mkdirSync(wt);
    const service = createSandboxService({ dir: join(root, 'sandbox'), home, protect: [join(root, 'data')] });
    const config = { ...neutralSandbox(), display: true };
    const asked = await service.open({ worktree: wt, reader: false, config, display: true });
    try {
      expect(asked.gui?.display).toBe('on');
      const r = await asked.exec('echo "display=$DISPLAY"; ls /tmp/.X11-unix');
      expect(r.output).toContain(`display=${DISPLAY}`);
      expect(r.output).toContain('X99');
    } finally {
      await asked.close();
    }
    // A sandbox that did not ask (a mention call, a stage of another kind) starts nothing, even with the switch on.
    const other = await service.open({ worktree: wt, reader: false, config });
    try {
      expect(other.gui).toBeUndefined();
      expect((await other.exec('echo "display=$DISPLAY"')).output).toMatch(/display=\s*$/);
    } finally {
      await other.close();
    }
  });
});
