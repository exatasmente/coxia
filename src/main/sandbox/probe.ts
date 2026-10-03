import { type SpawnOptions, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SandboxReason, type SandboxStatus, SANDBOX_UNAVAILABLE } from '../../shared/sandbox';
import { neutralSandbox } from '../../shared/config/defaults';
import { bwrapArgs } from './policy';
import { systemLayout } from './system';

// Whether this machine can make a sandbox: not by looking for a file, but by making one the way a stage does (the same flags, the helpers it needs) and running a harmless
// command in it. The answer is cached for a few minutes; a person can ask again.

export interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  /** The program could not be started at all (not installed). */
  missing?: boolean;
}

export type RunProgram = (file: string, args: string[], input?: Buffer) => Promise<Ran>;

const realRun: RunProgram = (file, args, input) =>
  new Promise((resolve) => {
    const options: SpawnOptions = { stdio: ['ignore', 'pipe', 'pipe', 'pipe'], env: { PATH: '/usr/local/bin:/usr/bin:/bin' } };
    const child = spawn(file, args, options);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.stdout?.on('data', (c: Buffer) => (stdout += c));
    child.stderr?.on('data', (c: Buffer) => (stderr += c));
    (child.stdio[3] as NodeJS.WritableStream | null)?.on('error', () => undefined);
    if (input) (child.stdio[3] as NodeJS.WritableStream | null)?.end(input);
    else (child.stdio[3] as NodeJS.WritableStream | null)?.end();
    child.once('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, missing: e.code === 'ENOENT' });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

const CHECK = 'command -v prlimit >/dev/null 2>&1 || exit 71; command -v timeout >/dev/null 2>&1 || exit 72; exec prlimit --nproc=64 -- timeout 5 /bin/sh -c "exit 0"';

/** The sandbox's own check, with the program that runs things replaceable (tests). */
export async function probeSandbox(run: RunProgram = realRun, platform: string = process.platform): Promise<SandboxStatus> {
  if (platform !== 'linux') return { ...SANDBOX_UNAVAILABLE, reason: 'platform' };
  const version = await run('bwrap', ['--version']);
  if (version.missing || version.code !== 0) return { available: false, backend: null, version: null, reason: 'no-bwrap', detail: '' };
  const v = /(\d+\.\d+\.\d+)/.exec(version.stdout)?.[1] ?? null;
  const root = mkdtempSync(join(tmpdir(), 'coxia-probe-'));
  try {
    const stageDir = join(root, 'stage');
    const worktree = join(root, 'tree');
    for (const d of [worktree, join(stageDir, 'ctl'), join(stageDir, 'out'), join(stageDir, 'home')]) mkdirSync(d, { recursive: true });
    const args = bwrapArgs({ worktree, tree: null, stageDir, system: systemLayout(), roBinds: [], pathDirs: [], network: 'off', limits: neutralSandbox().limits, tmpMb: 16 });
    const r = await run('bwrap', ['--args', '3', '--', '/bin/sh', '-c', CHECK], Buffer.from(`${args.join('\0')}\0`));
    if (r.code === 0) return { available: true, backend: 'bwrap', version: v, reason: null, detail: '' };
    const reason: SandboxReason = r.code === 71 ? 'no-prlimit' : r.code === 72 ? 'no-timeout' : 'refused';
    return { available: false, backend: 'bwrap', version: v, reason, detail: reason === 'refused' ? (r.stderr.trim().split('\n')[0] ?? '').slice(0, 300) : '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

let cached: { at: number; status: SandboxStatus } | null = null;
const TTL = 5 * 60_000;

/** The cached answer, or a fresh one when there is none or it is old. */
export async function sandboxStatus(force = false, run: RunProgram = realRun, now: () => number = Date.now): Promise<SandboxStatus> {
  if (!force && cached && now() - cached.at < TTL) return cached.status;
  const status = await probeSandbox(run);
  cached = { at: now(), status };
  return status;
}

/** Forgets the cached answer (tests, and "check again"). */
export const invalidateSandboxStatus = (): void => {
  cached = null;
};
