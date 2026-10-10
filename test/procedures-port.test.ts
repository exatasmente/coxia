import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { createProceduresPort, type OpenContext } from '../src/main/procedures/port';
import { createProcedureStore, proceduresPath, type ProcedureStore } from '../src/main/procedures/store';

// A procedures folder that cannot be read never fails a stage or an answer: the call goes on without procedures (#179). Every test has a folder of its own in the temp folder.
let ws: string;
const config = { runner: { procedures: true }, vcs: [], projects: { repos: [] }, language: 'en' } as unknown as WorkspaceConfig;
const ctx: OpenContext = { surface: 'stage', agent: { id: 'writer', permission: 'worktree', model: 'sonnet' } as unknown as OpenContext['agent'], ref: 'app#1', repos: [] };

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-procedures-port-'));
});

describe('an unreadable procedures folder', () => {
  it('is read as empty when memory/procedures is a regular file, and said once without the path', () => {
    mkdirSync(join(ws, 'memory'), { recursive: true });
    writeFileSync(proceduresPath(ws), 'not a folder');
    const errors: Error[] = [];
    const store = createProcedureStore(ws, { onError: (e) => errors.push(e) });
    expect(store.list()).toEqual({ records: [], skipped: 0 });
    expect(store.list()).toEqual({ records: [], skipped: 0 });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/could not be read/);
    expect(errors[0].message).not.toContain(ws);
  });

  it.skipIf(process.getuid?.() === 0)('is read as empty when the folder has no read permission', () => {
    mkdirSync(proceduresPath(ws), { recursive: true });
    chmodSync(proceduresPath(ws), 0o000);
    try {
      const errors: Error[] = [];
      const store = createProcedureStore(ws, { onError: (e) => errors.push(e) });
      expect(store.list()).toEqual({ records: [], skipped: 0 });
      expect(errors).toHaveLength(1);
    } finally {
      chmodSync(proceduresPath(ws), 0o700);
    }
  });

  it('open gives a session with an empty list over a file where the folder should be', () => {
    mkdirSync(join(ws, 'memory'), { recursive: true });
    writeFileSync(proceduresPath(ws), 'not a folder');
    const port = createProceduresPort({ config: () => config, dir: ws });
    const session = port.open(ctx);
    expect(session?.list.text).toBe('');
  });

  it('open returns null, and says so once, when anything under it throws', () => {
    const store = { list: () => { throw new Error(`EACCES at ${ws}`); } } as unknown as ProcedureStore;
    const errors: { source: string; error: Error }[] = [];
    const port = createProceduresPort({ config: () => config, dir: ws, store, onError: (source, error) => errors.push({ source, error }) });
    expect(port.open(ctx)).toBeNull();
    expect(port.open(ctx)).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('procedures');
    expect(errors[0].error.message).not.toContain(ws);
  });
});
