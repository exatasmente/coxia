import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// "<namespace>/<repo>" for every bare mirror "<dir>/<namespace>/<repo>.git" the release tool keeps. Electron-free: the startup move uses it too.
export function mirroredProjects(dir: string | null | undefined): string[] {
  const out: string[] = [];
  if (!dir) return out;
  try {
    for (const ns of readdirSync(dir)) {
      for (const repo of readdirSync(join(dir, ns))) if (repo.endsWith('.git')) out.push(`${ns}/${repo.slice(0, -4)}`);
    }
  } catch {}
  return out.sort();
}
