import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import type { ExecResult } from '../src/main/sandbox';

// The plugin script runs through the same sandbox the app gives a stage: the service opens the session with the settings the person's permission produced
// and never a policy of its own. The script is handed over as the command itself, with the event as $1 (the plugin folder is never mounted). The fake session records what the app asked for and what it ran. What the plugin returns is applied by the app: the
// document goes into the run's cycle folder through the same guard a stage's documents go through.

const { runPlugin, writePluginDocument } = await import('../src/main/plugins/runtime');
const { writeArtifact } = await import('../src/main/runner/cycleFolder');

interface Opened {
  worktree: string;
  reader: boolean;
  config: ReturnType<typeof neutralSandbox>;
}

function fakeSandbox(result: Partial<ExecResult> = {}, fail = false) {
  const opened: Opened[] = [];
  const commands: string[] = [];
  const closed = { count: 0 };
  const proxied: { host: string; allowed: boolean }[] = [];
  const service = {
    open: async (o: Opened & { onProxy?: (d: { host: string; port: number; allowed: boolean }) => void }) => {
      opened.push(o);
      if (fail) throw new Error('no sandbox on this machine');
      return {
        exec: async (command: string): Promise<ExecResult> => {
          commands.push(command);
          return { n: 1, command, exitCode: 0, timedOut: false, output: '', ms: 1, ...result };
        },
        log: [],
        close: async () => {
          closed.count++;
        },
      };
    },
  };
  return { opened, commands, closed, proxied, service: service as never };
}

const plugin = { id: 'web-search', script: 'echo "searched for $1"', documents: [{ name: '7_WEB_SEARCH.md', label: 'Web search', title: 'Web search' }] };
// Never the repository: a document the app writes from what a plugin returned lands in a throwaway worktree.
const scratch = mkdtempSync(join(tmpdir(), 'coxia-plugin-run-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const target = () => ({ worktree: scratch, cycleFolder: join('docs', 'cycles', 'tmp') });
const deps = (service: never, config = neutralSandbox()) => ({ sandbox: service, config });

describe('running a plugin', () => {
  it('opens the sandbox over the run worktree, read-only, with the settings it was given, and runs the script with the event as $1', async () => {
    const f = fakeSandbox({ output: 'the result' });
    const out = await runPlugin(deps(f.service), plugin, 'stage-finished', target());
    expect(out).toMatchObject({ plugin: 'web-search', ok: true, text: 'the result', refused: null });
    expect(f.opened).toHaveLength(1);
    expect(f.opened[0]).toMatchObject({ worktree: scratch, reader: true });
    expect(f.opened[0].config.network).toBe('off');
    expect(f.commands[0]).toBe(`set -- 'stage-finished'\necho "searched for $1"`);
    expect(f.closed.count).toBe(1);
  });

  it('never lets an event name become a second command', async () => {
    const f = fakeSandbox({ output: 'x' });
    await runPlugin(deps(f.service), plugin, "x'; rm -rf / #", target());
    expect(f.commands[0].split('\n')[0]).toBe("set -- 'x'\\''; rm -rf / #'");
  });

  it('gives the sandbox exactly the settings the caller built, the network the permission produced included', async () => {
    const f = fakeSandbox({ output: 'ok' });
    const granted = { ...neutralSandbox(), network: 'registry' as const, registryHosts: ['search.example.com'] };
    await runPlugin(deps(f.service, granted), plugin, 'stage-finished', target());
    expect(f.opened[0].config).toEqual(granted);
  });

  it('is never run without an entry script', async () => {
    const f = fakeSandbox();
    const out = await runPlugin(deps(f.service), { id: 'plain', script: '  ' }, 'stage-finished', target());
    expect(out.ok).toBe(false);
    expect(f.opened).toEqual([]);
  });

  it('says why it failed when the sandbox cannot be made, without throwing', async () => {
    const f = fakeSandbox({}, true);
    const out = await runPlugin(deps(f.service), plugin, 'stage-finished', target());
    expect(out.ok).toBe(false);
    expect(out.refused).toContain('no sandbox');
  });

  it('says why it failed when the command does not run or the plugin ends non-zero, and closes the session', async () => {
    const refused = fakeSandbox({ refused: 'budget' });
    expect((await runPlugin(deps(refused.service), plugin, 'stage-finished', target())).refused).toContain('budget');
    expect(refused.closed.count).toBe(1);
    const failed = fakeSandbox({ exitCode: 2 });
    expect((await runPlugin(deps(failed.service), plugin, 'stage-finished', target())).refused).toContain('2');
  });

  it('masks what the plugin prints, as the app does for anything coming from a sandbox', async () => {
    const f = fakeSandbox({ output: 'token glpat-abcdefghij0123456789 done' });
    // i18n-ignore: the redaction test feeds a made-up token
    const out = await runPlugin(deps(f.service), plugin, 'stage-finished', target());
    expect(out.text).not.toContain('glpat-abcdefghij0123456789');
  });
});

describe('the document a plugin produced', () => {
  let dir: string;
  const at = () => ({ worktree: dir, cycleFolder: 'docs/cycles/84-plugin-platform' });
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('is written by the app into the cycle folder, with the plugin and the event it came from', () => {
    dir = mkdtempSync(join(tmpdir(), 'coxia-plugin-doc-'));
    const written = writePluginDocument(at(), { name: '7_WEB_SEARCH.md', title: 'Web search' }, { plugin: 'web-search', event: 'stage-finished', text: 'the result\n- source: https://search.example.com' });
    expect(written?.name).toBe('7_WEB_SEARCH.md');
    expect(written?.path).toBe(join(dir, 'docs/cycles/84-plugin-platform/7_WEB_SEARCH.md'));
    const text = readFileSync(written?.path as string, 'utf8');
    expect(text).toContain('# Web search');
    expect(text).toContain('web-search');
    expect(text).toContain('the result');
  });

  it('is not written when the plugin returned nothing, or when the name is not one the folder takes', () => {
    dir = mkdtempSync(join(tmpdir(), 'coxia-plugin-doc-'));
    expect(writePluginDocument(at(), { name: '7_WEB_SEARCH.md', title: 'Web search' }, { plugin: 'web-search', event: 'stage-finished', text: '   ' })).toBeNull();
    expect(writePluginDocument(at(), { name: '../escape.md', title: 'Web search' }, { plugin: 'web-search', event: 'stage-finished', text: 'x' })).toBeNull();
    expect(writePluginDocument(at(), { name: '.hidden', title: 'Web search' }, { plugin: 'web-search', event: 'stage-finished', text: 'x' })).toBeNull();
  });

  it('is never written for a document of the flow: the file the stage answers for is not a plugin\'s to write', () => {
    dir = mkdtempSync(join(tmpdir(), 'coxia-plugin-doc-'));
    const at = () => ({ worktree: dir, cycleFolder: 'docs/cycles/84-plugin-platform' });
    writeArtifact(dir, 'docs/cycles/84-plugin-platform', 'USER_MANUAL.md', '# The manual the stage wrote\n');
    expect(writePluginDocument(at(), { name: 'USER_MANUAL.md', title: 'Manual', chain: true }, { plugin: 'impostor', event: 'stage-finished', text: 'overwritten' })).toBeNull();
    expect(readFileSync(join(dir, 'docs/cycles/84-plugin-platform/USER_MANUAL.md'), 'utf8')).toContain('The manual the stage wrote');
  });

  it('is applied by runPlugin after the script ran', async () => {
    dir = mkdtempSync(join(tmpdir(), 'coxia-plugin-doc-'));
    const f = fakeSandbox({ output: 'the result' });
    const out = await runPlugin(deps(f.service), plugin, 'stage-finished', at());
    expect(out.document?.name).toBe('7_WEB_SEARCH.md');
    expect(existsSync(out.document?.path as string)).toBe(true);
  });
});
