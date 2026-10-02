// The voice setup flow (check, install, cancel and resume, uninstall) against a fake uv and a fake python on PATH: no network, no real packages.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STT_MODEL_BYTES, VOICE_DISK_MARGIN_BYTES, VOICE_PACKAGES_BYTES, type VoiceProgress, wordMatch } from '../src/shared/voiceSetup';
import { type InstallHooks, type SetupContext, activeVenv, checkVoice, installVoice, modelHome, neededBytes, uninstallVoice } from '../src/main/voice-setup';

const script = (path: string, body: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};

const FAKE_PYTHON = `
echo "python $*" >> "$FAKE_LOG"
case "$1" in
  -c) [ -n "$FAKE_VERIFY_FAIL" ] && { echo "ModuleNotFoundError: kokoro_onnx" >&2; exit 1; }; exit 0 ;;
  *voice_fetch.py)
    echo "{\\"phase\\": \\"start\\", \\"total\\": 1000}"
    echo "{\\"phase\\": \\"progress\\", \\"done\\": 400, \\"total\\": 1000}"
    d="$HF_HOME/hub/models--Systran--faster-whisper-$2/snapshots/rev1"
    mkdir -p "$d" && touch "$d/model.bin"
    echo "{\\"phase\\": \\"progress\\", \\"done\\": 1000, \\"total\\": 1000}"
    echo "{\\"phase\\": \\"done\\", \\"path\\": \\"$d\\"}"
    echo "hf_home=$HF_HOME" >&2 ;;
esac
`;

const FAKE_UV = `
echo "uv $*" >> "$FAKE_LOG"
case "$1 $2" in
  "venv --python") mkdir -p "$4/bin"; cp "$FAKE_PY" "$4/bin/python"; chmod +x "$4/bin/python" ;;
  "pip install")
    [ -n "$FAKE_UV_HANG" ] && { echo $$ > "$FAKE_PID"; exec sleep 30; }
    [ -n "$FAKE_UV_FAIL" ] && { echo "error: no matching distribution found for faster-whisper" >&2; exit 1; }
    echo "Installed 5 packages" ;;
esac
`;

// python3 is the system interpreter: it answers --version, and "-m venv" makes a folder whose pip "installs" the fake uv.
const FAKE_PYTHON3 = `
if [ "$1" = "--version" ]; then echo "Python \${FAKE_PYTHON3_VERSION:-3.12.3}"; exit 0; fi
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  mkdir -p "$3/bin"
  printf '#!/bin/sh\\necho "pip $*" >> "$FAKE_LOG"\\ncp "$FAKE_UV" "$(dirname "$0")/uv"\\n' > "$3/bin/pip"
  chmod +x "$3/bin/pip"
  echo "python3 -m venv $3" >> "$FAKE_LOG"
fi
`;

function fixture(opts: { uvOnPath?: boolean; python3?: boolean; env?: Record<string, string> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'coxia-voice-setup-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const fakeUv = join(root, 'fake', 'uv');
  const fakePy = join(root, 'fake', 'python');
  script(fakeUv, FAKE_UV);
  script(fakePy, FAKE_PYTHON);
  if (opts.uvOnPath !== false) script(join(bin, 'uv'), FAKE_UV);
  if (opts.python3 !== false) script(join(bin, 'python3'), FAKE_PYTHON3);
  // PATH holds only the fakes and the few tools they use, so a machine "without python3" really has none.
  for (const tool of ['mkdir', 'cp', 'chmod', 'touch', 'dirname', 'sleep']) symlinkSync(`/usr/bin/${tool}`, join(bin, tool));
  const log = join(root, 'calls.log');
  writeFileSync(log, '');
  const ctx: SetupContext = {
    env: { PATH: bin, FAKE_LOG: log, FAKE_PY: fakePy, FAKE_UV: fakeUv, FAKE_PID: join(root, 'pid'), ...(opts.env ?? {}) },
    paths: {
      venv: join(root, 'data/voice-venv'),
      models: join(root, 'data/voice-models'),
      tools: join(root, 'data/voice-tools'),
      requirements: join(root, 'requirements.txt'),
      fetchScript: join(root, 'voice_fetch.py'),
      legacyVenv: null,
      kokoroDirs: [join(root, 'kokoro')],
      home: join(root, 'home'),
    },
  };
  writeFileSync(ctx.paths.requirements, 'faster-whisper==1.2.1\n');
  return { root, ctx, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

function hooks(signal = new AbortController().signal) {
  const progress: VoiceProgress[] = [];
  const errors: { phase: string; message: string }[] = [];
  const h: InstallHooks = { signal, onProgress: (p) => progress.push(p), onError: (phase, e) => errors.push({ phase, message: e.message }) };
  return { h, progress, errors };
}

const OPTS = { sttModel: 'tiny', engine: 'edge', acknowledgeEdge: true } as const;

describe('checkVoice', () => {
  it('reports python, uv, the disk, what is installed and the engines', async () => {
    const { ctx } = fixture();
    const check = await checkVoice(ctx, 'tiny');
    expect(check.python).toEqual({ found: true, version: '3.12.3', ok: true });
    expect(check.uv.found).toBe(true);
    expect(check.installed).toMatchObject({ venv: false, kind: null, models: { tiny: false, base: false, small: false } });
    expect(check.disk.neededBytes).toBe(neededBytes('tiny', false, false));
    expect(check.disk.freeBytes).toBeGreaterThan(0);
    expect(check.canInstall).toBe(true);
    expect(check.microphone).toBe('renderer');
    expect(check.engines.find((e) => e.id === 'edge')).toMatchObject({ local: false, sendsTextTo: 'Microsoft', available: true });
    expect(check.engines.find((e) => e.id === 'kokoro')).toMatchObject({ local: true, sendsTextTo: null, available: false, modelDir: null });
  });

  it('offers Kokoro once its model files are present', async () => {
    const { ctx, root } = fixture();
    mkdirSync(join(root, 'kokoro'), { recursive: true });
    writeFileSync(join(root, 'kokoro/kokoro-v1.0.onnx'), 'x');
    expect((await checkVoice(ctx)).engines.find((e) => e.id === 'kokoro')?.available).toBe(false);
    writeFileSync(join(root, 'kokoro/voices-v1.0.bin'), 'x');
    expect((await checkVoice(ctx)).engines.find((e) => e.id === 'kokoro')).toMatchObject({ available: true, modelDir: join(root, 'kokoro') });
  });

  it('says uv can be installed by the app when only python3 is there, and cannot install with neither', async () => {
    const onlyPython = fixture({ uvOnPath: false });
    expect((await checkVoice(onlyPython.ctx)).uv).toMatchObject({ found: false, installable: true });
    const nothing = fixture({ uvOnPath: false, python3: false });
    const check = await checkVoice(nothing.ctx);
    expect(check.python.found).toBe(false);
    expect(check.problems).toContain('no-python');
    expect(check.canInstall).toBe(false);
    const old = fixture({ uvOnPath: false, env: { FAKE_PYTHON3_VERSION: '3.7.9' } });
    expect((await checkVoice(old.ctx)).problems).toContain('python-version');
  });

  it('a uv on PATH makes an old or missing python irrelevant: uv fetches its own', async () => {
    const f = fixture({ python3: false });
    const check = await checkVoice(f.ctx);
    expect(check.problems).toEqual([]);
    expect(check.canInstall).toBe(true);
  });

  it('counts the install and the model in the space it asks for', () => {
    expect(neededBytes('small', false, false)).toBe(VOICE_PACKAGES_BYTES + STT_MODEL_BYTES.small + VOICE_DISK_MARGIN_BYTES);
    expect(neededBytes('small', true, true)).toBe(VOICE_DISK_MARGIN_BYTES);
  });
});

describe('installVoice', () => {
  it('creates the environment with uv, installs the requirements, downloads the model into the app folder and verifies', async () => {
    const f = fixture();
    const { h, progress, errors } = hooks();
    const result = await installVoice(f.ctx, OPTS, h);
    expect(result).toMatchObject({ ok: true, sttModel: 'tiny', engine: 'edge' });
    expect(errors).toEqual([]);
    const calls = f.calls();
    expect(calls[0]).toBe(`uv venv --python 3.12 ${f.ctx.paths.venv}`);
    expect(calls[1]).toBe(`uv pip install --python ${f.ctx.paths.venv}/bin/python -r ${f.ctx.paths.requirements}`);
    expect(calls[2]).toBe(`python ${f.ctx.paths.fetchScript} tiny`);
    expect(calls[3]).toBe('python -c import faster_whisper, edge_tts, av, soundfile, kokoro_onnx');
    expect(existsSync(join(f.ctx.paths.venv, '.cerimonias-ready'))).toBe(true);
    expect(activeVenv(f.ctx.paths)).toMatchObject({ kind: 'data' });
    expect(modelHome(f.ctx, 'tiny')).toBe(f.ctx.paths.models);
    expect(modelHome(f.ctx, 'small')).toBeNull();
    const phases = progress.map((p) => p.phase);
    expect(phases.indexOf('uv')).toBeLessThan(phases.indexOf('venv'));
    expect(phases.indexOf('venv')).toBeLessThan(phases.indexOf('packages'));
    expect(phases.indexOf('packages')).toBeLessThan(phases.indexOf('model'));
    expect(phases.indexOf('model')).toBeLessThan(phases.indexOf('verify'));
    expect(phases[phases.length - 1]).toBe('done');
    expect(progress[progress.length - 1].percent).toBe(100);
    // the model download reports bytes, and the overall percentage only goes up
    expect(progress.find((p) => p.bytes && p.bytes.done === 400)).toMatchObject({ phase: 'model', bytes: { done: 400, total: 1000 } });
    const percents = progress.map((p) => p.percent).filter((n): n is number => n !== null);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  });

  it('points the model download at the app folder (HF_HOME), never at the user cache', async () => {
    const f = fixture();
    const seen: string[] = [];
    const { h } = hooks();
    await installVoice(f.ctx, OPTS, { ...h, onProgress: (p) => p.detail && seen.push(p.detail) });
    expect(seen).toContain(`hf_home=${f.ctx.paths.models}`);
  });

  it('refuses Edge until the person acknowledged that the text goes to Microsoft, and runs nothing', async () => {
    const f = fixture();
    const { h } = hooks();
    const result = await installVoice(f.ctx, { sttModel: 'tiny', engine: 'edge' }, h);
    expect(result).toMatchObject({ ok: false, code: 'edge-not-acknowledged' });
    expect(f.calls()).toEqual([]);
  });

  it('refuses Kokoro while its model files are missing, accepts it when they are there, and needs no acknowledgement', async () => {
    const f = fixture();
    const { h } = hooks();
    expect(await installVoice(f.ctx, { sttModel: 'tiny', engine: 'kokoro' }, h)).toMatchObject({ ok: false, code: 'kokoro-missing' });
    mkdirSync(join(f.root, 'kokoro'), { recursive: true });
    writeFileSync(join(f.root, 'kokoro/kokoro-v1.0.onnx'), 'x');
    writeFileSync(join(f.root, 'kokoro/voices-v1.0.bin'), 'x');
    expect(await installVoice(f.ctx, { sttModel: 'tiny', engine: 'kokoro' }, hooks().h)).toMatchObject({ ok: true, engine: 'kokoro' });
  });

  it('rejects an unknown speech model', async () => {
    const f = fixture();
    expect(await installVoice(f.ctx, { sttModel: 'huge' as never, engine: 'edge', acknowledgeEdge: true }, hooks().h)).toMatchObject({ ok: false, code: 'failed' });
    expect(f.calls()).toEqual([]);
  });

  it('does not reinstall an environment that is already there (a migrated install): no uv, no packages, only what is missing', async () => {
    const f = fixture();
    mkdirSync(join(f.ctx.paths.venv, 'bin'), { recursive: true });
    writeFileSync(join(f.ctx.paths.venv, 'bin/python'), readFileSync(f.ctx.env.FAKE_PY as string));
    chmodSync(join(f.ctx.paths.venv, 'bin/python'), 0o755);
    writeFileSync(join(f.ctx.paths.venv, '.cerimonias-ready'), '2026-01-01T00:00:00.000Z');
    const result = await installVoice(f.ctx, OPTS, hooks().h);
    expect(result.ok).toBe(true);
    expect(f.calls().filter((c) => c.startsWith('uv '))).toEqual([]);
    expect(f.calls().map((c) => c.split(' ')[0])).toEqual(['python', 'python']);
  });

  it('skips the model download when the model is already on the machine', async () => {
    const f = fixture();
    await installVoice(f.ctx, OPTS, hooks().h);
    const before = f.calls().length;
    const again = await installVoice(f.ctx, OPTS, hooks().h);
    expect(again.ok).toBe(true);
    // only the final import check ran again
    expect(f.calls().slice(before)).toEqual(['python -c import faster_whisper, edge_tts, av, soundfile, kokoro_onnx']);
  });

  it('reports a failed install to the error log with the phase, keeps what exists and leaves no ready marker', async () => {
    const f = fixture({ env: { FAKE_UV_FAIL: '1' } });
    const { h, errors, progress } = hooks();
    const result = await installVoice(f.ctx, OPTS, h);
    expect(result).toMatchObject({ ok: false, cancelled: false, phase: 'packages', code: 'failed' });
    expect((result as { message: string }).message).toMatch(/no matching distribution/);
    expect(errors).toHaveLength(1);
    expect(errors[0].phase).toBe('packages');
    expect(progress[progress.length - 1].phase).toBe('failed');
    expect(existsSync(join(f.ctx.paths.venv, '.cerimonias-ready'))).toBe(false);
    expect(activeVenv(f.ctx.paths)).toBeNull();
    // the interpreter is kept, so the next try resumes at the packages
    expect(existsSync(join(f.ctx.paths.venv, 'bin/python'))).toBe(true);
  });

  it('resumes after a failure: the existing interpreter is not recreated, the packages step runs again', async () => {
    const f = fixture({ env: { FAKE_UV_FAIL: '1' } });
    await installVoice(f.ctx, OPTS, hooks().h);
    const venvCalls = f.calls().filter((c) => c.startsWith('uv venv')).length;
    delete f.ctx.env.FAKE_UV_FAIL;
    const result = await installVoice(f.ctx, OPTS, hooks().h);
    expect(result.ok).toBe(true);
    expect(f.calls().filter((c) => c.startsWith('uv venv'))).toHaveLength(venvCalls);
    expect(f.calls().filter((c) => c.startsWith('uv pip install'))).toHaveLength(2);
  });

  it('reports a failed import check as a failure of the verify phase', async () => {
    const f = fixture({ env: { FAKE_VERIFY_FAIL: '1' } });
    const { h, errors } = hooks();
    const result = await installVoice(f.ctx, OPTS, h);
    expect(result).toMatchObject({ ok: false, phase: 'verify' });
    expect(errors[0].message).toMatch(/kokoro_onnx/);
  });

  it('can be cancelled in the middle of the packages step: the tool is killed and the run can be resumed', async () => {
    const f = fixture({ env: { FAKE_UV_HANG: '1' } });
    const control = new AbortController();
    const { h, progress } = hooks(control.signal);
    const running = installVoice(f.ctx, OPTS, h);
    const pidFile = join(f.root, 'pid');
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 30));
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    control.abort();
    expect(await running).toEqual({ ok: false, cancelled: true });
    expect(progress[progress.length - 1].phase).toBe('cancelled');
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(existsSync(join(f.ctx.paths.venv, '.cerimonias-ready'))).toBe(false);
    // resume
    delete f.ctx.env.FAKE_UV_HANG;
    expect((await installVoice(f.ctx, OPTS, hooks().h)).ok).toBe(true);
  });

  it('fetches uv with python3 into the app folder when the machine has none', async () => {
    const f = fixture({ uvOnPath: false });
    const result = await installVoice(f.ctx, OPTS, hooks().h);
    expect(result.ok).toBe(true);
    const calls = f.calls();
    expect(calls[0]).toBe(`python3 -m venv ${f.ctx.paths.tools}`);
    expect(calls[1]).toMatch(/^pip install .*uv$/);
    expect(existsSync(join(f.ctx.paths.tools, 'bin/uv'))).toBe(true);
    expect(calls[2]).toMatch(/^uv venv --python 3\.12 /);
  });

  it('fails with "no-uv" when there is neither uv nor a usable python3', async () => {
    const f = fixture({ uvOnPath: false, python3: false });
    const { h, errors } = hooks();
    expect(await installVoice(f.ctx, OPTS, h)).toMatchObject({ ok: false, phase: 'uv', code: 'no-uv' });
    expect(errors).toHaveLength(1);
  });
});

describe('uninstallVoice', () => {
  it('removes the environment, the models and the tools the app made, reports the space, and leaves the rest', async () => {
    const f = fixture({ uvOnPath: false });
    await installVoice(f.ctx, OPTS, hooks().h);
    const legacy = join(f.root, 'checkout/.venv');
    mkdirSync(join(legacy, 'bin'), { recursive: true });
    writeFileSync(join(legacy, 'bin/python'), '#!/bin/sh\n');
    f.ctx.paths.legacyVenv = legacy;
    const result = uninstallVoice(f.ctx);
    expect(result.freedBytes).toBeGreaterThan(0);
    for (const dir of [f.ctx.paths.venv, f.ctx.paths.models, f.ctx.paths.tools]) expect(existsSync(dir)).toBe(false);
    expect(result.left).toContain('legacy-venv');
    expect(existsSync(join(legacy, 'bin/python'))).toBe(true);
    expect(activeVenv(f.ctx.paths)).toMatchObject({ kind: 'legacy' });
  });

  it('is a no-op on a machine with nothing installed', () => {
    const f = fixture();
    expect(uninstallVoice(f.ctx)).toEqual({ freedBytes: 0, left: [] });
  });
});

describe('wordMatch', () => {
  it('ignores case, accents and punctuation', () => {
    expect(wordMatch('Olá, este é um teste da voz do Coxia.', 'ola este e um teste da voz do coxia')).toBe(1);
    expect(wordMatch('Olá, este é um teste da voz do Coxia.', 'ola este um teste')).toBeCloseTo(4 / 9);
    expect(wordMatch('Olá', '')).toBe(0);
  });
});
