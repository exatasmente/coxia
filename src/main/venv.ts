import { execFile } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const READY = '.cerimonias-ready';
const PYTHON_VERSION = '3.12';

export function venvPython(venv: string): string {
  return join(venv, 'bin/python');
}

function findUv(): string | null {
  // A desktop session often lacks ~/.local/bin in PATH, so look there first.
  const dirs = [join(homedir(), '.local/bin'), ...(process.env.PATH ?? '').split(delimiter)];
  for (const dir of dirs) {
    const candidate = join(dir, 'uv');
    if (dir && existsSync(candidate)) return candidate;
  }
  return null;
}

function run(cmd: string, args: string[], onChild: (c: ReturnType<typeof execFile>) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000 }, (err, _out, stderr) => {
      if (err) reject(new Error(String(stderr).trim().split('\n').slice(-6).join('\n') || err.message));
      else resolve();
    });
    onChild(child);
  });
}

// Creates the sidecar's Python environment on first use. A marker file is written only after the
// install finishes, so an interrupted attempt is redone from scratch next time.
export async function ensureVenv(
  venv: string,
  requirements: string,
  onChild: (c: ReturnType<typeof execFile>) => void = () => {},
): Promise<string> {
  const python = venvPython(venv);
  if (existsSync(join(venv, READY)) && existsSync(python)) return python;
  const uv = findUv();
  if (!uv) {
    throw new Error(
      `Não achei o "uv" para preparar a voz. Instale com "curl -LsSf https://astral.sh/uv/install.sh | sh" e abra o app de novo.`,
    );
  }
  rmSync(venv, { recursive: true, force: true });
  try {
    await run(uv, ['venv', '--python', PYTHON_VERSION, venv], onChild);
    await run(uv, ['pip', 'install', '--python', python, '-r', requirements], onChild);
    writeFileSync(join(venv, READY), new Date().toISOString());
  } catch (e) {
    rmSync(venv, { recursive: true, force: true });
    throw new Error(`Não consegui preparar o ambiente de voz (precisa de rede na primeira vez). ${(e as Error).message}`);
  }
  return python;
}
