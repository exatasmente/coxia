import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateConfig } from '../src/shared/config/migrations';
import { CONFIG_SCHEMA_VERSION } from '../src/shared/config/types';
import { parseRun, type Run } from '../src/shared/runs';
// @ts-expect-error plain ESM script, no declaration file
import { seedDocsWorkspace } from '../scripts/seed-docs-workspace.mjs';

// @ts-expect-error plain ESM script, no declaration file
import { auditRoot } from '../scripts/public-audit.mjs';

// The seed writes a whole fictional workspace into a folder the caller names: what the app reads, with no real data anywhere. It is the
// documentation tool the capture scripts open the app on; the test never opens the app and never reaches the network.

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const seed = async (): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), 'coxia-seed-'));
  made.push(dir);
  await seedDocsWorkspace(dir);
  return dir;
};

const read = (dir: string, rel: string): unknown => JSON.parse(readFileSync(join(dir, rel), 'utf8'));

describe('the seeded documentation workspace', () => {
  it('writes the workspace the app reads, at the schema version of the app', async () => {
    const dir = await seed();
    const config = read(dir, 'workspaces/principal/config.json') as { schemaVersion: number; language: string; agents: { team: { id: string }[] } };
    expect(config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(config.language).toBe('pt-BR');
    expect(config.agents.team.map((a) => a.id)).toEqual(['support', 'product-owner', 'tech-lead', 'developer', 'qa']);
    // A config already at the current version has nothing left to migrate, which is what the app checks to open it without a warning.
    const migrated = migrateConfig(config, { legacyInstall: false });
    expect(migrated.notes).toEqual([]);
    expect(migrated.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
  });

  it('writes two runs the run store accepts: one finished with its documents, one held at a human gate', async () => {
    const dir = await seed();
    const finished = parseRun(read(dir, 'workspaces/principal/runs/r-a1b2c3-first.json'));
    const held = parseRun(read(dir, 'workspaces/principal/runs/r-d4e5f6-second.json'));
    expect(finished.ok, JSON.stringify(finished.ok ? [] : finished.errors)).toBe(true);
    expect(held.ok, JSON.stringify(held.ok ? [] : held.errors)).toBe(true);
    const first = (finished as { ok: true; run: Run }).run;
    expect(first.status).toBe('done');
    expect(first.stages.flatMap((s) => s.artifacts)).toContain('1_SPEC.md');
    expect(Object.keys(first.evidence ?? {})).toContain('ev-1');
    const second = (held as { ok: true; run: Run }).run;
    expect(second.status).toBe('gate');
    expect(second.stage).toBe('gate2');
  });

  it('writes the minutes of a day, the board, a conversation and the procedures, all with neutral placeholders', async () => {
    const dir = await seed();
    expect(readFileSync(join(dir, '2026-06-15-pre-daily.md'), 'utf8')).toContain('Pre-daily of 2026-06-15');
    const cards = read(dir, 'workspaces/principal/board.json') as { version: number; cards: { column: string; host: { iid: number } }[] };
    expect(cards.version).toBe(1);
    expect(cards.cards.map((c) => c.host.iid)).toEqual([101, 102, 103]);
    expect(cards.cards.map((c) => c.column)).toEqual(['ready', 'gate2', 'refine']);
    expect(readFileSync(join(dir, 'workspaces/principal/forum/call-aurora.jsonl'), 'utf8')).toContain('"kind":"handoff"');
    for (const id of ['p-1a2b3c4d', 'p-5e6f7a8b', 'p-9c0d1e2f']) expect(read(dir, `workspaces/principal/memory/procedures/${id}.json`)).toMatchObject({ id });
  });

  it('marks the setup as finished, so the app opens on the day and never on the first-run wizard', async () => {
    const dir = await seed();
    expect((read(dir, 'workspaces/principal/config.json') as { setupComplete: boolean }).setupComplete).toBe(true);
  });

  it('refuses a folder that already holds a workspace, without touching what is there', async () => {
    const dir = await seed();
    const before = readFileSync(join(dir, 'workspaces.json'), 'utf8');
    await expect(seedDocsWorkspace(dir)).rejects.toThrow(/already holds a workspace/);
    expect(readFileSync(join(dir, 'workspaces.json'), 'utf8')).toBe(before);
  });

  it('passes the public audit, pointed at the folder it wrote, and leaves a source tree of it in no place else', async () => {
    const dir = await seed();
    const { hits } = auditRoot(dir, []);
    expect(hits).toEqual([]);
  });

  it('writes nothing outside the folder it was given', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'coxia-seed-parent-'));
    made.push(parent);
    const dir = join(parent, 'docs');
    await seedDocsWorkspace(dir);
    expect(readFileSync(join(dir, 'workspaces.json'), 'utf8')).toContain('"principal"');
    expect(readdirSync(parent)).toEqual(['docs']);
  });
});

// The seed refuses a folder that is the app's own data folder: the test sets the variable the app reads and checks the refusal.
describe('the seed and the app\'s own data folder', () => {
  it('refuses to write into the folder CERIMONIAS_DATA_DIR points at', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coxia-seed-env-'));
    made.push(dir);
    const before = process.env.CERIMONIAS_DATA_DIR;
    process.env.CERIMONIAS_DATA_DIR = dir;
    try {
      await expect(seedDocsWorkspace(dir)).rejects.toThrow(/app's own data folder/);
    } finally {
      if (before === undefined) delete process.env.CERIMONIAS_DATA_DIR;
      else process.env.CERIMONIAS_DATA_DIR = before;
    }
  });
});
