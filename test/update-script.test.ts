import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// scripts/update.sh runs against a throwaway repository, prefix and state: its own copy of the scripts, a fake
// "AppImage" that behaves like the app (single instance, --quit-for-update, run.json) and nothing real.
const SCRIPTS = join(import.meta.dirname, '../scripts');
const ICON = join(import.meta.dirname, '../resources/icon.png');
const roots: string[] = [];
const pids = new Set<number>();

const FAKE_APP = (quits: boolean) => `#!/usr/bin/env bash
RUN="$CERIMONIAS_DATA_DIR/run.json"
if [ "$1" = "--quit-for-update" ]; then
  ${quits ? 'kill "$(cat "$CERIMONIAS_DATA_DIR/fake.pid")"' : ': this build does not know the flag'}
  exit 0
fi
export APPIMAGE="$0"
echo $$ > "$CERIMONIAS_DATA_DIR/fake.pid"
printf '{\\n "pid": %s,\\n "version": "9.9.9",\\n "commit": "abc1234",\\n "builtAt": "2026-01-01T00:00:00.000Z"\\n}\\n' $$ > "$RUN"
exec sleep 300
`;

interface World {
  root: string;
  env: NodeJS.ProcessEnv;
  app: string;
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), 'cerimonias-update-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'resources'));
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, 'dist'));
  for (const f of ['update.sh', 'install-local.sh']) copyFileSync(join(SCRIPTS, f), join(repo, 'scripts', f));
  copyFileSync(ICON, join(repo, 'resources/icon.png'));
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\n');
  const gitIn = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' });
  gitIn('init', '-q', '-b', 'main');
  gitIn('add', '-A');
  gitIn('commit', '-q', '-m', 'init');
  mkdirSync(join(root, 'data'));
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    CERIMONIAS_PREFIX: join(root, 'prefix'),
    CERIMONIAS_DATA_DIR: join(root, 'data'),
    XDG_DATA_HOME: join(root, 'xdg-data'),
    XDG_CONFIG_HOME: join(root, 'xdg-config'),
    XDG_STATE_HOME: join(root, 'xdg-state'),
  };
  return { root, env, app: join(root, 'prefix/cerimonias.AppImage') };
}

const update = (w: World, ...args: string[]) =>
  spawnSync('bash', [join(w.root, 'repo/scripts/update.sh'), ...args], { env: w.env, encoding: 'utf8', timeout: 60_000 });

function install(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

// The running "old app": started the way the real one is, then found by the script through its environment.
async function startOld(w: World): Promise<number> {
  const child = spawn(w.app, [], { env: w.env, detached: true, stdio: 'ignore' });
  child.unref();
  const file = join(w.root, 'data/fake.pid');
  for (let i = 0; i < 50 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 100));
  const pid = Number(readFileSync(file, 'utf8'));
  pids.add(pid);
  return pid;
}

// A killed child of this test process stays a zombie until reaped: that is gone as far as the app is concerned.
const alive = (pid: number): boolean => {
  try {
    return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
};

afterAll(() => {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  for (const root of roots) {
    const run = join(root, 'data/run.json');
    if (existsSync(run)) {
      try {
        process.kill((JSON.parse(readFileSync(run, 'utf8')) as { pid: number }).pid, 'SIGKILL');
      } catch {}
    }
  }
});

describe('update.sh flags', () => {
  it('refuses an unknown option and a bad timeout', () => {
    const w = world();
    const bad = update(w, '--bogus');
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('opção desconhecida');
    expect(update(w, '--timeout', 'soon').status).toBe(2);
  });

  it('prints its usage', () => {
    const out = update(world(), '--help');
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('--force-dirty');
  });
});

describe('update.sh preconditions', () => {
  it('refuses uncommitted changes in src/ and lists them, without building or installing', () => {
    const w = world();
    writeFileSync(join(w.root, 'repo/src/a.ts'), 'export const a = 2;\n');
    writeFileSync(join(w.root, 'repo/src/new.ts'), 'export const b = 1;\n');
    const out = update(w);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('M src/a.ts');
    expect(out.stdout).toContain('?? src/new.ts');
    expect(out.stdout).toContain('--force-dirty');
    expect(existsSync(join(w.root, 'xdg-state/cerimonias/build.log'))).toBe(false);
    expect(existsSync(w.app)).toBe(false);
  });

  it('--check only looks: refuses a dirty src/, passes a clean one, and never writes the update log', () => {
    const w = world();
    const clean = update(w, '--check');
    expect(clean.status, clean.stdout + clean.stderr).toBe(0);
    writeFileSync(join(w.root, 'repo/src/a.ts'), 'export const a = 2;\n');
    const dirty = update(w, '--check');
    expect(dirty.status).toBe(1);
    expect(dirty.stdout).toContain('M src/a.ts');
    expect(existsSync(join(w.root, 'xdg-state/cerimonias/update.log'))).toBe(false);
    expect(update(w, '--check', '--force-dirty').status).toBe(0);
  });

  it('--check reports an update in progress without touching its log', () => {
    const w = world();
    mkdirSync(join(w.root, 'xdg-state/cerimonias'), { recursive: true });
    const log = join(w.root, 'xdg-state/cerimonias/update.log');
    writeFileSync(log, 'the running update\n');
    const holder = spawn('flock', ['-n', join(w.root, 'xdg-state/cerimonias/update.lock'), 'sleep', '30'], { stdio: 'ignore' });
    try {
      const deadline = Date.now() + 3000;
      let out = update(w, '--check');
      while (out.status !== 5 && Date.now() < deadline) out = update(w, '--check');
      expect(out.status).toBe(5);
      expect(out.stderr).toContain('Já existe uma atualização em andamento');
      expect(readFileSync(log, 'utf8')).toBe('the running update\n');
    } finally {
      holder.kill();
    }
  });

  it('aborts with the tail of the build log and leaves the installed app alone when the build fails', async () => {
    const w = world();
    install(w.app, FAKE_APP(true));
    const before = readFileSync(w.app, 'utf8');
    const old = await startOld(w);
    writeFileSync(join(w.root, 'repo/README.md'), 'changes outside src/ do not matter\n');
    const out = update(w);
    expect(out.status).toBe(1);
    expect(out.stdout).not.toContain('alterações não commitadas');
    expect(out.stdout).toContain('a compilação falhou; o app instalado não foi tocado');
    expect(out.stdout).not.toContain('pedindo que feche');
    expect(alive(old)).toBe(true);
    expect(readFileSync(w.app, 'utf8')).toBe(before);
  }, 60_000);

  it('stops before touching anything when there is nothing to install', () => {
    const w = world();
    install(w.app, FAKE_APP(true));
    const before = readFileSync(w.app, 'utf8');
    const out = update(w, '--no-build');
    expect(out.status).toBe(1);
    expect(readFileSync(w.app, 'utf8')).toBe(before);
  });
});

describe('update.sh against a running app', () => {
  it('asks it to quit, waits for it, installs the new build and starts it', async () => {
    const w = world();
    install(w.app, FAKE_APP(true));
    install(join(w.root, 'repo/dist/cerimonias-9.9.9.AppImage'), `${FAKE_APP(true)}# new build\n`);
    const old = await startOld(w);
    expect(alive(old)).toBe(true);

    const out = update(w, '--no-build');
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.stdout).toContain('pedindo que feche');
    expect(out.stdout).toContain('app fechado');
    expect(out.stdout).toContain('instalado e rodando: versão 9.9.9, commit abc1234');
    expect(alive(old)).toBe(false);
    expect(readFileSync(w.app, 'utf8')).toContain('# new build');
    const run = JSON.parse(readFileSync(join(w.root, 'data/run.json'), 'utf8')) as { pid: number };
    expect(alive(run.pid)).toBe(true);
    expect(JSON.parse(readFileSync(join(w.root, 'xdg-state/cerimonias/updated.json'), 'utf8')).commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(readFileSync(join(w.root, 'xdg-state/cerimonias/update.log'), 'utf8')).toContain('instalado e rodando');
  }, 60_000);

  it('does not kill an app that ignores the request, and installs nothing', async () => {
    const w = world();
    install(w.app, FAKE_APP(false));
    install(join(w.root, 'repo/dist/cerimonias-9.9.9.AppImage'), `${FAKE_APP(true)}# new build\n`);
    const old = await startOld(w);

    const out = update(w, '--no-build', '--timeout', '2');
    expect(out.status).toBe(3);
    expect(out.stdout).toContain('não foi encerrado à força');
    expect(alive(old)).toBe(true);
    expect(readFileSync(w.app, 'utf8')).not.toContain('# new build');
  }, 60_000);

  it('terminates it with --kill when it ignores the request', async () => {
    const w = world();
    install(w.app, FAKE_APP(false));
    install(join(w.root, 'repo/dist/cerimonias-9.9.9.AppImage'), `${FAKE_APP(true)}# new build\n`);
    const old = await startOld(w);

    const out = update(w, '--no-build', '--timeout', '1', '--kill');
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.stdout).toContain('SIGTERM');
    expect(alive(old)).toBe(false);
    expect(readFileSync(w.app, 'utf8')).toContain('# new build');
  }, 60_000);

  it('just installs and starts when the app is not running, leaving autostart alone', () => {
    const w = world();
    install(join(w.root, 'repo/dist/cerimonias-9.9.9.AppImage'), FAKE_APP(true));
    const out = update(w, '--no-build');
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.stdout).toContain('não está em execução');
    expect(out.stdout).toContain('autostart  not enabled');
    expect(existsSync(join(w.root, 'xdg-config/autostart/cerimonias.desktop'))).toBe(false);
  }, 60_000);
});
