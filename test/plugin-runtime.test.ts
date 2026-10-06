import { describe, expect, it, vi } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import type { ExecResult } from '../src/main/sandbox';

// The plugin script runs through the same sandbox the app gives a stage: the service opens the session with the workspace's own
// settings (closed by default) and never a policy of its own. The fake session records what the app asked for and what it ran.

const { runPlugin } = await import('../src/main/plugins/runtime');

interface Opened {
  worktree: string;
  reader: boolean;
  config: ReturnType<typeof neutralSandbox>;
}

function fakeSandbox(result: Partial<ExecResult> = {}, fail = false) {
  const opened: Opened[] = [];
  const commands: string[] = [];
  const closed = { count: 0 };
  const service = {
    open: async (o: Opened) => {
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
  return { opened, commands, closed, service: service as never };
}

const plugin = { id: 'web-search', entry: '/plugins/web-search/search.sh' };

describe('running a plugin', () => {
  it('opens the sandbox with the workspace settings and the worktree, read-only, and runs the entry with the event', async () => {
    const f = fakeSandbox({ output: 'the result' });
    const out = await runPlugin({ sandbox: f.service, config: () => neutralSandbox(), worktree: () => '/wt' }, plugin, 'stage-finished');
    expect(out).toMatchObject({ plugin: 'web-search', ok: true, text: 'the result', refused: null });
    expect(f.opened).toHaveLength(1);
    expect(f.opened[0]).toMatchObject({ worktree: '/wt', reader: true });
    expect(f.opened[0].config).toEqual(neutralSandbox());
    expect(f.opened[0].config.network).toBe('off');
    expect(f.commands[0]).toContain("'/plugins/web-search/search.sh'");
    expect(f.commands[0]).toContain("'stage-finished'");
    expect(f.closed.count).toBe(1);
  });

  it('is never run without an entry script', async () => {
    const f = fakeSandbox();
    const out = await runPlugin({ sandbox: f.service, config: () => neutralSandbox(), worktree: () => '/wt' }, { id: 'plain', entry: '' }, 'stage-finished');
    expect(out.ok).toBe(false);
    expect(f.opened).toEqual([]);
  });

  it('says why it failed when the sandbox cannot be made, without throwing', async () => {
    const f = fakeSandbox({}, true);
    const out = await runPlugin({ sandbox: f.service, config: () => neutralSandbox(), worktree: () => '/wt' }, plugin, 'stage-finished');
    expect(out.ok).toBe(false);
    expect(out.refused).toContain('no sandbox');
  });

  it('says why it failed when the command does not run or the plugin ends non-zero, and closes the session', async () => {
    const refused = fakeSandbox({ refused: 'budget' });
    expect((await runPlugin({ sandbox: refused.service, config: () => neutralSandbox(), worktree: () => '/wt' }, plugin, 'stage-finished')).refused).toContain('budget');
    expect(refused.closed.count).toBe(1);
    const failed = fakeSandbox({ exitCode: 2 });
    expect((await runPlugin({ sandbox: failed.service, config: () => neutralSandbox(), worktree: () => '/wt' }, plugin, 'stage-finished')).refused).toContain('2');
  });

  it('masks what the plugin prints, as the app does for anything coming from a sandbox', async () => {
    const f = fakeSandbox({ output: 'token glpat-abcdefghij0123456789 done', });
    // i18n-ignore: the redaction test feeds a made-up token
    const out = await runPlugin({ sandbox: f.service, config: () => neutralSandbox(), worktree: () => '/wt' }, plugin, 'stage-finished');
    expect(out.text).not.toContain('glpat-abcdefghij0123456789');
  });
});
