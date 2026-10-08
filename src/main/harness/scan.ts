import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENTS_FILE, AGENTS_FILE_MAX, type AgentsDocsState } from '../../shared/harness/agentsMd';

async function lstatOptional(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Reads the repository's universal agent instructions without following links or accepting oversized files. */
export async function scanHarness(repoPath: string): Promise<AgentsDocsState> {
  const path = join(repoPath, AGENTS_FILE);
  const empty: AgentsDocsState = { repo: repoPath, exists: false, document: null, ignored: [], signature: '' };
  const info = await lstatOptional(path);
  if (!info) return empty;
  if (!info.isFile() || info.size > AGENTS_FILE_MAX) {
    return { ...empty, exists: true, ignored: [AGENTS_FILE], signature: `${AGENTS_FILE}:${info.size}:${info.mtimeMs}` };
  }
  const text = await readFile(path, 'utf8');
  return {
    repo: repoPath,
    exists: true,
    document: { path: AGENTS_FILE, text, size: info.size, mtimeMs: info.mtimeMs },
    ignored: [],
    signature: `${AGENTS_FILE}:${info.size}:${info.mtimeMs}`,
  };
}
