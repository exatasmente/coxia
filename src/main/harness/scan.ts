import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HARNESS_DIR, HARNESS_OWN, type HarnessEntry, type HarnessState, classifyHarnessPath, parseHarnessFile } from '../../shared/harness/format';

// What a repository holds of the documentation of the app: `<repo>/.coxia/`, found by convention (no list in the config). Only reads the disk.

/** A file this big is not documentation an agent could be given; it is listed as ignored rather than read. */
export const HARNESS_FILE_MAX = 256 * 1024;
// A folder with this many files is not a documentation folder; the walk stops so a stray tree cannot make the screen slow.
const WALK_MAX = 1000;

async function walk(root: string, rel: string, into: string[]): Promise<void> {
  if (into.length >= WALK_MAX) return;
  const items = await readdir(join(root, rel), { withFileTypes: true });
  for (const item of items.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = rel ? `${rel}/${item.name}` : item.name;
    if ((HARNESS_OWN as readonly string[]).includes(path)) continue;
    if (item.isDirectory()) await walk(root, path, into);
    else into.push(path);
  }
}

/** The files of `<repoPath>/.coxia/`, parsed, and the ones the app does not read. A repository without the folder is `exists: false`. */
export async function scanHarness(repoPath: string): Promise<HarnessState> {
  const root = join(repoPath, HARNESS_DIR);
  const empty: HarnessState = { repo: repoPath, exists: false, entries: [], ignored: [], signature: '' };
  const isDir = await lstat(root).then((s) => s.isDirectory(), () => false);
  if (!isDir) return empty;
  const files: string[] = [];
  await walk(root, '', files).catch(() => undefined);
  const entries: HarnessEntry[] = [];
  const ignored: string[] = [];
  for (const path of files) {
    const at = classifyHarnessPath(path);
    const info = at ? await lstat(join(root, path)).catch(() => null) : null;
    // lstat, so a symbolic link is not a file: it could point outside the repository
    if (!at || !info || !info.isFile() || info.size > HARNESS_FILE_MAX) {
      ignored.push(path);
      continue;
    }
    const text = await readFile(join(root, path), 'utf8').catch(() => null);
    const parse = text === null ? null : parseHarnessFile(path, text);
    if (!parse) {
      ignored.push(path);
      continue;
    }
    entries.push({ path, kind: at.kind, id: at.id, parse, size: info.size, mtimeMs: info.mtimeMs });
  }
  const signature = entries.map((e) => `${e.path}:${e.size}:${e.mtimeMs}`).join('|');
  return { repo: repoPath, exists: true, entries, ignored, signature };
}
